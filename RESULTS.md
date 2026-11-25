# GRADE: PASS

Independent grade of OrthoCAD draft PR [#439](https://github.com/kdho77/OrthoCAD-/pull/439) at `c365eaf9e0d1efce0f0d16ece47d322f6a841c0e` (`cursor/lr-swap-guard-1124`, same SHA). Base `cursor/lr-swap-guard-gates-1124` @ `cbcb4434c0d8847d8562112bf4b6a1d8717244f0`. Graded 2026-11-25. No product code was edited. Frozen gate files were not edited. This PR is draft and must not be merged.

VertexSlice belt-placement mirror remains a separate draft, [kdho77/VertexSlice#52](https://github.com/kdho77/VertexSlice/pull/52) at `0415b656`. PM local slices on that head show true-left classifies as LEFT. This grade did not re-slice VertexSlice. On current VertexSlice, PR #439 fails a left production instead of delivering the mirrored file.

## CI

Head was still `c365eaf9` at grade time (`git ls-remote` on both worker branches).

| Check | Result |
| --- | --- |
| Vercel combined status on `c365eaf9` | success, completed 2026-11-25T00:04:58Z |
| Vercel Preview Comments check run `138872827402` | completed, success |
| GitHub Actions `Test` (`.github/workflows/main.yml`) | no run. The workflow triggers on `pull_request` to `main` and on push to `main` or `ci/shard-unit-tests`. PR #439 targets `cursor/lr-swap-guard-gates-1124`, so Actions does not start. Polled twice; `list_workflow_runs` for the head SHA returned `total_count: 0`. |

## Gate table

| # | Gate | Result |
| --- | --- | --- |
| 1 | `sha256sum -c tests/fixtures/handedness/SHA256SUMS` on `c365eaf9` | PASS. All 5 lines OK (4 fixtures + `tests/gcode-handedness-guard.frozen.test.ts`). |
| 2a | Frozen H4 test on `c365eaf9` | PASS. 14 passed, 0 failed. |
| 2b | Frozen H4 test on `cbcb4434` (no-op proof) | PASS. File failed to load: `Cannot find module '../vertex/server/src/lib/gcode-handedness'`. |
| 3a | Scratch: invert the LEFT rule in `gcode-handedness.ts` | PASS. Frozen test failed, 13 failed / 1 passed. Not pushed. |
| 3b | Scratch: inconclusive result returns the requested side | PASS. Frozen test failed, 1 failed / 13 passed. The failure is `inconclusive G-code fails for both sides`. Not pushed. |
| 3c | Scratch: remove `assertGcodeHandedness` from `acceptCheckedGcode` | PASS. Worker test `a mirrored left slice fails before upload; a true left is stored unchanged` failed: `expected 'succeeded' to be 'failed'` at `cad-operator-production.test.ts:1475`. The same test passes on unmodified `c365eaf9`. Not pushed. |
| 4 | Independent production-path test `tests/handedness-grade/production-path.grade.test.ts` on `c365eaf9` | PASS. 8 passed, 0 failed. |
| 5 | #370 SAMPLE_Top swap removed; no geometry / STL / text / G-code byte change | PASS. Diff review below. |
| 6 | Guard runtime on a 3 MB G-code | PASS. 3,145,746 bytes classified in 102.4 ms (`inconclusive` on a repeated non-foot line). Bound used: 1.5 s. |

`git diff cbcb4434 c365eaf9 -- tests/fixtures/handedness tests/gcode-handedness-guard.frozen.test.ts` is empty.

## Production path (gate 4)

The grade test drives `executeCadOperatorProduction` with the real `runCadSliceAttempt` (sync `sliceWithVertexSlice` after job-route 404, and `downloadVertexSliceJobResult`) and drives `runSessionGenerateSolid` with the real `sliceWithVertexSlice`. VertexSlice HTTP is stubbed. Upload, charge, and `buildVoAttachFilesHandoff` run only after a succeeded row.

| Case | Result |
| --- | --- |
| `side=left`, sync and job, fixture `main_left_request_toe_first` | status `failed`, error `Handedness check failed: requested left, G-code is a physical right foot. File not delivered.`, uploads 0, charges 0, VO attach 0, storage key null |
| `side=left`, `true_left_toe_first` | status `succeeded`, uploaded bytes identical to the fixture, sample-top VO filename `Jane_Doe_ApexCore_L.gcode`, VO side `left` |
| Pair, left gets `main_left_request_toe_first`, right gets `true_left_toe_first` | left error names requested left and physical right; right error names requested right and physical left; uploads 0. `generate_gcode` with no side invokes both feet and returns `Belt pair failed on the left foot` including that left message |
| Session `runSessionGenerateSolid` | mirrored left throws the left/right message before charge or upload; true left uploads the same bytes once; true left requested as right throws the right/left message with uploads 0 |

### Callers of `sliceWithVertexSlice` / `downloadVertexSliceJobResult`

Non-test mentions are only these files. Every `await` call is followed by `acceptCheckedGcode` or `assertGcodeHandedness` within 25 lines. No unguarded path.

| Caller | Side | Guard |
| --- | --- | --- |
| `vertexslice-client.ts` | definition; `request.side` is the timeout label | returns bytes; callers below check |
| `cad-operator-production.ts:1057` `sliceWithVertexSlice` | `args.side` | `acceptCheckedGcode` → `assertGcodeHandedness` |
| `cad-operator-production.ts:1090` `downloadVertexSliceJobResult` | `args.side` | `acceptCheckedGcode` |
| `manufacturing-session.ts:319` `io.sliceWithVertexSlice` | `input.side` | `assertGcodeHandedness` at line 332, before charge and `uploadOutput` |
| `manufacturing.ts:140` passes `sliceWithVertexSlice` into session IO | session `input.side` | `runSessionGenerateSolid` |
| `cad-operator-generate.ts:148` and `:328` `runCadSliceAttempt` | row side / `input.side` | check is inside `runCadSliceAttempt` before `uploadGcode` |

`executeCadOperatorProduction` uploads only after the slice callback returns gcode. A thrown `GcodeHandednessError` is stored by `publicProductionError` without rewriting the handedness sentence, and `uploadGcode` is not called.

CNC mill G-code (`runCadOperatorCncGcodeRequest`) does not call `sliceWithVertexSlice` or the slice-job result. It is a mill toolpath, not belt G-code. It is not an unguarded VertexSlice path.

AFO shell G-code that uses session `generateSolid` goes through the same `runSessionGenerateSolid` check. An inconclusive AFO program fails closed under L7.

## #370 and byte diff (gate 5)

`git diff --name-only cbcb4434 c365eaf9` is 16 files. None are geometry, STL, loft, text-marking, or G-code fixture bytes. `ci/unit-test-shards.json` keeps every previous test path (373) and adds `tests/gcode-handedness-guard.frozen.test.ts` and `vertex/server/src/lib/gcode-handedness.test.ts` (375). Removed paths: 0.

`physicalSideLabel` in `vertex/shared/export-filename.ts`, `packages/mcp/src/shared/export-filename.ts`, and `vertex/server/src/orthocad-mcp.bundled.mjs` returns the requested side. The `sample-top` ternary is gone. `exportSideSuffix("left", { assetId: "sample-top" })` is `L`. VO attach for sample-top left is side `left`, filename `Jane_Doe_ApexCore_L.gcode`. `vertex/src/lib/cnc/order-sides.ts` has a comment-only diff and still calls `physicalSideLabel`; it has no local `left ? right` swap.

## Rule-compliance report

L1. Kendon 2026-10-24 9:33 PM MT (memory): he "confirmed the belt slicing chain mirrors parts (the golden, sliced from a true left STL, printed as a right foot). He approved fixing the mirror at VertexSlice belt placement". **PASS.** PR #439 does not move that fix into OrthoCAD. It refuses the mirrored belt file. The mirror change stays on VertexSlice draft #52.

L2. Kendon 2026-10-24: "Text a user adds to a left or right foot must read correctly on screen and print correctly on that foot, which means true-handed STL export and no net mirror in the slicing chain." **PASS.** The diff changes no text-marking, STL, or G-code bytes. A sliced file whose physical foot is not the requested side is not uploaded or attached.

L3. Kendon 2026-10-24: "No other fix, including the belt mirror fix, may change or lose any of his ApexLight settings." **PASS.** No print-profile, material, or ApexLight setting file is in the diff.

L4. Kendon 2026-11-20 11:38 AM MT: "The seams have always been on the bottom it's been a permanent rule since the beginning". **PASS.** No seam code is in the diff.

L5. Kendon standing rule: locked surface quality, seams and layer changes (bottom only); no scope growth; copy Cura's method. **PASS.** The diff is the belt G-code check, the SAMPLE_Top label identity, tests, and the shard manifest. No surface, seam, or layer-change code.

L6. Kendon 2026-11-24 4:18 PM MT (P0): MCP belt G-code labelled left is physically a right foot. Correct handedness is mandatory. **PASS.** `main_left_request_toe_first` for `side=left` fails the production with the message that names requested left and a physical right foot, on the sync path, the job-result path, and session `generateSolid`.

L7. Kendon 2026-11-24 4:28 PM MT: "(a) An automated handedness check in the generate/export production pipeline, run on the final sliced G-code. It detects the physical foot (arch/medial side on the bottom layer, relative to print direction) and compares it with the requested side. On a mismatch or an inconclusive result, it fails the production with a clear error instead of delivering or attaching the file. It must work for both print directions. (b) A regression test covering heel-first and toe-first print directions times left and right, which fails if the label and the physical foot disagree." **PASS.** (a) `assertGcodeHandedness` runs on the final VertexSlice bytes in `acceptCheckedGcode` and in `runSessionGenerateSolid` before upload. Mismatch and inconclusive throw `GcodeHandednessError`. (b) Frozen H4 covers toe-first and heel-first, each against left and right, and passed on this head. Inverting the LEFT rule or accepting an inconclusive result makes that frozen test fail.

L8. No merge or deploy without Kendon's explicit go. Draft PR only. **PASS.** #439 is an open draft. This grade PR is a draft. Nothing was merged, deployed, or sent to Railway. #439 was not edited.

L9. Frozen gate files are byte-identical to the PM's (SHA256SUMS); never edit, re-hash or skip a gate. If a gate cannot pass, stop and report why. **PASS.** `sha256sum -c` passed on `c365eaf9` and on `cbcb4434`. The frozen test and fixtures have an empty diff between those commits. This grade did not edit them.

## How the grade test was run

On a detached worktree of `c365eaf9`, with this file copied in (not committed on the worker branch):

```bash
npx rstest tests/handedness-grade/production-path.grade.test.ts
npx rstest tests/gcode-handedness-guard.frozen.test.ts
sha256sum -c tests/fixtures/handedness/SHA256SUMS
```

The production assertions import the worker modules, so they are meant to run on `c365eaf9`. On `cbcb4434` the frozen test's missing module is the no-op proof.
