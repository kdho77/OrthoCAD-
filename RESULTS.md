# GRADE: PASS

Independent grade of the OrthoCAD G-code handedness guard and the #370 SAMPLE_Top label-swap removal.

| Item | Value |
| --- | --- |
| Worker branch | `cursor/lr-swap-guard-1124` |
| Worker head | `c365eaf9e0d1efce0f0d16ece47d322f6a841c0e` |
| Worker draft | https://github.com/kdho77/OrthoCAD-/pull/439 (draft, not merged). GitHub head ref is `cursor/production-g-code-handedness-guard-remove-370-sample-top-label-swap-7e97` at the same SHA. |
| Gates base | `cursor/lr-swap-guard-gates-1124` @ `cbcb4434c0d8847d8562112bf4b6a1d8717244f0` |
| Graded commits | `e56608b2` Fail production when sliced belt G-code is the wrong foot. `c365eaf9` Stop swapping SAMPLE_Top L/R labels. |
| Grade test | `tests/handedness-grade/production-guard.grade.test.ts` (`4f284179c7757a94d1d3bc0124b5249cbbe3924184da0ab884c2fef1a4cd1575`) |
| Runtime | Node v22.23.4, `npx rstest`, worker worktree `/tmp/worker-head` at `c365eaf9`. Product files were restored after the scratch proofs (`git diff` empty). |

This PR adds only this file and `tests/handedness-grade/**`. It does not change product code, frozen gate files, or any other pull request.

## Gate table

| # | Gate | Result | Evidence |
| --- | --- | --- | --- |
| 1 | `sha256sum -c tests/fixtures/handedness/SHA256SUMS` on the worker head | PASS | All five lines OK, including `tests/gcode-handedness-guard.frozen.test.ts`. `git diff cbcb4434 HEAD -- tests/fixtures/handedness tests/gcode-handedness-guard.frozen.test.ts` is empty. |
| 2a | Frozen H4 on the worker head | PASS | `npx rstest tests/gcode-handedness-guard.frozen.test.ts` — 14 passed, 0 failed. Toe-first and heel-first, left and right. `main_left_request_toe_first` requested left throws `GcodeHandednessError`. |
| 2b | Frozen H4 on `cbcb4434` (no-op proof) | PASS | Same command on the gates commit exits 1 before any test: `Cannot find module '../vertex/server/src/lib/gcode-handedness'`. The guard is absent, so the gate cannot pass by doing nothing. |
| 3a | Scratch: invert the LEFT rule | PASS | In `gcode-handedness.ts`, `medialOnPlus === heelHigh ? "left" : "right"` flipped to `"right" : "left"`. Frozen suite exits 1. First failure: `main_left_request_toe_first` detects `left`, expected `right`. File restored. |
| 3b | Scratch: inconclusive accepts the requested side | PASS | `assertGcodeHandedness` returns when `detected.foot === "inconclusive"`. Frozen suite: 1 failed, 13 passed. Failure is `inconclusive G-code fails for both sides` (`expected function to throw an error, but it didn't`). `detectGcodeFoot` still returns `inconclusive`. File restored. |
| 3c | Scratch: remove the production call | PASS | `assertGcodeHandedness(gcode, side)` removed from `acceptCheckedGcode`. Worker test `a mirrored left slice fails before upload; a true left is stored unchanged` exits 1: `expected 'succeeded' to be 'failed'`. File restored. |
| 4 | Independent production path | PASS | `tests/handedness-grade/production-guard.grade.test.ts` on the worker head: 7 passed, 0 failed. Details below. |
| 5 | #370 swap gone; no geometry/STL/text/G-code byte change | PASS | `physicalSideLabel` returns `internalSide` in `packages/mcp/src/shared/export-filename.ts`, `vertex/shared/export-filename.ts`, and `vertex/server/src/orthocad-mcp.bundled.mjs`. Diff review below. |
| 6 | Guard runtime on a 3 MB G-code | PASS | Independent `detectGcodeFoot` on 3,145,746 bytes: 92.7 ms, foot `inconclusive`. Worker's own test on the same machine: 132.1 ms. Both under 1.5 s. |

## (4) Production path

The independent test stubs `fetch` so VertexSlice returns the fixture, then drives `executeCadOperatorProduction` → `runCadSliceAttempt` (the function that uploads only after the slice callback returns G-code) and `runSessionGenerateSolid`.

