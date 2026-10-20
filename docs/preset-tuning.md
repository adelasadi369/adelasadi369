# Sleeve preset tuning (S3)

The six `sleeve-*` presets were tuned against `docs/references/` with a headless render (three views at 0°, 120°,
240°, preview voxel 1.5 mm, insert drawn as a plain cylinder) and at most two tuning rounds per preset. Sources live
in `scripts/presets.src.ts`; run `npm run presets` after editing.

| Preset              | Reference           | Key params                                                                                                                                           | Rounds | Result                                                               |
| ------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `sleeve-molten`     | orange matte photo  | steel Ø40, H 150, teardrop profile (flared base), 4 lobes, `blobs` amount 8 / scale 55 / warp 1.2, organic holes 18 % size 24, 3 irregular rim peaks | 2      | bulbous flared base, blobby asymmetric lobes, large rounded openings |
| `sleeve-silk-drape` | teal on white       | glass Ø50, H 190, 6 lobes 22 %, twist 80° easeIn, silk folds + soft-bulge sag (lower half), 4 rim peaks, few tall holes 8 %                          | 2      | deep folds and tall peaks; holes elongated                           |
| `sleeve-windswept`  | blue with stems     | glass Ø50, H 180, bend 36 mm (≈ 11° lean), twist 140°, 5 lobes, silk folds stretch 7, holes 14 % angle 30° stretch 3.2                               | 1      | strands flow one way, holes run diagonally along the flow            |
| `sleeve-fingers`    | teal separate lobes | glass Ø50, H 180, 6 lobes + 6 fingers width 22, free length 80, curl 9°, fold-gap slits 9 %                                                          | 2      | free fingers above a lobed body, slit gaps between the lobes         |
| `sleeve-coral`      | —                   | glass Ø50, straight Ø96, isotropic ridged noise (silk folds, stretch 1), Voronoi 30 % size 17                                                        | 1      | porous coral lattice                                                 |
| `sleeve-drip`       | —                   | glass Ø50, soft bulges, 4 short fingers (free 35 mm), 8 drips on fingers / rim, no holes                                                             | 2      | smooth body, rim drips with self-supporting bulbs                    |

Every preset is manifold, passes the bore check and scores ≥ 90 at the preview voxel (`tests/presets.test.ts`).

## Known limitations

- **Fingers** (S4): `sleeve-fingers` now uses ribbon fingers (width 28, ratio 4.5 ≈ 6 mm thick) whose outer face
  follows the skin, so they read as tongues of the shell. Seen edge-on they still look like rods, and they stand
  apart rather than overlapping like the photo's.
- **Drips on short fingers are subtle.** A drip runs down a finger's outer side at about half the finger's radius,
  so on `sleeve-drip` the finger drips are small next to the rim drips.
- **Molten** (S4): the blobs effect now fades out over the narrow top (end 82 %, fade 24), which removes the fine
  streaks there.
- **Silk drape** (S4): `keepOutTop` 16 keeps notch holes out of the rim valleys, so the flat tab is gone.
- **Thin shells** (S4): silk-drape, windswept and fingers use a 2.4 mm draped shell and molten a chunky 3.2 mm one,
  open between shell and tube at the top like the photos (`sleeve.skinThickness`, GEOMETRY.md §13g). Coral, drip
  and starter stay solid.
- The sleeve auto-fix rebuilds the hole map for every hole probe and every decision (0.5–1.5 s each); a hard case can
  take ~10–30 s. A cheaper hole map is still open after S4. With a thin shell the auto-fix's 3 mm probes mesh at
  ≤ 1.33 mm (meshVoxel), so they are slower too.
