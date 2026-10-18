# VaseForge — Geometry Formulas

Notation: `t = z / H ∈ [0,1]` and `θ ∈ [0, 2π)`. Percent parameters are
divided by 100 before use. `lerp(a,b,u) = a + (b−a)u`,
`smoothstep(e0,e1,x)` is the usual cubic, `frac(x) = x − floor(x)`, and
`tri(x) = 1 − 2·|frac(x) − ½|` is a unit triangle wave. Every function below
is pure and deterministic. Randomness only enters through `mulberry32(seed)`
or simplex noise seeded by it.

## 0. Master field

```
θw        = θ − Twist(t)                                   (twist-aligned grid: θw = θ_i per column)
base(θ,t) = R(t) · Ŝ(θw, t) · Lobes(θw, t)
r₀        = base
r_k       = r_{k−1} + m_k(t) · E_k(θw, t)                  offset effects (mm)
r_k       = lerp(r_{k−1}, F_k[r_{k−1}](θw, t), m_k(t))      modifier effects (facets, steps, glitch)
r         = max(r_min, Rim(Base(r_K)))                     r_min = 5 mm
P(θ,t)    = C(t) + r · (cos θ, sin θ),   z = t·H  (ruffle/slant remap z near the rim, §6)
C(t)      = bend · t² · (cos β, sin β)                     axis bend; every slice is star-shaped about C(t)
```

