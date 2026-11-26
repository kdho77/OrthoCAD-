# [Grader] PR #475 — generate reliability

**Verdict: PASS-WITH-RESIDUALS**

Graded target: `edd53e8aefa0315981e01dd1a26ca456b1d320f4` ([PR #475](https://github.com/kdho77/OrthoCAD-/pull/475))  
Grader branch: `cursor/grade-pr-475-gen-reliability-1125` (draft only — **do not merge**)

Evidence is from (1) pinned diff review `main…edd53e8`, (2) independent grader tests in `pr-475-independent-grader.test.ts` (MCP + server), (3) re-run of PR-owned tests named in the brief (not taken on faith), (4) GitHub check runs on `edd53e8`.

## Gate table

| Gate | Verdict | Evidence |
| --- | --- | --- |
| **ONE** — generate is fast to return, retry-safe, never silently loses a foot | **PASS** | `beginCadOperatorProduction` returns `{ status: "pending", productionId }` before `schedule(preflight+execute)` (`cad-operator-production.ts` ~1232–1290). MCP `GENERATE_ENQUEUE_ATTEMPT_MS * GENERATE_ENQUEUE_ATTEMPTS < 60_000`. Pair path throws `No partial pair is returned` (`handlers.ts`). Independent grader MCP test: non-transient left error omits right id. |
| Generate returns production id immediately; MCP call must not hit -32001 waiting on loft/preflight | **PASS** | Grader: `beginCadOperatorProduction resolves with an id before background execute finishes`. Worker re-run: `production-poll.test.ts` `generate_gcode returns as soon as both feet are queued` (<200ms with 80ms mocked TRPC). `getVertexSliceBuild` health race bounded (`HEALTH_TIMEOUT_MS = 5_000`, `timer.ref`) — `vertexslice-build.test.ts` hung-health case. |
| Pair mode all-or-nothing; retry submit unavailable, fetch failed, lease expiry; clear per-foot error otherwise | **PASS** | `isTransientProductionFailure` / `isTransientGenerateFailure` + 3 attempts. Re-run: `production-poll.test.ts` pair retry + lasting failure tests; `generate-reliability.test.ts` execute retry matrix. Grader MCP: license error → partial pair blocked. |
| Production path never looks up stored manufacturing STLs; rebuild from saved design | **PASS** | `storedManufacturingStlReusable` always `false`. No `downloadManufacturingStl` in production router sources (grader static scan). Re-run: `generate-reliability.test.ts` stale checkpoint slices `tmp/rebuilt-right.stl`. |
| Concurrency cap raised with test | **PASS** | `LOFT_WORKER_LIMIT = 4`; re-run `generate-reliability.test.ts` four parallel `occupyLoftWorker`. |
| Register new tests in `ci/unit-test-shards.json` | **PASS** | `generate-reliability.test.ts` and `production-poll.test.ts` extensions present on `edd53e8`; manifest validates on grader commit (`390` files / 6 shards). |
| Rebuild like UI export; no stored STL/checkpoint reuse | **PASS** | Same as STL gate; `resumeSubmittedSlice` only when `rematerialized === true` (source grep in worker test; unchanged identity helpers — no diff hunks on `cadOperatorManufacturingIdentity`). |
| Design change invalidates cached STL/G-code | **PASS** | No changes to `cadOperatorManufacturingIdentity` in PR diff; `vertexslice-build.test.ts` build-key reuse tests still pass unchanged. |
| Patient name on bottom of both feet | **PASS** | No diff in text-marking / loft geometry paths (`G-scope`); CI `plantar-name` success on `edd53e8`. |
| Medium/default & working designs byte-identical; no surface/seam/layer/surface-quality change | **PASS** | No `vertex/src` mesh/loft files in PR diff (`G-scope` test). Only operational/reliability paths changed. |
| No scope growth beyond brief FILES | **PASS** | `git diff main…edd53e8` — exactly 12 files listed in brief (`G-scope` grader test). |
| Copy conventions; no invented clinical magnitudes | **PASS** | Operational timeouts (5s/12s/20s/45s) and loft cap `4` are infra bounds; grep of PR `+` lines shows no new pad/posting/hardness defaults (`G-invent`). |
| **G-CI** — full CI green on graded SHA | **PASS** | GitHub checks on `edd53e8`: `unit-tests (1–6)`, `isolated-postgres-acceptance`, `test-and-deploy`, `plantar-name` — all `success` (run `45752903764` / `45752903750`). |
| **G-invent** | **PASS** | See above. |
| **G-scope** | **PASS** | Pinned diff file list. |

## Residuals (not failing gates)

1. **Health still before insert** — `getVertexSliceBuild` remains on the enqueue path (bounded at 5s). Brief residual accepted in worker handoff.
2. **Dead *running* worker** — reclaim waits for lease expiry, not the 45s pending stale threshold; avoids double loft.
3. **Transient matcher includes `Manufacturing timed out (`** — retries manufacturing timeout; consistent with production symptom list, not slice-cap errors (explicitly excluded).

## Independent grader tests added (this PR)

- `vertex/server/src/lib/pr-475-independent-grader.test.ts`
- `packages/mcp/test/pr-475-independent-grader.test.ts`

Local run (grader branch): `npm test -- vertex/server/src/lib/pr-475-independent-grader.test.ts packages/mcp/test/pr-475-independent-grader.test.ts` — all passed; plus re-run of `generate-reliability.test.ts`, `production-poll.test.ts`, `vertexslice-build.test.ts` — all passed.

## No fixes applied to PR #475

This branch only grades and adds verification tests. Worker branch `cursor/the-bot-s-generate-call-is-fast-to-return-retry-safe-and-never-silently-loses-a-foot-e2a3` was not edited.