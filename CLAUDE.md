# CLAUDE.md — VaseForge

## Purpose

VaseForge (وازفورج) is a local web app that generates parametric, trend-driven vases for FDM printers.
Every mesh it produces is manifold, slicer-ready and checked for printability on every change.
The current work adds **sleeves**: 3D-printed organic shells that wrap a straight glass or steel
tube insert (see `docs/references/` for the target look).

Read these before non-trivial work:

- `docs/sleeve-integration.md`: **authoritative** plan for the sleeve work. It wins over `docs/sleeve-spec.md`.
- `docs/ARCHITECTURE.md`: layering, data flow, params pipeline, printability, exports, AI.
- `docs/GEOMETRY.md`: every formula (master field, profiles, sections, effects, rim/base, mesh assembly).
- `docs/sleeve-spec.md`: the original sleeve brief (requirements and parameter list; skim only).

## Stack

- Vite + React 18 + TypeScript (strict), Tailwind 4 (fa RTL / en LTR, Vazirmatn font).
- three.js via @react-three/fiber and drei for the viewer.
- zustand (state), comlink (workers), zod 4 (params), lz-string (share links).
- `server/`: tiny Node AI proxy using the Anthropic SDK; it holds the API key.
- vitest for tests (core only, Node environment, no DOM).

## Core invariant

> UI and AI produce **params** only. Geometry comes from deterministic build functions, one per mesh path.

Two paths, picked by `buildDesign` (`printability/index.ts`): `buildMesh(params, quality)` in
`src/core/geometry/mesh.ts` (vase modes) and `buildSleeveMesh(params, voxel)` in `src/core/sleeve/` (sleeve mode).
Every slice is a star-shaped polar function `r(θ)` about its slice centre `C(t)`, built on a
twist-aligned grid, so topology is fixed (genus 0) and the manifold check is cached per topology.
Output modes: `solidVase`, `shell`, `doubleWallVase`. **Never break the star-shaped invariant for these modes.**
Shell mode's `print.innerSurface: 'bore'` (S1) is an exact tube bore inside the same grid builder (GEOMETRY.md §7b).

## Architecture summary

```
src/core/          pure TS — no DOM, no three, no react/zustand (enforced by eslint)
  params/          schema.ts (zod + paramMeta, SCHEMA_VERSION, DEFAULT_PARAMS), migrate, clamp, normalize, share, paths
  insert/          computeBore, boreProfile (chamfers, grooves, ribs), boreRay, calibrateHoleCompensation
  sdf/             smin / smax / cylinder
  sleeve/          skin map (cached), top edge, hole map + hole fields (cached), strands (fingers/drips), SDF, build
  mc/              generated MC table, slab extractor with 2-level narrow band, Taubin, islands, O(T) validity
  geometry/        profile · sections · twist · effects/* · field (compileField) · grid · mesh (buildMesh)
  printability/    checks, bore, sleeve, sleeveFix, overhang, sanity, stats, score, autofix, index (analyze/buildDesign)
  export/          stl · obj · threeMF · zip · weld · slicerSettings
  random/          mulberry32, simplex 2D/3D
  jsonpatch/       RFC 6902 apply + validate
src/workers/       geometry.worker.ts: regen(params, quality) → transferable buffers + report; export runs in a 2nd instance
src/state/         zustand store (params, locks, history/undo, result, ui prefs), RegenScheduler (latest-wins)
src/ui/            panels, editors, viewer (heatmap, clipping, dimensions), TopBar, PrintCheck, AiPanel
src/persist/       IndexedDB designs + calibrated printer profiles; share links are lz-string diffs vs DEFAULT_PARAMS
src/ai/            prompts (system prompt generated from paramMeta), schema, client, apply
src/presets/       21 generated preset JSON files (14 vase + 7 sleeve) + index (scripts/build-presets.ts)
server/            AI proxy: /api/ai/params | refine | image | health
tests/             vitest, core only
```

Key flows:

- **Params pipeline:** `raw → migrate → clamp → parse → normalize`. Ranges live only in the zod schema;
  `clamp.ts` reads them. `paramMeta` drives UI controls, `visibility.ts` and the AI prompt.
- **Regen:** slider sets params (transient during drag, one history entry on release) → worker builds at
  `low` while dragging and `render.previewQuality` on release → buffers come back as Transferables.
- **Printability:** `analyze()` → `{ score, issues[], stats, vertexOverhang }`. Issues carry severity,
  height range, fa/en message and a declarative `fixAction`. Any error caps the score at 69.
  Auto-fix is ablation-based on a low-res grid and lands as one undoable history entry.
- **Exports:** binary STL, OBJ, 3MF (hand-written zip, `CompressionStream`), JSON, ZIP bundle, Fit Test Ring STL.

`src/core/params/schema.ts` is large (~1400 lines). Grep it for the block you need instead of reading it whole.

## Sleeve plan (summary — `docs/sleeve-integration.md` is authoritative)

