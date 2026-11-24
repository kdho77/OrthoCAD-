# Plantar-face name chirality gates

BASE `8aced4b5042bdafc2d300006fa80802bca1b94b9` (origin/main, "Flush generate_gcode pending response before loft and raise wait_s to 300s (#423)").

Synthetic string: `JABBOUR`. No patient name.

Gates were frozen at `2795c68adb910c3fc61b2e6ca574be75df72de2e` before the worker was graded. The worker SHA is graded below. No other open PR was graded.

## Camera

The belt deposit is `Rz(270)` then `Y_virt = Z`, `Z_virt = Y + Z`, X unchanged. `beltPrintFrameDet()` is −1.

The right-handed view of that face, toe to screen-right, is screen `(mesh X, mesh Y)` at z = 0. On this base the beltPrint string is upright and left-to-right there. That is the gantry reading. It is not the gate.

G1 uses the X flip of that view (`physicalPlantarView`). Caps stay screen-up. A string that advances in +mesh X reads right-to-left. `toeTowardViewerView` is that same mirror rotated so the toe is screen-down. A rotation does not change the mirror, so G1 scores the upright frame.

## Gates

| Gate | Pass rule |
| --- | --- |
| G1 | Both feet. In the physical camera the font +X maps to screen +X (`a > 0.5`), the cap maps to screen +Y (`d > 0.5`), skew terms stay under 0.15, the J-to-R advance is greater than 20 mm, and the J hook is lower-left. |
| G2 | Existing bottom `textMarking`, mode `engrave`, depth 0.6 mm, cap 12 mm bold, placementU 0.32, rotation 0, nudges 0. Pivot stays at (86.8, 0) ± 0.05 mm. Mapped width 82.9933 ± 0.05 mm. Centroid z is the engrave depth. |
| G3 | Vertices outside the glyph box (pad 1 mm) move by at most 1e-4 mm. Belt G1 lines whose mesh XY is outside that box are byte-identical. Diff must not touch slicer, seam, layer-change, surface-quality, or VertexSlice paths. `SKEW_INSET_RATIO` stays 0.5. Sole bottom stays at z = 0. |
| G4 | A design with no extra line and no patient name is byte-identical. `applyTextMarkingToPrintSolid` returns the same host. |

An X mirror about the placement pivot, on both feet, passes G1–G4. Thresholds were not loosened to create that pass.

## No-op proof

Command: `npx rstest validation/name_mirror_fix_gates/gates.test.ts` (3 passed).

Identity `placeBottomText(..., { beltPrint: true })` on the frozen sole:

| Gate | Result | Measured |
| --- | --- | --- |
| G1 | FAIL | left and right `a = -1` (need > 0.5), `d = 1`, det = −1, advance = −72.821 mm (need > 20), J hook is not lower-left |
| G2 | PASS | surface bottom, mode engrave, depth 0.6 mm, cap 12, placementU 0.32, pivot (86.8, 0), width 82.9933 mm, centroid z error 0 |
| G3 | PASS | 0 vertices moved, 2 outside G1 lines match, 0 scope hits, skew ratio 0.5, sole \|z\| 0 |
| G4 | PASS | same host, SHA-256 `c3c28185f93a960c1fddd71953e32bfacbe49e9361f1bef0bd189fc4450eccc2` |

The gantry camera on the same identity placement has `a > 0.5`, `d > 0.5`, and the J hook lower-left. That reading is recorded and is not a pass.

## Bad-change proof

| Change | Gate | Result |
| --- | --- | --- |
| Y flip about the pivot, both feet | G1 | FAIL. G2 still passes. |
| X flip on the left foot only | G1 | FAIL. Right stays `a = -1`, advance −72.82 mm, hook not lower-left. |
| Depth 1.2 mm on an otherwise good mirror | G2 | FAIL. Reported depth 1.2 (need 0.6) and centroid z leaves 0.6 by 0.6. G1 still passes. |
| +5 mm along X | G2 | FAIL. Pivot x moves. |
| Heel vertex +0.25 mm | G3 | FAIL. 1 vertex outside the text region. |
| Heel G1 line edited | G3 | FAIL. |
| A glyph G1 line edited, heel and toe kept | G3 | PASS. Text-region motion may change. |
| Diff lists `vertex/src/lib/kiri/slicer.ts` | G3 | FAIL. |
| Diff sets `SKEW_INSET_RATIO` from 0.5 to 0.8 | G3 | FAIL. |
| Sole bottom \|z\| 0.4 mm | G3 | FAIL. |
| No-text bytes differ | G4 | FAIL. |
| X flip about the pivot, both feet | G1–G4 | PASS. Advance +72.821 mm, `a = 1`, `d = 1`, det = +1, hook lower-left, pivot unchanged. |

