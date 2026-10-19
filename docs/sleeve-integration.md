# VaseForge × Sleeve — integration design (authoritative)

This document adapts `docs/sleeve-spec.md` to the **existing VaseForge codebase**. Where the two disagree, **this document wins**.

Read `docs/ARCHITECTURE.md` and `docs/GEOMETRY.md` first. They are accurate and describe the current Phase-2 app.

---

## 0. What exists today (so you don't have to rediscover it)

- **Stack:** Vite + React 18 + Tailwind (fa RTL / en LTR, Vazirmatn) + three/@react-three/fiber/drei + zustand + comlink + zod + lz-string. The AI proxy uses the Anthropic SDK (`server/`). Tests use vitest (core only).
- **Invariant:** the UI and the AI only produce **params**. Geometry comes from the deterministic `buildMesh(params, quality)`.
- **Geometry model:**
  - Every slice is a star-shaped polar function `r(θ)`, built on a twist-aligned grid.
  - Topology is fixed by construction (genus 0), so the manifold check is cached per topology.
  - Output modes are `solidVase`, `shell` and `doubleWallVase`.
  - Shell mode already has: inner liners (`smooth`, `follow`), drainage hole, concave base, ruffle/slant rim and saucer.
- **Params pipeline:**
  - `src/core/params/schema.ts` defines the zod schemas plus `paramMeta`, `SCHEMA_VERSION` and `DEFAULT_PARAMS`.
  - Raw params flow through `migrate → clamp → parse → normalize`.
  - `paramMeta` drives the UI (`ParamControl`, `visibility.ts`) and the AI system prompt.
- **Printability:** `analyze()` returns issues with severity, height range, fa/en message and a declarative `fixAction`. It computes a score, and an ablation-based auto-fix runs on a low-res grid.
- **Export:** binary STL, OBJ, 3MF (hand-written zip using `CompressionStream`, multi-object, slicer metadata from `slicerSettings.ts`), JSON and a ZIP bundle. Exports run in a second worker instance.
- **Other:**
  - Presets are 14 JSON files in `src/presets/`, built by `scripts/build-presets.ts`. A preset named `silk-drape` already exists.
  - Seeded random comes from `src/core/random/` (mulberry32, simplex 2D/3D).
- **Missing:** there is no `CLAUDE.md`. (The repo is now named `vaseforge` and `main` is the default branch.)

---

## 1. Core decision: Sleeve = a new output mode with its own mesh path

Sleeves need two things the grid builder cannot produce, by design:
- **through-holes**: genus > 0;
- **free-standing fingers**: slices with several contours.

Rules:
- **Do not break the star-shaped invariant** for the existing modes.
- Add `print.outputMode = 'sleeve'` (extend `OUTPUT_MODES`).
- When `outputMode === 'sleeve'`, the worker calls a **second deterministic function**, `buildSleeveMesh(params, quality)`, instead of the grid builder.
- Extend the invariant text in ARCHITECTURE.md to: *"UI and AI produce params; geometry comes from deterministic build functions, one per mesh path."*

Why an output mode and not a separate app or schema: presets, share links, IndexedDB designs, undo/redo, locks, the AI contract and exports all keep working with **zero duplication**.

The top bar gets a **Vase | Sleeve** switch:
- Switching to Sleeve sets `outputMode = 'sleeve'`.
- Switching back restores the last vase output mode (remember it in UI prefs).

Bump `SCHEMA_VERSION` and add a migration that inserts defaults for the new blocks.

---

## 2. Reuse the vase master field as the sleeve "skin"

The sleeve's outer form is **not** reinvented. It is the existing master field `r(θ, z)` from `compileField`, which includes:
- profile, section and morph;
- twist and lobes;
- bend, where `C(t)` gives the slice centre;
- all effects: ribs, waves, noise, organic `softBulges` / `silkFolds`, textures, facets, steps, glitch;
- rim flare.

Every existing style therefore works on sleeves for free.

**Implementation:**
1. **Skin map.** Rasterise the field on a dense periodic `(Nθ × Nz)` grid. Reuse the compile/grid code; the resolution comes from the quality level, e.g. 512 × 400 at preview. Store `r_skin` and slice centres `C(t)`.
2. **Skin SDF.** `d_skin(p) = (ρ_c − r_skin(θ_c, z)) / sqrt(1 + |∇r|²)`.
   - `ρ_c` and `θ_c` are measured about `C(z/H)`.
   - Sample bilinearly with periodic θ.
   - Take the gradient by finite differences on the map.
