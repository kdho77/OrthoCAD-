# Morton's shape gates — grade of worker PR #402

Independent grade. The gates in this directory were committed at `9fc3aa7d01754c92cc74803f07d6424389cae364` and were not edited after that commit. This file is the only addition after the freeze.

| Item | Value |
| --- | --- |
| Gates branch | `cursor/mortons-shape-gates-1123` from `main` @ `4a6c76f2e8acf7b62506090b96164dc74ca4e7ba` |
| Freeze commit | `9fc3aa7d01754c92cc74803f07d6424389cae364` |
| Candidate | PR #402 head `9df170cefde50c99e0cb5052b81d49047afa08da` |
| Worker PR base | `268aac85847160b5b2703a05688721ea4cb93b24` (scope diff is against this SHA, not against `4a6c76f2`) |
| Worker PR | https://github.com/kdho77/OrthoCAD-/pull/402 (draft, open, not merged) |
| Feet | left and right, US men's 9 stock. Every shape and mesh number below is identical on both feet. |
| Heights | 3 mm and 6 mm. Added height = with Morton's minus without. |

## How the gates were frozen

No-op proof, product code still `main` (this branch adds only `validation/mortons_shape_gates/**`):

```bash
./node_modules/.bin/rstest --config validation/mortons_shape_gates/rstest.gates.config.ts validation/mortons_shape_gates/gates.test.ts
```

Exit 0. Thirteen tests passed. The defect asserts require the old shape to fail G1, G2, G3, G4, G5, G6, the straight-line direction, the 8 mm bevel cap, the full-height line, and the outside-band check. G7, G8 at 3 mm, the lifted-vertex preview match, planform bytes, the stock hash, and the US 9 STL pins must pass. Recorded in `proofs/noop-main.json` and `proofs/noop-stl.json`. A second STL run matched the pins.

Bad-change proof is in the same file and always runs: a bulge, a drifting width, a dip and a ridge, a slope kink, a 2 mm bevel that is too steep, a moved vertex, a preview mismatch, a hardness or slicer path, a deleted `softFloor` guard, an unreported 6 mm residual, a substituted blend, a one-byte stock flip, and a warp of the real pad. Each of those fails its evaluator.

Grade command, after the freeze, candidate sources only (no product file in this repo was edited):

```bash
GATE_VERTEX=/tmp/mortons-candidate/vertex/src \
  MORTONS_GATE_MODE=grade \
  MORTONS_GATE_OUT=/tmp/grade-shape.json \
  MORTONS_STL_OUT=/tmp/grade-stl.json \
  ./node_modules/.bin/rstest --config validation/mortons_shape_gates/rstest.gates.config.ts \
  validation/mortons_shape_gates/gates.test.ts
```

Exit 0. Grade mode records the numbers and returns before the "defect must still be present" asserts. STL pin equality is asserted in both modes and passed. A green grade run is not a clinical pass. The table below is the grade.

## G1–G11

Thresholds are the frozen ones. "Main" is the no-op proof on this branch.

