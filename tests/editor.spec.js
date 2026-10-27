import { test, expect } from "@playwright/test";
import {
  openApp,
  uploadGpx,
  openSettingsTab,
  storedSession,
  BASE_PATH,
  pickHandle,
  saveDownload,
} from "./helpers.js";
const selectFirst = async (page) => {
  await page.locator(".edit-polygon").first().click();
  await expect(page.locator("#map-draft-apply")).toBeVisible();
};
const drag = async (page, selector, dx, dy) => {
  const r = await page.locator(selector).first().boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy, {
    steps: 10,
  });
  await page.mouse.up();
};
test("path fidelity retains actual meanders, has an explicit draft and persists through undo/reload/session file", async ({
  page,
}, info) => {
  await openApp(page);
  await uploadGpx(page, ["winding.gpx"]);
  const initial = await storedSession(page);
  await selectFirst(page);
  await page.check("#follow-path");
  await expect(page.locator(".vertex-marker")).toHaveCount(8);
  expect((await storedSession(page)).polygons[0].hull.length).toBe(4);
  await page.click("#map-draft-apply");
  let applied = await storedSession(page);
  expect(applied.polygons[0].hull.length).toBe(8);
  expect(applied.polygons[0].boundary.follow).toBe(true);
  expect(applied.polygons[0].tracks).toEqual(initial.polygons[0].tracks);
  await page.click("#editor-undo");
  expect((await storedSession(page)).polygons[0].hull.length).toBe(4);
  await page.click("#editor-redo");
  expect((await storedSession(page)).polygons[0].hull.length).toBe(8);
  await page.reload();
  expect((await storedSession(page)).polygons[0].boundary.follow).toBe(true);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#download-session"),
  ]);
  const file = await saveDownload(download, info.outputPath("session"));
  expect(JSON.parse(file.bytes.toString()).data.polygons[0].hull.length).toBe(
    8,
  );
  await page.setInputFiles("#session-file-input", file.file);
  expect((await storedSession(page)).polygons[0].hull.length).toBe(8);
});
test("draft cancellation and invalid path connections leave committed data unchanged", async ({
  page,
}) => {
  await openApp(page);
  await uploadGpx(page, ["plot-a.gpx"]);
  const before = (await storedSession(page)).polygons;
  await selectFirst(page);
  await page.click("#follow-path");
  await expect(page.locator("#draft-info")).toContainText(
    /gap|cross|collapsed/i,
  );
  expect((await storedSession(page)).polygons).toEqual(before);
  await page.click("#exit-edit-mode");
  expect((await storedSession(page)).polygons).toEqual(before);
  await expect(page.locator(".vertex-marker")).toHaveCount(0);
});
test("polygon names, coordinate labels and map key support persistent placement and undo", async ({
  page,
}) => {
  await openApp(page);
  await uploadGpx(page, ["winding.gpx"]);
  await openSettingsTab(page, "display");
  await page.check("#toggle-labels");
  await openSettingsTab(page, "labels");
  await page.selectOption("#legend-placement", "map");
  await page.click("#place-labels");
  await drag(page, ".polygon-name-label", 50, 35);
  let s = await storedSession(page);
  expect(Object.keys(s.annotations.names)).toHaveLength(1);
  await drag(page, ".vertex-label", 40, 25);
  s = await storedSession(page);
  expect(Object.keys(s.annotations.coordinates).length).toBeGreaterThan(0);
  const name = s.annotations.names;
  const keyBefore = s.layout.legend;
  await drag(page, "#map-key", -70, -60);
  const moved = await storedSession(page);
  expect(moved.layout.legend.x).not.toBe(keyBefore.x);
  await page.click("#editor-undo");
  expect((await storedSession(page)).layout.legend).toEqual(keyBefore);
  await page.click("#editor-redo");
  await page.reload();
  const reloaded = await storedSession(page);
  expect(reloaded.annotations.names).toEqual(name);
  expect(reloaded.annotations.coordinates).toEqual(s.annotations.coordinates);
  expect(reloaded.layout.legend).toEqual(moved.layout.legend);
  await expect(page.locator("#map-key")).toBeVisible();
});
const sharedFixture = () => {
  const v = (x, y) => ({ lat: 12.79 + y * 0.001, lon: 79.67 + x * 0.001 });
  return {
    polygons: [
      {
        id: 1,
        name: "Orchard",
        color: "#ff6600",
        tracks: [],
        hull: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)],
      },
      {
        id: 2,
        name: "Sugarcane",
        color: "#44cccc",
        tracks: [],
        hull: [v(1, 0), v(2, 0), v(2, 1), v(1, 1)],
      },
    ],
    groups: [],
    mapState: { center: { lat: 12.7905, lon: 79.671 }, zoom: 18 },
  };
};
test("shared edge insertion/push changes both owners, preserves outer endpoints and undoes atomically", async ({
  page,
}) => {
  await openApp(page, {
    seedStorage: { pathmap_session_v2: JSON.stringify(sharedFixture()) },
  });
  await selectFirst(page);
  await page
    .locator("summary")
    .filter({ hasText: "Shared boundaries" })
    .click();
  await page.click("#join-edge");
  await expect(page.locator("#draft-info")).toContainText("joined");
  // Right vertical edge of Orchard is the shared edge; midpoint order follows ring order.
  const mid = page.locator(".midpoint-marker").nth(1);
  await mid.click();
  await expect(page.locator(".vertex-marker")).toHaveCount(5);
  const vertex = page.getByRole("button", { name: /^Boundary vertex 3;/ });
  await expect(vertex).toHaveAttribute("aria-label", /Boundary vertex 3;/);
  await vertex.focus();
  await vertex.press("ArrowRight");
  const neighbor = page.locator('path.boundary-polygon[data-polygon-id="2"]');
  const beforePreview = await neighbor.getAttribute("d");
  const location = await vertex.boundingBox();
  await page.mouse.move(
    location.x + location.width / 2,
    location.y + location.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    location.x + location.width / 2 + 20,
    location.y + location.height / 2,
    { steps: 8 },
  );
  expect(await neighbor.getAttribute("d")).not.toBe(beforePreview);
  expect((await storedSession(page)).polygons[1].hull.length).toBe(4);
  await page.mouse.up();
  await page.click("#map-draft-apply");
  const pushed = await storedSession(page);
  expect(pushed.noOverlap).toBe(true);
  expect(pushed.polygons.map((p) => p.hull.length)).toEqual([5, 5]);
  const shared = pushed.polygons[0].hull[2];
  expect(pushed.polygons[1].hull.find((v) => v.id === shared.id)).toEqual(
    shared,
  );
  expect(pushed.polygons[0].hull[1].lat).toBe(12.79);
  await page.click("#editor-undo");
  expect(
    (await storedSession(page)).polygons.map((p) => p.hull.length),
  ).toEqual([4, 4]);
  await page.click("#editor-redo");
  expect((await storedSession(page)).polygons).toEqual(pushed.polygons);
  await page.reload();
  expect((await storedSession(page)).polygons).toEqual(pushed.polygons);
});
test("whole-page grayscale preview and PNG are monochrome; export restores editing colors", async ({
  page,
}, info) => {
  await openApp(page);
  await uploadGpx(page, ["winding.gpx", "plot-b.gpx"]);
  const colors = (await storedSession(page)).polygons.map((p) => p.color);
  await openSettingsTab(page, "export");
  await page.click("#export-png");
  await page.fill("#export-title", "Grayscale survey");
  await page.selectOption("#export-appearance", "grayscale");
  await page.click("#export-preview-button");
  await expect(page.locator("#export-preview-image")).toBeVisible({
    timeout: 45000,
  });
  const inspect = await page
    .locator("#export-preview-image")
    .evaluate(async (img) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let colored = 0,
        dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== d[i + 1] || d[i] !== d[i + 2]) colored++;
        if (d[i] < 100) dark++;
      }
      return { colored, dark, w: c.width, h: c.height };
    });
  expect(inspect.colored).toBe(0);
  expect(inspect.dark).toBeGreaterThan(1000);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#export-run-png"),
  ]);
  const file = await saveDownload(download, info.outputPath("grayscale"));
  const data = "data:image/png;base64," + file.bytes.toString("base64");
  expect(
    await page.evaluate(async (src) => {
      const i = new Image();
      i.src = src;
      await i.decode();
      const c = document.createElement("canvas");
      c.width = i.width;
      c.height = i.height;
      const x = c.getContext("2d");
      x.drawImage(i, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      return d.every((v, n) => n % 4 > 1 || v === d[n - (n % 4) + 2]);
    }, data),
  ).toBe(true);
  expect((await storedSession(page)).polygons.map((p) => p.color)).toEqual(
    colors,
  );
  expect(await page.locator("#map").getAttribute("class")).not.toContain(
    "export-mono",
  );
});
test("local path following replaces only the selected boundary section and supports vertex pinning", async ({
  page,
}) => {
  await openApp(page);
  await uploadGpx(page, ["winding.gpx"]);
  const original = await storedSession(page);
  await selectFirst(page);
  await page.fill("#source-start", "2");
  await page.fill("#source-end", "7");
  await page.fill("#replace-from", "3");
  await page.fill("#replace-to", "4");
  await page.click("#path-local");
  await expect(page.locator(".vertex-marker")).toHaveCount(8);
  await page.locator(".vertex-marker").nth(4).focus();
  await page.locator(".vertex-marker").nth(4).press("ArrowRight");
  await page.click("#vertex-pin");
  await expect(page.locator("#vertex-pin")).toHaveText("Unpin vertex");
  await page.click("#map-draft-apply");
  const saved = await storedSession(page);
  expect(saved.polygons[0].hull.slice(0, 2).map((v) => [v.lat, v.lon])).toEqual(
    original.polygons[0].hull.slice(0, 2).map((v) => [v.lat, v.lon]),
  );
  expect(saved.polygons[0].hull.some((v) => v.pinned)).toBe(true);
  expect(saved.polygons[0].tracks).toEqual(original.polygons[0].tracks);
});
test("GPX segment breaks remain explicit and an unrelated walk can be excluded", async ({
  page,
}) => {
  await openApp(page);
  await uploadGpx(page, ["disconnected.gpx"]);
  const before = await storedSession(page);
  expect(before.polygons[0].tracks[0].segments).toHaveLength(2);
  await selectFirst(page);
  await page.click("#follow-path");
  await expect(page.locator("#draft-info")).toContainText("gap");
  await expect(page.locator(".gap-label").first()).toBeVisible();
  await page.selectOption("#source-order", "1");
  await page.uncheck("#source-include");
  await page.check("#follow-path");
  await expect(page.locator(".vertex-marker")).toHaveCount(8);
  await page.click("#map-draft-apply");
  const after = await storedSession(page);
  expect(after.polygons[0].tracks).toEqual(before.polygons[0].tracks);
  expect(after.polygons[0].boundary.sections[1].include).toBe(false);
});
test("a locked shared neighbor rejects changes and a cancelled pointer drag restores its handle", async ({
  page,
}) => {
  await openApp(page, {
    seedStorage: { pathmap_session_v2: JSON.stringify(sharedFixture()) },
  });
  await selectFirst(page);
  await page
    .locator("summary")
    .filter({ hasText: "Shared boundaries" })
    .click();
  await page.click("#join-edge");
  await page.click("#map-draft-apply");
  await page.locator(".edit-polygon").nth(1).click();
  await page.check("#polygon-locked");
  await page.click("#map-draft-apply");
  const original = await storedSession(page);
  await selectFirst(page);
  await page.locator(".midpoint-marker").nth(1).click();
  await expect(page.locator("#draft-info")).toContainText("locked");
  await expect(page.locator(".vertex-marker")).toHaveCount(4);
  const handle = await pickHandle(page, ".vertex-marker");
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 35, handle.y + 25, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.click("#map-draft-cancel");
  expect((await storedSession(page)).polygons).toEqual(original.polygons);
});
test("an invalid import leaves the current committed survey intact", async ({
  page,
}) => {
  page.on("dialog", (d) => d.accept());
  await openApp(page);
  await uploadGpx(page, ["winding.gpx"]);
  const before = await storedSession(page);
  await page.setInputFiles("#session-file-input", {
    name: "broken.pathmap",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        polygons: [
          { id: 1, name: "Broken", color: "red", tracks: [], hull: [] },
        ],
      }),
    ),
  });
  expect((await storedSession(page)).polygons).toEqual(before.polygons);
  await expect(page.locator(".polygon-name")).toHaveValue(
    "Winding orchard boundary",
  );
});
for (const broken of [
  "{broken JSON",
  JSON.stringify({
    polygons: [{ id: 1, name: "Invalid", color: "bad", tracks: [], hull: [] }],
  }),
]) {
  test(`unreadable ${typeof broken === "string" && broken.startsWith("{broken") ? "JSON" : "session"} stays untouched while autosave is paused`, async ({
    page,
  }) => {
    page.on("dialog", (d) => d.accept());
    await openApp(page, { seedStorage: { pathmap_session_v2: broken } });
    await uploadGpx(page, ["winding.gpx"]);
    expect(await page.evaluate(() => localStorage.pathmap_session_v2)).toBe(
      broken,
    );
    await expect(page.locator("#editor-status")).toContainText(
      "Autosave paused",
    );
  });
}
test("grayscale PDF embeds a monochrome page and export names never overwrite the legend heading", async ({
  page,
}, info) => {
  await openApp(page);
  await uploadGpx(page, ["winding.gpx"]);
  await openSettingsTab(page, "labels");
  await page.selectOption("#legend-placement", "map");
  await page.click("#editor-export");
  await page.selectOption("#export-appearance", "grayscale");
  await page.evaluate(() => {
    window.keyHeadings = [];
    new MutationObserver(() =>
      window.keyHeadings.push(
        document.querySelector("#map-key strong").textContent,
      ),
    ).observe(document.getElementById("map-key"), {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#export-run-pdf"),
  ]);
  const saved = await saveDownload(download, info.outputPath("pdf"));
  expect(
    await page.evaluate(() =>
      window.keyHeadings.every((s) => !s.includes("Winding")),
    ),
  ).toBe(true);
  const start = saved.bytes.indexOf(Buffer.from([255, 216, 255])),
    end = saved.bytes.indexOf(Buffer.from([255, 217]), start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const jpeg =
    "data:image/jpeg;base64," +
    saved.bytes.subarray(start, end + 2).toString("base64");
  const maximum = await page.evaluate(async (src) => {
    const i = new Image();
    i.src = src;
    await i.decode();
    const c = document.createElement("canvas");
    c.width = i.width;
    c.height = i.height;
    const x = c.getContext("2d");
    x.drawImage(i, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let diff = 0;
    for (let j = 0; j < d.length; j += 4)
      diff = Math.max(
        diff,
        Math.abs(d[j] - d[j + 1]),
        Math.abs(d[j] - d[j + 2]),
      );
    return diff;
  }, jpeg);
  expect(maximum).toBeLessThanOrEqual(1);
});
test("a failed grayscale capture restores names, fills and controls without changing the session", async ({
  page,
}) => {
  page.on("dialog", (d) => d.accept());
  await openApp(page);
  await uploadGpx(page, ["winding.gpx"]);
  const original = (await storedSession(page)).polygons;
  await page.click("#editor-export");
  await page.locator("#export-rename-list input").fill("Export-only alias");
  await page.selectOption("#export-appearance", "grayscale");
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toDataURL = function () {
      throw Error("Simulated capture failure");
    };
  });
  await page.click("#export-preview-button");
  await expect(page.locator("#export-modal .modal")).not.toHaveClass(/is-busy/);
  await expect(page.locator("#map")).not.toHaveClass(
    /export-mono|export-capturing/,
  );
  await expect(page.locator("#map .polygon-name-content")).toHaveText(
    "Winding orchard boundary",
  );
  expect((await storedSession(page)).polygons).toEqual(original);
  expect(await page.locator('#map pattern[id^="export-pattern"]').count()).toBe(
    0,
  );
});
test("example menu loads every edge case with a guide and can cancel replacement", async ({
  page,
}) => {
  const ids = [
    "farm",
    "winding",
    "disconnected",
    "invalid",
    "shared",
    "locked",
    "collision",
    "labels",
    "grayscale",
  ];
  let accept = true,
    confirmations = 0;
  page.on("dialog", async (d) => {
    if (d.type() === "confirm") {
      confirmations++;
      accept ? await d.accept() : await d.dismiss();
    } else await d.accept();
  });
  await openApp(page);
  await page.click("#open-examples");
  await expect(page.locator(".example-card")).toHaveCount(9);
  await page.keyboard.press("Escape");
  await expect(page.locator("#examples-modal")).toBeHidden();
  await expect(page.locator("#open-examples")).toBeFocused();
  for (const id of ids) {
    await page.click("#open-examples");
    await page.click(`[data-example-id="${id}"]`);
    await expect(page.locator("#examples-modal")).toBeHidden();
    await expect(page.locator("#example-guide")).toBeVisible();
    const s = await storedSession(page);
    expect(s.exampleId).toBe(id);
    if (["shared", "locked", "collision"].includes(id))
      expect(s.noOverlap).toBe(true);
    if (id === "locked") expect(s.polygons[1].locked).toBe(true);
    if (id === "grayscale") expect(s.exportPrefs.appearance).toBe("grayscale");
  }
  expect(confirmations).toBe(8);
  const before = (await storedSession(page)).polygons;
  accept = false;
  await page.click("#open-examples");
  await page.click('[data-example-id="winding"]');
  await expect(page.locator("#examples-modal")).toBeVisible();
  expect((await storedSession(page)).exampleId).toBe("grayscale");
  expect((await storedSession(page)).polygons).toEqual(before);
  await page.click("#examples-close");
});
test("editing labels starts from the visible spread layout and keeps untouched labels still", async ({
  page,
}) => {
  await openApp(page);
  await page.locator(".empty-state button").click();
  await page.waitForFunction(
    () => {
      const value = [...document.querySelectorAll(".vertex-label")]
        .map((e) => e.style.transform)
        .join("|");
      if (window.labelPose === value)
        window.labelStable = (window.labelStable || 0) + 1;
      else {
        window.labelPose = value;
        window.labelStable = 0;
      }
      return window.labelStable >= 5;
    },
    null,
    { polling: 100 },
  );
  const positions = () =>
    page.locator("[data-placement-key]").evaluateAll((es) =>
      es
        .map((e) => {
          const r = e.getBoundingClientRect();
          return {
            id: e.dataset.placementKind + "-" + e.dataset.placementKey,
            x: r.x,
            y: r.y,
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  const before = await positions();
  expect(before.length).toBeGreaterThan(10);
  await page
    .getByRole("button", { name: "Edit labels and key", exact: true })
    .click();
  const after = await positions();
  expect(after).toEqual(before);
  await drag(page, ".vertex-label", 25, 15);
  const changed = await positions();
  const stationary = changed.filter(
    (p, i) => p.x === after[i].x && p.y === after[i].y,
  );
  expect(stationary.length).toBeGreaterThan(before.length - 3);
});
test("custom text labels support placement, safe text, rename, move, undo, save/load and deletion", async ({
  page,
}, info) => {
  page.on("dialog", (d) => d.accept());
  await openApp(page);
  await uploadGpx(page, ["winding.gpx"]);
  await page.click("#new-label-tool");
  await page.fill("#new-label-text", "Gate <b>A</b>");
  await page.click("#add-custom-label");
  const map = await page.locator("#map").boundingBox();
  await page.mouse.click(map.x + 110, map.y + map.height - 130);
  await expect(page.locator(".custom-map-label")).toHaveCount(1);
  expect(await page.locator(".custom-map-label b").count()).toBe(0);
  const initial = (await storedSession(page)).annotations.custom[0];
  expect(initial.text).toBe("Gate <b>A</b>");
  await drag(page, ".custom-map-label", 40, -30);
  const moved = (await storedSession(page)).annotations.custom[0];
  expect(moved.lat).not.toBe(initial.lat);
  await page.locator("#custom-label-list input").fill("Main gate");
  await page.locator("#custom-label-list input").press("Tab");
  await expect(page.locator(".custom-label-content")).toHaveText("Main gate");
  await page.click("#reset-placement");
  expect((await storedSession(page)).annotations.custom).toHaveLength(1);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#download-session"),
  ]);
  const file = await saveDownload(download, info.outputPath("custom-session"));
  expect(
    JSON.parse(file.bytes.toString()).data.annotations.custom[0].text,
  ).toBe("Main gate");
  await page.reload();
  await expect(page.locator(".custom-label-content")).toHaveText("Main gate");
  expect((await storedSession(page)).annotations.custom[0].lat).toBe(moved.lat);
  await page.click("#place-labels");
  await openSettingsTab(page, "labels");
  await page.locator("[data-delete-label]").click();
  await expect(page.locator(".custom-map-label")).toHaveCount(0);
  await page.click("#editor-undo");
  await expect(page.locator(".custom-label-content")).toHaveText("Main gate");
  await page.setInputFiles("#session-file-input", file.file);
  await expect(page.locator(".custom-label-content")).toHaveText("Main gate");
});
test("new-label placement can be cancelled without creating an annotation", async ({
  page,
}) => {
  await openApp(page);
  await page.click("#new-label-tool");
  await page.fill("#new-label-text", "Cancelled note");
  await page.click("#add-custom-label");
  await page.keyboard.press("Escape");
  await expect(page.locator(".map-container")).not.toHaveClass(
    /adding-custom-label/,
  );
  await expect(page.locator(".custom-map-label")).toHaveCount(0);
});
test("notes without polygons are protected by example replacement confirmation and Clear All supports undo", async ({
  page,
}) => {
  let accept = false,
    asked = 0;
  page.on("dialog", async (d) => {
    asked++;
    accept ? await d.accept() : await d.dismiss();
  });
  await openApp(page);
  await page.click("#new-label-tool");
  await page.fill("#new-label-text", "Unattached note");
  await page.click("#add-custom-label");
  const r = await page.locator("#map").boundingBox();
  await page.mouse.click(r.x + 150, r.y + 350);
  await page.click("#open-examples");
  await page.click('[data-example-id="farm"]');
  expect(asked).toBe(1);
  expect((await storedSession(page)).polygons).toHaveLength(0);
  await expect(page.locator(".custom-label-content")).toHaveText(
    "Unattached note",
  );
  await page.click("#examples-close");
  accept = true;
  await page.click("#clear-all");
  await expect(page.locator(".custom-map-label")).toHaveCount(0);
  expect((await storedSession(page)).annotations.custom).toHaveLength(0);
  await page.click("#editor-undo");
  await expect(page.locator(".custom-label-content")).toHaveText(
    "Unattached note",
  );
});
