# Handoff

Candidate SHA: `ef85af5a2094056f7e467aceac4945c35226ca78`

GRADE PASS @ ef85af5a2094056f7e467aceac4945c35226ca78

Frozen gates commit: `0e753f88ce2b71d41ab7568ce600d2d8dcedf75b`
BASE: `df78a4f1a6a657c4e72e15c14c797ad2f492669a`
Draft worker PR: https://github.com/kdho77/OrthoCAD-/pull/445 (do not merge, do not edit)
Draft gates PR: https://github.com/kdho77/OrthoCAD-/pull/444 (do not merge)

## Tests

- GitHub Actions Test run 45548605341 on `ef85af5a` — success. Unit-tests (1) through (6) success. `isolated-postgres-acceptance` success. `test-and-deploy` success. Record: `proofs/ci-ef85af5a.txt`.
- `node validation/heel_lift_rigid_cup_gates/grade-candidate.mjs ef85af5a2094056f7e467aceac4945c35226ca78` — exit 0. Frozen logic, surface files, S1-PRELOFT cap, and the clinical suite passed. Log: `proofs/grade-ef85af5a.log`.
- Clinical rows (both feet, H = 6, 10, 12): `proofs/clinical-candidate-ef85af5a.log`.
- No-op on BASE and the bad-change proof stay as frozen. They were not re-run for this grade.

## Grades

Lowest heel-seat point: u = 0.116, |v| ≈ 0.028, z = 2.159 mm. Both feet. Right v is positive; left v is negative.

| Gate | Measured | Threshold | Grade |
| --- | --- | --- | --- |
| (a) seat rise | H=6 +6.000; H=10 +10.000; H=12 +12.000 | H ± 0.3 | PASS |
| (b) cup depth change | 0.000 / 0.000 / 0.000 | 0 ± 0.3 | PASS |
| (c) met heads | 0.000 | ± 0.1 | PASS |
| (d) taper | H=12: 12.000, 11.615, 8.708, 5.799, 2.905, 0. H=6 and H=10 scale the same way | monotone | PASS |
| (e) belt and plate | belt min z = 0, meshMinZ = 0, plantarAbsMaxZ = 0 | ± 0.1 and unchanged vs lift 0 | PASS |
| (f) H=0 STL | right and left match frozen hashes, and the right zero hash is stable across left lifts | byte-identical | PASS |
| (g) surface / cap | surface-file hashes and the 0.5× inset cap match BASE | untouched | PASS |

Paired rim rise equals the seat rise, so a 19.321 mm cup stays 19.321 mm.

## Residuals

None on the frozen gates. `ce0f9a61` failed CI (unit-tests 1 and 5) and was replaced. `dfe3d17` was replaced by `ef85af5a` before this grade. Gate logic was not loosened after seeing the candidate.

## Next step

Wait for Kendon's merge-and-deploy go. This grade does not merge and does not deploy.

## Rule-compliance report

**R1** (2026-11-20 12:59 PM MT): "print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality."
PASS. `check-surface.mjs` exit 0 on the candidate. Surface, seam, layer-change, wall-builder, and slicer hashes match BASE. This grade did not edit those files.

**R2** (2026-11-20 11:38 AM MT): "seams and layer changes must always be on the bottom (plantar/belt face)."
PASS. No slicer or seam file changed versus BASE. Belt min z = 0.000 mm, meshMinZ = 0.000, plantarAbsMaxZ = 0.000, threshold 0.1 mm, both feet, H = 6, 10, and 12.

**R3** (2026-11-21 8:41-8:45 PM MT): "slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions."
PASS for this grade. Only `RESULTS.md`, `HANDOFF.md`, and `proofs/**` were updated. No product code and no frozen gate logic.

**R4** (2026-11-05): "Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh."
PASS. The clinical gate builds SAMPLE_Top, US M11 medium, through `composePrintSolidTop` / `reconstructProceduralPreview`.

**R5** (2026-11-05): "every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system."
PASS. `bottom-engrave.ts` is in the surface hash set and matched BASE. Belt z stays 0.

**R6** Security: "never print secrets (filter output through grep -v -i \"api_key\\|token\\|bearer\"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes. Do not edit any existing [GATES ONLY - DO NOT MERGE] PR. Do not edit other open worker PRs."
PASS. No secrets or patient names in the proof logs. No Railway, no database, no deploy, no push to main. PR #445 was not edited. PR #444 stays a draft and is not merged.

**R7**: "designs and exports not affected by this defect must produce identical output to current main (prove heelLiftMm=0 is byte-identical)."
PASS. Right zero STL `3eb6109ced32cff9db8d19ce6d16e3a54b16d0ed684f86eb23da59671f752e27` after left H=12 and again after left H=10. Left zero STL `474e0f99d0ac907682452871fe08e053353962c39d8ac041ff0a827eb4e92797`.

**R8**: "do not change worker code. Grade only. Outer surface, seams, layer-change placement, and surface quality may NOT change; seams and layer changes stay on the bottom/plantar face. The S1-PRELOFT 0.5x inset cap may NOT change."
PASS. Worker tree was graded in a detached worktree and not committed here. `check-cap.mjs` exit 0: `SKEW_INSET_RATIO` stays 0.5. `check-frozen.mjs` exit 0 against `frozen/logic.sha256`.

**PUSH:** "continue on the existing draft gates PR #444 (https://github.com/kdho77/OrthoCAD-/pull/444), branches cursor/heel-lift-rigid-cup-gates-1124 and/or cursor/independent-grader-write-and-freeze-rigid-heel-lift-cup-depth-gates-first-then-grade-the-worker-cdd9. Update only RESULTS.md, HANDOFF.md, and candidate-grade proof logs under validation/heel_lift_rigid_cup_gates/proofs/**. Do not edit frozen gate logic (measure.ts, thresholds.ts, the clinical tests, frozen/logic.sha256). Never push or merge main; no deploy; do not edit #445 or any other PR."
PASS. Those files only. Both gates branches receive this commit. main was not pushed.

**MUST-MATCH:** "wait until GitHub CI on #445 is green on the worker's final head, then grade that SHA against the already-frozen (a)–(g) gates (seat rise H ±0.3 mm at the lowest heel-seat point / cup center; cup depth 0 ±0.3 mm; met-head 0; monotonic taper; belt flat; H=0 byte-identical; surface/S1-PRELOFT untouched; H=6, 10, and 12, both feet). Do not loosen or rewrite frozen gates. Write GRADE PASS/FAIL @ <sha> in validation/heel_lift_rigid_cup_gates/RESULTS.md. Never merge or deploy."
PASS. CI on the final head was green before the grade. Measured values are in the table above. The grade line is in `RESULTS.md`.

**FILES:** "validation/heel_lift_rigid_cup_gates/RESULTS.md, validation/heel_lift_rigid_cup_gates/HANDOFF.md, and candidate proof logs under validation/heel_lift_rigid_cup_gates/proofs/** only. Do not modify measure.ts, thresholds.ts, the clinical test, frozen/logic.sha256, or any product code."
PASS. `git diff --name-only` for this commit is those files.

**TESTS:** "targeted only; CI is the full run. After #445 CI is green, run `node validation/heel_lift_rigid_cup_gates/grade-candidate.mjs <final-head-sha>` (or equivalent) and record measured values vs thresholds."
PASS. That command exited 0. Worker CI run 45548605341 is the full run and was already green.

**ONE:** "Once #445 CI is green, independently grade the worker's final head against frozen gates 0e753f88. Do not loosen gates or edit the worker."
PASS. Graded `ef85af5a` only. Frozen manifest check passed.