3. **Not reused:** ruffle/slant (a grid-row remap) and the shell-only base features. Sleeves get their own top-edge and base handling in the SDF (§3).

The sleeve-spec parameters in §4.2 (profile), §4.3 (folds/drape) and §4.6 (noise) therefore map onto **existing** params:
- profile and twist;
- the `organic` effect: `silkFolds` with stretch, and `softBulges`;
- `noise`, `waves` and `ribs`.

Use the existing effect height-mask (start/end/fade) for "gravity sag" and similar fades. Only add a new param when no existing one can express the feature, and document each addition here.

---

## 3. Sleeve SDF composition (order is fixed)

```
skin    = d_skin                                    (from §2)
body    = smin(skin, fingers, drips, k_blend)       (sleeve-spec §4.4 free part, §4.5)
body    = smin(body, coreTube(R_bore + coreWall))   (core always surrounds the bore)
body    = smax(body, z − Htop(θ), k_rim)            (top edge: peaks/valleys, sleeve-spec §4.8)
body    = smax(body, −holes_td, k_hole)             (openings with teardrop tops, sleeve-spec §4.7; keep-out bands)
body    = max(body, −z)                             (flat base, sharp)
body    = max(body, R_bore − ρ) for z > floorZ      (exact bore, sharp, ALWAYS LAST; lip/floor options)
```

- **Attached lobes:** the existing inward-normalised `Lobes` already covers them. Only free-standing fingers are new SDF primitives: tapered capsules along twisted, leaning, curling paths that stay connected below `lobeFreeLength`.
- **Hole fields:** organic noise, ellipses, Voronoi or fold-gap. They are evaluated in surface coordinates `(arc length, z)` on the skin.
- **Teardrop tops:** `g_td(p) = min_t ( g(p − t·ẑ) + t·tan(maxOverhang) )`, using 8–12 samples.
  - As implemented (S2b): g is the per-layer horizontal distance and every map row is a sample (a layer sweep,
    GEOMETRY.md §13b). Sparse samples leave flat shelves over wide holes, and with a 2D distance the formula
    needs `sin α` instead of `tan α`.
- **Coverage control:** enforce `minBridgeWidth`, and iterate the threshold until the target coverage is reached.

---

## 4. New core modules (pure TS, no DOM/three)

```
src/core/insert/     computeBore(insert, printerProfile) -> R_bore etc.   (shared by shell-bore liner AND sleeve)
src/core/sdf/        primitives, smin/smax, capsules, ellipse/voronoi fields (reuse core/random simplex)
src/core/sleeve/     compileSleeveField(params, quality): skin map + composition of §3
src/core/mc/         chunked narrow-band marching cubes, bore & base snapping,
                     Taubin smoothing (bore/base locked), island removal, weld, manifold/watertight check
```

- **Mesh contract.** `buildSleeveMesh` must return **exactly the same buffer contract** the worker already sends for the grid mesh: positions, indices, normals, per-vertex overhang, report. The viewer, heatmap, clipping plane, dimension overlay and exporters then work unchanged.
- **Per-vertex overhang:** compute it from vertex normals, the same way as the grid path.
- **Manifold check:** sleeve topology is not fixed, so **do not cache** the check by topology. Run the full check on every export and at preview resolution after each regen.

**Resolution and performance budgets:**

| Situation | Voxel size | Time budget |
|---|---|---|
| Drag preview | about 2 mm | — |
| Release preview | about 1 mm | under 300 ms |
| Export (0.3–0.6 mm, user-selectable) | in the export worker, with comlink progress + cancel | under 20 s at 0.5 mm |

Bore and base snapping follow sleeve-spec §3 exactly. Bore accuracy must be ±0.05 mm at any voxel size.

---

## 5. Params (zod + paramMeta, same pipeline)

New blocks, each with ranges in zod and labels/tooltips (fa/en), units, steps and Basic/Advanced flags in `paramMeta`:

- **`insert`** (top level, shared): type, OD, OD tolerance, fit (press/snug/slip), clearance per side, length, protrusion, bottom (open/lip/floor/drain), grip ribs, O-ring grooves, entry chamfer, coreWall.
  - `R_bore` is **derived** in `computeBore`, never stored.