- Sleeve = new `print.outputMode = 'sleeve'` with its **own** deterministic mesh path,
  `buildSleeveMesh(params, quality)`, because sleeves need through-holes (genus > 0) and free-standing fingers.
- Skin = the existing master field `r(θ, z)` rasterised to a periodic map and turned into an SDF, so all
  vase styles and effects work on sleeves. Composition order is fixed (integration doc §3):
  skin → smin fingers/drips → smin core tube → smax top edge → smax holes (teardrop tops) → flat base → exact bore (last).
- New pure modules: `src/core/insert/` (computeBore), `src/core/sdf/`, `src/core/sleeve/`, `src/core/mc/`
  (marching cubes, snapping, smoothing, island removal, manifold check — not cached by topology).
- `buildSleeveMesh` returns the **same buffer contract** as the grid path (positions, indices, normals,
  per-vertex overhang, report) so viewer, heatmap, clipping and exporters work unchanged.
- New params: `insert` (shared), printer `holeCompensation`, `sleeve.{fingers,drips,holes,topEdge,mesh,selfSupporting}`.
  Bump `SCHEMA_VERSION` with a migration. Prefer existing params; document any new one in the integration doc.
- Bore accuracy must be ±0.05 mm. `R_bore` is derived by `computeBore`, never stored.
- The AI must never change `insert.*` unless the user explicitly asks.

Phases (one branch `sleeve/sN` and one PR each):

| Phase | Scope                                                                                                                               |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| S0    | CLAUDE.md, baseline green, golden test. No behaviour change.                                                                        |
| S1    | `insert` block, `computeBore`, shell `liner: 'bore'`, printer `holeCompensation`, Fit Test Ring, calibration modal, bore check.     |
| S2    | `outputMode: 'sleeve'` + Vase/Sleeve switch, skin map, SDF core/bore/base/top edge/noise holes, MC pipeline, sleeve checks, export. |
| S3    | Fingers, drips, all hole modes + teardrop + bridges, six `sleeve-*` presets, sleeve auto-fix, variations.                           |
| S4    | Viewer insert/material previews, AI sleeve rules, multi-bore batch export, perf, docs update.                                       |

Do only the phase you were asked for.

**Status:** S0, S1, S2a, S2b and S3 are done. S4 (viewer insert/material previews, hard AI insert filter, multi-bore
batch export, perf, docs) is next.

S3 notes (GEOMETRY.md §13c–§13f, integration §5 "As implemented in S3", `docs/preset-tuning.md`):

- Schema v5: `sleeve.fingers`, `sleeve.drips`, `sleeve.selfSupporting`, hole modes ellipses/voronoi/foldGaps, organic
  style `blobs` + `warp`. Smoother defaults (smoothing 4, edge roundness 1.5, 2.5 mm rim blend, one-octave holes).
- Fingers/drips are round-cone polylines (`sleeve/strands.ts`); skin and core are capped at `z_body`, holes stop there.
  Tilt ≤ maxOverhang − 3° by scaling lateral motion; radii ≥ max(1.25, lineWidth). Strand tips are soft overhang zones.
- Hole modes only fill the thresholded field (`sleeve/holeFields.ts`); never add a second hole pipeline.
- Sleeve auto-fix = `printability/sleeveFix.ts` (shape knobs without holes at 3 mm, then hole knobs; ≤ 8 steps; slow on
  hard cases because the hole map rebuilds: S4). Variations: 3 × 3 for sleeves, no per-cell auto-fix.
- The six `sleeve-*` presets are tuned in `docs/preset-tuning.md` (known look gaps listed there).
- Measured (Node, warm): presets without strands drag 2 mm 130–240 ms, release 1.5 mm 280–470 ms + 50–120 ms
  analysis, export 0.5 mm 3.4–5.3 s; with fingers/drips drag ≈ 0.8 s, release ≈ 1.5 s, export 15–19.5 s (strand SDF:
  S4 target, together with the hole map).

S2b notes:

- Schema v4: `sleeve.holes.*` (organicNoise) and `sleeve.topEdge.*`; preview voxel default 1.5 mm; 3MF first in sleeve mode.
- Holes live on a cached 2D map over (φ, z) (`sleeve/holes.ts`, toolkit `sleeve/grid2d.ts`), independent of the
  voxel; the SDF samples its signed distance `g` (at the bore radius, 1-Lipschitz). GEOMETRY.md §13a/§13b.
- Teardrops are a layer sweep `D_j = max(d_j, D_{j−1} − dz·tan α)` (the spec formula with every row a sample;
  8–12 samples leave shelves, and a 2D distance would need sin α). Bridges: thinnest first, capsule + closing
  merge, guarded (> 1/3 turn or > 2.5 × size ⇒ drop the smaller), then a finisher that drops holes still in conflict.
