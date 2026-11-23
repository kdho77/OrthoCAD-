# Morton's Extra Hard gates — results

Independent grade of worker draft PR #400. Gates were frozen in `a34f453fb61bf71a7bce4cb3c91fc682757b5278` before the candidate run. No gate file was edited after that commit. This file is the grade record only.

- BASE: `268aac85847160b5b2703a05688721ea4cb93b24`
- Candidate: `e5d2e410edbb91faed8a6fc5422cf09f5b4e6fe0` (PR #400 head; `grade-candidate.sh` aborted unless `FETCH_HEAD` matched that SHA)
- Overall: **FAIL** (candidate suite 17 passed, 3 failed, exit 1)

G-code was not compared. `VERTEXSLICE_SLICER_URL` is unset in this environment (`liveSlicerConfigured` is false). The grade is the slice request: STL bytes, 3MF modifier metadata, and the VertexSlice form fields `profile_id`, `material`, `infill_density`, `model`.

This grade did not change the outer surface, seams, layer-change placement, or surface quality. `git diff 268aac85` on this branch is only `validation/mortons_extra_hard_gates/`.

## Commands

| Step | Command | Result |
| --- | --- | --- |
| Freeze | commit `a34f453fb61bf71a7bce4cb3c91fc682757b5278` on `cursor/mortons-extra-hard-gates-1123` | gates only |
| No-op on frozen BASE | `./node_modules/.bin/rstest --config validation/mortons_extra_hard_gates/rstest.config.ts -t pass-on-base` | exit 0; 17 passed, 3 defect tests skipped; 64304 ms; report `2026-11-23T20:26:05.773Z` |
| Defect on frozen BASE | same binary, `-t defect-on-base` | exit 1; 3 failed, 17 skipped; 901 ms |
| Bad-change proofs | `./validation/mortons_extra_hard_gates/prove-bad-change.sh` | script exit 0; each broken copy's gate exited 1 |
| Candidate | `./validation/mortons_extra_hard_gates/grade-candidate.sh e5d2e410edbb91faed8a6fc5422cf09f5b4e6fe0` | suite exit 1; 17 passed, 3 failed; 63805 ms; report `2026-11-23T20:21:18.358Z`; cwd `/tmp/mortons-gates-candidate` |

## Results

| Gate | Threshold | BASE | Candidate |
| --- | --- | --- | --- |
| TABLE-EXTRA-HARD | Extra Hard 38% gyroid, 1.0 mm, 45.5 mm/s; ladder 14/20/26/32/38 | PASS | PASS |
| T1-EXPLICIT-CLASS | stored Hard stays 32%; stored Extra Hard stays 38 / 1.0 / gyroid | PASS | PASS |
| T1-REVERSE | unset reverse Morton's region count 0 | PASS | PASS |
| T1-MET-UNSET | unset met pad region count 0 | PASS | PASS |
| FOOTPRINT-MEDIAL-SIGN | left centroid Y < 0, right > 0, ≥ 100 cells | PASS | PASS |
| MET-MODIFIER-KEYS | Soft met modifier 20% gyroid, line width 0.7, allowlisted keys, ≥ 30 cells | PASS | PASS |
| UPLOAD-EQUALS-STL | empty design upload sha256 equals the STL | PASS | PASS |
| FORM-KEYS | infill `26`; keys exactly `infill_density`, `material`, `model`, `profile_id`; profile `apex-v2-insole-95a`; material `apex_core`; logged model `left.stl` | PASS | PASS |
| REGIONAL-FLAG-OFF | flag off, upload is the STL | PASS | PASS |
| R4-SAMPLE-TOP | asset `sample-top`, glb `Templates/SAMPLE_Top.glb` | PASS | PASS |
| R5-TEXT | surface `bottom`, mode `engrave`, text empty; sha256 `468f76ab266e051293ce693ae06da980b2ad832f9f1041acfa9bed8e4ca19505` | PASS | PASS |
| R1-R2-R3-R6 diff | forbidden paths empty; hardness-class-table absent; no new non-test product file; secret-like added lines 0 | PASS (diff empty) | **FAIL** — secret-like added lines measured 1, threshold 0. Forbidden paths, class table, and new product files were empty (the failure is the last assertion). The line is in `vertex/src/lib/hardness/collect.test.ts` and assigns `VERTEXSLICE_API_KEY`. Value length 8, not printed. |
| MM-EXPLICIT-SPLIT-ON | threw `true`; error `Hardness 3MF export failed: missing region snapshot-mortons_extension-left-1 (element Hard)`; model sha256 empty | PASS | **FAIL** — threw measured `false`, error empty. Follow-up measurement of the same `regionalPack` call: model sha256 `c7b78249ae49519d386668eb15365cbd0cfe3dd02bb389b798316156a7664fcd`, modifier density `32%`, class `Hard`. |
| MM-EXPLICIT-SPLIT-OFF | STL upload sha256 `82cff93cb4070daa3577475c826056983be1719d10d3e0ecdf2b408aaef45ee7`; infill `26`; four form keys | PASS | PASS |
| MM-LOFT | stock `a726fb2f79996c550e71878dfb5deda294a984c62b765650bc426c3087ee856b`; unset met `29e36ba22cb51f2c178b126173f247db4c97e524c763943926bd9b496a7d2417`; unset Morton's `954322dbd8c685b87b89f849143af706e6e4921c56d67db085eacc2b95559e5d` | PASS | PASS |
| MM-MET-SOFT | 3MF sha256 `4cc2c9fe749f967b6452d79f6dac492c7788562a9c8b6d011642081122ddf228` | PASS | PASS |
| EXISTING-TESTS | the nine listed hardness, snapshot, anatomical-side, and slice-request files exit 0 | PASS | PASS |
| T1-COLLECT | unset Morton's: stored class undefined; region count 1; Extra Hard; 38%; gyroid; line width 1.0; speed 45.5 | **FAIL** — count measured 0, threshold 1 | PASS |
| T2-SAVED-DESIGN | one modifier, `sparse_infill_density` `38%`, gyroid, line width `1.0`, speed `45.5`, class Extra Hard, name `mortons_extension`, allowlisted meta keys, footprint coverage ≥ 0.65, AABB within 4 mm, heel clearance ≥ 20 mm, \|centroid delta Y\| ≤ 8 mm | **FAIL** — modifier count measured 0, threshold 1 | **FAIL** — count 1, density `38%`, gyroid, line width `1.0`, speed `45.5`, Extra Hard, name `mortons_extension`, meta keys matched, then coverage measured 0, threshold 0.65 |
| ONE-ADD-WHILE-SPLIT | a Morton's added while split is already on resolves to Extra Hard, 38%, line width 1, gyroid | **FAIL** — class measured Medium | PASS |

## T2 footprint measurement

The frozen T2 assertion stopped at coverage. A same-harness measurement on the candidate worktree (probe file deleted afterward; not part of the frozen suite) recorded the modifier bounds:

- Morton's planform (mesh Y, `elementHeightAt`): X 169–259 mm, Y −46.5 to −14.5 mm, 2508 cells
- Modifier mesh: X 169–241.75 mm, Y 13.5–25 mm
- Coverage 0 (threshold 0.65). Centroid delta Y 48.43 mm (threshold ≤ 8). Heel clearance 157 mm (threshold ≥ 20) was not reached by the frozen assertion.
- Upload filename `model.3mf`, content type `model/3mf`, `threw` false. Browser and server bytes agreed, because `regionalPack` throws when they differ.

`vertex/src/lib/hardness/prism.ts` on the candidate centers the Morton's scan at `heightFieldYFromMeshY(el.position.y)`, which is the opposite sign of mesh Y. The pad planform stays at negative mesh Y on the left foot. The 38% modifier is on the other side of the centerline.

## Bad-change proofs

Each proof patched a detached checkout of BASE, left the gates untouched, and exited 1:

| Proof | Broken change | Measured failure |
| --- | --- | --- |
| table | Extra Hard density 38 → 99 | `Extra Hard density measured 99 threshold 38` |
| scope | every unset element forced to Extra Hard | reverse count measured 1, threshold 0; met count measured 1, threshold 0 |
| soft | unset Morton's forced to Soft | `class measured Soft` vs Extra Hard |
| r5 | default text marking mode engrave → emboss | measured `emboss` vs `engrave` |
| form | form appends `seam_position=top` | keys measured include `seam_position` |
| upload | STL upload bytes gain one extra byte | upload sha equals STL sha measured false |

## Candidate diff

`git diff --name-only 268aac85 e5d2e410` (validation gates excluded; the candidate commit does not contain them):

- `ci/unit-test-shards.json` (registers `collect.test.ts`)
- `vertex/src/lib/clinical/saved-design-snapshot.test.ts`
- `vertex/src/lib/geometry/elements.ts` (`defaultHardnessClass: "Extra Hard"` on `mortons_extension` only)
- `vertex/src/lib/hardness/collect.test.ts`
- `vertex/src/lib/hardness/collect.ts`
- `vertex/src/lib/hardness/prism.ts`
- `vertex/src/stores/design-store.elements.test.ts`
- `vertex/src/stores/design-store.ts`

`hardness-class-table` is not in the diff. No new non-test product file. No `vertex-web`, `vertex-api`, Railway, Prisma migration, text-marking, procedural-wall, or seam path.

## Rule-compliance report

ASK (Kendon, 2026-11-23, verbatim): "I found a new print problem. Morton extension print very very soft and should be solid, how can we narrowly fix this?" then (11:29 AM MT) "Make the Morton's extension Extra Hard 38% instead of solid"

**FAIL.** T1 measures Extra Hard, 38%, gyroid, 1.0 mm, 45.5 mm/s for an unset Morton's element. T2 measures one modifier at `sparse_infill_density` `38%`. That modifier's Y is 13.5–25 mm. The Morton's planform Y is −46.5 to −14.5 mm. Coverage measured 0, threshold 0.65. The pad that prints soft is not the region at 38%.

R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.

**PASS** at slice-request level. Manufacturing STL sha256 matches the frozen baseline for stock (`a726fb2f…`), unset met (`29e36ba2…`), and unset Morton's (`954322db…`). FORM-KEYS measured the form keys as exactly `infill_density`, `material`, `model`, `profile_id`. The diff has no procedural-wall, seam, or text-marking path. G-code was not sliced.

R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).

