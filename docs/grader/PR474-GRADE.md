# Grader report: PR #474

**Graded commit:** `c14b59540a89576bb66d2f40ee4ddfd5a102492a` (worker branch; not modified)  
**Grader branch:** `cursor/grade-pr-474-cnc-envelope-1125`  
**Worker PR:** https://github.com/kdho77/OrthoCAD-/pull/474  
**Overall verdict:** **PASS-WITH-RESIDUALS**

## Measurable gates

| Gate | Verdict | Independent evidence |
| --- | --- | --- |
| **G-scope** — diff limited to brief FILES (+ grader-only additions on this branch) | PASS | Worker PR touches exactly 5 paths: `placement.ts`, `placement.test.ts`, `single-foot-envelope.test.ts`, `errors.test.ts`, `ci/unit-test-shards.json`. Grader adds `tests/grader/pr474-cnc-envelope-grader.test.ts`, `docs/grader/PR474-GRADE.md`, and one shard line. |
| **G-CI** — full CI green on worker SHA | PASS | GitHub Actions run on `c14b5954`: unit-tests (1–6), `isolated-postgres-acceptance`, `plantar-name`, `test-and-deploy` → **success**; Vercel preview **success**. |
| **G-invent** — no invented clinical magnitudes | PASS | `ENVELOPE_CLEARANCE_MM` remains `1` in `envelope.ts` (unchanged in diff). Whole-block inset uses existing `BLOCK_EDGE_GCODE_PAD_MM` (`0.01`). No new feed/cutter/stepover constants in diff. |
| **ONE** — CNC jobs that fit the table are placed and milled within the envelope, including single-foot orders | PASS | Independent grader test places `251.6×120` mm block on whole table with ≥1 mm envelope inset and ≥1 mm G1 tool-disk clearance; `US M 15` single-right integration still passes locally (`tests/cnc/single-foot-envelope.test.ts`, 15s). |
| **MUST-MATCH: Idaho pair pitch 130.175 mm** | PASS | `IDAHO_PROFILE` pocket Δy = `130.175`; synthetic pair `ty` delta = `130.175`; PR vs `main` digest identical: `tx=10.99`, `ty=65.0875 / 195.2625` (captured independently, not from worker assertions). |
| **MUST-MATCH: pair placement byte-identical to main** | PASS | Pair digest on `main` @ `228c72f2` matches PR head exactly (grader capture script, 2026-11-26). |
| **Guard not loosened** | PASS | `250×251.6` single foot still `no_fit` with pocket guard message (grader + worker placement tests). `errors.test.ts` still expects pocket `no_fit` (fixture uses shrunk table only). |
| **Peavy-like repro** | PASS | Frozen Peavy settings: pair half-pockets unchanged (±6°); single right stays in pocket; G-code generated without throw (worker integration test; grader did not re-fingerprint every tx constant). |
| **Lloyd single-right at risk** | PASS-WITH-RESIDUAL | Worker proxies via `usMenSize: 15` + Peavy mesh (not order `a0a26279` artifact). Independent run: single right `rotationDeg=0`, footprint clearance ≥1 mm, G1 tool clearance ≥1 mm on that proxy. |
| **Register tests in `ci/unit-test-shards.json`** | PASS | Worker registered `single-foot-envelope.test.ts`; grader registered `pr474-cnc-envelope-grader.test.ts`. |
| **Hard rule: bot/UI rebuild path / no manufacturing STL reuse** | PASS | No changes in MCP/export/upload paths in worker diff; placement-only XY fallback. |
| **Hard rule: medium defaults byte-identical unless defect requires** | PASS | Synthetic medium pair + Peavy pair poses unchanged vs `main` digest; Peavy numeric constants match worker table (verified by passing integration test). |
| **Hard rule: draft only, no merge/deploy** | PASS | PR #474 `draft: true`; grader PR is draft by instruction. |
| **Local independent grader suite** | PASS | `npm test -- tests/grader/pr474-cnc-envelope-grader.test.ts` — 4/4 passed (2026-11-26). |

## Residuals (not graded as FAIL)

1. **Mill preview** still uses `placeWorkpieces(..., { validate: false })`; preview can disagree with export for whole-block singles (worker noted; pre-existing for pairs).
2. **Live Peavy** production file called out in the original brief is not byte-identical to frozen `peavy-6236d861.settings.json`; worker documents that fixture does not repro the reported live failure on current `main`.
3. **Lloyd order `a0a26279`** is not loaded directly; coverage is the documented US M 15 single-right proxy.

## Grader artifacts

- Independent tests: `tests/grader/pr474-cnc-envelope-grader.test.ts`
- No edits to worker branch `cursor/cnc-jobs-that-fit-the-table-are-placed-and-milled-within-the-envelope-including-single-foot-orders-c9a0`