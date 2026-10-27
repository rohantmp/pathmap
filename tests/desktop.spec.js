import { test, expect } from '@playwright/test';
import { openApp, uploadGpx, polygonsOnMap, openSettingsTab, saveDownload, pngSize, pdfPageCount, storedSession, pickHandle, BASE_PATH } from './helpers.js';

test.describe('GPX loading and polygon management', () => {
  test('loads GPX files into polygons, escapes names, reports bad files', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await openApp(page);
    await uploadGpx(page, ['plot-a.gpx', 'plot-b.gpx', 'not-gpx.gpx']);

    await expect(page.locator('.polygon-card')).toHaveCount(2);
    expect(dialogs.join('\n')).toMatch(/Created 2 polygon/);
    expect(dialogs.join('\n')).toMatch(/not-gpx\.gpx: Not a valid GPX/);
    await expect(page.locator('.polygon-name').first()).toHaveValue('Plot <b>A</b> & "quotes"');
    await expect(page.locator('.polygon-card b')).toHaveCount(0); // nothing injected
    expect(await polygonsOnMap(page)).toBe(2);
    await expect(page.locator('#map .polygon-name-content')).toHaveCount(2);
  });

  test('rename, hide/reload, colour on hidden, groups and boundaries', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await openApp(page);
    await uploadGpx(page, ['plot-a.gpx', 'plot-b.gpx']);
    const firstCard = page.locator('.polygon-card').first();

    // Rename in the sidebar updates the map label
    await firstCard.locator('.polygon-name').fill('Sidebar Renamed');
    await firstCard.locator('.polygon-name').press('Enter');
    await expect(page.locator('#map .polygon-name-content', { hasText: 'Sidebar Renamed' })).toHaveCount(1);

    // Hide, reload, change colour: stays hidden
    await firstCard.locator('.polygon-actions .btn-icon').nth(0).click();
    expect(await polygonsOnMap(page)).toBe(1);
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('.polygon-card')).toHaveCount(2);
    expect(await polygonsOnMap(page)).toBe(1);
    await page.locator('.polygon-card').first().locator('.polygon-color').evaluate((el) => { el.value = '#123456'; el.dispatchEvent(new Event('change')); });
    expect(await polygonsOnMap(page)).toBe(1);
    await page.locator('.polygon-card').first().locator('.polygon-actions .btn-icon').nth(0).click();
    expect(await polygonsOnMap(page)).toBe(2);

    // Group + boundary
    await page.click('#create-group');
    await openSettingsTab(page, 'display');
    await page.check('#toggle-group-bounds');
    await page.locator('.polygon-card .polygon-group-select').first().selectOption('1');
    await expect(page.locator('#map path[stroke="#ff6600"]')).toHaveCount(1);
    await expect(page.locator('.group-card')).toHaveCount(1);
    expect((await storedSession(page)).polygons.some((p) => p.groupId === 1)).toBe(true);
  });

  test('transliterates a Tamil polygon name to Latin and back', async ({ page }) => {
    await openApp(page);
    await uploadGpx(page, ['plot-b.gpx']);
    const name = page.locator('.polygon-name').first();
    await expect(name).toHaveValue('தோட்டம் B');
    await page.locator('.btn-transliterate').first().click();
    const latin = await name.inputValue();
    expect(latin).not.toMatch(/[஀-௿]/);
    expect(latin.trim().length).toBeGreaterThan(2);
    await expect(page.locator('#map .polygon-name-content').first()).toHaveText(latin);
    await page.locator('.btn-transliterate').first().click();
    expect(await name.inputValue()).toMatch(/[஀-௿]/);
  });
});

