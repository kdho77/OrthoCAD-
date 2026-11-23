# Flange lateral-zero grade

Independent grade of worker draft PR #394. Gates were frozen at `934fc49b602f1b31db7d66b9964d6f015675d2c7` and were not edited after that commit. This file is the run record.

- BASE: `268aac85847160b5b2703a05688721ea4cb93b24`
- Candidate: `bb5235d9f2f51f6fdb2a9553e3e0d112db8d7d4a` (PR #394 head)
- Worker paths: `vertex/shared/saved-design-snapshot.ts`, `vertex/server/src/lib/saved-design-snapshot.ts`, `vertex/src/lib/clinical/saved-design-snapshot.test.ts`

**Candidate grade: PASS.** Explicit `lateral_mm: 0` and an omitted `lateral_mm` both read back left medial 3 mm and left lateral 0 mm, with nothing on the right, including a persist over a stored left lateral of 3 mm. Slider and bilateral flange behavior, unaffected SAMPLE_Top output, and rules R1–R7 meet the frozen thresholds.

## Proofs of the gates

| Proof | Command | Result |
| --- | --- | --- |
| No-op on BASE | `node validation/flange_lateral_zero_gates/prove.mjs noop` | Defect gates FAIL. Every other gate PASS. |
| Known-good copy | `node validation/flange_lateral_zero_gates/prove.mjs known-good` | Defect gates, must-match, existing tests, and R1–R7 PASS. |
| Bad-change copy | `node validation/flange_lateral_zero_gates/prove.mjs bad` | Each targeted gate FAIL. |

The known-good and bad copies were `/tmp` worktrees. They were not committed.

On unmodified BASE, fresh `flange.left {medial_mm:3, lateral_mm:0}` already reads lateral 0. Persist of that request over a stored left lateral of 3 mm reads lateral 3. Fresh and persist of `flange.left {medial_mm:3}` both read lateral 3. That is why `G_ONE_EXPLICIT` and `G_TESTS_OMITTED` fail on BASE.

## Candidate vs BASE

Command:

```bash
node validation/flange_lateral_zero_gates/run-gates.mjs \
  --subject /tmp/flz-candidate \
  --baseline-json /tmp/flz-probe-flz-base.json \
  --expect-head bb5235d9f2f51f6fdb2a9553e3e0d112db8d7d4a \
  --out /tmp/flz-proofs/candidate.json
```

| Gate | Threshold | BASE measured | BASE | Candidate measured | Candidate |
| --- | --- | --- | --- | --- | --- |
| G_ONE_EXPLICIT | L medial 3, L lateral 0 or absent, R 0 or absent, fresh and persist | fresh L 3/0 R 0/0; persist L 3/3 R 0/0 | FAIL | fresh L 3/0 R 0/0; persist L 3/0 R 0/0 | PASS |
| G_TESTS_OMITTED | omitted lateral is 0 or absent, not 3; nothing on R; fresh and persist | fresh L 3/3 R 0/0; persist L 3/3 R 0/0 | FAIL | fresh L 3/0 R 0/0; persist L 3/0 R 0/0 | PASS |
| G_ONE | both defect gates | explicit FAIL; omitted FAIL | FAIL | explicit PASS; omitted PASS | PASS |
| G_MUST_SLIDERS | slider left 3/0, right 0/0, fresh and persist | fresh L 3/0; persist L 3/0 | PASS | fresh L 3/0; persist L 3/0 | PASS |
| G_MUST_BILATERAL | 5 level/bilateral cases match the frozen millimeters | 5 cases match | PASS | 5 cases match | PASS |
| G_TESTS_EXISTING | exit 0 on the two snapshot test files | exit 0 | PASS | exit 0 | PASS |
| G_R1_SURFACE | 0 of 8 surface files differ from BASE | 0 differ | PASS | 0 differ | PASS |
| G_R2_SEAMS | 0 of 4 seam/slicer/engrave files differ from BASE | 0 differ | PASS | 0 differ | PASS |
| G_R3_SCOPE | changed paths stay on the flange snapshot allowlist | 0 paths differ | PASS | 3 paths, 0 outside allowlist | PASS |
| G_R4_SAMPLE_TOP | asset `sample-top`, bundled glb, right base mirrored, mesh bytes match | asset sample-top, mirrored true, 0 mesh files differ | PASS | same | PASS |
| G_R5_TEXT_MARKING | surface bottom, mode engrave, engraving files match BASE | bottom / engrave, 0 files differ | PASS | bottom / engrave, 0 files differ | PASS |
| G_R6_SECURITY | 0 forbidden paths, 0 secret or patient-name assignments | 0 and 0 | PASS | 0 and 0 | PASS |
| G_R7_UNAFFECTED | 0 unaffected catalogs differ, including empty SAMPLE_Top | 0 differ; empty sha `7bc0f45ecfa3` | PASS | 0 differ; empty sha `7bc0f45ecfa3` | PASS |
| G_HEAD | tree SHA is the pinned SHA for that run | `268aac85847160b5b2703a05688721ea4cb93b24` | PASS | `bb5235d9f2f51f6fdb2a9553e3e0d112db8d7d4a` | PASS |

Empty SAMPLE_Top with no corrections is the same sha256 on BASE and on the candidate: `7bc0f45ecfa3`.

## Rule-compliance report

### Header lines

PUSH (grader): new branch `cursor/flange-lateral-zero-gates-1123` from BASE, draft PR only. Worker branch was not pushed. **PASS.** Candidate HEAD is the PR #394 SHA above. This grader did not push `main`.

FILES: `validation/flange_lateral_zero_gates/**` only. **PASS.** `git status` before the results commit showed no product diff. The candidate diff is the three snapshot files named above.

MUST-MATCH: `sliders_by_side` flange path and bilateral flange requests unchanged. **PASS.** `G_MUST_SLIDERS` and `G_MUST_BILATERAL`. Slider persist over stored lateral 3 mm stayed L 3/0, R 0/0. Five bilateral and level cases matched, including empty-side 3/3, mild 2/2, high 6/6, and level high plus medial 3 mm keeping lateral 6 mm.

TESTS: `flange.left {medial_mm:3, lateral_mm:0}` reads back medial 3 and lateral 0 (or absent) on L, nothing on R; omitted `lateral_mm` on a medial-only request does not create a 3 mm lateral flange; existing tests green. **PASS.** `G_ONE_EXPLICIT`, `G_TESTS_OMITTED`, `G_TESTS_EXISTING` (exit 0).

ONE: Make an explicit `lateral_mm` 0 (and an omitted `lateral_mm`) not produce a default 3 mm lateral flange. **PASS.** `G_ONE`. Both fresh and persist read L medial 3, L lateral 0, R medial 0, R lateral 0. Threshold was lateral not equal to 3, and 0 or absent.

CAP: 0/3. **PASS** as a grader constraint. Product files changed by this branch: 0.

### Locked rules

R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality. **PASS.** `G_R1_SURFACE`: 0 of 8 surface files differ from BASE. This grader did not edit those files.

R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face). **PASS.** `G_R2_SEAMS`: 0 of 4 seam, slicer, and bottom-engrave files differ from BASE. This grader did not move seams or layer changes.

