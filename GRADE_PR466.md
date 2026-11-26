# Independent grade: PR #466

**Worker PR:** [#466](https://github.com/kdho77/OrthoCAD-/pull/466)  
**Worker SHA:** `b9083a1319f88a3c435c294b756715c5ddd6cd76`  
**Grader branch:** `cursor/grade-pr-466-per-foot-wedges-1125`  
**Verdict:** **PASS**

Grader tests (do not merge): `vertex/src/lib/clinical/grade-pr-466-per-foot-wedge.grader.test.ts`, `packages/mcp/test/grade-pr-466-mcp.grader.test.ts`.

## Gate table

| Gate | Result | Evidence |
| --- | --- | --- |
| ONE — wedges per foot from bot with documented sign | PASS | `foot` on `rearfoot_wedge` / `full_length_wedge`; MCP tool text + Zod `.describe()` |
| foot field left/right/both, default both byte-identical | PASS | Grader AC1: omitted `foot` → both feet, `linked: true`, legacy paths |
| L-only wedge changes only left solid | PASS | Grader AC2/AC2b: SHA-256 solid checksum, right foot unchanged |
| posting sign documented + tested (varus/valgus ↔ medial/lateral) | PASS | Grader AC3/AC4; matches `migrateSideCorrections` (+ lateral, − medial) |
| MCP mapping + docs | PASS | `grade-pr-466-mcp.grader.test.ts`; bundle hash `9aa2fdab…` |
| Register tests in `ci/unit-test-shards.json` | PASS | Worker registered `per-foot-wedge.test.ts`; grader adds two grader files |
| G-scope — diff inside brief FILES (7 files) | PASS | `git diff main...b9083a13 --stat` = 7 files |
| G-invent — no invented clinical magnitudes | PASS | 2°/4° are test inputs only; no new defaults in catalog |
| G-CI — full CI green on worker SHA | PASS | GitHub Actions run 45744041413: unit-tests 1–6, plantar-name, isolated-postgres, test-and-deploy success |
| Production path rebuilds saved design (no STL reuse) | PASS | Snapshot-only write in `saved-design-snapshot.ts`; no export/cache edits |
| Default/medium designs unchanged when `foot` omitted | PASS | AC1 legacy parity |
| Draft only / no merge | PASS | PR #466 `draft: true`; grader PR draft |
| Hard rule: patient name / outer surface / scope | PASS | No files outside wedge + MCP catalog scope |

## Residuals

- **Driscoll** named in brief with no wedge/posting values in repo — not encoded (worker residual; acceptable).
- **Suiters** lateral full-length L-only proven with 4° fixture, not order prescription degree (documented in worker test).
- **Combined GitHub status API** reports only Vercel; full gate uses check-runs list (all green).

## CI reference

- Workflow: https://github.com/kdho77/OrthoCAD-/actions/runs/45744041413  
- Head: `b9083a1319f88a3c435c294b756715c5ddd6cd76`