**PASS** at slice-request level. No seam path is in the diff. FORM-KEYS measured no seam, wall, skin, or layer form key. The bad-change `form` proof fails when `seam_position=top` is appended. G-code was not sliced.

R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.

**PASS** on the frozen construction checks. TABLE-EXTRA-HARD passed (no new class; Extra Hard stays 38). T1-REVERSE measured region count 0. New non-test product files measured none. `hardness-class-table` is absent from the diff. Modifier meta keys matched the existing allowlist. `ci/unit-test-shards.json` only adds `vertex/src/lib/hardness/collect.test.ts`.

R4 (2026-11-05): Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.

**PASS.** R4-SAMPLE-TOP measured asset `sample-top` and glb `Templates/SAMPLE_Top.glb`. MM-LOFT measured the three left STL sha256 values equal to the frozen baseline, including the unset Morton's shell `954322dbd8c685b87b89f849143af706e6e4921c56d67db085eacc2b95559e5d`.

R5 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.

**PASS.** R5-TEXT measured surface `bottom`, mode `engrave`, text empty, sha256 `468f76ab266e051293ce693ae06da980b2ad832f9f1041acfa9bed8e4ca19505`. No text-marking path is in the diff. No patient name was printed.

R6 Security: never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes.

**FAIL.** Secret-like added lines measured 1, threshold 0. The added line is in `vertex/src/lib/hardness/collect.test.ts` and assigns `process.env.VERTEXSLICE_API_KEY`. The value is 8 characters and was not printed. Forbidden paths measured none: no `vertex-web`, `vertex-api`, Railway, or Prisma migration. This grade did not push main, deploy, or write a database.