test.describe('Export', () => {
  test('export dialog: front matter, export-only renames, PNG and PDF downloads', async ({ page }, testInfo) => {
    page.on('dialog', (d) => d.accept());
    await openApp(page);
    await uploadGpx(page, ['plot-a.gpx', 'plot-b.gpx']);
    await openSettingsTab(page, 'export');
    await page.click('#export-png');
    await expect(page.locator('#export-modal')).toBeVisible();
    await expect(page.locator('#export-rename-list .export-rename-row')).toHaveCount(2);

    await page.fill('#export-title', 'Survey of plots – test');
    await page.click('#notes-source-tab');
    await page.fill('#export-notes', '# Context\nSurveyed in **October 2026**.\n\n- Plot A\n- Plot B');
    await page.locator('#export-rename-list .export-rename-row input').first().fill('Export Name One');

    const [pngDl] = await Promise.all([page.waitForEvent('download'), page.click('#export-run-png')]);
    const png = await saveDownload(pngDl, testInfo.outputPath('downloads'));
    expect(png.file).toMatch(/survey-of-plots-test-\d{4}-\d{2}-\d{2}\.png$/);
    expect(png.bytes.subarray(1, 4).toString()).toBe('PNG');
    const { width, height } = pngSize(png.bytes);
    expect(width).toBeGreaterThan(1000);
    expect(height).toBeGreaterThan(800 * 2); // front matter + map + legend stacked at 2x
    expect(png.bytes.length).toBeGreaterThan(100_000);

    await expect(page.locator('#export-modal')).toBeHidden();
    await expect(page.locator('.polygon-name').first()).not.toHaveValue('Export Name One');
    expect(JSON.stringify(await storedSession(page))).not.toContain('Export Name One');
    await expect(page.locator('#map .polygon-name-content', { hasText: 'Export Name One' })).toHaveCount(0);

    // Reopen: remembered values; PDF
    await page.click('#export-pdf');
    await expect(page.locator('#export-title')).toHaveValue('Survey of plots – test');
    await expect(page.locator('#export-rename-list .export-rename-row input').first()).toHaveValue('Export Name One');
    const [pdfDl] = await Promise.all([page.waitForEvent('download'), page.click('#export-run-pdf')]);
    const pdf = await saveDownload(pdfDl, testInfo.outputPath('downloads'));
    expect(pdf.bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.bytes.length).toBeGreaterThan(50_000);
    expect(pdf.bytes.length).toBeLessThan(10_000_000);
    expect(pdfPageCount(pdf.bytes)).toBe(1);
  });

  test('KML and GeoJSON exports download', async ({ page }, testInfo) => {
    page.on('dialog', (d) => d.accept());
    await openApp(page);
    await uploadGpx(page, ['plot-a.gpx']);
    await openSettingsTab(page, 'export');
    const [kml] = await Promise.all([page.waitForEvent('download'), page.click('#export-kml')]);
    const kmlFile = await saveDownload(kml, testInfo.outputPath('downloads'));
    expect(kmlFile.bytes.toString()).toContain('<Placemark>');
    expect(kmlFile.bytes.toString()).toContain('Plot &lt;b&gt;A&lt;/b&gt; &amp; &quot;quotes&quot;');
    const [geo] = await Promise.all([page.waitForEvent('download'), page.click('#export-geojson')]);
    const geoFile = await saveDownload(geo, testInfo.outputPath('downloads'));
    expect(JSON.parse(geoFile.bytes.toString()).features).toHaveLength(1);
  });
});

test.describe('Vertex editing (mouse)', () => {
  test('drag moves, right-click deletes exactly one, midpoint click adds', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await openApp(page);
    await uploadGpx(page, ['plot-a.gpx']);
    await openSettingsTab(page, 'edit');
    await page.selectOption('#polygon-select', { index: 1 });
    await page.waitForTimeout(800);
    const handles = page.locator('#map .vertex-marker');
    const n0 = await handles.count();
    expect(n0).toBeGreaterThanOrEqual(5);

    const before = (await storedSession(page)).polygons[0].hull.map((v) => `${v.lat},${v.lon}`).join('|');
    const a = await pickHandle(page, '#map .vertex-marker');
    expect(a).not.toBeNull();
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + i * 10, a.y + i * 5);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = (await storedSession(page)).polygons[0].hull.map((v) => `${v.lat},${v.lon}`).join('|');
    expect(after).toBe(before); // Unapplied boundary changes stay out of committed storage.
    expect(await handles.count()).toBe(n0);

    // Right-click deletes exactly one vertex each time
    for (const expected of [n0 - 1, n0 - 2]) {
      const h = await pickHandle(page, '#map .vertex-marker');
      expect(h).not.toBeNull();
      await page.mouse.click(h.x, h.y, { button: 'right' });
      await expect(handles).toHaveCount(expected);
    }

    // Clicking a midpoint handle adds one
    const mid = await pickHandle(page, '#map .midpoint-marker');
    expect(mid).not.toBeNull();
    await page.mouse.click(mid.x, mid.y);
    await expect(handles).toHaveCount(n0 - 1);
    await page.click('#map-draft-apply');
    await expect(handles).toHaveCount(0);
    expect((await storedSession(page)).polygons[0].hull.map(v=>`${v.lat},${v.lon}`).join('|')).not.toBe(before);
  });
});

