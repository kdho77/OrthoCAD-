# Results

Frozen gates: `0e753f88ce2b71d41ab7568ce600d2d8dcedf75b`
BASE: `df78a4f1a6a657c4e72e15c14c797ad2f492669a`
Candidate: gates frozen, worker not yet up (`cursor/heel-lift-rigid-cup-1124` was not on origin)

Path: SAMPLE_Top, US M11 medium, full_contact, printing_solid, round walls, `sourceField` + `composedTop`. Lowest heel-seat point: u = 0.116, |v| ≈ 0.028, z = 2.159 mm. Right and left match. Thresholds: seat and cup ±0.3 mm, met and belt ±0.1 mm.

## BASE (no-op)

| Gate | Right H=6 | Right H=10 | Right H=12 | Left (same H) | Threshold | Grade |
| --- | --- | --- | --- | --- | --- | --- |
| (a) seat rise at lowest point | +5.071 | +8.452 | +10.143 | same | H ± 0.3 | FAIL |
| (b) cup-depth change | +0.003 | +0.005 | +0.006 | same | 0 ± 0.3 | PASS |
| (c) met-head added height | 0.000 | 0.000 | 0.000 | same | 0 ± 0.1 | PASS |
| (d) monotone taper | 5.598, 5.071, 4.801, 3.599, 2.397, 1.201, 0 | scaled | 11.197 … 0 | same | no rise toward the toe | PASS |
| (e) belt / meshMinZ / plantarAbsMaxZ | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | same | 0 ± 0.1 and unchanged vs lift 0 | PASS |
| (f) H=0 STL SHA-256 | right `3eb6109ced32cff9db8d19ce6d16e3a54b16d0ed684f86eb23da59671f752e27` |  |  | left `474e0f99d0ac907682452871fe08e053353962c39d8ac041ff0a827eb4e92797` | frozen BASE hashes | PASS |
| (g) surface, seams, wall-builder, S1-PRELOFT 0.5× cap | unchanged vs BASE |  |  |  | byte match | PASS |

Suite on BASE: FAIL. The cup center does not rise by the full H. Command: `node validation/heel_lift_rigid_cup_gates/prove-noop.mjs` (exit 0; the clinical rstest inside it exits non-zero). Log: `proofs/clinical-base.log`.

## Bad-change rejection

Command: `node validation/heel_lift_rigid_cup_gates/prove-bad-change.mjs` (exit 0). Log: `proofs/bad-change.log`. Sample rows: `proofs/bad-sample.log`.

| Bad change | Result |
| --- | --- |
| Seat rises, rim does not (cup shallower) | rejected |
| Rim rises, seat does not (cup deeper) | rejected |
| Belt / meshMinZ / plantarAbsMaxZ raised | rejected |
| Seat measured at a point that is not the lowest | rejected |
| Seat or cup tolerance loosened from ±0.3 mm | rejected |
| H=10 skipped | rejected |
| Surface, seam, layer-change, wall-builder, or slicer file edited | rejected |
| S1-PRELOFT 0.5× inset cap edited | rejected |
| Rigid lift of seat and rim by H at 6, 10, and 12 | accepted |

## Candidate

`cursor/heel-lift-rigid-cup-1124` is not on origin. No candidate SHA was graded. Gate logic was not edited after the freeze commit.
