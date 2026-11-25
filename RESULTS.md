GRADE: PASS @ 1235f5e35846f7240bd85cc839b1be779c72269d

Independent grade of OrthoCAD PR #442 at that commit. `git rev-parse 1235f5e358` and both `cursor/name-plantar-lock-1124` and the PR head ref resolve to `1235f5e35846f7240bd85cc839b1be779c72269d`. The head has not moved. This branch adds the grade only.

## Gate table

| Check | Result |
| --- | --- |
| 1. Diff is test/CI-only; STL from `buildPrinterFootManufacturingStl` unmocked; G-code from a real VertexSlice container; `FIX_SHA` is `9fe936425ad4449ee6a6d932b636a432c8dd2ea2` | PASS |
| 2. Run 45532907790 on `4d4feba0` passed all 6 cells on the fix image; `1235f5e3` differs only in `PROOFS.md`; that file shows live FAIL all 6 and #436 FAIL all 6 | PASS |
| 3. Independent plantar-face correlation agrees with the worker verdicts on the same G-code, including heel-first | PASS |
| 4. #436 glyph-X placement on the fix image fails the worker test; G-code mirrored across X with `gtransform.py` @ `19dff419` fails the worker test | PASS |
| 5. Verdict, gate table, and L1–L10 report | PASS |

## 1. Diff review

`git diff --name-status cbcb4434c0d8847d8562112bf4b6a1d8717244f0 1235f5e35846f7240bd85cc839b1be779c72269d` is 14 files, all test or CI:

- `.github/workflows/name-plantar-e2e.yml`
- `ci/unit-test-shards.json`
- `tests/name-plantar-e2e/**` (12 files)

`git diff --stat 4d4feba0a8c2640978c5f1c3ce752d18d4f0a5fe 1235f5e35846f7240bd85cc839b1be779c72269d` is only `tests/name-plantar-e2e/PROOFS.md` (the CI image id, preprocess hash, run link, and slice byte counts). Test logic is identical at the graded head and at the CI commit.

`build-stls.test.ts` calls `buildPrinterFootManufacturingStl(side, true)` from `@/features/exports/export-service`. The only stub serves the `SAMPLE_Top.glb` fixture bytes. A local run of that test wrote headers `OrthoCAD single-foot left` / `OrthoCAD single-foot right` and triangle counts left 137692/137772, right 138790/138870, the same counts `PROOFS.md` records for #373 placement.

`slice-feet.sh` starts the VertexSlice server image and `POST`s `/v1/slice` (`profile_id=apex-v2-insole-95a`, `wall_loops=1`, `infill_density=26`, `belt_insole_place=true`). The workflow refuses a modelled slicer. `FIX_SHA` in the workflow env is `9fe936425ad4449ee6a6d932b636a432c8dd2ea2`.

`ci/unit-test-shards.json` rebalances shard order. The set of test paths loses nothing and adds three files: `tests/gcode-handedness-guard.frozen.test.ts`, `tests/name-plantar-e2e/build-stls.test.ts`, and `tests/name-plantar-e2e/chirality.test.ts`. The frozen guard file and `tests/fixtures/handedness` are absent from the diff.

## 2. CI evidence