test.describe('Example session and storage', () => {
  test('loads the bundled example and asks before replacing a session', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await openApp(page);
    await page.click('.empty-state button');
    await expect(page.locator('.polygon-card')).toHaveCount(6);
    await expect(page.locator('.group-card')).toHaveCount(2);
    expect(dialogs).toHaveLength(0);
    expect(await polygonsOnMap(page)).toBe(6);
    await expect(page.locator('#map path[stroke="#ff6600"]')).toHaveCount(2);
    await expect(page.locator('#map .polygon-area-label').first()).toBeVisible();
    const session = await storedSession(page);
    expect(session.polygons.map((p) => p.tracks.length)).toEqual([3, 2, 3, 2, 3, 1]);
    expect(session.polygons.some((p) => /[஀-௿]/.test(p.name))).toBe(true);

    await openSettingsTab(page, 'session');
    await page.click('#load-example-session');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toMatch(/replaces your current session/);

    await openSettingsTab(page, 'export');
    await page.click('#export-pdf');
    await expect(page.locator('#export-title')).toHaveValue(/Kanchipuram/);
  });

  test('v2 seeds from a v1 session and never writes the v1 key', async ({ page }) => {
    const v1Session = JSON.stringify({
      polygons: [{ id: 1, name: 'From v1', color: '#FF6B6B', groupId: null, hidden: false,
        tracks: [{ id: 1, name: 't', points: [{ lat: 13, lon: 80 }, { lat: 13.01, lon: 80 }, { lat: 13.01, lon: 80.01 }, { lat: 13, lon: 80.01 }] }],
        hull: [{ lat: 13, lon: 80 }, { lat: 13, lon: 80.01 }, { lat: 13.01, lon: 80.01 }, { lat: 13.01, lon: 80 }] }],
      groups: [], nextPolygonId: 2, nextGroupId: 1, mapState: null, focusedPolygonId: null, focusedGroupId: null,
    });
    await openApp(page, { seedStorage: { pathmap_session: v1Session } });
    await expect(page.locator('.polygon-name').first()).toHaveValue('From v1');
    await page.locator('.polygon-name').first().fill('Changed in v2');
    await page.locator('.polygon-name').first().press('Enter');
    const keys = await page.evaluate(() => ({ v1: localStorage.getItem('pathmap_session'), v2: localStorage.getItem('pathmap_session_v2') }));
    expect(keys.v1).toBe(v1Session); // untouched
    expect(keys.v2).toContain('Changed in v2');
    // a v2 session is still a valid v1 session shape
    const v2 = JSON.parse(keys.v2);
    expect(Object.keys(v2)).toEqual(expect.arrayContaining(Object.keys(JSON.parse(v1Session))));
    expect(v2.schemaVersion).toBe(2);
  });

  test('back-to-v1 link only when served under /v2/', async ({ page }) => {
    await openApp(page);
    const link = page.locator('#version-link');
    if (/\/v2\/$/.test(BASE_PATH)) {
      await expect(link).toBeVisible();
      expect(await link.getAttribute('href')).toBe(BASE_PATH.replace(/v2\/$/, ''));
    } else {
      await expect(link).toBeHidden();
    }
  });
});