R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions. **PASS.** `G_R3_SCOPE`: the candidate diff is 3 allowlisted snapshot files and 0 slicer or geometry paths.

R4 (2026-11-05): Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh. **PASS.** `G_R4_SAMPLE_TOP`: asset `sample-top`, glb `Templates/SAMPLE_Top.glb`, url `/Templates/SAMPLE_Top.glb`, right base mirrored, both SAMPLE_Top glb files byte-identical to BASE.

R5 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system. **PASS.** `G_R5_TEXT_MARKING`: empty snapshot textMarking is surface `bottom`, mode `engrave`, addPatientName true, bold true. Engraving files match BASE. New engraving paths: 0.

R6 Security: never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy. **PASS.** `G_R6_SECURITY`: 0 forbidden paths and 0 secret or patient-name assignments in added lines. This grader did not push `main`, did not deploy, and did not touch Railway, vertex-web, vertex-api, or PR #310. The candidate check `test-and-deploy` is the existing branch-protection aggregator in `.github/workflows/main.yml` (unit shards, isolated Postgres, MCP build). It is not a Railway deploy. Its conclusion on this SHA was success. `default-procedural-smoke` was skipped.

R7: designs and exports not affected by your defect must produce identical output to current main (prove with a before/after comparison on at least the SAMPLE_Top stock design with no corrections). **PASS.** `G_R7_UNAFFECTED`: 0 of 11 catalogs differ. Empty SAMPLE_Top sha256 prefix `7bc0f45ecfa3` on both trees. The set includes arch, flexible foot, thickness 3.5 mm, a non-flange heel slider, the slider flange path, explicit bilateral millimeters, an empty flange side, mild level, level-plus-medial, and a Met Pad.

## Handoff

- Freeze SHA: `934fc49b602f1b31db7d66b9964d6f015675d2c7`
- Candidate SHA: `bb5235d9f2f51f6fdb2a9553e3e0d112db8d7d4a`
- Tests: frozen gates on BASE, on the known-good copy, on the bad copies, and on the candidate. Existing snapshot tests exited 0 on BASE and on the candidate.
- Residuals: none against the frozen thresholds. BASE already returned lateral 0 for a fresh explicit zero; the BASE miss is persist restoring stored lateral 3, and any medial-only omit writing lateral 3. The candidate clears both.
- Next step: review worker PR #394. Do not merge this gates branch.

This grader did not change the outer surface, seam placement, layer-change placement, or surface quality.
