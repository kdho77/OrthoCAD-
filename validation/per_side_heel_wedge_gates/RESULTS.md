# Per-side heel wedge gate results

Frozen gates: commit `b78b150b8ed827180679776f6b26f4fa0c8deffd` on `cursor/per-side-heel-wedge-gates-1123`, written before this grade. Gate sources were not edited after that commit.

| Tree | SHA | Command |
| --- | --- | --- |
| BASE | `268aac85847160b5b2703a05688721ea4cb93b24` | `node validation/per_side_heel_wedge_gates/prove.mjs noop` |
| Candidate (PR 395 head) | `a77214bb89bd184d7b10b9200ed79c29c5c076af` | `node validation/per_side_heel_wedge_gates/prove.mjs candidate` |

Both commands run `npx rstest run --config validation/per_side_heel_wedge_gates/rstest.config.ts` in that tree. Existing tests are `npx rstest run --maxConcurrency 1` on the five posting, wedge, saved-design, and MCP persist files named in the gate.

Thresholds, measured on BASE by setting the existing `rearfootWedge` field (not from the candidate): heel chord 58.468 mm, medial-edge rise `chord * tan(2°)` = 2.0418 mm, lateral-edge field 0 mm, medial rim lift 1.8429 mm at v = -0.805, lateral rim lift 0.2072 mm at v = 0.797. Field tolerance 0.02 mm. Lift tolerance 0.05 mm. Design SHA-256 and STL MD5 compared exactly to `thresholds.json`.

## Candidate vs BASE

| Gate | BASE | Candidate | Candidate measured value | Threshold |
| --- | --- | --- | --- | --- |
| R1 | PASS | PASS | 0 surface/seam/layer files changed | 0 |
| R2 | PASS | PASS | seam and layer placement files match BASE | 0 changes |
| R3 | PASS | PASS | 8 changed product files, all on the catalog/persist/test allowlist | no file outside that allowlist |
| R4 | PASS | PASS | asset `sample-top`, path `Templates/SAMPLE_Top.glb`, 0 new mesh files | SAMPLE_Top template, 0 new meshes |
| R5 | PASS | PASS | 0 text-marking files changed; surface bottom; mode engrave; addPatientName true | those four |
| R6 | PASS | PASS | 0 deploy paths, 0 secret-like lines, 0 patient-name lines, main still `268aac85`, head not merged | all zero, main unmoved |
| R7 | PASS | PASS | stock design `c608222a…438ce`; left STL `83baf394…89fe0`; right STL `87f9a443…3cab2` | exact match to BASE |
| MUST-MATCH | PASS | PASS | bilateral wedge design `fd7c3861…4d45`; posting design `7d9c5086…8bfe`; bilateral STL left `97684f4f…1dfc`, right `868c6d77…9bd4`; posting deg 2/2; stock wedges unset | exact match to BASE |
| TESTS readback | FAIL | PASS | right `{side: medial, value: 2, unit: deg, degreeMode: station}`; left wedge null; both `rearfootPostingDeg` 0; `varus` rejected | that readback |
| TESTS export | FAIL | PASS | medial field 2.0418 mm; lateral field 0.0000 mm; medial lift 1.8429 mm; lateral lift 0.2072 mm; right STL `868c6d77…9bd4`; left STL `83baf394…89fe0` | field within 0.02 mm of 2.0418; lifts within 0.05 mm of 1.8429 and 0.2072; right STL equals the existing-field export; left STL equals stock |
| TESTS existing | PASS | PASS | exit 0, 74 tests, 0 failures | exit 0 |
| ONE | FAIL | FAIL | geometry files changed 0; new geometry files 0; documented false; existing right medial field 2.0418 mm; catalog readback and export true | documentation must contain the character sequence `raises the medial` and `raises the lateral` on the persist tool, the create tool, and the MCP bundle, and the catalog export must pass |

BASE fails the readback, export, and ONE gates because `rearfoot_wedge_by_side` is an unrecognized catalog key. That is the missing feature, not a gate crash.

## Why ONE fails on the candidate

