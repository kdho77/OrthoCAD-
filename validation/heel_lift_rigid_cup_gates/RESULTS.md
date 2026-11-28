# Results

GRADE PASS @ ef85af5a2094056f7e467aceac4945c35226ca78

Frozen gates: `0e753f88ce2b71d41ab7568ce600d2d8dcedf75b`
BASE: `df78a4f1a6a657c4e72e15c14c797ad2f492669a`
Candidate: `ef85af5a2094056f7e467aceac4945c35226ca78` (final head of draft PR #445 after CI was green)

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

GitHub Actions Test run [45548605341](https://github.com/kdho77/OrthoCAD-/actions/runs/45548605341) on `ef85af5a2094056f7e467aceac4945c35226ca78` is green: unit-tests (1) through (6) success, `isolated-postgres-acceptance` success, `test-and-deploy` success. `ce0f9a61` was not graded; its unit-tests (1) and (5) failed, and a later head exists. `dfe3d17` was superseded before this grade.

Command: `node validation/heel_lift_rigid_cup_gates/grade-candidate.mjs ef85af5a2094056f7e467aceac4945c35226ca78` (exit 0). Frozen, surface, cap, and clinical steps each exited 0. Logs: `proofs/grade-ef85af5a.log`, `proofs/clinical-candidate-ef85af5a.log`, `proofs/ci-ef85af5a.txt`.

Seat is the lowest heel-seat vertex (right i=2639, u=0.116, v=+0.028, z0=2.159; left the same vertex with v=−0.028). Added height in mm. Left matches right on every gate.

| Gate | H=6 | H=10 | H=12 | Threshold | Grade |
| --- | --- | --- | --- | --- | --- |
| (a) seat rise at lowest point | +6.000 | +10.000 | +12.000 | H ± 0.3 | PASS |
| (b) cup-depth change | 0.000 | 0.000 | 0.000 | 0 ± 0.3 | PASS |
| (c) met-head added height | 0.000 | 0.000 | 0.000 | 0 ± 0.1 | PASS |
| (d) monotone taper (u 0.05, 0.15, 0.30, 0.45, 0.60, met) | 6.000, 5.807, 4.354, 2.899, 1.452, 0 | 10.000, 9.679, 7.256, 4.832, 2.421, 0 | 12.000, 11.615, 8.708, 5.799, 2.905, 0 | no rise toward the toe | PASS |
| (e) belt min z / meshMinZ / plantarAbsMaxZ | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 ± 0.1 and unchanged vs lift 0 | PASS |
| (f) H=0 STL SHA-256 | right `3eb6109ced32cff9db8d19ce6d16e3a54b16d0ed684f86eb23da59671f752e27` |  |  | left `474e0f99d0ac907682452871fe08e053353962c39d8ac041ff0a827eb4e92797` | frozen BASE hashes | PASS |
| (g) surface, seams, wall-builder, S1-PRELOFT 0.5× cap | hashes match BASE |  |  |  | byte match | PASS |

Rim rise equals seat rise at the seat station (dRim = dSeat), so cup depth at H=12 stays 19.321 mm. Gate logic was not edited after the freeze.
