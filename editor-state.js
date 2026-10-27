import { clone, uid, validateCoverage } from "./geometry.js";
export function migrateSession(input) {
  if (!input || !Array.isArray(input.polygons))
    throw Error("Session must contain a polygons array.");
  const state = clone(input);
  if (state.schemaVersion > 2)
    throw Error("This session requires a newer PathMap version.");
  state.schemaVersion = 2;
  state.groups ||= [];
  state.annotations ||= { names: {}, coordinates: {} };
  state.annotations.names ||= {};
  state.annotations.coordinates ||= {};
  state.annotations.custom ||= [];
  if (!Array.isArray(state.annotations.custom))
    throw Error("Custom labels must be an array.");
  const customIds = new Set();
  for (const label of state.annotations.custom) {
    if (
      typeof label.id !== "string" ||
      !label.id ||
      customIds.has(label.id) ||
      typeof label.text !== "string" ||
      !label.text.trim() ||
      label.text.length > 200 ||
      !Number.isFinite(label.lat) ||
      !Number.isFinite(label.lng) ||
      Math.abs(label.lat) > 90 ||
      Math.abs(label.lng) > 180
    )
      throw Error("Invalid custom label.");
    customIds.add(label.id);
  }
  state.layout ||= { legend: { onMap: false, x: 0.95, y: 0.95 } };
  state.layout.legend ||= { onMap: false, x: 0.95, y: 0.95 };
  state.noOverlap ||= false;
  state.nextPolygonId ||= 1 + Math.max(0, ...state.polygons.map((p) => p.id));
  state.nextGroupId ||= 1 + Math.max(0, ...state.groups.map((g) => g.id));
  state.focusedPolygonId ??= null;
  state.focusedGroupId ??= null;
  if (!Array.isArray(state.groups)) throw Error("Groups must be an array.");
  const groupIds = new Set();
  for (const g of state.groups) {
    if (
      !Number.isFinite(g.id) ||
      groupIds.has(g.id) ||
      typeof g.name !== "string"
    )
      throw Error("Invalid group.");
    groupIds.add(g.id);
  }
  const ids = new Set();
  for (const p of state.polygons) {
    if (!Number.isFinite(p.id) || ids.has(p.id))
      throw Error("Session contains a missing or duplicate polygon ID.");
    ids.add(p.id);
    if (typeof p.name !== "string" || !/^#[a-f\d]{6}$/i.test(p.color))
      throw Error("Invalid polygon name or color.");
    if (!Array.isArray(p.tracks))
      throw Error("Polygon tracks must be an array.");
    for (const t of p.tracks) {
      if (!Number.isFinite(t.id) || typeof t.name !== "string")
        throw Error("Invalid track identity.");
      if (
        t.segments &&
        (!Array.isArray(t.segments) ||
          t.segments.some(
            (seg) =>
              !Array.isArray(seg) ||
              seg.some(
                (v) => !Number.isFinite(v.lat) || !Number.isFinite(v.lon),
              ),
          ))
      )
        throw Error("Invalid source segments.");
      if (
        !Array.isArray(t.points) ||
        t.points.some(
          (v) =>
            !Number.isFinite(v.lat) ||
            !Number.isFinite(v.lon) ||
            Math.abs(v.lat) > 90 ||
            Math.abs(v.lon) > 180,
        )
      )
        throw Error("Invalid track coordinates.");
      t.points.forEach((v) => (v.id ||= uid()));
      if (t.segments) {
        const pointsByCoordinate = new Map(
          t.points.map((v) => [`${v.lat},${v.lon}`, v.id]),
        );
        t.segments.forEach((seg) =>
          seg.forEach(
            (v) =>
              (v.id ||= pointsByCoordinate.get(`${v.lat},${v.lon}`) || uid()),
          ),
        );
      }
    }
    if (p.hull !== null && !Array.isArray(p.hull))
      throw Error("Invalid polygon boundary.");
    const sourceByCoordinate = new Map(),
      sourceIds = new Set();
    for (const t of p.tracks)
      for (const v of t.points) {
        sourceIds.add(v.id);
        const key = `${v.lat},${v.lon}`;
        if (!sourceByCoordinate.has(key)) sourceByCoordinate.set(key, v.id);
      }
    // Graph ownership is independent of GPX identity. Moving a track must never join two plots.
    p.hull =
      p.hull?.map((v) => {
        if (
          !Number.isFinite(v.lat) ||
          !Number.isFinite(v.lon) ||
          Math.abs(v.lat) > 90 ||
          Math.abs(v.lon) > 180
        )
          throw Error("Invalid boundary coordinate.");
        const sourceId =
          v.sourceId ||
          (sourceIds.has(v.id)
            ? v.id
            : sourceByCoordinate.get(`${v.lat},${v.lon}`));
        return {
          ...v,
          ...(sourceId ? { sourceId } : {}),
          id: !v.id || sourceIds.has(v.id) ? uid() : v.id,
        };
      }) ?? null;
    p.boundary ||= { follow: false, tolerance: 0, manual: false };
  }
  for (const position of [
    ...Object.values(state.annotations.names),
    ...Object.values(state.annotations.coordinates),
  ])
    if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng))
      throw Error("Invalid saved label position.");
  const l = state.layout.legend;
  if (!Number.isFinite(l.x) || !Number.isFinite(l.y))
    throw Error("Invalid legend position.");
  l.x = Math.max(0, Math.min(1, l.x));
  l.y = Math.max(0, Math.min(1, l.y));
  state.nextPolygonId = Math.max(
    Number.isFinite(state.nextPolygonId) ? state.nextPolygonId : 1,
    1 + Math.max(0, ...state.polygons.map((p) => p.id)),
  );
  state.nextGroupId = Math.max(
    Number.isFinite(state.nextGroupId) ? state.nextGroupId : 1,
    1 + Math.max(0, ...state.groups.map((g) => g.id)),
  );
  if (state.noOverlap) validateCoverage(state.polygons);
  return state;
}
const fingerprint = (s) => {
  const c = clone(s);
  delete c.mapState;
  return JSON.stringify(c);
};
export class History {
  constructor(state) {
    this.reset(state);
  }
  reset(state) {
    this.current = clone(state);
    this.past = [];
    this.future = [];
  }
  commit(state) {
    if (fingerprint(state) === fingerprint(this.current)) return false;
    this.past.push(this.current);
    if (this.past.length > 80) this.past.shift();
    this.current = clone(state);
    this.future = [];
    return true;
  }
  undo() {
    if (!this.past.length) return null;
    this.future.push(this.current);
    return clone((this.current = this.past.pop()));
  }
  redo() {
    if (!this.future.length) return null;
    this.past.push(this.current);
    return clone((this.current = this.future.pop()));
  }
}
export function cleanAnnotations(state) {
  const ids = new Set(state.polygons.map((p) => String(p.id))),
    keys = new Set(
      state.polygons.flatMap((p) =>
        (p.hull || []).map((v) => `${p.id}-${v.id}`),
      ),
    );
  for (const k of Object.keys(state.annotations.names))
    if (!ids.has(k)) delete state.annotations.names[k];
  for (const k of Object.keys(state.annotations.coordinates))
    if (!keys.has(k)) delete state.annotations.coordinates[k];
}
