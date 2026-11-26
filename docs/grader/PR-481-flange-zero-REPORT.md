# Independent grader report — PR #481

**Graded head:** `452a2f6c7b8804141e29d332f3cee38dd349a74b` (`cursor/an-explicit-flange-value-of-0-is-honored-f0d2`)  
**Base:** `228c72f2771a74e5b7c1d515ab0d01e4dd44d751` (`origin/main` at worker open)  
**Worker PR:** https://github.com/kdho77/OrthoCAD-/pull/481  
**Verdict:** **PASS** (no residuals)

## Acceptance criteria (original brief)

| ID | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| A1 | ONE: explicit flange 0 honored | PASS | G1, G4, G6; worker `flange-explicit-zero.test.ts` |
| A2 | Explicit 0 → no flange on that border | PASS | G1/G4 `borderDelta` &lt; 1e-6; worker height-field cases |
| A3 | Unspecified border keeps existing default | PASS | G5, G6b; worker defaults test |
| A4 | Readback shows value set (including 0) | PASS | G1 `readStoredDesignSettings` / `designStateFromSavedSettings`; server persist test |
| A5 | Heinrich `left.lateral_mm: 0` not forced to 3 | PASS | G1 build path; G6 persist with stored lateral 3 |
| A6 | Najim medial-only (no lateral 3 back-fill) | PASS | G2; worker medial-only case |
| A7 | Gomez lateral-only | PASS | G3; worker `lateralOnly` persist case |
| A8 | MCP create/persist accept `0` | PASS | G7; worker MCP test |
| A9 | Tests registered in `ci/unit-test-shards.json` | PASS | G9b; `validate-unit-test-shards.mjs` OK (390 files) |
| A10 | Full CI green on 452a2f6 | PASS | GitHub run [45756564033](https://github.com/kdho77/OrthoCAD-/actions/runs/45756564033): unit shards 1–6, isolated-postgres, test-and-deploy success; plantar-name [45756563973](https://github.com/kdho77/OrthoCAD-/actions/runs/45756563973) success |

## Kendon hard rules (measurable from diff + tests)

| Rule | Verdict | Evidence |
| --- | --- | --- |
| MCP/bot path rebuilds from saved design (no STL checkpoint reuse in this diff) | PASS | Only `saved-design-snapshot` merge + catalog mapping; no manufacturing artifact paths |
| Design change invalidates cached STL/G-code | PASS | No new cache reads in diff |
| Patient name on both feet | PASS | No engraving files in worker diff; CI `plantar-name` green |
| Unaffected designs byte-identical (no loft/export files) | PASS | G9a: exactly 7 files, all mapping/tests |
| Outer surface / seams / slice unchanged | PASS | G9a file list |
| No scope growth beyond ONE | PASS | G9a |
| Copy existing conventions (0 = none, 3 mm level default) | PASS | `resolveFlangeBorderMm` + `reapplyExplicitFlangeMm`; procedural `heightMm.recommended` 0 test |
| No invented clinical magnitudes | PASS | Uses existing `FLANGE_LEVEL_MM` / bounds only |

## Independent grader tests (this branch)

| File | Gates |
| --- | --- |
| `vertex/src/lib/clinical/flange-pr481.grader.test.ts` | G1–G5, G9 |
| `vertex/server/src/lib/flange-pr481.grader.test.ts` | G6–G8 |

Local run (2026-11-26): `npm run test -- vertex/src/lib/clinical/flange-pr481.grader.test.ts vertex/server/src/lib/flange-pr481.grader.test.ts` → 11/11 pass; worker flange tests pass independently on same tree.

## Root cause (independent)

1. **`resolveFlangeBorderMm`** (shared) treats `typeof explicit === "number"` including `0`, and avoids filling the opposite border when one side is explicit without `level`.
2. **Persist merge** skipped flange keys when a foot was named, but **stored** millimeters could still dominate until **`reapplyExplicitFlangeMm`** re-stamps catalog numbers after merge.

## Residuals

None for the stated defect.

## Next

Leave PR #481 in draft for human review. **Do not merge** this grader PR or the worker PR without explicit approval.