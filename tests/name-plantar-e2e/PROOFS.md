# Plantar-name proofs

Measured on the real path: SAMPLE_Top, both feet, default bottom text marking, engrave, `JABBOUR`, `buildPrinterFootManufacturingStl(side, true)`, then VertexSlice `POST /v1/slice` (`profile_id=apex-v2-insole-95a`, `wall_loops=1`, `infill_density=26`, `belt_insole_place=true`). The six cells are `apex_core` toe-first, `apex_light` toe-first, and `apex_light` heel-first, each for both feet. `apex_core` ignores a heel-first request, so heel-first uses `apex_light`, whose chain honours `print_direction`. The gateway wait is the `slice_all.sh` overlay (`SLICE_GATEWAY_TIMEOUT_S` 260 → 880). That overlay does not change G-code.

Thresholds are the #435 gate (`21b9bef3`): `a > 0.5`, `d > 0.5`, `|b| < 0.15`, `|c| < 0.15`, advance `> 20` mm, J hook lower-left (`1.5` / `0.75` mm), sequence `JABBOUR` toward `+reading-x`. They were not loosened.

## Images

Live VertexSlice (`origin/main` `d935197976b7cdd2fa89ced4ff43930b0212959f`):

`ghcr.io/kdho77/vertexslice-server@sha256:8cac1d54c5e1a12f4693412c32fe40dd9c5682b9279e2b1d38f1225760aca579`

Fix image used for these numbers. Legacy builder image id (not a registry manifest digest):

`sha256:a7c3007e8e5a74dabd2a73c6b4f90da39f090650d38bc46a6c7578b29a7e0f1c`

Built `FROM` the live digest, `COPY validation/stl_preprocess.py` from VertexSlice `cursor/lr-swap-belt-mirror-1124` @ `0415b656d42d7ae0828e435b98f6fdae4f6f0486`. File sha256:

`2f0cc241026e97fa1c517ee25fa7f9f742c17a3f75a2efa9064bebe97eccee40`

CI rebuilds that image, so its image id can differ. The pin is the live digest plus that file.

## Manufacturing STLs (#373 placement, the committed path)

| foot | solid triangles | upload triangles |
| --- | ---: | ---: |
| left | 137692 | 137772 |
| right | 138790 | 138870 |

Headers are `OrthoCAD single-foot left` and `OrthoCAD single-foot right`.

Heel end is the `hand_classify.py` rule: the end fifth (by `zt = Z - Y`) whose max Y is larger. Heel-first requires that cup at low `zt` (`heelHigh` false). Toe-first requires it at high `zt`. The reading frame follows the detected heel, so a 180° belt turn does not change a correct name, and a mirror still fails.

## Fix image, #373 placement — PASS all 6

| cell | a | d | det | advance | hook | sequence | heelHigh | delta mm |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |
| apex_core toe_first left | 0.996253 | 0.896343 | 0.893208 | 71.756 | true | JABBOUR | true | 19.25 |
| apex_core toe_first right | 0.990663 | 0.632140 | 0.626365 | 71.914 | true | JABBOUR | true | 19.25 |
| apex_light toe_first left | 0.993407 | 0.880991 | 0.875459 | 71.780 | true | JABBOUR | true | 19.25 |
| apex_light toe_first right | 0.952585 | 0.869302 | 0.828070 | 71.991 | true | JABBOUR | true | 19.25 |
| apex_light heel_first left | 0.993032 | 0.903779 | 0.897756 | 72.038 | true | JABBOUR | false | -21.54 |
| apex_light heel_first right | 0.965049 | 0.629986 | 0.607951 | 72.622 | true | JABBOUR | false | -21.51 |

Slice seconds / bytes: core toe L 9 / 3624505, R 9 / 3662976; light toe L 170 / 3484912, R 189 / 3449999; light heel L 306 / 3572422, R 338 / 3527843.

## Live image, #373 placement — FAIL all 6

The print direction is real (toe-first `heelHigh` true, heel-first `heelHigh` false). The name is mirrored: cap upside down, hook not lower-left, sequence still `JABBOUR`.

| cell | a | d | det | advance | hook | sequence | heelHigh | delta mm |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |
| apex_core toe_first left | 0.996024 | -0.919165 | -0.915944 | 71.768 | false | JABBOUR | true | 19.25 |
| apex_core toe_first right | 0.982397 | -0.904079 | -0.888430 | 71.884 | false | JABBOUR | true | 19.28 |
| apex_light toe_first left | 0.996274 | -0.915783 | -0.912770 | 71.770 | false | JABBOUR | true | 19.25 |
| apex_light toe_first right | 0.990925 | -0.633111 | -0.627924 | 71.894 | false | JABBOUR | true | 19.28 |
| apex_light heel_first left | 0.959528 | -0.910246 | -0.873645 | 72.003 | false | JABBOUR | false | -21.55 |
| apex_light heel_first right | 0.960643 | -0.899176 | -0.863953 | 72.803 | false | JABBOUR | false | -21.54 |

