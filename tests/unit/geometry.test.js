import test from "node:test";
import assert from "node:assert/strict";
import {
  followPath,
  simplifyOrdered,
  validateRing,
  validateCoverage,
  interiorsOverlap,
  joinSharedEdge,
  updateSharedRing,
  clone,
  distance,
} from "../../geometry.js";
import {
  migrateSession,
  History,
  cleanAnnotations,
} from "../../editor-state.js";
let n = 0;
const v = (x, y) => ({
  lon: 79 + x / 108000,
  lat: 12 + y / 111195,
  id: `v${n++}`,
});
const ring = (coords) => coords.map(([x, y]) => v(x, y));
const square = (x = 0) =>
  ring([
    [x, 0],
    [x + 10, 0],
    [x + 10, 10],
    [x, 10],
  ]);
const polygon = (id, hull) => ({
  id,
  name: `Plot ${id}`,
  color: "#ff6600",
  tracks: [],
  hull,
});
test("valid rings, self intersections, touching, duplicate edges and collapse", () => {
  assert.equal(validateRing(square()), true);
  for (const pts of [
    [
      [0, 0],
      [10, 10],
      [0, 10],
      [10, 0],
    ],
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [5, 0],
      [0, 10],
    ],
    [
      [0, 0],
      [10, 0],
      [10, 0],
      [0, 10],
    ],
    [
      [0, 0],
      [5, 0],
      [10, 0],
    ],
  ])
    assert.throws(() => validateRing(ring(pts)));
});
test("interior overlap detects crossings, containment, coincident and collinear overlap but permits shared edges", () => {
  assert.equal(interiorsOverlap(square(), square(10)), false);
  assert.equal(interiorsOverlap(square(), square(5)), true);
  const a = square();
  assert.equal(interiorsOverlap(a, clone(a)), true);
  assert.equal(
    interiorsOverlap(
      a,
      ring([
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
      ]),
    ),
    true,
  );
  assert.equal(interiorsOverlap(a, square(15)), false);
});
test("ordered following preserves a winding inward bend at zero tolerance and does not change the source", () => {
  const points = ring([
      [0, 0],
      [30, 0],
      [30, 30],
      [20, 30],
      [20, 10],
      [10, 10],
      [10, 30],
      [0, 30],
      [0, 0],
    ]),
    tracks = [{ id: 1, points }],
    before = clone(tracks);
  const result = followPath(tracks, { tolerance: 0 });
  assert.equal(result.hull.length, 8);
  assert.deepEqual(tracks, before);
  assert.equal(result.hull[4].lat, points[4].lat);
  assert.equal(validateRing(result.hull), true);
});
test("source gaps require explicit review; selected section direction/order is honored", () => {
  const a = ring([
      [0, 0],
      [10, 0],
      [10, 10],
    ]),
    b = ring([
      [0, 10],
      [0, 0],
    ]),
    tracks = [
      { id: 1, points: a },
      { id: 2, points: b },
    ];
  assert.throws(() => followPath(tracks), /gap/);
  assert.equal(followPath(tracks, { reviewedGaps: true }).hull.length, 4);
  assert.throws(
    () => followPath(tracks, { sections: [{ trackId: 99 }] }),
    /no longer exists/,
  );
  const c = ring([
    [0, 0],
    [0, 10],
  ]);
  const result = followPath(
    [
      { id: 1, points: a },
      { id: 2, points: c },
    ],
    {
      reviewedGaps: true,
      sections: [{ trackId: 1 }, { trackId: 2, reverse: true }],
    },
  );
  assert.equal(result.hull.length, 4);
});
test("metre simplification preserves pins, bounded detail, zero tolerance and endpoints", () => {
  const a = ring([
    [0, 0],
    [5, 0.2],
    [10, 0],
    [15, 0.2],
    [20, 0],
  ]);
  assert.equal(simplifyOrdered(a, 0).length, 5);
  assert.equal(simplifyOrdered(a, 1).length, 2);
  a[2].pinned = true;
  assert.ok(simplifyOrdered(a, 1).some((p) => p.id === a[2].id));
  assert.throws(() => simplifyOrdered(a, -1));
  // Same physical deviation at another latitude makes the same keep/drop choice.
  const high = a.map((p) => ({ ...p, lat: p.lat + 40 }));
  assert.equal(simplifyOrdered(high, 1).length, simplifyOrdered(a, 1).length);
});
test("explicit shared edge join, midpoint push, insertion/deletion and locked neighbor are atomic", () => {
  const source = [polygon(1, square()), polygon(2, square(10))],
    before = clone(source),
    joined = joinSharedEdge(source, 1, 2);
  assert.deepEqual(source, before);
  let a = joined[0].hull,
    mid = v(10, 5);
  let updated = updateSharedRing(
    joined,
    1,
    [a[0], a[1], mid, a[2], a[3]],
    true,
  );
  assert.ok(updated[1].hull.some((p) => p.id === mid.id));
  a = clone(updated[0].hull);
  a[2].lon += 2 / 108000;
  updated = updateSharedRing(updated, 1, a, true);
  assert.equal(updated[1].hull.find((p) => p.id === mid.id).lon, a[2].lon);
  assert.equal(validateCoverage(updated), true);
  const locked = clone(updated);
  locked[1].locked = true;
  a = clone(updated[0].hull);
  a[2].lon += 1 / 108000;
  assert.throws(() => updateSharedRing(locked, 1, a, true), /locked/);
  assert.deepEqual(updated[0].hull[2].lon, locked[0].hull[2].lon);
  a = updated[0].hull.filter((p) => p.id !== mid.id);
  const deleted = updateSharedRing(updated, 1, a, true);
  assert.equal(deleted[1].hull.length, 4);
  assert.equal(validateCoverage(deleted), true);
});
test("no overlap rejects collision with an unjoined/hidden neighbor and existing conflicts", () => {
  const source = [
      polygon(1, square()),
      { ...polygon(2, square(10)), hidden: true },
    ],
    a = clone(source[0].hull);
  a[1].lon += 5 / 108000;
  assert.throws(() => updateSharedRing(source, 1, a, true), /Overlap/);
  assert.throws(
    () => validateCoverage([polygon(1, square()), polygon(2, square(5))]),
    /Overlap/,
  );
  assert.throws(
    () => joinSharedEdge([polygon(1, square()), polygon(2, square(15))], 1, 2),
    /No matching edge/,
  );
});
test("migration preserves old hulls, sources, stable IDs and shared node ownership through a JSON round trip", () => {
  const old = { polygons: [polygon(1, square())] };
  old.polygons[0].hull.forEach((p) => delete p.id);
  const first = migrateSession(old),
    next = migrateSession(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(first, next);
  assert.deepEqual(
    old.polygons[0].hull.map(({ lat, lon }) => ({ lat, lon })),
    first.polygons[0].hull.map(({ lat, lon }) => ({ lat, lon })),
  );
  assert.equal(first.schemaVersion, 2);
  assert.throws(() =>
    migrateSession({
      polygons: [{ id: 1, name: "a", color: "bad", tracks: [], hull: [] }],
    }),
  );
  const shared = migrateSession({
    polygons: joinSharedEdge(
      [polygon(1, square()), polygon(2, square(10))],
      1,
      2,
    ),
  });
  assert.equal(
    validateCoverage(
      migrateSession(JSON.parse(JSON.stringify(shared))).polygons,
    ),
    true,
  );
});
test("history is atomic, excludes map movement and supports branching; annotations do not shift to another vertex", () => {
  const a = migrateSession({ polygons: [polygon(1, square())] }),
    h = new History(a);
  const b = clone(a);
  b.mapState = { zoom: 5 };
  assert.equal(h.commit(b), false);
  b.polygons[0].name = "Renamed";
  h.commit(b);
  assert.equal(h.undo().polygons[0].name, "Plot 1");
  assert.equal(h.redo().polygons[0].name, "Renamed");
  h.undo();
  b.polygons[0].name = "Branched";
  h.commit(b);
  assert.equal(h.redo(), null);
  const key = `1-${a.polygons[0].hull[0].id}`;
  a.annotations.coordinates[key] = { lat: 12, lng: 79 };
  a.polygons[0].hull.shift();
  cleanAnnotations(a);
  assert.deepEqual(a.annotations.coordinates, {});
});
test("10,000-point winding source retains ordered points without blocking a normal preview budget", () => {
  const points = Array.from({ length: 10000 }, (_, i) => {
    const angle = (i / 10000) * 2 * Math.PI;
    return v(
      (100 + 5 * Math.sin(angle * 20)) * Math.cos(angle),
      (100 + 5 * Math.sin(angle * 20)) * Math.sin(angle),
    );
  });
  points.push(clone(points[0]));
  const start = performance.now(),
    out = followPath([{ points }], { tolerance: 0.1 });
  assert.ok(out.hull.length > 40);
  assert.ok(performance.now() - start < 5000);
});
test("shared exterior endpoints cannot move or disappear, and a third polygon never cascades", () => {
  const joined = joinSharedEdge(
      [polygon(1, square()), polygon(2, square(10))],
      1,
      2,
    ),
    a = clone(joined[0].hull);
  a[1].lon += 1 / 108000;
  assert.throws(() => updateSharedRing(joined, 1, a, true), /endpoints/);
  assert.throws(
    () =>
      updateSharedRing(
        joined,
        1,
        joined[0].hull.filter((_, i) => i !== 1),
        true,
      ),
    /endpoints/,
  );
  let active = joined[0].hull,
    mid = v(10, 5),
    withMid = updateSharedRing(
      joined,
      1,
      [active[0], active[1], mid, active[2], active[3]],
      true,
    );
  withMid.push(polygon(3, square(20)));
  active = clone(withMid[0].hull);
  active[2].lon += 15 / 108000;
  assert.throws(() => updateSharedRing(withMid, 1, active, true));
  assert.equal(withMid[2].hull[0].lon, 79 + 20 / 108000);
});
test("moving a GPX track never implicitly shares topology with a preserved manual boundary", () => {
  const points = square(),
    source = migrateSession({
      polygons: [
        {
          ...polygon(1, clone(points)),
          tracks: [{ id: 1, name: "Walk", points: clone(points) }],
        },
      ],
    });
  source.polygons[0].boundary.manual = true;
  const track = source.polygons[0].tracks.pop();
  source.polygons.push({ ...polygon(2, clone(track.points)), tracks: [track] });
  const moved = migrateSession(source),
    ids = new Set(moved.polygons[0].hull.map((v) => v.id));
  assert.equal(
    moved.polygons[1].hull.some((v) => ids.has(v.id)),
    false,
  );
  assert.ok(moved.polygons[1].hull.every((v) => v.sourceId));
});
