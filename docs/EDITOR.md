# PathMap map editor

Implemented from the operator-approved October 26 design, including the correction
that path fidelity means **following the actual walked path**, not choosing a
convex/concave hull algorithm. The existing satellite map, groups, Tamil names,
source tracks and session controls remain available.

## Editing boundaries

Click an area/name on the map, use its **Edit boundary** card button, or select it
under Settings → Edit. The **Shared boundaries** shortcut opens the joining and
no-overlap controls. A map key explains handle colors: filled area-color handles
move vertices, blue midpoints insert them. The compass includes a visible N.
Solid handles move vertices; hollow midpoint handles add
one. Right-click/long-press or the Delete selected button removes a vertex. A
focused handle supports arrow-key nudging (Shift uses a larger step). Escape or
pointer cancellation restores the position at the start of a drag.

Changes stay in a draft. **Apply** commits all affected polygons as one undo step;
**Cancel** restores the committed shapes. The white dashed outline shows the
original boundary. Undo/Redo works within the draft and for committed changes,
with Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z shortcuts. History keeps at most 80 snapshots
in memory and resets on reload/session replacement. Map movement is not an undo
step. Save/export uses committed geometry; apply/cancel a draft first.

Invalid rings (crossings, self-touch, doubled-back edges, collapsed area and
zero-length edges) cannot commit. Existing imported source points are preserved.

## Follow actual path

Enable **Follow actual path** to preview a boundary built in GPX point order,
including inward bends. **Maximum deviation (metres)** reduces detail only within
the selected ordered sections; zero retains their distinct samples. The broad
outline remains available when the option is off. Original tracks are never
rewritten by boundary editing.

GPX track-segment and route breaks are preserved. Select the source sections in
the inspector to include/exclude, reorder, reverse or trim them. Orange lines show
the source; red dashed lines and distance labels show connecting gaps over 2 m.
Those gaps require explicit acknowledgement before a preview can be accepted.
No nearest-neighbor track joining or automatic buffer/corridor conversion occurs.

For local control, select a source segment and its first/last point indices, then
choose a boundary section using the numbered vertex tooltips or Start/End at
selected vertex buttons. **Follow selected section** replaces just that section.
Boundary section numbers are one-based; source indices are zero-based. The first
version supports increasing section endpoints within one ring; use full-boundary
following or manual editing for a section crossing the ring's start.

**Pin vertex** protects a sample from detail reduction, including a manually moved
sample. A preview that would discard a pin is rejected. A pinned manual midpoint
without a GPX sample must be unpinned before regeneration. Adding, deleting or
moving source tracks preserves manual/followed/shared boundaries and marks their
source as changed; regeneration is always an explicit preview.

Supported results are one simple exterior ring per polygon. Open/disconnected
walks need reviewed connecting edges. Self-crossing walks, holes and multi-part
results are not silently repaired, filled or discarded. Tolerances are calculated
in a local metre projection; editing within 5° of a pole is rejected. The
geometry-only 10,000-point regression includes validation and simplification;
it does not promise a fixed rendering latency for thousands of map handles.

## Edit labels and the map key

Use **Edit labels and key** to drag polygon names/areas and coordinate labels;
arrow keys also nudge focused labels. Coordinate labels are enabled under Display.
Their values still describe the associated boundary vertex. Stable vertex IDs
keep labels attached through insertions/deletions; deleted vertices lose their
labels rather than transferring them by array index.

Under Labels, choose an on-map key or the existing below-map export table. The
on-map key drags/nudges in placement mode and remains inside the map frame. Names
and coordinate labels have geographic anchors; the key has normalized frame
coordinates, so pan/zoom does not move it geographically. Reset pinned labels &
key returns to automatic placement. All placements travel in session files.

### Custom text labels

