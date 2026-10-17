# VaseForge (وازفورج)

Parametric, trend-driven vase generator for FDM printers. Every model is
manifold, slicer-ready and checked for printability on each change. The AI
(Phase 2) only ever produces _parameters_; all geometry comes from a
deterministic math engine.

**Status: Phase 2 complete.**

- **Phase 1:** dimensions, 17 profile presets plus a custom spline editor,
  sections, twist, lobes, bend, ribs/waves/noise/organic/facets, rim and
  base basics, solid and shell modes, printability engine and auto-fix,
  STL/OBJ/3MF/JSON export, Persian/English RTL UI.
- **Phase 2:**
  - 10 seamless textures, steps/terraces and glitch.
  - Section morphing, supershape, the polar "windmill" editor and SVG import
    (star-shape check).
  - Ruffle and slanted rims, concave base, drainage hole.
  - Double-wall vase mode (0.0001 mm slit) and the "follow" inner surface.
  - Saucer as a separate body, with ZIP and multi-object 3MF export.
  - Presets 9–14.
  - AI: text → params, refinement chat (JSON Patch), photo → params,
    variations.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest (core: geometry, printability, exports, presets)
npm run lint       # eslint
npm run format     # prettier
npm run build      # typecheck + production build
npm run presets    # regenerate src/presets/*.json from scripts/presets.src.ts
npm run server     # AI proxy on :8787 (needs ANTHROPIC_API_KEY); `npm run dev` proxies /api to it
```

### AI proxy

The browser never sees the API key. `server/` is a small Node HTTP proxy
built on the official Anthropic SDK. It exposes:

- `POST /api/ai/params`
- `POST /api/ai/refine`
- `POST /api/ai/image`
- `GET /api/ai/health`

It has per-IP rate limiting, size limits and JSON-only responses.

| Env var             | Default           |                                           |
| ------------------- | ----------------- | ----------------------------------------- |
| `ANTHROPIC_API_KEY` | —                 | required (or an `ant auth login` profile) |
| `VASEFORGE_MODEL`   | `claude-opus-5-5` | model id                                  |
| `PORT`              | `8787`            |                                           |
| `ALLOWED_ORIGIN`    | —                 | set for cross-origin deployments (CORS)   |

Responses are constrained by structured outputs (zod schemas in
`src/ai/schema.ts`), and server-side refusal fallback is enabled. The app
then validates, clamps and auto-fixes every AI change before it becomes
the design. It is one undoable step. Variations and photo-silhouette
extraction run locally and need no server.

## Layout

| Path                    | What                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| `src/core/params`       | zod schema (single source of truth), clamp/normalize, randomize, share links    |
| `src/core/geometry`     | profile, sections, twist, effects, field compiler, grid planning, mesh builder  |
| `src/core/printability` | overhang, feature size, walls, bounds, mode, stability, sanity, stats, auto-fix |
| `src/core/export`       | binary STL, OBJ, 3MF (hand-written ZIP + native deflate)                        |
| `src/workers`           | comlink geometry worker (preview + separate export worker)                      |
| `src/state`             | Zustand store (undo/redo, latest-wins regen scheduler)                          |
| `src/ui`                | React UI: panels, profile editor, effect stack, viewer, print check             |
| `src/presets`           | full parameter JSON per trend preset                                            |
| `src/ai`                | AI contracts (zod), prompts built from the schema, apply/patch logic, client    |
| `server`                | AI proxy (Anthropic SDK; key stays server-side)                                 |
| `src/i18n`              | `fa.json` / `en.json` UI strings (parameter labels live in the schema)          |

Design docs:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): architecture
- [docs/GEOMETRY.md](docs/GEOMETRY.md): formulas and implementation notes

`src/core` is pure TypeScript with no UI dependencies. ESLint enforces this.
