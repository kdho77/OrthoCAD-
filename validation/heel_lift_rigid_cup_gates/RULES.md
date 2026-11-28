# Rule compliance

Evidence is from the frozen gates at `0e753f88ce2b71d41ab7568ce600d2d8dcedf75b` on BASE `df78a4f1a6a657c4e72e15c14c797ad2f492669a`. Commands: `node validation/heel_lift_rigid_cup_gates/prove-noop.mjs` (exit 0) and `node validation/heel_lift_rigid_cup_gates/prove-bad-change.mjs` (exit 0). Worker branch `cursor/heel-lift-rigid-cup-1124` was not on origin (`git ls-remote --heads origin cursor/heel-lift-rigid-cup-1124` printed no line).

## Headers

### MODEL

> MODEL: grok-4.7 (fast=false, context=256k) — reason: OrthoCAD mesh geometry; independent grader writes and freezes rigid heel-lift cup-depth gates first, then grades the worker

PASS. Gates were written and frozen before any candidate grade. The worker branch did not exist, so the grade is "gates frozen, worker not yet up".

### REPO

> REPO: kdho77/OrthoCAD-

PASS. Work is in that repository. Draft PR: https://github.com/kdho77/OrthoCAD-/pull/444

### BASE

> BASE: origin/main @ df78a4f1a6a657c4e72e15c14c797ad2f492669a (includes #433 heel-lift squash 9bb557b63703e40e216014e23a87895c56d6a5f3 and #437). Write and freeze gates first from this SHA; candidate = head of the worker draft PR on branch cursor/heel-lift-rigid-cup-1124 once it exists.

PASS. `git rev-parse` at the start was `df78a4f1a6a657c4e72e15c14c797ad2f492669a`. The gates branch is that commit plus the gates commit. `9bb557b63703e40e216014e23a87895c56d6a5f3` is the parent subject "Restore heel lift so the plantar seat rises and the cup does not deepen (#433)". No candidate SHA exists.

### PUSH

> PUSH: new branch cursor/heel-lift-rigid-cup-gates-1124 from BASE -> ONE draft PR titled "[GATES ONLY - DO NOT MERGE] rigid heel-lift cup-depth gates". Never push to the worker branch; never push or merge main; no deploy; no Railway (never touch vertex-web / vertex-api or #310). Never edit any other existing [GATES ONLY - DO NOT MERGE] PR or other open worker PRs.

PASS. `origin/cursor/heel-lift-rigid-cup-gates-1124` is `0e753f88ce2b71d41ab7568ce600d2d8dcedf75b`. Draft PR #444 has that title and base `main` at `df78a4f1`. Its GitHub head ref is the session branch at the same commit. No push to `cursor/heel-lift-rigid-cup-1124`, `main`, Railway, vertex-web, or vertex-api. No other gates PR was edited.

### MUST-MATCH

> MUST-MATCH: gates are written and frozen BEFORE grading the candidate and never edited after; each required gate has a no-op proof (main/BASE fails) and a bad-change rejection proof. Worker's MUST-MATCH: heel lift H raises the entire foot-contact top surface (seat, cup walls, rim) together; at the lowest point of the heel seat (the cup center) the rise equals H ±0.3 mm; cup depth is unchanged ±0.3 mm; the lift tapers monotonically to 0 at the met heads; belt/bottom stays flat; H=0 is byte-identical to main; surface/seams/wall-builder files untouched. Tests at H=6, 10, and 12, both feet, on the composed production path.

PASS for the grader half. Freeze commit `0e753f88` and PR #444 exist before the worker lookup. `check-frozen.mjs` matches `frozen/logic.sha256`. BASE suite fails on (a): seat rise 5.071 / 8.452 / 10.143 mm versus H = 6 / 10 / 12. Bad-change proof rejects the listed copies (exit 0). The worker half is not graded because the branch is absent. (b), (c), (d), and (e) pass on this BASE measurement; (a) fails, so the suite fails. (f) and (g) pass on unmodified BASE by construction and reject edits in the bad-change proof.

### FILES

> FILES: validation/heel_lift_rigid_cup_gates/** only (new). Read-only everything else — do not modify product code or the worker's tests — Don't explore beyond these.

PASS. `git diff --name-only df78a4f1 HEAD` is only paths under `validation/heel_lift_rigid_cup_gates/`. `check-product-diff.mjs` prints `PASS product-diff: no product file differs from BASE df78a4f1a6a657c4e72e15c14c797ad2f492669a`.

### TESTS

> TESTS: targeted only; CI is the full run. Frozen gates must encode (a)–(g) as specified in the body, plus no-op proof on BASE and bad-change rejection proof. Run the frozen gates on BASE and, once the worker PR exists, on the candidate SHA; results table in validation/heel_lift_rigid_cup_gates/RESULTS.md.

PASS. Targeted commands were `prove-noop.mjs` and `prove-bad-change.mjs`. Full CI was not used as the grade. (a)–(g) are in `thresholds.ts`, `measure.ts`, and `heel-lift-rigid-cup.optional.test.ts`. BASE results are in `RESULTS.md`. Candidate column is "worker not yet up".

### CAP

> CAP: 0/3

PASS. This is the first freeze. Gate logic has not been rewritten after the freeze.

### ONE

> ONE: Independent grade of the rigid heel-lift worker on cursor/heel-lift-rigid-cup-1124. Write and freeze gates first; then grade the worker PR if it exists; never edit the worker's code.

PASS. Gates frozen first. Worker PR does not exist. Worker code was not edited.

### GOAL / OUT-OF-SCOPE / DELIVERABLE / HANDOFF

The task card did not include lines labeled GOAL, OUT-OF-SCOPE, DELIVERABLE, or HANDOFF. The corresponding text is the ONE line, the hard prohibition, and FINISH A–C.

> HARD prohibition: do not change worker or product code. Grade only. Do not loosen gates after seeing the candidate. Do not merge or deploy.

PASS. Product diff is empty outside this directory. No candidate was seen before the freeze. PR #444 is draft and was not merged. No deploy.

> FINISH A) Frozen gates on a [GATES ONLY - DO NOT MERGE] draft PR BEFORE grading the candidate. No-op proof and bad-change proof committed with the gates. Never merge any PR.

PASS. PR #444 is that draft. Proof logs are in the freeze commit.

> FINISH B) Rule-compliance report: every rule above and every header line quoted, then PASS or FAIL with evidence.

PASS. This file.

> FINISH C) Handoff note: candidate SHA (or "gates frozen, worker not yet up"), tests, per-gate grades with measured values, residuals, next step. Never edit the worker's code or frozen gates after grading starts.

PASS. `HANDOFF.md`. Frozen logic was not edited after `0e753f88`.

## Locked rules

### R1

> R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.

PASS. `check-surface.mjs` requires the #433 surface-file class, including `vertex/src/lib/kiri/slicer.ts` and `ring-seam.ts`, to match BASE. A reversed perimeter order is rejected (`PASS bad-change: outer-surface perimeter order reversed rejected`).

### R2

> R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).

PASS. Seam and layer-change files are in the frozen hash. `ring-seam.ts` start index and `engine.ts` `slow_down_layer_time = 0` edits are rejected. The belt gate requires the print face under the heel to stay at z = 0. Measured belt min z = 0.000 on BASE.

### R3

> R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.

PASS. This change adds gates only. It does not change slicer or geometry code. The compose path is the existing `printSolidOptions` / `reconstructProceduralPreview` path.

### R4

> R4 (2026-11-05): Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.

PASS. The clinical build loads `tests/fixtures/SAMPLE_Top.glb`, US M11 medium, and sets `heelLiftMm` on the existing corrections. No new mesh.

### R5

> R5 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.

PASS. `vertex/src/lib/geometry/text-marking/bottom-engrave.ts` is in the frozen surface hash. No new engraving code. `activePatientDisplayName()` is the existing field and is null in this test (no client store).

### R6

> R6 Security: never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes. Do not edit any existing [GATES ONLY - DO NOT MERGE] PR. Do not edit other open worker PRs.

PASS. A search of `proofs/` for `api_key`, `bearer`, and `token` found no matches. Logs use design measurements and STL hashes, not patient names. No Railway, database, main push, or deploy. PR #444 is new. No other PR was edited.

### R7

> R7: designs and exports not affected by this defect must produce identical output to current main (prove heelLiftMm=0 is byte-identical).

PASS. Frozen zero-lift hashes, measured on BASE: right `3eb6109ced32cff9db8d19ce6d16e3a54b16d0ed684f86eb23da59671f752e27`, left `474e0f99d0ac907682452871fe08e053353962c39d8ac041ff0a827eb4e92797`. The clinical log contains `PASS identity right-0-after-left-12`, `PASS identity right-0-after-left-10`, and `PASS identity left-0`.

### R8

> R8: do not change worker code. Grade only. Outer surface, seams, layer-change placement, and surface quality may NOT change; seams and layer changes stay on the bottom/plantar face. The S1-PRELOFT 0.5× inset cap may NOT change.

PASS. No worker code was changed. `check-cap.mjs` keeps `SKEW_INSET_RATIO = 0.5` and the frozen `assertPreLoftStations` body (`822d85299ff2e2ad26e43af621da49e09d30391e8169f7eb9eb10428eb28781f`). Loosening the ratio to 1 and multiplying the cap by 4 are rejected.
