# Morton's shape gates v2 — proofs only

These gates were forked from PR #421 at `acb34831fd43398491ec7a299da8b8b65b43a853` and retargeted to Kendon's foot-axis edge before any later grade. PR #421 was not edited. This file is the proof record. It is not an official grade of PR #402 at `96d3127807a77f9bbf593e6c1b4a9d4ab985d049`. That SHA was not measured here.

The worker must not edit `validation/mortons_shape_gates/`.

## Scored edge

The scored line is straight and parallel to the heel-to-toe axis. `clinicalFrame().dir` is `(1, 0)`. The line passes through the midpoint of the 1st and 2nd MPJ centers (u = 0.665, v = 0.145 and u = 0.685, v = 0.365). On the frozen 260 mm × 95 mm outline that line sits 1.26552 mm medial of the 2nd metatarsal head's medial border (head width 18 mm). The plateau turns medially at 11 mm proximal of the 1st MPJ. The 25 mm blend is unchanged.

This replaces the v1 chord from the medial border at the 1st MPJ to u = 0.97. That chord remains only as the retired constant `TOE_MEDIAL_U`.

## Thresholds

| Check | Rule |
| --- | --- |
| S1 angle | 99% contour versus the heel-to-toe axis ≤ 2° |
| S1 border | That contour, at the 2nd met head, is 0–2 mm medial of the head's medial border |
| S1 head | Added height at the 2nd met head center ≤ 1e-6 mm at 3 mm and 6 mm |
| G3 | Minimum added height medial of the foot-axis line ≥ 0.99 of nominal |
| G4 v = 0.1 and v = 0.2 | ≥ 0.99 of nominal |
| G4 v = 0.3 | Measured. A miss is accepted and does not fail `scoreFootAxisEdge` |
| G5 | Rise after a local minimum on the foot-axis ray through the 1st MPJ ≤ 0.05 mm |
| G6 | 4 mm-smoothed slope on that same ray ≤ +0.02 /mm |
| G10 | Vertices outside the band around this line = 0. The band is the 25 mm blend through the toe and 8 mm lateral of the line |
| Unchanged from #421 | G1 ≤ 0.3 mm, G2 spread ≤ 0.3 mm, G7 ≤ 0.01 /mm and ≤ 0.02 /mm², G8 at 3 mm ≤ 1.0 /mm, G9 STL pins, G11 ≤ 1e-6 mm, S2 8 mm cap, S4 ends, S7, `SAMPLE_Top` hash |

`scoreFootAxisEdge` in `measure.ts` is the v2 scoreboard. G4 at v = 0.3 cannot fail it.

## No-op proof

Product code on this branch is still the pre-fix tree forked from #421. The new edge gates fail on it. The gates that already hold pass.

```bash
MORTONS_GATE_OUT=validation/mortons_shape_gates/proofs/noop-main.json \
  ./node_modules/.bin/rstest --config validation/mortons_shape_gates/rstest.gates.config.ts \
  validation/mortons_shape_gates/gates.test.ts
```

Exit 0. 14 tests passed. Recorded in `proofs/noop-main.json`. Both feet match. Left foot:

| Check | 3 mm | 6 mm | v2 threshold | On this checkout |
| --- | --- | --- | --- | --- |
| S1 angle to the foot axis | 2.398765° | 2.398765° | ≤ 2° | FAIL |
| S1 border offset | no 99% contour at the 2nd head | same | 0–2 mm medial | FAIL |
| 2nd met head center | 0.110346 mm | 0.220692 mm | ≤ 1e-6 mm | FAIL |
| G3 fraction | 0 (n=1458) | 0 (n=1458) | ≥ 0.99 | FAIL |
| G4 v = 0.1 | 0.000310 | 0.000310 | ≥ 0.99 | FAIL |
| G4 v = 0.2 | 0.001021 | 0.001021 | ≥ 0.99 | FAIL |
| G4 v = 0.3 | ~0 | ~0 | accepted | accepted, not a score fail |
| G5 on the foot-axis ray | 1.417168 mm | 4.198361 mm | ≤ 0.05 mm | FAIL |
| G6 on that ray | 0.103239 /mm | 0.274126 /mm | ≤ +0.02 /mm | FAIL |
| G10 outside the new band | 625 of 42134 | 625 of 42134 | 0 | FAIL |
| G1 95% / 5% | 3.366815 / 11.570054 mm | same | ≤ 0.3 mm | FAIL |
| G2 spread | 5.583161 mm | same | ≤ 0.3 mm | FAIL |
| G7 slope jump | 0.000931 / 0 | same | ≤ 0.01 | PASS |
| G8 peak | 0.904936 /mm | 1.809871 /mm | ≤ 1.0 at 3 mm only | PASS at 3 mm |
| G10 planform | 0 | 0 | 0 | PASS |
| G11 | 2.384e-7 mm (n=4716), 0 misses | 4.768e-7 mm (n=4880), 0 misses | ≤ 1e-6 mm | PASS |

