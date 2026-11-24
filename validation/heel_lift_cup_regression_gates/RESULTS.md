# Results

Gates frozen on BASE `8aced4b5042bdafc2d300006fa80802bca1b94b9` before any candidate was graded. Gate logic was not changed after this table's BASE rows were measured.

Command: `node validation/heel_lift_cup_regression_gates/prove-noop.mjs` (exit 0). Clinical transcript: `proofs/clinical-base.log`. Bad-change transcript: `proofs/bad-change.log`.

## BASE (no-op)

The live compose gate exits non-zero. Identity, surface, cap, tolerance, and product-diff checks pass.

| Foot | H mm | Check | Measured | Threshold | Result |
| --- | --- | --- | --- | --- | --- |
| right | 6 | seat rise | +0.031 mm at u=0.116 (heelLiftDeltaAt 5.071) | ±0.2 mm | FAIL |
| right | 6 | cup depth | +3.809 mm (dRim +3.840) | ±0.2 mm | FAIL |
| right | 6 | monotone | u=0.15 +0.043 then u=0.30 +0.583 | no rise above +0.05 mm | FAIL |
| right | 6 | met heads u=0.75 | +0.000 mm | ±0.1 mm | PASS |
| right | 6 | belt min z | 0.000 mm, 2540 vertices within 0.02 mm | 0 ± 0.1 mm and ≥ 500 | PASS |
| right | 12 | seat rise | +0.063 mm at u=0.116 (heelLiftDeltaAt 10.143) | ±0.2 mm | FAIL |
| right | 12 | cup depth | +7.618 mm (dRim +7.681) | ±0.2 mm | FAIL |
| right | 12 | monotone | u=0.15 +0.086 then u=0.30 +1.167 | no rise above +0.05 mm | FAIL |
| right | 12 | met heads u=0.75 | +0.000 mm | ±0.1 mm | PASS |
| right | 12 | belt min z | 0.000 mm, 2558 vertices within 0.02 mm | 0 ± 0.1 mm and ≥ 500 | PASS |
| left | 6 | seat / cup / monotone | +0.031 / +3.809 / rise 0.043→0.583 | same | FAIL |
| left | 6 | met / belt | +0.000 / min z 0.000 (2550 verts) | same | PASS |
| left | 12 | seat / cup / monotone | +0.063 / +7.618 / rise 0.086→1.167 | same | FAIL |
| left | 12 | met / belt | +0.000 / min z 0.000 (2564 verts) | same | PASS |
| right | 0 | STL SHA-256 after a left 12 mm lift | `474e0f99d0ac907682452871fe08e053353962c39d8ac041ff0a827eb4e92797` | frozen BASE | PASS |
| right | 0 | STL SHA-256 after a left 6 mm lift | same hash | frozen BASE | PASS |
| left | 0 | STL SHA-256 | `3eb6109ced32cff9db8d19ce6d16e3a54b16d0ed684f86eb23da59671f752e27` | frozen BASE | PASS |
| — | — | product diff vs BASE | no path outside this directory | empty | PASS |
| — | — | surface, seam, layer-change, slicer | hashes match `frozen/surface-files.sha256` | byte-identical | PASS |
| — | — | S1-PRELOFT 0.5×inset cap | `assertPreLoftStations` matches frozen body; `SKEW_INSET_RATIO = 0.5` | unchanged | PASS |

## Bad-change proofs

`node validation/heel_lift_cup_regression_gates/prove-bad-change.mjs` (exit 0) and `checker.optional.test.ts` (7 passed). The checker is optional so the unit-test shard manifest, which this change does not edit, stays valid.

