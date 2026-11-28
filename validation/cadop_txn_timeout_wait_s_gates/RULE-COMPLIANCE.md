# Rule-compliance report

Candidate `9e724699a10463ee123b0425cc44966d14afa68d` (draft PR #428). Gates frozen at `7e64021980c0a97dcd2520a2abc68873f711a204` before this grade. Gate commands and measurements are in `RESULTS.md`.

## Locked rules, graded on the candidate

### R1

> print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.

PASS. The candidate diff is the seven files in PR #428 (Prisma `updateIf`, MCP schema/bundle/hash, and those tests). Gate C: 225 geometry, kiri, and cnc sources unchanged versus BASE, and the fixed-fixture STL and G-code hashes match BASE.

### R2

> seams and layer changes must always be on the bottom (plantar/belt face).

PASS. Same diff and the same Gate C measurement. No slicer or seam-placement file changed.

### R3

> slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.

PASS. The product diff stays on the interactive-transaction timeout and `wait_s` advertisement. Compare-and-swap replaces the interactive `$transaction`. No new mesh or slicer construction. Gate C source set is unchanged.

### R4

> Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.

PASS. No stock mesh, element, or sink file is in the candidate diff. Gate C STL bytes match BASE.

### R5

> every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.

PASS. `textMarking` and engraving are not in the candidate diff.

### R6

> never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes. Do not edit any existing [GATES ONLY - DO NOT MERGE] PR (including #421, #424, #425, #426, #427).

PASS for the candidate diff: it does not print secrets, does not add patient names, and does not touch Railway, vertex-web, vertex-api, PR #310, or those gates PRs. This grader also filtered proof and grade logs with that grep, used only design and production ids, and did not push or merge `main`, deploy, write a database, or edit those PRs.

### R7

> do not change worker code. Grade only. Outer surface, seams, layer-change placement, and surface quality may NOT change; seams and layer changes stay on the bottom/plantar face.

PASS. This run did not edit the worker branch, the worker PR, or product code. `git status` on the gates branch shows only `validation/cadop_txn_timeout_wait_s_gates/`. Gate C is the surface/seam/layer evidence: those sources and the fixture STL and G-code bytes match BASE.

## Worker MUST-MATCH, TESTS, and ONE

### Worker's MUST-MATCH

> no geometry, slicer, G-code content, loft algorithm, or surface changes; generated STLs and G-code for the same input stay byte-identical to BASE; no S1-PRELOFT cap change; no outer-surface, seam, layer-change placement, or surface-quality change. A two-foot concurrent run with production updates taking more than 5 s does not hit a Prisma interactive-transaction timeout. get_production with wait_s blocks until a terminal state or the timeout, up to 300 (omitted/0 remains a single fetch). CI is green.

FAIL. The behavior clauses pass and CI does not.

- Geometry, slicer, G-code, loft, surface, seams, layer changes: Gate C, 225 files unchanged. Fixture STL `3d4f6262669cc8329a338d7cae4fc34e8811bbe8d28fc79a86a205fef6d5159d` (284 bytes) and G-code `e12356a66777e9e0b9815d500168606d2f64eabedb5184ebf0f77d633e96d848` (16120 bytes) match BASE.
- S1-PRELOFT 0.5× inset cap: `SKEW_INSET_RATIO` is `0.5` in both station files.
- Pair run: both feet `succeeded`, loft 6000/6000 ms, interactive transactions 0, max elapsed 0 ms (threshold 5000 ms), `open_during_loft=false`. No `Manufacturing timed out`.
- `wait_s`: omitted and 0 are one fetch; `wait_s` 30 returned `succeeded` after 2 fetches and 2001 ms; `wait_s` 1 stayed `running` after 1002 ms; schema cap 300.
- CI: `unit-tests (3)=failure` and `test-and-deploy=failure` on run `45452781982`. Threshold is no failing checks.

### Worker behavior covered by TESTS (a)–(d)

> (a) a two-foot concurrent run whose production updates take more than 5 s does not hit a Prisma interactive-transaction timeout or surface "Manufacturing timed out (right)" (or left) from that cause — simulate with a slow loft stub, do not change real loft/slice

PASS. Gate A, measurements above. The loft stub is inside the gate. The real loft and slicer were not modified or called.

> (b) get_production with wait_s > 0 blocks or long-polls until succeeded/failed or the deadline, cap 300, and wait_s is present in the advertised tool schema so clients can pass it (omitted/0 is a single fetch)

PASS. Gate B, measurements above.

> (c) G-code and STL bytes are identical to main 8aced4b5 (or the recorded BASE) for a fixed fixture

PASS. Gate C, hashes above.

> (d) CI is green

FAIL. Gate D. `unit-tests (3)` is `failure` (3 tests, `updateMany is not a function` in `trpc-cad-operator.test.ts`). `test-and-deploy` is `failure` on `Require unit shards and isolated PostgreSQL acceptance`. 7 success, 1 skipped, 0 pending.

### ONE

> Fix the parallel pair-run Prisma transaction timeout and make get_production honor wait_s up to 300, without changing geometry, slicer, or G-code bytes.

FAIL as a finished fix. The timeout and `wait_s` behavior match the gates, and geometry, slicer, and G-code bytes match BASE, but CI is not green, so the change is not done.

## Grader header lines

### PUSH

> new branch cursor/cadop-txn-timeout-wait-s-gates-1124 (from BASE) -> ONE draft PR titled "[GATES ONLY - DO NOT MERGE] pair-run transaction timeout and wait_s gates". Never push to the worker branch or the worker PR; never push/merge main, deploy, Railway (never touch vertex-web / vertex-api or #310). Never edit any other [GATES ONLY - DO NOT MERGE] PR (including #421, #424, #425, #426, #427). Do not merge.

PASS with a note. `cursor/cadop-txn-timeout-wait-s-gates-1124` is pushed from `8aced4b5042bdafc2d300006fa80802bca1b94b9`. This run's PR tool can only open a draft from its platform branch, so that branch is the same SHA. One draft: https://github.com/kdho77/OrthoCAD-/pull/429. No push to the worker branch `cursor/fix-pair-run-prisma-transaction-timeout-and-honor-get-production-wait-s-up-to-300-85b5`, no push or merge of `main`, no deploy, no Railway, and no edits to PRs #310, #421, #424, #425, #426, or #427. Not merged.

### FILES

> validation/cadop_txn_timeout_wait_s_gates/** only (new); read-only everything else - do not modify product code or the worker's tests or the worker PR - don't explore beyond

PASS. `git diff --stat 8aced4b5042bdafc2d300006fa80802bca1b94b9` is only that directory.

### MUST-MATCH

> gates are written and frozen BEFORE grading the candidate and never edited after; each required gate has a no-op proof and a bad-change proof.

PASS. Freeze commit `7e64021980c0a97dcd2520a2abc68873f711a204` contains the gate scripts, `base-byte-manifest.json`, `proofs/noop-base.txt`, and `proofs/bad-change.txt`. The grade commit adds only `RESULTS.md` and this file. The gate scripts were not edited after that freeze.

### TESTS

> targeted only; CI is the full run.

PASS for this grader. The local commands were the four frozen gates. CI was read from GitHub Actions run `45452781982` on the candidate SHA. The full unit suite was not re-run locally.

### ONE

> Independent grade of draft PR #428 @ 9e724699a10463ee123b0425cc44966d14afa68d (pair-run Prisma transaction timeout fix and get_production wait_s). Write and freeze gates first; then grade that exact SHA; never edit the worker's code.

PASS. The worktree `HEAD` was `9e724699a10463ee123b0425cc44966d14afa68d`. Gates were frozen first. Worker code was not edited.

### GOAL

> Freeze independent gates, then PASS/FAIL the worker SHA against the four gates, with measured values. Do not merge or deploy.

PASS. The verdict is FAIL, with the measurements in `RESULTS.md`. No merge and no deploy.

### OUT-OF-SCOPE

> editing worker code or product code; merge; deploy; Railway; the live pair timing rerun; PRs #402/#424/#427 and other existing gates PRs; geometry/slicer/S1-PRELOFT changes.

PASS. None of those were done. `SKEW_INSET_RATIO` remains `0.5`.

### DELIVERABLE

> one draft [GATES ONLY - DO NOT MERGE] PR with frozen gates, no-op proof, bad-change proof, RESULTS.md, a rule-compliance report, and a handoff note.

PASS. Draft PR https://github.com/kdho77/OrthoCAD-/pull/429. It contains the frozen gates, both proofs, `RESULTS.md`, and this report. The handoff comment is on that PR.

### HANDOFF

> handoff note on the gates PR with candidate SHA, per-gate PASS/FAIL and measured values, residuals, next step (wait for Kendon's merge-and-deploy go; no merge, no deploy, no timing rerun from this agent).

PASS. The handoff comment is on https://github.com/kdho77/OrthoCAD-/pull/429. This agent does not merge, deploy, or rerun the live pair timing test.

### CAP

> 0/3

PASS. One grade. The gates were not rewritten to chase the candidate, and this agent did not start a correction.
