# Heel-bridge watertight gates — results

Independent grade of worker draft PR #399. Gates were frozen before the candidate run. Do not merge.

- BASE SHA: `268aac85847160b5b2703a05688721ea4cb93b24`
- Candidate SHA: `ad1c3851fb9502f224002f91a875c639863f0323`
- Proof: PASS
- Candidate files: `ci/unit-test-shards.json`, `tests/heel-bridge-reverse-mortons.test.ts`, `vertex/src/lib/geometry/element-assets/apply-elements.ts`, `vertex/src/lib/geometry/elements.ts`

## Results

| Gate | Rule | BASE | Candidate | Measured vs threshold |
| --- | --- | --- | --- | --- |
| G1 | TESTS export | FAIL | PASS | BASE: design elements=2 left=1 right=1 heightMm=3,3 threshold height == 3; usMenSize=7.5 shoeWidth=medium thickness=3/3/3 / left export did not return a solid; heelBridgeSelfIntersections=4 threshold == 0; topVertexCount=null threshold >= 1000; bridgeTriangles=null threshold >= 1; si=4 productSi=4 open=0 nonManifold=0 watertight=true euler=2 topN=null bridge=null triangles=null sha256=none exported=false error=[MESH-CLOSE] heelBridgeSelfIntersections=4 exceeds baseline 0 / right export did not return a solid; heelBridgeSelfIntersections=6 threshold == 0; topVertexCount=null threshold >= 1000; bridgeTriangles=null threshold >= 1; si=6 productSi=6 open=0 nonManifold=0 watertight=true euler=2 topN=null bridge=null triangles=null sha256=none exported=false error=[MESH-CLOSE] heelBridgeSelfIntersections=6 exceeds baseline 0 // CANDIDATE: design elements=2 left=1 right=1 heightMm=3,3 threshold height == 3; usMenSize=7.5 shoeWidth=medium thickness=3/3/3 / left si=0 productSi=0 open=0 nonManifold=0 watertight=true euler=2 topN=7815 bridge=904 triangles=107992 sha256=60eab05f7ac4e8c8994e63169abf1f5b2273b9061d216c4833db0e422631ad16 exported=true / right si=0 productSi=0 open=0 nonManifold=0 watertight=true euler=2 topN=7815 bridge=904 triangles=107892 sha256=a264bcd08f41b3c7aa59f42dfcd89eef5351847830e5cbe1b0a4023f93e5e280 exported=true // threshold: reverse_mortons L+R height 3, thickness 3, US M 7.5 medium; each foot exports; frozen heelBridgeSelfIntersections == 0; openEdges == 0; nonManifold == 0; watertight; euler == 2; topVertexCount >= 1000; bridgeTriangles >= 1 |
| G2 | TESTS new test | FAIL | PASS | BASE: BASE has no worker diff, so the reproducing test is absent // CANDIDATE: added lines name reverse_mortons L+R, 7.5, thickness 3, heelBridgeSelfIntersections, watertight // threshold: candidate diff adds reverse_mortons, left, right, 7.5, thickness 3, heelBridgeSelfIntersections, and watertight. BASE fails this gate because that test is not on BASE. |
| G3 | TESTS existing | PASS | PASS | BASE: passed=30 failed=0 threshold failed == 0 and passed > 0; command node_modules/.bin/rstest run vertex/src/lib/geometry/elements.test.ts vertex/src/lib/geometry/anatomical-side.test.ts // CANDIDATE: passed=30 failed=0 threshold failed == 0 and passed > 0; command node_modules/.bin/rstest run vertex/src/lib/geometry/elements.test.ts vertex/src/lib/geometry/anatomical-side.test.ts // threshold: elements.test.ts and anatomical-side.test.ts exit with failed == 0 and passed > 0 |
| G4 | MUST-MATCH identity | PASS | PASS | BASE: SAMPLE_Top stock sha256 ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f md5 96969efc2727da8e85e063e59c6bbda4 / US M7.5 thickness 3 no elements sha256 60eab05f7ac4e8c8994e63169abf1f5b2273b9061d216c4833db0e422631ad16 md5 7c3d22733d9f4ef22bc34dfb92d5dc30 // CANDIDATE: SAMPLE_Top stock sha256 ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f matches BASE / US M7.5 thickness 3 no elements sha256 60eab05f7ac4e8c8994e63169abf1f5b2273b9061d216c4833db0e422631ad16 matches BASE // threshold: A design that exports watertight on BASE keeps the same STL sha256. Stock must be that anchor. The 7.5 / thickness 3 / no-element foot is an anchor only when BASE already exports it watertight. |
| G5 | MUST-MATCH baseline 0 | PASS | PASS | BASE: source baseline 0 and si > baseline / counters stock-left frozen=product=0; control-left frozen=product=0 // CANDIDATE: source baseline 0 and si > baseline / counters stock-left frozen=product=0; control-left frozen=product=0; defect-left frozen=product=0; defect-right frozen=product=0 // threshold: DEFAULT and procedural heelBridgeSelfIntersections stay 0; compare stays si > baseline; product counter equals the frozen BASE counter on every solid this run exported |
| G6 | R1 | PASS | PASS | BASE: seam limit=6 fallback=9.5 slack=0.01 spline=6.05 / files untouched / slicer lines none // CANDIDATE: seam limit=6 fallback=9.5 slack=0.01 spline=6.05 / files untouched / slicer lines none // threshold: SEAM_B_LIMIT_DEG == 6, SEAM_B_FALLBACK_DEG == 9.5, SEAM_B_SLACK_DEG == 0.01, SPLINE_SEAM_B_MAX_DEG == 6.05; bezier-column, wall-spline, reconstruct, print-recipe, kiri, python-service, vertexslice, and hardness diff empty; no new seam_position, layer_change, fuzzy_skin, or ironing line |
| G7 | R2 | PASS | PASS | BASE: default text surface=bottom mode=engrave / text files untouched // CANDIDATE: default text surface=bottom mode=engrave / text files untouched // threshold: default bottom text stays surface bottom and mode engrave; bottom-text-marking and text-marking diff empty; seam constants unchanged; no new top/side seam or layer-change line |
| G8 | R3 | PASS | FAIL | BASE: files (none) // CANDIDATE: outside the defect allowlist: ci/unit-test-shards.json; outside the defect allowlist: vertex/src/lib/geometry/element-assets/apply-elements.ts // threshold: diff stays on reverse Morton's height, the height field, the procedural loft, mesh-close, export close, and tests. Other subsystems are out of scope. |
| G9 | R4 | PASS | PASS | BASE: assetId=sample-top glbPath=Templates/SAMPLE_Top.glb / meshes untouched // CANDIDATE: assetId=sample-top glbPath=Templates/SAMPLE_Top.glb / meshes untouched // threshold: placed design base is sample-top and ends in SAMPLE_Top.glb; the SAMPLE_Top glb files are not in the diff |
| G10 | R5 | PASS | PASS | BASE: surface=bottom mode=engrave / no new engraving file // CANDIDATE: surface=bottom mode=engrave / no new engraving file // threshold: textMarking default remains bottom engrave; no new engraving system and no edit under text-marking or bottom-text-marking |
| G11 | R6 | PASS | PASS | BASE: no secret, PHI, railway, vertex-web, vertex-api, or deploy path in the diff // CANDIDATE: no secret, PHI, railway, vertex-web, vertex-api, or deploy path in the diff // threshold: diff has no api_key, bearer token, email, phone, or patient first/last name; no railway, vertex-web, vertex-api, workflow, or prisma migration path |
| G12 | R7 | PASS | PASS | BASE: SAMPLE_Top stock sha256 ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f md5 96969efc2727da8e85e063e59c6bbda4 // CANDIDATE: SAMPLE_Top stock sha256 ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f matches BASE // threshold: SAMPLE_Top stock, no corrections, left foot STL sha256 matches BASE and the solid is watertight with heelBridgeSelfIntersections == 0 |
| G13 | ONE | PASS | FAIL | BASE: files (none) // CANDIDATE: outside the defect allowlist: ci/unit-test-shards.json; outside the defect allowlist: vertex/src/lib/geometry/element-assets/apply-elements.ts // threshold: candidate diff is non-empty and inside the same allowlist as R3. BASE with an empty product diff passes. |
| G14 | PUSH | PASS | PASS | BASE: head=268aac85847160b5b2703a05688721ea4cb93b24 branch=cursor/heel-bridge-watertight-gates-1123 baseIsAncestor=true // CANDIDATE: head=ad1c3851fb9502f224002f91a875c639863f0323 branch=HEAD baseIsAncestor=true // threshold: HEAD == 268aac85847160b5b2703a05688721ea4cb93b24, branch is not main, BASE is an ancestor |