The **diameter convention** is that `R(t)` is the _circumscribed_ radius of
the base shape: `max_θ Ŝ·Lobes = 1`. That makes `baseDiameter`,
`maxDiameter` and the rest true outer dimensions before surface effects.
For the same reason, **lobes are normalised inward** (a small change from
the spec's `1 + depth·cos`):

```
Lobes = 1 − d · (1 − cos(n·θw + 2π·swirl·t)) / 2          d = lobesDepth ∈ [0, 0.3]
```

### Effect mask (height window)

```
s, e, f = start, end, fade (fractions);  f ≤ (e − s)/2
m(t) = smoothstep(s, s+f, t) · (1 − smoothstep(e−f, e, t))       (f = 0 ⇒ hard step)
```

## 1. Profile R(t)

Named radii: `rb = baseD/2`, `rm = maxD/2`, `rn = neckD/2`, `rt = topD/2`.
Positions: `tb = belly`, `tn = neck`. Fullness: `φ = strength/100`.

Each preset is a list of **primary knots** `(t, r)` and, per segment, a
bulge sign `σ ∈ {+1, −1, 0}`. A **shoulder knot** is inserted in the middle
of every segment with σ ≠ 0:

```
t_mid = (tA + tB)/2
r_mid = lerp(rA, rB, ½ + 0.4·φ)   if σ pushes toward B,   lerp(rB, rA, ½ + 0.4·φ) toward A
σ = +1 pushes toward the larger radius (full, convex),  σ = −1 toward the smaller (concave, tight)
```

The knots are interpolated with a **monotone cubic Hermite spline**
(Catmull-Rom tangents, limited by Fritsch–Carlson). It never overshoots
between knots, so it never invents bulges, overhangs or `r < r_min`
excursions. A knot flagged `sharp` uses one-sided secant tangents, which
gives a crease.

| preset        | primary knots (t : r)                            | σ per segment |
| ------------- | ------------------------------------------------ | ------------- |
| straight      | 0:rb · 1:rb                                      | 0             |
| taper         | 0:rb · 1:rt                                      | 0             |
| convex        | 0:rb · tb:rm · 1:rt                              | + +           |
| concave       | 0:rb · tb:rn · 1:rt                              | − −           |
| teardrop      | 0:rb · min(tb,.4):rm · 1:rt                      | + −           |
| sphere        | 0:rb · .5:rm · 1:rt (φ forced to 1)              | + +           |
| jar           | 0:rb · tb:rm · tn:rn · 1:rt                      | + + 0         |
| tulip         | 0:rb · tb:rm · tn:lerp(rm,rn,.5) · 1:rt          | + − +         |
| hourglass     | 0:rb · .5:rn · 1:rt                              | + +           |
| sCurve        | 0:rb · tb:rm · tn:rn · 1:rt                      | + − −         |
| amphora       | 0:rb · tb:rm · tn:rn · .93:rn · 1:rt             | + + 0 +       |
| urn           | 0:rb · .12:lerp(rn,rb,.4) · tb:rm · tn:rn · 1:rt | − + + +       |
| bottle        | 0:rb · .06:rm · tb:rm · tn:rn · 1:rt             | + 0 + 0       |
| doubleBulge   | 0:rb · .6tb:rm · (tb+tn)/2:rn · tn:.85rm · 1:rt  | + − − +       |
| flaredTrumpet | 0:rb · tb:rn · 1:rt                              | − −           |
| goblet        | 0:rb · .1:rn·.5 · .3:rn·.5 · tb:rm · 1:rt        | − 0 + +       |
| onionDome     | 0:rb · tb:rm · tn:rn · 1:rt                      | + + −         |
| custom        | user points `(t, r·rm, sharp)`                   | —             |

Switching from a preset to `custom` seeds the editor with that preset's
knots, so editing continues from what the user sees. The table is a first
cut and will be tuned visually during implementation.

**Profile wave:** `R(t) += A · sin(2π · cycles · t)`. Then
`R ← max(R, r_min)`.

## 2. Cross-sections Ŝ(θ) (normalised so max = 1)

Every shape is a positive polar function, so it is star-shaped about the
origin by definition. Corner sizes given in mm are converted with the
current row radius: `c_n = c_mm / R(t)`.

**Polar line through two polar points** (used for polygons, stars and
facets): `P1 = (r1, θ1)`, `P2 = (r2, θ2)`, `θ ∈ [θ1, θ2]`:

```
ρ(θ) = r1·r2·sin(θ2 − θ1) / ( r1·sin(θ − θ1) + r2·sin(θ2 − θ) )
```

| shape                       | formula                                                                                                                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| circle                      | `ρ = 1`                                                                                                                                                                                                                                                                                            |
| polygon (n, corner c)       | Sector half-angle `α = π/n`. Local angle from the nearest vertex is `ψ = ((θ + α) mod 2α) − α`. With `c_n = min(c/R, 1)`, `d = 1 − c_n` (corner-arc centre distance) and apothem `a = d·cos α + c_n`, the tangent angle is `ψ_t = atan2(c_n sin α, d + c_n cos α)`. Then `ρ =                      | ψ           | ≤ ψ_t ? d·cos ψ + √(c_n² − d² sin² ψ) : a / cos(α −                                      | ψ           | )`. Max = `d + c_n = 1`at the vertices.`c_n = 1` gives a circle. Vertex at θ = 0.                                                                                                                                                                                                           |
| star (p, k)                 | Vertices alternate: `(1, 2πi/p)` and `(k, (2i+1)π/p)`. Joined by the polar line.                                                                                                                                                                                                                   |
| flower (p, depth δ)         | `ρ = 1 − δ·(1 −                                                                                                                                                                                                                                                                                    | cos(pθ/2)   | )`. Round petals, cusps between them, valley radius `1 − δ`.                             |
| superellipse (n)            | `ρ = (                                                                                                                                                                                                                                                                                             | cos θ       | ⁿ +                                                                                      | sin θ       | ⁿ)^(−1/n) / 2^(½ − 1/n)` (divided by its max on the diagonal).                                                                                                                                                                                                                              |
| supershape (m,n1,n2,n3,a,b) | `ρ = (                                                                                                                                                                                                                                                                                             | cos(mθ/4)/a | ^n2 +                                                                                    | sin(mθ/4)/b | ^n3 )^(−1/n1)`, evaluated in log-space to avoid overflow and then divided by the max over 2048 samples (cached by hash). **Closure:** the curve is periodic in 2π only if `m`is even, or if`n2 = n3`and`a = b`. Otherwise `m` snaps to the nearest even integer and an info issue is shown. |
| custom (k, mirror, pts)     | Periodic monotone-cubic interpolation of `pts (a_j, r_j)` over `u = frac(kθ/2π)`. With `mirror`, `u ← 1 −                                                                                                                                                                                          | 2u − 1      | ` (kaleidoscope). Otherwise the sector simply repeats (windmill). Normalised by the max. |
| svg                         | The path is flattened to a polyline and centred on its area centroid. 720 rays are cast from the centroid. **Reject** if any ray has more than one crossing ("shape is not star-shaped around its centre; try a simpler outline"). Store `ρ_j / max ρ`; evaluate by periodic linear interpolation. |

**Aspect** (applied after the shape, for every shape): scale by `(A, 1)`.
The direction `θ` comes from the source angle `φ = atan2(sin θ, A⁻¹ cos θ)`:

```
ρ_A(θ) = ρ(φ) · √(A² cos² φ + sin² φ)
```

then normalise by its max (cached). A linear map keeps the shape
star-shaped.

**Morph** (bottom S0 to top S1, lerp in polar space):

```
w(t)    = ease(t)                    linear | easeIn t² | easeOut 1−(1−t)² | easeInOut 3t²−2t³ | sine ½−½cos πt
S(θ,t)  = lerp(S0(θ), S1(θ − rotTop), w(t))
Ŝ(θ,t)  = S(θ,t) / N(t)              N(t) = max_θ S(·,t): 65-entry table over t (512 θ samples per entry), linear interp
```

Renormalising keeps `R(t)` equal to the true max radius in the middle of
the morph.

## 3. Twist

```
Twist(t) = twistTotal · g(t)
g: linear t | easeIn t² | easeOut 1−(1−t)² | easeInOut 3t²−2t³ | sineBackForth sin(2π·osc·t) | custom monotone-cubic(points)
```

## 4. Surface effects

Offset effects return `E(θw, t)` in mm. Positive means outward. Write
`z = tH`, `R̄ = maxDiameter/2`, and `Lc(t)` for the ring circumference.

**Ribs** (count n, depth D, width w, helix h, profile p, raised/grooved):

```
u  = frac( n · (θw/2π + h·t) )                     rib centred at u = ½
x  = (u − ½) / (w/2)                               |x| ≤ 1 inside the rib
p(x): V 1−|x| · round √(1−x²) · flat 1 · softSquare smoothstep(0, 0.3, 1−|x|)   (0 outside)
E  = ±D · p(x)          + raised, − grooved (flutes)
crisscross: E = ±D · max(p(x₊), p(x₋))  with h and −h  (needs h ≠ 0; lattice)
```

**Waves:** `E = A · sin(2π·fz·t + fθ·θw + phase)`. `fθ` is an integer, so
there's no seam.

**Noise** (seamless cylindrical simplex fBm):

```
q  = ( R̄ cos θw / s,  R̄ sin θw / s,  z / s ) + offset(seed)
E  = A · Σ_{o<O} 0.5^o · simplex3(2^o q)  /  Σ 0.5^o
```

**Organic** uses the same cylindrical sampling:

- `softBulges`: 2-octave fBm at scale `s`.
  `E = amount · fbm`.
- `silkFolds`: anisotropic `q_z = z / (s·stretch)`, ridged.
  `E = amount · (1 − |simplex3(q)|)²`.

**Textures** run in cell space `U = repeats · θw/2π`,
`V = z / (aspect · 2π R̄ / repeats)`. Every pattern has period 1 in U
(basketweave has period 2, so `repeats` is forced even). The result is
`T ∈ [0,1]`, then `E = ±depth · T`. The sign is per pattern and flips with
`invert`.

| pattern     | T(U,V)                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| honeycomb   | Hex lattice `(1,0), (½, √3/2)`. Distance to the nearest cell edge is `e`. `T = 1 − smoothstep(0, 0.12, e)` (grooves, −)         |
| knurl       | `T = min(tri(U+V), tri(U−V))` (pyramids, +)                                                                                     |
| diamond     | `T = clamp(1 − 2(                                                                                                               | frac U − ½ | +               | frac V − ½ | )·1.15, 0, 1)` (raised rhombi with gaps, +) |
| basketweave | Cell `(i, j) = floor`, local `(a, b) = frac`. `(i+j)` even: `T = tri(3b)·(0.8 + 0.2 sin πa)`, odd: same with a↔b (+)            |
| chevron     | `T = tri(V + 2·                                                                                                                 | frac U − ½ | )` (+)          |
| scales      | Rows staggered by ½ in U. Dome `h = √(1 − (dist/0.6)²)` centred on the bottom edge of each cell. Upper row drawn over lower (+) |
| hammered    | Voronoi F1 over jittered points (cell hash uses `i mod repeats`, so it's seamless). `T = max(0, 1 − (F1/0.55)²)` (dents, −)     |
| bark        | Cylindrical ridged fBm with V-stretch 4. `T = 1 − (1 −                                                                          | n          | )²` (cracks, −) |
| rope        | `T = √(1 − (2·frac(U + 1.5V) − 1)²) · (0.85 + 0.15 cos 2πV)` (+)                                                                |
| dots        | Staggered grid, distance to the nearest centre `d`. `T = √(max(0, 1 − (d/0.3)²))` (+)                                           |

**Modifier effects** need the field below them, `r_prev`, evaluated at
other points. They go through cached coarse samples, so cost stays O(1)
per vertex.

- **Facets** (a × v segments, jitter j): nodes sit at
  `(θ_a = 2πi/a, t_b = s + (e−s)·k/v)` with
  `r_node = r_prev(node) + j·(2·rand(seed,i,k) − 1)`, using `i mod a` for
  seamless wrap. Inside each node quad, split by its diagonal into two
  triangles: take the polar-line radius along the two bounding rows, then
  interpolate linearly in t. That gives flat, planar-looking facets. Nθ is
  forced to a multiple of `a` and rows snap to `t_b`.
- **Steps** (count c, bevel b):
  `k = floor(c·t')` and `σ = frac(c·t')` over the window coordinate `t'`.
  `F = r_prev(θ, t_k)`, and in the upper bevel band `σ > 1 − b`, `F` is
  `lerp(r_prev(θ,t_k), r_prev(θ,t_{k+1}), (σ − (1−b))/b)`.
  The minimum bevel for overhang safety is
  `b ≥ |Δr| · c / (H_window · tan α_max)` (vase modes count both
  directions). The printability check reports this and auto-fix raises `b`.
- **Glitch** (bands B, offset o, shift ψ): use `mulberry32(seed)` to draw
  B bands `[z0, z0 + h]` with `h ∈ [3, 12] mm`, and per band `Δr ∈ [−o, o]`
  and `Δθ ∈ [−ψ, ψ]`. Inside a band,
  `F = r_prev(θw − Δθ, t) + Δr`. Each band edge ramps over
  `|Δr|/tan α_max + 0.5 mm`, so ledges are never horizontal.
- **Displacement** (P3): `E = depth · (img(U, V) − ½)`, with bilinear
  sampling and tiles `(tilesU integer, tilesV)`.

## 5. Base modifiers (radial unless noted)

```
chamfer c:       z < c         ⇒ r −= (c − z)                     (45° elephant-foot chamfer)
foot ring h, i:  z < h − i     ⇒ r = r(θ, h) − i
                 h−i ≤ z < h   ⇒ r = r(θ, h) − (h − z)             (45° transition, never a flat ledge)
concave base (shell only): outer bottom surface z_b(ρ) = c·(1 − (ρ/ρ₀)²)⁺, ρ₀ = 0.8·r_inner_bottom
drainage hole (shell only): bottom and floor become annuli, plus a vertical cylinder of Ø d
```

## 6. Rim modifiers

```
flare F over zone ζ:   u = (t − (1−ζ))/ζ ∈ [0,1]  ⇒  r += F·u²          (C¹ at the zone start)
lip (shell):           inner r_in −= lip · smoothstep(1 − 3lip/H, 1, t)
round rim (shell):     rim ring = half-circle from outer top to inner top, 6 segments, apex +w/2
ruffle / slant (shell only): the top edge height depends on θ:
  z_top(θ) = H − D_r·(1 − cos(n_r θw))/2 − S/2 − (S/(2 R_top))·r_top(θ)·cos(θ − φ_s)   (the last term is an exact cut plane)
  rows above z_s = min z_top − 2 mm are remapped z ← z_s + (z − z_s)·(z_top(θ) − z_s)/(H − z_s)
```

The grid keeps its topology under this remap. Ruffle and slant need
`shell` mode because a scalloped or tilted top makes some layers multiple
arcs in vase mode.

## 7. Inner surface (shell)

Radial offset that guarantees **normal** thickness ≥ w, where `n̂` is the
surface normal and `ê_r` the radial unit vector:

```
δ(θ,t)   = w / max(0.3, n̂ · ê_r)
smooth liner: r_in = min( base − δ_base,  r_outer − δ_outer )        (no textures inside, never thinner than w)
follow:      r_in = exact sampled erosion of the outer solid by a ball of radius w:
             r_in(θ,z) = min over outer samples q within distance w of
                         [ ray(θ, z) entry distance into ball(q, w) ]
               ⇒ inside the outer surface, ≥ w away, and still one radial value per (θ, z): no self-intersection.
inner floor at z = bottomThickness (+ foot height);  r_in ≥ 2 mm, otherwise error "too narrow for shell".
```

### 7b. Tube bore liner (`innerSurface: 'bore'`, shell only; `src/core/insert/`)

The bore is a vertical cylinder about the base centre (the origin), sized for a real glass/steel tube.
`R_bore` is derived, never stored:

```
R_target = od/2 + clearance + odTolerance/2          (clearance defaults: press 0.10, snug 0.18, slip 0.25)
R_bore   = R_target + print.printer.holeCompensation  (printer-specific, calibrated with the Fit Test Ring)
z_b      = 0 (open) | lipThickness (lip) | floorThickness (floor, drain)

R(φ, z) = R_bore
        + (z_b + c_b − z)⁺                 on [z_b, z_b + c_b]   bottom chamfer, open/lip only (elephant's foot)
        + (z − (z_top − c_e))⁺             on [z_top − c_e, z_top] entry chamfer, per-column top (ruffle/slant)
        + depth · min(1, d/flank)          O-ring groove, d = width/2 − |z − z_c| > 0, flank = min(depth, width/2) (45°)
        − v(z) · i · ½(1 + cos(π·δ/a))     grip rib k: δ = φ − 2πk/n, |δ| < a = width/(2R_bore);
                                           v ramps 0→1 over 1 mm at both ends of [z_b + c_b, z_b + h·(z_top − z_b)]
```

- **Placement.** The grid stays twist-aligned: vertex `(i, j)` lies on the ray from the slice centre `C(t)` at
  angle `θ_i + Twist(t)`. The bore vertex is the ray's hit with the profile about the axis:
  `s = −C·u + sqrt((C·u)² − |C|² + R²)`, iterated twice so `R` is evaluated at the hit's own world angle `φ`.
  With `C = 0` (no bend) the bore is exact by construction. Each slice stays star-shaped about `C(t)` as long as
  `|C(t)| < R` (otherwise error `bore-axis`).
- **Bottom.** open → annulus at z = 0 from the bore ring to the outer ring; lip → floor annulus at `z_b` to a hole
  of radius `R_bore − lipWidth`, hole wall, bottom annulus; drain → same with `drainDiameter/2`; floor → fans.
  The lip/drain hole is clamped to stay 1 mm inside the floor ring. Concave base and the rim lip cut are off.
- **Resolution.** `Nθ ≥ π / acos(1 − 0.01/R_bore)` (chord sag ≤ 0.01 mm, so the tube touches facets within the
  ±0.05 mm budget) and `Nθ ≥ 6·2πR_bore/ribWidth`; `Nθ` is a multiple of the rib count so ribs centre on columns
  when there is no twist. Rows snap to chamfer, groove and rib-ramp edges.
- **Checks.** `bore-wall`: horizontal wall `r_outer − r_bore` along each ray `< coreWall` → error, fix scales all
  diameters by `max((r_bore + coreWall)/r_outer)·1.01`. `bore-ok` / `bore-accuracy`: max |vertex radius − R(φ,z)|
  and the widest facet's sag, against ±0.05 mm.
- **Fit Test Ring.** The bottom 10 mm of the same profile from z = 0 (bottom type, bottom chamfer, ribs, grooves in
  range) inside a plain tube of radius `max R + coreWall`. Calibration: `c_new = c_old + (Ø_target − Ø_measured)/2`.

## 8. Mesh assembly

| mode           | surfaces                                                                                                                                                                                                                                                                                                                     | closed       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| solidVase      | outer grid (periodic θ) + bottom fan at C(0) + top fan at C(1)                                                                                                                                                                                                                                                               | yes, genus 0 |
| shell          | outer + inner grids + rim ring (flat or round) + outer bottom fan/annulus + inner floor fan/annulus (+ hole cylinder); the bore liner (§7b) uses the same surfaces                                                                                                                                                           | yes          |
| doubleWallVase | shell body whose wall is cut by a slit at θ_s of width 0.0001 mm (columns at θ_s ± 0.00005/r) from the floor to the rim. Two slit faces connect outer and inner. Below the floor the seam is closed by a 0.0001 mm strip. Each layer is then a single C-shaped contour, which the slicer prints as two walls in spiral mode. | yes          |

Winding is CCW seen from outside, and signed volume > 0 is asserted. Quads
are split along the shorter diagonal. No triangle is degenerate: `r ≥ r_min`
and `Δθ > 0`, and cap fans use distinct ring vertices.

## 9. Printability formulas

- **Overhang** of a wall face, relative to vertical:
  `α = deg(asin |n_z|)`. Vase modes count `|n_z|` (inward lean too).
  Shell mode counts the outer surface only where `n_z < 0`.
  Green ≤ α_max, yellow ≤ α_max + 10°, red above. The issue metric is the
  area fraction per height band.
  Check: a cone `r = r0 − z` has `n_z = 1/√2`, so α = 45°.
- **Feature size**, per ring and per repeated feature with repetitions N
  and depth d: `pitch = Lc(t)/N ≥ 2·nozzle` and `d ≤ 0.5·pitch`.
  For a star, `d = (1−k)·R`; for a flower, `δR`; for ribs and textures, the
  effect depth.
- **Walls:** in vase mode `1.5·noz ≤ lw ≤ 2·noz` and
  `layer ≤ 0.66·lw`. In shell mode `wall ≥ 2·lw`, snapped to
  `round(wall/lw)·lw`.
- **Bounds:** `max(bboxX, bboxY) ≤ min(bedX, bedY) − 5` and
  `zmax ≤ bedZ`.
- **Stability:** warn if `baseD < 0.35·H`. Centre of mass: vase modes use
  the area-weighted centroid of the walls (shell thickness lw) plus the
  bottom disk; shell mode uses the volume centroid of the solid. Add a
  water fill for `freshFlowers`. The XY projection must lie inside the base
  contact contour (foot ring included) scaled by 0.8 about its centroid.
- **Stats:**
  - Volume of a closed mesh: `Σ (v0 · (v1 × v2))/6`.
  - Capacity: `Σ_rows ½∫r_in² dθ · Δz` above the floor.
  - Weight: material volume · ρ_mat. Vase mode: area · lw + bottom area ·
    bottomThickness.
  - Time: extruded volume / volumetric flow(material, printer) · 1.15.

## 10. Auto-fix

1. **Attribution.** For every red overhang band, evaluate low-res variants
   with each contributor neutralised: twist rate, profile slope, profile
   wave, lobes, and each effect active in that band (via its mask).
   Contribution = the drop in red area.
2. **Loop (≤ 20 iterations):** multiply the top contributor's amplitude
   parameter by 0.9 (twist total, `|maxD − neighbours|`, wave amplitude,
   effect depth/amplitude, bevel ↑). Regenerate at 128×100 and re-score.
   Stop when there are no errors and score ≥ 90.
3. **Profile constraint** (alternative): sample `R` densely (512). Run a
   forward and a backward pass enforcing
   `R(z + dz) ≤ R(z) + tan α·dz` (and the mirror inequality in vase
   modes). Refit ≤ 12 knots with Douglas–Peucker and switch to `custom`.
4. Return `{ before, after, diff: [{ path, from, to }] }`. It is applied as
   one undoable history entry.

## 11. Implementation notes (Phase 1)

Decisions made while implementing Phase 1, where the code differs from or
refines the formulas above:

- **Chamfer is lean-aware.** Rows below `z = c` are clamped to the 45° line
  from the row at `c`:
  `r(z) = min(r(z), r(c) − (c − z))`.
  A wall that already flares outward faster than 45° is left alone, so the
  chamfer can never make an overhang worse.
- **Shell overhang includes the inner wall.** The spec says "outer only".
  The inner surface counts too wherever it faces down (`n_z < 0`), because
  an inward-leaning shell overhangs on the inside as well.
- **Organic and facets ship in Phase 1.** Presets 7 and 8 need them. The
  other modifier effects (steps, glitch) and textures stay in Phase 2.
- **Grid density.**
  - Periodic features (ribs, sides, lobes, `freqTheta`, facets) force Nθ to a
    multiple of their count with ≥ 8 samples each. Facets get 24 per facet.
  - Noise and organic need ≥ 4 samples per feature but don't affect the
    multiple.
- **Smooth liner.** Each row is pulled in by that row's maximum inward
  effect depth, then clamped by `r_out − δ_out`. The inside stays smooth and
  is never thinner than the wall.
- **Low-quality drag preview.** While a slider is being dragged, the worker
  builds at `low` quality. On release it rebuilds at the preview quality.
- **Manifold check per topology.** The check runs once per grid topology and
  is cached, since the topology is fixed by construction. Tests and exports
  always run it.
- **Auto-fix decides at preview resolution.** Its ablation probes use the
  low grid.

## 12. Implementation notes (Phase 2)

- **Mesh builder.**
  - A growable builder with explicit surfaces: grids (periodic or open),
    fans, and flat-shaded `faces` that duplicate existing vertices.
  - A `canonical` map welds render-split vertices.
  - Every mode is checked for manifoldness in the tests.
- **Ruffle / slant.** Rows above `z_s = H − ruffle − slant − 2 mm` are
  remapped per column to `z_top(θ)`. Each remapped vertex re-evaluates the
  field at its true height. The slant uses the circle approximation of the
  cut plane (exact for round sections).
- **Concave base / drainage.**
  - The bottom becomes rings scaled about the base centre,
    `z = c·(1 − (s/0.8)²)⁺`, inner → outer, normal down.
  - A hole adds an annular floor, an annular bottom and a vertical hole
    wall. All of them use radial strips along the base vertices'
    directions, so the base stays star-shaped and free of overlaps.
  - The hole is clamped to 0.6 × the smallest base/floor radius, with a
    warning.
- **Double wall.**
  - Outer, inner and rim grids get one extra seam column, offset by
    ±0.00005 mm / r.
  - A 2-column seam strip closes the outer wall below the floor.
  - Two planar slit faces run from the floor to the rim arc.
  - The floor fan's wedge plus a slit-gap quad close the floor.
  - Every layer above the floor slices to one C-shaped contour.
- **Follow liner.** An exact sampled erosion: for each inner ray, take the
  nearest entry into the balls of radius `w` around outer samples within
  `w` (rows and columns). The result is never thinner than the wall and
  can't self-intersect.
- **Steps.** Each level is cached as a 2048-sample θ-ring of the field
  below it. Rows snap to step and bevel edges.
- **Glitch.** Seeded, non-overlapping bands. Edge ramps are
  `(|Δr| + 0.3·R̄·|Δθ|)/tan α + 0.5 mm`.
- **Textures.** Cell space `U = repeats·θ/2π`, `V = z / (aspect·2πR̄/repeats)`.
  Hammered uses a Voronoi hash wrapped with `i mod repeats`. Bark uses
  cylindrical noise. Basketweave forces an even repeat count.
- **Morph.**
  `Ŝ = lerp(S0(θ), S1(θ − rot), ease(t)) / N(t)`, where the 65-entry `N(t)`
  table keeps `R(t)` the true maximum radius.
- **Saucer.** A separate shell body. Its inner wall is the vase's base
  contour plus `gap`, with flare `rim·u²`. The viewer and 3MF place it
  10 mm beside the vase; STL/OBJ exports become a ZIP.
