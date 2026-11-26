# Independent grade: PR #471 bulk delete

**Subject:** `kdho77/OrthoCAD-` PR [#471](https://github.com/kdho77/OrthoCAD-/pull/471) @ `02757d523f08d418062431633d01f0fafdd117e3`  
**Grader branch:** `cursor/grade-pr-471-bulk-delete` (draft; never merge)  
**Tests:** `vertex/grader/pr-471-bulk-delete-gates.test.ts` + upstream `*.bulk-delete.test.*`

## Gate results

| Gate | Result | Evidence |
|------|--------|----------|
| G1 | PASS | Row/header checkboxes + indeterminate on partial (`G1: header select-all indeterminate…`). Checkbox does not `navigate`; row name button does. |
| G2 | PASS | `delete-selected` disabled at N=0; label `Delete selected (2)` when two checked. |
| G3 | PASS | Dialog title includes count; cancel leaves `deletedAt` null; bulk dialog uses same `hasExport` + `phrase === "DELETE"` rule as `DeleteDesignDialog`. |
| G4 | PASS | `softDeleteDesigns` loops `softDeleteDesign` only; spy shows 3 calls for 3 ids; no API/server paths in helper. |
| G5 | PASS | Error banner names failed design; succeeded row removed; failed row stays listed and selected; count drops to 1. |
| G6 | PASS | `git diff main..02757d52` — exactly 4 files, all in allowlist; no geometry/export/production/server paths. |
| G7 | **FAIL** | GitHub Actions run [45748109563](https://github.com/kdho77/OrthoCAD-/actions/runs/45748109563) on `02757d52`: all `unit-tests (*)` shards fail at `validate-unit-test-shards.mjs` — count 389 vs manifest 387; missing `ClientFilePage.bulk-delete.test.tsx` and `client-store.bulk-delete.test.ts` in `ci/unit-test-shards.json`. `test-and-deploy` still in progress at grade time. Vercel + `isolated-postgres-acceptance` succeeded. |

**Overall: FAIL** (G7 blocks merge readiness; G1–G6 pass independent grader tests.)

## Local test evidence (2026-11-26)

```text
npm run test -- vertex/grader/pr-471-bulk-delete-gates.test.ts  → 9/9 pass (pre-G7 test)
npm run test -- vertex/src/features/clients/ClientFilePage.bulk-delete.test.tsx vertex/src/stores/client-store.bulk-delete.test.ts → 9/9 pass
```

## How to re-run grader tests

```bash
cd /path/to/OrthoCAD-
npx rstest vertex/grader/pr-471-bulk-delete-gates.test.ts vertex/src/features/clients/ClientFilePage.bulk-delete.test.tsx vertex/src/stores/client-store.bulk-delete.test.ts
```