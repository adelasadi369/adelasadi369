# VaseForge (وازفورج)

Parametric, trend-driven vase generator for FDM printers. Every model is
manifold, slicer-ready and checked for printability on each change. The AI
(Phase 2) only ever produces _parameters_; all geometry comes from a
deterministic math engine.

**Status: Phase 1 complete.** That covers:

- Dimensions, profile (17 presets plus a custom spline editor), sections
  (circle, polygon, star, flower, superellipse), twist, lobes and bend.
- Effects: ribs, waves, noise, organic and low-poly facets.
- Rim and base basics.
- Solid (spiral-vase) and shell modes.
- Printability engine and auto-fix.
- 8 trend presets.
- STL, OBJ, 3MF and JSON export.
- Persian/English RTL UI.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest (core: geometry, printability, exports, presets)
npm run lint       # eslint
npm run format     # prettier
npm run build      # typecheck + production build
npm run presets    # regenerate src/presets/*.json from scripts/presets.src.ts
```

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
| `src/i18n`              | `fa.json` / `en.json` UI strings (parameter labels live in the schema)          |

Design docs:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): architecture
- [docs/GEOMETRY.md](docs/GEOMETRY.md): formulas and implementation notes

`src/core` is pure TypeScript with no UI dependencies. ESLint enforces this.