## Worker grade

SHA `ad2ada118a4bdf635d4bb20249ee7ee9fc7cbc9f` on `cursor/name-mirror-fix-1124`. Merge-base with BASE is `8aced4b5042bdafc2d300006fa80802bca1b94b9`. No pull request was open for that branch. The branch was not edited.

Diff versus BASE is three files: `place.ts` (belt path sets `xSign = -1` about the glyph centre), `belt-print-frame.ts` (camera comment and `printedPlantarView`), and `belt-print-frame.test.ts`. The frozen gates do not import `printedPlantarView`. They call this SHA's `placeBottomText(..., { beltPrint: true })`.

Command, in a detached worktree at that SHA: `npx rstest validation/name_mirror_fix_gates/grade-only.test.ts`.

| Gate | Result | Measured |
| --- | --- | --- |
| G1 | PASS | both feet `a = 1`, `d = 1`, det = +1, advance = +72.821 mm, J hook lower-left |
| G2 | PASS | bottom, engrave, depth 0.6 mm, cap 12, placementU 0.32, pivot (86.8, 0), width 82.9933 mm, centroid z error 0 |
| G3 | PASS | 0 vertices outside the text region, 2 outside G1 lines match, 0 scope hits, `SKEW_INSET_RATIO` 0.5, sole \|z\| 0 |
| G4 | PASS | same host, SHA-256 `c3c28185f93a960c1fddd71953e32bfacbe49e9361f1bef0bd189fc4450eccc2` |

On this SHA the gantry camera measures `a = -1` and the J hook is not lower-left. That view is not acceptance. Thresholds were not changed to obtain the pass.

R1–R7 on this SHA: the diff does not touch seam, layer-change, slicer, surface-quality, or `SKEW_INSET_RATIO` (still 0.5 on disk). Outer surface, seams, and layer-change placement are untouched. No worker file was edited by this grade.

## Residuals

The G3 motion check is the locked belt map (`gantry Y = √2·height`, belt Z = along) on heel, toe, and glyph centroids. VertexSlice was not invoked, and a production G-code file was not byte-diffed. The geometry check is the host mesh outside the glyph box, which `placeBottomText` does not modify. A worker grade still has to run these same functions on that worker's placement and on its mesh outside the text region.

## Rule compliance

PUSH: `new branch cursor/name-mirror-fix-gates-1124 from BASE -> ONE draft PR titled "[GATES ONLY - DO NOT MERGE] bottom-name plantar chirality gates" only (merge=false). Never push or merge main, force-push main, deploy, or touch Railway / vertex-web / vertex-api / PR #310.`

PASS. Branch is `cursor/name-mirror-fix-gates-1124` from `8aced4b5042bdafc2d300006fa80802bca1b94b9`. Draft PR only. No main push, no deploy, no Railway, no PR #310.

FILES: `validation/name_mirror_fix_gates/** only (new gates, proofs, and RESULTS.md). If the shard manifest must list a test file you add, update ci/unit-test-shards.json via node scripts/ci/generate-unit-test-shards.mjs. Don't explore beyond. Do not change product code.`

PASS. New files are under `validation/name_mirror_fix_gates/`. `node scripts/ci/generate-unit-test-shards.mjs` was run. On this base that rewrite moves 300 tests that are already listed, so the new file was added to shard 1 (the smallest, 61 → 62) and the other assignments were left as they are. `node scripts/ci/validate-unit-test-shards.mjs` prints `OK: 372 test files partitioned across 6 shards`. No product source edit.

MUST-MATCH: `frozen gates only, with a no-op proof and a bad-change proof, before any grade. Gates: (G1) the engraved name reads correctly (not mirrored) when viewing the physical plantar face with the toe toward the viewer, for both left and right feet — this camera is the flip-the-device-over view (looking through the belt toward +height, with the X flip of a right-handed view of that face), NOT the gantry/from-above view looking toward −height, which today already reads correctly and is the wrong camera; (G2) the engrave stays on the bottom via existing textMarking, engrave mode, at the same depth and placement, with the sole flat; (G3) all non-text geometry and G-code outside the text region are unchanged versus BASE; (G4) a design with no text is byte-identical to BASE. No S1-PRELOFT cap change; no slicer, seam, layer-change placement, or outer-surface-quality change; seams and layer changes stay on the bottom/plantar/belt face.`

