# Grade: PR #423 generate_gcode flush and wait_s

Candidate `6abd727303e5a5a57ebf98a27dcf5e782a14e444` passes the frozen gates. Main `f759bde1e212ae99d475601fc58dd89dd37469c7` fails them.

Gates were committed in `adc2a8f74c796d7a54190f5d8d407797a3cd75a7` before this grade. `validation/mcp_flush_wait_s_gates/FROZEN.sha256` still matches those files. This file and `grade/` are the grade record.

## Official runs

Command (exit 1 on main, exit 0 on the candidate):

```text
node --disable-warning=ExperimentalWarning --import validation/mcp_flush_wait_s_gates/register.mjs validation/mcp_flush_wait_s_gates/run-gates.mjs --tree <detached SHA> --out grade/<name>.json
```

| Gate | Threshold | Main f759bde1 | Candidate 6abd7273 |
| --- | --- | --- | --- |
| G1 pair return, loft not started | response ≤ 5000 ms and loft entries before return = 0 | FAIL, 12000 ms, loft entries 2 | PASS, 0 ms, loft entries 0 |
| G2 both feet together | invoke gap ≤ 5000 ms and enqueue gap ≤ 5000 ms | FAIL, invoke 6005 ms, enqueue 6000 ms | PASS, invoke 0 ms, enqueue 0 ms |
| G3 wait_s cap 300, 0 is one fetch | 300 kept, 301 rejected, omitted and 0 fetch once in ≤ 500 ms, wait_s 5 polls ≥ 2 times in 3500–15000 ms | FAIL, accepts300 false, rejects301 false, retainsZero false | PASS, 300 kept, 301 rejected, fetches 1 and 1, wait_s 5 took 5001 ms and 3 fetches |
| G4 STL / geometry bytes vs f759bde1 | geometry path count 0 and both SAMPLE_Top.glb SHA-256 values match | PASS, geometry 0, product diff 0 | PASS, geometry 0, product diff 7, both hashes `2657b0a4f1a5ef1da8322f45348034ba93ecdb611f7d17c2f828206039e024d1` |
| G5 execute deferral | promise resolves before execute, execute runs on the setImmediate/setTimeout(0) drain, source has the deferral before `.execute(` | FAIL, resolvedBeforeExecute false, source has no setImmediate or setTimeout(0) | PASS, resolvedBeforeExecute true, source kind setImmediate |

Raw reports: `grade/base.json`, `grade/candidate.json`.

Candidate product diff vs f759bde1 (`git diff --name-status f759bde1e212ae99d475601fc58dd89dd37469c7 6abd727303e5a5a57ebf98a27dcf5e782a14e444`):

- `packages/mcp/src/tools/handlers.ts`
- `packages/mcp/src/tools/schemas.ts`
- `packages/mcp/test/production-poll.test.ts`
- `packages/mcp/test/saved-design-gcode.test.ts`
- `packages/mcp/test/tool-schemas.test.ts`
- `vertex/server/src/lib/cad-operator-production.test.ts`
- `vertex/server/src/lib/cad-operator-production.ts`

`git merge-base` of the two SHAs is `f759bde1e212ae99d475601fc58dd89dd37469c7`. Commits above that base are `198bdf44` and `6abd7273`.

`beginCadOperatorProduction` on the candidate schedules `args.execute` inside `setImmediate` and returns the pending id on the same turn (`vertex/server/src/lib/cad-operator-production.ts` lines 1072–1079 at `6abd7273`). `get_production` `wait_s` is `z.number().min(0).max(300).optional()` (`packages/mcp/src/tools/schemas.ts` line 132).

## Proofs committed with the freeze

No-op (`node --disable-warning=ExperimentalWarning prove-noop.mjs`, exit 0): gates fail on detached main. Measured response 12000 ms, loft entries 2, invoke gap 6019 ms, enqueue gap 6000 ms, accepts300 false, resolvedBeforeExecute false. G4 passes because the stock loft bytes match. Record: `proofs/noop.json`.

Bad-change (`node --disable-warning=ExperimentalWarning prove-bad-change.mjs`, exit 0), each applied to a /tmp synthetic tree and then deleted:

| Case | Result |
| --- | --- |
| synthetic good control | all five gates pass (response 1 ms, both gaps 0 ms) |
| missing setImmediate | G1 and G5 fail |
| wait_s cap left at 120 | G3 fails, G1 G2 G4 G5 pass |
| 6000 ms wait before the pair return | G1 fails, G2 and G5 pass |
| sequential for-await enqueue | G2 fails, G1 and G5 pass |
| one flipped byte in `tests/fixtures/SAMPLE_Top.glb` | G4 fails |
| comment appended to `vertex/src/lib/geometry/procedural-wall/ring-seam.ts` | G4 fails |
| setTimeout(0) in place of setImmediate | all five gates pass |

Record: `proofs/bad-change.json`.

## Handoff

