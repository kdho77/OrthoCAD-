# Morton's-name gate results

Independent grade of worker draft PR #397 at `5a67b17fcf1a3f0694d0098f16221bfad0a8a326` against BASE `268aac85847160b5b2703a05688721ea4cb93b24`.

Gates were frozen in `8e5d3dcf` before this candidate was measured. `thresholds.mjs` and `score.mjs` were not edited after that commit.

This grader did not change product code, the outer surface, seam placement, layer-change placement, or surface quality. The only files added are under `validation/mortons_name_gates/`.

## Measurements

Men's 9 `SAMPLE_Top`, no corrections, existing bottom `textMarking` engrave, string `SAMPLE`, depth 0.6 mm, both feet, belt print. Left foot also gets one Morton's extension from `defaultElementPose` (height 3 mm, medial Y -28.424 mm).

| Case | BASE | Candidate | Threshold | Result |
| --- | --- | --- | --- | --- |
| G-DEFECT floor area on the Morton's foot | 0 mm², text dropped, 76926 tris | 455.494 mm², kept, 99908 tris (delta 22982) | area ≥ 8 mm², ratio ≥ 0.5 of the other foot, tri delta ≥ 100, not dropped | PASS |
| G-DETECTOR name on feet without that element | left 455.494 mm², right 455.490 mm² | same areas, not dropped | area ≥ 8 mm² | PASS |
| G-OTHER-FOOT STL vs BASE | identical to itself | left name and right name sha256 equal BASE | sha256 equal; plantar spanX ≥ 20 mm, spanY in [6, 14] mm, axis within 20° of +X | PASS |
| G-ELEMENT pad vs BASE | plateau 3.000 mm, mean Y -35.039 mm | plateau 3.000 mm, mean Y -35.039 mm, 8820/8820 cells, max delta 0 mm | \|plateau − 3\| ≤ 0.2 mm, mean Y < 0, cell delta ≤ 0.01 mm, 0 unmatched | PASS |
| G-R1 top and upper side (z ≥ 1 mm) | 0 mm | Morton's foot and stock: max delta 0 mm, 0 unmatched | ≤ 0.01 mm and 0 unmatched | PASS |
| G-R2 slicer files | unchanged | `kiri/slicer.ts`, `engine.ts`, `gcode.ts`, `presets.ts` sha256 equal BASE; surface delta 0 mm | hashes equal and surface ≤ 0.01 mm | PASS |
| G-R7 stock STL, no corrections, no text | `4c0e3fa857504ddf81f2722737c83f47b20eac9b642e406656e06ed3deab13e1` | same sha256, 75844 tris | sha256 equal | PASS |

Plantar read on the candidate, feet without the element: left span 70.242 × 12.637 mm, axis 0.045°; right span 70.242 × 12.638 mm, axis -0.16°. Floor centroid on the Morton's foot matches the stock left name: (90.609, 7.530, 0.600) mm.

## Proofs, before the candidate run

| Proof | Command | Result |
| --- | --- | --- |
| No-op on BASE | `node validation/mortons_name_gates/prove.mjs --meas validation/mortons_name_gates/out/base.json` | Detector, other-foot, element, R1–R7 PASS. G-DEFECT FAIL (area 0), which is the bug on BASE. A synthetic copy that keeps the stock floor passes G-DEFECT. |
| Bad change | `node validation/mortons_name_gates/prove.mjs --bad --meas validation/mortons_name_gates/out/base.json` | Every broken copy failed its own gate. |

## Existing tests

`bash validation/mortons_name_gates/run-existing.sh`

| Tree | Passed | Failed | Exit |
| --- | --- | --- | --- |
| BASE `268aac85` | 30 | 0 | 0 |
| Candidate `5a67b17` (list plus `tests/mortons-bottom-name.test.ts`) | 31 | 0 | 0 |

GitHub Actions on `5a67b17` (run 45228255522): unit-tests (1) through (6) success, isolated-postgres-acceptance success, test-and-deploy success. That job aggregates those results. It does not deploy Railway.

## Rule compliance

**PUSH:** `new branch cursor/mortons-name-gates-1123 (from BASE) -> ONE draft PR "[GATES ONLY - DO NOT MERGE] mortons-name gates". Never push to the worker branch; never push/merge main, deploy, Railway (never touch vertex-web / vertex-api or #310), printers, production orders.`

PASS. This grade is committed only on `cursor/mortons-name-gates-1123`. The worker branch was fetched into a detached worktree and not pushed. No merge to main.

**FILES:** `validation/mortons_name_gates/** only (new); read-only everything else - do not modify product code or the worker's tests - don't explore beyond`

PASS. `git diff 268aac85 --stat` on this branch is only `validation/mortons_name_gates/`.

**MUST-MATCH (grader):** `gates are written and frozen BEFORE grading the candidate and never edited after; each gate has a no-op proof (passes on BASE where BASE should pass) and a bad-change proof (fails on a deliberately broken copy).`

PASS. Freeze commit `8e5d3dcf`. No-op and bad-change proofs above. Candidate grading used that same `score.mjs`.

