# Rigid heel-lift cup-depth gates

Independent gates for the rigid heel lift. They were written against base `df78a4f1a6a657c4e72e15c14c797ad2f492669a` and then frozen. They are not edited to match a candidate.

The graded path is the production compose path: SAMPLE_Top, US men's 11, medium width, `full_contact`, `printing_solid`, round walls. `printSolidOptions` sets `sourceField` and `composedTop`. `reconstructProceduralPreview` calls `composePrintSolidTop` on that field. The reoriented SAMPLE_Top is the right foot. The left foot is the mirrored sheet.

The heel seat is the lowest interior vertex of the composed top sheet inside the posterior cup (`u` in `[0, 0.30]`, `|v| ≤ 0.50`, rim vertices excluded). Equal height within `1e-6` mm prefers the width center. That vertex is the cup center. The rim sample is the heel-rim vertex nearest that station (`|Δu| ≤ 0.02`). Cup depth is rim z − seat z. Added height at the met heads is the centerline band `u` in `[0.75, 0.78]`. The print/belt face is the solid under the heel (`u ≤ 0.20`); its minimum z stays at 0, and `meshMinZ` / `plantarAbsMaxZ` stay within 0.1 mm of the lift-0 solid.

Tolerances, frozen in `thresholds.ts`:

- seat rise at that lowest point equals `H` ± 0.3 mm (`H` is 6, 10, and 12, both feet)
- cup-depth change equals 0 ± 0.3 mm
- added height at `u ≥ 0.75` is within ± 0.1 mm, and centerline samples do not rise toward the toe (0.05 mm slack)
- belt minimum z within ± 0.1 mm of 0, with at least 500 vertices on that face
- `meshMinZ` and `plantarAbsMaxZ` unchanged versus lift 0, within 0.1 mm, and the belt stays on z = 0
- `heelLiftMm = 0` STL SHA-256 equals the frozen BASE hashes, including a right foot built after a left-foot lift
- no product file outside this directory
- no outer-surface, seam, layer-change, wall-builder, or slicer edit (the #433 surface-file class)
- the S1-PRELOFT 0.5× inset cap is unchanged

A curve sampled at the seat's own `u` is not an accepted substitute for the full lift `H`. A measurement at any vertex other than the lowest heel-seat point is rejected.

On this base the lowest heel-seat vertex is at `u = 0.116`, `|v| ≈ 0.028`, `z = 2.159` mm. Right and left match. At H = 12 that point rises `10.143` mm and the paired rim rises `10.149` mm, so the cup-depth change is `0.006` mm (inside ±0.3) while the seat is short of 12 by `1.857` mm. H = 6 rises `5.071` mm. H = 10 rises `8.452` mm. Met-head added height is `0`. The belt stays at `z = 0`. The suite fails on BASE because the seat rise is not `H`.

Run the frozen gates:

```
node validation/heel_lift_rigid_cup_gates/prove-noop.mjs
node validation/heel_lift_rigid_cup_gates/prove-bad-change.mjs
```

Grade a candidate without editing these files:

```
node validation/heel_lift_rigid_cup_gates/grade-candidate.mjs <sha>
```
