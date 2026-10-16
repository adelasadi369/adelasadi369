# VaseForge — Architecture Overview

## 1. Guiding invariant

> **The AI and the UI only ever produce _parameters_. Geometry is always
> produced by one deterministic function `buildMesh(params, quality)`.**

Every horizontal slice is a polar function `r(θ)` around its own slice
centre. That gives exactly one simple, closed, star-shaped contour per layer,
so self-intersection can't happen by construction. Spiral-vase-mode
compatibility is guaranteed for `solidVase`, and the printability engine only
has to check _physical_ limits (overhang, feature size, bed size, stability).
It never has to check topology.

## 2. Layering

```
┌──────────────────────────── main thread (UI) ─────────────────────────────┐
│ React 18 + Tailwind (RTL fa / LTR en)                                     │
│  ├─ ui/panels      tabs: Shape · Section · Twist · Surface · Rim&Base ·   │
│  │                 Print · AI ; Print-Check panel ; bottom sheets (mobile)│
│  ├─ ui/editors     ProfileCurveEditor · PolarSectionEditor · EffectStack  │
│  ├─ ui/viewer      @react-three/fiber + drei: orbit, materials, heatmap,  │
│  │                 layer lines, clipping plane, dimension overlay         │
│  ├─ state/         Zustand store: params, locks, history (undo/redo),     │
│  │                 mesh + report, ui prefs                                │
│  ├─ persist/       IndexedDB designs, share links (lz-string)             │
│  └─ ai/client      fetch → /api/ai/* (proxy), zod-validate, JSON Patch    │
│            │  comlink (structured clone in, Transferable buffers out)     │
├────────────▼──────────── workers/geometry.worker.ts ──────────────────────┤
│  regen(params, quality) → { mesh buffers, vertex overhang, report }       │
│  export(params, format)   (second worker instance, so export never blocks │
│                            preview)                                       │
├────────────▼──────────────── core/ (pure TS, no DOM, no three) ───────────┤
│  params/       schema.ts (zod), migrate.ts, clamp.ts, paths.ts            │
│  geometry/     profile · sections · twist · effects/* · rimBase · field   │
│                · grid · mesh                                              │
│  printability/ overhang · features · walls · bounds · stability · sanity  │
│                · stats · autofix · index (score)                          │
│  export/       stl · obj · threeMF · zip · gcodeVase (P3)                 │
│  random/       mulberry32 · simplex (2D/3D) · hash                        │
│  jsonpatch/    RFC 6902 apply + validate                                  │
└───────────────────────────────────────────────────────────────────────────┘
 server/  tiny AI proxy: POST /api/ai/params | /refine | /image | /variations
          (holds the API key; rate-limited; returns JSON only)
```

Repository layout (paths relative to the repo root; the spec's `/core`,
`/presets`, … live under `src/`):

```
src/core/{params,geometry,printability,export,random,jsonpatch}
src/presets/*.json          14 trend presets (full param JSON) + index.ts
src/ai/{prompts.ts,schema.ts,client.ts}
src/workers/geometry.worker.ts
src/ui/…  src/state/…  src/persist/…
src/i18n/{fa.json,en.json}  UI chrome strings (param labels live in the schema registry)
server/                     AI proxy (Phase 2)
tests/                      vitest (core only; no DOM)
```

## 3. Data flow on a slider drag (60 fps target)

1. The slider calls `store.setParam(path, value, { transient: true })`. A
   transient change updates `params` without pushing to history; the drag
   commits **one** history entry on pointer-up.
2. The store hands `params` to `RegenScheduler`. It sends at most one request
   in flight and one pending; newer params overwrite the pending slot
   (latest-wins), so slow frames drop intermediate states and never queue.
3. Worker `regen` steps, all on typed arrays:
   1. `compileField(params)` pre-computes per-row data (R(t), twist, masks,
      morph weight and normaliser, rim/base zones) and per-column data
      (cos/sin tables), and builds the effect closures.
   2. `buildGrid` writes outer (and inner) positions into reusable
      `Float32Array`s from a pool keyed by size. Indices are cached per
      `(Nθ, Nz, mode)` topology and rebuilt only when it changes.
   3. Normals are computed analytically on the grid (central differences,
      periodic in θ). The per-vertex overhang angle comes from the same
      normals.
   4. The fast printability checks run on every regen (overhang, features,
      walls, bounds, stability, r_min). Manifold edge counting is O(E) and
      runs when topology changes and on export, because the topology is
      fixed by construction.
4. Buffers come back as `Transferable`. The viewer copies them into an
   existing `BufferGeometry` when the vertex count is unchanged (no
   re-allocation) and then hands the arrays back to the worker pool
   (ping-pong double buffering).

Budget: preview 256×200 ≈ 51 k vertices (shell ≈ 2×). The field
evaluation is about 10–20 ns per vertex per effect, so it fits comfortably
in < 50 ms with 3 effects. Export at ultra (1024×800 ≈ 1.6 M triangles) runs
in the export worker in ≤ 2 s.

## 4. Grid and topology decisions

- **Twist-aligned grid.** Column `i`, row `j` sits at
  `θ = θ_i + Twist(t_j)`, so in the warped frame `θw = θ_i` is constant per
  column. Section corners, ribs and lobes stay on exactly the same column
  at every height, which means twist never aliases, however few rows there
  are. Each quad is split along its shorter diagonal.
