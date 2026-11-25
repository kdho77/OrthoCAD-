# Production-path plantar name gates

Draft gates only. Do not merge. No product code in this branch.

BASE `d20ca6e9baa0a7ea1c706e1f05f8e3ac03391d5f` (`origin/main` at branch time: Bump plantar-name LIVE_IMAGE to the live #52 image, #448). The requested pin `3932a6448befbe9c8f07e587be6570fcde3d3352` is an ancestor. Branch `cursor/name-chirality-gates-1124`.

Synthetic string `JABBOUR`. Designs are named by id only.

Image sliced locally: `ghcr.io/kdho77/vertexslice-server@sha256:979e31bdf64b2eab4559717b8cc4e862a030fc35e235be2482c253cb2fd3b782`.

Reading frame: #442 `physicalReadingView` after the live #52 Y-negate and `beltPrintedPoint`. `bottomimg.py` was not used. Thresholds in `tests/name-plantar-e2e/thresholds.ts` are the #435 numbers (`G1_MIN_ADVANCE_MM = 20`, `G1_AXIS_MIN = 0.5`). They were not edited. `tests/name-plantar-e2e/chirality.test.ts`: 7 passed.

## No-op (identity on BASE)

Command:

```bash
npx rstest tests/name-plantar-e2e/production-path-gates.test.ts
```

Exit 1. Duration 316233 ms for the gate test. The STL writer test in the same file passed. Failure:

`0d3db1c0|right G1 letter walls 1 (need 7 for JABBOUR)`

Bad-change assertions run before that line and passed (a failure there would have stopped the test earlier).

Real G-code, same BASE STLs, live #52 image, `apex_core` / `toe_first`:

```bash
NAME_PLANTAR_SKIP_BASE=1 NAME_PLANTAR_VARIANT_STL_DIR=/tmp/name-plantar/variant-stl \
  bash tests/name-plantar-e2e/slice-feet.sh \
  ghcr.io/kdho77/vertexslice-server@sha256:979e31bdf64b2eab4559717b8cc4e862a030fc35e235be2482c253cb2fd3b782 \
  /tmp/name-plantar/stl /tmp/name-plantar/gcode
NAME_PLANTAR_GCODE_DIR=/tmp/name-plantar/gcode \
  npx rstest --config tests/name-plantar-e2e/rstest.config.ts \
  tests/name-plantar-e2e/production-gcode.optional.test.ts
```

Slice: four files, HTTP 200, about 10 s each. Grade exit 1.

| Cell | G1 | Measured |
| --- | --- | --- |
| control-442 left (STL frame) | PASS | a=0.951470 d=0.889669 advance 71.695 mm hook true sequence JABBOUR foot left |
| control-442 right (STL frame) | PASS | a=0.963460 d=0.610368 advance 71.666 mm hook true sequence JABBOUR foot right |
| ad1e0cc5 left STL and G-code | PASS | G-code a=0.946565 d=0.637597 b=-0.003614 c=0.006415 advance 71.917 mm match 0.315 mm hook true sequence JABBOUR heelHigh true delta 22.02 mm |
| ad1e0cc5 right STL and G-code | PASS | G-code a=0.953301 d=0.631731 b=-0.023612 c=0.009261 advance 72.022 mm match 0.341 mm hook true sequence JABBOUR heelHigh true delta 22.02 mm |
| 0d3db1c0 left STL and G-code | PASS | G-code a=0.961194 d=0.871664 b=-0.011858 c=0.004677 advance 72.012 mm match 0.342 mm hook true sequence JABBOUR heelHigh true delta 21.56 mm |
| 0d3db1c0 right STL and G-code | FAIL | STL letter walls 1. G-code letter walls 0 (need 7). a=0 d=0 advance 0 sequence empty. yCut fell through to 1.6 mm because the 0.6 mm band has no letters |

The same G1 miss is on every US M 11.5 right cell: `0d3db1c0`, `0d3db1c0-hard`, `0d3db1c0-linked`, `0d3db1c0-heel0`, `ad1e0cc5-size11.5`. Size 12 right passes, including `0d3db1c0-size12` and `ad1e0cc5-heel12`. Hardness, `corrections.linked`, heel lift 0 vs 12, and pair vs single do not change the result once size and side are fixed. Overall the identity run fails.

What the loft actually does on that right foot: `applyExportText` is called with text `JABBOUR`, feet both, engrave, depth 0.6, placementU 0.32, beltPrint true, and the engrave throws `[TEXT] manifold status Not manifold`. The catch returns the unengraved solid. The manufacturing STL and the live #52 G-code therefore have no letter walls. This is not a mirrored `JABBOUR` (that would be seven walls, `d < 0`, sequence `JABBOUR` or `RUOBBAJ`). The temporary log used to read that message was reverted. `git diff` of `vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts` is empty.

`ad1e0cc5` and the #442 control already pass G1. Thresholds were not moved to make the missing right foot pass.

## G2 handedness on the live slices

`detectGcodeFoot` (the #439 port). End-fifth and arch gaps are above 5.0 mm.

| File | foot | heel end max Y | toe end max Y | arch X- | arch X+ |
| --- | --- | --- | --- | --- | --- |
| 0d3db1c0 left | left | 34.42 | 12.86 | 17.47 | 34.68 |
| 0d3db1c0 right | right | 46.47 | 12.86 | 42.95 | 25.48 |
| ad1e0cc5 left | left | 34.88 | 12.86 | 17.84 | 35.11 |
| ad1e0cc5 right | right | 34.88 | 12.86 | 35.11 | 17.68 |

`heelHighZt` is true on all four (toe-first). A left request is a physical left. A right request is a physical right, including the foot whose name is missing.

## G3 surface, seams, engrave parameters

Every cell: sole min z = 0. Default `textMarking` is engrave, depth 0.6, placementU 0.32, surface bottom, cap 12. Feet that engrave have floor median z = 0.6. Non-text SHA-256 values in `tests/name-plantar-e2e/frozen-surface-hashes.ts` matched on this run (the hash asserts are before the G1 assert that failed). The five US M 11.5 right meshes are not hash-frozen: a fix has to add the missing letter triangles. Seams and layer changes were not moved. The S1-PRELOFT cap was not edited. `vertex/src` has no diff.

## Bad-change proof

Measured on the identity loops and on the marking / sole predicates. All rejected.

| Change | Result |
| --- | --- |
| Blanket X mirror (xSign = -1) of #442 left, ad1e0cc5 left, and 0d3db1c0 left | G1 fail. `control442LeftPass` false, `ad1e0cc5LeftPass` false, `path0LeftPass` false, `rejected` true |
| Y mirror of the #442 left letters | G1 fail |
| X mirror of ad1e0cc5 left only, right left alone | left fail, right pass, both-feet fail |
| depth 1.2 mm | fail: floor z 1.2 (need 0.6 ± 0.08) and depthMm 1.2 (need 0.6) |
| placementU 0.55 | fail: placementU 0.55 (need 0.32) |
| sole lifted to min z 4, contact fraction 0.001 | fail |

## Full-design identity (t2699u)

Locked rule, quoted: "Must change if the design has any changes." (t2699u, 11:20 PM America/Denver.)

The stored manufacturing STL identity (`manufacturingFingerprintForActiveExport`, which is the sha256 of `manufacturingSolidIdentity`), the checkpoint `meshFingerprint`, and a separate checkpoint key when one exists (`manufacturingStlRunIdentity`) must miss after any single saved-design change. The hash is of the saved design, not a hand-picked field list. `beltPrint` and the OrthoCAD geometry version are rows in the same table. A no-op control reuses when nothing changed.

```bash
npx rstest tests/name-plantar-e2e/full-design-identity.test.ts
```

Exit 1. Duration about 0.1 s. No-op passed: the same design round-trips to the same fingerprint, `peekManufacturingSolid` returns the stored solid, and the checkpoint `meshFingerprint` is that fingerprint. The table failed. 121 rows, 68 still reuse the stored left STL on BASE `d20ca6e9`. Every reused row matches on the stored STL, the checkpoint, and `manufacturingSolidIdentity` together.

Named rows on BASE:

| Field | Stored STL |
| --- | --- |
| unchanged design (no-op) | reused, as required |
| `printRecipe.defaultHardness` (material) | reused |
| `shoeWidth` | reused |
| `thicknessMm` | reused |
| `corrections.linked` | reused |
| `corrections.right.archHeightMm` | reused |
| `corrections.right.heelLiftMm` | reused |
| `corrections.left.archHeightMm` | missed |
| `corrections.left.heelLiftMm` | missed |
| `usMenSize` | missed |
| `elements` | reused |
| `sinks` | missed |
| `sinkStyloidThicken` | reused |
| `textMarking.text` | missed |
| `textMarking.placementU` | missed |
| `beltPrint` | reused |
| `slicerOrthoCadVersion` (`geometryVersion + 1`) | missed |

The other reused paths are `productType`, `method`, the rest of `printRecipe`, `sizeSystem`, `corrections.unit`, every `corrections.right.*` field, `shapeFinish.right.*`, `shapeFinish.linked`, the unmirrored `base.*` strings, `customPrefabId`, `customPrefabName`, and the right-foot `paired.*` fields. Left-foot corrections, shell thickness, and the text-marking leaves already miss. That split is the allowlist: `manufacturingSolidIdentity` copies the active side's field and a fixed set of option keys. It does not hash the saved design. The gate stays `expect(reused).toEqual([])`. It was not loosened.

## Production rematerialize (t2704u)

Locked rule, quoted: "Production box should always work just like a person." (t2704u, 12:16 AM MT 11/25.) This supersedes reuse-by-identity on the production path. `generate_gcode` must rematerialize from the saved design on every call. It must not read a stored manufacturing STL or a checkpoint STL. The UI preview cache stays on the t2699u table above.

```bash
npx rstest tests/name-plantar-e2e/production-rematerialize.test.ts
```

Exit 1. Duration about 19 s. The first call lofts design `0d3db1c0` left through `buildFinalizedFootFromSavedSettings` (the UI export) and slices `ui-export-<sha256>`. The slice parks a checkpoint whose `stlStorageKey` is `stored-8f5dc451de66dbba8f8521e046a9e4af`. The second `beginCadOperatorProduction` on the same design does not call materialize. `loftHashes` length is 1, need 2. `decideClaim` returns reuse while that checkpoint is on the row (`sliceJobStillOwned`). `executeCadOperatorProduction` assigns `stlStorageKey = checkpoint.stlStorageKey` and skips materialize. The gate was not loosened.

## Worker

Candidate: draft PR #449, updated head `710ddab5a0a10bc6eb4ad7b7b83e1354953b2c84`, title "Never reuse a stale manufacturing STL for a belt slice". Not edited. The frozen tests were copied into a detached worktree of that SHA and run there. `place.ts` has no diff. The sample-top edit only stamps `beltPrint` and `placementVersion` on the cached solid after the existing preview rebuild. The engrave path is unchanged.

| Gate | Grade on `710ddab5` |
| --- | --- |
| G1 | FAIL overall, same as the BASE no-op. US M 11.5 right still has no letter walls. `ad1e0cc5` and the #442 control stay the passing cells. Thresholds were not moved. |
| G2 | PASS on the prior live slices. This SHA does not change `detectGcodeFoot` or foot geometry. |
| G3 | PASS on the prior lofts. Sole, depth 0.6, placementU 0.32, and the frozen non-text hashes are the BASE measurements. No seam or surface edit. |
| G4 | PASS as a rejection. This SHA does not set `xSign = -1`. The frozen blanket-X assertions still reject that change. |
| t2699u (`manufacturingSolidIdentity`) | PASS on the stored-STL column. No-op reuses. All 121 rows miss `peekManufacturingSolid`, including hardness, shoe width, both feet's heel lift and arch, elements, sinks, text, placement, `beltPrint`, and the geometry version. The identity record now includes `savedDesignIdentity` of the stripped saved design. |
| t2699u frozen assertion | FAIL. The table's combined `expect(reused).toEqual([])` is red: 119 rows. Those rows miss the stored STL and fail only the checkpoint probe. The probe calls `manufacturingStlRunIdentity` with `composedText` and no `savedDesign`. This SHA ignores `composedText` and hashes `savedDesign`, so that call stays constant. `beltManufacturingStlIdentity` does pass the saved design. The assertion was not edited to match the new argument. |
| t2704u | FAIL. Two consecutive generates on the same design loft once (`loftHashes` length 1, need 2). `storedManufacturingStlReusable` still returns the checkpoint when `placementVersion` is current, and `executeCadOperatorProduction` still slices `checkpoint.stlStorageKey` without materialize. The stale eTag `8f5dc451` is refused only when `readStoredStl` returns those bytes. The reuse path is still keyed. It was not deleted. |

Gates were not loosened to match this SHA. The earlier grade of `929a94d2` is superseded by this head.

## Residuals

- The identity failure is an absent name on US M 11.5 right, after a non-manifold engrave is swallowed. It is not the mirrored-name signature described for productions `ba0f2600` / `41666a57`.
- The six existing #442 cells were not re-sliced in this session. Their test file, thresholds, and workflow image pin were not changed. `chirality.test.ts` passed.
- Non-text hashes are not frozen for the five feet that have no letters.
- Unit CI on this branch is red because the frozen G1 assert fails on BASE. That is the no-op. The plantar-name workflow's new variant step is red for the same cell. The original six-cell step is unchanged and runs first.
- The full-design identity table is also red on BASE: 68 saved-design rows still reuse the stored STL. That is the t2699u freeze. The no-op row in that file passes.
- t2704u is red on BASE: the second `generate_gcode` on the same design does not loft. The checkpoint STL is still the resume path.

## Rule compliance

**PUSH:** `new branch cursor/name-chirality-gates-1124 from BASE -> ONE draft PR titled "[GATES ONLY - DO NOT MERGE] plantar name production-path chirality gates" only (merge=false). Never push or merge main, force-push main, deploy, or touch Railway / vertex-web / vertex-api / PR #310. Do not edit the worker PR, product code, or any existing PR. Do not touch PRs #436, #439, #442, #447 (G-code slicerBuild cache key), #448 (LIVE_IMAGE bump), #56 on VertexSlice, or other open work.`

PASS. Branch `cursor/name-chirality-gates-1124` from `d20ca6e9baa0a7ea1c706e1f05f8e3ac03391d5f`. One draft PR, merge false. `git diff` of product code is empty. No push to main. No Railway, vertex-web, vertex-api, or #310. PRs #436, #439, #442, #447, #448 were not edited.

**FILES:** `tests/name-plantar-e2e/** (extend #442; do not replace it), plus a gates-only folder if you need no-op / bad-change proofs (e.g. validation/name_chirality_gates/** or tests/name-plantar-e2e/proofs/**) and RESULTS.md. If the shard manifest must list a test file you add, update ci/unit-test-shards.json via node scripts/ci/generate-unit-test-shards.mjs. Don't explore beyond. Do not change product code. Do not edit #447 or #448.`

PASS. New files are under `tests/name-plantar-e2e/` and `validation/name_chirality_gates/RESULTS.md`. The #442 grader is called, not replaced. Shard manifest regenerated with the generator. Product code unchanged. #447 and #448 not edited.

**MUST-MATCH:** `frozen gates only, with a no-op proof and a bad-change proof, before any grade. Gates (production path, live VertexSlice #52 image ghcr.io/kdho77/vertexslice-server@sha256:979e31bdf64b2eab4559717b8cc4e862a030fc35e235be2482c253cb2fd3b782, OrthoCAD manufacturing loft on BASE): (G1) The engraved name reads correctly (not mirrored) from the physical bottom of the finished device, both feet. Camera is the #442 / tests/name-plantar-e2e reading frame: flip-the-device-over plantar view, toe toward the viewer, then cap-up. Do NOT use bottomimg.py (that is a vertical flip of the gantry plot and inverts apparent chirality). This must pass for a fixture that reproduces design 0d3db1c0's production path (SAMPLE_Top, ApexCore, toe-first, Medium, corrections.linked false, US M 11.5, right heelLiftMm 12 / left 0, pair generate, addPatientName composition with empty saved text); a fixture that reproduces design ad1e0cc5's production path (SAMPLE_Top, ApexCore, toe-first, Hard, corrections.linked true, US M 12, heel lift 0, single-foot generate, same addPatientName composition); and variants covering Medium vs Hard, linked vs unlinked, heel lift 0 vs 12, pair vs single, and size 11.5 vs 12. Identify those designs by ID only in PR titles and comments. Use a synthetic name (JABBOUR or JOHN SMITH) in fixtures, never a real patient name. Existing #442 JABBOUR SAMPLE_Top cells must still pass; do not loosen their thresholds. (G2) Handedness is unchanged: a left request is a physical left and a right request is a physical right (existing hand_classify / #439 guard). (G3) Surface and seams are unchanged. Seams and layer changes stay on the bottom/plantar/belt face. Engrave stays on the bottom via existing textMarking, engrave mode, same depth and placement, sole flat. Non-text geometry and G-code outside the text region are unchanged versus BASE on a control where that applies. (G4) A blanket place.ts xSign = -1 (or equivalent X flip) on every beltPrint path is a BAD CHANGE and must FAIL, because that would reverse the already-correct ad1e0cc5 / #442 path. Other bad changes (flip only one foot, change depth or placement, move seams or surface) also fail the corresponding gate. No S1-PRELOFT cap change; no slicer, seam, layer-change placement, or outer-surface-quality change.`

PASS. Gates are frozen in `production-path-gates.test.ts` before any worker grade. No-op fails overall on `0d3db1c0` right (letter walls 0 on the live image; need 7). `ad1e0cc5` both feet and the #442 control pass G1 with a > 0.5, d > 0.5, advance > 20. G2 foot matches the request on all four slices. G3 sole min z 0, depth 0.6, placementU 0.32. G4 blanket X flip fails the #442 control and `ad1e0cc5`. Thresholds not loosened. Synthetic name `JABBOUR`.

**TESTS:** `targeted only; CI is the full run.`

PASS. Targeted commands are the two rstest invocations above plus `chirality.test.ts`. CI runs the unit shards and the plantar-name workflow. The new gate test is pinned to shard 1.

**ONE:** `Freeze independent production-path plantar-name chirality gates with no-op and bad-change proofs (including blanket xSign=-1 rejection), extending #442 to the variants that broke, then grade the worker if it exists. Do not merge. Do not change product code.`

PASS for the freeze, the proofs, and the product-code boundary. The later Worker section grades draft #449. Not merged.

**GOAL:** `An independent grader whose frozen gates accept a fix only if the name reads correctly from the bottom on BOTH feet, through the production path, for designs 0d3db1c0 and ad1e0cc5 and every path variant listed, without a blanket xSign that would break the working test path, and without changing handedness, surface, or seams.`

PASS. The gate requires G1 on every listed cell, including both feet of `0d3db1c0`. A blanket X flip fails G1 on the working cells. Handedness, sole z, and non-text hashes are part of the same test.

**OUT-OF-SCOPE:** `product-code edits, loosening gates, merge, deploy, Railway, production order writes, PHI, changing the S1-PRELOFT cap, slicer, seams, or surface quality. Do not call generate_gcode or attach files on Specialist orders (order 7af925bd, design 0d3db1c0). Do not duplicate or edit #447 / VertexSlice #56 (G-code production cache key on slicerBuild; Kendon 10:09 PM MT). The 10:12 PM re-slice of 0d3db1c0 used force_new_slice and created new productions ba0f2600 / 41666a57; it is not a G-code cache-hit case.`

PASS. No product diff. Thresholds unchanged. No merge, deploy, Railway, or order write. No `generate_gcode` and no attach on order `7af925bd`. #447 and VertexSlice #56 were not edited. The local slices are a fresh VertexSlice container, not a cache hit of productions `ba0f2600` / `41666a57`.

**DELIVERABLE:** `one [GATES ONLY - DO NOT MERGE] draft PR with frozen gates, no-op proof, bad-change proof that includes blanket xSign=-1 rejection, RESULTS.md, a rule-compliance report, and a handoff note. If the worker PR is up, a per-gate grade of that SHA. Never merge.`

PASS when the draft PR and the handoff comment exist. The t2699u grade of #449 is in the Worker section. Never merged.

**HANDOFF:** `post a handoff note on the gates PR with the gates SHA, proof results, candidate SHA if graded, per-gate grades, residuals, and next step (wait for Kendon's merge-and-deploy go). Do not merge or deploy.`

PASS when that comment is posted. Next step is to wait. Do not merge. Do not deploy.

**R1 (2026-11-20 12:59 PM MT):** `print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.`

PASS. This branch does not change slicer, seams, or surface. Sole min z stays 0 on every lofted cell. A raised sole (min z 4) fails G3.

**R2 (2026-11-20 11:38 AM MT):** `seams and layer changes must always be on the bottom (plantar/belt face).`

PASS. No seam or layer-change placement edit. Engrave floor, where the letters exist, is z = 0.6 on the bottom. The live slices keep `heelHighZt` true for toe-first, which is the belt frame, not a seam move.

**R3 (2026-11-21 8:41-8:45 PM MT):** `slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than invent new constructions.`

PASS. Gates only. The reading frame, thresholds, and `detectGcodeFoot` are the existing #442 / #439 methods. No slicer change. The question left for Kendon is that this BASE drops the US M 11.5 right name (non-manifold engrave swallowed) rather than mirroring a present name.

**R4 (2026-11-05):** `Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.`

PASS. Fixtures use `tests/fixtures/SAMPLE_Top.glb` through `buildFinalizedFootFromSavedDesign` / `buildPrinterFootManufacturingStl`. Size, heel lift, hardness, and linked are the existing fields. No new mesh.

**R5 (2026-11-05):** `every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.`

PASS. Fixtures use `defaultBottomTextMarking` (bottom, engrave, depth 0.6, cap 12, placementU 0.32) and `envelopeWithLoftTextMarking`. The synthetic string is composed with `addPatientName`. No new engraving system. The gate fails when that name is missing from the sole.

**R6 Security:** `never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes. Do not edit any existing PR (including #447, #448, #436, #439, #442, and any already-open gates or worker PR). Do not call generate_gcode or attach on Specialist order 7af925bd / design 0d3db1c0.`

PASS. Logs were filtered before they were kept. The only string engraved is `JABBOUR`. No Railway, no database write, no `generate_gcode`, no attach. Existing PRs were not edited. No push to main.

**R7:** `do not change worker code. Grade only. Outer surface, seams, layer-change placement, and surface quality may NOT change. The S1-PRELOFT 0.5×inset cap may NOT change. A blanket xSign=-1 on every beltPrint path is a rejected bad change, not an acceptable fix.`

PASS. The worker branch was not edited. Detached worktrees of `929a94d2` and `710ddab5` were used only to run the frozen tests. No surface, seam, layer, or S1-PRELOFT edit. Blanket X flip is rejected: G1 fails on the #442 control and on `ad1e0cc5`.

**t2699u (11:20 PM America/Denver):** `Must change if the design has any changes.`

PASS for this gates branch as a freeze. `full-design-identity.test.ts` walks every persisted field of the saved design, plus `beltPrint` and the OrthoCAD geometry version. The no-op reuses the stored STL. The table fails on BASE because `manufacturingSolidIdentity` is a hand-picked field list: hardness, width, the other foot's heel lift and arch, elements, and `beltPrint` still reuse. The assertion stays empty-reuse. It was not loosened.

The stored-STL column of that table on worker `710ddab5` misses for every field. The combined assertion stays red. See the Worker section. The assertion was not loosened.

**t2704u (12:16 AM MT 11/25):** `Production box should always work just like a person.`

PASS for this gates branch as a freeze. `production-rematerialize.test.ts` runs two production `generate_gcode` calls on the same saved design. Both must loft through the UI export, and neither may slice a stored or checkpoint STL, including eTag `8f5dc451`. On BASE the second call does not loft. The assertion stays at two lofts.

FAIL for worker `710ddab5`. The second call does not loft. `storedManufacturingStlReusable` still keys a current checkpoint, and `executeCadOperatorProduction` still assigns `checkpoint.stlStorageKey` and skips materialize.

**ONE (this pass):** `Add to the frozen gates on #450: production generate_gcode never reads a stored manufacturing/checkpoint STL (two consecutive calls both rematerialize) and output matches the UI export path; then grade worker PR #449 against all gates.`

PASS for the new gate and the grade of #449 head `710ddab5`. Not merged. Product code unchanged. No attach, no order-status change, no blanket `xSign=-1`.

## Worker `2dc7b07f` (independent grade)

Candidate: draft PR #449 head `2dc7b07f7e47d6b8a8117219c0f000245e37cdb5`. Not edited. Detached worktree at that SHA. `tests/name-plantar-e2e` was replaced with the tree from `2eff9d6a7e92ba2ad8ea41bcfcbfc246d30513f6` before any test. 20 files, 0 byte mismatches. Blobs for `thresholds.ts`, `frozen-surface-hashes.ts`, `production-path-gates.test.ts`, `full-design-identity.test.ts`, and `production-rematerialize.test.ts` match `2eff9d6a`. Thresholds stay `G1_MIN_ADVANCE_MM = 20`, `G1_AXIS_MIN = 0.5`. Synthetic string `JABBOUR`.

Commands, cwd `/tmp/grade-449`:

```bash
npx rstest tests/name-plantar-e2e/chirality.test.ts \
  tests/name-plantar-e2e/full-design-identity.test.ts \
  tests/name-plantar-e2e/production-rematerialize.test.ts
npx rstest tests/name-plantar-e2e/production-path-gates.test.ts
npx rstest tests/name-plantar-e2e/build-stls.test.ts
npx rstest --config tests/name-plantar-e2e/rstest.config.ts \
  tests/name-plantar-e2e/production-gcode.optional.test.ts \
  tests/name-plantar-e2e/measure-gcode.optional.test.ts
```

Exits: 0 (38961 ms, 10 passed), 0 (335987 ms, 2 passed), 0 (24752 ms, 1 passed), 1 (375 ms). The exit 1 is `NAME_PLANTAR_GCODE_DIR is required` in both optional files, before any glyph is read. This VM has no Docker, so `slice-feet.sh` was not run. G1–G4 below are the manufacturing STL in the frozen #442 reading frame.

**Overall: PASS.**

| Gate | Grade on `2dc7b07f` |
| --- | --- |
| G1 | PASS. 24/24 cells, sequence `JABBOUR`. Every US M 11.5 right reads. `0d3db1c0` right a=0.949691 d=0.631710 advance 71.726 mm, foot right, heelHigh true, floor z 0.6, sole min z 0. `0d3db1c0-hard` right, `0d3db1c0-linked` right match that cell. `0d3db1c0-heel0` right and `ad1e0cc5-size11.5` right a=0.949691 d=0.631710 advance 71.726 mm. Control left a=0.951470 d=0.889669 advance 71.695; control right a=0.963460 d=0.610368 advance 71.666. Counts 137692/137772 and 138790/138870. |
| G2 | PASS. Stamp and `detectGcodeFoot` match the requested side on all 24 cells. `heelHigh` true on every cell (toe-first). |
| G3 | PASS. Floor median z 0.6 and sole min z 0 on every cell. All 19 frozen non-text hashes match. `0d3db1c0-size12` right and `ad1e0cc5-heel12` right are `7f198b4af1f45e454eae97cdbc77b4871e0617a85d562bbd283e975af4d73e3f`. |
| G4 | PASS as a rejection. Blanket `xSign = -1` fails the #442 left, `ad1e0cc5` left, and `0d3db1c0` left. One-foot X flip: left fail, right pass, pair fail. Y mirror fails. Depth 1.2 fails (floor z 1.2 and depthMm 1.2). placementU 0.55 fails. Sole min z 4 with contact fraction 0.001 fails. |
| t2699u | PASS. No-op reuses the preview solid and the checkpoint fingerprint. Combined assertion `reused = []`. 121 rows, 0 errors. Hardness, shoe width, thickness, linked, both feet's arch and heel lift, elements, sinks, text, placement, `beltPrint`, and the geometry version all miss. |
| t2704u | PASS. Two `generate_gcode` calls on design `0d3db1c0` left both loft. `loftHashes` length 2, one distinct hash, sliced keys `ui-export-<hash>`. The stale key `stored-8f5dc451de66dbba8f8521e046a9e4af` is absent. The original row still holds the checkpoint. |

### Hand review of `2dc7b07f` versus main `3cabc5b1` and gates BASE `d20ca6e9`

`storedManufacturingStlReusable` returns false for every argument (`cad-operator-production.ts`). A checkpoint whose `rematerialized` flag is absent is a stored STL: `claimProduction` mints a new idempotency key, the old row keeps the checkpoint, and `executeCadOperatorProduction` calls `materialize()`. The frozen t2704u checkpoint is that case, and the test passed.

`executeCadOperatorProduction` copies `checkpoint.stlStorageKey` and skips `materialize()` only when `resumeSubmittedSlice` is true and `checkpoint.rematerialized` is true. `continueInFlightSlice` sets that flag only for a checkpoint this production wrote after a loft. `beltSliceRequest`, which downloads the STL, runs when that resume checkpoint is absent. `runCadSliceAttempt` with a checkpoint already set polls `getVertexSliceJob(jobId)` and does not submit the mesh. The identity-keyed reuse path is gone. The remaining branch is a status poll of a job already submitted after a loft.

`git diff 3cabc5b1 2dc7b07f` does not contain `production-path-gates.test.ts`, `frozen-surface-hashes.ts`, `thresholds.ts`, `full-design-identity.test.ts`, `production-rematerialize.test.ts`, `chirality.test.ts`, or `RESULTS.md`. It does edit four pre-existing `tests/name-plantar-e2e` files: `PROOFS.md`, `build-stls.test.ts` (added variant loft), `measure-gcode.optional.test.ts` (added variant grade), and `slice-feet.sh` (variant slice loop that exits 1 when no `*-left.stl` / `*-right.stl` is present). This run used the `2eff9d6a` bytes of those files.

Versus `d20ca6e9`, `heel-lift.ts`, `base-modifier.ts`, and `text-marking/place.ts` are the same blobs (`82bc8524`, `9fa3e1ba`, `ae2ea1ad`). The geometry source delta is `bottom-engrave.ts` (`dropLoneOpenTriangles` before the manifold check) and `sample-top-preview.ts` (cache frame stamp). The PR diff contains no `xSign` assignment. No slicer, seam, or surface-quality file is in the diff against main. `vertexslice-build.ts` differs from `d20ca6e9` because main already has it; the #449 diff does not touch it.

### Residuals

- Live #52 G-code was not sliced. The two optional tests exit on a missing directory. The STL-frame grade is the evidence for G1–G4.
- A rematerialized checkpoint still skips a second loft while that job is polled. The frozen test covers the stored checkpoint, which lofts again.

### Rule compliance (this grade)

- Independent grader. Worker tree was not edited. Gates were overlaid from `2eff9d6a` and left byte-for-byte.
- MUST-MATCH. No gate, threshold, or frozen hash was edited. `G1_MIN_ADVANCE_MM` remains 20 and `G1_AXIS_MIN` remains 0.5.
- FILES. The only commit is `validation/name_chirality_gates/RESULTS.md` on `cursor/name-chirality-gates-1124`.
- TESTS. Every `tests/name-plantar-e2e` rstest file at `2eff9d6a` was invoked against `2dc7b07f`. Thirteen tests passed. The two optional G-code tests stopped on `NAME_PLANTAR_GCODE_DIR` because Docker is absent.
- ONE. Graded `2dc7b07f` per gate. Overall PASS.
- No merge, no deploy, no Railway, no `generate_gcode` on a Specialist order, no attach, no order-status change. Synthetic name `JABBOUR`. Design ids only.
- No blanket `xSign = -1`. `place.ts` blob matches `d20ca6e9`. S1-PRELOFT cap was not in the diff. No slicer, seam, or surface-quality edit in the #449 diff.

## Worker `c8a06491` (independent grade of #451)

Candidate: draft PR #451 head `c8a06491eb2dc309830e8979fb00490c238a918b`, title "Loft every production generate from the saved design". Not edited. Detached worktree at that SHA. `tests/name-plantar-e2e` from `2eff9d6a7e92ba2ad8ea41bcfcbfc246d30513f6` was copied over that tree before any test. 20 frozen files, 0 byte mismatches. The grader file `grader-s1-stored-stl.test.ts` was added beside them. It is not one of the frozen files, and it is not the worker's `trpc-cad-operator.test.ts`. Blobs for `thresholds.ts`, `frozen-surface-hashes.ts`, `production-path-gates.test.ts`, `full-design-identity.test.ts`, and `production-rematerialize.test.ts` match `2eff9d6a`. Thresholds stay `G1_MIN_ADVANCE_MM = 20`, `G1_AXIS_MIN = 0.5`. Synthetic string `JABBOUR`. Design id `0d3db1c0-0000-4000-8000-0000000000d3` with the `0d3db1c0` path (US M 11.5, Medium, unlinked, left heel 0).

Commands, cwd `/tmp/grade-451`:

```bash
npx rstest tests/name-plantar-e2e/production-path-gates.test.ts
npx rstest tests/name-plantar-e2e/chirality.test.ts \
  tests/name-plantar-e2e/full-design-identity.test.ts \
  tests/name-plantar-e2e/production-rematerialize.test.ts
npx rstest tests/name-plantar-e2e/build-stls.test.ts
npx rstest --config tests/name-plantar-e2e/rstest.config.ts \
  tests/name-plantar-e2e/production-gcode.optional.test.ts \
  tests/name-plantar-e2e/measure-gcode.optional.test.ts
npx rstest tests/name-plantar-e2e/grader-s1-stored-stl.test.ts
```

Exits: 0 (335814 ms, 2 passed), 0 (37878 ms, 10 passed), 0 (23458 ms, 1 passed), 1 (optional G-code), 0 (50592 ms, S1 1 passed). The exit 1 is `NAME_PLANTAR_GCODE_DIR is required` in both optional files, before any glyph is read. This VM has no Docker, so `slice-feet.sh` was not run. G1–G4 are the manufacturing STL in the frozen #442 reading frame. The first S1 invocation exited 1 in 1176 ms because rstest rewrote the headless runner's `SAMPLE_Top` URL and the loft threw before any bytes existed. The stock GLB, font, and elements were then copied to the URLs the runner reports, and the same test was run again. That rerun is the S1 result below. The frozen files were not edited to make it pass.

**Overall on #451: PASS. Overall on #450: FAIL.**

#450 is the frozen gates at `2eff9d6a`. Its column is the no-op already recorded in this file on product BASE `d20ca6e9`. It was not executed again in this session. S1 did not exist on that tree.

| Gate | #451 `c8a06491` | #450 `2eff9d6a` |
| --- | --- | --- |
| G1 | PASS. `production-path-gates.test.ts` 2 passed, including every listed cell. | FAIL. US M 11.5 right letter walls missing. |
| G2 | PASS. Same STL-frame suite. Stamp and foot match the request. | PASS on the four live slices in the freeze. |
| G3 | PASS. Floor, sole, and the 19 frozen non-text hashes are inside that suite. | PASS on the freeze lofts. |
| G4 | PASS as a rejection. Blanket X, one-foot X, Y mirror, depth 1.2, placementU 0.55, and a lifted sole fail inside that suite. | PASS as a rejection. |
| t2699u | PASS. No-op reuses. `any single design-field change misses the stored STL` passed. | FAIL. 68 of 121 rows still reuse. |
| t2704u | PASS. Two generates, `loftHashes` length 2, sliced keys are the UI export hashes, stale key absent. | FAIL. Second generate does not loft. |
| S1 | PASS. Two real `buildHeadlessFinalizedFoot` calls. Slice bytes are the prepared loft, not the 9045484-byte object. Zero downloads, signed URLs, export selects, or fetches of that object. Both new rows succeeded. The seeded checkpoint row stayed failed. | Not run. The stored-STL resume this gate targets is the t2704u failure above. |
| Overall | PASS | FAIL |

### Hand review of `c8a06491` versus main `2a0cb302`

`git diff 2a0cb302 c8a06491` is four files: `cad-operator-production.ts`, `cad-operator-generate.ts`, `manufacturing-cad.ts`, `trpc-cad-operator.test.ts`. 289 insertions, 60 deletions. No file under `tests/name-plantar-e2e` or `validation/name_chirality_gates`. No `place.ts`, `heel-lift.ts`, `bottom-engrave.ts`, `sample-top-preview.ts`, slicer, seam, or surface-quality file. No `xSign` assignment.

The stored-STL lookup is deleted. `materializeCadOperatorStl` no longer returns `plan.stlStorageKey` when `useSavedDesignMesh` is false. It always calls `buildHeadlessFinalizedFoot`. The `isStalePre52ManufacturingStlBytes` check and the `STALE_MANUFACTURING_STL_MESSAGE` throw are deleted from that function, not wrapped in a new condition. `beltSliceRequest` no longer calls `signedDownloadUrl` or `downloadManufacturingStl`. It sends the loft bytes. `executeCadOperatorProduction` no longer assigns `stlStorageKey = resumeCheckpoint.stlStorageKey`. On a resume it passes `""` into `slice`, and both generate callbacks ignore that argument.

`rg` of the production generate path for slice input:

| Site | What remains | Slice input? |
| --- | --- | --- |
| `manufacturing-cad.ts` `prepareCadOperatorGenerate` | When `useSavedDesignMesh` is false, the caller key is prefix-checked and stored on the plan. `cadOperatorManufacturingIdentity` hashes that string. | No. `materializeCadOperatorStl` does not download it and does not return it. |
| `cad-operator-production.ts` `runCadSliceAttempt` | Writes `stlStorageKey: args.stlStorageKey` into the new checkpoint JSON. The value on this path is the loft key, or `""` when the request is null. | No download. A set checkpoint polls job status and does not submit a mesh. |
| `manufacturing-stl-lifecycle.ts` `archiveManufacturingSourceStl` | `copyStorageObject` downloads the temp key this invocation just uploaded, then writes `exports.sourceStlPath`. | No. The slice already used the in-memory loft. S1 recorded zero downloads of the seeded temp key and the seeded archive key. |
| `sourceStlPath` | Write only, in `archiveManufacturingSourceStl`. | No read on this path. S1's export `select` count was 0. |
| `manufacturing-stl-download.ts` | The string `Refusing a stale pre-#52 manufacturing STL (eTag 8f5dc451de66dbba8f8521e046a9e4af)` is still the body of `downloadManufacturingStl`. | Not called from `cad-operator-generate.ts` (the import is gone). |
| `manufacturing.ts` / `manufacturing-session.ts` | The browser session `generateSolid` still signs and downloads the caller `stlStorageKey` through `downloadManufacturingStl`. | Yes, on that session path. It is not the CAD-operator production module. `cad-operator-production.ts` says the human `generateSolid` path does not use it. #451 does not change those files. |

No production-path read of `stlStorageKey`, `sourceStlPath`, `manufacturing-temp`, or a checkpoint object remains as slice input. The refuse outcome is deleted from the production generate path. It is not re-keyed. The helper that throws it still exists for the browser session upload.

### Residuals

- Live #52 G-code was not sliced. The optional tests stop on a missing directory. The STL-frame grade is the evidence for G1–G4.
- A generate that finishes in the same invocation still archives the loft it just uploaded, which downloads that new temp object. S1 did not treat that fresh object as the pre-#52 file. The seeded 9045484-byte object, eTag `8f5dc451de66dbba8f8521e046a9e4af`, was not read.
- The browser session path can still refuse that eTag. Production belt generate does not call it.
- #450 was not re-run. Its overall stays the frozen no-op.

### Rule compliance (this grade)

- Independent grader. The #451 tree was not edited. Frozen gates were overlaid from `2eff9d6a` and left byte-for-byte. The only new test is the grader file.
- MUST-MATCH. No gate, threshold, or frozen hash was edited. `G1_MIN_ADVANCE_MM` remains 20 and `G1_AXIS_MIN` remains 0.5. Kendon's rule is the production generate lofts the saved design and does not reuse a stored copy. S1 requires two loft calls and zero reads of the seeded file.
- FILES. This commit is `validation/name_chirality_gates/RESULTS.md` and `tests/name-plantar-e2e/grader-s1-stored-stl.test.ts`.
- TESTS. Every `tests/name-plantar-e2e` rstest file at `2eff9d6a` was invoked against `c8a06491`, plus S1. Thirteen frozen tests passed (2 + 10 + 1). The two optional G-code tests stopped on `NAME_PLANTAR_GCODE_DIR` because Docker is absent. S1 passed on the rerun.
- ONE. Graded `c8a06491` per gate. Overall PASS. #450 overall remains FAIL.
- No merge, no deploy, no Railway, no `generate_gcode` on a Specialist order, no attach, no order-status change. Synthetic name `JABBOUR`. Design ids only.
- No blanket `xSign = -1`. No slicer, seam, surface, heel-lift, or text-geometry file is in the #451 diff. S1-PRELOFT was not in the diff.