- Candidate SHA: `6abd727303e5a5a57ebf98a27dcf5e782a14e444` (draft PR #423). Grade: pass.
- Tests: the frozen runner above. Worker unit tests and full CI were left to CI.
- Residual: the loft stand-in is a 6000 ms synchronous block inside the real `beginCadOperatorProduction` execute hook, and the pair probe is a 6000 ms wait for the other foot to be invoked. This run did not boot a live MCP client or a real multi-minute loft.
- Next step: review PR #423 on its own branch. Leave this gates PR unmerged. This grade does not edit the worker branch.

## Rule-compliance report

### PUSH

> PUSH: new branch cursor/mcp-flush-wait-s-gates-1124 (from BASE) -> ONE draft PR titled "[GATES ONLY - DO NOT MERGE] generate_gcode flush and wait_s gates". Never push to the worker branch or PR #423; never push/merge main, deploy, Railway (never touch vertex-web / vertex-api or #310). Never edit any other [GATES ONLY - DO NOT MERGE] PR. Do not merge.

PASS. Branch `cursor/mcp-flush-wait-s-gates-1124` is from `f759bde1`. `git diff --name-only f759bde1 HEAD -- . ':(exclude)validation/mcp_flush_wait_s_gates'` is empty. No push to `cursor/mcp-parallel-submit-wait-s-1123`, main, Railway, vertex-web, vertex-api, or PR #310. No other gates PR was edited. No merge.

### FILES

> FILES: validation/mcp_flush_wait_s_gates/** only (new); read-only everything else - do not modify product code or the worker's tests or PR #423 - don't explore beyond

PASS. The only files added are under `validation/mcp_flush_wait_s_gates/`. Product paths and PR #423 are unchanged.

### MUST-MATCH

> MUST-MATCH: gates are written and frozen BEFORE grading the candidate and never edited after; each required gate has a no-op proof and a bad-change proof. Worker's MUST-MATCH: no geometry / STL-byte change vs main; generate_gcode with side omitted returns both production_ids within ~5 s (no 75 s timeout) and both feet start within a few seconds of each other; get_production wait_s cap is 300; setImmediate (or equivalent) deferral is present in beginCadOperatorProduction so execute/materialize does not start before the pending response can flush; no outer-surface, seam, layer-change, or surface-quality change.

PASS. Freeze commit `adc2a8f7` contains the gates, `proofs/noop.json`, and `proofs/bad-change.json`. `FROZEN.sha256` matched after the candidate run. Worker checks are G1–G5 in the table above: response 0 ms versus 5000 ms, gaps 0 ms versus 5000 ms, wait_s 300 with a single fetch at 0, setImmediate deferral true, geometry path count 0, stock SHA-256 unchanged.

### TESTS

> TESTS: targeted only; CI is the full run. Frozen gates must encode: (1) generate_gcode with use_saved_design and side omitted returns both production_ids within ~5 s and does not wait for loft (no 75 s timeout class); (2) both feet are enqueued / started within a few seconds of each other (not ~138 s apart); (3) get_production wait_s cap is 300 (0 remains a single fetch); (4) STL bytes unchanged vs main f759bde1 (no geometry files in the product diff, or stock loft SHA-256 matches main); (5) setImmediate (or setTimeout(0)) deferral of execute is present in beginCadOperatorProduction (vertex/server/src/lib/cad-operator-production.ts). No-op proof: these gates FAIL on main (sequential enqueue and/or no flush deferral, wait_s cap 120 or missing, 75 s-class blocking). Bad-change proof: a missing setImmediate deferral, a wait_s cap left at 120, a change that would wait for loft before returning, or an STL/geometry-byte change is rejected. Run frozen gates on BASE then on candidate 6abd7273; write validation/mcp_flush_wait_s_gates/RESULTS.md.

PASS. G1–G5 encode those five checks. No-op and bad-change proofs are in `proofs/`. Official order was BASE then `6abd7273`. This file is the written result. Full CI was not started from this run.

### ONE

> ONE: Independent grade of draft PR #423 @ 6abd7273 (flush pending generate_gcode production_ids before loft, wait_s cap 300, both feet enqueued together). Write and freeze gates first; then grade that exact SHA; never edit the worker's code.

PASS. Graded `6abd727303e5a5a57ebf98a27dcf5e782a14e444` after freeze commit `adc2a8f7`. Worker tree was not edited.

### CAP

> CAP: 0/3

PASS. This run is a single grade. The worker branch received no commits from here.

### R1

> R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.

PASS. Candidate geometry/surface path count is 0 (G4). The seven-file diff has no slicer, seam, or surface-quality path. This branch's product diff is empty.

### R2

> R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).

PASS. Same G4 evidence: no seam, layer-change, or first-layer path in the candidate diff.

### R3

> R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.

PASS. The candidate diff is the flush deferral, parallel saved-design enqueue, and `wait_s` cap. It does not add a mesh or a slicer construction. This grade did not widen that diff.

### R4

> R4 (2026-11-05): Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.

PASS. Both `tests/fixtures/SAMPLE_Top.glb` and `vertex/public/Templates/SAMPLE_Top.glb` SHA-256 values match main: `2657b0a4f1a5ef1da8322f45348034ba93ecdb611f7d17c2f828206039e024d1`.

### R5

> R5 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.

PASS. The candidate diff does not add an engraving path. Gate inputs omit patient names and use design id `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` only.

### R6

> R6 Security: never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes. Do not edit any existing [GATES ONLY - DO NOT MERGE] PR (including #421).

PASS. Proof and grade JSON were searched for `api_key`, `token`, and `bearer`; no matches. Reports use design and production ids. No Railway, vertex-web, vertex-api, PR #310, main push, deploy, or database write. PR #421 was not edited.

### R7

> R7: do not change worker code. Grade only. Outer surface, seams, layer-change placement, and surface quality may NOT change; seams and layer changes stay on the bottom/plantar face.

PASS. Worker SHA `6abd7273` was graded from a detached worktree and removed afterward. Outer-surface, seam, layer-change, and surface-quality paths are absent from the product diff (G4 geometry path count 0).

### Hard prohibition

> you may not change the outer surface, seams, layer-change placement or surface quality; you may not edit PR #423 or product code.

PASS. Confirmed by the empty product diff on this branch and by G4 on `6abd7273`.