| Gate | Height | Main | Candidate | Threshold | Result |
| --- | --- | --- | --- | --- | --- |
| G1 95% contour off its best-fit line | 3 and 6 mm | 4.411559 mm (n=70) | 0.006084 mm (n=89) | ≤ 0.3 mm | PASS |
| G1 5% contour off its best-fit line | 3 and 6 mm | 12.919208 mm (n=89) | 0.006731 mm (n=89) | ≤ 0.3 mm | PASS |
| G2 fade-width spread about the median | 3 and 6 mm | 6.664153 mm | 0.013952 mm | ≤ 0.3 mm | PASS |
| G2 width, 95% to 5% | 3 and 6 mm | median 9.568 mm, max 16.232 mm | median 3.754 mm, max 3.760 mm | constancy above; cap in S2 | PASS constancy |
| G3 added height medial of the line, full-height line to toe−5 mm | 3 and 6 mm | fraction 0 (n=1471) | fraction 1 (n=1471) | ≥ 0.99 | PASS |
| G4 along v = 0.1 | 3 and 6 mm | 0.000310 | 1 (n=93) | ≥ 0.99 | PASS |
| G4 along v = 0.2 | 3 and 6 mm | 0.001021 | 1 (n=93) | ≥ 0.99 | PASS |
| G4 along v = 0.3 | 3 and 6 mm | ~0 | 0 (n=93) | ≥ 0.99 | FAIL |
| G5 rise after a local minimum, composed top | 3 mm | 1.490122 mm | 0 mm | ≤ 0.05 mm | PASS |
| G5 rise after a local minimum, composed top | 6 mm | 4.291661 mm | 0.584918 mm | ≤ 0.05 mm | FAIL |
| G6 4 mm-smoothed slope reversal | 3 mm | 0.109351 /mm | −0.003080 /mm | ≤ +0.02 /mm | PASS |
| G6 4 mm-smoothed slope reversal | 6 mm | 0.283421 /mm | 0.090539 /mm | ≤ +0.02 /mm | FAIL |
| G7 slope jump, both blend ends | 3 mm | 0.000931 / 0 | 0.001807 / 0.001807 /mm | ≤ 0.01 /mm | PASS |
| G7 second difference, both blend ends | 3 mm | 0.000931 / 0 | 0.001807 / 0.001807 /mm | ≤ 0.02 /mm | PASS |
| G7 slope jump and second difference | 6 mm | 0.001862 / 0 | 0.003613 / 0.003613 /mm | ≤ 0.01 and ≤ 0.02 | PASS |
| G8 bevel peak slope | 3 mm | 0.365484 /mm | 0.933966 /mm | ≤ 1.0 /mm | PASS |
| G8 bevel peak slope | 6 mm | 0.730968 /mm | 1.867933 /mm | report only | reported, not a fail |
| G9 no-Morton's and reverse STL, US 9, both feet | — | pins | identical to pins | byte-identical | PASS |
| G10 vertices outside the frozen band | 3 and 6 mm | 259 / 266 of 42134 | 154 of 42134 | 0 | FAIL |
| G10 planform (length and width) | 3 and 6 mm | 0 | 0 | 0 | PASS |
| G11 lifted vertices, \|mesh delta − field\| | 3 mm | 2.384e-7 mm | 4.709e-7 mm (n=6566) | ≤ 1e-6 mm | PASS on lifted vertices |
| G11 lifted vertices, \|mesh delta − field\| | 6 mm | 4.768e-7 mm | 4.768e-7 mm (n=6607) | ≤ 1e-6 mm | PASS on lifted vertices |
| G11 unlifted vertices with field > 90% nominal | 3 and 6 mm | 0 | 3 | 0 | FAIL |

G4 at v = 0.3 is a fail of the written threshold. The straight edge sits near v = 0.25 at the met heads, so v = 0.3 is lateral of the line and the added height there is 0. Lifting v = 0.3 would lift the second metatarsal head, which S1 forbids. v = 0.1 and v = 0.2 are 100% of nominal. The letter of G4 still fails.

G5 and G6 at 6 mm fail. The worker reported 0.844 mm of rise and 0.116 /mm. This gate, sampling the ray through the first MPJ parallel to the frozen medial chord, measures 0.584918 mm and 0.090539 /mm. Both pairs are over 0.05 mm and 0.02 /mm. At 3 mm both pass (rise 0, slope −0.003080 /mm).

G8 at 6 mm is 1.867933 /mm. The threshold of 1.0 applies at 3 mm only. The 6 mm value is reported.

G9 hashes, US men's 9, both feet, match `pins.ts`:

- none, left: `ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f`
- reverse, left: `00bf538d40b726980ecbac0a0170ae9729d359086d283c52d8ed6656be86d8b6`
- none, right: `9f865d8b380ad715a2ec10b208c2c5c74885737aaaa7ed7858c6334bd4f187c6`
- reverse, right: `97f2398e4a9acda780f9b4896f5a387b6d8f92c6090466487b8e8a805e3afafa`

US 8–11 were not re-run by this gate. The worker reported those sizes in `tests/one-click-baseline-parity.test.ts`.

G10. All 154 moved vertices sit distal of the neck (x from 200 mm to 250 mm; the full-height line is at 161.9 mm). Their lateral offset from the frozen line is 8 mm to 11 mm, and the thickness change there is a fraction of a millimeter (examples 0.001 mm and 0.079 mm). None are in the heel or proximal of the 25 mm blend. Planform changes are 0, so only thickness moves. The spill is the toe of a 6 mm bevel drawn on a line that aims at the medial border at u = 1, which sits about 4.15° off the frozen chord to u = 0.97. The worker's "0 of 35,219" used their own 6 mm bevel around their own line, and a different vertex count (35,219 versus this gate's 42,134 top-sheet vertices). Against the frozen band this gate fails G10.