Run [45532907790](https://github.com/kdho77/OrthoCAD-/actions/runs/45532907790) is `Plantar name lock`, event `pull_request`, conclusion `success`, head `4d4feba0a8c2640978c5f1c3ce752d18d4f0a5fe`. Job `plantar-name` (`138932379412`) checked out VertexSlice `9fe936425ad4449ee6a6d932b636a432c8dd2ea2`, copied `stl_preprocess.py` (`6b7ce3fb9917e2cc85ef13a0a2fc1ced2d5ccfb174e299f4c4744756ea16ec25`), and recorded image id `sha256:aa55befa26e437f42be9c6706bdba506b927a30b6ab3a15f1730264d3550648e`.

The job log shows HTTP 200 for all six cells and `SLICES_OK`, then six `NAME_PLANTAR` lines with `"pass":true`, sequence `JABBOUR`, `hookLeft:true`. Toe-first rows have `heelHigh:true` and delta `19.25`. Heel-first rows have `heelHigh:false` and deltas `-21.54` / `-21.51`. Bytes: core toe L 3625198, R 3662132; light toe L 3488839, R 3454996; light heel L 3572414, R 3527132.

`PROOFS.md` at the graded head records that same fix-image table. Its live-image table has `d < 0`, `hookLeft` false, and sequence `JABBOUR` on all six cells (direction still matches the request). Its #436 table has sequence `RUOBBAJ` and `a < 0` on five cells, and zero letter loops on `apex_light` heel-first right, with `heelHigh` false and delta `-21.54`.

## 3. Independent measure

The checker is `tests/name-plantar-lock-grade-b/raster_chirality.py`. It rasters belt-contact extrusions (`Y <= 0.6`), finds the seven letter holes, and scores normalized correlation against Inter Bold `JABBOUR`, its horizontal mirror, its vertical mirror, and a 180° turn. That is a different measurement from the worker's wall-loop assignment and `fitLinear` map.

The G-code is a local re-slice through the fix image: live digest `sha256:8cac1d54c5e1a12f4693412c32fe40dd9c5682b9279e2b1d38f1225760aca579` plus `stl_preprocess.py` from `9fe936425ad4449ee6a6d932b636a432c8dd2ea2` (sha256 `6b7ce3fb…ec25`, the same file the job hashed). All six output sizes match the job log. Re-running the worker measure test on those files reprinted the CI `NAME_PLANTAR` lines, including `a`, `d`, advance, hook, sequence, and heel delta.

Independent verdicts on that G-code, all `upright` and pass:

| cell | upright | mirror_x | mirror_y | heelHigh | delta mm |
| --- | ---: | ---: | ---: | --- | ---: |
| apex_core toe_first left | 0.3231 | 0.0091 | 0.2744 | true | 19.25 |
| apex_core toe_first right | 0.2987 | -0.0004 | 0.2560 | true | 19.25 |
| apex_light toe_first left | 0.3682 | 0.0345 | 0.2958 | true | 19.25 |
| apex_light toe_first right | 0.3646 | 0.0373 | 0.3049 | true | 19.25 |
| apex_light heel_first left | 0.2992 | 0.0399 | 0.2386 | false | -21.54 |
| apex_light heel_first right | 0.2631 | 0.0108 | 0.2098 | false | -21.51 |

Heel-first stays upright in the reading frame. The heel cup is at low `zt`, matching the worker.

## 4. Bad-change proofs

**X mirror.** `validation/handedness_gates/gtransform.py` from kdho77/VertexSlice `19dff419554bdd2e9daed4b05b57c030507d3035`, mode `mirror_x`, applied to the six fix-image files. The worker measure test exits 1. All six lines are `pass:false`, sequence `JABBOUR`, `hookLeft:false`, and `d < 0` (cap maps to negative reading y). Heel-first stays `heelHigh:false`. The independent checker fails all six with winner `mirror_y`.

**#436 placement.** `place.ts` on the graded tree gained the belt-print glyph X negation (`xSign = -1` about the glyph centre) and was restored afterward. Manufacturing STLs: left 137222/137302, right 138806/138886, the counts in `PROOFS.md`. Sliced on the same fix image, the worker measure test exits 1. Five cells are sequence `RUOBBAJ` with `a ≈ -0.96` and negative advance. `apex_light` heel-first right reports 0 letter loops through the engrave band and fails closed (`heelHigh:false`, delta `-21.54`). Those figures match the #436 table in `PROOFS.md`. The independent checker fails all six with winner `mirror_x`.

## Rule-compliance report

L1 Kendon 2026-10-24 9:33 PM MT (memory): he "confirmed the belt slicing chain mirrors parts (the golden, sliced from a true left STL, printed as a right foot). He approved fixing the mirror at VertexSlice belt placement".
**PASS.** The diff leaves placement and VertexSlice code alone. The lock consumes the pinned fix image.

L2 Kendon 2026-10-24: "Text a user adds to a left or right foot must read correctly on screen and print correctly on that foot, which means true-handed STL export and no net mirror in the slicing chain."
**PASS.** The CI path builds the real manufacturing STL and fails when the plantar name is mirrored. Export code is unchanged.

L3 Kendon 2026-10-24: "No other fix, including the belt mirror fix, may change or lose any of his ApexLight settings."
**PASS.** Profiles and product settings are unchanged. Heel-first is requested on the existing `apex_light` chain with `apex-v2-insole-95a`, `wall_loops=1`, and `infill_density=26`.

L4 Kendon 2026-11-20 11:38 AM MT: "The seams have always been on the bottom it's been a permanent rule since the beginning".
**PASS.** Seams, layer changes, and surface quality are untouched.

L5 Kendon standing rule: locked surface quality, seams and layer changes (bottom only); no scope growth; copy Cura's method.
**PASS.** The change is the test and the CI job.

L6 Kendon 2026-11-24 4:18 PM MT (P0): MCP belt G-code labelled left is physically a right foot. Correct handedness is mandatory.
**PASS.** The PR does not relabel feet or change sliced product output. The frozen handedness gate file is untouched.

L7 Kendon 2026-11-24 4:28 PM MT: "(a) An automated handedness check in the generate/export production pipeline, run on the final sliced G-code. It detects the physical foot (arch/medial side on the bottom layer, relative to print direction) and compares it with the requested side. On a mismatch or an inconclusive result, it fails the production with a clear error instead of delivering or attaching the file. It must work for both print directions. (b) A regression test covering heel-first and toe-first print directions times left and right, which fails if the label and the physical foot disagree."
**PASS.** `tests/gcode-handedness-guard.frozen.test.ts` and `tests/fixtures/handedness` are byte-identical to the base. The shard file adds that guard to the unit run. This PR does not replace it.

L8 No merge or deploy without Kendon's explicit go. Draft PR only.
**PASS.** PR #442 is still an open draft. This grade is a draft and is not merged.

L9 Frozen gate files are byte-identical to the PM's (SHA256SUMS); never edit, re-hash or skip a gate. If a gate cannot pass, stop and report why.
**PASS.** The frozen guard and its fixtures are outside the diff. SHA256SUMS is unchanged. The guard path is present in the updated shard list.

L10 Kendon 2026-11-24 4:52 PM MT: "once the name reads correctly from the bottom of the insole, lock it so it never regresses again. Add a permanent CI test ... It runs on the real production path (design, then belt placement and slicer mirror, then final G-code bottom layers), for both feet, and asserts that the name reads correctly on the plantar face. Make the test fail if either the slicer mirror or the name placement flips. Reuse #435's chirality gate approach, but run it end-to-end through the fixed VertexSlice mirror."
**PASS.** The workflow runs on pull requests for both feet and both print directions through `buildPrinterFootManufacturingStl` and a real VertexSlice container pinned to `9fe936425ad4449ee6a6d932b636a432c8dd2ea2`. The fix image passes all 6. An X mirror of that G-code fails all 6. #436 glyph-X placement on the fix image fails all 6. Thresholds in `thresholds.ts` match the #435 constants (`G1_MIN_ADVANCE_MM` 20, hook 1.5/0.75, axis 0.5, skew 0.15, name `JABBOUR`).
