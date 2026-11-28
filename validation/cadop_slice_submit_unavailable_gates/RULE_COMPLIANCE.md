# Rule-compliance report — gates grader run 2026-11-24

Each rule quoted verbatim, then **PASS** / **FAIL** with evidence.

## Header constraints

**PUSH:** `new branch cursor/cadop-slice-submit-unavailable-gates-1124 (from BASE) -> ONE draft PR titled "[GATES ONLY - DO NOT MERGE] pair-run VertexSlice submit-unavailable / client-retry gates". Never push to the worker branch or the worker PR #437; never push/merge main, deploy, or touch Railway (never touch vertex-web / vertex-api or #310). Never edit any other open or [GATES ONLY - DO NOT MERGE] PR (including #429, #430, #433, #434, #435, #436, and existing gates PRs). Do not merge.`

**PASS.** Branch `cursor/cadop-slice-submit-unavailable-gates-1124` created from `cc6482be`. Only `validation/cadop_slice_submit_unavailable_gates/**` added. No push to #437 branch, main, or Railway.

**FILES:** `validation/cadop_slice_submit_unavailable_gates/** only (new); read-only everything else`

**PASS.** `git diff --name-only cc6482be..HEAD` is only under `validation/cadop_slice_submit_unavailable_gates/`.

**MUST-MATCH:** (worker geometry/slicer byte-identical constraints)

**PASS (grading).** Grader did not change product code. G5 confirms candidate diff is client/test files only (measured: 3 paths). No STL/G-code byte generation in this run.

**TESTS:** frozen gates + no-op + bad-change proofs

**PASS.** Gates committed; `run-noop-proof.sh` and `run-bad-change-proof.sh` exit 0; `grade-candidate.sh` 9/9 pass on candidate.

**ONE:** `Independently freeze client-retry / concurrent-submit gates, then grade PR #437 against them`

**PASS.** Freeze commit precedes `RESULTS.md` commit; grade on `675b6900`.

**GOAL / OUT-OF-SCOPE / DELIVERABLE / HANDOFF**

**PASS.** Draft gates PR only; no merge/deploy/live pair test.

## Locked rules R1–R7

**R1:** `print surface quality is locked permanently...`

**PASS.** No product edits; candidate G5 scope check only touches submit client files.

**R2:** `seams and layer changes must always be on the bottom...`

**PASS.** No product edits.

**R3:** `slicer and geometry briefs must not grow scope...`

**PASS.** Grader scope limited to validation gates.

**R4:** `Production designs start from the approved SAMPLE_Top stock mesh...`

**PASS.** No mesh/production code touched by grader.

**R5:** `every printed device has the patient name on the bottom...`

**PASS.** `textMarking` untouched.

**R6:** `never print secrets... no PHI... never touch Railway... no push or merge to main... Do not edit any existing [GATES ONLY - DO NOT MERGE] PR...`

**PASS.** No secrets logged; no PHI; no Railway/#310; no main merge; no other gates PRs edited.

**R7:** `do not change worker code. Grade only. Outer surface, seams... may NOT change`

**PASS.** #437/worker code not modified; grade-only via worktree.

## Behavioral MUST-MATCH (five checks)

| Check | PASS/FAIL | Evidence |
|-------|-----------|----------|
| (1) Two concurrent submits accepted + polled | **PASS** | G1: `posted=2`, both job ids polled to gcode |
| (2) Hung POST >20s → bounded retry | **PASS** | G2: `posted=1` at 21s, `posted=2` after 61s simulated |
| (3) 4xx/5xx not retried | **PASS** | G3: 1 POST each for 400/422/500 |
| (4) Missed 202 → poll exactly one job | **PASS** (residual noted) | G4: enqueued=2, polled=1, orphan=1 |
| (5) Diff only listed files | **PASS** | G5: 3 allowlisted paths |

## Worker MUST-MATCH (no geometry/slicer changes)

**PASS (by diff scope).** Measured `git diff --name-only cc6482be..675b6900` = 3 server client/test files; no geometry/slicer/loft paths.