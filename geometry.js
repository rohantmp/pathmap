// Geometry is calculated in a local metre projection, never in screen pixels.
const R = 6371008.8,
  DEG = Math.PI / 180;
export const clone = (value) => structuredClone(value);
export const uid = () => crypto.randomUUID();
export function project(points) {
  const origin = points[0] || { lat: 0, lon: 0 };
  const scale = R * DEG * Math.cos(origin.lat * DEG);
  if (Math.abs(origin.lat) > 85)
    throw Error("Editing within 5° of a pole is not supported.");
  return points.map((p) => ({
    x: (p.lon - origin.lon) * scale,
    y: (p.lat - origin.lat) * R * DEG,
  }));
}
export function distance(a, b) {
  const [p, q] = project([a, b]);
  return Math.hypot(p.x - q.x, p.y - q.y);
}
const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function onSegment(p, a, b, eps = 1e-6) {
  return (
    Math.abs(cross(a, b, p)) <=
      eps * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) &&
    p.x >= Math.min(a.x, b.x) - eps &&
    p.x <= Math.max(a.x, b.x) + eps &&
    p.y >= Math.min(a.y, b.y) - eps &&
    p.y <= Math.max(a.y, b.y) + eps
  );
}
function intersects(a, b, c, d, proper = false) {
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y)
  )
    return false;
  const x = cross(a, b, c),
    y = cross(a, b, d),
    u = cross(c, d, a),
    v = cross(c, d, b);
  if (
    ((x > 1e-8 && y < -1e-8) || (x < -1e-8 && y > 1e-8)) &&
    ((u > 1e-8 && v < -1e-8) || (u < -1e-8 && v > 1e-8))
  )
    return true;
  return (
    !proper &&
    (onSegment(c, a, b) ||
      onSegment(d, a, b) ||
      onSegment(a, c, d) ||
      onSegment(b, c, d))
  );
}
export function validateRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3)
    throw Error("A boundary needs at least three vertices.");
  if (ring.length > 20000)
    throw Error(
      "Boundary exceeds 20,000 vertices; reduce source detail first.",
    );
  if (
    ring.some(
      (p) =>
        !Number.isFinite(p.lat) ||
        !Number.isFinite(p.lon) ||
        Math.abs(p.lat) > 85 ||
        Math.abs(p.lon) > 180,
    )
  )
    throw Error("Boundary has an unsupported coordinate.");
  const pts = project(ring);
  let twiceArea = 0;
  const segments = pts
    .map((p, i) => {
      const q = pts[(i + 1) % pts.length];
      if (Math.hypot(p.x - q.x, p.y - q.y) < 0.001)
        throw Error("Boundary has a duplicate or zero-length edge.");
      twiceArea += p.x * q.y - q.x * p.y;
      return {
        a: p,
        b: q,
        i,
        min: Math.min(p.x, q.x),
        max: Math.max(p.x, q.x),
      };
    })
    .sort((a, b) => a.min - b.min);
  if (Math.abs(twiceArea) < 0.02)
    throw Error("Boundary has collapsed to zero area.");
  for (let i = 0; i < segments.length; i++)
    for (
      let j = i + 1;
      j < segments.length && segments[j].min <= segments[i].max;
      j++
    ) {
      const a = segments[i],
        b = segments[j];
      const delta = Math.abs(a.i - b.i);
      if (delta === 1 || delta === pts.length - 1) {
        // Adjacent edges may meet, but may not fold back on themselves.
        const otherA = a.a === b.a || a.a === b.b ? a.b : a.a,
          otherB = b.a === a.a || b.a === a.b ? b.b : b.a;
        const shared = a.a === b.a || a.a === b.b ? a.a : a.b;
        if (
          onSegment(otherA, shared, otherB) ||
          onSegment(otherB, shared, otherA)
        )
          throw Error("Boundary doubles back along an edge.");
      } else if (intersects(a.a, a.b, b.a, b.b))
        throw Error("Boundary crosses or touches itself.");
    }
  return true;
}
function inside(p, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i];
    if (onSegment(p, a, b)) return false;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}