R7: only sparse infill inside the Morton's footprint may change. Outer walls, skins, top/bottom surfaces, seams, layer changes, name engraving and all G-code outside that footprint stay identical to current main (prove with a before/after slice comparison on one Morton's design if the slicer is reachable in CI; otherwise prove at the slice-request level and say so).

**FAIL.** The slicer was not reachable, so this is the slice request. The unset Morton's shell STL matches baseline `954322db…`. Stock and unset-met STLs match. The met Soft 3MF matches `4cc2c9fe…`. The new Morton's modifier is at Y 13.5–25 mm. The footprint is Y −46.5 to −14.5 mm. Coverage measured 0, threshold 0.65. That is a sparse-infill change outside the Morton's footprint. G-code outside the footprint was not compared.

R8: if the server production path cannot carry element hardness regions to VertexSlice without new construction, STOP and report exactly what is missing instead of building it.

**PASS.** The existing path carried the region. T2 measured `threw` false and region count 1. The follow-up measurement recorded filename `model.3mf`. `regionalPack` throws when `buildVertexSliceModel` bytes differ from `buildRegional3mfFromSavedSettings`; that throw did not happen. No new modifier-builder file is in the diff.

MUST-MATCH: any design with no Morton's extension, and any Morton's element that already has an explicit hardnessClass, produces byte-identical slice inputs (3MF/modifiers/form fields) and G-code to current main

