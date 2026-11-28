# Morton's shape gates, v2

Frozen measurement of Kendon's foot-axis Morton's edge. These files were
forked from PR #421 at `acb34831fd43398491ec7a299da8b8b65b43a853` and then
retargeted. PR #421 is not edited. Do not edit this gate code after the v2
proof commit. The worker must not edit these files.

The scored edge is a straight line parallel to the heel-to-toe axis (`dir`
is exactly `(1, 0)`), through the 1st/2nd intermetatarsal midpoint. It is
not the v1 chord from the medial border at the 1st MPJ to `u = 0.97`. The
plateau turns medially at 11 mm proximal of the 1st MPJ. The 25 mm blend and
the 8 mm bevel cap are unchanged.

Thresholds are in `measure.ts`. Replaced checks:

- S1 angle: 99% contour versus the heel-to-toe axis, ≤ 2°.
- The same edge, at the 2nd metatarsal head, is 0–2 mm medial of that head's medial border.
- Added height at the 2nd met head center is 0 (within 1e-6 mm) at 3 mm and 6 mm.
- G3: full nominal height medial of this foot-axis line.
- G5 and G6: rise and slope on the foot-axis ray through the 1st MPJ.
- G10: vertices outside the band around this line (25 mm blend, 8 mm bevel cap).
- G4 at v = 0.3 is measured and accepted. It does not fail `scoreFootAxisEdge`.

G1, G2, G4 at v = 0.1 and v = 0.2, G7, G8, G9, G11, S2, S4, S7, the
`SAMPLE_Top` hash, the 25 mm blend, and the 8 mm bevel cap are the v1
thresholds.

Default `rstest` run is the no-op proof: the new edge gates fail on this
checkout (the product code is still the pre-fix main this branch forked),
and the gates that already hold pass. `MORTONS_GATE_MODE=grade` records the
same measurements without requiring the defect to remain.

`proofs/noop-main.json` is that no-op. `proofs/bad-change-slanted.json` is
the old slanted-chord build, PR #402 at `7c97806da5381653452f7a71fd3ce6c21089d8a8`,
which fails S1, G3, and G10. A synthetic copy of that slant is also asserted
in `gates.test.ts`.
