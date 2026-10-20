# Build "Sleeve Studio": a parametric generator for 3D-printable organic vase sleeves

## 0. Context: read this first

I run a small studio with an FDM 3D printer, a glass workshop and a gold/metal workshop. I make **multi-material vases**:

- An **insert**: a straight cylinder of clear glass or brushed stainless steel that holds the water and flowers. I make these myself.
- A **3D-printed organic sculptural sleeve** that wraps around the insert and grips it.

The sleeve style is:

- **Form:** flowing, draped-fabric folds; melting or dripping blobs; finger-like vertical lobes; twisting, windswept strands.
- **Silhouette:** asymmetric, with irregular top edges.
- **Openings:** organic oval openings that let the cylinder show through.
- **Materials:** printed in matte PLA or dual-colour coaxial silk PLA.

Reference photos are in `docs/references/`. Open and study them before designing the geometry engine:

- an orange matte sleeve around a steel tube with oval holes;
- teal/blue silk sleeves with twisting folds around clear glass tubes;
- a sleeve with separated finger lobes rising around a glass tube.

**Goal:** a local web app where I set parameters, see the sleeve live in 3D, and download a print-ready file. I need no other software: no Blender, no CAD, no repair tool. The output must slice and print first time.

The app must always guarantee three things:

1. **Exact bore.** The inner hole must fit my real tube to within ±0.05 mm of the computed target diameter.
2. **Valid mesh.** The mesh must be watertight, 2-manifold and a single connected body.
3. **Printable.** The sleeve must sit on a flat base, respect a minimum wall thickness, and keep overhangs under control. Any violation must be reported visibly.

---

## 1. Core design principle: "Core + Skin + Cut", built as an SDF

Model the sleeve as a **signed distance field (SDF)** in millimetres. Material is where `d < 0`. Then mesh it.

Use SDF because:

- booleans and smooth blends never break topology;
- the output from a closed field is watertight by construction;
- the bore can be subtracted exactly as the last operation.

**Composition order** (fixed; do not change it):

1. **Skin (outer form).** Smooth-union (`smin`) of:
   - a radial "shell" field (profile + folds + lobes + noise);
   - free-standing lobe/finger primitives (capsules or tapered curves along twisted paths);
   - drip primitives.
2. **Core.** Smooth-union with a minimum-thickness tube around the bore. This guarantees the bore is always fully surrounded by at least `coreWall` of material except where openings are cut.
3. **Top edge.** Smooth-intersect with a height field `z < Htop(θ)`, which gives peaks and valleys on the rim.
4. **Openings.** Smooth-subtract the hole field (see §4.7), but restricted to the keep-out-free band.
5. **Flat base.** Sharp intersect with `z >= 0`. No smoothing here; the base must be perfectly flat.
6. **Bore.** Sharp subtract `ρ < R_bore` for `z > floorThickness`, or for the full height if the bottom is open. This is always the **last** operation and is never smoothed.

Notation: `ρ = sqrt(x²+y²)`, `θ = atan2(y,x)`.

- All noise is evaluated in **Cartesian** space (x, y, z) or with wrapped angles, so there is no seam at θ = ±π.
- All angular distances use wrapped difference.

**Lipschitz safety.** The radial shell term `d = ρ - R(θ, z)` is not a true distance when `R` varies fast. Divide by `sqrt(1 + |∇R|²)`, computed numerically or analytically, so meshing and thickness checks stay stable. Document anywhere the field is only approximate.

---

## 2. Tech stack (use exactly this unless you have a strong reason; explain if you deviate)

- **Framework:** Vite + React + TypeScript (strict).
- **3D view:** three.js via @react-three/fiber and @react-three/drei.
- **State:** zustand, with an undo/redo history.
- **Compute:** all geometry runs in **Web Workers** using Comlink. The UI thread must never block. Use multiple workers for chunked meshing. Design the engine so a WebGPU compute path can be added later, but do not build it now.
- **Noise:** seeded simplex/fbm with a seeded PRNG (e.g. mulberry32).
  - Same params + seed + `engineVersion` must give a byte-identical mesh.
  - Store `engineVersion` in saved parameter files.
- **Export:** binary STL, 3MF (zip via fflate, unit = millimetre), GLB for renders, JSON for parameters.
- **Tests:** Vitest for the engine. Add a Node CLI script `validate.ts` that loads an exported STL and runs every mesh check in §6.
- **Architecture:** keep `src/core/` pure TypeScript with zero DOM or three.js imports, so the engine can later run in Node or a server.

