# Plantar-name proofs

The measurements below are the old belt placement (`ySign = +1`). On the live slicer the cap is upside down (`d < 0`, sequence still `JABBOUR`, N reads as И). CI missed that because the job overlaid `stl_preprocess.py` from `9fe93642`, which Y-negates the whole STL before Rz(270) and cancels the flip. The press does not run that overlay. Glyph Y is now negated in `placeBottomText` for the live sole, and the workflow slices `LIVE_IMAGE` with no Y-negate. Negating X still reverses the string.

Measured on the real path: SAMPLE_Top, both feet, default bottom text marking, engrave, `JABBOUR`, `buildPrinterFootManufacturingStl(side, true)`, then VertexSlice `POST /v1/slice` (`profile_id=apex-v2-insole-95a`, `wall_loops=1`, `infill_density=26`, `belt_insole_place=true`). The six cells are `apex_core` toe-first, `apex_light` toe-first, and `apex_light` heel-first, each for both feet. `apex_core` ignores a heel-first request, so heel-first uses `apex_light`, whose chain honours `print_direction`. The gateway wait is the `slice_all.sh` overlay (`SLICE_GATEWAY_TIMEOUT_S` 260 → 880). That overlay does not change G-code.

Thresholds are the #435 gate (`21b9bef3`): `a > 0.5`, `d > 0.5`, `|b| < 0.15`, `|c| < 0.15`, advance `> 20` mm, J hook lower-left (`1.5` / `0.75` mm), sequence `JABBOUR` toward `+reading-x`. They were not loosened.

## Images

Live VertexSlice (`origin/main` `d935197976b7cdd2fa89ced4ff43930b0212959f`):

`ghcr.io/kdho77/vertexslice-server@sha256:8cac1d54c5e1a12f4693412c32fe40dd9c5682b9279e2b1d38f1225760aca579`