G11. Vertices the mesh actually lifts match the field within 4.709e-7 mm at 3 mm and 4.768e-7 mm at 6 mm, inside 1e-6 mm. Three coincident vertices at one medial-rim point (x = 182.7 mm, mesh Y = −45.85 mm) predict the full nominal height and are not lifted (delta 0). The export path skips that point with the existing rim clip (`rimBandClipFactor` when the vertex is at the sheet edge). On main the miss count was 0, because the old pad did not reach that rim point at full height. The strict reading of "preview equals export within 1e-6 mm" fails at that point by the full 3 mm or 6 mm.

## S1–S7

**S1.** "Lateral edge = ONE straight line in plan, built in mm: through the midpoint between MPJ1 and MPJ2 centers (1st/2nd intermetatarsal space; ~v 0.255 at u 0.67 with current sinks) and the hallux/2nd-toe cleft; if no cleft, parallel to the 1st ray axis (medial forefoot contour MPJ1->toe)."

FAIL on the frozen direction. The 99% contour's best-fit is 4.149205° from the frozen medial chord (MPJ1 at u = 0.665 to the medial border at u = 0.97). Threshold is 2°. Distance from the intermetatarsal midpoint to that fit is 0.619632 mm, which passes 1.5 mm. G1 shows the edge is one straight line (0.006 mm). The 4.149° is the angle between the frozen chord (ending at u = 0.97) and the chord ending at the medial border at u = 1 (computed 4.149474°). The candidate aims at u = 1. There is no registered cleft. The edge is straight and it passes the midpoint. It is not parallel to the chord this gate froze.

**S2.** "Full height reaches the straight line. Drop-off outside it: constant-width bevel 2-3 mm (<=8 mm absolute max) from full height to zero, ~1 mm rounding at top and bottom, no wide taper. Remove lateralFeatherMm and the fillet from the lateral weight; do not multiply lateral and proximal fades."

Split. The 8 mm cap PASSES (`s2_bevel_over_8` is false; 95%-to-5% width max 3.760 mm). Constancy PASSES (G2 spread 0.013952 mm). The extension weight uses `Math.min` of the lateral bevel and the longitudinal blend, so the two fades are not multiplied, and the extension path does not use `lateralFeatherMm` or the fillet. Those stay on the reverse path only. The 2–3 mm aim FAILS: the implemented bevel constant is 6 mm. The code comment says a 2–3 mm quintic cannot also keep the 3 mm peak slope at or under 1.0 /mm. Peak slope at 3 mm is 0.933966 /mm (G8 PASS).

**S3.** "Full height from toe edge to 10-12 mm proximal of MPJ1 center (under 1st met neck). Nothing lowers height distal of that line."

PASS. The frozen line is 11 mm proximal of MPJ1. Added height on the ray at v = 0.1 is the full nominal (3 mm or 6 mm) at that line, and G3 is 1.0 from 10 mm proximal of MPJ1 out to toe−5 mm, medial of the line.

**S4.** "Proximal of that line: added height falls to exactly 0 over 25 mm with a smoothstep (tangent at both ends), added on top of the existing arch surface (arch shape unchanged). The straight lateral line continues through the blend; bevel shrinks with height."

PASS on the measured ends. At v = 0.1, height at the line is 3 or 6 and height 25 mm proximal is 0. G7 passes at both ends (slope jump and second difference 0.001807 /mm at 3 mm, 0.003613 /mm at 6 mm). The arch samples are the stock top plus the added height (134 of 201 stations hit the top sheet). Planform bytes are unchanged, so the arch mesh is not reshaped in plan. The straight edge continues through the toe bevel; see G10 for where that bevel leaves the frozen band.

**S5.** "If the 25 mm smoothstep cannot meet G5/G6 (no dip/ridge) at 6 mm height, do NOT substitute another construction: report measured values at 3 and 6 mm and STOP for Kendon. (CAD expert's alternative, a C1 smooth-max against the arch tangent, is only to be described in the report, not implemented.)"

PASS. G5 at 6 mm is 0.584918 mm (FAIL vs 0.05 mm). G6 at 6 mm is 0.090539 /mm (FAIL vs 0.02 /mm). At 3 mm both pass. The PR body says: "A 25 mm smoothstep cannot meet the no-dip / no-ridge gates at 6 mm height. Per the spec, the blend was not replaced." It reports the worker's own 6 mm numbers (0.844 mm rise, 0.116 /mm) and says a cubic was measured and also fails. Source at `9df170ce` uses a quintic smoothstep and `Math.min`. A search of `mortons-extension.ts` finds no `smoothMax`, `smooth-max`, or `smooth_max`. The C1 smooth-max is described in the PR and is not in the code.

