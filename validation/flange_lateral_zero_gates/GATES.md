# Frozen gates: flange lateral zero

These gates were written from the worker brief and from BASE `268aac85847160b5b2703a05688721ea4cb93b24` before the candidate tree was executed. Do not edit them after the freeze commit. `RESULTS.md` is the only file added after the runs.

Candidate under grade: PR #394 head `bb5235d9f2f51f6fdb2a9553e3e0d112db8d7d4a`.

## Worker header lines (quoted)

- PUSH: worker branch `cursor/make-an-explicit-lateral-mm-0-and-an-omitted-lateral-mm-not-produce-a-default-3-mm-lateral-flange-5845` (grader must not push it).
- FILES: grader writes `validation/flange_lateral_zero_gates/**` only.
- MUST-MATCH: `sliders_by_side` flange path and bilateral flange requests unchanged.
- TESTS: `flange.left {medial_mm:3, lateral_mm:0}` reads back `medialFlangeMm` 3 and `lateralFlangeMm` 0 (or absent) on L, nothing on R; omitted `lateral_mm` on a medial-only request does not create a 3 mm lateral flange; existing tests green.
- ONE: Make an explicit `lateral_mm` 0 (and an omitted `lateral_mm`) not produce a default 3 mm lateral flange.
- CAP: 0/3. This grader does not change product code.

## What is measured

Fresh reads call `buildSavedDesignSnapshot` with stored US men's 9, width medium. Persist reads call `persistSavedDesignSnapshotOnDesign` against an in-memory row whose stored left flange is medial 3 and lateral 3 (the read-back that stays 3 on BASE when a later request says 0). Right-foot "nothing" means medial and lateral are 0 or absent and the snapshot paths do not name a right flange.

`lateral_mm: 0` must survive catalog parse as 0. An omitted `lateral_mm` must stay absent on the parsed catalog. Read-back lateral must be 0 or absent, and must not be 3.

Bilateral / level cases that BASE already implements, and that are not the medial-only defect, stay at these millimeters:

| Case | Catalog | L medial | L lateral | R medial | R lateral |
| --- | --- | --- | --- | --- | --- |
| split | left 4/5, right 6/1 | 4 | 5 | 6 | 1 |
| empty left | `flange.left {}` | 3 | 3 | 0 | 0 |
| mild right | `level: mild` | 0 | 0 | 2 | 2 |
| high left | `level: high` | 6 | 6 | 0 | 0 |
| level plus medial | `level: high`, `medial_mm: 3` | 3 | 6 | 0 | 0 |

`sliders_by_side.left {medial_flange_mm:3, lateral_flange_mm:0}` must read L 3/0 and R 0/0 on a fresh build and after persist over stored lateral 3.

R7 hashes the full snapshot (design, sorted paths, shoe, hardness) for empty SAMPLE_Top and for arch, flexible foot, thickness 3.5 mm, a non-flange heel slider, the slider flange path, explicit bilateral millimeters, empty flange, mild level, level-plus-medial, and a Met Pad. The medial-only omit catalog is not in R7, because that output is the defect.

## Gate index

| Gate | BASE should | Threshold |
| --- | --- | --- |
| G_ONE_EXPLICIT | FAIL | explicit 0 read-back, fresh and persist |
| G_TESTS_OMITTED | FAIL | omitted lateral is not a 3 mm flange, fresh and persist |
| G_ONE | FAIL | both defect gates |
| G_MUST_SLIDERS | PASS | slider path unchanged |
| G_MUST_BILATERAL | PASS | table above |
| G_TESTS_EXISTING | PASS | exit 0 on the two saved-design snapshot test files |
| G_R1_SURFACE | PASS | sha256 of top/side/surface files equals BASE |
| G_R2_SEAMS | PASS | sha256 of seam, slicer, and bottom-engrave files equals BASE |
| G_R3_SCOPE | PASS | diff paths are allowlisted flange snapshot/test/schema files |
| G_R4_SAMPLE_TOP | PASS | asset `sample-top`, bundled glb path, right base mirrored, mesh bytes equal BASE |
| G_R5_TEXT_MARKING | PASS | bottom engrave via existing textMarking; engraving files equal BASE |
| G_R6_SECURITY | PASS | no railway, vertex-web, vertex-api, printer, print-bridge, production-job, or workflow path; no secret or patient-name assignment in added lines |
| G_R7_UNAFFECTED | PASS | 0 unaffected catalogs differ from BASE, including empty SAMPLE_Top |
| G_HEAD | PASS when `--expect-head` matches | records the tree SHA |

## Locked rules (quoted)

R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.

R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).

R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.

R4 (2026-11-05): Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.

R5 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.

R6 Security: never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy.

R7: designs and exports not affected by your defect must produce identical output to current main (prove with a before/after comparison on at least the SAMPLE_Top stock design with no corrections).

## Proofs

`prove.mjs noop` runs the gates on an unmodified BASE worktree. Defect gates must fail. Every other gate must pass.

`prove.mjs known-good` applies a throwaway patch on a BASE worktree: omitted borders stay 0 unless both millimeters are omitted or `level` is set, and persist does not copy a stored flange back over a flange request for that foot. The medial-only test expectation in that copy is updated to lateral 0. Defect gates, must-match, existing tests, and R1–R7 must pass. The patch is not committed.

`prove.mjs bad` resets that worktree once per gate and applies one deliberate break. The targeted gate must fail.