Suggested layout:

```
src/core/sdf/        primitives, smin/smax, domain ops (twist, bend, lean)
src/core/noise/      seeded simplex, fbm, ridged, domain warp
src/core/sleeve/     the sleeve field: buildField(params) => (x,y,z)=>d
src/core/mesh/       marching cubes (chunked, narrow-band), bore/base snapping, smoothing, island removal
src/core/analysis/   manifold, thickness, overhang, bore measurement, volume/mass
src/core/export/     stl, 3mf, glb, json
src/worker/          comlink workers
src/ui/              panels, viewport, analysis panel, presets, variations grid
references/          my reference photos
```

---

## 3. Meshing requirements

- **Algorithm:** marching cubes with standard tables.
  - Pad the grid by 2 voxels so the surface is always closed.
  - Use **narrow-band evaluation**: evaluate a coarse grid first, then only subdivide cells where `|d| < cell diagonal`. Export resolution must be fast enough to use.
- **Two resolutions:**
  - **Preview:** voxel 1.0–1.5 mm. Recompute live, debounced, while a slider is being dragged.
  - **Export:** voxel 0.3–0.6 mm, user-selectable. Show a progress bar and allow cancel.
- **Bore snapping.** After meshing, every vertex that is within `0.75·voxel` of the bore radius **and** whose normal points inward (`n·r̂ < -0.7`) is projected exactly onto `ρ = R_bore`. This makes the bore exact regardless of voxel size.
- **Base snapping.** Every vertex within `0.5·voxel` of `z = 0` with a downward normal is snapped to `z = 0`.
- **Smoothing.** Taubin (λ/μ) smoothing with an adjustable iteration count. Bore and base vertices are **locked** and must never move.
- **Island removal.** Remove every connected component except the largest, and report how much volume was removed. If the removed volume is above 1%, show a warning: the design has floating parts.
- **Optional decimation** to a target triangle count, still with bore and base vertices locked.
- **Normals.** Recompute normals and ensure consistent outward orientation (positive signed volume).

---

## 4. Parameters (complete list)

All lengths are in **mm** and all angles in **degrees**. Every parameter needs:

- a slider **and** a numeric input (I need exact millimetre entry);
- a sensible min/max/default;
- a lock icon, so randomise and variations leave it unchanged;
- a tooltip in Persian and English.

Group them in collapsible panels in this order.

### 4.1 Insert and bore (the "adaptive" part)

