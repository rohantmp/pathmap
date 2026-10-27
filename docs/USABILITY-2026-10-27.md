# PathMap usability and visual review · October 27, 2026

Walked the actual local production UI in fresh Playwright desktop (1440 × 1000)
and iPhone 13 Chromium contexts. Used the synthetic winding orchard, disconnected
tracks and adjacent Orchard/Sugarcane fixtures over actual Esri satellite imagery.
The operator's stored browser session was not used.

## Findings and changes

| Observed friction | Change | Evidence in ignored review-artifacts/ |
| --- | --- | --- |
| Upload and example guidance leave too little sidebar space for editing | Fold upload after loading data; keep + Group accessible; collapse guidance on Try and allow reopening | boundary-draft.png, path-following.png |
| Phone editing toolbar covers a large part of the map; compass intercepts Cancel after initial compaction | Prioritize undo/redo and Apply/Cancel during boundary editing; reserve compass space | mobile-editor.png; touch regression test |
| Shared boundaries is hard to find beneath path controls; draft terminology is unclear | Add a shortcut, explain Apply/Cancel directly, show a color key for filled and blue handles | boundary-draft.png, shared-edge-push.png |
| Long area names and duplicate hover cards crowd the phone map | Wrap long names and hide redundant hover cards during boundary editing | mobile-editor.png |
| Last Settings tab can be clipped | Five visible equal-width tabs, keyboard focus outlines | placement.png |
| Notes require Markdown syntax; preview button is buried | Visual formatting controls, live prose preview, optional source mode, page preview in fixed footer | notes-editor.png, mobile-notes.png |
| Source paths are hard to inspect without overlays | Persistent GPX-only view; preserve disconnected segment breaks | tracks-only.png |
| Compass north letter is too small/clipped | Move N inside the rose and enlarge it | mobile-editor.png |

## Verification

15 unit tests and 38 desktop/mobile browser tests pass on the final v2 build.
New checks exercise rich formatting, numbered/bullet lists, literal text/HTML-safe
paste, text undo/redo, keyboard tabs, notes saved through export and reload,
track-only visibility/persistence/segment breaks, handle-key lifecycle, upload/help
disclosure, and actual phone taps on Cancel, formatting and page preview.
Existing geometry, shared boundary, storage and export regressions remain green.

Screenshots and a real grayscale PDF can be regenerated with npm run review:editor;
review-artifacts/index.html is the gallery. These show the implementation, not
simulated geometry. Baseline screenshots remain in review-artifacts/usability/.
Real iOS/Android keyboards, Safari editing commands and physical printing remain
manual checks. No dependencies changed and nothing was merged or published.

The legacy one-click farm loader has also been removed from the empty state and Session tab. Both now direct users to the single Example sessions menu. Regression coverage confirms the menu lists all nine examples and loads the farm session on desktop and mobile.

Follow-up: removed the duplicate Example sessions button from Session settings. The primary menu above Settings remains the single entry point.
