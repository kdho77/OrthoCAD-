# Independent grade: PR #493 (sink min floor)

**Subject PR:** [#493](https://github.com/kdho77/OrthoCAD-/pull/493)  
**Subject SHA:** `acdb27ab11b8cd7f3165479114a5d58a8d734446`  
**Subject base (per handoff):** `228c72f2771a`  
**Grader branch:** `cursor/grade-pr-493-sink-min-floor-1125`  
**Verdict:** **PASS-WITH-RESIDUALS**

## Core brief (measurable)

| Criterion | Result | Evidence |
| --- | --- | --- |
| Every sink kind at 2 / 2.5 / 3 mm through max depth: min lowered wall ≥ `FLOOR_MIN_MM` (1.0 mm) | **PASS** | `npx rstest run tests/sink-min-floor.test.ts` — 2/2 pass (~216s grader VM). Independent Escobar case `mpj5`, 3 mm, depth 2 in `tests/grade-pr-493-sink-min-floor.test.ts`. |
| `thickness_mm` readback: uniform `shellThicknessMode` and requested mm on both feet; omitted stays zonal 2 mm | **PASS** | Grader + `tests/sink-min-floor.test.ts`, `vertex/server/src/lib/saved-design-snapshot.test.ts`, `packages/mcp/test/central-fab-stl.test.ts`, `tests/cnc/catalog-shell-thickness.test.ts` — all pass locally. |
| Uses existing repo minimum (`FLOOR_MIN_MM`), no new clinical magnitudes | **PASS** | `FLOOR_MIN_MM === FOREFOOT_THICKNESS_CLEARANCE_MM === 1.0` (grader test + `vertex/src/lib/geometry/sink.test.ts` registry). |
| MCP `create_saved_design` / `thickness_mm` docs match uniform loft behavior | **PASS** | `packages/mcp/src/tools/schemas.ts` strings; grader text assertion; bundled MCP description updated in diff. |
| New acceptance test registered in `ci/unit-test-shards.json` | **PASS** | `tests/sink-min-floor.test.ts` on subject diff; `node scripts/ci/validate-unit-test-shards.mjs` OK on grader tree (389 files). |
| Scope: sink geometry, shell mode, snapshot/MCP mapping, tests only (13 files vs `228c72f2`) | **PASS** | `git diff --name-only 228c72f2 acdb27ab` → exactly the 13 files named in the brief. |

## Root cause / design (independent read of diff)

| Claim | Grader assessment |
| --- | --- |
| Zonal readback after `thickness_mm` was wrong vs MCP doc | **Confirmed** — `saved-design-snapshot.ts` now sets `shellThicknessMode = "uniform"` for all methods when `thickness_mm` is set. |
| Wall pinch from `(z/H)*crest` below 1 mm | **Plausible and fixed** — `sinkWallColumnZ` + floor clamp in `applyAnalyticSinkToLoftedSolid`; procedural tests show floor ≥ 1 mm. |
| Uniform thickness via `solidTopLiftMm` without double-count in `correctionDeltaAt` | **Confirmed in diff** — `base-modifier.ts` `uniformSolidLift` + uniform included in `solidTopLiftMm`. |
| Manufacturing no longer throws on uniform non-default solid | **Confirmed** — `assertSolidManufacturingShellThickness` removed from `saved-design-finalized-mesh.ts`; loft test now expects uniform 3 mm to build. |

## Rule compliance (Kendon locked)

| Rule | Result | Evidence |
| --- | --- | --- |
| Production bot/MCP rebuilds from saved design; no stored manufacturing-STL/checkpoint reuse | **PASS** | No new cache/STL reuse in 13-file diff; export still `buildFinalizedFootFromSavedDesign` / `buildPrinterFootManufacturingStl`. Legacy uniform refusal removed so catalog path can export. |
| Design change invalidates cached STL/G-code | **PASS** | No cache-key or bypass edits in diff. |
| Patient name engraved on bottom of both feet | **PASS** | No bottom-text / engrave files in diff; `vertex/server/src/lib/pair-loft-byte-identity.test.ts` pass (patient name on each foot). |
| Medium/default designs byte-identical unless defect requires change | **PASS** | `tests/one-click-baseline-parity.test.ts` pass (default L+R pins). Sink-heavy meshes intentionally change (`tests/sink-pediatric-clearance.test.ts` re-pinned; passes). |
| Outer surface / seams / layer-change scope | **PASS** | No unrelated surface pipeline edits; sink wall remap only in `sink.ts` / loft path. |
| No scope growth beyond brief | **PASS** | 13 files vs stated base. |
| Copy conventions; no invented defaults | **PASS** | `FLOOR_MIN_MM` alias only. |
| Full CI green on subject SHA | **PASS-WITH-RESIDUAL** | GitHub API: Vercel `success` on `acdb27ab`; **no GitHub Actions workflow runs** on that SHA/branch in this repo. Grader re-ran the PR’s critical tests locally (all pass). |

## Residuals (not failures of the brief; carry forward)

1. **CNC milling:** Uniform catalog thickness is still converted to zonal in `millShellDesign` for toolpath — printed solid uses uniform slider; milled toolpath stays zonal (stated in subject PR).
2. **Sink mesh pins:** Men's 9 sink SHA pins updated in `tests/sink-pediatric-clearance.test.ts` (expected when fixing wall-under-sink).
3. **CI visibility:** Subject PR lacks observable GHA check runs from this environment; local shard-equivalent tests were executed instead of all six shards end-to-end.

## Grader artifacts

- Independent tests: `tests/grade-pr-493-sink-min-floor.test.ts` (5 tests, PASS).
- Local runs on subject tree: `sink-min-floor`, `saved-design-snapshot`, `central-fab-stl`, `catalog-shell-thickness`, `saved-design-thickness-loft`, `one-click-baseline-parity`, `pair-loft-byte-identity`, `sink-pediatric-clearance` — all PASS.

**Do not merge PR #493 or this grader PR unless Kendon promotes after reviewing residuals.**