Behavior matches the existing post. The persist tool text says `side medial raises that foot's medial heel`, which does not contain the frozen sequence `raises the medial`. The create tool and the schema comment do contain `raises the medial heel`. The gate requires that sequence on the persist description as well. Geometry files are unchanged and the catalog export matches the existing field, so this failure is the documentation check only.

## Pre-candidate proofs (before the candidate run)

| Proof | Result |
| --- | --- |
| noop on BASE | R1–R7, MUST-MATCH, existing tests PASS; readback, export, ONE FAIL |
| bad slicer comment | R1, R2, R3 FAIL |
| bad `api_key` assignment | R6 FAIL (1 secret-like added line, value not recorded) |
| bad text surface `wall` | R5 FAIL |
| bad 1 mm mesh translate | R7 and MUST-MATCH FAIL |
| bad wiring onto the other foot | readback, export, ONE FAIL; R3, R7, MUST-MATCH PASS. Persisted wedge was on the left, right null. Right medial field 0.0000 mm. Left STL became the wedged hash `97684f4f…1dfc` |
| bad medial sign flip in `wedge.ts` | export, existing tests, ONE, R3 FAIL; R7 PASS. Medial field 0.0000 mm, lateral field 2.0418 mm, medial lift 0.1989 mm, lateral lift 1.8345 mm |
| good expose of the existing field | all 12 gates PASS. Medial field 2.0418 mm, medial lift 1.8429 mm, left STL stayed the stock hash |

## Rule-compliance report (candidate `a77214bb`)

R1: "print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality." PASS. 0 surface/seam/layer files changed against BASE.

R2: "seams and layer changes must always be on the bottom (plantar/belt face)." PASS. The slicer, seam, loft, and layer-placement files match BASE.

R3: "slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions." PASS. 8 changed files, all on the catalog, persist, MCP schema/bundle, and test allowlist. `wedge.ts` and `posting-degrees.ts` are unchanged.

R4: "Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh." PASS. Built design asset `sample-top`, glb `Templates/SAMPLE_Top.glb`, 0 new mesh files. The 2° value is the requested degree, not an invented millimetre.

R5: "every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system." PASS. 0 text-marking files changed. Stock marking is surface bottom, mode engrave, addPatientName true.

R6: "Security: never print secrets (filter output through grep -v -i \"api_key\\|token\\|bearer\"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy." PASS. 0 deploy or `package.json` paths, 0 secret-like added lines, 0 patient-name added lines. `main` is still `268aac85847160b5b2703a05688721ea4cb93b24`. The candidate commit is not contained in `main`.

R7: "designs and exports not affected by your defect must produce identical output to current main (prove with a before/after comparison on at least the SAMPLE_Top stock design with no corrections)." PASS. SAMPLE_Top US men's 9 with no corrections: design SHA-256 and both foot STL MD5 values equal BASE.

MUST-MATCH: "bilateral posting and designs without wedges unchanged." PASS. Bilateral 2° station wedge design hash, bilateral `rearfoot_posting_deg` 2 design hash, and bilateral STL MD5 values equal BASE. Stock wedges are unset.

TESTS: "new tests: right-only 2 degree medial heel wedge reads back on R only with the correct sign (medial = raises the medial side), L unchanged; export geometry shows the medial heel raised by the expected amount for 2 degrees; existing tests green." PASS on the three measured parts. Readback is the right foot only, value 2, side medial, degreeMode station, left unset, both posting degrees 0. Export medial field 2.0418 mm versus threshold 2.0418 ± 0.02 mm, medial lift 1.8429 mm versus 1.8429 ± 0.05 mm, left STL equal to stock. Existing tests exit 0 (74 tests, 0 failures).

ONE: "Let a production design carry a heel wedge on one side only, in degrees, with an unambiguous medial/lateral sign, using the existing heel posting/wedge geometry (no new construction). If the existing geometry already supports per-side wedges, only expose and document it; if it needs new geometry, STOP and report." FAIL. The geometry is the existing post and the catalog export matches it, but the persist tool description does not contain the frozen sequence `raises the medial` (it says `raises that foot's medial heel`). Documented = false against a threshold of true.