| Case | Result |
| --- | --- |
| Sync `POST /v1/slice` (jobs route 404) returns `main_left_request_toe_first` for side `left` | Production status `failed`. Stored error is `Handedness check failed: requested left, G-code is a physical right foot. File not delivered.` Upload count 0. Charge count 0. VO attach not built. |
| Slice-job result returns the same fixture for side `left` | Same failure, upload 0, charge 0, attach 0. Stack goes through `downloadVertexSliceJobResult` → `acceptCheckedGcode`. |
| Sync path returns `true_left_toe_first` for side `left` | Status `succeeded`. Uploaded string equals the fixture. Charge 1. `buildVoAttachFilesHandoff` with `base_asset_id: "sample-top"` uses side `left` and a filename ending `_L.gcode`. |
| Pair, both feet | Left job result is `main_left_request_toe_first`: failed, the left/right message above, upload 0. Right sync result is `true_left_toe_first`: failed, error contains `requested right` and `physical left`, upload 0, charge 0. |
| Session `runSessionGenerateSolid` | Left + mirrored fixture throws that same message before `charge` or `uploadOutput`. Right + `true_left_toe_first` throws `/requested right/` with upload still 0. Left + `true_left_toe_first` returns `ok` and uploads the fixture unchanged. |

### Callers of `sliceWithVertexSlice` / the slice-job result that know the side

Scanned `vertex/server/src` and `packages/mcp/src` (`.ts` and `.mjs`, tests skipped, `vertexslice-client.ts` is the definition). Every call is in a file that also contains `acceptCheckedGcode` or `assertGcodeHandedness`.

| Caller | Side | Guard | Verdict |
| --- | --- | --- | --- |
| `vertex/server/src/lib/cad-operator-production.ts` `runCadSliceAttempt` sync fallback (`sliceWithVertexSlice` when `POST /v1/slice/jobs` is 404) | `args.side` | `acceptCheckedGcode` before the G-code is returned to `executeCadOperatorProduction` | PASS |
| Same function, `downloadVertexSliceJobResult` | `args.side` | `acceptCheckedGcode` | PASS |
| `vertex/server/src/routers/manufacturing-session.ts` `runSessionGenerateSolid` | `input.side` | `assertGcodeHandedness` immediately after the await, before charge and `uploadOutput`. Missing side throws `GcodeHandednessError` and does not upload. | PASS |
| `vertex/server/src/routers/manufacturing.ts` | wires the client into session IO | The call is the session function above | PASS (not a second slice) |

`runCadOperatorGenerateRequest` and `continueInFlightSlice` both pass the side into `runCadSliceAttempt`. A saved-design `generate_gcode` with no side enqueues left and right separately; each production carries one side.

Paths that are not VertexSlice slice-job callers, so they are not an unguarded belt path:

- `runCadOperatorCncGcodeRequest` builds mill toolpath bytes with `buildHeadlessMillCncGcode`. It does not call `sliceWithVertexSlice` or `downloadVertexSliceJobResult`.
- `manufacturingBackendForOutput("gcode")` is `vertexslice`. The session `callManufacture` branch is the STL backend.

No unguarded VertexSlice caller. Criterion 4 is PASS.

## (5) #370 and byte review

`physicalSideLabel(internalSide, base)` returns `internalSide` for every base, including `sample-top`. The previous body swapped left and right when `assetId === "sample-top"`. That swap is gone from both TypeScript copies and from `orthocad-mcp.bundled.mjs` (bundle hash line updated with that edit). `vo-attach-files.ts` and the schema comments now say the filename and VO side follow the requested foot. `vertex/src/lib/cnc/order-sides.ts` changed comments only; it still calls `physicalSideLabel`.

`git diff --stat cbcb4434...c365eaf9` is 16 files, 737 insertions, 280 deletions:

- Guard: `gcode-handedness.ts`, `gcode-handedness-sample.ts`, `gcode-handedness.test.ts`, `cad-operator-production.ts`, `manufacturing-session.ts`, and their tests.
- Label: the two `export-filename.ts` files, their tests, `vo-attach-files.ts`, `schemas.ts`, `order-sides.ts`, `orthocad-mcp.bundled.mjs`.
- `ci/unit-test-shards.json`: membership gained `tests/gcode-handedness-guard.frozen.test.ts` and `vertex/server/src/lib/gcode-handedness.test.ts` (373 paths → 375). Removed paths: none. The file also reorders existing shard lists.

No path under a geometry, STL, text-marking, or G-code fixture directory is in that diff. Frozen fixture hashes match `SHA256SUMS`.

## (6) 3 MB runtime