| Bad change | Result |
| --- | --- |
| Rim-only raise (dSeat 0, dRim 12) | rejected (seat and cup) |
| BASE right 12 mm sample (dSeat +0.063, dCup +7.618) | rejected (seat, cup, monotone) |
| Belt face lifted (80 vertices, min z 1 mm) | rejected |
| Cup tolerance rewritten from 0.2 mm to 8 mm | rejected. `|7.618| ≤ 8` would pass; `|7.618| ≤ 0.2` does not |
| `SKEW_INSET_RATIO` 0.5 → 1, and both 0.5×inset formulas ×4 | rejected |
| Outer perimeter order reversed, layer-time edited, ring-seam start moved, slicer layer height 0.3 → 0.6 | rejected |
| A product path outside this directory | rejected |

## Candidate

Graded after the gates were frozen. No threshold, sample, or proof was edited for this grade.

There is no pull request on `cursor/heel-lift-cup-regression-1124`. The branch head is `06e34c64274ad7bec6520046ef92ad01e2c89530` (`Test composed heel lift on both feet at 6 mm and 12 mm`, on `032adbf6` `Apply heel lift at full strength on the foot-contact sheet`).

Command: `node validation/heel_lift_cup_regression_gates/grade-candidate.mjs 06e34c64274ad7bec6520046ef92ad01e2c89530` (exit 0). Surface, cap, and the live compose gate all passed.

| Foot | H mm | Check | Measured | Threshold | Result |
| --- | --- | --- | --- | --- | --- |
| right | 6 | seat rise | +5.071 mm at u=0.116 (heelLiftDeltaAt 5.071) | ±0.2 mm | PASS |
| right | 6 | cup depth | +0.003 mm (dRim +5.074) | ±0.2 mm | PASS |
| right | 6 | monotone | 5.445, 4.940, 3.754, 2.294, 1.064, 0.000 | no rise above +0.05 mm | PASS |
| right | 6 | met heads u=0.75 | +0.000 mm | ±0.1 mm | PASS |
| right | 6 | belt min z | 0.000 mm, 2537 vertices within 0.02 mm | 0 ± 0.1 mm and ≥ 500 | PASS |
| right | 12 | seat rise | +10.143 mm at u=0.116 (heelLiftDeltaAt 10.143) | ±0.2 mm | PASS |
| right | 12 | cup depth | +0.006 mm (dRim +10.149) | ±0.2 mm | PASS |
| right | 12 | monotone | 10.891, 9.880, 7.508, 4.588, 2.128, 0.000 | no rise above +0.05 mm | PASS |
| right | 12 | met heads u=0.75 | +0.000 mm | ±0.1 mm | PASS |
| right | 12 | belt min z | 0.000 mm, 2553 vertices within 0.02 mm | 0 ± 0.1 mm and ≥ 500 | PASS |
| left | 6 | seat / cup / monotone / met / belt | +5.071 / +0.003 / decreasing / +0.000 / min z 0.000 (2556 verts) | same | PASS |
| left | 12 | seat / cup / monotone / met / belt | +10.143 / +0.006 / decreasing / +0.000 / min z 0.000 (2565 verts) | same | PASS |
| right | 0 | STL SHA-256 after a left 12 mm lift and after a left 6 mm lift | `474e0f99d0ac907682452871fe08e053353962c39d8ac041ff0a827eb4e92797` | frozen BASE | PASS |
| left | 0 | STL SHA-256 | `3eb6109ced32cff9db8d19ce6d16e3a54b16d0ed684f86eb23da59671f752e27` | frozen BASE | PASS |
| — | — | outer surface, seam, layer-change, slicer | hashes match the frozen manifest | byte-identical to BASE | PASS |
| — | — | S1-PRELOFT 0.5×inset cap | `assertPreLoftStations` SHA-256 `822d85299ff2e2ad26e43af621da49e09d30391e8169f7eb9eb10428eb28781f` | frozen body | PASS |

The candidate splits heel lift out of the topFactor weight in `applyBaseModifiers` and adds `heelLiftDeltaAt` at full strength on the top sheet, with weight 0 on a multi-mesh bottom. `ci/unit-test-shards.json` is reordered; the only path added is `vertex/src/lib/geometry/heel-lift-cup.test.ts`.

Overall: PASS. No residual on the clinical gates. Next step is the worker's own review. These gates stay unmerged.