Use **Add label** in the map toolbar, type the note in the Labels panel, then
choose **Place on map** and click/tap its location. Escape or Cancel placement
stops the action without adding anything. While **Edit labels and key** is active,
custom notes support drag, arrow-key nudging and Delete. The Labels panel also
renames and deletes them. Undo/Redo and session Save/Load include the notes, even
when no polygon exists. They appear in PNG/PDF and use light text backplates;
grayscale applies to them with the rest of the page. Reset pinned labels/key
preserves custom notes.

Entering label editing freezes the exact currently visible spread layout. It
neither reinitializes label positions nor saves unmoved automatic labels as pins.
Dragging one label leaves the others at their existing positions.

## Example sessions menu

**Example sessions** above Settings opens a menu with nine synthetic scenarios.
Each loaded example includes a short guide and a **Try** action that opens the
relevant editing controls. Loading an example asks before replacing an active
survey; cancelling leaves the survey and any draft intact. The original farm
example remains a quick action on the empty screen and under Session.

| Example | What to try |
|---|---|
| Farm survey overview | Groups, Tamil/Latin labels, visibility and export |
| A path that meanders | Enable Follow actual path; compare broad outline and detail |
| Disconnected GPX segments | Review gap markers or exclude an unrelated segment |
| A crossing boundary walk | An invalid followed outline is rejected |
| Push a shared edge | Drag the existing internal shared handle; both owners move |
| A locked neighbor | The same push is blocked until the neighbor is unlocked |
| No overlap without a shared edge | Collision blocks a move without joining plots |
| Crowded labels and custom notes | Enter editing without a layout jump; add and place a note |
| Similar tones in grayscale | Preview matching numbers/patterns over imagery |

## Export preview and grayscale

PNG/PDF export adds **Color / Grayscale + distinct marks** and **Preview final
page**. Refresh the preview after changing form options. The same composition
renderer produces the preview, PNG and the single fitted PDF page, including
page size/orientation, title/notes, map, key and attribution.

Grayscale converts the entire composed image to equal RGB channels. Numbered
polygon names and matching hatch/dot/line marks distinguish areas; labels have
light backplates. Export-only names affect the map and legend for the capture
and are restored even after an error. Color editing values remain unchanged.
Export preferences are saved with the session and take precedence on load.

Resolution follows the current map viewport at 2× CSS pixels. An offscreen map
at a fixed print resolution is outside this release. The map is fitted to one
page; exceptionally long notes or many legend entries can make content small.
The preview makes that scaling visible. Geographic exports use committed rings
and honor hidden/focused polygons/groups; grayscale affects PNG/PDF appearance.

## Shared edges and no overlap

Under Edit → Shared boundaries, enable **Prevent polygon overlap**. It validates
all polygons, including hidden ones. Existing overlaps must be resolved explicitly
before enabling it; there is no automatic ownership decision or clipping.

Choose a neighbor and **Join matching edges (within 1 m)**. Both endpoints of an
edge must match within that tolerance. The neighbor snaps to the selected edge in
the draft, and Apply commits both. Splitting an existing shared edge inserts the
same node in both rings. Dragging that internal node pushes the boundary into the
neighbor while keeping exterior endpoints fixed. Both areas update; one undo
restores both. Delete a shared internal node in the same way.

Without a joined edge, an overlapping gesture is rejected and the prior draft
shape restored. A locked neighbor blocks insertion/movement/deletion. Shared
exterior endpoints are fixed; add a midpoint to push instead. Junctions touching
an exterior boundary are also fixed. There is no recursive push through a third
plot. Regeneration cannot silently break shared topology. A shared edge remains
shared when the overlap toggle is switched off; disabling the toggle does not
silently detach ownership.

## GPX tracks only

Under Settings → Display, **GPX tracks only** hides polygon fills/outlines,
group outlines, coordinate/name/custom labels and the map key. Visible plots'
original GPX segments remain, without invented lines across segment breaks.
Hidden/focused plots retain their visibility rules. This view survives reload and
session files; switching it off restores the areas and annotations. Starting
boundary or label editing returns to area view. **Show GPX tracks** independently
controls whether tracks also appear alongside polygons.

## Writing export notes

