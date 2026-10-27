# Persian design language — SVG motifs, star patterns, muqarnas, forms, text

This branch (`persian/svg`) adds a 2D **motif** pipeline and a Persian design-language engine on top of the existing
params → field → mesh pipeline, the effects system and the sleeve hole-map pipeline. Nothing here is a new mesh
path: every feature ends as a radial offset in the vase field (relief, muqarnas) or as the hole field of the sleeve
hole map (openings). All of it is off by default, so the golden vase test is unchanged.

Formulas: GEOMETRY.md §14 (motif map, relief, openings), §15 (star patterns), §16 (muqarnas).

## 1. The motif pipeline (`src/core/motif/`)

- **Sources** answer "signed distance to the motif" in their own units (< 0 inside a filled shape or a strap):
  SVG shapes and text outlines (closed pieces filled even-odd, open pieces stroked) and Persian strap networks
  (`motif/source.ts`, binned segments).
- **Placement** (`motif.placement`): `repeat` = N (integer) copies around × `repeatsUp` rows inside the band, each
  scaled to `fill` % of its cell and rotated; `single` = one copy at `angle` / `height`, its longest side `size` mm.
  Persian patterns are strips with a native period instead (§3).
- **Map** (`motif/map.ts`): the distance in mm on a periodic (φ, z) grid of ≈ 0.4 mm (a whole number of columns per
  repeat, so the map is exactly periodic), capped at ±cap, sampled bilinearly; a few maps are cached.
- **Uses:** the `motif` effect (relief: raised, engraved or both, depth, edge softness; vase and sleeve skins), and
  the sleeve hole mode `pattern`: the hole field is the map (SVG / text shapes open inside, Persian cells open
  outside the straps) at a fixed threshold, so bridges, teardrop tops, islands and the coverage report all come from
  the existing pipeline. Coverage is a result, not a target, in this mode.
- **Printability** (`printability/motif.ts`): engraving deeper than the wall minus two lines (shell wall or thin
  sleeve skin), motif parts narrower than two lines (a morphological opening on the map; skipped for Persian straps,
  which are two lines wide by construction), raised edges steeper than the overhang limit (fix: softer edges or a
  shallower relief). Bridges, islands and overhang come from the existing checks.

## 2. SVG import (`src/svg/parse.ts`, Motif tab)

- The file is parsed as **data only**, without the DOM: a tag tokenizer reads `svg g a switch` and `path polygon
polyline rect circle ellipse line` with their transforms (translate / scale / rotate about a point / skew /
  matrix). Scripts, styles (and the `style` attribute), `foreignObject`, `image`, `use`, `defs`, `symbol`, masks,
  patterns, gradients, filters, text and hidden elements are dropped with their subtrees; the drop list is shown.
- Paths: M L H V C S Q T A Z, absolute and relative, compact arc flags; curves are flattened after the transform to
  5·10⁻⁴ of the drawing's diagonal; more than 20 000 points are simplified (Douglas–Peucker).
- Storage (`motif/blob.ts`): polylines normalised to their box (longest side 1, y up), quantised to 10⁻⁴, delta
  encoded, lz-string compressed, ≤ 64 KB, plus an FNV-1a hash. Raw SVG is never stored. Saved designs keep the blob;
  share links drop it above 8000 characters and say so. The AI can never write `motif.svg.*` or `motif.text.*`.
- **Cross-section:** a closed outline → polar r(θ) by rays from the area centroid or a centre picked on the
  thumbnail; an outline that is not star-shaped falls back to its outer envelope with a warning. Works for vase and
  sleeve skins (the skin is the vase field).
- **Silhouette:** the tallest path read as r(z) (closed: about its centre line; open: a half profile with the axis
  on its left) → 12 editable custom-profile points.
- **Pattern:** the blob placed by the Motif block, then _Relief_ (adds a Motif effect) or _Openings_ (sleeves).

## 3. Star patterns (`src/core/persian/`)

**Method.** Hankin's _polygons in contact_ (C. S. Kaplan, "Islamic star patterns from polygons in contact",
Graphics Interface 2005): every edge midpoint of a tiling polygon emits two rays into the polygon at the **contact
angle** θ to the edge; with an **offset** δ they start δ·edge apart (the two-line variant used for rosettes). Rays
are paired greedily by the shortest combined length to a meeting point inside the polygon; collinear rays facing each
other join directly. Neighbouring polygons share the contact points, so strands run straight across every edge and
the network is connected.

