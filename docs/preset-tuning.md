# Sleeve preset tuning (S3)

The six `sleeve-*` presets were tuned against `docs/references/` with a headless render (three views at 0°, 120°,
240°, preview voxel 1.5 mm, insert drawn as a plain cylinder) and at most two tuning rounds per preset. Sources live
in `scripts/presets.src.ts`; run `npm run presets` after editing.

| Preset | Reference | Key params | Rounds | Result |
| --- | --- | --- | --- | --- |
| `sleeve-molten` | orange matte photo | steel Ø40, H 150, teardrop profile (flared base), 4 lobes, `blobs` amount 8 / scale 55 / warp 1.2, organic holes 18 % size 24, 3 irregular rim peaks | 2 | bulbous flared base, blobby asymmetric lobes, large rounded openings |
| `sleeve-silk-drape` | teal on white | glass Ø50, H 190, 6 lobes 22 %, twist 80° easeIn, silk folds + soft-bulge sag (lower half), 4 rim peaks, few tall holes 8 % | 2 | deep folds and tall peaks; holes elongated |
| `sleeve-windswept` | blue with stems | glass Ø50, H 180, bend 36 mm (≈ 11° lean), twist 140°, 5 lobes, silk folds stretch 7, holes 14 % angle 30° stretch 3.2 | 1 | strands flow one way, holes run diagonally along the flow |
| `sleeve-fingers` | teal separate lobes | glass Ø50, H 180, 6 lobes + 6 fingers width 22, free length 80, curl 9°, fold-gap slits 9 % | 2 | free fingers above a lobed body, slit gaps between the lobes |
| `sleeve-coral` | — | glass Ø50, straight Ø96, isotropic ridged noise (silk folds, stretch 1), Voronoi 30 % size 17 | 1 | porous coral lattice |
| `sleeve-drip` | — | glass Ø50, soft bulges, 4 short fingers (free 35 mm), 8 drips on fingers / rim, no holes | 2 | smooth body, rim drips with self-supporting bulbs |

Every preset is manifold, passes the bore check and scores ≥ 90 at the preview voxel (`tests/presets.test.ts`).

## Known limitations

- **Fingers are round strands.** The references' fingers are flat, ribbon-like and fused to the body over most of
  their length; ours are tapered round cones rooted against the core, so `sleeve-fingers` reads thinner than the
  photo. A flattened (elliptic) cross-section would need a new primitive; left for later.
- **Drips on short fingers are subtle.** A drip runs down a finger's outer side at about half the finger's radius,
  so on `sleeve-drip` the finger drips are small next to the rim drips.
- **Molten** keeps some fine streaks on the narrow upper part (the second fBm octave under the warp); the
  reference is smoother there.
- **Silk drape** can leave a small flat tab where a rim valley meets a notch hole.
- The sleeve walls are solid from the bore to the skin (the SDF model), so the references' thin draped shells are
  approximated by deep lobes and folds.
- The sleeve auto-fix rebuilds the hole map for every hole probe and every decision (≈ 1.4 s each); a hard case can
  take ~10–30 s. S4 perf work (parallel slabs, cheaper hole map) is the planned fix.