**S6.** "Preview height field must equal export."

FAIL at one rim point, PASS on the lifted surface. See G11. Lifted vertices match within 4.709e-7 mm (3 mm) and 4.768e-7 mm (6 mm). Three coincident vertices at one medial-rim point predict full height and export as 0 because of the existing rim clip.

**S7.** "Reverse Morton's and all other elements unchanged."

PASS for the measured exports. Reverse Morton's STL, US 9, both feet, matches main byte for byte. No-Morton's STL matches main. Reverse still calls the legacy feathered outline. Other element kinds are not given a new formula. `height-field.ts` pulls only `mortons_extension` out of the feathered sum. That file is the scope miss under R3.

## R1–R7

**R1.** "print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality."

PASS for this change. The candidate diff does not touch a seam, layer-change, or surface-quality file. Planform changes are 0. The mesh edit is thickness on the existing top sheet. This grader did not change the outer surface, seams, layer-change placement, or surface quality.

**R2.** "seams and layer changes must always be on the bottom (plantar/belt face)."

PASS. No seam or layer file is in the diff. The string "seams and layer changes" is still present. Added height is on the top sheet only.

**R3.** "slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions."

FAIL the frozen allowlist. Allowed paths were `ci/unit-test-shards.json`, `vertex/src/lib/geometry/elements.test.ts`, `vertex/src/lib/geometry/elements.ts`, `vertex/src/lib/geometry/mortons-extension.ts`, and `vertex/src/lib/geometry/mortons-shape-gates.test.ts`. The candidate also edits `vertex/src/lib/geometry/height-field.ts`. That hunk takes `mortons_extension` out of the edge-feathered sum and adds it after the feather, so the preview matches the export. It is the preview hook for this shape, and it is outside the allowlist that was frozen before the grade. No other file is outside the allowlist. The blend was not replaced with a new construction (S5).

Candidate files (`git diff --name-only 268aac85 9df170ce`):

- `ci/unit-test-shards.json`
- `vertex/src/lib/geometry/elements.test.ts`
- `vertex/src/lib/geometry/elements.ts`
- `vertex/src/lib/geometry/height-field.ts` (out of the frozen allowlist)
- `vertex/src/lib/geometry/mortons-extension.ts`
- `vertex/src/lib/geometry/mortons-shape-gates.test.ts`

**R4.** "Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh."

PASS. Fixture and template `SAMPLE_Top` sha256 are both `2657b0a4f1a5ef1da8322f45348034ba93ecdb611f7d17c2f828206039e024d1`, the same on this branch and on the candidate. The extension is still an element on that mesh.

**R5.** "every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system."

PASS. No text-marking or engraving file is in the diff.

**R6.** "never print secrets (filter output through grep -v -i \"api_key\\|token\\|bearer\"); no PHI (design/order ids only); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes."

PASS for the worker diff and for this grader. No Railway, vertex-web, vertex-api, printer, or database file is in the diff. No secrets and no patient data are in this directory. This branch was not merged. Main was not pushed. The worker CI job named `test-and-deploy` aggregates unit shards and the isolated PostgreSQL acceptance job. Its steps checkout, install, boot-check, build the MCP package, and run the frozen CNC thickness gates. It does not deploy. This grader did not deploy.

**R7.** "no slicer, profile, hardness or infill change (a separate agent owns Morton's hardness; do not touch vertex/src/lib/hardness or print-recipe)."

PASS. No hardness, print-recipe, slicer, profile, or infill file is in the diff. The PR says the design-view ring is still the old polygon because the hardness overlay shares it, and that hardness was left for the other change.

Guard sentinels still present: `REMAINING_MATERIAL_MM`, `softFloor`, `assertClosedSolidAcceptable`, and "seams and layer changes". No safety guard in that list was removed.

## Header lines

**PUSH.** "new branch cursor/mortons-shape-gates-1123 (from BASE) -> ONE draft PR \"[GATES ONLY - DO NOT MERGE] mortons-shape gates\". Never push to the worker branch; never push/merge main, deploy, Railway (never touch vertex-web / vertex-api or #310), printers, production orders. Do NOT merge the worker PR or the gates PR."

