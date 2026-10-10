# Deployment: tests, the v1/v2 parallel site, and the cutover

The site is published by GitHub Pages from `.github/workflows/deploy.yml`. Since the
2026-10 touch-up it is a **dual site**:

| URL | Serves | Built from |
|-----|--------|------------|
| https://rohantmp.github.io/pathmap/ | **v1**, the version that was already live | git tag `v1` (commit 865f292), built with its own `vite.config.js` at base `/pathmap/` |
| https://rohantmp.github.io/pathmap/v2/ | **v2**, the current `main` | `HEAD`, built with `PATHMAP_BASE=/pathmap/v2/` |

v1 is rebuilt from the tag on every deploy but never changes; v2 is the only thing that
moves. v2 shows a small "v2 preview · back to v1" link under the title; v1 is untouched.

## Workflow

`deploy.yml` has three jobs:

1. **test** (every push to `main`, every pull request): `npm ci`, install Chromium,
   `npm test`. `npm test` builds `HEAD` into `dist/` (the `pretest` hook) and runs the
   Playwright suite in `tests/` against `scripts/serve-static.js` on port 4199 (a plain
   static server with directory-index semantics like Pages; `vite preview` cannot serve the
   dual layout because it falls back to the root `index.html` for `/pathmap/v2/`).
2. **build** (pushes to `main` only, needs *test*): `npm run build:dual` →
   `scripts/build-dual.sh` builds `HEAD` into `dist-dual/v2/` and the `v1` tag into
   `dist-dual/`, then uploads `dist-dual/` as the Pages artifact.
3. **deploy** (needs *build*): publishes the artifact.

A failing test fails *build*, so nothing is deployed. Pull requests only run *test*.

The `v1` tag must exist on the remote: `git push origin v1`. The build job checks out
with `fetch-tags: true` and extracts the tag with `git archive`.

## Local verification

```bash
npm test                       # build HEAD -> dist/, run the suite at /pathmap/
npm run build:dual             # dist-dual/index.html (v1) + dist-dual/v2/index.html (v2)
npm run preview:dual           # http://127.0.0.1:4173/pathmap/ (v1) and /pathmap/v2/ (v2)
npm run test:v2                # run the suite against dist-dual at /pathmap/v2/
```

The suite needs Chromium once: `npx playwright install chromium` (`--with-deps` on a
bare Linux box). It takes about two minutes and covers GPX loading, name escaping,
hide/reload, groups and boundaries, transliteration, the export dialog with front
matter and export-only renames, PNG/PDF/KML/GeoJSON downloads, mouse and touch vertex
editing, the bundled example session, the v1→v2 storage seeding, and the phone layout.

## Storage: v1 and v2 share an origin

Both versions live on `rohantmp.github.io`, so they share `localStorage`.

- v1 reads and writes `pathmap_session`.
- v2 reads and writes `pathmap_session_v2`. On its first run in a browser that has no
  v2 key it copies `pathmap_session` into `pathmap_session_v2` (read-only copy; v1's key
  is never written by v2). Export preferences live in `pathmap_export_prefs`, which v1
  does not use.
- The session shape is the same in both directions: a v2 `.pathmap` file loads in v1 and
  vice versa. `tests/desktop.spec.js` ("v2 seeds from a v1 session…") checks the
  seeding, the untouched v1 key, and the matching key set.

## Cutover: making v2 the default later

1. Decide whether to keep the old version reachable. If yes, tag the current default
   (`git tag v1-legacy 865f292`) and keep serving it at `/pathmap/v1/`.
2. In `deploy.yml` → *build*, replace `npm run build:dual` with either
   - `npm run build` and upload `dist/` (v2 becomes the only version), or
   - a variant of `scripts/build-dual.sh` with `V2_BASE=/pathmap/` for `HEAD` and the
     legacy tag built with `PATHMAP_BASE=/pathmap/v1/` into `dist-dual/v1/` (v1's
     `vite.config.js` has a hard-coded base, so patch it in the temp checkout or build
     a commit that reads `PATHMAP_BASE`).
3. Storage: once v2 is the default, switch `STORAGE_KEY` in `storage.js` back to
   `pathmap_session` and keep the seeding logic pointed at `pathmap_session_v2` for one
   release so nobody loses work; or keep the v2 key for good (simplest).
4. Remove `setupVersionLink()` / `#version-link` in `main.js` and `index.html`, or point
   it at the legacy path.
5. Update this file and `README.md`.

## Manual deployment

```bash
npm run build:dual
npx gh-pages -d dist-dual      # after: npm install --save-dev gh-pages
```

## Troubleshooting

- **Assets 404 under /v2/**: the build must have `PATHMAP_BASE=/pathmap/v2/` (the
  single-file build inlines everything, so only the HTML path matters).
- **`git archive v1` fails in CI**: the tag was not pushed, or the checkout ran without
  `fetch-tags: true`.
- **Tests fail only in CI**: open the `playwright-report` artifact attached to the run.
