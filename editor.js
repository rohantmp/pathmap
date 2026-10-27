import L from "leaflet";
import {
  clone,
  uid,
  followPath,
  simplifyOrdered,
  validateRing,
  validateCoverage,
  joinSharedEdge,
  updateSharedRing,
  distance,
} from "./geometry.js";
import { History } from "./editor-state.js";
const el = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export class Editor {
  constructor({ map, getState, replace, save, render }) {
    Object.assign(this, { map, getState, replace, save, render });
    this.history = new History(getState());
    this.selected = null;
    this.draft = null;
    this.placing = false;
    this.previewLayers = [];
    el("edit-tab").innerHTML =
      `<p class="export-hint">Select a polygon on the map or below. Changes stay in a draft until Apply.</p><select id="polygon-select" class="polygon-select" aria-label="Polygon to edit"></select>
        <div class="editor-draft-tools"><div class="editor-row"><button id="draft-apply" class="btn btn-primary">Apply boundary</button><button id="exit-edit-mode" class="btn btn-secondary">Cancel draft</button></div>
        <p id="draft-info" role="status"></p><div class="editor-row"><button id="vertex-delete" class="btn btn-secondary">Delete selected</button><button id="vertex-pin" class="btn btn-secondary">Pin vertex</button></div>
        <p class="export-hint">Drag solid handles; tap hollow midpoints to add. Select a handle then use arrows to nudge. Delete removes it; Escape cancels the current drag.</p>
        <details open><summary>Follow actual path</summary><label class="toggle-control"><input id="follow-path" type="checkbox">Follow actual path</label><label for="path-tolerance">Maximum deviation (metres)</label><input id="path-tolerance" type="number" min="0" max="1000" step="0.5" value="0"><p class="export-hint">Smaller values keep more bends. Zero keeps every distinct source point. Pinned vertices survive detail reduction.</p>
        <div id="source-sections"></div><label class="toggle-control"><input id="source-include" type="checkbox" checked>Include selected segment in the full boundary</label><div class="editor-row"><button id="source-up" class="btn btn-secondary">↑ Earlier</button><button id="source-down" class="btn btn-secondary">↓ Later</button><button id="source-reverse" class="btn btn-secondary">Reverse</button></div>
        <div class="editor-row"><label>First source point (index)<input id="source-start" type="number" min="0" value="0"></label><label>Last source point (index)<input id="source-end" type="number" min="1" value="1"></label></div>
        <label class="toggle-control"><input id="review-gaps" type="checkbox">I reviewed and accept the connecting edges across gaps</label><button id="path-preview" class="btn btn-secondary">Preview boundary</button>
        <p class="export-hint">Or replace just one boundary section with the selected source segment:</p><div class="editor-row"><label>From vertex<input id="replace-from" type="number" min="1" value="1"></label><label>To vertex<input id="replace-to" type="number" min="1" value="2"></label></div><div class="editor-row"><button id="section-start" class="btn btn-secondary">Start at selected vertex</button><button id="section-end" class="btn btn-secondary">End at selected vertex</button></div><button id="path-local" class="btn btn-secondary">Follow selected section</button></details>
        <details><summary>Shared boundaries · no overlap</summary><label class="toggle-control"><input id="no-overlap" type="checkbox">Prevent polygon overlap</label><p class="export-hint">Shared handles reshape both owners. Unjoined polygons stop at contact. Hidden polygons also constrain edits.</p><select id="join-neighbor" aria-label="Neighbor polygon"></select><button id="join-edge" class="btn btn-secondary">Join matching edges (within 1 m)</button><p class="export-hint">Align edge endpoints first. Joining previews all affected polygons; no automatic cascading pushes.</p><label class="toggle-control"><input id="polygon-locked" type="checkbox">Lock selected polygon after Apply</label></details></div>`;
    const bar = document.createElement("div");
    bar.id = "editor-toolbar";
    bar.innerHTML = `<button id="editor-undo" class="btn btn-secondary" title="Undo (Ctrl+Z)">↶ Undo</button><button id="editor-redo" class="btn btn-secondary" title="Redo (Ctrl+Shift+Z)">↷ Redo</button><button id="editor-edit" class="btn btn-secondary">Edit boundary</button><button id="place-labels" class="btn btn-secondary" aria-pressed="false">Place labels & key</button><button id="editor-export" class="btn btn-secondary">Export preview</button><span id="editor-status" role="status" aria-live="polite">Select a polygon to edit</span><div id="draft-map-actions" hidden><button id="map-draft-apply" class="btn btn-primary">Apply</button><button id="map-draft-cancel" class="btn btn-secondary">Cancel</button></div>`;
    document.querySelector(".map-container").append(bar);
    const settings = document.createElement("div");
    settings.className = "editor-label-options";
    settings.innerHTML = `<label for="legend-placement">Map key</label><select id="legend-placement"><option value="below">Below map in exports</option><option value="map">On map · drag to place</option></select><button id="reset-placement" class="btn btn-secondary">Reset pinned labels & key</button>`;
    el("labels-tab").prepend(settings);
    this.legend = document.createElement("div");
    this.legend.id = "map-key";
    this.legend.className = "map-key";
    this.legend.tabIndex = 0;
    this.legend.setAttribute(
      "aria-label",
      "Map key; arrow keys move in placement mode",
    );
    el("map").append(this.legend);
    L.DomEvent.disableClickPropagation(this.legend);
    L.DomEvent.disableScrollPropagation(this.legend);
    el("polygon-select").onchange = (e) => {
      if (e.target.value) this.select(+e.target.value);
      else this.cancel();
    };
    el("exit-edit-mode").onclick = () => this.cancel();
    el("draft-apply").onclick = () => this.apply();
    el("map-draft-apply").onclick = () => this.apply();
    el("map-draft-cancel").onclick = () => this.cancel();
    el("editor-undo").onclick = () => this.undo();
    el("editor-redo").onclick = () => this.redo();
    el("editor-edit").onclick = () => {
      if (this.selected) this.select(this.selected);
      else this.openEdit();
    };
    el("editor-export").onclick = () => {
      if (this.leaveDraft()) el("export-png").click();
    };
    el("place-labels").onclick = () => {
      if (!this.leaveDraft()) return;
      this.placing = !this.placing;
      this.map.labelManager.placementMode = this.placing;
      this.map.refreshAllLabels();
      this.update();
    };
    el("vertex-delete").onclick = () => {
      if (this.vertexIndex != null) this.map.deleteVertex(this.vertexIndex);
    };
    el("vertex-pin").onclick = () => this.pinVertex();
    el("path-preview").onclick = () => this.generate();
    el("path-local").onclick = () => this.generate(true);
    el("follow-path").onchange = () => this.generate();
    el("path-tolerance").onchange = () => {
      if (el("follow-path").checked) this.generate();
    };
    el("no-overlap").onchange = (e) =>
      this.attempt(() => {
        const before = clone(this.draft);
        if (e.target.checked) validateCoverage(this.draft.polygons);
        this.draft.noOverlap = e.target.checked;
        this.recordDraft(before);
        this.status(
          e.target.checked
            ? "No-overlap enabled for all polygons, including hidden ones."
            : "No-overlap disabled. Shared edges remain joined.",
        );
      });
    el("polygon-locked").onchange = (e) => {
      if (this.draft) {
        const before = clone(this.draft);
        this.active().locked = e.target.checked;
        this.recordDraft(before);
      }
    };
    el("join-edge").onclick = () =>
      this.attempt(() => {
        const before = clone(this.draft);
        this.draft.polygons = joinSharedEdge(
          this.draft.polygons,
          this.selected,
          +el("join-neighbor").value,
        );
        this.draft.noOverlap = true;
        this.recordDraft(before);
        this.showDraft(true);
        this.status("Shared edges joined in draft. Apply commits both owners.");
      });
    el("legend-placement").onchange = (e) =>
      this.change((s) => {
        s.layout.legend.onMap = e.target.value === "map";
      });
    el("reset-placement").onclick = () =>
      this.change((s) => {
        s.annotations = { names: {}, coordinates: {} };
        s.layout.legend = { ...s.layout.legend, x: 0.95, y: 0.95 };
      });
    el("source-sections").onchange = (e) => {
      if (e.target.tagName === "SELECT") this.sourceFields();
    };
    el("source-start").onchange = () => {
      this.editSource();
      this.showSources();
    };
    el("source-include").onchange = () => {
      this.editSource();
      this.renderSources(el("source-order").selectedIndex);
      this.showSources();
    };
    for (const [id, field] of [
      ["section-start", "replace-from"],
      ["section-end", "replace-to"],
    ])
      el(id).onclick = () => {
        if (this.vertexIndex != null) el(field).value = this.vertexIndex + 1;
        else this.status("Select a boundary handle first.");
      };
    el("source-end").onchange = () => {
      this.editSource();
      this.showSources();
    };
    for (const [id, delta] of [
      ["source-up", -1],
      ["source-down", 1],
    ])
      el(id).onclick = () => {
        const i = el("source-order").selectedIndex,
          j = i + delta;
        if (j >= 0 && j < this.sections.length) {
          [this.sections[i], this.sections[j]] = [
            this.sections[j],
            this.sections[i],
          ];
          this.renderSources(j);
        }
      };
    el("source-reverse").onclick = () => {
      const i = el("source-order").selectedIndex;
      if (i >= 0) {
        this.sections[i].reverse = !this.sections[i].reverse;
        this.renderSources(i);
      }
    };
    this.map.onSelect = (id) => this.select(id);
    this.map.onVertexPreview = (ring) => this.previewRing(ring);
    this.map.onVertexCancel = () => this.showDraft();
    this.map.onVertexSelect = (index) => {
      this.vertexIndex = index;
      el("vertex-pin").textContent = this.active()?.hull[index]?.pinned
        ? "Unpin vertex"
        : "Pin vertex";
      this.status(
        `Vertex ${index + 1} selected. Arrow keys nudge; Delete removes.`,
      );
    };
    this.map.labelManager.onPlace = (kind, key, position) =>
      this.change((s) => {
        s.annotations[kind][key] = position;
      });
    this.map.labelManager.onSelect = (id) => {
      if (!this.placing) this.select(id);
    };
    this.bindLegend();
    window.addEventListener("resize", () => this.renderLegend());
    this.map.map.on("moveend", () => this.renderLegend());
    document.addEventListener("keydown", (e) => {
      const typing = e.target.matches(
        'input,textarea,select,[contenteditable="true"]',
      );
      if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? this.redo() : this.undo();
      }
    });
    window.addEventListener("beforeunload", (e) => {
      if (this.draft) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    // A draft cannot be overwritten by unrelated sidebar mutations or session replacement.
    document.addEventListener(
      "click",
      (e) => {
        if (!this.draft) return;
        const mutation = e.target.closest(
          "#polygons-list input,#polygons-list select,#polygons-list button:not(.edit-polygon),#clear-all,#create-group,#upload-session,#load-example-session,#upload-zone,#download-session,#export-png,#export-pdf,#export-kml,#export-geojson,#export-tracks-geojson",
        );
        if (mutation) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.status("Apply or cancel the boundary draft first.");
        }
      },
      true,
    );
    this.update();
  }
  status(message) {
    el("editor-status").textContent = message;
    el("draft-info").textContent = message;
  }
  attempt(fn) {
    try {
      return fn();
    } catch (e) {
      this.status(e.message);
      this.update();
      return false;
    }
  }
  openEdit() {
    el("settings-container").style.display = "block";
    document.querySelector('[data-tab="edit"]').click();
  }
  active() {
    return this.draft?.polygons.find((p) => p.id === this.selected);
  }
  leaveDraft() {
    if (!this.draft) return true;
    if (!confirm("Discard the unapplied boundary draft?")) return false;
    this.cancel();
    return true;
  }
  select(id) {
    if (this.draft && this.selected === id) return;
    if (!this.leaveDraft()) return;
    const p = this.getState().polygons.find((p) => p.id === id);
    if (!p?.hull?.length) return;
    this.selected = id;
    this.vertexIndex = null;
    this.placing = false;
    this.map.labelManager.placementMode = false;
    this.draft = clone(this.getState());
    this.draftHistory = new History(this.draft);
    this.openEdit();
    this.beforeLayer = L.polygon(
      p.hull.map((v) => [v.lat, v.lon]),
      {
        color: "#fff",
        weight: 2,
        dashArray: "8 6",
        fill: false,
        interactive: false,
      },
    ).addTo(this.map.map);
    this.sections = this.sourceSections(p);
    this.renderSources();
    el("review-gaps").checked = !!p.boundary.reviewedGaps;
    this.showDraft(true);
    this.showSources();
    this.map.map.fitBounds(L.latLngBounds(p.hull.map((v) => [v.lat, v.lon])), {
      padding: [50, 50],
    });
    this.status(`Editing ${p.name} · draft; committed geometry is unchanged.`);
    this.update();
    window.pathmapCloseSidebar?.();
  }
  sourceSections(p) {
    const available = p.tracks.flatMap((t) =>
      (t.segments || [t.points]).map((points, segment) => ({
        trackId: t.id,
        segment,
        start: 0,
        end: points.length - 1,
        reverse: false,
        include: true,
      })),
    );
    const previous = p.boundary.sections || [];
    return clone([
      ...previous.filter((s) =>
        available.some(
          (a) => a.trackId === s.trackId && a.segment === s.segment,
        ),
      ),
      ...available.filter(
        (a) =>
          !previous.some(
            (s) => a.trackId === s.trackId && a.segment === s.segment,
          ),
      ),
    ]);
  }
  renderSources(index = 0) {
    const p = this.active();
    el("source-sections").innerHTML =
      '<label for="source-order">Source order (select to reorder, reverse or trim)</label><select id="source-order" size="4">' +
      this.sections
        .map(
          (s, i) =>
            `<option value="${i}">${i + 1}. ${escape(p.tracks.find((t) => t.id === s.trackId)?.name)} · segment ${s.segment + 1}${s.reverse ? " ←" : " →"}${s.include === false ? " (excluded)" : ""}</option>`,
        )
        .join("") +
      "</select>";
    el("source-order").selectedIndex = index;
    this.sourceFields();
  }
  sourceFields() {
    const s = this.sections[el("source-order")?.selectedIndex];
    if (s) {
      el("source-start").value = s.start;
      el("source-end").value = s.end;
      el("source-include").checked = s.include !== false;
    }
  }
  editSource() {
    const s = this.sections[el("source-order").selectedIndex];
    if (s) {
      s.start = +el("source-start").value;
      s.end = +el("source-end").value;
      s.include = el("source-include").checked;
    }
  }
  recordDraft(before) {
    this.draftHistory.current = before;
    this.draftHistory.commit(this.draft);
    this.update();
  }
  previewRing(ring) {
    if (!this.draft) return false;
    try {
      const polygons = updateSharedRing(
        this.draft.polygons,
        this.selected,
        ring,
        this.draft.noOverlap,
      );
      // Neighbors preview live; the draft/history still changes only once on pointer-up.
      for (const p of polygons)
        if (
          p.id !== this.selected &&
          this.map.polygonData.has(p.id) &&
          JSON.stringify(p.hull) !==
            JSON.stringify(this.draft.polygons.find((n) => n.id === p.id).hull)
        )
          this.map.addPolygon(p.id, p.hull, p.color, p.name, true);
      return true;
    } catch (error) {
      this.status(error.message);
      return false;
    }
  }
  receive(ring) {
    return (
      this.attempt(() => {
        const before = clone(this.draft);
        this.draft.polygons = updateSharedRing(
          this.draft.polygons,
          this.selected,
          ring,
          this.draft.noOverlap,
        );
        this.recordDraft(before);
        this.showDraft();
        this.status(
          "Boundary draft updated. Apply to save; Undo reverses this gesture.",
        );
        return true;
      }) || this.showDraft(true)
    );
  }
  showDraft(restart = false) {
    if (!this.draft) return;
    for (const p of this.draft.polygons) {
      if (this.map.polygonData.has(p.id) || p.id === this.selected)
        this.map.addPolygon(p.id, p.hull, p.color, p.name, true);
    }
    const p = this.active();
    if (restart)
      this.map.enterEditMode(p.id, p, (id, ring) => this.receive(ring));
    else {
      this.map.editingPolygonRef = p;
      this.map.createMidpointMarkers(p);
    }
    this.map.labelManager.setShowLabels(false);
    this.update();
  }
  generate(local = false) {
    if (!this.draft) return;
    this.attempt(() => {
      const before = clone(this.draft),
        p = this.active(),
        tolerance = +el("path-tolerance").value,
        reviewedGaps = el("review-gaps").checked;
      this.editSource();
      const sections = clone(this.sections);
      this.showSources();
      for (const s of sections) {
        const t = p.tracks.find((t) => t.id === s.trackId),
          points = (t.segments || [t.points])[s.segment];
        if (
          !Number.isInteger(s.start) ||
          !Number.isInteger(s.end) ||
          s.start < 0 ||
          s.end >= points.length ||
          s.end <= s.start
        )
          throw Error("Choose valid source start/end indices.");
      }
      let ring;
      const tracks = clone(p.tracks),
        pins = new Map(
          p.hull.filter((v) => v.pinned).map((v) => [v.sourceId, v]),
        );
      for (const t of tracks)
        for (const piece of [t.points, ...(t.segments || [])])
          for (const v of piece) {
            v.pinned = pins.has(v.id);
            if (v.pinned) {
              v.lat = pins.get(v.id).lat;
              v.lon = pins.get(v.id).lon;
            }
          }
      if (local) {
        const s = sections[el("source-order").selectedIndex];
        if (!s) throw Error("Select a source segment.");
        const t = tracks.find((t) => t.id === s.trackId);
        let points = (t.segments || [t.points])[s.segment].slice(
          s.start,
          s.end + 1,
        );
        if (s.reverse) points.reverse();
        points = simplifyOrdered(points, tolerance);
        const from = +el("replace-from").value - 1,
          to = +el("replace-to").value - 1;
        if (
          !Number.isInteger(from) ||
          !Number.isInteger(to) ||
          from < 0 ||
          to <= from ||
          to >= p.hull.length
        )
          throw Error(
            "Choose increasing boundary vertex numbers within the ring.",
          );
        if (
          !reviewedGaps &&
          (distance(p.hull[from], points[0]) > 2 ||
            distance(p.hull[to], points.at(-1)) > 2)
        )
          throw Error(
            "Source endpoints are over 2 m from this boundary section. Review and accept the connecting edges first.",
          );
        ring = [...p.hull.slice(0, from), ...points, ...p.hull.slice(to + 1)];
      } else if (el("follow-path").checked)
        ring = followPath(tracks, {
          tolerance,
          reviewedGaps,
          sections: sections.filter((s) => s.include !== false),
        }).hull;
      else
        ring = window
          .pathmapBroadOutline(p.tracks)
          .map((v) => ({ ...v, id: v.id || uid() }));
      const sourceIds = new Set(
        tracks.flatMap((t) =>
          [...t.points, ...(t.segments || []).flat()].map((v) => v.id),
        ),
      );
      ring = ring.map((v) => {
        // Existing manual vertices already have graph IDs; generated source samples need their own.
        if (p.hull.some((n) => n.id === v.id)) return v;
        const sourceId = v.sourceId || (sourceIds.has(v.id) ? v.id : null);
        const existing =
          sourceId && p.hull.find((n) => n.sourceId === sourceId);
        return sourceId ? { ...v, sourceId, id: existing?.id || uid() } : v;
      });
      for (const pinned of p.hull.filter((v) => v.pinned))
        if (!ring.some((v) => v.id === pinned.id))
          throw Error(
            "This outline would remove a pinned vertex. Include its source section or unpin it before regenerating.",
          );
      this.draft.polygons = updateSharedRing(
        this.draft.polygons,
        p.id,
        ring,
        this.draft.noOverlap,
      );
      this.active().boundary = {
        follow: el("follow-path").checked || local,
        tolerance,
        sections,
        manual: local,
        reviewedGaps,
      };
      this.recordDraft(before);
      this.showDraft(true);
      this.showSources();
      this.status(
        `${ring.length} boundary vertices · preview follows ${local ? "selected section" : el("follow-path").checked ? "ordered source path" : "broad outline"}. Review the visible connecting edges, then Apply.`,
      );
    });
  }
  showSources() {
    this.clearPreview();
    const p = this.active();
    if (!p) return;
    const pieces = [];
    for (const section of this.sections || []) {
      const track = p.tracks.find((t) => t.id === section.trackId),
        source = (track?.segments || [track?.points])[section.segment];
      if (!source?.length || section.include === false) continue;
      let points = source.slice(section.start, section.end + 1);
      if (section.reverse) points.reverse();
      if (!points.length) continue;
      pieces.push(points);
      const line = L.polyline(
        points.map((v) => [v.lat, v.lon]),
        { color: "#ff9900", weight: 3, dashArray: "3 4", interactive: false },
      ).addTo(this.map.map);
      this.previewLayers.push(line);
    }
    for (let i = 0; i < pieces.length; i++) {
      const a = pieces[i].at(-1),
        b = pieces[(i + 1) % pieces.length][0],
        gap = distance(a, b);
      if (gap > 2)
        this.previewLayers.push(
          L.polyline(
            [
              [a.lat, a.lon],
              [b.lat, b.lon],
            ],
            {
              color: "#d63636",
              weight: 3,
              dashArray: "7 5",
              interactive: false,
            },
          )
            .bindTooltip(`Gap: ${gap.toFixed(1)} m`, {
              permanent: true,
              direction: "center",
              className: "gap-label",
            })
            .addTo(this.map.map),
        );
    }
  }

  clearPreview() {
    this.previewLayers.forEach((l) => l.remove());
    this.previewLayers = [];
  }
  pinVertex() {
    if (this.vertexIndex == null || !this.draft) return;
    const before = clone(this.draft),
      v = this.active().hull[this.vertexIndex];
    if (!v) {
      this.status("Select a boundary vertex first.");
      return;
    }
    v.pinned = !v.pinned;
    for (const p of this.draft.polygons)
      for (const n of p.hull || []) if (n.id === v.id) n.pinned = v.pinned;
    this.recordDraft(before);
    this.showDraft(true);
    this.status(
      v.pinned ? "Vertex pinned against detail reduction." : "Vertex unpinned.",
    );
  }
  apply() {
    if (!this.draft) return;
    this.attempt(() => {
      this.draft.polygons.forEach((p) => {
        if (p.hull?.length) validateRing(p.hull);
      });
      if (this.draft.noOverlap) validateCoverage(this.draft.polygons);
      const next = this.draft;
      this.draft = null;
      this.beforeLayer?.remove();
      this.beforeLayer = null;
      this.clearPreview();
      this.map.exitEditMode();
      this.replace(next);
      const persisted = this.save();
      this.render();
      this.status(
        persisted
          ? "Boundary saved. Undo restores the entire affected set."
          : "Boundary applied in memory; autosave is unavailable. Use Save to download a session file.",
      );
      this.update();
    });
  }
  cancel() {
    this.draft = null;
    this.beforeLayer?.remove();
    this.beforeLayer = null;
    this.clearPreview();
    this.map.exitEditMode();
    this.render();
    this.status("Draft closed; committed geometry restored.");
    this.update();
  }
  changed() {
    if (!this.draft) this.history.commit(this.getState());
    this.update();
  }
  reset() {
    this.beforeLayer?.remove();
    this.beforeLayer = null;
    this.draft = null;
    this.history.reset(this.getState());
    this.selected = null;
    this.update();
  }
  change(fn) {
    if (this.draft) {
      this.status("Apply or cancel the boundary draft first.");
      return;
    }
    const focus = document.activeElement?.dataset;
    const placementFocus = focus?.placementKind
      ? { kind: focus.placementKind, key: focus.placementKey }
      : null;
    const s = clone(this.getState());
    fn(s);
    this.replace(s);
    this.save();
    this.render();
    this.update();
    if (placementFocus) {
      const marker = [
        ...document.querySelectorAll("[data-placement-key]"),
      ].find(
        (e) =>
          e.dataset.placementKind === placementFocus.kind &&
          e.dataset.placementKey === placementFocus.key,
      );
      marker?.focus({ preventScroll: true });
    }
  }
  undo() {
    if (this.draft) {
      const s = this.draftHistory.undo();
      if (s) {
        this.draft = s;
        this.sections = this.sourceSections(this.active());
        this.renderSources();
        this.showDraft(true);
        this.status("Draft change undone.");
      }
    } else {
      const s = this.history.undo();
      if (s) {
        s.mapState = this.map.getMapState();
        this.replace(s);
        this.save(false);
        this.render();
        this.status("Change undone.");
      }
    }
    this.update();
  }
  redo() {
    if (this.draft) {
      const s = this.draftHistory.redo();
      if (s) {
        this.draft = s;
        this.sections = this.sourceSections(this.active());
        this.renderSources();
        this.showDraft(true);
        this.status("Draft change restored.");
      }
    } else {
      const s = this.history.redo();
      if (s) {
        s.mapState = this.map.getMapState();
        this.replace(s);
        this.save(false);
        this.render();
        this.status("Change restored.");
      }
    }
    this.update();
  }
  update() {
    const s = this.draft || this.getState();
    el("draft-map-actions").hidden = !this.draft;
    document.querySelector(".editor-draft-tools").hidden = !this.draft;
    document.body.classList.toggle("boundary-draft", !!this.draft);
    document
      .querySelectorAll(".polygon-card")
      .forEach((card) =>
        card.classList.toggle(
          "editor-selected",
          +card.dataset.polygonId === this.selected,
        ),
      );
    el("place-labels").setAttribute("aria-pressed", String(this.placing));
    this.legend.classList.toggle("placing", this.placing);
    el("editor-undo").disabled = !(this.draft
      ? this.draftHistory?.past.length
      : this.history.past.length);
    el("editor-redo").disabled = !(this.draft
      ? this.draftHistory?.future.length
      : this.history.future.length);
    const select = el("polygon-select");
    if (select) {
      select.innerHTML =
        '<option value="">Select a polygon…</option>' +
        s.polygons
          .filter((p) => p.hull?.length >= 3)
          .map((p) => `<option value="${p.id}">${escape(p.name)}</option>`)
          .join("");
      select.value = this.draft ? this.selected : "";
    }
    if (this.draft) {
      el("follow-path").checked = !!this.active().boundary.follow;
      el("path-tolerance").value = this.active().boundary.tolerance ?? 0;
      el("no-overlap").checked = !!s.noOverlap;
      el("polygon-locked").checked = !!this.active().locked;
      el("vertex-pin").textContent = this.active().hull[this.vertexIndex]
        ?.pinned
        ? "Unpin vertex"
        : "Pin vertex";
      const value = el("join-neighbor").value;
      el("join-neighbor").innerHTML = s.polygons
        .filter((p) => p.id !== this.selected && p.hull?.length >= 3)
        .map(
          (p) =>
            `<option value="${p.id}">${escape(p.name)}${p.locked ? " 🔒" : ""}</option>`,
        )
        .join("");
      el("join-neighbor").value =
        value || el("join-neighbor").options[0]?.value || "";
    }
    el("legend-placement").value = this.getState().layout.legend.onMap
      ? "map"
      : "below";
    this.map.labelManager.placements = this.getState().annotations;
    this.renderLegend();
  }
  renderLegend() {
    const s = this.getState(),
      l = s.layout.legend,
      polygons = s.polygons.filter((p) => this.map.polygonData.has(p.id));
    this.legend.hidden = !l.onMap || !polygons.length;
    this.legend.innerHTML =
      '<strong>Map key <span aria-hidden="true">⠿</span></strong>' +
      polygons
        .map(
          (p, i) =>
            `<div><i class="key-swatch key-pattern-${i % 4}" style="background-color:${escape(p.color)}"></i><span>${i + 1} · ${escape(p.name)}</span></div>`,
        )
        .join("");
    this.positionLegend(l);
  }
  positionLegend(l) {
    const r = el("map").getBoundingClientRect();
    this.legend.style.left =
      Math.max(0, l.x * (r.width - this.legend.offsetWidth - 12)) + "px";
    this.legend.style.top =
      Math.max(0, l.y * (r.height - this.legend.offsetHeight - 12)) + "px";
  }
  bindLegend() {
    this.legend.onpointerdown = (e) => {
      if (!this.placing) return;
      e.preventDefault();
      e.stopPropagation();
      const start = {
        x: e.clientX,
        y: e.clientY,
        l: parseFloat(this.legend.style.left) || 0,
        t: parseFloat(this.legend.style.top) || 0,
      };
      this.legend.setPointerCapture(e.pointerId);
      let result;
      const move = (ev) => {
        const r = el("map").getBoundingClientRect();
        result = {
          ...this.getState().layout.legend,
          x: Math.max(
            0,
            Math.min(
              1,
              (start.l + ev.clientX - start.x) /
                Math.max(1, r.width - this.legend.offsetWidth - 12),
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              1,
              (start.t + ev.clientY - start.y) /
                Math.max(1, r.height - this.legend.offsetHeight - 12),
            ),
          ),
        };
        this.positionLegend(result);
      };
      const finish = (ev) => {
        this.legend.removeEventListener("pointermove", move);
        this.legend.removeEventListener("pointerup", finish);
        this.legend.removeEventListener("pointercancel", finish);
        if (result && ev.type !== "pointercancel")
          this.change((s) => (s.layout.legend = result));
        else this.renderLegend();
      };
      this.legend.addEventListener("pointermove", move);
      this.legend.addEventListener("pointerup", finish);
      this.legend.addEventListener("pointercancel", finish);
    };
    this.legend.onkeydown = (e) => {
      if (!this.placing || !e.key.startsWith("Arrow")) return;
      e.preventDefault();
      this.change((s) => {
        const l = s.layout.legend;
        l.x = Math.max(
          0,
          Math.min(
            1,
            l.x +
              (e.key === "ArrowRight"
                ? 0.01
                : e.key === "ArrowLeft"
                  ? -0.01
                  : 0),
          ),
        );
        l.y = Math.max(
          0,
          Math.min(
            1,
            l.y +
              (e.key === "ArrowDown" ? 0.01 : e.key === "ArrowUp" ? -0.01 : 0),
          ),
        );
      });
    };
  }
}