PASS. G1 scores `physicalPlantarView` (X flip). Identity fails G1 (`a = -1`, advance −72.821 mm) and passes G2–G4. The gantry view is asserted to still read correctly and is not the pass condition. G2 depth 0.6 mm, pivot (86.8, 0), engrave, sole z = 0. G3 identity is 0 vertices and matching outside lines; a slicer path and `SKEW_INSET_RATIO` 0.8 fail G3. G4 hashes match.

TESTS: `targeted only; CI is the full run.`

PASS. Targeted command `npx rstest validation/name_mirror_fix_gates/gates.test.ts`, 3 passed. Full CI is the PR's own run.

ONE: `Freeze independent plantar-face name-chirality gates with no-op and bad-change proofs, then grade the worker if it exists. Do not merge. Do not change product code.`

PASS. Gates and both proofs are in this branch. Worker was absent, so there is no grade. No merge. No product edit.

GOAL: `An independent grader whose frozen gates accept a fix only if the patient name reads correctly on the physical bottom of the finished device, both feet, without moving the engrave or changing anything outside the text.`

PASS. The X-flip-both-feet control passes G1–G4. Y-only, one-foot, depth, placement, outside vertices, outside G-code, slicer scope, the 0.5 inset cap, a raised sole, and a no-text byte change are rejected.

OUT-OF-SCOPE: `product-code edits, loosening gates, merge, deploy, Railway, production order writes, PHI, changing the S1-PRELOFT cap, slicer, seams, or surface quality.`

PASS. None of those were done. The string is the synthetic `JABBOUR`.

DELIVERABLE: `one [GATES ONLY - DO NOT MERGE] draft PR with frozen gates, no-op proof, bad-change proof, RESULTS.md, a rule-compliance report, and a handoff note. If the worker PR is up, a per-gate grade of that SHA. Never merge.`

PASS. The draft PR carries the frozen gates, both proofs, this report, and the grade of `ad2ada11`. That branch had no PR number. It was graded and not edited. No merge.

HANDOFF: `post a handoff note on the gates PR with the gates SHA, proof results, candidate SHA if graded, per-gate grades, residuals, and next step (wait for Kendon's merge-and-deploy go). Do not merge or deploy.`

PASS when the PR comment is posted. Candidate SHA `ad2ada118a4bdf635d4bb20249ee7ee9fc7cbc9f`. Gates SHA `2795c68adb910c3fc61b2e6ca574be75df72de2e` plus the grade commit. Next step is to wait for Kendon's merge-and-deploy go. No merge and no deploy in this change.

R1 (2026-11-20 12:59 PM MT): `print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.`

PASS. No product edit. G3 fails a diff that touches a surface-quality or seam path. Sole bottom \|z\| of 0.4 mm fails G3.

R2 (2026-11-20 11:38 AM MT): `seams and layer changes must always be on the bottom (plantar/belt face).`

PASS. No slicer or seam code was edited. A slicer path in the diff fails G3.

R3 (2026-11-21 8:41-8:45 PM MT): `slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.`

PASS. The gates score only the plantar-name mirror, the existing engrave placement, and unchanged non-text geometry. The camera copies the locked belt coefficients.

R4 (2026-11-05): `Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.`

PASS. No stock mesh, correction, element, or sink code was edited.

R5 (2026-11-05): `every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.`

PASS. G2 requires surface `bottom`, mode `engrave`, depth 0.6 mm, and centroid z equal to that depth. The grader calls `placeBottomText` and `applyTextMarkingToPrintSolid`.

R6 Security: `never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes. Do not edit any existing [GATES ONLY - DO NOT MERGE] PR (including #405, #406, #407, #408, #409, #410, #413, #414, #416, #417, #418, #419, #420, #421, #424, #425, #426, #429, #430, and any other already-open gates PR). Do not edit other open worker PRs (#402, #427, #428, #431, or the heel-lift-cup-regression work).`

PASS. Proof output is gate numbers and a geometry hash. The string is synthetic `JABBOUR`. No Railway, no PR #310, no main push, no deploy, no database write. No existing gates PR and no listed worker PR was edited.

R7: `do not change worker code. Grade only. Outer surface, seams, layer-change placement, and surface quality may NOT change; seams and layer changes stay on the bottom/plantar face. The S1-PRELOFT 0.5×inset cap may NOT change.`

PASS. The worker branch was graded and not edited. Its diff does not change `SKEW_INSET_RATIO` (disk value 0.5). G3 rejects a slicer path and a ratio change off 0.5.

This change does not alter the outer surface, seams, layer-change placement, or surface quality, and it does not edit a worker PR or product code.
