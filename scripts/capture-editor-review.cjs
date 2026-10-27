// Run against an existing local preview. Always uses fresh browser contexts.
const { chromium, devices } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "review-artifacts");
const url = process.env.PATHMAP_REVIEW_URL || "http://127.0.0.1:4187/pathmap/";
const options = process.env.PATHMAP_CHROMIUM
  ? { executablePath: process.env.PATHMAP_CHROMIUM }
  : {};
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...options });
  const errors = [];
  const attach = (page) => {
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
  };
  const snap = (page, name) =>
    page.screenshot({ path: path.join(output, name + ".png"), animations: "disabled" });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    attach(page);
    await page.goto(url);
    await page.click("#open-examples");
    await snap(page, "examples-menu");
    await page.click("#examples-close");
    await page.setInputFiles(
      "#upload-zone-input",
      path.join(root, "tests/fixtures/winding.gpx"),
    );
    await page.waitForSelector(".polygon-card");
    if (await page.locator("#upload-section").isVisible()) await page.click("#toggle-upload-section");
    await page.locator(".edit-polygon").first().click();
    await snap(page, "boundary-draft");
    await page.check("#follow-path");
    await snap(page, "path-following");
    await page.click("#map-draft-apply");
    await page.click("#place-labels");
    await page.click('[data-tab="labels"]');
    await page.selectOption("#legend-placement", "map");
    await page.click("#new-label-tool");
    await page.fill("#new-label-text", "Access gate");
    await page.click("#add-custom-label");
    const mapBounds = await page.locator("#map").boundingBox();
    await page.mouse.click(
      mapBounds.x + mapBounds.width * 0.75,
      mapBounds.y + mapBounds.height * 0.7,
    );
    await snap(page, "placement");
    await page.click("#editor-export");
    await page.fill("#export-title", "Orchard boundary · Kanchipuram");
    await page.locator("#export-notes-rich").fill("Survey overview\nFollow the orchard bend. Keep the access gate clear.");
    await snap(page, "notes-editor");
    await page.selectOption("#export-appearance", "grayscale");
    await page.click("#export-preview-button");
    await page.locator("#export-preview-image").waitFor({ state: "visible" });
    const data = await page
      .locator("#export-preview-image")
      .getAttribute("src");
    fs.writeFileSync(
      path.join(output, "grayscale-page.png"),
      Buffer.from(data.split(",")[1], "base64"),
    );
    await snap(page, "grayscale-dialog");
    const download = page.waitForEvent("download");
    await page.click("#export-run-pdf");
    await (await download).saveAs(path.join(output, "grayscale.pdf"));
    await context.close();

    const shared = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const v = (x, y) => ({ lat: 12.79 + y * 0.001, lon: 79.67 + x * 0.001 });
    await shared.addInitScript(
      (seed) =>
        localStorage.setItem("pathmap_session_v2", JSON.stringify(seed)),
      {
        polygons: [
          {
            id: 1,
            name: "Orchard",
            color: "#ff6b6b",
            tracks: [],
            hull: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)],
          },
          {
            id: 2,
            name: "Sugarcane",
            color: "#4ecdc4",
            tracks: [],
            hull: [v(1, 0), v(2, 0), v(2, 1), v(1, 1)],
          },
        ],
        groups: [],
        mapState: { center: { lat: 12.7905, lon: 79.671 }, zoom: 18 },
      },
    );
    const second = await shared.newPage();
    attach(second);
    await second.goto(url);
    if (await second.locator("#upload-section").isVisible()) await second.click("#toggle-upload-section");
    await second.locator(".edit-polygon").first().click();
    await second
      .locator("summary")
      .filter({ hasText: "Shared boundaries" })
      .click();
    await second.click("#join-edge");
    await second.locator(".midpoint-marker").nth(1).click();
    const handle = second.getByRole("button", { name: /^Boundary vertex 3;/ });
    await handle.focus();
    for (let i = 0; i < 3; i++) await handle.press("Shift+ArrowRight");
    await snap(second, "shared-edge-push");
    await second.click("#map-draft-cancel");
    await second.click("#open-examples");
    await second.click('[data-example-id="disconnected"]');
    if (!await second.locator("#settings-container").isVisible()) await second.click("#toggle-settings-panel");
    await second.click('[data-tab="display"]');
    await second.check("#tracks-only");
    await snap(second,"tracks-only");
    await shared.close();

    const mobile = await browser.newContext({ ...devices["iPhone 13"] });
    const phone = await mobile.newPage();
    attach(phone);
    await phone.goto(url);
    await phone.click("#mobile-menu-toggle");
    await phone.setInputFiles(
      "#upload-zone-input",
      path.join(root, "tests/fixtures/winding.gpx"),
    );
    await phone.click("#mobile-menu-toggle");
    await phone.locator(".edit-polygon").first().click();
    await snap(phone, "mobile-editor");
    await phone.click("#map-draft-cancel");
    await phone.click("#editor-export");
    await phone.locator("#export-notes-rich").fill("Survey notes for the orchard");
    await snap(phone,"mobile-notes");
    await mobile.close();
    fs.writeFileSync(
      path.join(output, "validation.json"),
      JSON.stringify(
        {
          url,
          errors,
          fixtures:
            "Synthetic winding GPX and adjacent polygons; actual Esri map context",
        },
        null,
        2,
      ),
    );
    if (errors.length) throw Error(errors.join("\n"));
    const images = [
      "examples-menu",
      "boundary-draft",
      "path-following",
      "placement",
      "notes-editor",
      "tracks-only",
      "shared-edge-push",
      "grayscale-page",
      "mobile-editor",
      "mobile-notes",
    ];
    fs.writeFileSync(
      path.join(output, "index.html"),
      '<!doctype html><meta charset="utf-8"><title>PathMap implementation review</title><style>body{max-width:1200px;margin:35px auto;font:16px system-ui;color:#2c3e50}img{width:100%;border:1px solid #ccc}a{color:#247fc0}figure{margin:30px 0}figcaption{margin:10px 0}</style><h1>PathMap · implementation review</h1><p>Actual running editor; synthetic survey fixtures on Esri imagery. See docs/EDITOR.md for behavior and tests.</p><a href="grayscale.pdf">Grayscale PDF</a>' +
        images
          .map(
            (n) =>
              `<figure><figcaption>${n}</figcaption><a href="${n}.png"><img loading="lazy" src="${n}.png"></a></figure>`,
          )
          .join(""),
    );
    console.log("Review artifacts: " + output);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
