# Export parallel workers — frozen gate results

BASE SHA: `9dd3542900fc6c127a4c5ce205c649071cad8690`

Candidate SHA: `f059edf74b9bed33071a4deb8ad3c9674d289dfd`

Thresholds: vertex delta 0.0 mm, Euler characteristic 2, watertight (0 open edges), worker instances >= 2, peak busy workers >= 2, warm extra posts 0.

## Results

| Gate | Result | Threshold | Measured |
| --- | --- | --- | --- |
| R1 | FAIL | {"all":true} | {"R1-source":false,"T2-main-vs-base-stock-left-main-a":true,"T2-main-vs-base-stock-right-main":true,"T2-main-vs-base-engraved-left-main":true,"T2-main-vs-base-engraved-right-main":true,"T2-worker-vs-base-stock-left-worker":true,"T2-worker-vs-base-stock-right-worker":true,"T2-worker-vs-base-engraved-left-worker":true,"T2-worker-vs-base-engraved-right-worker":true} |
| R2 | PASS | {"all":true} | {"R2-source":true,"T2-main-vs-base-stock-left-main-a":true,"T2-main-vs-base-stock-right-main":true,"T2-main-vs-base-engraved-left-main":true,"T2-main-vs-base-engraved-right-main":true,"T2-worker-vs-base-stock-left-worker":true,"T2-worker-vs-base-stock-right-worker":true,"T2-worker-vs-base-engraved-left-worker":true,"T2-worker-vs-base-engraved-right-worker":true} |
| R3 | FAIL | {"outsideAllowlist":[]} | {"outsideAllowlist":["ci/unit-test-shards.json","tests/mortons-bottom-name.test.ts","vertex/server/src/lib/saved-design-snapshot.ts","vertex/shared/saved-design-snapshot.ts","vertex/src/lib/clinical/saved-design-snapshot.test.ts","vertex/src/lib/geometry/procedural-wall/narrow-heelcup-preloft.test.ts","vertex/src/lib/geometry/text-marking/gates.ts"],"changedFiles":["ci/unit-test-shards.json","tests/mortons-bottom-name.test.ts","vertex/server/src/lib/saved-design-snapshot.ts","vertex/shared/saved… |
| R4 | FAIL | {"all":true} | {"R4-source":false,"R4-candidate-marking":true,"engraved-differs-candidate":true,"T2-main-vs-base-engraved-left-main":true,"T2-main-vs-base-engraved-right-main":true,"T2-worker-vs-base-engraved-left-worker":true,"T2-worker-vs-base-engraved-right-worker":true} |
| R5 | PASS | {"secretHits":[],"railway":[],"database":[]} | {"secretHits":[],"railway":[],"database":[]} |
| R6 | FAIL | {"all":true} | {"R6-source":false,"T2-main-vs-base-stock-left-main-a":true,"T2-main-vs-base-stock-right-main":true,"T2-main-vs-base-engraved-left-main":true,"T2-main-vs-base-engraved-right-main":true,"T2-worker-vs-base-stock-left-worker":true,"T2-worker-vs-base-stock-right-worker":true,"T2-worker-vs-base-engraved-left-worker":true,"T2-worker-vs-base-engraved-right-worker":true} |
| T1 | PASS | {"workerInstances":2,"peakBusyWorkers":2,"sides":["left","right"],"eventLoopTurnedWhileBothBusy":true} | {"workerInstances":2,"peakBusyWorkers":2,"sides":["left","right"],"solidPosts":2,"eventLoopTurnedWhileBothBusy":true,"constructs":2} |
| T2 | PASS | {"all":true} | {"T2-used-stock-left-worker":true,"T2-used-stock-right-worker":true,"T2-used-engraved-left-worker":true,"T2-used-engraved-right-worker":true,"T2-worker-vs-main-stock-left-worker":true,"T2-worker-vs-main-stock-right-worker":true,"T2-worker-vs-main-engraved-left-worker":true,"T2-worker-vs-main-engraved-right-worker":true,"T2-worker-vs-base-stock-left-worker":true,"T2-worker-vs-base-stock-right-worker":true,"T2-worker-vs-base-engraved-left-worker":true,"T2-worker-vs-base-engraved-right-worker":true… |
| T3 | PASS | {"all":true} | {"T3-candidate-left":true,"T3-candidate-right":true,"T3-candidate-warm":true,"T3-worker-warm":true} |
| T4 | FAIL | {"all":true} | {"T4a":true,"T4b":false} |
| T4a | PASS | {"constructed":1,"terminated":true} | {"constructed":1,"terminated":true,"rejectedCancelled":false} |
| T4b | FAIL | {"constructed":1,"terminated":true,"rejectedCancelled":true} | {"exportAbort":{"constructed":1,"terminated":false,"rejectedCancelled":true,"ok":false},"exportUnmount":{"constructed":1,"terminated":true,"rejectedCancelled":true,"ok":true}} |
| T5 | PASS | {"exitCode":0} | {"exitCode":0} |
| MUST-MATCH | PASS | {"all":true} | {"T2":true,"T3":true} |
| ONE | PASS | {"all":true} | {"T1":true,"T2":true} |

## Rule compliance

> PUSH: new branch cursor/export-parallel-workers-gates-1123 (from BASE) -> ONE draft PR "[GATES ONLY - DO NOT MERGE] export-parallel-workers gates". Never push to the worker branch; never push/merge main, deploy, Railway (never touch vertex-web / vertex-api or #310), printers, production orders.

**PUSH: PASS**

Branch cursor/export-parallel-workers-gates-1123 is cut from 9dd3542900fc6c127a4c5ce205c649071cad8690. This grade pushes only that branch and opens one draft PR titled "[GATES ONLY - DO NOT MERGE] export-parallel-workers gates". Worker branch cursor/run-cold-left-and-right-browser-export-solid-builds-in-parallel-web-workers-e7a3, main, Railway, vertex-web, vertex-api, and PR #310 were not pushed.

> FILES: validation/export_parallel_workers_gates/** only (new); read-only everything else - do not modify product code or the worker's tests - don't explore beyond

**FILES: PASS**

git diff --name-only 9dd3542900fc6c127a4c5ce205c649071cad8690 HEAD lists only validation/export_parallel_workers_gates/*. Product code and the worker's tests were not modified. Freeze commit 61a63d5bbe0797b2f9c4c202954f6207297ade96.

> MUST-MATCH: exported Left and Right STL bytes produced via workers are byte-identical (or vertex/triangle-identical within 0.0 mm) to the existing main-thread export path; single-foot export and headless Node export (where Web Workers are unavailable) continue working unchanged. Also verify byte-identical STL / geometry output vs current main on stock SAMPLE_Top and on engraved patient-name designs (no geometry or surface-quality regression).

**MUST-MATCH: PASS**

worker bytes match main and BASE; headless and single-foot still work

> TESTS: run the frozen gates on BASE and on the candidate SHA; results table in validation/export_parallel_workers_gates/RESULTS.md. Gates derive from the worker's TESTS line: (1) on a 2-foot cold browser export, Left and Right solid builds dispatch to independent worker instances (or worker pool of size >=2) so they execute concurrently rather than blocking the main thread sequentially; (2) worker-produced solid for Left and Right matches the main-thread solid and current main (same triangle count, watertight/Euler checks, and vertex positions) on stock SAMPLE_Top and engraved patient-name designs; (3) graceful fallback to main thread in Node/headless environments where Worker is undefined; (4) worker cancellation/cleanup on abort or unmount; existing tests green

**TESTS: PASS**

proofs.mjs: 35/35 ok (no-op and bad-change). BASE live worker-builds 0, then grade --expect base-regression exit 0 (T1, T2, T4b fail as expected; R1-R6, T3, T4a, T5 pass). Candidate live on /tmp/orthocad-pr412 at f059edf74b9bed33071a4deb8ad3c9674d289dfd worker-builds 1: dispatch 0, cancel 0, geometry 0, existing tests 0. Grade written to /tmp/gate-out/grade.json.

> ONE: Independent grade of worker PR #412. Worker ONE line: Run cold Left and Right browser export solid builds off the main thread in parallel workers so a 2-foot export does not serialize ~2x CPU work on the single UI thread.

**ONE: PASS**

cold Left and Right run together off the main thread and match main

> R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.

**R1: FAIL**

surface and dorsal band identical to BASE

> R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).

**R2: PASS**

seams stay off the diff and the sole band matches BASE

> R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.

**R3: FAIL**

diff stays on the cold-export worker surface

> R4 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.

**R4: FAIL**

bottom engrave unchanged versus BASE

> R5 Security: never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI; never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes.

**R5: PASS**

no secrets, Railway, or database writes in the diff

> R6: zero change to geometry, walls, outer surface, or text engraving; only parallel worker execution of the existing build. Do not modify manufacturingSolidFingerprint or Print cache invalidation (a separate agent owns that).

**R6: FAIL**

geometry, walls, engraving, and fingerprint unchanged

## Geometry parts

| Part | Result | maxDeltaMm | triangles | bytesEqual |
| --- | --- | --- | --- | --- |
| T2-determinism | PASS | 0 | 110308/110308 | true |
| BASE-manifold-stock-left-main-a | PASS | 0 | 110308/110308 | true |
| BASE-manifold-stock-left-main-b | PASS | 0 | 110308/110308 | true |
| BASE-manifold-stock-right-main | PASS | 0 | 111116/111116 | true |
| BASE-manifold-engraved-left-main | PASS | 0 | 147220/147220 | true |
| BASE-manifold-engraved-right-main | PASS | 0 | 148776/148776 | true |
| T3-left | PASS |  | / |  |
| T3-right | PASS |  | / |  |
| T3-warm | PASS |  | / |  |
| R4-marking | PASS |  | / |  |
| engraved-differs | PASS |  | / |  |
| T2-main-vs-base-stock-left-main-a | PASS | 0 | 110308/110308 | true |
| T2-main-vs-base-stock-right-main | PASS | 0 | 111116/111116 | true |
| T2-main-vs-base-engraved-left-main | PASS | 0 | 147220/147220 | true |
| T2-main-vs-base-engraved-right-main | PASS | 0 | 148776/148776 | true |
| T3-candidate-left | PASS |  | / |  |
| T3-candidate-right | PASS |  | / |  |
| T3-candidate-warm | PASS |  | / |  |
| R4-candidate-marking | PASS |  | / |  |
| engraved-differs-candidate | PASS |  | / |  |
| T2-used-stock-left-worker | PASS |  | / |  |
| T2-worker-vs-main-stock-left-worker | PASS | 0 | 110308/110308 | true |
| T2-worker-vs-base-stock-left-worker | PASS | 0 | 110308/110308 | true |
| T2-used-stock-right-worker | PASS |  | / |  |
| T2-worker-vs-main-stock-right-worker | PASS | 0 | 111116/111116 | true |
| T2-worker-vs-base-stock-right-worker | PASS | 0 | 111116/111116 | true |
| T2-used-engraved-left-worker | PASS |  | / |  |
| T2-worker-vs-main-engraved-left-worker | PASS | 0 | 147220/147220 | true |
| T2-worker-vs-base-engraved-left-worker | PASS | 0 | 147220/147220 | true |
| T2-used-engraved-right-worker | PASS |  | / |  |
| T2-worker-vs-main-engraved-right-worker | PASS | 0 | 148776/148776 | true |
| T2-worker-vs-base-engraved-right-worker | PASS | 0 | 148776/148776 | true |
| T3-worker-warm | PASS |  | / |  |

## Checker proofs

No-op and bad-change proofs: **PASS** (35 checks, 0 unexpected).

## Hard prohibition

This grade did not change the outer surface, seams, layer-change placement, or surface quality. The only files added are under validation/export_parallel_workers_gates/.

## How the source FAILs were measured

The frozen source gate runs `git diff 9dd3542900fc6c127a4c5ce205c649071cad8690 f059edf74b9bed33071a4deb8ad3c9674d289dfd`. Those two trees diverged. Their merge-base is `268aac85847160b5b2703a05688721ea4cb93b24`. Current main contains three commits the worker head does not:

- `a4c2c2d7` fix(mcp): honor explicit zero and omitted lateral flange mm (#394)
- `f435d670` fix(text): keep the bottom name on a Morton's foot (#397)
- `9dd35429` Fix pre-loft skew on a short Narrow insole (#398)

`git diff --name-only 268aac85847160b5b2703a05688721ea4cb93b24 f059edf74b9bed33071a4deb8ad3c9674d289dfd` is the worker commit `f059edf7` and lists only the nine allowlisted files. In that commit, `sample-top-preview.ts` changes by one token: `async function applyExportText` becomes `export async function applyExportText`.

The frozen checker still records R1, R3, R4, and R6 as FAIL. The two-dot diff against current main includes #397 and #398, so `sampleTopBodyIdentical` is false (main added 56 lines to `sample-top-preview.ts` after the branch point) and `vertex/src/lib/geometry/text-marking/gates.ts` is outside the allowlist. Every geometry row is PASS: maxDeltaMm 0, bytesEqual true, same triangle counts, watertight, Euler 2.

Byte-identical sha256 (BASE main-thread, candidate main-thread, and candidate worker):

| Design | Triangles | sha256 |
| --- | --- | --- |
| stock left | 110308 | `ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f` |
| stock right | 111116 | `9f865d8b380ad715a2ec10b208c2c5c74885737aaaa7ed7858c6334bd4f187c6` |
| engraved left | 147220 | `0c8687c40fbafd181f0e3391b3d749df277b59380f6408f17d6ed8dc2cd586f8` |
| engraved right | 148776 | `550eae065d94affc90c107da1d9210f90900df41c6db1c884e967a4e5b5092d7` |

Engraved builds report `textSurface: bottom` and `textMode: engrave`. Cold worker posts: stock left 1 (1 construct), stock right 1 (0 new constructs; the pool worker was reused), engraved left 1, engraved right 1. Warm stock left after a worker build: 0 posts, 1710 ms, same sha256.

## T4b abort sample

`exportAbort.terminated` is false because `cancel.gate.ts` reads `worker.terminated` in the same turn it sets the abort flag. The product polls `shouldAbort` every 32 ms, then calls `terminateExportSolidWorkers` and rejects with `Print solid cancelled`. The abort promise did reject (`rejectedCancelled: true`). Unmount calls `terminateProceduralWallWorker` synchronously before the sample, and that row is `terminated: true`, `rejectedCancelled: true`. The frozen threshold requires `terminated === true` on both rows, so T4b and T4 FAIL.

## Engraved module path

The first candidate geometry pass failed the engraved cases with `Cannot find module 'manifold-3d/manifold.wasm'` from the worktree copy of `text-marking/boolean.ts`. The worktree had no `node_modules`. Linking the main checkout's `node_modules` and re-running the same frozen geometry gate produced the hashes above. Gate source was left at freeze commit `61a63d5bbe0797b2f9c4c202954f6207297ade96`.

## Handoff

- Freeze SHA: `61a63d5bbe0797b2f9c4c202954f6207297ade96` on `cursor/export-parallel-workers-gates-1123`.
- BASE: `9dd3542900fc6c127a4c5ce205c649071cad8690`. Candidate: `f059edf74b9bed33071a4deb8ad3c9674d289dfd`.
- Residuals: R1, R3, R4, R6 fail the frozen two-dot source diff because the worker head does not contain #394, #397, and #398. T4 and T4b fail because abort termination is sampled before the 32 ms poll. Geometry, T1, T2, T3, T5, MUST-MATCH, and ONE pass.
- Next step: leave this gates PR unmerged. Rebase worker PR #412 onto `9dd35429` before merge so the PR diff is the worker commit. A later grade can re-sample abort termination after the rejection; these frozen gates stay as committed.

## Round 2 — #412 @ 268d6b74 vs main @ c0933946

**Overall: PASS.**

Frozen gates were not edited (`61a63d5bbe0797b2f9c4c202954f6207297ade96`, results commit `6ed3713c1595565d2ca47b6c52079152a612cf83`). Re-run command, from that tree:

```bash
node validation/export_parallel_workers_gates/run-gates.mjs live --label base --product /tmp/orthocad-base-c093 --sha c0933946a9b6c93020cc87f66a68d9120aca6b5d --base-sha c0933946a9b6c93020cc87f66a68d9120aca6b5d --out /tmp/gate-out/r2-base --worker-builds 0
node validation/export_parallel_workers_gates/run-gates.mjs live --label candidate --product /tmp/orthocad-pr412-r2 --sha 268d6b7452f97ff2a9c4dc095be4592a8d920f7c --base-sha c0933946a9b6c93020cc87f66a68d9120aca6b5d --out /tmp/gate-out/r2-candidate --worker-builds 1
node validation/export_parallel_workers_gates/run-gates.mjs grade --base-out /tmp/gate-out/r2-base --candidate-out /tmp/gate-out/r2-candidate --grade /tmp/gate-out/r2-grade.json
```

BASE live exit 0. Candidate live exit 0 (dispatch 0, cancel 0, geometry 0, existing tests 0). Grade: every rule true.

| Gate | Result | Measured vs threshold |
| --- | --- | --- |
| T1 | PASS | instances 2, peak busy 2, sides left+right, event loop turned, solid posts 2 (threshold: all of those) |
| T2 | PASS | worker vs main-thread and vs BASE: maxDeltaMm 0, bytesEqual, triangles 110308 / 111116 / 147220 / 148776 |
| T3 | PASS | headless left, headless right, main-thread warm, worker warm (extra posts 0) |
| T4 | PASS | T4a and T4b |
| T4a | PASS | constructed 1, terminated true |
| T4b | PASS | abort constructed 1, terminated true, rejectedCancelled true; unmount the same |
| T5 | PASS | existing tests exit 0 |
| MUST-MATCH | PASS | T2 and T3 |
| ONE | PASS | T1 and T2 |
| R1 | PASS | source row and all four main-vs-base and worker-vs-base STL rows |
| R2 | PASS | seam denylist empty; sole band matches |
| R3 | PASS | outsideAllowlist [] |
| R4 | PASS | text denylist empty; engraved surface bottom, mode engrave; engraved sha differs from stock |
| R5 | PASS | secretHits [], railway [], database [] |
| R6 | PASS | fingerprint and surface denylist empty; sample-top body identical after the export-keyword normalize; STL delta 0.0 mm |

`git diff --name-only c0933946 268d6b74` is the nine allowlisted files. Merge-base is `c0933946` (the candidate contains current main). `sample-top-preview.ts` changes by one token: `export async function applyExportText`.

Byte-identical sha256 (this main's main thread, the candidate main thread, and the candidate worker):

| Design | Triangles | sha256 |
| --- | --- | --- |
| stock left | 110308 | `ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f` |
| stock right | 111116 | `9f865d8b380ad715a2ec10b208c2c5c74885737aaaa7ed7858c6334bd4f187c6` |
| engraved left | 147220 | `0c8687c40fbafd181f0e3391b3d749df277b59380f6408f17d6ed8dc2cd586f8` |
| engraved right | 148776 | `550eae065d94affc90c107da1d9210f90900df41c6db1c884e967a4e5b5092d7` |

These are the same fixture hashes as round 1. Current main includes the heel-lift loft. The frozen fixture builds stock SAMPLE_Top and the engraved name on that loft, and the worker bytes match that main-thread build.

Warm cache: `manufacturing-solid-cache.ts` blob `e70cf87ac8ac8cd400febb1f8cc04101d1c83fc0` and `manufacturing-solid-context.ts` blob `57a57f9db6b00bd2c9088b9ef1574f123cc1d520` are identical on both SHAs. `buildProceduralExportSolidOffThread` calls `manufacturingSolidFingerprint(options, cache)`, which is `sha256(manufacturingSolidIdentity(...))`. That identity includes `savedDesignIdentity` (the full saved design plus versions). The worker does not pass a shorter field list. Stock-left warm after a worker build: 0 posts, same sha256. The candidate's existing test `t2699u: any saved-design field misses the manufacturing solid` passed.

#412 CI on `268d6b74`: unit-tests (1)–(6) success, isolated-postgres-acceptance success, `test-and-deploy` success (run 45662880908). default-procedural-smoke skipped. `plantar-name` was still on "Slice both feet in both print directions" when this section was written.

## Round 2 rule compliance

> PUSH: same gates branch cursor/export-parallel-workers-gates-1123 / PR #418 only: append a new RESULTS section for this round. Never push to the worker branch, never merge/deploy, never touch main, Railway, #310, #449-#452, orders.

**PASS.** This section is the only product of the re-grade. `origin/main` stays `c0933946`. The worker branch was not pushed.

> FILES: validation/export_parallel_workers_gates/** only; read-only elsewhere - don't explore beyond

**PASS.** Gate source stays at the freeze. The diff for this round is `RESULTS.md`.

> MUST-MATCH: gates frozen at 61a63d5b / 6ed3713c are NOT edited. Re-run them unchanged with BASE=c0933946 and candidate=268d6b74. Worker solids (stock + engraved name, L and R) byte-identical to current main's main-thread build, including heel lift. Warm-cache reuse must key on main's full manufacturingSolidFingerprint/identity, never a partial field list (Kendon t2699u) — verify by hand.

**PASS.** Hashes above. Fingerprint blobs identical. Warm posts 0.

> TESTS: all frozen gates T1-T5, MUST-MATCH, ONE, R1-R6 on candidate; two-dot diff vs c0933946 must touch only the #412 allowlist; #412 CI green.

**PASS** on the frozen gates and the allowlist (nine files, outsideAllowlist []). `test-and-deploy` is success. `plantar-name` was still slicing when this section was written.

> ONE: Overall PASS/FAIL for #412 @ 268d6b74 vs frozen gates, table in PR #418 body and RESULTS.md.

**PASS.**

> R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.

**PASS.** STL delta 0.0 mm. Surface denylist empty.

> R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).

**PASS.** Seam denylist empty. Sole band matches.

> R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.

**PASS.** Two-dot diff is the nine allowlisted files.

> R4 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.

**PASS.** Engraved solids match this main. Surface bottom, mode engrave. Text-marking tree is unchanged.

> R5 Security: never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI; never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes.

**PASS.** secretHits [], railway [], database [].

> R6: zero change to geometry, walls, outer surface, or text engraving; only parallel worker execution of the existing build. Do not modify manufacturingSolidFingerprint or Print cache invalidation (a separate agent owns that).

**PASS.** Fingerprint files are byte-identical to main. STL delta 0.0 mm.

This re-grade did not change the outer surface, seams, layer-change placement, or surface quality.

## Round 2 handoff

- Gates still frozen at `61a63d5b` / `6ed3713c`. This round only appends this section.
- BASE `c0933946a9b6c93020cc87f66a68d9120aca6b5d`. Candidate `268d6b7452f97ff2a9c4dc095be4592a8d920f7c`.
- Residuals: none on the frozen gates. #412 `plantar-name` was still slicing when this section was written. `test-and-deploy` succeeded.
- Next step: leave PR #418 unmerged. #412 is a draft; merging it is Kendon's call.