## Feet

| Case | BASE | Candidate |
| --- | --- | --- |
| stock | si=0 productSi=0 open=0 nonManifold=0 watertight=true euler=2 topN=7815 bridge=904 sha256=ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f md5=96969efc2727da8e85e063e59c6bbda4 exported=true baselineSeen=0 | si=0 productSi=0 open=0 nonManifold=0 watertight=true euler=2 topN=7815 bridge=904 sha256=ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f md5=96969efc2727da8e85e063e59c6bbda4 exported=true baselineSeen=0 |
| control | si=0 productSi=0 open=0 nonManifold=0 watertight=true euler=2 topN=7815 bridge=904 sha256=60eab05f7ac4e8c8994e63169abf1f5b2273b9061d216c4833db0e422631ad16 md5=7c3d22733d9f4ef22bc34dfb92d5dc30 exported=true baselineSeen=0 | si=0 productSi=0 open=0 nonManifold=0 watertight=true euler=2 topN=7815 bridge=904 sha256=60eab05f7ac4e8c8994e63169abf1f5b2273b9061d216c4833db0e422631ad16 md5=7c3d22733d9f4ef22bc34dfb92d5dc30 exported=true baselineSeen=0 |
| left | si=4 productSi=4 open=0 nonManifold=0 watertight=true euler=2 topN=null bridge=null sha256=none md5=none exported=false error=[MESH-CLOSE] heelBridgeSelfIntersections=4 exceeds baseline 0 baselineSeen=0 | si=0 productSi=0 open=0 nonManifold=0 watertight=true euler=2 topN=7815 bridge=904 sha256=60eab05f7ac4e8c8994e63169abf1f5b2273b9061d216c4833db0e422631ad16 md5=7c3d22733d9f4ef22bc34dfb92d5dc30 exported=true baselineSeen=0 |
| right | si=6 productSi=6 open=0 nonManifold=0 watertight=true euler=2 topN=null bridge=null sha256=none md5=none exported=false error=[MESH-CLOSE] heelBridgeSelfIntersections=6 exceeds baseline 0 baselineSeen=0 | si=0 productSi=0 open=0 nonManifold=0 watertight=true euler=2 topN=7815 bridge=904 sha256=a264bcd08f41b3c7aa59f42dfcd89eef5351847830e5cbe1b0a4023f93e5e280 md5=19074bf004644f9d21b3c05fe0b843a9 exported=true baselineSeen=0 |

