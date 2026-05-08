---
name: add-culvert
description: Add or refine a culvert / 暗渠 feature in `data/culverts.geojson` while enforcing the project's coordinate provenance policy. Triggers when the user says "add a new culvert", "add 暗渠 X", "trace 〇〇川", "新しい暗渠を追加", "〇〇川の線形を入れて", or pastes a Feature snippet they want integrated. Forbids fabricated / interpolated coordinates and routes the work through OSM first, then public GIS, then careful manual tracing from imagery.
---

# add-culvert

Single rule: **no fabricated coordinates**. Lines that linearly interpolate across residential blocks are rejected by this project. Re-read `CLAUDE.md` → "Coordinate provenance policy" before doing anything else.

## When to invoke

- User wants a new feature added to `data/culverts.geojson`
- User wants an existing feature's line refined
- User pasted a Feature object asking to "integrate" / "統合" it
- User says the existing line is wrong / 住宅街を横断している / 不正確

## Required inputs (ask before working)

1. `name` (Japanese, e.g. 旧六郷用水北堀)
2. `areaName` (e.g. 東京都大田区)
3. At least one authoritative `sources[]` entry with `title`, `url`, `publisher`, `licenseNote`. Refuse to proceed without one — sources justify *why* the feature belongs in the map; OSM is only linework, not evidence.
4. Optional but encouraged: `description`, `riverName`, `aliases[]`, `visibleTraces[]`.

If the user pastes a Feature snippet that contains an already-fabricated `coordinates` array, **discard the coordinates** and run the OSM step below. Keep the prose / sources.

## Step 1 — OSM-first lookup

Delegate to the `osm-linework-finder` subagent with the feature name and a sensible bbox derived from `areaName`. The subagent returns either:

- A compact list of `way/<id>` / `relation/<id>` candidates plus a ready `mappings[]` snippet — proceed to Step 2.
- `NO OSM COVERAGE` — fall through to Step 3.

Do not run Overpass queries inline in the main thread; the JSON is large.

## Step 2 — Import via `scripts/import-osm-linework.mjs`

1. Add the feature stub to `data/culverts.geojson` with the user-confirmed metadata and a placeholder geometry of two real nearby points (e.g. start and end node lat/lon already returned by the finder). The script will overwrite `geometry` on import.
2. Append the `{ featureId, kind, osmWayIds | osmRelationId, note }` entry returned by the finder to the `mappings[]` array in `scripts/import-osm-linework.mjs`. Keep the existing entries untouched.
3. Run the importer:
   ```bash
   node scripts/import-osm-linework.mjs
   ```
   If `overpass-api.de` times out (common from this environment), retry with a mirror:
   ```bash
   OVERPASS_URL="https://overpass.kumi.systems/api/interpreter" node scripts/import-osm-linework.mjs
   ```
   For fully reproducible runs, fetch the JSON via `curl` once and replay:
   ```bash
   OVERPASS_FIXTURE=/tmp/overpass.json node scripts/import-osm-linework.mjs
   ```
4. The script auto-sets `lineworkPrecision: "osm-traced"`, `lineworkSources`, `lineworkNote`, `osmElementIds`. Do not edit those fields by hand.

If two ways have a > 80 m gap, the result becomes `MultiLineString`. **Leave it.** Bridging the gap with a fake straight segment violates the policy. Note the gap in the PR description so future work can either contribute to OSM or do a careful manual splice from imagery.

## Step 3 — Public GIS fallback

If OSM has no coverage:

- Check 国土数値情報 (https://nlftp.mlit.go.jp/), 自治体オープンデータポータル, 水道歴史館デジタルアーカイブ, 旧版地形図, 区誌 GIS layers.
- Convert to GeoJSON via a one-off `.mjs` under `scripts/` (do not pull a heavy dependency just for one conversion — `node:fs` + parsing is enough for KML / CSV).
- Set `lineworkPrecision: "manual"`, populate `lineworkSources` with the GIS attribution, and explain the conversion in `lineworkNote`.

## Step 4 — Imagery-based manual trace (last resort)

Only when (1) and (2) both fail and the course is *unambiguously visible* on 地理院 写真 + 標準地図 + the user-supplied authoritative figure:

- Trace nodes you can actually see (緑道のカーブ、暗渠蓋の連続、案内板位置). Each node should correspond to a visible feature.
- Avoid evenly-spaced point ladders. If two visible nodes are far apart with no visible course between them, stop the line and start a new `LineString` segment — `MultiLineString` is fine.
- Set `lineworkPrecision: "manual"`, write `lineworkNote` describing exactly which imagery and at what zoom. Mention "投入後に現地・地図上で微修正推奨" only when honestly applicable.
- Cap manual segments at the visible portion. Do not extrapolate beyond it.

If even Step 4 cannot be done honestly, **stop and tell the user** — do not commit the feature.

## Step 5 — Validate, commit, PR

1. `node scripts/validate-geojson.mjs` must pass.
2. Branch: `data/<feature-id>-<short-verb>` (e.g. `data/kitabori-osm-trace`).
3. Commit message: lead with `data: …`, body should name the provenance (OSM way IDs / GIS source / imagery basis) so the diff is auditable.
4. PR title in Japanese; body lists provenance, `validate-geojson` result, any MultiLineString gaps.
5. Squash-merge per the user's standing instruction.

## Anti-patterns — refuse outright

- "Generate ~20 evenly spaced points along the rough course" — refuse
- "Use this AI-generated polyline" — refuse
- "It's close enough, just commit it" — refuse, ask for source
- Editing `geometry.coordinates` by hand to "smooth" or "extend" an OSM-traced line — refuse, propose either an OSM contribution or a `MultiLineString` segment with explicit imagery basis