`scoreFootAxisEdge` is false for S1, G3, G4 (because v = 0.1 and v = 0.2 miss), G5, G6, and G10. `g4_v03_accepted` is true.

A fresh STL run matched `proofs/noop-stl.json` and `pins.ts`:

- none-left `ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f`
- reverse-left `00bf538d40b726980ecbac0a0170ae9729d359086d283c52d8ed6656be86d8b6`
- none-right `9f865d8b380ad715a2ec10b208c2c5c74885737aaaa7ed7858c6334bd4f187c6`
- reverse-right `97f2398e4a9acda780f9b4896f5a387b6d8f92c6090466487b8e8a805e3afafa`

`SAMPLE_Top` sha256 remains `2657b0a4f1a5ef1da8322f45348034ba93ecdb611f7d17c2f828206039e024d1`.

## Bad-change proof

The old slanted-chord build is PR #402 at `7c97806da5381653452f7a71fd3ce6c21089d8a8` (same edge as `dcf025c72f7fca39ad6a056dd0d13c91564cb7a7`). Its lateral edge follows the medial chord, not the foot axis. Grade mode records the v2 score and does not require the defect to remain, so a green process is not a clinical pass. The score below is the proof.

```bash
GATE_VERTEX=/tmp/mortons-slanted/vertex/src \
  MORTONS_GATE_MODE=grade \
  MORTONS_GATE_OUT=validation/mortons_shape_gates/proofs/bad-change-slanted.json \
  ./node_modules/.bin/rstest --config validation/mortons_shape_gates/rstest.gates.config.ts \
  validation/mortons_shape_gates/gates.test.ts
```

Exit 0. 14 tests passed. Both feet match. Left foot, from `proofs/bad-change-slanted.json`:

| Check | 3 mm | 6 mm | Result |
| --- | --- | --- | --- |
| S1 angle to the foot axis | 9.563995° | 9.563995° | FAIL (> 2°) |
| S1 border offset | 0.471794 mm medial | same | inside 0–2 mm |
| 2nd met head center | 0 mm | 0 mm | holds |
| G3 fraction | 0.569141 (n=1458) | 0.569141 | FAIL (< 0.99) |
| G10 outside the new band | 408 of 42134 | 408 of 42134 | FAIL |
| G5 on the foot-axis ray | 0 mm | 0.091040 mm | 6 mm fails |
| G6 on that ray | −0.002512 /mm | 0.014648 /mm | holds |
| G4 v = 0.3 | 0 | 0 | accepted |

`scoreFootAxisEdge` is false for S1 and G10 at both heights, and false for G3 at both heights. That is the required bad-change result. The same file's synthetic test rejects a 9.56° angle, a border outside 0–2 mm, a lifted 2nd head, and a v = 0.2 miss, and it accepts a v = 0.3 miss when v = 0.1 and v = 0.2 are full.

## Not graded

`96d3127807a77f9bbf593e6c1b4a9d4ab985d049` was not run. Numbers from the earlier #421 grade of that SHA are not a v2 result.

## CI

`validation/mortons_shape_gates/**` stays out of the unit shards (`rstest.config.ts` and `scripts/ci/list-unit-test-files.mjs`, unchanged from #421). CI on this PR is the repository's normal run. This PR does not change product code.

## Hard prohibition

This change does not touch the outer surface, seams, layer-change placement, or surface quality. The only files changed are under `validation/mortons_shape_gates/`. No PHI is in this file or in the gates.
