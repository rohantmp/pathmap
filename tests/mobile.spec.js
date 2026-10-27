import { test, expect } from '@playwright/test';
import { openApp, uploadGpx, polygonsOnMap, saveDownload, pdfPageCount, pickHandle } from './helpers.js';

const openDrawer = async (page) => {
  await page.$eval('#mobile-menu-toggle', (el) => { if (!document.getElementById('sidebar').classList.contains('active')) el.click(); });
  await page.waitForTimeout(400);
};
const openSettings = async (page, tab) => {
  const hidden = await page.$eval('#settings-container', (el) => el.style.display === 'none');
  if (hidden) await page.tap('#toggle-settings-panel');
  await page.tap(`.tab-button[data-tab="${tab}"]`);
};
test('phone layout: no overflow, drawer stacking, compact attribution, targets', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await openApp(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.tap('#mobile-menu-toggle');
  await expect(page.locator('#sidebar')).toHaveClass(/active/);
  await expect(page.locator('#mobile-menu-toggle')).toBeHidden();
  const z = await page.evaluate(() => ({
    sidebar: +getComputedStyle(document.getElementById('sidebar')).zIndex,
    controls: +getComputedStyle(document.querySelector('.leaflet-bottom')).zIndex,
  }));
  expect(z.sidebar).toBeGreaterThan(z.controls);
  expect((await page.textContent('.leaflet-control-attribution')).length).toBeLessThan(60);
  await uploadGpx(page, ['plot-a.gpx', 'plot-b.gpx']);
  await expect(page.locator('#sidebar')).not.toHaveClass(/active/); // drawer closes to show the result
  await openDrawer(page);
  const small = await page.$$eval('.polygon-card .btn-icon', (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 40 || r.height < 40; }).length);
  expect(small).toBe(0);
  expect(await page.$$eval('.polygon-name, .polygon-group-select', (els) => els.every((e) => parseFloat(getComputedStyle(e).fontSize) >= 16))).toBe(true);
  await page.tap('#sidebar-close');
  await expect(page.locator('#sidebar')).not.toHaveClass(/active/);
});

test('example session and PDF export from a phone', async ({ page }, testInfo) => {
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
  await openApp(page);
  await page.tap('#mobile-menu-toggle');
  await page.tap('#open-examples');
  await page.tap('[data-example-id="farm"]');
  await expect(page.locator('.polygon-card')).toHaveCount(6);
  await expect(page.locator('#sidebar')).not.toHaveClass(/active/);
  expect(await polygonsOnMap(page)).toBe(6);
  expect(dialogs).toHaveLength(0);

  await openDrawer(page);
  await openSettings(page, 'export');
  await page.tap('#export-pdf');
  await expect(page.locator('#export-modal')).toBeVisible();
  await expect(page.locator('#export-rename-list .export-rename-row')).toHaveCount(6);
  const heights = await page.$$eval('.modal-footer .btn', (els) => els.map((e) => e.getBoundingClientRect().height));
  expect(heights.every((h) => h >= 44 && h < 52)).toBe(true);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.tap('#export-run-pdf')]);
  const pdf = await saveDownload(dl, testInfo.outputPath('downloads'));
  expect(pdf.bytes.subarray(0, 4).toString()).toBe('%PDF');
  expect(pdf.bytes.length).toBeGreaterThan(50_000);
  expect(pdfPageCount(pdf.bytes)).toBeGreaterThanOrEqual(1);
});