export function interiorsOverlap(a, b) {
  const all = project([...a, ...b]),
    p = all.slice(0, a.length),
    q = all.slice(a.length);
  for (let i = 0; i < p.length; i++)
    for (let j = 0; j < q.length; j++)
      if (
        intersects(
          p[i],
          p[(i + 1) % p.length],
          q[j],
          q[(j + 1) % q.length],
          true,
        )
      )
        return true;
  if (p.some((v) => inside(v, q)) || q.some((v) => inside(v, p))) return true;
  // Interior edge probes catch coincident polygons and collinear overlap with no proper crossings.
  for (const ring of [p, q])
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length],
        len = Math.hypot(b.x - a.x, b.y - a.y),
        m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (inside(m, p) && inside(m, q)) return true;
      for (const sign of [-1, 1]) {
        const probe = {
          x: m.x + ((sign * (b.y - a.y)) / len) * 0.0001,
          y: m.y - ((sign * (b.x - a.x)) / len) * 0.0001,
        };
        if (inside(probe, p) && inside(probe, q)) return true;
      }
    }
  return false;
}
export function validateCoverage(polygons) {
  polygons.forEach((p) => {
    if (p.hull?.length) validateRing(p.hull);
  });
  for (let i = 0; i < polygons.length; i++)
    for (let j = i + 1; j < polygons.length; j++)
      if (
        polygons[i].hull?.length &&
        polygons[j].hull?.length &&
        interiorsOverlap(polygons[i].hull, polygons[j].hull)
      )
        throw Error(
          `Overlap between “${polygons[i].name}” and “${polygons[j].name}”. Resolve it before enabling no-overlap mode.`,
        );
  // Shared IDs must resolve to exactly one coordinate, with identical noding along their edges.
  const nodes = new Map();
  for (const p of polygons)
    for (const v of p.hull || []) {
      if (nodes.has(v.id)) {
        const old = nodes.get(v.id);
        if (old.lat !== v.lat || old.lon !== v.lon)
          throw Error("Shared boundary coordinates disagree.");
      } else nodes.set(v.id, v);
    }
  return true;
}
function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function simplifyOrdered(points, tolerance = 0) {
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw Error("Deviation must be a nonnegative number of metres.");
  if (!tolerance || points.length < 3) return clone(points);
  const p = project(points),
    keep = new Set([0, p.length - 1]);
  points.forEach((v, i) => {
    if (v.pinned) keep.add(i);
  });
  const anchors = [...keep].sort((a, b) => a - b),
    stack = anchors.slice(1).map((end, i) => [anchors[i], end]);
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = tolerance,
      index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentDistance(p[i], p[a], p[b]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep.add(index);
      stack.push([a, index], [index, b]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => clone(points[i]));
}
// Explicit source order/direction. No nearest-neighbor guessing or hidden gap closure.
export function followPath(
  tracks,
  {
    tolerance = 0,
    joinTolerance = 2,
    reviewedGaps = false,
    sections = null,
  } = {},
) {
  const pieces = sections
    ? sections.map((s) => {
        const track = tracks.find((t) => t.id === s.trackId);
        if (!track) throw Error("A selected source track no longer exists.");
        let points = (track.segments || [track.points])[s.segment || 0];
        if (!points) throw Error("Source segment no longer exists.");
        points = points.slice(s.start ?? 0, (s.end ?? points.length - 1) + 1);
        return s.reverse ? [...points].reverse() : points;
      })
    : tracks.flatMap((t) => t.segments || [t.points]);
  if (!pieces.length) throw Error("Choose at least one source segment.");
  let ring = [],
    gaps = [];
  for (const piece of pieces) {
    if (!piece.length) continue;
    const pts = piece.map((v) => ({ ...v, id: v.id || uid() }));
    if (ring.length) {
      const d = distance(ring.at(-1), pts[0]);
      if (d > joinTolerance) gaps.push(d);
      if (d < 0.001) pts.shift();
    }
    ring.push(...pts);
  }
  ring = ring.filter((v, i) => !i || distance(v, ring[i - 1]) >= 0.001);
  if (ring.length < 3) throw Error("The selected path cannot enclose an area.");
  const closure = distance(ring.at(-1), ring[0]);
  if (closure < 0.001) ring.pop();
  else if (closure > joinTolerance) gaps.push(closure);
  if (gaps.length && !reviewedGaps)
    throw Error(
      `${gaps.length} gap(s), largest ${Math.max(...gaps).toFixed(1)} m. Review the source order and explicitly accept the connecting edges.`,
    );
  validateRing(ring);
  let reduced = simplifyOrdered([...ring, ring[0]], tolerance);
  reduced.pop();
  validateRing(reduced);
  return { hull: reduced, gaps };
}
// Topological ownership is encoded by globally stable node IDs in each ring.
export function joinSharedEdge(polygons, activeId, neighborId, tolerance = 1) {
  const out = clone(polygons),
    a = out.find((p) => p.id === activeId),
    b = out.find((p) => p.id === neighborId);
  if (!a || !b || a === b) throw Error("Choose a different neighbor.");
  if (a.locked || b.locked) throw Error("Unlock both polygons before joining.");
  let count = 0;
  for (let i = 0; i < a.hull.length; i++)
    for (let j = 0; j < b.hull.length; j++) {
      const av = a.hull[i],
        an = a.hull[(i + 1) % a.hull.length],
        bv = b.hull[j],
        bn = b.hull[(j + 1) % b.hull.length];
      const reversed =
          distance(av, bn) <= tolerance && distance(an, bv) <= tolerance,
        forward =
          distance(av, bv) <= tolerance && distance(an, bn) <= tolerance;
      if (reversed || forward) {
        Object.assign(reversed ? bn : bv, clone(av));
        Object.assign(reversed ? bv : bn, clone(an));
        count++;
      }
    }
  if (!count)
    throw Error(
      `No matching edge within ${tolerance} m. Align both endpoints first; edges are never joined automatically.`,
    );
  validateCoverage(out);
  return out;
}
export function updateSharedRing(polygons, activeId, ring, noOverlap = false) {
  validateRing(ring);
  const out = clone(polygons),
    active = out.find((p) => p.id === activeId);
  if (active.locked) throw Error("This polygon is locked.");
  const old = active.hull,
    oldIds = new Set(old.map((v) => v.id)),
    newIds = new Set(ring.map((v) => v.id)),
    nodes = new Map(ring.map((v) => [v.id, v]));
  // A shared edge may bow at its internal nodes; its exterior endpoints stay fixed.
  const owners = new Map();
  for (const p of polygons)
    for (let i = 0; i < (p.hull || []).length; i++) {
      const a = p.hull[i].id,
        b = p.hull[(i + 1) % p.hull.length].id,
        key = [a, b].sort().join("|");
      owners.set(key, (owners.get(key) || 0) + 1);
    }
  for (const v of old) {
    const shared = polygons.some(
      (p) => p.id !== activeId && (p.hull || []).some((n) => n.id === v.id),
    );
    if (!shared) continue;
    const exterior = polygons.some((p) =>
      (p.hull || []).some((n, i) => {
        const b = p.hull[(i + 1) % p.hull.length];
        return (
          (n.id === v.id || b.id === v.id) &&
          owners.get([n.id, b.id].sort().join("|")) === 1
        );
      }),
    );
    const next = nodes.get(v.id);
    if (exterior && (!next || next.lat !== v.lat || next.lon !== v.lon))
      throw Error(
        "Shared edge endpoints are fixed. Add and drag an internal midpoint to push the boundary.",
      );
  }

  for (const p of out) {
    if (p === active) continue;
    let changed = false;
    for (let i = 0; i < p.hull?.length; i++) {
      const v = p.hull[i],
        n = nodes.get(v.id);
      if (n && (n.lat !== v.lat || n.lon !== v.lon)) {
        if (p.locked) throw Error(`Neighbor “${p.name}” is locked.`);
        Object.assign(v, clone(n));
        changed = true;
      }
    }
    const removed = (p.hull || []).filter(
      (v) => oldIds.has(v.id) && !newIds.has(v.id),
    );
    if (removed.length) {
      if (p.locked) throw Error(`Neighbor “${p.name}” is locked.`);
      p.hull = p.hull.filter((v) => !removed.includes(v));
      changed = true;
    }
    // An inserted shared midpoint belongs to every ring containing that shared edge.
    for (let i = 0; i < ring.length; i++) {
      const v = ring[i];
      if (oldIds.has(v.id)) continue;
      const prev = ring[(i + ring.length - 1) % ring.length],
        next = ring[(i + 1) % ring.length];
      for (let j = 0; j < p.hull?.length; j++) {
        const a = p.hull[j].id,
          b = p.hull[(j + 1) % p.hull.length].id;
        if (
          (a === prev.id && b === next.id) ||
          (a === next.id && b === prev.id)
        ) {
          if (p.locked) throw Error(`Neighbor “${p.name}” is locked.`);
          p.hull.splice(j + 1, 0, clone(v));
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      validateRing(p.hull);
      p.boundary = { ...p.boundary, manual: true };
    }
  }
  active.hull = clone(ring);
  active.boundary = { ...active.boundary, manual: true };
  if (noOverlap) validateCoverage(out);
  else
    out.forEach((p) => {
      if (p.hull?.length) validateRing(p.hull);
    });
  return out;
}