**MUST-MATCH (worker):** `names on feet without that element unchanged in position/orientation (must still read correctly from the plantar side); element geometry unchanged`

PASS. G-OTHER-FOOT and G-ELEMENT. Right and left named STLs match BASE byte for byte. Pad cells match BASE with max delta 0 mm. Plateau 3.000 mm versus 3 ± 0.2 mm. Raised mean Y -35.039 mm (left medial is −Y).

**TESTS:** `new geometry test: a design with a Morton's extension on one foot and textMarking bottom engrave on both still has the engraved name present on that foot's bottom surface (detect the engrave in the export mesh or G-code); existing tests green`

PASS. G-DEFECT measured the letter floor in the export mesh: 455.494 mm² at z = 0.6 mm, 9011 floor triangles, 22982 extra triangles versus the same foot with no text. Existing tests 31/31 on the candidate, 30/30 on BASE.

**ONE:** `Make the bottom engraved name appear on the foot that has a Morton's extension. Observed on order 912c7573 production: the left file (foot with the Morton's extension) has no engraved name at any depth; right side fine. Use the existing textMarking engrave only (R5).`

PASS. On BASE the left Morton's export drops the text (floor 0 mm², same STL as the unnamed pad). On the candidate the floor is present and matches the stock left name's place and size. The diff's product change is `vertex/src/lib/geometry/text-marking/gates.ts` only.

**CAP:** `0/3`

PASS. PR #397 is one draft commit (`5a67b17`). No follow-up commit on that head.

**R1:** `print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.`

PASS. Top and upper-side cells (z ≥ 1 mm, 1 mm grid): max delta 0 mm, 0 unmatched, on the Morton's foot (8820 cells) and on stock. Kiri slicer sources are byte-identical to BASE, so seam and layer generation did not move.

**R2:** `seams and layer changes must always be on the bottom (plantar/belt face).`

PASS. Same evidence as R1. The only mesh that differs from BASE is the Morton's foot, and only below the z = 1 mm line (the 0.6 mm letter pocket). `vertex/src/lib/kiri/slicer.ts` sha256 matches BASE.

**R3:** `slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.`

PASS. Diff vs BASE is three files: `vertex/src/lib/geometry/text-marking/gates.ts`, `tests/mortons-bottom-name.test.ts`, `ci/unit-test-shards.json` (the new test added to the existing shard list). No slicer, element, or stock-mesh file. The gate change keeps the existing self-intersection count and, for a bottom engrave, blames a hit only when it enters the letter pocket. Wall text still checks the whole mesh.

**R4:** `Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.`

PASS. Both measurements load `tests/fixtures/SAMPLE_Top.glb`. That file and `vertex/public/Templates/SAMPLE_Top.glb` match BASE. No new `.glb` or `.stl`. The element height is the registry value 3 mm. Stock export sha256 matches BASE.

**R5:** `every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.`

PASS. The harness marking is surface `bottom`, mode `engrave`, depth 0.6 mm, feet `both`. No new `engrave` path outside `text-marking/`. The candidate edits the existing print gate, not a second engraver.

**R6:** `never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy.`

PASS. Added-line scan of the candidate diff: secret hits 0, email/phone hits 0. Diff paths do not include `vertex-web`, `vertex-api`, or Railway. PR #397 is draft, `merged` false, head is not `main`. The check named test-and-deploy aggregates unit tests; the workflow does not deploy Railway. Their new test uses the five-letter fixture `CASEY`. This scan does not treat that token as an email or a phone number, and it is not a full name tied to order `912c7573`.

**R7:** `designs and exports not affected by your defect must produce identical output to current main (prove with a before/after comparison on at least the SAMPLE_Top stock design with no corrections).`

PASS. Stock left, no corrections, no text: sha256 `4c0e3fa857504ddf81f2722737c83f47b20eac9b642e406656e06ed3deab13e1` on both. Stock left with the name and stock right with the name are also byte-identical to BASE (`9579897c5e0882799329deda0f3b82ae4369af50c404b880d87c71ca7d6f88b5` and `3d47523c47f461168355847cc1bcea66c850b509be683ba994c55a4149897a1c`).

## Handoff

- Grader branch: `cursor/mortons-name-gates-1123`. Freeze `8e5d3dcf`. Candidate graded: `5a67b17fcf1a3f0694d0098f16221bfad0a8a326`.
- Overall: PASS on G-DEFECT, G-DETECTOR, G-OTHER-FOOT, G-ELEMENT, G-R1 through G-R7, and G-ONE.
- Residuals: none that fail a frozen gate. The worker CI shard list gained one test path. The worker test fixture string is `CASEY`.
- Grader CI: run 45258603564 failed the shard counter because `measure.test.ts` was one file past `ci/unit-test-shards.json` (370 vs 369). No unit test executed, and `test-and-deploy` stopped at that aggregate. The recorder is now `measure.optional.test.ts`. Thresholds and `score.mjs` are unchanged from `8e5d3dcf`.
- Next step: leave this PR unmerged. It is the grade of #397, not the fix.
