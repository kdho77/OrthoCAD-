# Grade of the plantar-name lock

**Verdict: PASS**

Worker head `97393f9b9d8b00e2922b6c18448747958b62445b` on `cursor/name-plantar-lock-1124` (draft PR [#442](https://github.com/kdho77/OrthoCAD-/pull/442)). Base `cbcb4434c0d8847d8562112bf4b6a1d8717244f0`. This grade does not change product code and is not a merge.

## Gate table

| Check | Result | What was measured |
| --- | --- | --- |
| 1. Diff is test/CI only; STL from `buildPrinterFootManufacturingStl` unmocked; G-code from a real VertexSlice container | PASS | 14 files. No product path. Manufacturing STLs and `POST /v1/slice` on `ghcr.io/kdho77/vertexslice-server`. |
| 2. Live image fails both feet; fix image passes both feet | PASS | Actions run [45520569831](https://github.com/kdho77/OrthoCAD-/actions/runs/45520569831) passed both feet on the fix image. Re-executing the job script: live fails both, fix passes both. Fix G-code sizes match that run. |
| 3. Independent raster correlation agrees | PASS | Upright `JABBOUR` beats its mirror on the fix image only. Live, `#436`, and an X-mirror do not. |
| 4. `#436` placement on the fix image fails; `gtransform.py mirror_x` fails | PASS | Worker test exit 1 on both. Correlation agrees. |
| 5. Verdict, gate table, ledger | PASS | This file. |

## 1. Diff review

`git diff cbcb4434...97393f9b` is only:

- `.github/workflows/name-plantar-e2e.yml`
- `ci/unit-test-shards.json` (257 insertions, 254 deletions; test-path set adds `tests/gcode-handedness-guard.frozen.test.ts`, `tests/name-plantar-e2e/build-stls.test.ts`, and `tests/name-plantar-e2e/chirality.test.ts`; nothing removed)
- `tests/name-plantar-e2e/**`

`build-stls.test.ts` calls `buildPrinterFootManufacturingStl(side, true)` for both feet. The only stub is `fetch` of `tests/fixtures/SAMPLE_Top.glb`. Nothing replaces the manufacturing function, the slicer, or the G-code reader. `slice-feet.sh` runs the server image and `POST /v1/slice` (`profile_id=apex-v2-insole-95a`, `material=apex_core`, `wall_loops=1`, `infill_density=26`, `print_direction=toe_first`, `belt_insole_place=true`). `measure.ts` scores those files in the physical reading frame. It does not use the modelled det −1 camera from `#435`.

Rebuilt STLs on this head: left 137692 solid / 137772 upload, right 138790 / 138870. Headers `OrthoCAD single-foot left` and `OrthoCAD single-foot right`. Same triangle counts as the worker's `PROOFS.md`.

## 2. Live fails, fix passes

The workflow's default image is the live digest plus `validation/stl_preprocess.py` from VertexSlice `0415b656d42d7ae0828e435b98f6fdae4f6f0486`. That file's sha256 is `2f0cc241026e97fa1c517ee25fa7f9f742c17a3f75a2efa9064bebe97eccee40`, the same value the Actions log printed.

Live image: `ghcr.io/kdho77/vertexslice-server@sha256:8cac1d54c5e1a12f4693412c32fe40dd9c5682b9279e2b1d38f1225760aca579` (`origin/main` `d935197976`).

`POST /repos/kdho77/OrthoCAD-/actions/workflows/name-plantar-e2e.yml/dispatches` and `POST /repos/kdho77/OrthoCAD-/actions/runs/45520569831/rerun` both returned HTTP 403 `Resource not accessible by integration`. The worker reported the same 403 for dispatch. The fix-image job that already ran was read from the log, and the job's own steps were executed again here against both images. This machine has no modelled slicer. Docker ran the published image.

Actions run 45520569831, job `plantar-name`, conclusion success, head `97393f9b`. Log: image `vertexslice-server:plantar-fix`, id `sha256:4af544adf4af5d35fd1526d97cb74a142b88dcddeb714e4f6380e3031994f47b`. Slice left HTTP 200, 11 s, 3624505 bytes; right HTTP 200, 11 s, 3662976 bytes. Measure: left `a=0.996253 d=0.896343` hook true advance 71.756 sequence `JABBOUR`; right `a=0.990663 d=0.63214` hook true advance 71.914 sequence `JABBOUR`.

Re-slice of the same STLs with `tests/name-plantar-e2e/slice-feet.sh`:

| Image | Foot | HTTP | Bytes | Worker test | a | d | hook | sequence |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- | --- |
| live | left | 200 | 3667318 | FAIL | 0.996024 | -0.919165 | false | JABBOUR |
| live | right | 200 | 3626409 | FAIL | 0.982397 | -0.904079 | false | JABBOUR |
| fix | left | 200 | 3624505 | PASS | 0.996253 | 0.896343 | true | JABBOUR |
| fix | right | 200 | 3662976 | PASS | 0.990663 | 0.632140 | true | JABBOUR |

Fix byte sizes equal the Actions log. Live byte sizes and the six-decimal coefficients equal the worker's P1 table. Right-foot `d` on the fix image is 0.632, above 0.5. The threshold file still has `G1_AXIS_MIN = 0.5`.

## 3. Independent correlation

`tests/name-plantar-lock-grade/plantar_raster_correlation.py` does not use the worker's loop fit, linear map, or J-hook test. It keeps belt-contact extrusions (`Y <= 0.6`), maps them with `zt = Z - Y`, image right `= -X`, image up `= +zt`, then the 90° turn (toe toward `+x`, cap toward `+y`). The engraved name is the enclosed gaps in that layer. Those gaps are correlated with Inter Bold `JABBOUR` at 12 mm cap and 0.6 mm tracking, and with that rendering flipped left-right. A foot reads correctly only when the upright score beats the mirror by at least 0.04 and is at least 0.12.

| Case | Foot | Upright | Mirror | Delta | Reads | Worker |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `#373` + fix | left | 0.4982 | 0.3719 | +0.1263 | yes | PASS |
| `#373` + fix | right | 0.4957 | 0.3816 | +0.1141 | yes | PASS |
| `#373` + live | left | 0.3682 | 0.3854 | -0.0172 | no | FAIL |
| `#373` + live | right | 0.3648 | 0.3772 | -0.0124 | no | FAIL |
| `#436` + fix | left | 0.3786 | 0.4896 | -0.1110 | no | FAIL |
| `#436` + fix | right | 0.3574 | 0.4917 | -0.1343 | no | FAIL |
| fix G-code `mirror_x` | left | 0.3761 | 0.3873 | -0.0112 | no | FAIL |
| fix G-code `mirror_x` | right | 0.3647 | 0.3784 | -0.0137 | no | FAIL |

Exit status of the script: 0 on the fix pair, 1 on live, `#436`, and `mirror_x`. Same pass/fail as the worker on every foot.

## 4. Bad-change proofs

`#436` (`ad2ada118a4bdf635d4bb20249ee7ee9fc7cbc9f`) negates glyph X when `beltPrint` is set. That two-line change was applied only in a throwaway worktree, the STLs were rebuilt, and `place.ts` was restored. It is not in this grade diff and not in the worker diff. STL counts: left 137222/137302, right 138806/138886, matching the worker's P3. Sliced on the fix image: left 3629071 bytes, right 3685613 bytes, also matching P3. Worker test exit 1. Left `a=-0.956561` advance -71.824 sequence `RUOBBAJ` hook false. Right `a=-0.959912` advance -71.571 sequence `RUOBBAJ` hook false.

`python3 gtransform.py IN OUT mirror_x` from VertexSlice `validation/handedness_gates` on `cursor/lr-swap-gates-1124`. File sha256 `c3b36d71e2ed881c864b21081d6df510edaddcbab34d389009e0bdde748d16c9`, the frozen manifest hash. Applied to the passing fix G-code. Worker test exit 1. Left `d=-0.924467` hook false sequence `JABBOUR`. Right `d=-0.640268` hook false sequence `JABBOUR`.

## Rule-compliance report

Each line is the constraint ledger. The result is whether `97393f9b` keeps that line.

L1 Kendon 2026-10-24 9:33 PM MT (memory): he "confirmed the belt slicing chain mirrors parts (the golden, sliced from a true left STL, printed as a right foot). He approved fixing the mirror at VertexSlice belt placement".
**PASS.** The diff does not move the mirror. The lock consumes the VertexSlice fix image (live server plus `stl_preprocess.py` from `0415b656`) and leaves OrthoCAD placement and VertexSlice source alone.

L2 Kendon 2026-10-24: "Text a user adds to a left or right foot must read correctly on screen and print correctly on that foot, which means true-handed STL export and no net mirror in the slicing chain."
**PASS.** The test builds the STL the bot sends and slices it. On the fix image both feet pass. On the live image, which still has the net mirror, both feet fail.

L3 Kendon 2026-10-24: "No other fix, including the belt mirror fix, may change or lose any of his ApexLight settings."
**PASS.** No profile, temperature, or product setting changes. The slice request uses the existing `apex-v2-insole-95a` profile. The job slices `apex_core` only; it does not edit ApexLight.

L4 Kendon 2026-11-20 11:38 AM MT: "The seams have always been on the bottom it's been a permanent rule since the beginning".
**PASS.** No seam, layer-change, or surface file is in the diff.

L5 Kendon standing rule: locked surface quality, seams and layer changes (bottom only); no scope growth; copy Cura's method.
**PASS.** Test and CI only. The slicer request copies the existing belt form fields.

L6 Kendon 2026-11-24 4:18 PM MT (P0): MCP belt G-code labelled left is physically a right foot. Correct handedness is mandatory.
**PASS.** This diff does not relabel feet and does not change sliced product output. The frozen handedness gate files are not edited.

L7 Kendon 2026-11-24 4:28 PM MT: "(a) An automated handedness check in the generate/export production pipeline, run on the final sliced G-code. It detects the physical foot (arch/medial side on the bottom layer, relative to print direction) and compares it with the requested side. On a mismatch or an inconclusive result, it fails the production with a clear error instead of delivering or attaching the file. It must work for both print directions. (b) A regression test covering heel-first and toe-first print directions times left and right, which fails if the label and the physical foot disagree."
**PASS.** `tests/gcode-handedness-guard.frozen.test.ts` and `tests/fixtures/handedness` are not in the diff. Shard regeneration adds that frozen test to the unit list, so the unit CI runs it. This PR does not replace the guard.

L8 No merge or deploy without Kendon's explicit go. Draft PR only.
**PASS.** [#442](https://github.com/kdho77/OrthoCAD-/pull/442) is a draft. It is not merged. This grade is a separate draft and is not merged.

L9 Frozen gate files are byte-identical to the PM's (SHA256SUMS); never edit, re-hash or skip a gate. If a gate cannot pass, stop and report why.
**PASS.** No frozen gate file and no `SHA256SUMS` is in the diff. Nothing was re-hashed. The name-lock thresholds are the `#435` numbers (`a > 0.5`, `d > 0.5`, advance `> 20` mm, hook `1.5` / `0.75` mm). They were not loosened. Right-foot `d = 0.632` still clears 0.5.

L10 Kendon 2026-11-24 4:52 PM MT: "once the name reads correctly from the bottom of the insole, lock it so it never regresses again. Add a permanent CI test ... It runs on the real production path (design, then belt placement and slicer mirror, then final G-code bottom layers), for both feet, and asserts that the name reads correctly on the plantar face. Make the test fail if either the slicer mirror or the name placement flips. Reuse #435's chirality gate approach, but run it end-to-end through the fixed VertexSlice mirror."
**PASS.** The workflow builds both manufacturing STLs, slices them through the fix image, and asserts the plantar name. Live (slicer mirror still present) fails both feet. `#436` glyph-X negation on the fix image fails both feet. An X-mirror of the passing G-code fails both feet. The independent correlation agrees with those verdicts.