`detectGcodeFoot` on a 3,145,746-byte extrusion file (repeated `G1 X1.00 Y0.20 Z10.00 E0.100`):

- Independent grade test: 92.7 ms, foot `inconclusive` (the synthetic cloud has no distinct arch).
- Worker test `a 3 MB G-code is classified in under 1.5 s`: 132.1 ms, same size, same foot.

## Rule-compliance report

Each ledger line is quoted, then the verdict for this worker diff.

**L1.** Kendon 2026-10-24 9:33 PM MT (memory): he "confirmed the belt slicing chain mirrors parts (the golden, sliced from a true left STL, printed as a right foot). He approved fixing the mirror at VertexSlice belt placement".

PASS. This diff does not add a belt-placement mirror inside OrthoCAD. It removes the SAMPLE_Top filename/VO swap and refuses a sliced file whose physical foot is not the requested side. The VertexSlice mirror fix stays outside this repository.

**L2.** Kendon 2026-10-24: "Text a user adds to a left or right foot must read correctly on screen and print correctly on that foot, which means true-handed STL export and no net mirror in the slicing chain."

PASS for this diff. Text-marking and STL export files are unchanged. A belt G-code whose physical foot disagrees with the requested side is not uploaded or attached. The VertexSlice server mirror is unchanged by these commits; correct files pass the guard once that server returns a true-handed program.

**L3.** Kendon 2026-10-24: "No other fix, including the belt mirror fix, may change or lose any of his ApexLight settings."

PASS. The diff does not touch slicer profiles, materials, infill, or ApexLight settings.

**L4.** Kendon 2026-11-20 11:38 AM MT: "The seams have always been on the bottom it's been a permanent rule since the beginning".

PASS. No seam, layer-change, or surface-placement code is in the diff.

**L5.** Kendon standing rule: locked surface quality, seams and layer changes (bottom only); no scope growth; copy Cura's method.

PASS. The product edits are the belt G-code check and the identity label. Surface, seam, and layer-change code stay as on `cbcb4434`. Shard regeneration keeps every previous test path and adds the two handedness tests.

**L6.** Kendon 2026-11-24 4:18 PM MT (P0): MCP belt G-code labelled left is physically a right foot. Correct handedness is mandatory.

PASS. `main_left_request_toe_first` is detected as a physical right. A left production of that file fails with the message naming requested left and physical right, and the file is not stored.

**L7.** Kendon 2026-11-24 4:28 PM MT: "(a) An automated handedness check in the generate/export production pipeline, run on the final sliced G-code. It detects the physical foot (arch/medial side on the bottom layer, relative to print direction) and compares it with the requested side. On a mismatch or an inconclusive result, it fails the production with a clear error instead of delivering or attaching the file. It must work for both print directions. (b) A regression test covering heel-first and toe-first print directions times left and right, which fails if the label and the physical foot disagree."

PASS. (a) `detectGcodeFoot` / `assertGcodeHandedness` run on the VertexSlice bytes in `runCadSliceAttempt` (sync and job result) and in `runSessionGenerateSolid`, before upload, charge, or attach. Mismatch and inconclusive both throw `GcodeHandednessError`. The frozen fixtures cover heel-first and toe-first. (b) Frozen H4 is unchanged and passes on this head: four files × requested left and right, plus the current-main left rejection and the inconclusive rejection.

**L8.** No merge or deploy without Kendon's explicit go. Draft PR only.

PASS. Worker PR #439 is a draft and was not edited, merged, or deployed. This grade is one draft PR. Railway was not touched.

**L9.** Frozen gate files are byte-identical to the PM's (SHA256SUMS); never edit, re-hash or skip a gate. If a gate cannot pass, stop and report why.

PASS. `sha256sum -c` on the worker head: five OK. Frozen paths are byte-identical to `cbcb4434`. No gate was skipped. No gate failed on the worker head.

## Commands

```text
sha256sum -c tests/fixtures/handedness/SHA256SUMS
# worker head c365eaf9: 5 OK

npx rstest tests/gcode-handedness-guard.frozen.test.ts
# worker head: 14 passed
# cbcb4434: exit 1, Cannot find module '../vertex/server/src/lib/gcode-handedness'

npx rstest tests/handedness-grade/production-guard.grade.test.ts
# copied onto the worker worktree: 7 passed

npx rstest vertex/server/src/lib/cad-operator-production.test.ts -t "mirrored left slice"
# before scratch edit: 1 passed
# after removing assertGcodeHandedness from acceptCheckedGcode: 1 failed
#   expected 'succeeded' to be 'failed'
```
