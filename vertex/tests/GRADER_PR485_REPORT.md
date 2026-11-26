# Independent grader report — PR #485 (orthotic length)

**Graded commit:** `f391f49d040943a2174b275f3645c2eb505c7edb`  
**Base:** `main` @ `91e0062a7fd1de564b7d8b9f14b869a752464a7b`  
**Subject PR:** [#485](https://github.com/kdho77/OrthoCAD-/pull/485) — do not merge this grader branch.

## Verdict: **PASS-WITH-RESIDUALS**

Catalog, MCP, trim-pattern parity, Full-length export identity with `main`, and bottom patient-name marking match the brief. Trimmed (3/4 / Sulcus) **manufacturing solids** still abort at the existing `S1-PRELOFT` station gate — same failure as the UI export path, not a headless divergence.

## Criterion table

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| `catalog.length` selects Full / `met_head` (3/4) / `sulcus` only | **PASS** | `vertex/tests/pr485-orthotic-length.grader.test.ts` G2; `packages/mcp/test/persist-saved-design-snapshot.test.ts` |
| Kingston `3/4` → Met-head | **PASS** | G2a `catalogLengthPreset("3/4") === "met_head"` |
| Uses #364 presets only (no new landmark u) | **PASS** | G2b: `TRIM_PRESET_LANDMARK_U` unchanged vs `main`; `git diff` on `trim-presets.ts` is label-only (`met_head: "3/4"`) |
| Full / omitted export byte-identical to `main` | **PASS** | G4: SHA-256 matches `tests/fixtures/pr485-main-omitted-stl-sha256.json` (captured from `main@91e0062`, no client / no outline publish) for left + right |
| Closed manifold on Full export | **PASS** | G4: `validateManifold` watertight, χ=2 |
| 3/4 + Sulcus clipped top + bottom pattern = UI preset (both feet) | **PASS** | G5: `resolveActiveTrimline` / `endPatternOnTrim` / `buildTrimPresetCurve` point equality vs `curveForTrimPreset` |
| Headless vs UI parity (Full manufacturing STL) | **PASS** | G6a + `saved-design-length-preset.test.ts` |
| Headless vs UI parity (3/4 / Sulcus manufacturing STL) | **FAIL** (known residual) | G6b: both paths throw `[S1-PRELOFT]` before STL is produced — no finished solid to compare |
| Patient name on bottom marking | **PASS** | G6a `textMarking.surface === "bottom"`, `addPatientName`, `activePatientDisplayName()` |
| MCP `create_saved_design` / persistence | **PASS** | G3; full MCP suite run locally |
| Shard manifest includes new suites (389 files with grader) | **PASS** | G7; `node scripts/ci/validate-unit-test-shards.mjs` → OK (388 on graded SHA; grader adds one file) |
| GitHub Actions full Test matrix | **PASS** on PR head merge (`d45a9177`, [run 1644](https://github.com/kdho77/OrthoCAD-/actions/runs/45760463581)); **not re-run on exact** `f391f49d` during grading | Vercel success on `f391f49d` |
| Local independent test run (graded tree) | **PASS** | `saved-design-length-preset.test.ts` + MCP persist + grader tests (see commit on grader branch) |

## Residuals (plain language)

1. **Short-preset manufacturing solid:** Met-head and Sulcus saved designs rebuild the correct trim curves and bottom pattern endings, but `buildPrinterFootManufacturingStl` / headless canonical export still hits `assertPreLoftStations` (`[S1-PRELOFT]` skew). This predates the length field; PR #485 does not clear that gate.
2. **CI signal on exact SHA:** Grade targeted `f391f49d`; the feature branch received a merge commit after that SHA. Re-run the six-shard `Test` workflow on the graded commit if a hard CI gate is required.

## Commands used (no PHI)

```bash
node scripts/ci/validate-unit-test-shards.mjs
npx rstest vertex/src/features/exports/saved-design-length-preset.test.ts packages/mcp/test/persist-saved-design-snapshot.test.ts
npx rstest vertex/tests/pr485-orthotic-length.grader.test.ts
```

Main baseline fixture for G4 was produced once from `main@91e0062` with the same US M9 SAMPLE_Top stock path (hashes only, no order payloads).