Fix image used for these numbers. CI image id from run [45532907790](https://github.com/kdho77/OrthoCAD-/actions/runs/45532907790) (not a registry manifest digest):

`sha256:aa55befa26e437f42be9c6706bdba506b927a30b6ab3a15f1730264d3550648e`

Built `FROM` the live digest, `COPY validation/stl_preprocess.py` from the deploying VertexSlice #52 head `9fe936425ad4449ee6a6d932b636a432c8dd2ea2` (Y-negate before Rz270). File sha256:

`6b7ce3fb9917e2cc85ef13a0a2fc1ced2d5ccfb174e299f4c4744756ea16ec25`

CI rebuilds that image, so its image id can differ. The pin is the live digest plus that file.

## Manufacturing STLs (#373 placement, the committed path)

| foot | solid triangles | upload triangles |
| --- | ---: | ---: |
| left | 137692 | 137772 |
| right | 138790 | 138870 |

Headers are `OrthoCAD single-foot left` and `OrthoCAD single-foot right`.

Heel end is the `hand_classify.py` rule: the end fifth (by `zt = Z - Y`) whose max Y is larger. Heel-first requires that cup at low `zt` (`heelHigh` false). Toe-first requires it at high `zt`. The reading frame follows the detected heel, so a 180° belt turn does not change a correct name, and a mirror still fails.

## Fix image, #373 placement — PASS all 6

Run [45532907790](https://github.com/kdho77/OrthoCAD-/actions/runs/45532907790) on `9fe936425ad4449ee6a6d932b636a432c8dd2ea2`. All six `NAME_PLANTAR` lines passed.

| cell | a | d | det | advance | hook | sequence | heelHigh | delta mm |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |
| apex_core toe_first left | 0.996253 | 0.896343 | 0.893208 | 71.756 | true | JABBOUR | true | 19.25 |
| apex_core toe_first right | 0.990663 | 0.632140 | 0.626365 | 71.914 | true | JABBOUR | true | 19.25 |
| apex_light toe_first left | 0.993407 | 0.880991 | 0.875459 | 71.780 | true | JABBOUR | true | 19.25 |
| apex_light toe_first right | 0.952585 | 0.869302 | 0.828070 | 71.991 | true | JABBOUR | true | 19.25 |
| apex_light heel_first left | 0.993032 | 0.903779 | 0.897756 | 72.038 | true | JABBOUR | false | -21.54 |
| apex_light heel_first right | 0.965049 | 0.629986 | 0.607951 | 72.622 | true | JABBOUR | false | -21.51 |

CI seconds / bytes: core toe L 14 / 3625198, R 15 / 3662132; light toe L 285 / 3488839, R 285 / 3454996; light heel L 448 / 3572414, R 483 / 3527132.

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

## Stored manufacturing STL reuse (this change)

BASE `3cabc5b1a0bed7f1fc63028d97c3d8b0821cba63` on current `origin/main` (pin was `3932a6448befbe9c8f07e587be6570fcde3d3352`; #447 and #448 are already on main and are not edited here). The frozen non-text hashes were taken on `d20ca6e9`, before #445 held heel lift at full H through the cup center. That hold moves heel triangles outside the letter box, so the composed mesh is back on the `d20ca6e9` linear ramp. `place.ts` is unchanged. No blanket `xSign = -1`.

`executeCadOperatorProduction` used to slice `checkpoint.stlStorageKey` and skip the loft. `continueInFlightSlice` resumed that job. Rule t2704u deletes that path. Saved-design `generate_gcode` calls `materialize()` on every run, which is `buildHeadlessFinalizedFoot` → `buildFinalizedFootFromSavedSettings`, the UI Export loft. A checkpoint is not a reuse key: `storedManufacturingStlReusable` is false even when the design is unchanged. A status poll may only continue a job this production submitted after that loft (`rematerialized`). It does not download a temp or archive. Download and materialize still refuse eTag `8f5dc451de66dbba8f8521e046a9e4af` at 9045484 bytes.

Local production-path lofts (`buildFinalizedFootFromSavedSettings`, synthetic `JABBOUR`, SAMPLE_Top). None is the pre-#52 left archive. Pair and single matched on each side. `ad-pair` and `ad-name` matched because both compose to `JABBOUR` with the same linked Medium settings.

| file | bytes | md5 |
| --- | ---: | --- |
| d0-pair-left.stl / d0-single-left.stl | 7973784 | 185018a1f8fd04e8b6ad0bebda937ae0 |
| d0-pair-right.stl / d0-single-right.stl | 5868684 | 0326101141d80d49146d5df799afcf3d |
| ad-pair-left.stl / ad-name-left.stl | 6888684 | bfd4976ef391030b3d1ec512074d0ab9 |
| ad-pair-right.stl / ad-name-right.stl | 6943584 | 7f4b4cc0d178dcdcabf1e8307607923d |

Docker is not available on this machine, so the variant G-code grade was not run here. CI `name-plantar-e2e` slices `*-left.stl` and `*-right.stl` on `apex_core` toe-first and grades them with the frozen #435 thresholds. The six-cell matrix on `left.stl` / `right.stl` is unchanged.

## 0d3db1c0 right had no letters

CI run [45563201516](https://github.com/kdho77/OrthoCAD-/actions/runs/45563201516) on `929a94d2` passed the six #442 cells and `d0-pair-left` (a=0.961, d=0.872, sequence `JABBOUR`). `d0-pair-right` had letter walls 0. The engrave threw `manifold status Not manifold` and the catch kept the unengraved solid. The mesh was watertight except for one unconnected triangle (three open edges) from a counter cap that missed the boundary weld. That triangle is dropped before the manifold check. It is not part of the shell. The #442 baseline counts stay left 137692/137772 and right 138790/138870. Local variant lofts then engrave on every foot, including that right foot. Thresholds were not loosened.

## t2704u — production works like a person

Locked rule, 12:16 AM America/Denver on 11/25. Supersedes using a design hash as a stored-STL reuse key. The production box lofts from the saved design on every `generate_gcode`, including a second call on the same design. It does not read a temp, archive, or checkpoint STL. The sliced bytes are the bytes the UI export function returned.

A row that still holds a checkpoint from before that loft does not block the next generate. The claim starts a new production row and lofts. The old row keeps the checkpoint. A status poll of a job this production submitted after a loft still joins that in-flight row.

## t2699u — must change if the design has any changes

Locked rule, 11:20 PM America/Denver. `manufacturingSolidIdentity` (the UI preview cache) hashes the full saved design (mesh blobs stripped) plus side, `beltPrint`, placement version, OrthoCAD version, and slicer version. That is not a picked field list. The table test walks every leaf of a synthetic design that includes parameters, corrections, elements, sinks, text, size, width, arch, heel lift, and material, and it also flips `beltPrint`, placement version, OrthoCAD version, and slicer version. Each mutation misses the cached solid. Key order of an unchanged design still matches, and that preview cache reuses. Production does not: an unchanged design still lofts again.

`manufacturingStlRunIdentity` uses the same full saved design. When the caller passes only side, composed text, and `beltPrint`, the hash reads the design currently installed in the design store and includes that composed text. A leaf change in the open design changes the hash. An explicit saved-design argument still wins, and omitting composed text does not change hashes that never passed it.

## Frozen gates at 2eff9d6a

Local run of the frozen files (not committed) against this tree:

| Gate | Result |
| --- | --- |
| G1 | PASS. 24 feet, sequence `JABBOUR`, including every US M 11.5 right. |
| G2 | PASS. Stamp and detected foot match the requested side. Heel-high on every cell. |
| G3 | PASS. Engrave floor 0.6, sole min z 0. Every frozen non-text hash matches, including the size-12 right foot with 12 mm heel lift (`7f198b4a`). Before the ramp restore those two cells were `08db20ea`. |
| G4 | PASS as a rejection. Blanket `xSign = -1` fails on the #442 control, ad1e0cc5 left, and 0d3db1c0 left. One-foot X flip fails the pair. Y mirror, depth 1.2, placementU 0.55, and a lifted sole fail. |
| t2699u | PASS. No-op reuses the preview solid. Every walked leaf misses. |
| t2704u | PASS. Two `generate_gcode` calls both loft. Neither slices `stored-8f5dc451…`. The original row still records the checkpoint. |
