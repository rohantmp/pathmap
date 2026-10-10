import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

export const BASE_PATH = process.env.PATHMAP_BASE || '/pathmap/';
const here = path.dirname(fileURLToPath(import.meta.url));
export const fixture = (name) => path.join(here, 'fixtures', name);

/** Open the app with a clean localStorage and wait for the first map tile. */
export async function openApp(page, { seedStorage } = {}) {
  await page.addInitScript((seed) => {
    if (seed) {
      Object.entries(seed).forEach(([k, v]) => localStorage.setItem(k, v));
    }
  }, seedStorage || null);
  await page.goto(BASE_PATH, { waitUntil: 'load' });
  await page.waitForSelector('#map .leaflet-tile-loaded', { timeout: 30_000 }).catch(() => {});
}

/** Upload GPX fixtures through the drop-zone file input and wait for the cards. */
export async function uploadGpx(page, names) {
  await page.setInputFiles('#upload-zone-input', names.map(fixture));
  await expect(page.locator('.polygon-card').first()).toBeVisible();
  await page.waitForTimeout(600); // hull + label simulation settle
}

export const polygonsOnMap = (page) =>
  page.$$eval('#map .leaflet-overlay-pane path.leaflet-interactive', (els) =>
    els.filter((e) => e.getAttribute('stroke') !== '#ff6600').length);

export async function openSettingsTab(page, tab) {
  const hidden = await page.$eval('#settings-container', (el) => el.style.display === 'none');
  if (hidden) await page.click('#toggle-settings-panel');
  await page.click(`.tab-button[data-tab="${tab}"]`);
}

export async function saveDownload(download, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, download.suggestedFilename());
  await download.saveAs(file);
  return { file, bytes: fs.readFileSync(file) };
}

export const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });
export const pdfPageCount = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

/** Session as the app stored it (v2 key). */
export const storedSession = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('pathmap_session_v2') || 'null'));

/** Centre of the first handle matching `selector` that is on screen and not covered by anything else. */
export const pickHandle = (page, selector) => page.$$eval(selector, (els) => {
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (x > 12 && y > 12 && x < window.innerWidth - 12 && y < window.innerHeight - 12 && document.elementFromPoint(x, y) === el) return { x, y };
  }
  return null;
});