## Proofs

Proof command: `HEEL_GATE_MODE=proof HEEL_GATE_LABEL=base HEEL_GATE_OUT=validation/heel_bridge_watertight_gates/proof.json node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

| Gate | No-op | Bad copy detected | Detail |
| --- | --- | --- | --- |
| G1 | PASS | PASS | clean foot passes; si 4 fails |
| G2 | PASS | PASS | full fixture passes; kind-only fixture fails |
| G3 | PASS | PASS | failed == 0 passes; one failure is detected |
| G4 | PASS | PASS | equal sha256 passes; one flipped nibble fails |
| G5 | PASS | PASS | baseline 0 passes; a copy set to 4 fails |
| G6 | PASS | PASS | frozen seam numbers pass; limit 9 and print-recipe fail |
| G7 | PASS | PASS | bottom engrave passes; wall emboss and a text-marking edit fail |
| G8 | PASS | PASS | empty diff and elements.ts pass; python-service fails |
| G9 | PASS | PASS | sample-top passes; a new mesh id and a replaced glb fail |
| G10 | PASS | PASS | bottom engrave passes; a new engraving file fails |
| G11 | PASS | PASS | empty diff passes; a workflow path and api_key fail |
| G12 | PASS | PASS | watertight stock predicate passes; openEdges 2 fails |
| G13 | PASS | PASS | elements.ts passes; cnc profile fails |
| G14 | PASS | PASS | pinned BASE head passes; main with a foreign sha fails |

Live stock no-op: si=0 productSi=0 open=0 nonManifold=0 watertight=true euler=2 topN=7815 bridge=904 sha256=ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f md5=96969efc2727da8e85e063e59c6bbda4 exported=true baselineSeen=0

Live existing tests: passed=30 failed=0 exit=0

Broken copies: {"baselineRejected":true,"stockSi4Rejected":true,"brokenTest":{"detected":true,"detail":"broken test exit 1 failedTests=1"}}

## Rule compliance

Each rule is quoted, then PASS or FAIL for BASE and for the candidate. Evidence is the gate measured value against its threshold.

### G1 TESTS export

> TESTS: new test reproducing the failure: reverse_mortons L+R (default 3 mm), thickness 3, US_M 7.5 Medium exports headless with heelBridgeSelfIntersections 0 and a watertight mesh; existing tests green

- BASE: FAIL
- Candidate: PASS
- Threshold: reverse_mortons L+R height 3, thickness 3, US M 7.5 medium; each foot exports; frozen heelBridgeSelfIntersections == 0; openEdges == 0; nonManifold == 0; watertight; euler == 2; topVertexCount >= 1000; bridgeTriangles >= 1
- BASE measured: design elements=2 left=1 right=1 heightMm=3,3 threshold height == 3; usMenSize=7.5 shoeWidth=medium thickness=3/3/3 | left export did not return a solid; heelBridgeSelfIntersections=4 threshold == 0; topVertexCount=null threshold >= 1000; bridgeTriangles=null threshold >= 1; si=4 productSi=4 open=0 nonManifold=0 watertight=true euler=2 topN=null bridge=null triangles=null sha256=none exported=false error=[MESH-CLOSE] heelBridgeSelfIntersections=4 exceeds baseline 0 | right export did not return a solid; heelBridgeSelfIntersections=6 threshold == 0; topVertexCount=null threshold >= 1000; bridgeTriangles=null threshold >= 1; si=6 productSi=6 open=0 nonManifold=0 watertight=true euler=2 topN=null bridge=null triangles=null sha256=none exported=false error=[MESH-CLOSE] heelBridgeSelfIntersections=6 exceeds baseline 0
- Candidate measured: design elements=2 left=1 right=1 heightMm=3,3 threshold height == 3; usMenSize=7.5 shoeWidth=medium thickness=3/3/3 | left si=0 productSi=0 open=0 nonManifold=0 watertight=true euler=2 topN=7815 bridge=904 triangles=107992 sha256=60eab05f7ac4e8c8994e63169abf1f5b2273b9061d216c4833db0e422631ad16 exported=true | right si=0 productSi=0 open=0 nonManifold=0 watertight=true euler=2 topN=7815 bridge=904 triangles=107892 sha256=a264bcd08f41b3c7aa59f42dfcd89eef5351847830e5cbe1b0a4023f93e5e280 exported=true
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G2 TESTS new test

> TESTS: new test reproducing the failure: reverse_mortons L+R (default 3 mm), thickness 3, US_M 7.5 Medium exports headless with heelBridgeSelfIntersections 0 and a watertight mesh; existing tests green

- BASE: FAIL
- Candidate: PASS
- Threshold: candidate diff adds reverse_mortons, left, right, 7.5, thickness 3, heelBridgeSelfIntersections, and watertight. BASE fails this gate because that test is not on BASE.
- BASE measured: BASE has no worker diff, so the reproducing test is absent
- Candidate measured: added lines name reverse_mortons L+R, 7.5, thickness 3, heelBridgeSelfIntersections, watertight
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G3 TESTS existing

> TESTS: new test reproducing the failure: reverse_mortons L+R (default 3 mm), thickness 3, US_M 7.5 Medium exports headless with heelBridgeSelfIntersections 0 and a watertight mesh; existing tests green

- BASE: PASS
- Candidate: PASS
- Threshold: elements.test.ts and anatomical-side.test.ts exit with failed == 0 and passed > 0
- BASE measured: passed=30 failed=0 threshold failed == 0 and passed > 0; command node_modules/.bin/rstest run vertex/src/lib/geometry/elements.test.ts vertex/src/lib/geometry/anatomical-side.test.ts
- Candidate measured: passed=30 failed=0 threshold failed == 0 and passed > 0; command node_modules/.bin/rstest run vertex/src/lib/geometry/elements.test.ts vertex/src/lib/geometry/anatomical-side.test.ts
- Command: `node_modules/.bin/rstest run vertex/src/lib/geometry/elements.test.ts vertex/src/lib/geometry/anatomical-side.test.ts`

### G4 MUST-MATCH identity

> MUST-MATCH: designs that already export watertight produce identical meshes; do not loosen the baseline 0 check

- BASE: PASS
- Candidate: PASS
- Threshold: A design that exports watertight on BASE keeps the same STL sha256. Stock must be that anchor. The 7.5 / thickness 3 / no-element foot is an anchor only when BASE already exports it watertight.
- BASE measured: SAMPLE_Top stock sha256 ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f md5 96969efc2727da8e85e063e59c6bbda4 | US M7.5 thickness 3 no elements sha256 60eab05f7ac4e8c8994e63169abf1f5b2273b9061d216c4833db0e422631ad16 md5 7c3d22733d9f4ef22bc34dfb92d5dc30
- Candidate measured: SAMPLE_Top stock sha256 ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f matches BASE | US M7.5 thickness 3 no elements sha256 60eab05f7ac4e8c8994e63169abf1f5b2273b9061d216c4833db0e422631ad16 matches BASE
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G5 MUST-MATCH baseline 0

> MUST-MATCH: designs that already export watertight produce identical meshes; do not loosen the baseline 0 check

- BASE: PASS
- Candidate: PASS
- Threshold: DEFAULT and procedural heelBridgeSelfIntersections stay 0; compare stays si > baseline; product counter equals the frozen BASE counter on every solid this run exported
- BASE measured: source baseline 0 and si > baseline | counters stock-left frozen=product=0; control-left frozen=product=0
- Candidate measured: source baseline 0 and si > baseline | counters stock-left frozen=product=0; control-left frozen=product=0; defect-left frozen=product=0; defect-right frozen=product=0
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G6 R1

> R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.

- BASE: PASS
- Candidate: PASS
- Threshold: SEAM_B_LIMIT_DEG == 6, SEAM_B_FALLBACK_DEG == 9.5, SEAM_B_SLACK_DEG == 0.01, SPLINE_SEAM_B_MAX_DEG == 6.05; bezier-column, wall-spline, reconstruct, print-recipe, kiri, python-service, vertexslice, and hardness diff empty; no new seam_position, layer_change, fuzzy_skin, or ironing line
- BASE measured: seam limit=6 fallback=9.5 slack=0.01 spline=6.05 | files untouched | slicer lines none
- Candidate measured: seam limit=6 fallback=9.5 slack=0.01 spline=6.05 | files untouched | slicer lines none
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G7 R2

> R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).

- BASE: PASS
- Candidate: PASS
- Threshold: default bottom text stays surface bottom and mode engrave; bottom-text-marking and text-marking diff empty; seam constants unchanged; no new top/side seam or layer-change line
- BASE measured: default text surface=bottom mode=engrave | text files untouched
- Candidate measured: default text surface=bottom mode=engrave | text files untouched
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G8 R3

> R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.

- BASE: PASS
- Candidate: FAIL
- Threshold: diff stays on reverse Morton's height, the height field, the procedural loft, mesh-close, export close, and tests. Other subsystems are out of scope.
- BASE measured: files (none)
- Candidate measured: outside the defect allowlist: ci/unit-test-shards.json; outside the defect allowlist: vertex/src/lib/geometry/element-assets/apply-elements.ts
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G9 R4

> R4 (2026-11-05): Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.

- BASE: PASS
- Candidate: PASS
- Threshold: placed design base is sample-top and ends in SAMPLE_Top.glb; the SAMPLE_Top glb files are not in the diff
- BASE measured: assetId=sample-top glbPath=Templates/SAMPLE_Top.glb | meshes untouched
- Candidate measured: assetId=sample-top glbPath=Templates/SAMPLE_Top.glb | meshes untouched
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G10 R5

> R5 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.

- BASE: PASS
- Candidate: PASS
- Threshold: textMarking default remains bottom engrave; no new engraving system and no edit under text-marking or bottom-text-marking
- BASE measured: surface=bottom mode=engrave | no new engraving file
- Candidate measured: surface=bottom mode=engrave | no new engraving file
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G11 R6

> R6 Security: never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy.

- BASE: PASS
- Candidate: PASS
- Threshold: diff has no api_key, bearer token, email, phone, or patient first/last name; no railway, vertex-web, vertex-api, workflow, or prisma migration path
- BASE measured: no secret, PHI, railway, vertex-web, vertex-api, or deploy path in the diff
- Candidate measured: no secret, PHI, railway, vertex-web, vertex-api, or deploy path in the diff
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G12 R7

> R7: designs and exports not affected by your defect must produce identical output to current main (prove with a before/after comparison on at least the SAMPLE_Top stock design with no corrections).

- BASE: PASS
- Candidate: PASS
- Threshold: SAMPLE_Top stock, no corrections, left foot STL sha256 matches BASE and the solid is watertight with heelBridgeSelfIntersections == 0
- BASE measured: SAMPLE_Top stock sha256 ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f md5 96969efc2727da8e85e063e59c6bbda4
- Candidate measured: SAMPLE_Top stock sha256 ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f matches BASE
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G13 ONE

> ONE: Fix the export failure: design 2be9d906 (order 2a31cd8e) Generate L failed with "Canonical Export mesh is not available headless. Refusing to substitute a different mesh. (MeshNotWatertightError: [MESH-CLOSE] heelBridgeSelfIntersections=4 exceeds baseline 0)". Design: reverse_mortons element L+R (3 mm default), thickness_mm 3, US_M 7.5, Medium.

- BASE: PASS
- Candidate: FAIL
- Threshold: candidate diff is non-empty and inside the same allowlist as R3. BASE with an empty product diff passes.
- BASE measured: files (none)
- Candidate measured: outside the defect allowlist: ci/unit-test-shards.json; outside the defect allowlist: vertex/src/lib/geometry/element-assets/apply-elements.ts
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

### G14 PUSH

> PUSH: new branch from BASE, never main. Worker head stays the pinned candidate SHA.

- BASE: PASS
- Candidate: PASS
- Threshold: HEAD == ad1c3851fb9502f224002f91a875c639863f0323, branch is not main, BASE is an ancestor
- BASE measured: head=268aac85847160b5b2703a05688721ea4cb93b24 branch=cursor/heel-bridge-watertight-gates-1123 baseIsAncestor=true
- Candidate measured: head=ad1c3851fb9502f224002f91a875c639863f0323 branch=HEAD baseIsAncestor=true
- Command: `HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts`

## Grader constraints

The grader did not change the outer surface, seams, layer-change placement, or surface quality. Product code and the worker's tests were not edited. Files added are only under `validation/heel_bridge_watertight_gates/`.

CAP 0/3: this run did not add a capability, a printer, a deploy, or a production-order change.

FILES: `validation/heel_bridge_watertight_gates/**` only.

PUSH: branch `cursor/heel-bridge-watertight-gates-1123` from BASE. Draft PR only. Worker branch, main, Railway, vertex-web, vertex-api, and PR #310 were not pushed.

## Observations outside the frozen thresholds

These notes do not change a gate.

- Candidate defect-left STL sha256 `60eab05f7ac4e8c8994e63169abf1f5b2273b9061d216c4833db0e422631ad16` (md5 `7c3d22733d9f4ef22bc34dfb92d5dc30`) equals the no-element control. Defect-right sha256 `a264bcd08f41b3c7aa59f42dfcd89eef5351847830e5cbe1b0a4023f93e5e280` does not. G1 still passes: its threshold is heelBridgeSelfIntersections == 0 and a watertight export, and both feet measure si=0, openEdges=0, nonManifold=0, euler=2, topN=7815, bridgeTriangles=904.
- The worker's new test `tests/heel-bridge-reverse-mortons.test.ts` was executed as extra evidence, not as G3. Command: `node_modules/.bin/rstest run tests/heel-bridge-reverse-mortons.test.ts` in a detached worktree at `ad1c3851`. Result: passedTests=4 failedTests=0 exit=0.
- Candidate CI already on `ad1c3851` (run 45231373710), not started by this grader: unit-tests (1) through (6) success, isolated-postgres-acceptance success, test-and-deploy success, default-procedural-smoke skipped. G3's frozen command is only `elements.test.ts` and `anatomical-side.test.ts` (30 passed, 0 failed).
- The results-table threshold cell repeats the BASE gate's threshold string. The rule-compliance section below is the per-run threshold. G14 candidate threshold is HEAD == `ad1c3851fb9502f224002f91a875c639863f0323`.
