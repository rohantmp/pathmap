import { defineConfig, devices } from '@playwright/test';

// The suite runs against a built single-file app served by scripts/serve-static.js.
//   npm test                      builds HEAD into dist/ and tests it at /pathmap/
//   npm run test:v2               tests dist-dual/v2 at /pathmap/v2/ (after npm run build:dual)
// PATHMAP_DIST and PATHMAP_BASE override the served directory and the path under test.
const PORT = 4199;
const BASE_PATH = process.env.PATHMAP_BASE || '/pathmap/';
const DIST = process.env.PATHMAP_DIST || 'dist';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  // Exposed to the specs
  metadata: { basePath: BASE_PATH },
  projects: [
    { name: 'desktop', testMatch: /desktop\.spec\.js/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', testMatch: /mobile\.spec\.js/, use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    // A plain static server with directory-index semantics (like GitHub Pages); vite preview
    // falls back to the root index.html for /pathmap/v2/ and cannot serve the dual build.
    command: `node scripts/serve-static.js ${DIST} ${PORT} 127.0.0.1 /pathmap/`,
    url: `http://127.0.0.1:${PORT}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
