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
- `blobs` (S3, molten looks): domain-warped 2-octave fBm, `q_z = z / (s·stretch)`,
  `E = amount · fbm(q + warp · (n_x, n_y, n_z)(0.3·q))` with three offset simplex fields `n`. The warp field is
  smoother than the lumps (0.3 ×), so `warp ≤ 2` bends and merges lumps without folding the domain over.

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

## 13. Sleeve mode (S2a): SDF + marching cubes (`src/core/{sdf,sleeve,mc}`)

`print.outputMode = 'sleeve'` has its own deterministic mesh path, `buildSleeveMesh(params, voxel)`. Material is
`d < 0` (mm). The bore axis is vertical through the origin; `R(φ, z)` is the S1 bore profile (§7b) with `zTop = H`.

**Skin map** (`sleeve/skin.ts`). The vase master field is rasterised on a periodic grid in world angles about the
slice centre `C(z)`: column `i` at `θ = 2πi/Nθ`, row `j` at `z = H·j/(Nz − 1)`, value
`r = max(R_MIN, outerRaw(θ − Twist(t), …))`. `Nθ ≥` the grid path's auto-raised count and `≥ πD_max / (voxel/2)`;
`Nz ≥ H / (voxel/2) + 1`. Sampling is bilinear with periodic θ. Ruffle/slant and the shell-only base features are
not part of the skin. The map is cached while only non-skin params change.

```
L      = 1 / sqrt(1 + (r_θ / r)² + r_z²)          finite differences on the map (Lipschitz correction)
d_skin = (ρ_c − r(θ_c, z)) · L                   ρ_c, θ_c about C(z)
```

Approximations: `L` uses `r` instead of `ρ_c` (exact on the surface) and ignores `dC/dz` from bend; the narrow
band carries a 1.5× safety factor for both, and for the bore chamfers' √2 slope.

**Composition** (`sleeve/field.ts`, order fixed, integration doc §3):

```
skin′ = smax(d_skin, z − z_body, 2.5), core′ = smax(ρ − (R_bore + coreWall), z − z_body, 2.5)   only with fingers (§13c)
body = smin(skin′, strands, fingers.blend)                  fingers ∪ drips (§13c)
body = smin(body, core′, coreBlend)                         smin(a,b,k) = min − h²k/4, h = max(k − |a − b|, 0)/k
body = smax(body, (z − Htop(φ)) / √(1 + (Htop′/ρ)²), 2.5)    top edge (§13a); smax(body, z − H, 2.5) when flat
body = smax(body, −g(φ, z), k_hole)                          openings (§13b), k_hole = edgeRoundness · R / r_ref
body = max(body, −z)                                         flat base, sharp
hole = min( max(ρ − R(φ, z), z_b − z),  ρ − r_hole )         r_hole only for lip (R − lipWidth) and drain (Ø/2)
body = max(body, −hole)                                      exact bore, sharp, LAST
```

`R(φ, z)` is evaluated only within 4 mm of `R_bore` (no feature reaches further). With a floor bottom there is no
opening term at all.

**Lattice.** Coarse-aligned cube lattice over `[−reach − 2h, reach + 2h]² × [−2h, H + 2h]` (`reach` = skin reach,
core radius, strand reach, `+ max(coreBlend, fingers.blend)/4`), offset by `0.5·h` on x, y and z, so no sample lies on the axis or on z = 0 / z = H.

**Marching cubes** (`mc/`):

- Case table generated from face rules: on each face, crossing edges are joined so inside corners stay apart
  (ambiguous faces), segments chain into loops (exit on one face = entry on the other), and each loop is fanned
  from an apex none of whose diagonals lies in a cube face (otherwise two cubes could share a face diagonal).
  Face-consistent ⇒ crack-free and edge-manifold.
- Slab by slab in z with per-plane edge caches (output already welded). Crossing `t` is clamped to `[0.01, 0.99]`.
- Narrow band: field at a 4-voxel coarse lattice, then 2-voxel cells inside near coarse cells; a cell is near when
  `min |corner| < 1.5 · diagonal / 2`. Exact samples only within one voxel of a near cell; other samples take the
  sign of a corner value (they never bracket the surface). Identical output to evaluating every sample (tested).

