# GRADE: PASS

Regrade of OrthoCAD draft PR [#439](https://github.com/kdho77/OrthoCAD-/pull/439) at `34f1cb38b1ed48054639d76fbb9b2ad77fc0412e`. Base `cursor/lr-swap-guard-gates-1124` @ `cbcb4434c0d8847d8562112bf4b6a1d8717244f0`. Regraded 2026-11-25. No product code was edited. Frozen gate files were not edited. This PR is draft and must not be merged.

The previous grade was PASS on `c365eaf9e0d1efce0f0d16ece47d322f6a841c0e`. `34f1cb38` is one commit on top of that head: `Feed CAD-operator material tests a real foot of G-code.` The only file in that commit is `vertex/server/src/trpc-cad-operator.test.ts` (+18 / −4). The guard, the production call sites, the SAMPLE_Top label identity, and the frozen fixtures are the same blobs as `c365eaf9`.

VertexSlice belt-placement mirror remains a separate draft, [kdho77/VertexSlice#52](https://github.com/kdho77/VertexSlice/pull/52) at `0415b656`. This grade did not re-slice VertexSlice. On current VertexSlice, PR #439 fails a left production instead of delivering the mirrored file.

## What changed since c365eaf9

The material tests used to stub VertexSlice with `; filament_type = ${material}\nG1 X0\n`. That line is not a foot. `assertGcodeHandedness` rejects it as inconclusive, so production never uploads G-code. On CI run [45517712409](https://github.com/kdho77/OrthoCAD-/actions/runs/45517712409) (head `c365eaf9`), shard 6 failed three assertions in `trpc-cad-operator.test.ts`: the upload was the 4-byte STL stub `\x01\x02\x03\x04`, and the tests expected `filament_type = apex_light`, `apex_core`, and `apex_forge`. That is the guard refusing the mock, not a bypass.

`34f1cb38` does not mock `assertGcodeHandedness`, `detectGcodeFoot`, or `gcode-handedness`. It does not contain `G1 X0`. The fetch stub still returns HTTP 200 from `/v1/slice`, and `sliceCallerMaterial` still calls `runCadOperatorGenerateRequest`. The returned body is a real fixture plus a leading `; filament_type = ${material}` comment:

- requested `left` (the default, and the side every current caller uses) loads `true_left_toe_first`
- requested `right` loads `main_left_request_toe_first`, a physical right

No test in that file passes `side: "right"`, so the right mapping is unused today. It is not a skip. A left request still has to survive the real guard before `uploadedGcode` can contain `filament_type`. Shard 6, which includes this file, passed on `34f1cb38`, so the guard accepted the commented true-left fixture.

The LEFT rule is still `scored.foot = medialOnPlus === heelHigh ? "left" : "right"`. `assertGcodeHandedness` still returns only when `detected.foot === requestedSide`. The file does not `return requestedSide`.

Blob identity `c365eaf9` == `34f1cb38`:

| File | Blob |
| --- | --- |
| `vertex/server/src/lib/gcode-handedness.ts` | `79e15cbf6c7ad49d8c65a91d0331a4ed58318d47` |
| `vertex/server/src/lib/cad-operator-production.ts` | `eb3187325b2db250c52c7fe60f696c5380a4bc4c` |
| `vertex/server/src/routers/manufacturing-session.ts` | `bac8358646a01577a4130fe80149fb06fba8a76f` |
| `vertex/server/src/routers/cad-operator-generate.ts` | `ca4603596960965384b98f99ad04f9b07c2649c0` |
| `vertex/shared/export-filename.ts` | `a7d18151e255e0fab071f7446091d6841fd9f8bb` |
| `tests/gcode-handedness-guard.frozen.test.ts` | `0f3e165069b46799e9a711b9b81e756d8ab28fa4` |
| `tests/fixtures/handedness/SHA256SUMS` | `24ce63f589c6fbfe130ca29c478f27ba424d677c` |

The scratch proofs from the `c365eaf9` grade (invert LEFT, inconclusive returns the requested side, remove `assertGcodeHandedness` from `acceptCheckedGcode`) were not re-run. Those edits land in blobs that did not change.

## CI

[Run 45524837281](https://github.com/kdho77/OrthoCAD-/actions/runs/45524837281). Workflow `Test` (`.github/workflows/main.yml`), event `workflow_dispatch`, actor `kdho77`, head `34f1cb38`. The run object finished `completed` / `failure` at 2026-11-25T01:39:37Z. The only failed job is the optional smoke job. The required aggregator succeeded.

| Job | Result |
| --- | --- |
| unit-tests (1) through (6) | success |
| isolated-postgres-acceptance | success |
| test-and-deploy | success. It needs the six shards and isolated Postgres. It does not need the smoke job. Its steps include the ESM boot, the MCP build, the frozen CNC thickness gates, and the shard require step. It does not deploy and it does not call Railway. |
| default-procedural-smoke | failure |

`default-procedural-smoke` runs only when `github.event_name == 'workflow_dispatch'`. Its failure is `[S1-SMOKE] Default procedural residuals (non-required). STOP.` Misses: `widen+6 pattern-dkds 0.0283>0.02` and `widen+10 pattern-dkds 0.0448>0.02`. The same misses, the same residual numbers, and the same test (`tests/procedural-wall-s1-default-procedural.optional.test.ts:148`) fail on draft PR #442 run [45520985610](https://github.com/kdho77/OrthoCAD-/actions/runs/45520985610) at `97393f9b`. That smoke job is the identical failure. #442's run is not otherwise identical: its `unit-tests (4)` failed, so its `test-and-deploy` failed. On `34f1cb38` every required job passed.

The earlier `c365eaf9` dispatch [45517712409](https://github.com/kdho77/OrthoCAD-/actions/runs/45517712409) was red on required jobs. Shard 6 is the guard-versus-mock failure above. Shard 1 also failed `shell-flatten.test.ts` with `Leader block aborted: the max-X end is not the thinner toe`. That file is outside this diff. Shard 1 is green on `34f1cb38`, whose product blobs match `c365eaf9`.

## Gate table

| # | Gate | Result |
| --- | --- | --- |
| 1 | `sha256sum -c tests/fixtures/handedness/SHA256SUMS` on `34f1cb38` | PASS. All 5 lines OK. `git diff cbcb4434 34f1cb38 -- tests/fixtures/handedness tests/gcode-handedness-guard.frozen.test.ts` is empty. |
| 2a | Frozen H4 on `34f1cb38` | PASS. 14 passed, 0 failed. |
| 2b | Frozen H4 on `cbcb4434` (no-op proof) | PASS, carried from the `c365eaf9` grade. The frozen test failed to load: `Cannot find module '../vertex/server/src/lib/gcode-handedness'`. The module blob on this head is the one that was absent there. |
| 3a | Scratch: invert the LEFT rule | PASS, carried. Frozen suite 13 failed / 1 passed on the same `gcode-handedness.ts` blob. Not pushed. |
| 3b | Scratch: inconclusive returns the requested side | PASS, carried. Frozen test `inconclusive G-code fails for both sides` failed (1 failed / 13 passed). Not pushed. |
| 3c | Scratch: remove `assertGcodeHandedness` from `acceptCheckedGcode` | PASS, carried. Worker test `a mirrored left slice fails before upload` failed: `expected 'succeeded' to be 'failed'`. Not pushed. |
| 4 | Independent production-path test on `34f1cb38` | PASS. 9 passed, 0 failed. The ninth test checks that the material-test change does not stub the guard. |
| 5 | #370 swap gone; no geometry / STL / text / G-code byte change | PASS. `git diff --name-only cbcb4434 34f1cb38` is 17 files. The file added since the previous grade is `vertex/server/src/trpc-cad-operator.test.ts`. None are geometry, STL, loft, text-marking bytes, or G-code fixture bytes. |
| 6 | Guard runtime on a 3 MB G-code | PASS. The same `detectGcodeFoot` blob classifies 3,145,746 bytes inside the 1.5 s bound. The `c365eaf9` measurement was 102.4 ms, foot `inconclusive`. The bound assertion passed again on `34f1cb38`. |

`npx rstest tests/gcode-handedness-guard.frozen.test.ts tests/handedness-grade/production-path.grade.test.ts` on a detached worktree of `34f1cb38`: 23 passed, 0 failed.

## Production path (gate 4)

Unchanged from the `c365eaf9` grade, and re-run on this head. `executeCadOperatorProduction` uses the real `runCadSliceAttempt` (sync `sliceWithVertexSlice` after job-route 404, and `downloadVertexSliceJobResult`). `runSessionGenerateSolid` uses the real `sliceWithVertexSlice`. VertexSlice HTTP is stubbed. Upload, charge, and `buildVoAttachFilesHandoff` run only after a succeeded row.

| Case | Result |
| --- | --- |
| `side=left`, sync and job, fixture `main_left_request_toe_first` | status `failed`, error `Handedness check failed: requested left, G-code is a physical right foot. File not delivered.`, uploads 0, charges 0, VO attach 0, storage key null |
| `side=left`, `true_left_toe_first` | status `succeeded`, uploaded bytes identical to the fixture, sample-top VO filename `Jane_Doe_ApexCore_L.gcode`, VO side `left` |
| Pair, left gets `main_left_request_toe_first`, right gets `true_left_toe_first` | left error names requested left and physical right; right error names requested right and physical left; uploads 0 |
| Session `runSessionGenerateSolid` | mirrored left throws the left/right message before charge or upload; true left uploads the same bytes once; true left requested as right throws the right/left message with uploads 0 |
| Material-test source | no guard import, no guard mock, fixture selection as above, real `runCadOperatorGenerateRequest` |

### Callers of `sliceWithVertexSlice` / `downloadVertexSliceJobResult`

Re-checked on `34f1cb38`. Non-test mentions are the same four files. Every `await` call is followed by `acceptCheckedGcode` or `assertGcodeHandedness` within 25 lines. No unguarded path.

| Caller | Side | Guard |
| --- | --- | --- |
| `vertexslice-client.ts` | definition; `request.side` is the timeout label | returns bytes; callers below check |
| `cad-operator-production.ts` `sliceWithVertexSlice` | `args.side` | `acceptCheckedGcode` → `assertGcodeHandedness` |
| `cad-operator-production.ts` `downloadVertexSliceJobResult` | `args.side` | `acceptCheckedGcode` |
| `manufacturing-session.ts` `io.sliceWithVertexSlice` | `input.side` | `assertGcodeHandedness` before charge and `uploadOutput` |
| `manufacturing.ts` passes `sliceWithVertexSlice` into session IO | session `input.side` | `runSessionGenerateSolid` |
| `cad-operator-generate.ts` `runCadSliceAttempt` | row side / `input.side` | check is inside `runCadSliceAttempt` before `uploadGcode` |

## #370 and byte diff (gate 5)

`physicalSideLabel` in `vertex/shared/export-filename.ts`, `packages/mcp/src/shared/export-filename.ts`, and `vertex/server/src/orthocad-mcp.bundled.mjs` still returns the requested side. Those blobs match `c365eaf9`. The `sample-top` swap is gone. `vertex/src/lib/cnc/order-sides.ts` is still a comment-only diff and still calls `physicalSideLabel`.

## Rule-compliance report

L1. Kendon 2026-10-24 9:33 PM MT (memory): he "confirmed the belt slicing chain mirrors parts (the golden, sliced from a true left STL, printed as a right foot). He approved fixing the mirror at VertexSlice belt placement". **PASS.** PR #439 does not move that fix into OrthoCAD. The new commit does not touch it. The mirror change stays on VertexSlice draft #52.

L2. Kendon 2026-10-24: "Text a user adds to a left or right foot must read correctly on screen and print correctly on that foot, which means true-handed STL export and no net mirror in the slicing chain." **PASS.** The diff, including `34f1cb38`, changes no text-marking, STL, or G-code bytes. A sliced file whose physical foot is not the requested side is not uploaded or attached.

L3. Kendon 2026-10-24: "No other fix, including the belt mirror fix, may change or lose any of his ApexLight settings." **PASS.** No print-profile, material, or ApexLight setting file is in the diff. The material tests still expect `apex_light` on the locked profile `apex-v2-insole-95a`.

L4. Kendon 2026-11-20 11:38 AM MT: "The seams have always been on the bottom it's been a permanent rule since the beginning". **PASS.** No seam code is in the diff.

L5. Kendon standing rule: locked surface quality, seams and layer changes (bottom only); no scope growth; copy Cura's method. **PASS.** `34f1cb38` is a test-fixture swap in one unit test. No surface, seam, or layer-change code.

L6. Kendon 2026-11-24 4:18 PM MT (P0): MCP belt G-code labelled left is physically a right foot. Correct handedness is mandatory. **PASS.** `main_left_request_toe_first` for `side=left` still fails the production with the message that names requested left and a physical right foot, on the sync path, the job-result path, and session `generateSolid`.

L7. Kendon 2026-11-24 4:28 PM MT: "(a) An automated handedness check in the generate/export production pipeline, run on the final sliced G-code. It detects the physical foot (arch/medial side on the bottom layer, relative to print direction) and compares it with the requested side. On a mismatch or an inconclusive result, it fails the production with a clear error instead of delivering or attaching the file. It must work for both print directions. (b) A regression test covering heel-first and toe-first print directions times left and right, which fails if the label and the physical foot disagree." **PASS.** (a) `assertGcodeHandedness` is the same function, still called from `acceptCheckedGcode` and `runSessionGenerateSolid` before upload. The material tests do not stub it. (b) Frozen H4 passed again on this head: toe-first and heel-first, each against left and right.

L8. No merge or deploy without Kendon's explicit go. Draft PR only. **PASS.** #439 is an open draft. This grade PR is a draft. Nothing was merged, deployed, or sent to Railway. #439 was not edited. The PM's `workflow_dispatch` does not deploy from `test-and-deploy`.

L9. Frozen gate files are byte-identical to the PM's (SHA256SUMS); never edit, re-hash or skip a gate. If a gate cannot pass, stop and report why. **PASS.** `sha256sum -c` passed on `34f1cb38`. The frozen test and fixtures have an empty diff against `cbcb4434` and the same blobs as `c365eaf9`. This grade did not edit them.
