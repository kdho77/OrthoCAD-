# Narrow-heelcup preloft gates

Independent grade of worker draft PR #398 at `a86c4be42da66f742bf4a414cb1e2f1ed1ed88ad`.
BASE is `268aac85847160b5b2703a05688721ea4cb93b24`.
Gates were frozen in `327ac81b` before this candidate run. Gate sources were not edited after that commit.

The order-shaped case is the left foot, US men's 6, Narrow, heel cup height 9 mm, default met pad. On BASE that case is the production failure: `[S1-PRELOFT] 138 station(s): skew[45]=50.577>29.076; skew[46]=76.058>25.756`.

`G-REPRO` checks that BASE still throws that signature. It is a harness check. A fix makes it fail on the candidate. It is not a worker requirement.

## Results

| Gate | BASE | Candidate | Measured vs threshold |
| --- | --- | --- | --- |
| G-R1 surface files | PASS | PASS | 10 files byte-identical to BASE. Threshold: kiri, base-modifier, wall-spline, ring-seam, densify-stations unchanged. |
| G-R2 slicer files | PASS | PASS | 4 slicer files byte-identical to BASE. Threshold: engine, gcode, presets, slicer unchanged. |
| G-R3 scope | PASS | PASS | Candidate changed 3 files, 0 outside the allowlist, shard removals 0. Threshold: only procedural-wall, shoe-width, shoe-size, height-field, or an added procedural-wall shard line. |
| G-R4 SAMPLE_Top | PASS | PASS | No new glb/stl/obj/3mf/ply. SAMPLE_Top id and both SAMPLE_Top.glb blobs match BASE. |
| G-R5 text marking | PASS | PASS | 30 text-marking files match BASE. New engraving files: 0. |
| G-R6 secrets / deploy | PASS | PASS | Secret lines 0, patient-name literals 0, vertex-web / vertex-api / railway / print-bridge paths 0. |
| G-MUST-THRESHOLD | PASS | PASS | `SKEW_INSET_RATIO` 0.5 and 0.5, `SKEW_LIMIT_MM` 2, `PRELOFT_HEADING_MAX_DEG` 15, `POSTLOFT_DIHEDRAL_MAX_DEG` 150. Threshold: those exact values, and station-gates.ts, stations.ts, reconstruct.ts identical to BASE. |
| G-R7 stock mesh | PASS | PASS | Men's 9 medium, no corrections: 55156 verts, sha256 `11a9b0627846c2da4638567c202a1cb7264c89b660b3aae0bc5bab2cc493c62d`. Match. |
| G-MUST-IDENTITY | PASS | PASS | Five already-exporting meshes match BASE hash and vertex count. See the table below. |
| G-REPRO (harness only) | PASS | FAIL | Candidate no longer throws the production signature. That is the fix, not a worker failure. |
| G-TESTS-EXPORT | FAIL | PASS | Candidate loft 57406 verts, band [27578, 110312], hash is not one of the five pinned meshes. Headless solid 114808 triangles, minimum 10000. No S1-PRELOFT. BASE throws skew 50.577 mm > 29.076 mm and 76.058 mm > 25.756 mm. |
| G-ONE | FAIL | PASS | Candidate export succeeds, skew constants unchanged, construction file `sample-top-preview.ts` changed. BASE has no construction change and the export throws. |
| G-TESTS-EXISTING | PASS | PASS | `npx rstest` on station-gates, shoe-width, and sample-top-preview tests. Candidate exit 0 in 215733 ms. Threshold: exit 0. |
| G-TESTS-NEW | FAIL | PASS | Candidate file `vertex/src/lib/geometry/procedural-wall/narrow-heelcup-preloft.test.ts` exit 0. BASE has no such test. |
| G-PUSH | n/a | PASS | HEAD `a86c4be42da66f742bf4a414cb1e2f1ed1ed88ad`. Not an ancestor of BASE. PR #398 is still draft and unmerged. |

### Meshes that already export

Threshold is the BASE sha256 and vertex count. Candidate measured a match on every row.

| Case | Vertices | sha256 |
| --- | ---: | --- |
| Men's 9 medium, no corrections | 55156 | `11a9b0627846c2da4638567c202a1cb7264c89b660b3aae0bc5bab2cc493c62d` |
| Men's 8 medium, no corrections | 54357 | `39111add1574cbd9401b2abb60b5652e3cbb3891267405e6beb8bb59c6ed7cbf` |
| Men's 9 Narrow, no heel cup, no met pad | 55555 | `13a8ac9a159c1f20b9faf35e40d3e85e7ad4b14d41d1affb18d009428deac9e0` |
| Men's 8.5 Narrow, heel cup 9 mm, default met pad | 57012 | `9a302d9dc56f56e481726194e8a24ed3cd289087964e6e128002c08e0265fb2a` |
| Men's 10 Narrow, heel cup 9 mm, default met pad | 58421 | `439fffc428be4c3dfa697908af48a67594bd6a65c71cc1ebe3b63442fbb7984a` |

### Commands

BASE no-op, before the candidate run:

`node validation/narrow_heelcup_preloft_gates/run-gates.mjs --product . --mode base --runtime full --out validation/narrow_heelcup_preloft_gates/proofs/noop.json`

Candidate:

