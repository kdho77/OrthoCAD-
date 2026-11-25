# Grade of the plantar-name lock

**Verdict: PASS**

Worker head `04e32aae7c4640d6b8e3b7215f7f037d049d3bb8` on `cursor/name-plantar-lock-1124` (draft PR [#442](https://github.com/kdho77/OrthoCAD-/pull/442)). Base `cbcb4434c0d8847d8562112bf4b6a1d8717244f0`. This grade does not change product code and is not a merge.

The previous grade was `97393f9b`, toe-first `apex_core` only. This head adds `apex_light` toe-first and `apex_light` heel-first. `apex_core` still ignores a heel-first request (`server/chains/apex_core.py` hardcodes `toe_first`). Heel-first is sliced on `apex_light`, whose chain passes `print_direction` through.

## Gate table

| Check | Result | What was measured |
| --- | --- | --- |
| 1. Diff is test/CI only; STL from `buildPrinterFootManufacturingStl` unmocked; G-code from a real VertexSlice container | PASS | Two commits, 14 files. No product path. Six real `POST /v1/slice` cells per image. |
| 2. Live fails every cell; fix passes every cell | PASS | Actions run [45529213885](https://github.com/kdho77/OrthoCAD-/actions/runs/45529213885) passed all six cells on the fix image. Re-executing `slice-feet.sh`: live fails all six, fix passes all six. Byte sizes match that run and the worker's `PROOFS.md`. |
| 3. Heel-first files are really heel-first | PASS | Frozen `hand_classify.py` reports `heel_high_zt` false on every heel-first file (fix, live, and `#436`) and true on every toe-first file. |
| 4. Independent raster correlation agrees | PASS | Upright `JABBOUR` beats its mirror only on the fix image, in both directions. Live, `#436`, and an X-mirror do not. |
| 5. `#436` on the fix image fails; `gtransform.py mirror_x` fails | PASS | Worker test exit 1 on all six cells for each. Correlation agrees. |
| 6. Verdict, gate table, ledger | PASS | This file. |

## 1. Diff review

`git diff cbcb4434...04e32aae` is only:

- `.github/workflows/name-plantar-e2e.yml` (the slice step title, and the job that builds the fix image)
- `ci/unit-test-shards.json` (adds the name-lock unit tests and the already-frozen handedness test; nothing removed)
- `tests/name-plantar-e2e/**`

`place.ts` is not in the diff. `#373` placement is unchanged. `build-stls.test.ts` still calls `buildPrinterFootManufacturingStl(side, true)`. The only stub is `fetch` of `tests/fixtures/SAMPLE_Top.glb`. STL counts on this head: left 137692/137772, right 138790/138870.

`slice-feet.sh` runs the server image and `POST /v1/slice` for three cells, each left and right: `apex_core` `toe_first`, `apex_light` `toe_first`, `apex_light` `heel_first`. Profile `apex-v2-insole-95a`, `wall_loops=1`, `infill_density=26`, `belt_insole_place=true`. No modelled G-code.

## 2. Live fails, fix passes

Fix image: live digest `ghcr.io/kdho77/vertexslice-server@sha256:8cac1d54c5e1a12f4693412c32fe40dd9c5682b9279e2b1d38f1225760aca579` plus `validation/stl_preprocess.py` sha256 `2f0cc241026e97fa1c517ee25fa7f9f742c17a3f75a2efa9064bebe97eccee40` from VertexSlice `0415b656`.

Actions run 45529213885, job `plantar-name`, conclusion success, head `04e32aae`. CI image `sha256:e7e16c7f0f3f7514c676f5768118abde9beb9d713a42685ae89808e111ca7ef0`. All six cells passed. Local re-slice byte sizes equal the log:

| cell | fix bytes | live bytes |
| --- | ---: | ---: |
| apex_core toe_first left | 3624505 | 3667318 |
| apex_core toe_first right | 3662976 | 3626409 |
| apex_light toe_first left | 3484912 | 3481269 |
| apex_light toe_first right | 3449999 | 3507821 |
| apex_light heel_first left | 3572422 | 3559194 |
| apex_light heel_first right | 3527843 | 3558806 |

Worker test on those files matches the CI log and `PROOFS.md` to the printed coefficients. Fix: all six `pass` true, sequence `JABBOUR`, hook true, advance about 72 mm. Heel-first `heelHigh` false (delta −21.54 / −21.51). Toe-first `heelHigh` true (delta 19.25). Right-foot `d` is 0.632 on core and 0.630 on light heel-first, both above 0.5. Thresholds were not loosened.

Live: all six fail. `d` is negative (about −0.63 to −0.92), hook false, sequence still `JABBOUR`. Direction is still real: toe-first `heelHigh` true, heel-first false. `workflow_dispatch` remains HTTP 403 for this token, so the live cells are this re-execution of the job script, not a second Actions run.

## 3. Heel-first is heel-first

Frozen `validation/handedness_gates/hand_classify.py` from VertexSlice `cursor/lr-swap-gates-1124`. sha256 `cd7ad80b5858ea713d35dba55a8569aa653ad428501cdf5d74a2a44846ecd9d6`, the line in that branch's `SHA256SUMS`. Not the worker's TypeScript copy.

On every heel-first file (fix, live, `#436`, and the X-mirror of the fix files) `heel_high_zt` is false and the heel/toe max-Y gap is about 21.5 mm. On every toe-first file `heel_high_zt` is true and the gap is about 19.3 mm. Fix-image left files classify as `LEFT` and right files as `RIGHT`. Live-image left files classify as `RIGHT` (the slicer mirror). The name test does not replace that foot-side guard.

## 4. Independent correlation

`tests/name-plantar-lock-grade/plantar_raster_correlation.py` rasters belt-contact extrusions and correlates the letter voids with Inter Bold `JABBOUR` and with that rendering flipped left-right. It does not use the worker's loop fit, linear map, or J-hook test. `--heel-high` is the toe-first camera (toe to `+x`, cap to `+y`). `--heel-low` flips both axes, which is the 180° belt turn. The flag follows `hand_classify`, not the filename alone.

A cell reads correctly only when the upright score beats the mirror by at least 0.04 and is at least 0.12.

| Case | Cells | Correlation | Worker |
| --- | --- | --- | --- |
| `#373` + fix | 6 | upright wins by +0.103 to +0.126 | PASS |
| `#373` + live | 6 | upright does not win (delta −0.017 to +0.009) | FAIL |
| `#436` + fix | 6 | mirror wins by 0.097 to 0.134 | FAIL |
| fix G-code `mirror_x` | 6 | upright does not win (delta −0.017 to +0.007) | FAIL |

`#436` heel-first right: the worker found 0 letter loops and failed closed (`letter walls 0`). The raster still sees letter voids and prefers the mirror (delta −0.097). Both verdicts are fail.

## 5. Bad-change proofs

`#436` (`ad2ada11`) glyph-X negation, applied only to the STLs already built for the previous grade (left 137222/137302, right 138806/138886), sliced on the fix image with the new six-cell script. `place.ts` in the worker worktree was left clean. Worker test exit 1. Five cells are `RUOBBAJ` with `a` about −0.95 and `heelHigh` matching the direction. Heel-first right fails closed, `heelHigh` false, delta −21.54.

`python3 gtransform.py IN OUT mirror_x` from VertexSlice `validation/handedness_gates` on `cursor/lr-swap-gates-1124` (sha256 `c3b36d71e2ed881c864b21081d6df510edaddcbab34d389009e0bdde748d16c9`). Applied to all six passing fix files. `heel_high_zt` stays with the print direction and the classified foot flips. Worker test exit 1 on all six: `d` negative, hook false, sequence still `JABBOUR`.

## Rule-compliance report

Each line is the constraint ledger. The result is whether `04e32aae` keeps that line.

L1 Kendon 2026-10-24 9:33 PM MT (memory): he "confirmed the belt slicing chain mirrors parts (the golden, sliced from a true left STL, printed as a right foot). He approved fixing the mirror at VertexSlice belt placement".
**PASS.** The diff does not move the mirror. The lock consumes the VertexSlice fix image and leaves OrthoCAD placement and VertexSlice source alone.

L2 Kendon 2026-10-24: "Text a user adds to a left or right foot must read correctly on screen and print correctly on that foot, which means true-handed STL export and no net mirror in the slicing chain."
**PASS.** The test builds the STL the bot sends and slices it. On the fix image all six cells pass. On the live image, which still has the net mirror, all six fail.

L3 Kendon 2026-10-24: "No other fix, including the belt mirror fix, may change or lose any of his ApexLight settings."
**PASS.** No profile or product setting changes. The slice request uses the existing `apex-v2-insole-95a` profile. `apex_light` is only the material that honours heel-first. Its settings are not edited.

L4 Kendon 2026-11-20 11:38 AM MT: "The seams have always been on the bottom it's been a permanent rule since the beginning".
**PASS.** No seam, layer-change, or surface file is in the diff.

L5 Kendon standing rule: locked surface quality, seams and layer changes (bottom only); no scope growth; copy Cura's method.
**PASS.** Test and CI only. The slicer request copies the existing belt form fields.

L6 Kendon 2026-11-24 4:18 PM MT (P0): MCP belt G-code labelled left is physically a right foot. Correct handedness is mandatory.
**PASS.** This diff does not relabel feet and does not change sliced product output. The frozen handedness gate files are not edited. Live left files still classify as a right foot.

L7 Kendon 2026-11-24 4:28 PM MT: "(a) An automated handedness check in the generate/export production pipeline, run on the final sliced G-code. It detects the physical foot (arch/medial side on the bottom layer, relative to print direction) and compares it with the requested side. On a mismatch or an inconclusive result, it fails the production with a clear error instead of delivering or attaching the file. It must work for both print directions. (b) A regression test covering heel-first and toe-first print directions times left and right, which fails if the label and the physical foot disagree."
**PASS.** `tests/gcode-handedness-guard.frozen.test.ts` and `tests/fixtures/handedness` are not in the diff. Shard regeneration enrolls that frozen test. This PR does not replace the guard.

L8 No merge or deploy without Kendon's explicit go. Draft PR only.
**PASS.** [#442](https://github.com/kdho77/OrthoCAD-/pull/442) is a draft. It is not merged. This grade is a separate draft and is not merged.

L9 Frozen gate files are byte-identical to the PM's (SHA256SUMS); never edit, re-hash or skip a gate. If a gate cannot pass, stop and report why.
**PASS.** No frozen gate file and no `SHA256SUMS` is in the diff. Nothing was re-hashed. The name-lock thresholds remain the `#435` numbers (`a > 0.5`, `d > 0.5`, advance `> 20` mm, hook `1.5` / `0.75` mm). Right-foot `d` stays above 0.5.

L10 Kendon 2026-11-24 4:52 PM MT: "once the name reads correctly from the bottom of the insole, lock it so it never regresses again. Add a permanent CI test ... It runs on the real production path (design, then belt placement and slicer mirror, then final G-code bottom layers), for both feet, and asserts that the name reads correctly on the plantar face. Make the test fail if either the slicer mirror or the name placement flips. Reuse #435's chirality gate approach, but run it end-to-end through the fixed VertexSlice mirror."
**PASS.** The workflow does that for both feet and both print directions. Heel-first is real (`heel_high_zt` false). Live fails all six cells. `#436` glyph-X negation on the fix image fails all six. An X-mirror of the passing G-code fails all six. The independent correlation agrees.
