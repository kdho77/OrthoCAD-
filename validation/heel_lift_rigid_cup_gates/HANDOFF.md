# Handoff

Candidate SHA: gates frozen, worker not yet up.

Frozen gates commit: `0e753f88ce2b71d41ab7568ce600d2d8dcedf75b`
BASE: `df78a4f1a6a657c4e72e15c14c797ad2f492669a`
Draft PR: https://github.com/kdho77/OrthoCAD-/pull/444 (do not merge)
Same commit on `cursor/heel-lift-rigid-cup-gates-1124`

## Tests

- `node validation/heel_lift_rigid_cup_gates/prove-noop.mjs` — exit 0. Clinical cases fail on BASE. Identity, surface, cap, tolerances, and the logic hash pass.
- `node validation/heel_lift_rigid_cup_gates/prove-bad-change.mjs` — exit 0. Every required bad copy is rejected.
- `node validation/heel_lift_rigid_cup_gates/grade-candidate.mjs <sha>` — not run. The worker branch is absent.

## Grades on BASE

Lowest heel-seat point: u = 0.116, |v| ≈ 0.028, z = 2.159 mm. Both feet.

| Gate | Measured | Threshold | Grade |
| --- | --- | --- | --- |
| (a) seat rise | H=6 +5.071; H=10 +8.452; H=12 +10.143 | H ± 0.3 | FAIL |
| (b) cup depth change | +0.003 / +0.005 / +0.006 | 0 ± 0.3 | PASS |
| (c) met heads | 0.000 | ± 0.1 | PASS |
| (d) taper | decreases from the heel to u = 0.75 | monotone | PASS |
| (e) belt and plate | belt min z = 0, meshMinZ = 0, plantarAbsMaxZ = 0 | ± 0.1 and unchanged vs lift 0 | PASS |
| (f) H=0 STL | right and left match frozen hashes | byte-identical | PASS |
| (g) surface / cap | hashes match BASE | untouched | PASS |

Paired rim rise at H=12 is +10.149 mm (dCup +0.006). The seat is short of 12 mm by 1.857 mm.

## Residuals

The earlier handoff sample (p05 of midline u ≈ 0.08–0.18) reported dCup about −1.72 mm at H=12. These gates use the lowest heel-seat point. At that point the rim at the same station rises with the seat, so cup-depth change is about +0.006 mm. The open defect on BASE is the missing full lift H at the cup center.

## Next step

When `cursor/heel-lift-rigid-cup-1124` exists, grade its head with `node validation/heel_lift_rigid_cup_gates/grade-candidate.mjs <sha>`. Do not edit `measure.ts`, `thresholds.ts`, the clinical test, or `frozen/logic.sha256`.
