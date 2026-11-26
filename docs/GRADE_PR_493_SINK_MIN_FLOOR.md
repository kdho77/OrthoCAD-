# Independent grade: PR #493 (sink min floor)

**Subject SHA:** `acdb27ab11b8cd7f3165479114a5d58a8d734446`  
**Grader branch:** `cursor/grade-pr-493-sink-min-floor-1125`  
**Verdict:** See CI on this grader PR and the table below (updated after local runs).

## Brief criteria

| Criterion | Result | Evidence |
| --- | --- | --- |
| Min floor ≥ guaranteed minimum for every sink kind at 2 / 2.5 / 3 mm through max depth | TBD | `tests/sink-min-floor.test.ts` (worker) + grader spot check `mpj5` in `tests/grade-pr-493-sink-min-floor.test.ts` |
| `thickness_mm` readback: uniform mode and requested mm | TBD | `tests/grade-pr-493-sink-min-floor.test.ts`, `tests/sink-min-floor.test.ts`, `vertex/server/src/lib/saved-design-snapshot.test.ts` |
| Uses existing `FLOOR_MIN_MM` (1.0 mm), no invented clinical magnitudes | TBD | `FLOOR_MIN_MM === FOREFOOT_THICKNESS_CLEARANCE_MM` grader test |
| MCP docs match uniform behavior when `thickness_mm` set | TBD | `packages/mcp/src/tools/schemas.ts` string grader test |
| New tests registered in `ci/unit-test-shards.json` | TBD | `node scripts/ci/validate-unit-test-shards.mjs` |
| Scope limited to sink geometry, shell mode, MCP mapping/docs, tests | TBD | 13 files on subject diff vs `main` |
| Full CI green on subject SHA | TBD | Local shard runs; GitHub check-runs on subject (Vercel only observed) |

## Residuals (from subject PR, not re-litigated)

- `millShellDesign` still converts uniform milling designs to zonal for toolpath; frozen CNC gates stay zonal.
- Men's 9 sink mesh pins changed because wall-under-sink geometry changed (intentional fix).
- UI Setup slider remains zonal; may not byte-match catalog uniform loft at heel.

## Rule compliance (Kendon locked)

| Rule | Result | Evidence |
| --- | --- | --- |
| Bot/MCP rebuilds from saved design, no stored manufacturing STL reuse | TBD | Removed `assertSolidManufacturingShellThickness` refusal; export still `buildFinalizedFootFromSavedDesign` |
| Design change invalidates cached STL/G-code | TBD | No new cache bypass in diff |
| Patient name engraved both feet | TBD | No engrave edits in 13-file diff |
| Default / byte-identical unless defect requires change | TBD | `tests/one-click-baseline-parity.test.ts` (shard 3) |
| No scope growth beyond brief | TBD | 13 files only |
| Register tests in shards; CI green | TBD | validate + shard runs |