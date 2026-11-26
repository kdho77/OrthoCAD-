# Independent grade: worker PR #467

**Graded SHA:** `b2f1c4e2534479c7bdc142c0415e5ec8677fc3a1`  
**Worker PR:** https://github.com/kdho77/OrthoCAD-/pull/467  
**Grader branch:** `cursor/grade-pr-467-mcp-macros-1125`  
**Verdict:** **PASS-WITH-RESIDUALS**

## Evidence run (grader VM)

```text
npx rstest packages/mcp/test/grader-pr-467-independent.test.ts \
  packages/mcp/test/design-macros.test.ts \
  packages/mcp/test/tool-schemas.test.ts \
  vertex/src/lib/clinical/correction-presets.test.ts
node scripts/ci/validate-unit-test-shards.mjs
node vertex/scripts/assert-server-esm-boot.mjs
```

GitHub Actions on `b2f1c4e2`: all required checks `success` (unit-tests 1–6, plantar-name, isolated-postgres-acceptance, test-and-deploy). `default-procedural-smoke` skipped (unchanged pattern).

## Gate table

| Gate | Result | Evidence |
| --- | --- | --- |
| **ONE** — bot applies same customer/pathology macros as UI Merge | **PASS-WITH-RESIDUALS** | `applyDesignMacrosToDesign` calls `applyCorrectionPresetToDesign(..., { mode: "merge" })` in customer-then-pathology order (`correction-presets.ts`). Grader test `pathology-only headless merge matches UI`. Browser-only “My presets” (localStorage) are not exposed to MCP (documented residual). |
| **MUST-MATCH** — headless macro path for clinic + pathology (e.g. Rhinebeck, Pes Planus) | **PASS-WITH-RESIDUALS** | Pathology (`Pes Planus` → `vertex-planus`) works via `list_macros` / `apply_macro`. Production `CUSTOMER_DESIGN_MACROS` is `[]`; Rhinebeck returns 422 question, no write (`design-macros.test.ts`, grader `G-invent`). Zeidan/Salvador need clinic rows added when corrections are defined. |
| **TEST** — `list_macros` + `apply_macro` match UI; no macro unchanged | **PASS** | Worker + grader tests; `applyDesignMacrosOnDesign` returns `changed: false` and zero prisma updates when both names omitted. |
| **TEST** — register tests in `ci/unit-test-shards.json` | **PASS** | `packages/mcp/test/design-macros.test.ts` added to shard 1; `validate-unit-test-shards.mjs` OK (388 files). |
| **Hard** — rebuild from saved design; no STL/checkpoint reuse on apply | **PASS** | `apply-design-macros.ts` updates `settingsJson` only; no imports of loft/slice/STL (grader static gate). `generate_gcode` handler diff adds only macro tools. |
| **Hard** — design change invalidates cached STL/G-code identity | **PASS** | `beltManufacturingStlIdentity` differs after macro apply, unchanged when no macro (worker + grader tests). |
| **Hard** — patient name engraving untouched | **PASS** | Macro merge spreads design; worker test asserts `textMarking` unchanged; no engraving code in diff. |
| **Hard** — Medium/default unchanged unless macro applied | **PASS** | No-macro path returns original `settingsJson`; starter payloads not edited in diff. |
| **Hard** — no outer surface / seam / slicer changes | **PASS** | No mesh, loft, or slicer files in 19-file diff. |
| **Hard** — no scope growth beyond ONE | **PASS** | G-scope: exactly 19 files (grader test documents set). |
| **Hard** — copy conventions; no invented clinical magnitudes | **PASS** | Rhinebeck refused; `applyMacroInputSchema.strict()`; list API omits payloads. |
| **G-scope** | **PASS** | `git diff main..b2f1c4e2 --name-only` matches brief file list. |
| **G-invent** | **PASS** | Empty customer catalog; schema rejects `payload` / mm fields. |
| **G-CI** | **PASS** | All check runs on head SHA green; grader tests pass locally. |
| **Gates/baselines** — no loosened frozen hashes | **PASS** | PR diff has no snapshot/hash expectation changes outside new tests. |

## Residuals (not failures of implementation)

1. `CUSTOMER_DESIGN_MACROS` is empty — Rhinebeck and other clinic macros must be added with already-defined payloads before those orders automate.
2. User-saved correction presets in localStorage are not visible to the bot (same as before for headless).
3. Worker PR remains **draft**; grader does not merge.

## Grader artifacts

- `packages/mcp/test/grader-pr-467-independent.test.ts` — grader-owned tests (this branch only).