**FAIL.** No-Morton's inputs match: stock STL `a726fb2f…`, unset met STL `29e36ba2…`, met Soft 3MF `4cc2c9fe…`, empty-design upload equals the STL, form infill `26` and the four keys. Explicit Hard with split off matches STL sha256 `82cff93c…`. Explicit Hard with split on does not: baseline throws `Hardness 3MF export failed: missing region snapshot-mortons_extension-left-1 (element Hard)` with an empty model sha256; the candidate measured `threw` false and model sha256 `c7b78249ae49519d386668eb15365cbd0cfe3dd02bb389b798316156a7664fcd`. G-code was not compared.

TESTS: (1) a Morton's extension element with no hardnessClass resolves to an Extra Hard (38% gyroid, 1.0 mm line width per hardness-class-table) element region in collectHardnessRegions; (2) the server production slice request for a saved design with a Morton's extension carries that region as a modifier at sparse_infill_density 38% covering only the Morton's footprint; (3) MUST-MATCH byte-identity on SAMPLE_Top stock with no elements and on a design with a non-Morton's element; existing tests green

**(1) PASS.** T1-COLLECT on the candidate measured count 1, class Extra Hard, density 38, pattern gyroid, line width 1.0, speed 45.5. On BASE the same gate measured count 0.

**(2) FAIL.** T2 measured density `38%`, gyroid, line width `1.0`, speed `45.5`, one modifier named `mortons_extension`, then footprint coverage 0, threshold 0.65. The modifier does not cover the Morton's footprint.

**(3) PASS.** MM-LOFT stock and unset-met sha256 match the baseline. MM-MET-SOFT matches. EXISTING-TESTS exited 0 on the candidate.

ONE: The Morton's extension prints very soft (observed by Kendon in a printed insole 2026-11-23); it gets only the device infill (e.g. Medium 26%). Make a Morton's extension with no explicit hardness default to the existing Extra Hard hardness class (38%) through the existing per-element hardness region / regional modifier machinery, on both the browser export and the server production (MCP/production bot) path. Reuse existing code only: no new hardness class, no new modifier construction, no geometry change.

**FAIL.** The class default and the reused machinery are present: T1 passed, TABLE passed, the unset Morton's STL sha256 is unchanged, and browser and server 3MF bytes agreed. The modifier that machinery emits is outside the pad (coverage 0, modifier Y 13.5–25 mm, planform Y −46.5 to −14.5 mm), so the extension still does not get the 38% region. ONE-ADD-WHILE-SPLIT did pass: class Extra Hard, density 38, line width 1, gyroid.

## Grader self-check

PUSH: new branch `cursor/mortons-extra-hard-gates-1123` from BASE, one draft PR titled `[GATES ONLY - DO NOT MERGE] mortons-extra-hard gates`. The worker branch, `main`, Railway, `vertex-web`, `vertex-api`, and PR #310 were not pushed or modified.

FILES: `validation/mortons_extra_hard_gates/**` only. Product code and the worker's tests were not modified.

MUST-MATCH (grader): gates frozen at `a34f453f` before `grade-candidate.sh`. Each gate has a no-op proof (pass-on-base exit 0 on BASE) and a bad-change proof (six broken copies, each gate exit 1).