**Tilings** (edge 1, a lattice basis plus one cell): 4.4.4.4, 6.6.6, 4.8.8, 3.12.12, 4.6.12, and girih tiles (E. Lu &
P. Steinhardt, "Decagonal and quasi-crystalline tilings in medieval Islamic architecture", Science 2007): edge-sharing
decagons with the gaps between them (found by cancelling shared edges and chaining the rest into loops), elongated
hexagons, and 72° rhombi. Girih strapwork is Hankin's rule at θ = 54° on these tiles.

**Named patterns:** khatam (4.8.8, 67.5° — the 8-point star), shamseh 8 (4.8.8, 72°, offset 0.12), shamseh 10 (girih
decagons, 63°, offset 0.1), girih 10 (girih decagons, 54°), 12-fold star (4.6.12, 60°). `custom` exposes tiling,
angle and offset.

**Seamless wrapping.** The pattern is cut as a strip whose x period P is a **lattice vector**; `rotation` snaps to the
nearest lattice direction (|m|, |n| ≤ 3), so N periods close exactly at θ = 0 / 2π. Sizing: _constant repeats_ (N
fixed; cells widen and narrow with the radius) or _constant cell size_ (N(z) = 2π r(z) / cell from the profile; where
the count steps, the two strips are cross-faded over a band of Δν = 0.3). _Auto-rotate_ picks the lattice direction
with the least strap length within 25° of horizontal (flat cell tops need supports).

**Uses.** Relief straps (raised), recessed cells (engraved), or both, with optional **interlace**: at every crossing
the strand whose direction angle (mod 180°) is smaller stays up and the other steps down by half the depth within
2.5 strap half-widths. Sleeve openings: cells open, straps are the bridges; the strap width is never below two print
lines, nor (for openings) `minBridgeWidth` measured at the bore radius. _Printable_ = teardrop tops on; _exact
geometry_ = teardrop off, and the overhang check reports the flat cell tops.

## 4. Muqarnas collar (effect `muqarnas`)

Tiers of niche cells (pointed-arch half-domes) in a band under the rim or at the base, each tier shifted by half a
cell. The collar corbels outward as a continuous ramp no steeper than maxOverhang − 5°; each niche is a half dome
whose depth is capped under the arch and above the sill at tan(maxOverhang − 3°) per mm, so roofs rise like teardrops
and nothing needs support, in vase modes (inward leans count) as on sleeves.

## 5. Vessel forms inspired by Persian ceramics

Starting points for the custom profile (Shape tab → _Persian forms_), not replicas of historical objects; every
slope stays within 45° and the foot within the stability rule, and the points stay editable:

| Form               | Shape intent                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Golabpash          | rosewater sprinkler: small foot, round bulb, long slender neck opening slightly at the mouth |
| Seljuk storage jar | ovoid body widest at mid-height, short neck with a slightly everted lip                      |
| Kashan bowl        | wide conical bowl on a small ring foot, straight flaring walls                               |
| Safavid ewer body  | pear-shaped body narrowing into a tall neck (no handle or spout)                             |
| Qajar trumpet vase | slim waisted body and a wide trumpet mouth                                                   |

## 6. Persian text

Text is outlined in the browser with **opentype.js 1.3.4** and **Vazirmatn Regular** (SIL Open Font License,
`public/fonts/Vazirmatn-Regular.ttf`, licence beside it). opentype.js shapes Arabic script: contextual forms
(isolated / initial / medial / final), the lam-alef ligatures and right-to-left layout, so Persian words come out
joined (tests check سلام → seen initial, lam-alef final, meem isolated). The outline goes through the same data-only
path parser and blob as SVG, then any placement: usually _single_, raised or engraved, or cut through on sleeves.

## 7. Cultural notes

Girih, khatam and shamseh are living Persian crafts — tile work, inlaid wood (khatam-kari), stucco and book
illumination — with workshop rules far richer than one construction. The generator reproduces the geometric skeleton
(the strapwork lines) and labels its presets by the family they evoke; it does not claim the proportions of any
monument or object. Calligraphy in particular (Nastaliq, Thuluth) is an art of its own: use a calligrapher's SVG for
it, and credit the calligrapher.

## 8. Known limitations

- Interlace is a local rule (lower direction angle on top), not a strict over-under alternation along each strand;
  it is periodic and reads as woven, but a careful eye finds places where a strand goes over twice in a row.
- Girih covers three periodic arrangements; quasi-periodic (Penrose-like) girih and the full five-tile rules are not
  generated, and bowtie / pentagon pieces appear only as the decagon gaps.
- `rotation` snaps to lattice directions (seamless wrapping needs a lattice vector around the body).
- Constant cell size blends two strips where the count changes; the blend band shows thinner straps for a few mm.
- Text: one line, Vazirmatn Regular only, no kashida justification; Nastaliq needs an SVG.
- The pattern hole map takes 1–2.5 s (motif map + hole pipeline); no perf tuning was done on this branch.
