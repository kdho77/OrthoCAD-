# Independent grader report: PR #486 vs hardness-tint brief

**Subject PR:** [#486](https://github.com/kdho77/OrthoCAD-/pull/486)  
**Head SHA:** `42d58d5b602671ab951fd7101ceb65ac9d88f844`  
**Head branch (misnamed):** `cursor/snapshot-saves-merge-with-stored-clinical-settings-instead-of-resetting-arch-apex-hardness-to-templa-a97a`  
**Grader SHA:** (this branch)  
**Verdict:** **FAIL**

## Executive summary

PR #486’s title and body describe Kendon t2785u/t2786u **viewport hardness tint** and **per-tab view defaults**, but the sole commit (`Fix snapshot persist to merge omitted clinical catalog keys`) changes only server-side snapshot merge behavior (`vertex/server/src/lib/saved-design-snapshot.{ts,test.ts}`). None of the brief’s viewer, store, or export-parity deliverables are present. CI on `42d58d5b` is green; that only validates the unrelated snapshot work.

## PASS/FAIL table

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Kendon t2785u: whole insole mesh tints by selected insole hardness using element preview colors | **FAIL** | `BaseInsoleMesh.tsx` / `InsoleMesh.tsx` use fixed `#f8fafc` `sideColors`; no `CLASS_PREVIEW_COLORS` or `defaultHardness` wiring. Grader: `pr-486-hardness-tint-grader.test.ts` (t2785u block). |
| 2 | Distinct color per hardness; changing hardness updates tint | **FAIL** | `CLASS_PREVIEW_COLORS` exists in `hardness-class-table.ts` but is not imported into base insole materials. |
| 3 | Visual only: export STL/3MF/GLB/G-code bytes unchanged; parity test | **PASS-WITH-RESIDUALS** | PR does not touch export pipelines (diff has no `export-service` / mesh-close). **Residual:** no new viewport-specific byte parity test was added (brief asked for one). |
| 4 | Elements stay distinguishable; transparent/heightmap modes preserved | **FAIL** | No insole tint implemented; cannot verify distinguishability or print/export tint rules. Existing heightmap path unchanged (not a regression in diff). |
| 5 | No insole hardness → gray/white default | **FAIL** | Still fixed gray `#f8fafc`; no hardness-null branch added (unchanged from main). |
| 6 | Design tabs (Scan–Elements) default to Heatmap | **FAIL** | `clinical-workflow-store.ts` `setStep` only updates `step`; `design-store` initial `viewer.heightmap` remains `false`. |
| 7 | Print/Export default solid view with light hardness tint + stronger shading | **FAIL** | No print/export lighting or lightened tint hooks in viewer sources touched by PR (or on tree at head). |
| 8 | Per-tab default view-mode unit test | **FAIL** | Not in PR diff. |
| 9 | Insole hardness → material color unit test | **FAIL** | Not in PR diff. |
| 10 | Draft PR hygiene: screenshots, test list, handoff | **FAIL** | Body is one line; no screenshots; no test list; commit message contradicts title. |
| 11 | Full CI green on `42d58d5b` | **PASS** | GitHub Actions: `unit-tests (1–6)`, `isolated-postgres-acceptance`, `test-and-deploy`, Vercel — all `success` (run `43674681240`). |
| 12 | PR diff matches stated worker scope (snapshot merge) | **PASS** | Only `saved-design-snapshot.ts` (+115) and `.test.ts` (+123); grader re-ran `saved-design-snapshot.test.ts` locally — pass. |
| 13 | Brief file scope (viewer/hardness) touched | **FAIL** | `git diff main...42d58d5b --name-only` → 2 server files only. |

## Residuals

- **Wrong work on PR #486:** Snapshot clinical merge is reasonable server work but is not the hardness-tint brief; branch name matches server work, not PR title.
- **Misleading metadata:** Title/body claim viewport features the diff does not contain.
- **Export parity:** Accidental PASS on byte identity (no export code changed); brief still lacks an explicit viewport-only parity test.

## Independent tests

```bash
npm test -- vertex/grader/pr-486-hardness-tint-grader.test.ts
# Expect 8 failed / 3 passed at PR head (failure = brief not met)

npm test -- vertex/server/src/lib/saved-design-snapshot.test.ts
# Expect pass (actual PR scope)
```

## Recommendation

Do **not** merge PR #486 for the hardness-tint brief. Re-open or retarget with `cursor/insole-hardness-tint-1125` (or equivalent) implementing viewer changes, or close #486 and open a separate snapshot PR with matching title/body.