Slice seconds / bytes: core toe L 11 / 3667318, R 11 / 3626409; light toe L 195 / 3481269, R 202 / 3507821; light heel L 354 / 3559194, R 284 / 3558806.

## #436 placement, fix image — FAIL all 6

`ad2ada11` glyph-X negation applied locally in `place.ts`, then reverted. Not in this diff. Local STL counts: left 137222/137302, right 138806/138886. Five cells are a left-right mirror (sequence `RUOBBAJ`, `a < 0`). `apex_light` heel-first right found no letter holes (0 loops through `Y <= 1.6`), so it fails closed. Direction is still heel-first (`heelHigh` false, delta -21.54).

| cell | a | d | det | advance | hook | sequence | heelHigh |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| apex_core toe_first left | -0.956561 | 0.615969 | -0.589597 | -71.824 | false | RUOBBAJ | true |
| apex_core toe_first right | -0.959912 | 0.880505 | -0.845448 | -71.571 | false | RUOBBAJ | true |
| apex_light toe_first left | -0.954275 | 0.619475 | -0.591409 | -71.787 | false | RUOBBAJ | true |
| apex_light toe_first right | -0.957793 | 0.847076 | -0.811653 | -71.605 | false | RUOBBAJ | true |
| apex_light heel_first left | -0.953818 | 0.602952 | -0.574938 | -72.139 | false | RUOBBAJ | false |
| apex_light heel_first right | 0 | 0 | 0 | 0 | false | (no letters) | false |

## P1 — #373 placement, live image — FAIL both feet

Current main. The string still runs left to right and the cap is upside down (`d < 0`, det `< 0`). The hook is not lower-left.

Slice: left HTTP 200 in 10 s, 3667318 bytes. Right HTTP 200 in 9 s, 3626409 bytes.

| foot | a | b | c | d | det | advance mm | hook | sequence | match mm |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| left | 0.996024 | -0.069520 | -0.006243 | -0.919165 | -0.915944 | 71.768 | false | JABBOUR | 0.313 |
| right | 0.982397 | -0.054019 | -0.004921 | -0.904079 | -0.888430 | 71.884 | false | JABBOUR | 0.322 |

## P2 — #373 placement, fix image — PASS both feet

Slice: left HTTP 200 in 10 s, 3624505 bytes. Right HTTP 200 in 10 s, 3662976 bytes.

| foot | a | b | c | d | det | advance mm | hook | sequence | match mm |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| left | 0.996253 | -0.049530 | 0.004529 | 0.896343 | 0.893208 | 71.756 | true | JABBOUR | 0.316 |
| right | 0.990663 | -0.050166 | 0.002542 | 0.632140 | 0.626365 | 71.914 | true | JABBOUR | 0.313 |

The right foot's `d` is 0.632, above 0.5. The threshold was not moved.

## P3 — #436 placement, fix image — FAIL both feet

`#436` (`ad2ada118a4bdf635d4bb20249ee7ee9fc7cbc9f`) negates glyph X on `beltPrint` in `place.ts`. Applied locally for this slice, then reverted. It is not in this diff. Local STL counts: left 137222/137302, right 138806/138886.

Slice: left HTTP 200 in 10 s, 3629071 bytes. Right HTTP 200 in 10 s, 3685613 bytes.

The name is a left-right mirror (`a < 0`, `d > 0`, det `< 0`). Sequence `RUOBBAJ`. Hook is not lower-left.

| foot | a | b | c | d | det | advance mm | hook | sequence | match mm |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| left | -0.956561 | 0.045870 | 0.008395 | 0.615969 | -0.589597 | -71.824 | false | RUOBBAJ | 0.302 |
| right | -0.959912 | 0.052099 | 0.004610 | 0.880505 | -0.845448 | -71.571 | false | RUOBBAJ | 0.315 |

## P4 — #436 placement, live image — FAIL both feet

Same local `#436` STLs, live image (slicer mirror absent). This does not read correctly. It is a 180° turn (`a < 0`, `d < 0`, det `> 0`): the sequence is `RUOBBAJ` and the cap is upside down. Thresholds were not changed to make it pass.

Slice: left HTTP 200 in 10 s, 3662921 bytes. Right HTTP 200 in 10 s, 3653481 bytes.

| foot | a | b | c | d | det | advance mm | hook | sequence | match mm |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| left | -0.960511 | 0.019409 | -0.005380 | -0.635286 | 0.610304 | -71.817 | false | RUOBBAJ | 0.302 |
| right | -0.956672 | -0.000511 | -0.005903 | -0.898566 | 0.859630 | -71.584 | false | RUOBBAJ | 0.311 |

## What turns the job red

A slicer-mirror flip (P1 versus P2) flips the sign of `d` and fails the hook. A placement X negation (P3 versus P2) flips the sign of `a`, reverses the sequence, and fails the hook. Either one fails both feet.