- **`print.printer` profile:** add `holeCompensation`, default 0.05 mm per side, to `PRINTER_PRESETS` and to user-saved profiles in IndexedDB.
- **`sleeve`:**
  - `fingers`: sleeve-spec §4.4 free part;
  - `drips`: §4.5;
  - `holes`: §4.7, including `teardropTops`, `minBridgeWidth` and keep-outs;
  - `topEdge`: §4.8;
  - `mesh`: voxel sizes, smoothing, decimation;
  - `selfSupporting`.
- **As implemented in S1** (`src/core/params/schema.ts`, block `insert`; `SCHEMA_VERSION` 2):
  - `type` glass|steel|custom (default glass), `od` 10–150 (50), `odTolerance` 0–2 (0.3), `fit` press|snug|slip (slip; picking a fit copies its clearance), `clearance` 0–1 (0.25), `length`, `protrusion`, `coreWall` 1.2–4 (2).
  - `bottom` open|lip|floor|drain (open) with `lipWidth`, `lipThickness`, `floorThickness`, `drainDiameter`.
  - `entryChamfer` 0–2 (0.8) and **new** `bottomChamfer` 0–1.5 (0.6, open/lip only): offsets first-layer elephant's foot, which makes the bore tight at the base.
  - `ribs.{count 0–8 (0), width, interference 0–0.3, heightFraction %}`: ribs start above the bottom chamfer.
  - `grooves.{count 0–2 (0), width, depth, z1, z2}`: groove centres in % of height, 45° flanks.
  - `print.printer.holeCompensation` −0.2–0.5 (0.05), also a field of every `PRINTER_PRESETS` entry.
  - The shell liner switch is `print.innerSurface: 'bore'` (no separate `liner` key).
- **As implemented in S2a** (`SCHEMA_VERSION` 3): `print.outputMode: 'sleeve'` (chosen with the top-bar
  Vase | Sleeve switch; the last vase mode is a UI pref) and a top-level `sleeve` block:
  - `coreBlend` 0–8 mm (2): smooth-union radius between the skin and the core tube (the `k_blend` of §3);
  - `mesh.previewVoxel` 0.6–2 mm (1.0), `mesh.exportVoxel` 0.3–0.6 mm (0.5), `mesh.smoothing` 0–10 Taubin passes (3).
  - The drag voxel is fixed at 2 mm. Decimation is deferred to S4; fingers, drips and self-supporting come with S3.
- **As implemented in S2b** (`SCHEMA_VERSION` 4; v3 → v4 moves a stored `previewVoxel` 1.0 to the new default 1.5):
  - `sleeve.holes`: `mode` none|organicNoise (none), `coverage` 0–50 % (15), `size` 4–40 mm (12),
    `sizeVariation` 0–100 % (40), `verticalStretch` 0.5–4 (1.6), `angle` −60–60° (0), `edgeRoundness` 0–3 mm (1),
    `minBridgeWidth` 2–15 mm (4.8 = 3 × 1.6), `keepOutBottom` 0–60 mm (10), `keepOutTop` 0–60 mm (8, from the
    local rim), `teardropTops` (on).
  - `sleeve.topEdge`: `peakCount` 0–12 (0), `amplitude` 0–120 mm (20), `sharpness` 0–100 % (50), `irregularity`
    0–100 % (30), `minTubeCoverage` 10–400 mm (50, capped at the height).
  - Coverage counts the whole side (keep-out bands included). Thin bridges merge holes, unless the merged hole would
    span > 1/3 of the circumference (at the bore radius) or > 2.5 × size in height; then the smaller hole goes.
    Holes that reach the rim open into a notch.
  - New stat `boreContact` (solid share of the bore between its bottom and the rim) with a warning below 40 %.
- **Visibility:**
  - Vase-only controls are hidden in sleeve mode via `visibility.ts`: rim lip/round rim, ruffle/slant, concave base, drainage, double wall, saucer, spiral G-code.
  - Sleeve controls are hidden in vase modes, except `insert` when the shell liner is `bore` (§6).

---

## 6. Quick win first: "bore" liner for shell mode (Phase S1)

Before any SDF work, add `liner: 'bore'` to shell mode.

**Geometry:**
- The inner surface is an exact cylinder of radius `R_bore`, through the full height.
- The bottom is an annulus. Reuse the drainage-hole annulus machinery.
- Optional bottom lip or floor, from `insert.bottom`.
- The existing rim ring joins the outer top to the bore top.
- This stays star-shaped and genus-correct inside the current grid builder.