**Post-processing** (`sleeve/index.ts`, `mc/post.ts`):

1. Islands: union-find; keep the largest-volume component, report the removed volume and fraction.
2. Snapping (normals from the raw mesh): `n·r̂ < −0.7` and `|ρ − R(φ, z)| < 0.75·h` ⇒ `ρ := R(φ, z)` for `z > z_b`,
   `ρ := r_hole` below it; `|z| < 0.5·h` and `n_z < −0.7` ⇒ `z := 0`. Snapped vertices are locked.
3. Taubin smoothing, uniform Laplacian, λ = 0.5, μ = −0.53, `sleeve.mesh.smoothing` passes (default 4 since S3; 5+
   thins 3 mm ribs below two lines at the 2 mm drag voxel), locked vertices fixed.
4. Outward orientation (flip all if the signed volume is negative), bed triangles (all three `z = 0`) grouped last
   as the `bottom` surface, area-weighted normals.
5. Validity in O(T): every edge used once in each direction, every vertex's link one cycle, no degenerate triangle,
   one body, positive volume. On failure the mesh is rebuilt once on a lattice offset by `0.3·h` and the retry is
   logged (`mesh.sleeve.log`, info issue `sleeve-retry`).

**Checks** (`printability/sleeve.ts`): mesh validity (error), islands > 1 % (warning), bore accuracy between ribs
(plain snapped vertices `|ρ − R|` and plain bore facets' sag at centroid and edge midpoints, ±0.05 mm; vertices
with `g < k_hole + 1.5·h` belong to a hole edge and are skipped), min wall (march along −n through the SDF from
≤ 3000 vertices; warning below 2 × line width), overhang from face normals (bed faces and faces entirely below one
voxel, the base seam, are skipped; faces in a teardrop-tip zone count as yellow at most), bounds, the S1
press-fit / short-tube / bore-wall checks, and with holes: thin bridges (warning with height range) and bore
contact < 40 % (warning).

### 13a. Top edge (`sleeve/topEdge.ts`)

Tabulated over the axis angle φ (2048 entries, linear interpolation):

```
u     = |sin(N·φ′/2)|,  φ′ = φ + irr · 0.35 · (π/N) · n₁(φ)          u = 0 at the peaks, 1 in the valleys
A(φ)  = amplitude · max(0, 1 + 0.5 · irr · n₂(φ))                    n₁, n₂: seeded simplex on a circle (periodic)
Htop  = max( H − A(φ) · ((1 − s)·u² + s·u),  min(minTubeCoverage, H) )   s = sharpness (u: cusp, u²: wave)
d_top = (z − Htop(φ)) / √(1 + (Htop′(φ)/ρ)²)                         distance correction (Lipschitz ≤ 1)
```

No peaks or zero amplitude gives the flat top `z − H`. Since S3 the rim (flat or peaked) is a smooth max with a
2.5 mm radius (S2a/S2b: 1 mm, and a sharp cut when flat), which reads far less boxy next to the references.

### 13b. Openings (`sleeve/holes.ts`, `sleeve/grid2d.ts`)

The hole set is built on a periodic map over (φ, z) at 0.5 mm per cell at the mean skin radius `r_ref`, independent
of the voxel, and cached while hole, top-edge, seed, overhang and bore inputs are unchanged. `r_ref` and `r_out`
come from a fixed 256 × 64 sampling of the skin (`skinRadii`, `r_out` + 2 % + 0.5 mm), not from the voxel-dependent
skin map, so drag, release and export share one hole map. Holes are radial
through-holes. Each step uses the metric where its constraint is tightest (an anisotropic distance transform,
exact Felzenszwalb, periodic in φ):

| Step                  | Metric (horizontal mm per radian)   | Why                                                                                                                 |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| noise, size, coverage | `r_ref` (mean skin radius)          | sizes as seen on the skin                                                                                           |
| teardrop slope        | `r_out` (outermost material radius) | radial roofs are steeper further in                                                                                 |
| bridges, final `g`    | `R` (bore radius)                   | bridges between radial holes are thinnest there; `g` is 1-Lipschitz in 3D for ρ ≥ R, so the narrow band stays valid |