- **Auto-raise Nθ.** `k = max(repetitions of every active feature)`
  (polygon sides, star points, petals, lobes, rib count (×2 for
  crisscross), freqTheta, texture repeats, facet segments). Then
  `Nθ = k · ceil(max(Nθ_quality, 8k) / k)`, so every repetition gets
  identical sampling. Capped at 4096.
- **Row snapping.** Rows are uniform in z, plus extra rows inserted at
  breakpoints: sharp profile knots, step edges, effect-window edges, flare
  start, foot-ring and chamfer heights.
- **Caps.** The bottom and top are fans from the slice centre. A fan from
  the star centre is valid exactly _because_ every slice is star-shaped
  about that centre.

## 5. State, history, persistence

- **Store slices:** `design` (params + locks), `history` (snapshot stack of
  structurally-shared param objects, 200 deep, coalesced per drag), `result`
  (mesh + report), `ui` (tab, mode Basic/Advanced, language, viewer toggles).
- **Undo/redo** is implemented in-store, with no extra dependency.
  Auto-fix and AI patches each create exactly one history entry, so "undo
  auto-fix" is a normal undo.
- **IndexedDB:** a small hand-written wrapper (no dependency) with stores
  `designs` (params, thumbnail PNG blob, timestamps) and `assets`
  (displacement images, P3).
- **Share link:** `#v1=` + `lz-string.compressToEncodedURIComponent(JSON(diff(params, DEFAULT_PARAMS)))`.
  Decoding runs `migrate → clamp → parse`. Unknown keys are dropped and the
  version is checked.

## 6. Params pipeline (shared by UI, presets, AI and links)

```
raw JSON ─► migrate(version) ─► clamp(schema ranges, enums→default) ─► VaseParamsSchema.parse
          ─► normalise (sort points, fix neck>belly, assign effect ids, snap wall to lineWidth)
```

`clamp.ts` walks the zod schema (`ZodDefault → ZodNumber.minValue/maxValue`),
so ranges are defined in exactly one place. The `paramMeta` registry feeds
the UI (labels, tooltips, units, steps, Basic/Advanced, phase gating) and
`z.toJSONSchema()` feeds the LLM.

## 7. Printability engine

`analyze(mesh, field, params) → { score, issues[], stats, vertexOverhang }`

- Every issue carries `{ id, severity: 'info'|'warn'|'error', heightRange:[t0,t1], message:{fa,en}, fixAction? }`.
- `fixAction` is declarative, for example
  `{ kind:'scale', paths:['effects.1.depth'], factor:0.9 }`,
  `{ kind:'set', path:'print.outputMode', value:'shell' }` or
  `{ kind:'constrainProfile' }`.
- Score = 100 − Σ penalties. Errors cost 15–40 each, warnings 3–10, info 0.
  Overhang penalties scale with the area fraction above the limit. Any
  `error` caps the score at 69.
- Auto-fix (§3 of GEOMETRY.md) is iterative and runs on a low-res grid
  (128×100), then re-verifies at preview resolution and returns a param diff.

## 8. Exports (all in the export worker)

- **Binary STL**, little-endian; the normal is recomputed per triangle.
- **OBJ**, positions and faces only.
- **3MF** (core spec, `unit="millimeter"`, one `<object>` per body (vase,
  saucer), `<metadata>` with recommended slicer settings). The zip is
  hand-written (local headers + central directory + CRC32), and entries are
  compressed with the browser's native `CompressionStream('deflate-raw')`.
  That needs no dependency and is required, because ultra meshes are about
  100 MB of XML uncompressed.
- **Params JSON** and a **ZIP bundle** for multi-body output.
- **Spiral G-code** (P3) is sampled straight from `r(θ, z)`, not the mesh.

## 9. AI module (Phase 2)

- `server/` proxy endpoints `params | refine | image | variations`. The key
  lives only on the server, with per-IP rate limiting, size limits on
  images, and a JSON-only response contract.
- **Prompt =** system rules (return only JSON, start from the nearest
  preset, stay in range, prefer vase-mode-safe choices) + JSON Schema +
  compact preset library + printability rules summary + user text.
- **Client pipeline:** `safeParse → clamp → normalise → autofix → summary`.
  Refinement returns an RFC 6902 patch. The patch is applied to a copy,
  re-validated, and rejected as a whole if any op fails.
- Slider edits never touch the network.

## 10. Testing

Vitest, core only. Test files:

- `geometry/mesh.test.ts`: manifold check (every edge has exactly 2 faces
  and opposite orientation), consistent outward normals (signed volume > 0).
- `geometry/starShaped.test.ts`: slicing each preset at 50 heights yields
  exactly one contour, with no ray hitting more than once.
- `printability/overhang.test.ts`: analytic 45° cone gives 45° ± 0.5.
- `determinism.test.ts`: same seed ⇒ identical FNV-1a hash of the position
  buffer.
- `export/stl.test.ts`: write → parse → compare.
- `params/schema.test.ts`: out-of-range values rejected, and clamp
  round-trips.
- `presets.test.ts`: every preset is manifold, scores ≥ 90, and has no
  error issues.
- `perf.bench.ts`: preview regen < 50 ms (reported, not a hard CI gate).