In Export map → **Title and notes**, Write is the default editing mode. Select
text and use headings, bold, italic, underline, bullet/numbered lists, clear style
and text undo/redo. **How it will appear** previews the title and notes using the
same safe prose renderer as PNG/PDF. The optional **Markdown source** tab retains
existing session compatibility. Tabs support arrow-key navigation; pasting inserts
plain text so copied HTML cannot execute. Notes remain lightweight prose: arbitrary
HTML, links, images and advanced nested lists are not authoring controls.

**Preview page** stays in the export footer alongside Cancel and downloads. It
previews the complete composition, including map, labels/key and grayscale.
Preview/download saves export preferences with the session, as before.

## Interface layout

Once a session contains areas/groups, Add Polygons folds to make room for editing;
open it again to upload more GPX files. + Group and Example sessions remain
accessible. Each example has collapsible guidance; Try collapses it while opening
the relevant controls. All five Settings tabs fit the sidebar. On phones, boundary
editing prioritizes undo/redo, Apply/Cancel and status above the map; Apply or Cancel
returns the other tools. The toolbar leaves room for the compass and touch targets.

## Persistence and implementation

Schema 2 adds boundary parameters/source references, stable graph node IDs,
annotations, legend layout and the no-overlap setting. GPX sample IDs and graph
node IDs are separate: transferring a track cannot implicitly join plots.
Legacy sessions migrate without recalculating committed hulls. v2 still uses
`pathmap_session_v2`, copies v1's key only on first use, and never writes v1's key.
Invalid imports leave the active survey intact. Unreadable stored sessions pause
autosave until a valid Load or explicit Clear All; storage failures are visible
and Save can download the in-memory committed survey.

- `geometry.js`: metre projection, ring/coverage validation, ordered simplification,
  source assembly and atomic shared-node edits.
- `editor-state.js`: migration/validation, history and annotation cleanup.
- `editor.js`: drafts, mode controls, source inspection, custom text labels, placement and key.
- `example-sessions.js`: isolated synthetic fixtures and guided edge-case metadata.
- `map-manager.js` / `label-manager.js`: Leaflet handles and stable anchored labels.
- `export.js`: shared page renderer, monochrome marks and downloads.
- `notes-editor.js` / `notes-format.js`: visual authoring, safe prose serialization and shared preview rendering.

No new runtime dependencies or lockfile changes.

## Verification and merge review

```sh
npm ci
npx playwright install chromium           # once per machine, if needed
npm test                                 # unit tests, production build, desktop/mobile browser suite
# A system browser may be selected explicitly:
PATHMAP_CHROMIUM=/usr/bin/chromium-browser npm test
V1_REF=865f292 npm run build:dual          # local v1 tag is absent; use its documented release commit
PATHMAP_CHROMIUM=/usr/bin/chromium-browser npm run test:v2
npm run preview:dual                     # localhost:4173/pathmap/v2/
```

Browser tests exercise real PNG/PDF downloads, equal-channel PNG pixels and the
PDF's decoded embedded JPEG, restoration after capture failure, actual winding
paths, local replacement/pins, disconnected segments, shared pushes/locks,
undo/redo, legacy migration, invalid-session recovery and touch editing. Geometry
unit tests cover ring validity, overlap/containment/coincidence, source gaps,
pinning, shared insertion/deletion, fixed endpoints, non-cascading collisions,
source/graph ID isolation and migration/history invariants.

Mobile verification uses Chromium device emulation, including CDP touch events.
Real iOS Safari/Android and a physical printed PDF remain manual checks. Map
imagery is externally fetched; browser checks need map-tile network access.

To regenerate local review screenshots/PDF using fresh browser contexts, start a
loopback preview (`node scripts/serve-static.js dist 4187 127.0.0.1 /pathmap/`)
and run `PATHMAP_CHROMIUM=/usr/bin/chromium-browser npm run review:editor`.
`PATHMAP_REVIEW_URL` selects a different local preview. The ignored
`review-artifacts/index.html` is the resulting gallery; fixtures are synthetic.
