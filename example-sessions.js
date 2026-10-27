import { EXAMPLE_SESSION, EXAMPLE_EXPORT_PREFS } from "./example-session.js";
import { clone, joinSharedEdge } from "./geometry.js";
import { migrateSession } from "./editor-state.js";
import { mergeConvexHulls } from "./convex-hull.js";

// Synthetic metre-scale fixtures near the existing Kanchipuram example.
const point = ([x, y]) => ({
  lat: 12.79 + y / 111195,
  lon: 79.67 + x / 108450,
});
const winding = [
  [0, 0],
  [60, 2],
  [120, 0],
  [180, 3],
  [240, 0],
  [300, 0],
  [300, 300],
  [220, 300],
  [220, 90],
  [180, 95],
  [140, 90],
  [80, 90],
  [80, 300],
  [0, 300],
  [0, 0],
];
const plot = (id, name, color, coordinates) => {
  const points = coordinates.map(point);
  return {
    id,
    name,
    color,
    groupId: null,
    hidden: false,
    tracks: [
      {
        id: id * 100,
        name: name + " · boundary walk",
        points: clone(points),
        segments: [clone(points)],
      },
    ],
    hull: mergeConvexHulls([points]),
  };
};
const session = (polygons) => ({
  polygons,
  groups: [],
  mapState: null,
  focusedPolygonId: null,
  focusedGroupId: null,
});
function adjacent({ joined = true, locked = false } = {}) {
  const a = [
      [0, 0],
      [100, 0],
      [100, 50],
      [100, 100],
      [0, 100],
    ],
    b = [
      [100, 0],
      [200, 0],
      [200, 100],
      [100, 100],
      [100, 50],
    ];
  if (!joined) b.forEach((p) => (p[0] += 20));
  const state = migrateSession(
    session([
      plot(1, "Mango orchard", "#FF6B6B", a),
      plot(2, "Sugarcane field", "#4ECDC4", b),
    ]),
  );
  // Keep the internal shared handle instead of simplifying collinear samples away.
  state.polygons[0].hull = a.map((xy, i) => ({
    ...point(xy),
    id: `orchard-${i}`,
  }));
  state.polygons[1].hull = b.map((xy, i) => ({
    ...point(xy),
    id: `sugarcane-${i}`,
  }));
  if (joined) state.polygons = joinSharedEdge(state.polygons, 1, 2);
  state.polygons[1].locked = locked;
  state.noOverlap = true;
  state.layout.legend.onMap = true;
  return state;
}
export const EXAMPLE_CATALOG = [
  {
    id: "farm",
    title: "Farm survey overview",
    description:
      "Six plots, two groups and Tamil/Latin names. Explore the full map and export controls.",
    hint: "Try grouping, visibility and an export with title, notes and a legend.",
    action: "edit",
    target: 1,
    build: () => clone(EXAMPLE_SESSION),
    coordinates: true,
    groups: true,
  },
  {
    id: "winding",
    title: "A path that meanders",
    description:
      "A deep inward bend and small GPS wiggles that the broad outline bridges.",
    hint: "Edit the orchard and enable Follow actual path. Compare the retained bend with the dashed original outline, then try a larger deviation.",
    action: "edit",
    target: 1,
    build: () => session([plot(1, "Winding orchard", "#FF6B6B", winding)]),
  },
  {
    id: "disconnected",
    title: "Disconnected GPX segments",
    description:
      "Two separate walks in one track. Joining them needs an explicit decision.",
    hint: "Enable Follow actual path to see red gap markers. Select segment 2 and exclude it to keep only the orchard, or review the connections before accepting them.",
    action: "edit",
    target: 1,
    build: () => {
      const p = plot(1, "Two separate walks", "#FF6B6B", winding),
        other = [
          [450, 0],
          [550, 0],
          [550, 100],
          [450, 100],
          [450, 0],
        ].map(point);
      p.tracks[0].segments.push(other);
      p.tracks[0].points.push(...clone(other));
      p.hull = mergeConvexHulls([p.tracks[0].points]);
      return session([p]);
    },
  },
  {
    id: "invalid",
    title: "A crossing boundary walk",
    description: "A bow-tie source path that cannot form a valid simple area.",
    hint: "Enable Follow actual path. The invalid preview is rejected and the existing boundary remains intact. Correct the source section or edit manually.",
    action: "edit",
    target: 1,
    build: () =>
      session([
        plot(1, "Crossing boundary walk", "#E76F51", [
          [0, 0],
          [200, 200],
          [0, 200],
          [200, 0],
          [0, 0],
        ]),
      ]),
  },
  {
    id: "shared",
    title: "Push a shared edge",
    description: "Two plots already share an edge and an internal handle.",
    hint: "Drag the middle handle on the common edge. Both plots change live, the outer endpoints stay fixed, and Undo restores both after Apply.",
    action: "edit",
    target: 1,
    vertex: 2,
    build: () => adjacent(),
  },
  {
    id: "locked",
    title: "A locked neighbor",
    description: "The same shared edge, with the sugarcane plot locked.",
    hint: "Try moving the middle shared handle: the locked neighbor blocks it. Cancel, edit the sugarcane plot and unlock it to compare the behavior.",
    action: "edit",
    target: 1,
    vertex: 2,
    build: () => adjacent({ locked: true }),
  },
  {
    id: "collision",
    title: "No overlap without a shared edge",
    description:
      "Separate plots with a small gap. They are constrained but not joined.",
    hint: "Drag an orchard vertex toward the sugarcane field. The edit stops before overlap. Align matching endpoints and explicitly join an edge to enable shared pushing.",
    action: "edit",
    target: 1,
    build: () => adjacent({ joined: false }),
  },
  {
    id: "labels",
    title: "Crowded labels and custom notes",
    description:
      "Coordinate leaders, polygon names, a movable key and an independent gate label.",
    hint: "Enter Edit labels and key: the visible layout should stay put. Drag labels, rename the gate, or add a new note and place it anywhere on the map.",
    action: "labels",
    coordinates: true,
    build: () => {
      const s = clone(EXAMPLE_SESSION);
      s.layout = { legend: { onMap: true, x: 0.9, y: 0.9 } };
      s.annotations = {
        names: {},
        coordinates: {},
        custom: [
          {
            id: "gate-note",
            text: "Access gate · add your own note",
            ...{ lat: 12.7903, lng: 79.673 },
          },
        ],
      };
      return s;
    },
  },
  {
    id: "grayscale",
    title: "Similar tones in grayscale",
    description:
      "Two differently colored plots with almost the same grayscale brightness.",
    hint: "Preview the grayscale page. Matching numbers, hatches/dots and light label backplates distinguish the polygons; color editing remains unchanged.",
    action: "export",
    build: () => {
      const s = adjacent();
      s.polygons[0].color = "#4477DD";
      s.polygons[0].name = "கரும்பு வயல்";
      s.polygons[1].color = "#CA5E63";
      s.polygons[1].name = "Paddy field";
      s.annotations.custom.push({
        id: "access-note",
        text: "Shared access",
        ...{ lat: 12.7901, lng: 79.671 },
      });
      return s;
    },
  },
];
export function createExample(id = "farm") {
  const definition = EXAMPLE_CATALOG.find((e) => e.id === id);
  if (!definition) throw Error("Unknown example session.");
  const state = definition.build();
  state.exampleId = id;
  const prefs = {
    ...clone(EXAMPLE_EXPORT_PREFS),
    title:
      id === "farm"
        ? EXAMPLE_EXPORT_PREFS.title
        : `${definition.title} · Kanchipuram`,
    notes:
      id === "farm"
        ? EXAMPLE_EXPORT_PREFS.notes
        : `Synthetic example for exploring PathMap.\n\n${definition.hint}`,
    appearance: id === "grayscale" ? "grayscale" : "color",
  };
  state.exportPrefs = prefs;
  return { state, prefs, definition };
}