| Parameter           | Description                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insertType`        | glass / stainless steel / custom. Only used for presets and render material.                                                                                                                                          |
| `insertOD`          | Measured outer diameter of my real tube. I measure several points; use the maximum.                                                                                                                                   |
| `insertODTolerance` | Expected variation of handmade glass, e.g. ±0.3. Added on top of the clearance.                                                                                                                                       |
| `fitType`           | Each option sets the default `clearancePerSide`, which stays editable:<br>• press = 0.10 (show a warning: not for glass)<br>• snug = 0.18<br>• slip = 0.25                                                            |
| `holeCompensation`  | Printer-specific offset (default 0.05 per side). Comes from the active printer profile; see the calibration flow in §7.                                                                                               |
| Computed `R_bore`   | `insertOD/2 + clearancePerSide + insertODTolerance/2 + holeCompensation`. Show it prominently.                                                                                                                        |
| `insertLength`      | Length of the tube.                                                                                                                                                                                                   |
| `insertProtrusion`  | How far the tube sticks out above the highest point of the sleeve. Used for the preview and as a sanity check.                                                                                                        |
| `bottomType`        | open / closed floor (`floorThickness`) / inner lip ring (`lipWidth`, `lipThickness`) / closed with drain hole (`drainDiameter`).                                                                                      |
| `gripRibs`          | count 0–8, `ribWidth`, `ribInterference` 0–0.3, `ribHeightFraction`.<br>Ribs are small vertical bumps inside the bore that grip the tube. When ribs are on, the bore exactness rule applies to the gaps between ribs. |
| `oRingGrooves`      | count 0–2, width, depth, z positions. For a silicone ring or band.                                                                                                                                                    |
| `boreEntryChamfer`  | 0–2. Top edge only.                                                                                                                                                                                                   |
| `coreWall`          | Minimum wall around the bore, 1.2–4, default 2.0.                                                                                                                                                                     |

### 4.2 Envelope and profile

- `height`: total sleeve height. Default ≈ 0.7 × insertLength.
- `profile`: an editable spline of outer base radius vs normalised height. Provide a small curve editor with 4–6 control points and presets: straight / flared base / bulb / waist / tapered top.
- `baseFlare`: extra radius at the bottom, plus the falloff height of that flare.
- `lean`: angle and direction. The whole skin leans; the bore stays vertical.
- `asymmetry`: strength 0–1 and direction. One side of the sleeve is fuller and taller.
- `footRing`: optional flat ring at the base for stability, with width and height.
- `minBaseContact`: a warning fires if the base contact area falls below this many mm².

### 4.3 Folds / drape (the silk "fabric" look)

- `foldCount` 0–16.
- `foldDepth`.
- `foldWidthVariation`.
- `foldSharpness` 0–1. Crest shape goes from soft sine to ridged `1-|sin|`.
- `foldTwist`: total degrees from base to top, with a twist-easing curve.
- `gravitySag`: fold depth grows toward the bottom, like hanging fabric.
- `foldIrregularity`: per-fold random amplitude and phase from the seed.
- `drapeWaves`: horizontal low-frequency ripples along each fold.

### 4.4 Lobes / fingers / strands

- `lobeCount` 0–12, `lobeWidth`, `lobeWidthVariation`.
- `lobeBlend`: smooth-union radius `k` with the body.
- `lobeHeightMin` / `lobeHeightMax`: heights vary per lobe.
- `lobeFreeLength`: how much of each lobe's top stands free of the core. These are fingers with gaps between them, like the reference photo. Fingers must remain connected to the body below.
- `lobeTipShape`: round / pointed / drip-bulb.
- `lobeTwist`, `lobeLean`, `lobeCurl`. Each lobe follows a curved path, not a straight line.
- `lobeThicknessTaper`: thinner toward the tip, never below `minWall`.

### 4.5 Drips

- `dripCount` 0–12, `dripLength`, `dripBulbSize`.
- `dripPlacement`: on rim / on lobes / random.

### 4.6 Surface noise and flow

- `noiseAmplitude`, `noiseFrequency`, `octaves`, `lacunarity`, `gain`.
- `noiseType`: smooth / ridged / billow.
- `domainWarpStrength` and `domainWarpFrequency`. These give the "molten / flowing" look.
- `verticalStretch` (anisotropy): stretches features vertically for the flowing look.
- `noiseFollowsTwist`: noise is evaluated in twisted coordinates.

### 4.7 Openings (holes showing the insert)

**`holeMode`**: none / organic noise / ellipses / Voronoi coral / fold gaps.

- **Organic noise:** threshold an fbm field.
- **Ellipses:** seeded placement with Poisson-disk spacing.
- **Voronoi coral:** shrunken cells.
- **Fold gaps:** openings in the valleys between folds.

**Controls:**

- `holeCoverage`: target % of the sleeve's side area that is open. Iterate the threshold to hit it.
- `holeSize` and `holeSizeVariation`.
- `holeVerticalStretch` and `holeAngle`, for diagonal windswept holes.
- `holeEdgeRoundness`: smooth-subtract radius, which rounds the edges.
- `minBridgeWidth`: no material bridge between holes may be thinner than this. Default 3 × `minWall`.
- `keepOutBottom` / `keepOutTop`: solid bands with no holes, which protect base strength and rim.

**`teardropTops` (default ON)**: makes the top of every hole self-supporting.

- Implementation for any hole field `g` (negative inside the hole), evaluated in surface coordinates (arc length, z):
  `g_td(p) = min over t in [0, T] of ( g(p - t·ẑ) + t·tan(maxOverhang) )`
- Use about 8–12 samples of `t`.
- This dilates each hole upward into a pointed roof whose slope respects `maxOverhang`.
- Show a before/after toggle.

### 4.8 Top edge (rim)

- `rimPeakCount`, `rimAmplitude`, `rimSharpness`, `rimIrregularity`.
- `minTubeCoverage`: the lowest rim point must still cover at least this height of the tube, so it holds.

### 4.9 Printability

- `minWall`: default 1.6; 4 × nozzle is a good rule.
- `maxOverhang`: degrees from vertical, default 45.
- `selfSupportingMode`: limits profile and lobe undersides so the outer surface never overhangs beyond `maxOverhang` (the radius may not grow faster than `tan(maxOverhang)` per mm going up). Explain the trade-off in the UI.
- `nozzleDiameter`, `layerHeight`: for display and for wall rules.
- `printerBuildVolume`: comes from the printer profile. Warn if the sleeve exceeds it.

### 4.10 Seed and variation

- `seed`: shown as a number, with buttons for re-roll and lock.
- `variationStrength`: how far "Generate variations" may move unlocked parameters.

### 4.11 Mesh quality

- `previewVoxel`, `exportVoxel`, `smoothingIterations`, `decimateTarget`.

---

## 5. Style presets (must match my reference photos)

Implement these presets as complete parameter sets. They are starting values: compare renders against `docs/references/` and tune them until each preset clearly evokes its reference.

1. **Molten / Lava** (the orange matte photo)
   - Insert: steel tube, OD ≈ 40, sleeve height ≈ 150.
   - Body: bulbous flared base, 4–5 thick blobby lobes, high domain warp, strong asymmetry.
   - Openings: 15–20% coverage of large rounded ovals of mixed sizes.
2. **Silk Drape** (the teal twisting photo)
   - Insert: glass OD ≈ 50, height ≈ 190.
   - Body: 6–8 deep sharp folds, 60–90° twist, gravity sag.
   - Rim: 3–5 tall peaks.
   - Openings: few, large and elongated, in the fold valleys.
3. **Fingers** (the separated-lobes photo)
   - Insert: glass OD ≈ 50.
   - Body: 5–7 lobes with large free length, pointed or rounded tips, slight curl.
   - Openings: tall slit-like gaps between the fingers.
4. **Windswept**
   - Body: 10–15° lean, 120°+ twist, strands that all flow one way.
   - Openings: diagonal holes stretched along the flow.
5. **Coral**: Voronoi openings, ridged noise, mostly straight profile.
6. **Drip**: smooth body, rim drips and lobe drips, no holes.

---

## 6. Analysis and validation (always visible in a right-hand panel)

Run these on every export-resolution mesh. Run cheap versions on the preview.

**Measurements and checks:**

- **Bore check.** Sample bore vertices and report the measured diameter, roundness and min/max against the target. Show **PASS** at ±0.05 mm.
- **Mesh checks.**
  - Manifold: every edge is shared by exactly 2 faces.
  - Watertight: no boundary edges.
  - Single body.
  - Consistent orientation.
  - No degenerate triangles.
- **Minimum wall thickness.** Use the SDF, sampling along inward normals. Show a heatmap overlay in red/yellow/green.
- **Overhang.** Show a heatmap of faces steeper than `maxOverhang`. Report the % of area needing support.
- **Volume and mass.**
  - PLA density 1.24 g/cm³.
  - Approximate print-time estimate from volume, layer height and nozzle. Label it clearly as an estimate.
- **Size.** Bounding box against the printer build volume.
- **Base contact area** and a **tipping-stability check**: the centre of mass must sit inside the base polygon, considering the full assembly with the insert.

**Export gate:**

- Export is **blocked** if the mesh is not manifold/watertight or the bore fails. The user can override with an explicit "export anyway" confirmation.
- Warnings (thin walls, overhang) never block export.

---

## 7. Printer profiles and calibration flow

**Printer profiles:**

- A profile holds: name, build volume, nozzle, default layer height, `holeCompensation`.
- Profiles are stored in localStorage/IndexedDB.

**Fit Test Ring export:**

- A 10 mm tall slice of the current bore, with its ribs, grooves and core wall.
- This prints in minutes.

**Calibration wizard:**

1. Print the test ring.
2. Measure the printed bore with calipers and enter the value.
3. The app computes and saves the corrected `holeCompensation` to the active printer profile.
4. Every future design uses this value automatically.

---

## 8. Viewport and rendering

- **Display:** the sleeve shown together with the insert. Glass uses a transmission material with slight green edges; steel uses a brushed anisotropic look. Toggle the insert on and off.
- **Materials:**
  - matte PLA, with a colour picker;
  - silk PLA, glossy;
  - dual-colour coaxial silk (an angle-dependent colour shift between two chosen colours);
  - "gold-plated" metallic, to preview gold plating;
  - an option to apply gold only to edges or tips using a curvature mask.
- **Views:**
  - section/cutaway plane to inspect the bore and walls;
  - ruler overlays for bore and height;
  - print-bed grid with the build-volume box;
  - turntable rotation.
- **Captures:**
  - Snapshot to PNG with a transparent or white studio background, for Instagram.
  - Export an assembly GLB (sleeve plus insert, with materials) for presentations and AR.

---

## 9. Workflow features

- **Generate variations.** Builds a 3×3 grid of thumbnails from the current design by mutating unlocked parameters by `variationStrength`. Click one to adopt it.
- **Randomise.** Within the style preset's ranges only.
- **Undo/redo, history.**
- **Save/load designs.** As JSON, plus a shareable URL hash.
- **Batch export.** One design, several bore sizes, so I can make the same form for different tubes. The form scales or adapts sensibly: the skin is defined relative to `R_bore`.
- **File naming.** `sleeve_{preset}_D{insertOD}_{fit}_H{height}_s{seed}.stl`.
- **Each export bundle includes:**
  - the STL (or 3MF);
  - a JSON file with all parameters and `engineVersion`;
  - a small text "print card": recommended settings (tree supports on bed only, 2–3 walls, vertical orientation, layer height), measured bore, mass and warnings.

---

## 10. UI and language

- Bilingual **Persian (RTL) / English** with a toggle. All labels and tooltips come from translation files.
- **Layout:**
  - **Left:** parameter groups.
  - **Centre:** viewport.
  - **Right:** analysis.
  - **Top bar:** presets, seed, variations, undo/redo, export.
- **Visual style:** clean and calm, like a design studio. Dark and light themes.
- **Feedback:** the preview updates while dragging. A subtle "computing…" indicator appears, and the previous mesh stays visible until the new one is ready.

---

## 11. Optional AI layer (Phase 3)

- **Text → parameters.** I describe a form ("twisting silk fabric, 3 tall peaks, few long openings, for a 50 mm glass tube"). An LLM, with an API key I enter in settings and store locally, returns **only a parameter JSON** validated against the schema. The geometry engine then builds the form.
- **Never** let AI generate the mesh directly.
- **Image → parameters** (stretch goal): send a reference photo and ask for the closest preset plus parameter values.

---

## 12. Delivery plan: build in phases and verify each one

**Phase 1: engine and MVP**

- SDF core: profile, noise, lobes, noise holes, top edge, flat base, exact bore.
- Chunked narrow-band marching cubes in workers, with bore and base snapping, Taubin smoothing and island removal.
- Viewport, parameter panels for §4.1, §4.2, §4.4, §4.6, §4.7 (noise mode) and §4.8.
- Binary STL export, manifold/watertight/bore checks, `validate.ts`.

**Phase 2: style and printability**

- Folds/drape, twist, lean, asymmetry, drips.
- All hole modes, teardrop tops, `selfSupportingMode`.
- Thickness and overhang heatmaps, mass and time estimates.
- The 6 presets tuned against the references.
- Variations grid, 3MF, Fit Test Ring, calibration, printer profiles, print card.

**Phase 3: polish and extras**

- Materials and gold preview, PNG/GLB export, batch bore export.
- Persian/English localisation completeness, AI text-to-parameters.

**Acceptance criteria per phase:**

- **Tests (Vitest):**
  - SDF primitives;
  - seed determinism;
  - bore accuracy ±0.05 mm at voxel 0.5 and 1.0;
  - manifold output for each preset with 20 random seeds.
- **Validation:** `validate.ts` passes on every preset export.
- **Performance:** preview regenerates in under ~300 ms on a normal laptop; export at 0.5 mm voxel finishes in under ~20 s.
- **Proof:** after Phase 2, export each preset, render a screenshot of each, and compare it side by side with the reference photos. Write down what still differs and fix it.

**Working rules for you (Claude Code):**

- Start by reading this whole file and the reference images.
- Propose the architecture and the exact parameter schema, as a TypeScript type with defaults and ranges, before writing the engine.
- Create a `CLAUDE.md` summarising the architecture, commands and conventions.
- Commit after each working step with clear messages.
- When a requirement is ambiguous, choose the option that best protects **printability and bore accuracy**, and note the decision in `DECISIONS.md`.
- Do not skip the validation tooling: a sleeve that looks good but does not fit the tube or does not slice is a failure.