**Printability:**
- New error: `r_outer < R_bore + wall` anywhere.
- Fix action: constrain or scale the profile radii upward.

**Result:** every existing preset becomes a **closed sleeve** (no holes) around a real tube. This is printable and sellable while the SDF path is being built.

**Also in S1, shared by both modes:**
- printer `holeCompensation`;
- the **Fit Test Ring** export (a 10 mm slice of bore + ribs + core wall);
- a **calibration modal**: enter the measured bore and save the corrected `holeCompensation` to the profile.

---

## 7. Printability for sleeves

Use the same `analyze()` issue/score/fixAction framework. Add sleeve checks:
- **Bore accuracy** (measured from bore vertices vs target): error if outside ±0.05 mm.
- **Mesh validity:** manifold, watertight, single body. Any failure is an error.
- **Islands removed** above 1% of volume: warning.
- **Minimum wall:** sampled from the SDF along inward normals; feeds a heatmap.
- **Hole bridges** thinner than `minBridgeWidth`.
- **Bore contact** (S2b): solid share of the bore wall between its bottom and the rim; warning below 40 %.
- **Existing checks that still apply:** overhang (from normals), bounds and stability. For stability, include the insert mass (glass ≈ 2.5 g/cm³, steel ≈ 7.9 g/cm³) plus water.

**Auto-fix for sleeves:** reuse the ablation approach at low resolution. Contributors are hole coverage/size, finger lean/curl, skin effect depths and twist.

---

## 8. Exports, presets, AI, viewer

- **Exports:**
  - Reuse STL/OBJ/3MF/zip.
  - `slicerSettings.ts` gets a sleeve profile: tree supports on build plate only, 2–3 walls, no vase mode.
  - Add the bundle extras from sleeve-spec §9: a print card text file with the measured bore.
  - The insert is a **render-only** body and is never included in print exports.
- **Presets:**
  - Add `src/presets/sleeve-*.json` (molten, silk-drape, fingers, windswept, coral, drip).
  - Use the `sleeve-` prefix so names don't clash with the existing vase `silk-drape`.
  - Extend `presets.test.ts`: every sleeve preset must be manifold, have score ≥ 90 and pass the bore check.
- **AI:**
  - The system prompt is generated from `paramMeta`, so new params flow in automatically once they have meta.
  - Add sleeve presets and sleeve printability rules to `prompts.ts`.
  - Rule: the AI must **never change `insert.*`** unless the user explicitly asks.
- **Viewer:**
  - Insert preview: glass with transmission, or brushed steel. Add a toggle.
  - Show bore Ø in the dimension overlay.
  - The clipping plane already exists; use it for bore inspection.
  - Later: material previews for dual-colour silk and "gold-plated" with an edges-only mask.

---

## 9. Safety net (do this before any feature work)

- Add `CLAUDE.md` (≤ 200 lines) summarising this file, ARCHITECTURE and GEOMETRY, plus commands: `npm run dev | test | typecheck | lint | presets | server`.
- **Golden test.** Store the FNV-1a position hash and vertex/triangle counts for every existing preset at preview quality in `tests/golden/vase-presets.json`. This test must stay green through every sleeve phase, unless a change is intentional and documented.
- **Every phase ends with:** `npm run typecheck && npm run lint && npm test` all green.

---

## 10. Phases

| Phase | Scope |
|---|---|
| S0 | `CLAUDE.md`, baseline green, golden test. No behaviour change. |
| S1 | `insert` block, `computeBore`, shell `liner: 'bore'`, printer `holeCompensation`, Fit Test Ring, calibration modal, bore check. |
| S2 | `outputMode: 'sleeve'` + top-bar switch, skin map, SDF core/bore/base/top edge/organic-noise holes, MC pipeline, sleeve checks, export. |
| S3 | Fingers, drips, all hole modes + teardrop + bridges, the six `sleeve-*` presets tuned against `docs/references/`, sleeve auto-fix, variations. |
| S4 | Viewer insert and material previews, AI sleeve rules, batch export for several bore sizes, narrow-band and perf work, docs update (ARCHITECTURE/GEOMETRY sections for sleeves). |

Each phase runs on its own branch (`sleeve/s0` …) and ends in its own PR.