- Coverage: bracketed threshold search, then a δ offset; every candidate ends teardrop → islands → bridges → finisher.
- Sleeve overhang skips the bed seam (first voxel) and counts teardrop tips (`HoleMap.tip`) as yellow at most.
- `VASE_PRESETS` / `SLEEVE_PRESETS`: golden test and vase-only loops use the 14 vase presets. `Issue.fixes` = extra fix buttons.
- Measured (Node, warm, sleeve-starter): drag 2 mm ≈ 260 ms; release 1.5 mm ≈ 500 ms + 130 ms analysis; export 0.5 mm
  ≈ 4.6 s build. The hole map (voxel-independent, cached) costs ≈ 1.4 s per hole/skin change: the S4 perf target.

S2a notes:

- Schema v3: `outputMode: 'sleeve'` + `sleeve.{coreBlend, mesh.{previewVoxel, exportVoxel, smoothing}}`.
- Sleeve SDF = skin map of the vase field (Lipschitz-corrected) → smin core tube → top at H → flat base → exact
  S1 bore last (floor bottoms have no opening term). GEOMETRY.md §13 has every formula.
- Marching cubes: the case table is generated (face rules + face-safe fan apex); never hand-edit it. Lattice is
  offset by half a voxel on all axes; a failed validity check retries once on a 0.3-voxel offset and logs it.
- Sleeve meshes keep the `VaseMesh` contract (`mode: 'sleeve'`, one `outer` + a `bottom` bed range, identity
  `canonical`) plus `mesh.sleeve` (bore/base vertex ids, islands, validity, timings).
- Measured (Chromium, warm): drag 2 mm 65–175 ms; release 1 mm 400–630 ms + 35–65 ms analysis (target 300 ms,
  missed; parallel slab workers in S4 is the planned fix); export 0.5 mm 2.5–2.9 s build, ≈ 5 s end to end.
- The viewer renders on demand (`frameloop="demand"`); call `invalidate()` after imperative three.js updates.
- Slow sleeve tests live in `tests/sleeve.slow.test.ts` and run in CI with `npm test`.

S1 notes:

- Schema v2: `insert` block, `print.printer.holeCompensation` (also in `PRINTER_PRESETS`), `innerSurface: 'bore'`,
  plus the new `insert.bottomChamfer` (elephant's foot). `migrate.ts` is the first step of `normalizeParams`.
- Bore liner: exact `R_bore` along slice rays (bend-safe), bottom open/lip/floor/drain, entry + bottom chamfers,
  O-ring grooves and grip ribs. Ribs fit the grid model cleanly, so they shipped in S1 (not deferred to S2).
- `VaseMesh.bore` carries what the `bore` checks need; the Fit Test Ring is `buildFitTestRing` in `mesh.ts`.
- Calibrated hole compensation lives in params (geometry stays params-only) and in the IndexedDB `printers` store.
- Not yet: insert mass in stability, insert render preview and a hard AI filter on `insert.*` (S4).

## Commands

```bash
npm ci               # install (lockfile)
npm run dev          # Vite dev server on :5173 (proxies /api to :8787)
npm run server       # AI proxy on :8787 (needs ANTHROPIC_API_KEY)
npm run typecheck    # tsc -b (src + tests, scripts, server)
npm run lint         # eslint
npm test             # vitest run (core tests, ~10 s)
npm run presets      # regenerate src/presets/*.json from scripts/presets.src.ts
npm run golden       # regenerate tests/golden/vase-presets.json (intentional geometry changes only)
npm run format       # prettier --write
npm run build        # typecheck + production build
```

## Golden test (safety net)

`tests/golden.test.ts` builds every preset in its own output mode at its `render.previewQuality` and
compares vertex count, triangle count and the FNV-1a hash of the Float32 position buffer with
`tests/golden/vase-presets.json`. It must stay green through every sleeve phase. If a change to the
vase path is intentional, run `npm run golden`, commit the JSON and explain the change in the PR.
Never regenerate it just to make a red test pass.

## Conventions

- `src/core/**` stays pure and deterministic: no DOM, three, react, zustand or UI imports; no `Math.random`
  (use `src/core/random`, seeded). Same params ⇒ identical buffers.
- New params go through zod with ranges + `paramMeta` (fa/en label, tooltip, unit, step, Basic/Advanced).
  Never duplicate ranges outside the schema. Schema changes bump `SCHEMA_VERSION` with a migration.
- Every user-facing string is bilingual (fa/en). Param labels live in the schema registry; UI chrome strings in `src/i18n/`.
- Presets are generated: edit `scripts/presets.src.ts`, then `npm run presets`. Don't hand-edit preset JSON.
- Printability issues use the existing issue/score/`fixAction` framework; don't invent parallel reporting.
- Workers return Transferable typed arrays; keep the mesh buffer contract identical across mesh paths.
- Tests live in `tests/*.test.ts` (core only, Node env, no DOM). Add tests with every geometry change.
- Style: Prettier (single quotes, 120 cols, trailing commas). Match the surrounding comment density.
- Keep `docs/ARCHITECTURE.md` / `docs/GEOMETRY.md` accurate when behaviour changes.

## Definition of done

**Every phase ends with `npm run typecheck && npm run lint && npm test` all green**, the golden test
included, then a commit on the phase branch and a PR.