`node validation/narrow_heelcup_preloft_gates/run-gates.mjs --product /tmp/candidate-398 --mode candidate --runtime full --out validation/narrow_heelcup_preloft_gates/proofs/candidate.json`

Bad-change proofs are in `proofs/summary.json`. Each named gate fails on a broken copy. Raising `SKEW_INSET_RATIO` from 0.5 to 10 measured 10 against 0.5, let the loft return 85706 verts, and still failed headless export. `G-ONE` and `G-MUST-THRESHOLD` failed on that copy.

The skew caps were not proven wrong. They stay 0.5 times the inset, limit 2 mm, heading 15 degrees, post-loft dihedral 150 degrees.

## Rule-compliance report (worker PR #398)

**R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.**
PASS. G-R1. 10 surface and seam files byte-identical to BASE, including `vertex/src/lib/kiri/*`, `base-modifier.ts`, `wall-spline.ts`, `ring-seam.ts`, and `densify-stations.ts`.

**R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).**
PASS. G-R2. `kiri/engine.ts`, `gcode.ts`, `presets.ts`, and `slicer.ts` byte-identical to BASE.

**R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.**
PASS. G-R3. Diff is `ci/unit-test-shards.json`, `narrow-heelcup-preloft.test.ts`, and `sample-top-preview.ts`. Zero files outside the preloft allowlist. Shard diff removes 0 lines.

**R4 (2026-11-05): Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.**
PASS. G-R4. `sample-top-id.ts` and both `SAMPLE_Top.glb` blobs match BASE. No new mesh asset in the diff.

**R5 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.**
PASS. G-R5. All 30 files under `vertex/src/lib/geometry/text-marking/` match BASE. No new engraving file.

**R6 Security: never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy.**
PASS. G-R6 and G-PUSH. Secret lines 0, patient-name literals 0, deploy paths 0. PR #398 is draft, unmerged, base `main`, head `a86c4be42da66f742bf4a414cb1e2f1ed1ed88ad`. This grade did not push that branch or main.

**R7: designs and exports not affected by your defect must produce identical output to current main (prove with a before/after comparison on at least the SAMPLE_Top stock design with no corrections).**
PASS. G-R7 and G-MUST-IDENTITY. Men's 9 medium with no corrections is 55156 verts and sha256 `11a9b0627846c2da4638567c202a1cb7264c89b660b3aae0bc5bab2cc493c62d` on both trees. Four other designs that already export also match.

**Worker MUST-MATCH: designs that already export produce identical meshes; skew thresholds unchanged unless proven wrong (then STOP and report).**
PASS. G-MUST-IDENTITY and G-MUST-THRESHOLD. Thresholds measured 0.5, 2, 15, and 150 against those same thresholds. Not proven wrong, so no stop.

**Worker TESTS: new test reproducing the failure: narrow width, heel cup 9 mm, default met pad exports headless with no S1-PRELOFT skew failure; existing tests green.**
PASS. G-TESTS-EXPORT and G-TESTS-NEW and G-TESTS-EXISTING. Headless left solid has 114808 triangles. Loft has 57406 verts and does not throw. The new test exits 0. The three existing suites exit 0.

**Worker ONE: Fix the export failure on order 465dd59b (narrow width, heel cup 9 mm, met pad default): Generate L failed 9:50 AM MT with "Canonical Export mesh is not available headless. Refusing to substitute a different mesh. (Error: [S1-PRELOFT] 138 station(s): skew[45]=50.577>29.076; skew[46]=76.058>25.756; ...". Find why stations skew for this combination and fix the construction; do not just raise the skew threshold.**
PASS. G-ONE and G-TESTS-EXPORT and G-MUST-THRESHOLD. On BASE the measured skew is 50.577 mm against a cap of 29.076 mm and 76.058 mm against 25.756 mm, 138 stations. On the candidate the same case exports, `SKEW_INSET_RATIO` is still 0.5, and the construction change is `sample-top-preview.ts`. A copy that only sets the ratio to 10 fails G-ONE.

## Grader constraints

**PUSH: new branch cursor/narrow-heelcup-preloft-gates-1123 (from BASE) -> ONE draft PR "[GATES ONLY - DO NOT MERGE] narrow-heelcup-preloft gates". Never push to the worker branch; never push/merge main, deploy, Railway (never touch vertex-web / vertex-api or #310), printers, production orders.**
PASS for this grader. The only commits are on `cursor/narrow-heelcup-preloft-gates-1123`. The worker branch was fetched and graded from a detached worktree.

**FILES: validation/narrow_heelcup_preloft_gates/** only (new); read-only everything else.**
PASS. `git diff 268aac85847160b5b2703a05688721ea4cb93b24` on this branch is only that directory.

**MUST-MATCH: gates are written and frozen BEFORE grading the candidate and never edited after; each gate has a no-op proof (passes on BASE where BASE should pass) and a bad-change proof (fails on a deliberately broken copy).**
PASS. Freeze commit `327ac81b` is the parent of the results commit. No-op is `proofs/noop.json`. Bad copies are `proofs/summary.json`.

**Hard prohibition: do not change the outer surface, seams, layer-change placement, or surface quality.**
Followed. Those files were not edited. G-R1 and G-R2 compare them to BASE and they match.