Pipeline per threshold τ:

1. `S = { n < τ } ∩ band`, with the mode's field `n` (`sleeve/holeFields.ts`, §13d); organic noise is
   `n = simplex(P·f) + 0.8·var·simplex(0.35·P·f)`, `P = (r_ref cos φ′, r_ref sin φ′, z/stretch)`,
   `φ′ = φ − z·tan(angle)/r_ref`, `f = 1/(2·size)` (one octave since S3: two fray the outlines). Components
   narrower than a disc of 0.4 × size (at r_ref) are dropped as specks. Band: `z ≥ max(keepOutBottom, z_b + minBridgeWidth)` and
   `z ≤ Htop(φ) − keepOutTop`. Rim region = `z ≥ Htop(φ)` plus the top row.
2. Up to 4 rounds of: teardrop closure → fill islands → measure bridges → merge.
   - **Teardrop closure** (layer sweep): `D_j = max(d_j, D_{j−1} − dz·tan α)`, hole where `D > 0`, `d_j` = horizontal
     distance to the hole boundary in row j. This is the spec's `g_td(p) = min_t ( g(p − t·ẑ) + t·tan α )` with g the
     per-layer horizontal distance and every row a sample (12 sparse samples leave flat shelves over wide holes;
     with a 2D distance the formula would need `sin α`). Each layer's hole contains the layer below eroded by
     `dz·tan α`: overhang ≤ α by construction.
   - **Islands:** material components not connected to the base become hole.
   - **Bridges:** labelled EDT from all holes and the rim; at each Voronoi edge (neighbouring cells whose nearest
     holes differ) the gap is `d₁ + d₂`. Pairs with gap < `minBridgeWidth` (w) conflict.
   - **Merge** (thinnest first): a capsule of radius w/2 joins the two nearest cells, then a closing of radius w/2
     fills the strips left between them. Guard: if the merged hole would span more than 1/3 of the circumference or
     more than 2.5 × size in height, the smaller hole is removed instead. A hole meeting the rim opens into a notch.
3. Finisher: conflicts still left drop their smaller hole (never thins another bridge or changes a roof).

Coverage (open share of the side `0 ≤ z < Htop`, keep-out bands included): τ by quantile, multiplicative until
bracketed, then bisection (≤ 6 runs). The run closest above the target is preferred (it can shrink smoothly) unless
one below is within 1 point. Fine step: offset the hole set by δ along its distance at R (shrinking measures from
holes ∪ rim, so notches stay open), bisected up to 8 times; every candidate ends with teardrop → islands → bridges →
finisher. Growth is capped by the bridge slack `(minBridge − w)/2 − 1 cell`.

Final field: `g` = signed distance at R to the holes (plus rim cells right above a notch), one [1 2 1] blur pass.
Bore contact = solid share of the bore band `z_b ≤ z < Htop(φ)` on the map. Teardrop tips (`HoleMap.tip`): within
2 mm of a hole edge, where the hole or the material ∨ between merged roofs is narrower than `2·max(1.5·h, k + 1.5)`
at r_out; the meshed tip is rounded there.

With fingers, the band also ends at `z_body − keepOutTop` (cells above `z_body` count as rim), so free fingers are
never cut.

### 13c. Fingers and drips (`sleeve/strands.ts`)

Both are polylines of round cones (`sdf.roundCone`, the exact SDF of the hull of two spheres; its side makes
`asin((r₁ − r₂)/L)` with the axis) about the bore axis, smooth-unioned to the capped skin with `fingers.blend`.
Every radius is ≥ `r_min = max(1.25, lineWidth)` (≥ two lines, and ≥ 2.5 mm across so the 2 mm drag voxel keeps it).

**Fingers.** Finger i (seeded by `random.seed`): tip height `h_i = H·(min + (max − min)·u_i)` from `heightMin/Max`,
base radius `ρ₀ = max(r_min, width/2 · (1 + var·(u − ½)))`, angle `φ₀ = 2πi/N + var·(u − ½)·0.3·2π/N` (so with
`twist.lobes.count = N` the fingers sit on the skin lobes). `z_body = clamp(min_i h_i − freeLength, min(minTubeCoverage,
H), H)`. Path, 28 segments from the bed to `z_end = h_i − tip extent`, with lateral scale `s`:

```
r(z)    = R + 0.6·ρ₀ + s · max(0, z − z_body) · tan(lean)                 rooted against the core and the bore
φ(z)    = φ₀ + s · (Twist(z) + twist · z / z_end)                          follows the skin twist
side(z) = s · tan(curl) · max(0, z − z_body)² / (2 · (z_end − z_body))     curl grows toward the tip
ρ(z)    = max(r_min, ρ₀ · (1 − taper · z / z_end))
```

`s = 1` unless the steepest segment tilts more than `maxOverhang − 3°`; then `s` is bisected (14 steps) until it
does not. A tilted, tapering strand's underside overhangs by at most its tilt. Tips: round (the last sphere),
pointed (a cone of length `2ρ` down to `r_min`), drip bulb (a round cone along the path widening to
`ρ_b = max(1.6ρ, ρ + 2)` at side angle `β = max(8°, maxOverhang − 3° − tilt − 2°)`, length ≤ 3ρ).

**Drips** (`count`, `length`, `bulbSize`, `placement`): bulb radius `r_b = max(1.2·r_min, bulbSize/2)`, strand
`r_s = max(r_min, 0.45·r_b)`, bottom tip `r_t = r_min`. The centreline lies `0.2·ρ` outside the skin (`max(r_skin,
R_core)` sampled from the field at the drip's angle) or, on a finger, `ρ_f + 0.2·ρ` out from the finger axis. From
the bottom: tip sphere `r_t` at `z_bot`, bulb sphere `r_b` at `z_bot + (r_b − r_t)/sin β` with `β = max(10°,
maxOverhang − 8°)`, then the strand up to `z_top` (rim: `min(Htop, z_body) − r_s/2`; fingers: one per finger tip, the
rest from the rim; random: seeded heights). The bulb's underside is that round cone (no flat downward faces); a short
drip gets a smaller bulb, never a steeper one. Tip spheres (drip bottoms, pointed tips) are soft overhang zones
(`Strands.tip`), like teardrop tips.

### 13d. Hole modes (`sleeve/holeFields.ts`)

Every mode only fills the field `n` thresholded in §13b, so teardrops, islands, bridges, the merge guard, the
finisher and the coverage search are shared. Surface coordinates `u = (φ − z·tan(angle)/r_ref)·r_ref` (periodic,
sheared) and `v = z / verticalStretch`.

| Mode           | Field                                     | Notes                                                                                                                           |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `organicNoise` | one-octave simplex + size-variation term  | S2b, one octave since S3                                                                                                        |
| `ellipses`     | `min_i                                    | (u, v) − c_i                                                                                                                    | / a_i` | seeded dart-throwing Poisson disk, spacing 1.6 × size; `a_i = size/2 · (1 + var·(u − ½))` |
| `voronoi`      | `−(F₂ − F₁)`                              | Poisson sites, spacing = size; cell centres open first, so holes are shrunken cells and bridges follow cell edges               |
| `foldGaps`     | `(r − row mean)/row spread + 0.6·simplex` | skin radius from the field on a 256 × ≤ 160 grid about the slice centre (bend ignored); the noise breaks each valley into slits |

### 13e. Self-supporting skin (`sleeve.selfSupporting`)

On the skin map, each column (fixed world angle about C(z)) is swept upward: `r_j := min(r_j, r_{j−1} + dz·tan(α −
2°))`, before the Lipschitz factors. The overhang of `ρ = r(θ, z)` is `atan(r_z / √(1 + (r_θ/r)²)) ≤ atan(r_z)`, so
every skin underside stays within α. Bulges and folds that widen faster are trimmed back (less volume). Bend's
`dC/dz` is not included. Fingers and drips follow the rule always (§13c).

### 13f. Sleeve auto-fix (`printability/sleeveFix.ts`)

Direct patches from the issues first (hole fixes; never `insert.*` or `print.printer.*`), then ablation like §10, in
two phases: **shape** (overhang, wall, mesh issues; knobs: twist, lobe depth, bend, max diameter, flare, effect
depths, finger lean / curl / width, drip bulb) with `cost = red + 0.15·yellow + wall deficit + islands + validity`,
probed **without holes** on a 3 mm lattice; then **holes** (bridges, bore contact, islands; knobs: coverage, size,
minBridgeWidth) with `cost = 0.3·[thin bridges] + max(0, 0.4 − boreContact) + islands`. Each probe sets one knob to
its neutral value; the best knob steps 25 % toward neutral while it helps (a knob whose first step fails is skipped
until another moves); decisions use the 2 mm drag voxel; at most 8 steps.

### 13g. Thin draped shell (S4, `sleeve.skinThickness` T > 0)

The skin becomes a shell of thickness T standing off the core tube; the gap is open at the top edge and closed by a
floor ring at the bottom. Composed before the strand union and the z_body cap (so a cap never closes the gap):

```
r_in(θ, z) = min over |s| < T of r(θ + Δθ, z + Δz) − √(T² − s²),  s² = (r̄_row·Δθ)² + Δz²     ball erosion of the map
r_in(j)    = min(r_in(j), r_in(j + 1) + dz·tan(α − 2°))                                     swept down: self-supporting
inner      = (r_in(θ_c, z) − ρ_c) · L_in                    L_in = Lipschitz map of r_in (as §13)
gap        = (inner + ρ − Rc − G) / 2,   G = max(T, coreBlend)     closes gaps < G (smin would web them)
inner      = smin(min(inner, gap), z − z_floor, 2)            z_floor = max(keepOutBottom, 3, z_b + 1)
skin       = max(d_skin, inner)                               then §13 as before (strands, core, top, holes, base, bore)
```

- The erosion keeps every shell point within T of the outer face along the normal; a radial offset `r − T/L` leaves
  fins under steep rib flanks, and `−d_skin − T` is not 1-Lipschitz T mm inside a ribbed skin (the narrow band then
  misses the inner face). At fine voxels the ball is sampled every `⌈radius/7⌉` cells.
- The downward sweep thickens the shell under an inward lean instead of letting the inner face hang over the gap
  (supports could never be removed from there); the outer face is untouched.
- Rim and hole rounding are capped at T/2 (a wider smooth max necks the wall).
- Meshing voxel: `h ≤ min(T, coreWall) / 1.5` (`meshVoxel`), so the shell and the free-standing core tube each get
  ≥ 1.5 samples across and hole bridges never alias into loose flakes (measured: 2 mm at T = 2.4 left islands up to
  3 % of the volume). The minimum-wall check ignores the thinnest 0.5 % of its samples (normals skimming a fold).
- Holes are radial in (φ, z), so they cut shell and core alike; the bore is still exact and last.

### 13h. Ribbon fingers (S4, `sleeve.fingers.crossSection = 'ribbon'`)

A ribbon is the round strand squashed radially by `a = min(ribbonRatio, ρ_tip / r_min)` (half-thickness ≥ r_min):
`ρ′ = ρ_p(z) + a·(ρ − ρ_p(z))` about the path radius ρ_p(z), distance = roundCone(p′) / a (a 1-Lipschitz lower
bound). Its centre sits at `max(R + 0.6ρ/a, r_skin(φ, min(z, z_body)) − ρ/a)`, so the outer face follows the skin up
to z_body and the free part continues as a tongue of the shell; only the free part is tilt-limited.

Strand evaluation (S4 perf): strands are visited nearest box first; within a strand the segments (rising in z) are
walked up and down from the query height and stop once monotone z bounds exceed the best distance; the search is
capped at `skin + k`, since `smin(skin, s, k) = skin` for `s ≥ skin + k` (the field is unchanged).

### 13i. Export decimation (S4, `mc/decimate.ts`)

Quadric edge collapse (Garland–Heckbert, unit face planes) toward `sleeve.mesh.decimateTarget` (0 = off) with a
quadric error cap of 0.1 mm. A collapse needs the link condition (exactly two common neighbours), no face turning

> 72° or into a sliver, and at most 20 faces per vertex. Snapped vertices (bore, bottom opening, bed) never move:
> a free vertex may collapse onto one; a snapped vertex may only merge into a neighbour of its own kind from the
> interior of that surface, and on the bore / opening every new all-snapped facet stays within 0.03 mm sag of its
> vertices' radius, so the bore stays within ±0.05 mm and the base flat. The result is checked again (manifold).

## 14. Motifs: SVG shapes and text (persian/svg, `src/core/motif/`, docs/persian-patterns.md)

A source gives a signed distance s(u, v) in its units (< 0 inside): closed polylines filled even-odd (inside by a +u
ray), open polylines stroked (distance − half width). Placement maps (φ, z) to source coordinates with x = φ·r_ref:

```
repeat   cell w = 2π r_ref / N, h = (z_band1 − z_band0) / M;  sc = fill · min(w / W, h / H_src)   (mm per unit)
         (lx, ly) = (x − (i + ½)w, z − z_band0 − (j + ½)h) rotated by −rotation; u = lx / sc + W/2, v = ly / sc + H_src/2
single   sc = size / max(W, H_src); lx = wrap(φ − angle)·r_ref, ly = z − height·H
d(φ, z)  = sc · s(u, v), clamped to ±cap; columns per copy are whole (exactly periodic)
```

Relief (effect `motif`), with S = smoothstep(clamp(½ − d / softness, 0, 1)) and interlace level ℓ (§15):
raised `+depth·S·ℓ`, engraved `−depth·S`, both `depth·(S·ℓ − ½)`. Openings (sleeve hole mode `pattern`): the hole
field is ±d (+ for shapes, − for Persian cells), thresholded at 0 without the coverage search; the rest of §13b runs
unchanged. Cross-section from SVG: polar rays from the centroid or a picked centre, outer envelope when a ray crosses
the outline more than once. Silhouette: r(z) from 96 horizontal cuts (closed: about the centre line; open: axis at the
leftmost point), resampled to 12 control points.

## 15. Persian star patterns (`src/core/persian/`)

For a CCW polygon edge with unit direction e, inward normal n, midpoint M and length L, contact angle θ, offset δ:

```
ray A: from M − δL·e along  cos θ·e + sin θ·n        ray B: from M + δL·e along −cos θ·e + sin θ·n
```

(the neighbour across the edge starts its rays at the same points in the opposite directions, so strands are
straight). All ray pairs from different edges that meet inside the polygon (t, u > 0) are candidates with cost t + u;
collinear facing pairs join directly; pairs are taken greedily by cost. The strip's x axis is a lattice vector
w = m·a + n·b (period P = |w|); N periods around give x_strip = φ·N·P / 2π and y_strip = z / sc, sc = 2π r_ref / (N·P).
Constant cell size: ν(z) = 2π r(z) / cell, strips for ⌊ν⌋ and ⌊ν⌋ + 1 cross-faded with smoothstep((frac ν − 0.35) / 0.3),
sc = cell / P. Strap half width = max(strapWidth, 2·lineWidth, minBridgeWidth for openings) / 2, widened by
r_ref / R in the hole map so bridges hold at the bore radius. Interlace: at each crossing the strand with the smaller
direction angle mod 180° is over; points within 2.5 half widths of the crossing that lie off the over strand get ℓ = ½.

## 16. Muqarnas collar (effect `muqarnas`)

Band of `tiers` × tierHeight t_h at the rim (z₀ = H − tiers·t_h) or the base (z₀ = 0); corbel c = min(corbel,
t_h·tan(α − 5°)); ramp = c·(z − z₀)/t_h (rim) or c·(tiers − (z − z₀)/t_h) (base). In tier k, v = local height / t_h,
cell coordinate x = |2·frac(φ·cells/2π + k/2) − 1|; inside |x| < 0.8, v > 0.08, v < v_top(x):

```
v_top(x) = 0.45 + 0.47·((1 − p)·√(1 − s²) + p·(1 − s)),  s = x / 0.8
depth    = min(D·√(1 − s²), (v_top − v)·t_h·tan(α − 3°), (v − 0.08)·t_h·tan(α − 3°))
offset   = ramp − depth
```

The effect window does not fade the collar (mask 1); every slope stays within the overhang limit (vase modes count
inward leans too).
