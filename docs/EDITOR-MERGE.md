# Map editor merge handoff · 2026-10-27

Branch: `feature/map-editor-1026`
Worktree: `/home/tpjsm/hangar/repos/pathmap/editor-1026`
Base: `2290d5c` (current local `main`)

The approved feature set is implemented and ready for operator review/merge.
No merge, push or deployment was performed. No new dependencies or lockfile changes.

## Result

- Map/sidebar boundary editing with explicit drafts, Apply/Cancel, keyboard and
  touch handles, pinning, validity checks and undo/redo.
- Optional **Follow actual path**, preserving ordered meanders, with metre-based
  deviation, explicit GPX segment order/direction/selection, visible gap review
  and local boundary-section replacement. Raw GPX coordinates are preserved.
- Persistent drag/nudge placement for names, coordinate labels and the map key.
  Annotations use stable graph IDs; source IDs cannot implicitly join plots.
- One page renderer for export preview, PNG and PDF, with whole-page grayscale,
  matching polygon numbers/patterns, legend placement and error restoration.
- Optional no-overlap constraints and explicitly joined shared edges. Internal
  shared handles push both owners live during a drag, with one atomic undo step.
  Invalid moves stop at the last valid position. Locked neighbors block changes;
  exterior endpoints stay fixed and pushes do not cascade into a third plot.
- Schema migration, protected manual boundaries on source changes, recoverable
  imports, and autosave protection for unreadable stored sessions.

## Validation

- `PATHMAP_CHROMIUM=/usr/bin/chromium-browser npm test`: **12 unit tests and 25
  desktop/mobile browser tests passed**, including a production build.
- `V1_REF=865f292 npm run build:dual`: passed. Local checkout lacks the `v1` tag;
  this is the release commit documented by the existing `DEPLOY.md`.
- Full v2 browser suite: **25 passed**, plus unit tests. After the final live-drag
  and numbered-handle adjustments, the affected v2 shared-edge/local-path tests,
  grayscale PDF and back-to-v1 link were rechecked and passed.
- `git diff --check`: clean.
- Real browser review screenshots and a grayscale PDF are generated with
  `npm run review:editor`; see ignored `review-artifacts/index.html`. They use
  synthetic fixtures on actual Esri imagery, with fresh browser contexts.

Tests cover raw-source preservation, inward bends, explicit disconnected
segments, pins/local replacement, graph/source ID separation, polygon validity,
shared insertion/push/deletion/locks, atomic history, legacy storage isolation,
session-file round trips, invalid imports/stored JSON, label/key placement,
PNG pixels, the PDF's decoded page JPEG and restoration after capture failure.
Mobile checks include CDP touch drag, long-press delete and midpoint insertion.

## Review and remaining manual checks

Read [the editor guide](EDITOR.md) for controls and exact constraints. Run
`npm run build`, then `node scripts/serve-static.js dist 4187 127.0.0.1 /pathmap/`
and open `http://127.0.0.1:4187/pathmap/` for a loopback-only preview.

The approved initial scope uses simple exterior rings, explicit edge joining,
fixed shared exterior endpoints, no recursive push, in-memory history, and the
current viewport resolution for printing. Multi-ring geometry, automatic joining
on arbitrary collision and fixed-resolution offscreen printing are not included.
Real iOS Safari/Android devices and a physical printed page remain manual checks.
There is no outstanding implementation or automated-test failure for this scope.

The main checkout and its unrelated files remain untouched. Merge is the
operator's next action after reviewing this branch; nothing has been published.
