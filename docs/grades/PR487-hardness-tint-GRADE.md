# Grader report: PR #487 (hardness viewport tint + tab defaults)

**Worker PR:** https://github.com/kdho77/OrthoCAD-/pull/487  
**Head SHA graded:** `ec88e52fdcd1e38f81e17976e0ea29d0f5f9e423`  
**Grader branch:** `cursor/grade-pr-487-hardness-tint-1125`  
**Graded:** 2026-11-26 (independent; worker claims not trusted)

## Overall verdict: **FAIL** (functional gates largely pass; CI gate fails)

## Evidence table

| ID | Criterion (from brief) | Verdict | Evidence |
|----|------------------------|---------|----------|
| C1 | Whole insole mesh tinted by selected device hardness (readable at a glance) | **PASS** | `insoleViewportMaterialColor` blends `CLASS_PREVIEW_COLORS` into `INSOLE_VIEWPORT_BASE_COLOR` (`split-overlay.ts`). Wired on solid materials in `BaseInsoleMesh.tsx` / `InsoleMesh.tsx`. Grader **G1** (14 distinct colors; hardness change updates color; heightmap branch skips tint). |
| C2 | Reuse existing element hardness preview palette | **PASS** | Tint mixes preview palette at 42% (design) / 16% (print-export). Grader **G1**, **G2**. |
| C3 | Each hardness → distinct color; no hardness → gray | **PASS** | `INSOLE_VIEWPORT_BASE_COLOR` when `defaultHardness` unset. Grader **G1**. |
| C4 | Elements stay distinguishable from insole (incl. same hardness) | **PASS** | Print elements keep full `CLASS_PREVIEW_COLORS`; insole uses lightened mix (`elementPreviewColor` / grader **G2**). Design tab keeps purple/green selection colors. |
| C5 | Heightmap / transparent view modes preserved | **PASS** | Heightmap materials use vertex colors only (source inspection grader **G1**; worker tests). Transparent opacity unchanged on materials. |
| C6 | Visual only — export geometry/bytes untouched | **PASS** | No `insoleViewportMaterialColor` in export/manufacturing paths (grader **G5** grep). `buildExportGlbGeometry("left")` position buffer identical when only `viewer.heightmap` toggles (grader **G5** runtime). |
| C7 | Design tabs (Scan–Elements) default Heatmap | **PASS** | `defaultHeightmapForClinicalStep` + `clinical-workflow-store` `setStep`/`goNext`/`goBack`. Grader **G3**; worker `viewer-tab-defaults.test.ts` (locally green). |
| C8 | Print/Export default solid with light hardness tint + stronger shading | **PASS** | Lighter tint via `printExportSolid` + `INSOLE_PRINT_EXPORT_TINT_MIX`. `InsoleContourLighting` lower ambient / higher key; `Viewer3D` `contourLighting = printExportSolid`. Grader **G4**. |
| C9 | User viewport toggles still work after tab change | **PASS** | Worker `viewer-tab-defaults.test.ts` documents manual toggle until next tab change (locally green). |
| C10 | Existing viewer/element tests stay green | **PASS-WITH-RESIDUALS** | Worker tests pass locally (`split-overlay.insole-tint`, `viewer-tab-defaults`, `InsoleContourLighting`). **Residual:** three new worker test files missing from `ci/unit-test-shards.json`, so GitHub Actions never runs them on PR #487. |
| C11 | Full CI green on head SHA | **FAIL** | GitHub Actions run [45761658819](https://github.com/kdho77/OrthoCAD-/actions/runs/45761658819) on `ec88e52f`: all six `unit-tests` shards failed at `validate-unit-test-shards.mjs` — *Missing:* `InsoleContourLighting.test.ts`, `viewer-tab-defaults.test.ts`, `split-overlay.insole-tint.test.ts`. `isolated-postgres-acceptance` succeeded; Vercel succeeded. |
| C12 | Draft PR handoff (screenshots, test list, SHA/residuals) | **PASS-WITH-RESIDUALS** | Draft PR exists with short body. **Residual:** no before/after screenshots or explicit test list in PR #487 body (brief asked for these). Optional insole hardness viewport legend not added (brief: only if fits existing UI — acceptable omission). |

## Independent grader tests

File: `vertex/tests/pr487-hardness-tint.grader.test.ts` (gates **G1–G6**). All passed locally on grader branch.

## Residuals (for worker handoff, not fixed here)

1. Regenerate / update `ci/unit-test-shards.json` to include the three new worker test files (and any grader-only files if merged).
2. Expand PR #487 description with before/after screenshots (heatmap Corrections + Print/Export tinted/shaded, ≥2 hardness values) and explicit test checklist.
3. Re-run CI after shard fix; brief requires green `test-and-deploy`.

## Commands used

```bash
npm test -- vertex/tests/pr487-hardness-tint.grader.test.ts
npm test -- vertex/src/lib/hardness/split-overlay.insole-tint.test.ts \
  vertex/src/components/viewer/viewer-tab-defaults.test.ts \
  vertex/src/components/viewer/InsoleContourLighting.test.ts
```