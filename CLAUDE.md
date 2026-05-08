# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static, single-page web app: 暗渠マップ (Ankyo / culvert map for Japan). Pure browser app — no build step. Vanilla JS + MapLibre GL JS loaded via unpkg CDN, geographic data from `data/culverts.geojson`, raster tiles from 地理院タイル (GSI). Target use case is mobile walking/exploration.

## Commands

Local dev server (must serve via HTTP — `file://` blocks GeoJSON fetch):

```bash
python3 -m http.server 4173
# http://127.0.0.1:4173/
```

Validate GeoJSON (run before committing data changes):

```bash
node scripts/validate-geojson.mjs
```

Refresh OSM linework for OSM-traced features:

```bash
node scripts/import-osm-linework.mjs
```

Smoke test (Playwright; expects dev server already running on `http://127.0.0.1:4173/`):

```bash
node scripts/smoke-test.mjs                                    # default URL
node scripts/smoke-test.mjs http://127.0.0.1:4173/             # explicit URL
PLAYWRIGHT_IMPORT=/abs/path/to/playwright BROWSER_EXECUTABLE=/abs/path/to/chromium node scripts/smoke-test.mjs
```

Smoke test writes screenshots to `/tmp/culvert-map-{desktop,mobile}.png`.

## Architecture

Three-file frontend, no bundler, no framework:

- `index.html` — app shell. Loads MapLibre 5.23.0 + `app.js` with `defer`. Static structural elements: `#map`, `#wardSelect`, `#layersPanel`, `#detailSheet` (bottom sheet on mobile, side panel on desktop via CSS media query at 760px).
- `styles.css` — all visual styling. Mobile-first; desktop layout switches at `(min-width: 760px)`.
- `app.js` — single module, plain script (not ESM). Top-level `init()` fetches GeoJSON + waits for MapLibre, then mounts the map and wires UI. State lives in one module-scoped `state` object; `els` caches DOM nodes. Persistence via `localStorage` keys `culvert.favorites` and `culvert.lastView`.

Map style is constructed inline in `app.js` (`mapStyle` object) — four GSI raster sources (std/pale/photo/hillshade) with layer visibility toggled by the layers panel. Culvert features are rendered as four stacked layers from the same `culverts` source: `river-reference` (filtered to `riverReference == true`), `culverts-shadow` (white halo), `culverts-line` (colored line, recolored on selection via `setPaintProperty`), `culverts-hit` (invisible wide click target). Selected feature also gets a circle pair (`selected-point-halo` + `selected-point`).

Selection flow: `selectFeature(id, {fit, pushUrl})` is the single entry point — updates `state.selectedId`, recolors the line layer, repositions the selected-point source, re-renders the detail panel, syncs the ward selector, and optionally `history.replaceState`s `?id=…`. Initial selection comes from `?id=` URL param or first feature.

Region picker (`#wardSelect`) replaces free-text search. Options are derived at runtime by `populateWardSelector()` → `extractWards(areaName)` which strips a leading `東京都` prefix and splits on `・、,/`. Selecting a ward calls `selectWard(ward)` to fit-bounds across all matching features and select the first as the active feature. River-reference features are excluded from the picker, the detail panel, and selection.

## Data model

`data/culverts.geojson` is a `FeatureCollection`. Each Feature is `LineString` or `MultiLineString`. Required props (enforced by `scripts/validate-geojson.mjs`):

- `id`, `name`, `areaName`, `sources[]`, `lastVerifiedAt` (`YYYY-MM-DD`)
- `sources[]` items need `title`, `url` (http/https), `publisher`, `licenseNote` — at least one entry for non-river-reference features
- Coordinate validator clamps to Japan extent: lng 122–154, lat 20–46

Optional props (rendered when present, but not required — keeps research cost low when scaling):

- `description` — free prose, shown in detail panel only when set
- `evidenceRank: "A" | "B" | "C"` — curation confidence; format-validated when present
- `riverReference: true` — render as muted river-reference line, exclude from picker / detail / selection
- `lineworkPrecision: "manual" | "osm-traced"`, `lineworkSources[]`, `lineworkNote`, `osmElementIds[]` (`way/123` or `relation/123`) — set by `import-osm-linework.mjs`; surfaced in detail panel as the 線形出典 section
- `riverName`, `aliases[]`, `tags[]`, `visibleTraces[]` — accepted by validator for backward compat but no longer indexed or rendered

OSM is treated as linework assistance only — never as evidence. `sources[]` carries the public/administrative attribution that justifies inclusion.

## Linework imports (`scripts/import-osm-linework.mjs`)

Hardcoded `mappings[]` array lists feature IDs paired with either `osmWayIds[]` or `osmRelationId`. Pulls from Overpass API, stitches segments end-to-end with an 80m join tolerance (`stitchSegments`), writes back into `data/culverts.geojson` and stamps `lineworkPrecision: "osm-traced"` + `lineworkSources` + `osmElementIds`. ODbL 1.0 — must keep `OpenStreetMap contributors` attribution in app footer + README when shipping.

`OVERPASS_URL` env var overrides the endpoint (use a mirror like `https://overpass.kumi.systems/api/interpreter` if the default times out). `OVERPASS_FIXTURE` env var loads OSM JSON from a local file instead of fetching, for offline / fully-reproducible runs.

## Coordinate provenance policy

Every feature in `data/culverts.geojson` must have linework that traces a real-world course. Inventing coordinates draws lines through houses and ruins user trust. **Never commit synthesized, AI-generated, or evenly-interpolated coordinate ladders.**

Allowed sources of `geometry.coordinates`, in order of preference:

1. **OSM way / relation IDs** — pulled via `scripts/import-osm-linework.mjs`. Sets `lineworkPrecision: "osm-traced"` automatically. Always check OSM first.
2. **Public-sector GIS** (国土数値情報, 自治体オープンデータ, 水道歴史館アーカイブ等) — when downloadable as GeoJSON / Shapefile / KML and the license permits redistribution. Add a one-off conversion script under `scripts/`.
3. **Manual digitization from authoritative imagery** (地理院 写真 + 標準地図 + 公式景観資料) — only when (1) and (2) are unavailable. Trace nodes that you can actually see on the imagery; do not interpolate. Set `lineworkPrecision: "manual"` and document the imagery basis in `lineworkNote`.

Forbidden:

- Linearly interpolated polylines that ignore the actual road / 緑道 / 水路 geometry
- AI-generated guess coordinates
- Long straight segments through residential blocks "to fill the map"
- Bridging an OSM stitch gap with a fake straight segment — let `import-osm-linework.mjs` produce a `MultiLineString` instead

Workflow when adding or refining a feature:

1. Use the **`add-culvert` skill** (`/add-culvert`) to walk through provenance, OSM lookup, and import. The skill enforces this policy.
2. Delegate the OSM search itself to the **`osm-linework-finder` subagent**, which runs Overpass and returns a compact ID table + ready `mappings[]` snippet without dumping raw JSON into the main context.
3. If neither OSM nor public GIS covers the feature and you cannot do a careful manual trace from imagery, **do not commit** the feature.

Always run `node scripts/validate-geojson.mjs` after editing `data/culverts.geojson`.

## Conventions

- All UI strings in Japanese — match existing tone in detail / toast / aria-label text.
- No build, no transpile, no package.json — keep `app.js` plain script semantics. Do not introduce ESM-only syntax in `app.js`.
- Browser API only in `app.js`. Node-only scripts go under `scripts/` as `.mjs`.
- Run `node scripts/validate-geojson.mjs` after any `data/culverts.geojson` edit.