PASS. This work is on `cursor/mortons-shape-gates-1123` from `4a6c76f2`. The worker branch was not pushed. Main was not pushed or merged. PR #402 was not merged. No Railway, printer, or production path was touched.

**FILES.** "validation/mortons_shape_gates/** only (new); read-only everything else - do not modify product code or the worker's tests - don't explore beyond."

PASS for this grader. The only new files are under `validation/mortons_shape_gates/`. Product code and the worker's tests were not modified.

**MUST-MATCH.** "gates are written and frozen BEFORE grading the candidate and never edited after; each gate has a no-op proof (passes on BASE where BASE should pass; the shape-defect gates themselves MUST FAIL on a no-op / main checkout) and a bad-change proof (fails on a deliberately broken copy). Worker's own MUST-MATCH: designs with no Morton's extension, and designs with a reverse Morton's, export byte-identical STL to current main; vertices outside the Morton's footprint plus its stated blend bands are byte-exact; SAMPLE_Top stock mesh untouched."

Split. The freeze, the no-op proof, and the bad-change proof PASS (see the commands above). No-Morton's and reverse STL, US 9, both feet, PASS (byte-identical to the main pins). `SAMPLE_Top` PASS (hash unchanged). Vertices outside the footprint plus the blend band FAIL against the frozen band: 154 top-sheet vertices still change thickness (G10).

**TESTS.** "run the frozen gates on BASE and on the candidate SHA; write results to validation/mortons_shape_gates/RESULTS.md. Do not modify the frozen gates after they are committed."

PASS. Both runs are the commands above. This file is the result. The frozen sources were not edited after `9fc3aa7d`.

**ONE.** "Independent grade of worker PR #402. Worker ONE line: Fix exactly two observed Morton's extension shape defects: (1) the lateral edge where it tapers toward the second toe is rounded, so the whole first ray is not evenly lifted - make it straight; (2) just before the arch the extension dips below full height - hold full height to the proximal end, then blend into the arch over 25 mm with no ridge."

PASS at the clinical 3 mm height, with the S5 stop at 6 mm followed. The lateral edge is straight (G1 0.006 mm). Full height reaches the neck line (S4 at the line equals 3 mm) and the 25 mm blend ends at 0, with no dip at 3 mm (G5 rise 0, G6 slope −0.003080 /mm). At 6 mm the dip and the ridge remain (G5 0.584918 mm, G6 0.090539 /mm) and the blend was not replaced. Direction versus the frozen u = 0.97 chord, G4 at v = 0.3, the 6 mm bevel versus the 2–3 mm aim, G10, and the one rim point are the residuals below.

**CAP.** 0/3. No retry of the worker. This grade did not edit the worker's code.

## Handoff

Candidate SHA `9df170cefde50c99e0cb5052b81d49047afa08da`. Gates frozen at `9fc3aa7d` before the grade. Do not merge this PR. Do not merge PR #402 from this grade.

Residuals for Kendon:

1. G5 / G6 at 6 mm fail (0.584918 mm rise, 0.090539 /mm). At 3 mm both pass. The 25 mm quintic was kept and the residual was reported. The C1 smooth-max is described in PR #402 and is not in the code.
2. The straight edge aims at the medial border at u = 1. Against the frozen chord to u = 0.97 the angle is 4.149205° (threshold 2°). It still passes 0.619632 mm from the intermetatarsal midpoint, and it is one straight line. That aim is why 154 toe-bevel vertices fall outside the frozen 8 mm band.
3. G4 at v = 0.3 is 0% of nominal. v = 0.1 and v = 0.2 are 100%.
4. The bevel is 6 mm, inside the 8 mm cap, outside the 2–3 mm aim. Peak slope at 3 mm is 0.933966 /mm.
5. Three coincident vertices at one medial-rim point predict full height and are not lifted.
6. `height-field.ts` is outside the frozen file allowlist. It is the preview hook. No listed safety guard was removed.

Next step is Kendon's, not another construction in this PR: keep the 25 mm quintic and accept the 6 mm residual, or change the blend; and choose whether the straight edge aims at the medial border at u = 1 or at the u = 0.97 chord this gate froze.

## Hard prohibition

This grader did not change the outer surface, seams, layer-change placement, or surface quality. Seams and layer changes stay on the bottom (plantar) face. The only files added are under `validation/mortons_shape_gates/`. No PHI is in this file or in the gates.