test('touch vertex editing: drag, long-press delete, midpoint tap', async ({ page, context }) => {
  page.on('dialog', (d) => d.accept());
  await openApp(page);
  await page.tap('#mobile-menu-toggle');
  await page.tap('#open-examples');
  await page.tap('[data-example-id="farm"]');
  await expect(page.locator('.polygon-card')).toHaveCount(6);
  await openDrawer(page);
  await openSettings(page, 'edit');
  await page.selectOption('#polygon-select', { index: 1 });
  await page.waitForTimeout(800);
  await expect(page.locator('#sidebar')).not.toHaveClass(/active/);
  await page.tap('.leaflet-control-zoom-in'); await page.waitForTimeout(500);
  await page.tap('.leaflet-control-zoom-in'); await page.waitForTimeout(900);

  const handles = page.locator('#map .vertex-marker');
  const n0 = await handles.count();
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const hull = () => page.evaluate(() => JSON.parse(localStorage.getItem('pathmap_session_v2')).polygons[0].hull.map((v) => `${v.lat},${v.lon}`).join('|'));

  const a = await pickHandle(page, '#map .vertex-marker');
  expect(a).not.toBeNull();
  const before = await hull();
  await touch('touchStart', a.x, a.y);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', a.x + i * 8, a.y + i * 6); await page.waitForTimeout(20); }
  await touch('touchEnd', a.x + 64, a.y + 48);
  await page.waitForTimeout(400);
  expect(await hull()).toBe(before); // Draft is not auto-saved before Apply.
  expect(await handles.count()).toBe(n0);

  const b = await pickHandle(page, '#map .vertex-marker');
  expect(b).not.toBeNull();
  await touch('touchStart', b.x, b.y); await page.waitForTimeout(900); await touch('touchEnd', b.x, b.y);
  await expect(handles).toHaveCount(n0 - 1);
  await page.waitForTimeout(1200);

  const mid = await pickHandle(page, '#map .midpoint-marker');
  expect(mid).not.toBeNull();
  await page.touchscreen.tap(mid.x, mid.y);
  await page.waitForTimeout(400);
  if ((await handles.count()) === n0 - 1) {
    // Chrome swallows the first tap after a long-press (context-menu dismissal)
    await page.touchscreen.tap(mid.x, mid.y);
  }
  await expect(handles).toHaveCount(n0);
  await page.tap('#map-draft-apply');
  expect(await hull()).not.toBe(before);
});

test("phone example menu and custom label placement close the drawer to reveal the map", async ({
  page,
}) => {
  page.on("dialog", (d) => d.accept());
  await openApp(page);
  await openDrawer(page);
  await page.tap("#open-examples");
  await expect(page.locator(".example-card")).toHaveCount(9);
  await page.tap('[data-example-id="winding"]');
  await expect(page.locator("#sidebar")).not.toHaveClass(/active/);
  await page.tap("#new-label-tool");
  await expect(page.locator("#sidebar")).toHaveClass(/active/);
  await page.fill("#new-label-text", "Gate · phone");
  await page.tap("#add-custom-label");
  await expect(page.locator("#sidebar")).not.toHaveClass(/active/);
  await page.touchscreen.tap(100, 650);
  await expect(page.locator(".custom-label-content")).toHaveText(
    "Gate · phone",
  );
  await page.reload();
  await expect(page.locator(".custom-label-content")).toHaveText(
    "Gate · phone",
  );
});

test('phone editing leaves map room and notes formatting has reachable preview actions', async ({page}) => {
  await openApp(page);
  await openDrawer(page);
  await page.tap('#open-examples');
  await page.tap('[data-example-id="winding"]');
  await openDrawer(page);
  await page.tap('#example-try');
  const toolbar = await page.locator('#editor-toolbar').boundingBox();
  expect(toolbar.height).toBeLessThan(155);
  await expect(page.locator('#map-draft-apply')).toBeVisible();
  await expect(page.locator('#vertex-help')).toBeVisible();
  expect((await page.locator('.polygon-name-content').first().boundingBox()).width).toBeLessThanOrEqual(180);
  await expect(page.locator('.area-tooltip')).toBeHidden();
  await page.tap('#map-draft-cancel');
  await page.tap('#editor-export');
  await page.locator('#export-notes-rich').fill('Phone survey notes');
  await page.locator('#export-notes-rich').evaluate(el => {
    const range=document.createRange();range.selectNodeContents(el);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  });
  await page.getByRole('button',{name:'Bold',exact:true}).tap();
  await expect(page.locator('#notes-preview strong')).toHaveText('Phone survey notes');
  const preview = await page.locator('#export-preview-button').boundingBox();
  const height=await page.evaluate(()=>innerHeight);
  expect(preview.y + preview.height).toBeLessThanOrEqual(height);
  await page.tap('#export-preview-button');
  await expect(page.locator('#export-preview-image')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
