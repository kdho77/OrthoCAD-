# Grade of PR #428

Overall: **FAIL**. Gates A, B, and C pass. Gate D fails. Do not merge.

| | |
| --- | --- |
| Candidate | `9e724699a10463ee123b0425cc44966d14afa68d` (draft PR #428) |
| BASE | `8aced4b5042bdafc2d300006fa80802bca1b94b9` |
| Frozen gates | `7e64021980c0a97dcd2520a2abc68873f711a204` on `cursor/cadop-txn-timeout-wait-s-gates-1124` |
| Product checkout | detached worktree of the candidate SHA (removed after the run) |

Command for A–C, then D after `test-and-deploy` finished:

```bash
ORTHOCAD_ROOT=/tmp/cadop-candidate GATE_SHA=9e724699a10463ee123b0425cc44966d14afa68d \
  node validation/cadop_txn_timeout_wait_s_gates/run-gates.mjs
ORTHOCAD_ROOT=/tmp/cadop-candidate GATE_SHA=9e724699a10463ee123b0425cc44966d14afa68d \
  node validation/cadop_txn_timeout_wait_s_gates/run-gates.mjs --only=d
```

The suite exit was 1.

## Gate A — PASS

A both-feet `executeCadOperatorProduction` with a 6000 ms synchronous loft stub (real loft and slicer not called).

| Measurement | Value | Threshold |
| --- | --- | --- |
| left status | succeeded | succeeded |
| right status | succeeded | succeeded |
| left error | null | no `Manufacturing timed out` |
| right error | null | no `Manufacturing timed out` |
| open interactive transaction during loft | false | false |
| interactive transactions opened | 0 | none left open across the loft |
| max interactive elapsed | 0 ms | ≤ 5000 ms |
| loft stub | 6000 ms / 6000 ms | > 5000 ms |
| uploaded G-code | matches the 19-byte fixture on both feet | byte-identical |

## Gate B — PASS

| Measurement | Value | Threshold |
| --- | --- | --- |
| advertised `wait_s` | number, minimum 0, maximum 300, not required | 0–300, optional |
| parse 300 / 301 / 0 / omitted / -1 | accept / reject / accept / accept / reject | cap 300 |
| omitted `wait_s` | 1 fetch, 1 ms, status pending | one fetch |
| `wait_s` 0 | 1 fetch, 0 ms, status running | one fetch |
| `wait_s` 30 until succeeded | 2 fetches, 2001 ms, status succeeded | ≥ 2 fetches and ≥ 1900 ms |
| `wait_s` 1 while still running | 1 fetch, 1002 ms, status running | blocks until the deadline |
| hosted bundle | `wait_s` `.min(0)` `.max(300)` and `getProductionWithOptionalWait` | advertised and long-polling |

Residual, not a gate failure: `packages/mcp/src/http.ts` `MCP_FUNCTION_MAX_DURATION_SECONDS` is 60 and `vertex/api/mcp.ts` `maxDuration` is 60. A hosted `/api/mcp` call can still be stopped at 60 s, before `wait_s` 300 returns. Stdio is not under that cap. The handler and the advertised schema honor 0–300.

## Gate C — PASS

Fixed tetrahedron fixture, recorded at BASE `8aced4b5042bdafc2d300006fa80802bca1b94b9`:

| Artifact | SHA-256 | Bytes |
| --- | --- | --- |
| binary STL | `3d4f6262669cc8329a338d7cae4fc34e8811bbe8d28fc79a86a205fef6d5159d` | 284 |
| FDM G-code | `e12356a66777e9e0b9815d500168606d2f64eabedb5184ebf0f77d633e96d848` | 16120 |
| coupon STL `python-service/tests/fixtures/a1_coupon_40x40x6.stl` | `973ede4ee7b6de6738881be002888e4e16e835e4dd120f87590e6b572061ef57` | 684 |

`SKEW_INSET_RATIO` is `0.5` in `vertex/src/lib/geometry/procedural-wall/station-gates.ts` and `stations.ts`. 225 geometry, kiri, and cnc source files match BASE. No added, missing, or changed files in that set.

## Gate D — FAIL

GitHub check runs for `9e724699a10463ee123b0425cc44966d14afa68d`, workflow run `45452781982`, after every job completed.

| Measurement | Value | Threshold |
| --- | --- | --- |
| completed | 10 | all completed |
| success | 7 | at least one, and no failures |
| skipped | 1 (`default-procedural-smoke`) | allowed |
| pending | 0 | 0 |
| failed | `unit-tests (3)=failure`, `test-and-deploy=failure` | none |

`unit-tests (3)` failed 3 tests in `vertex/server/src/trpc-cad-operator.test.ts` (346 passed, 349 total in that shard; 1 file failed of 61). Each failure is `TypeError: this.prisma.production.updateMany is not a function` at `PrismaCadProductionStore.updateIf` (`cad-operator-production-prisma.ts:171`), called from `markFailed`. The caller-material Prisma double still has no `updateMany`. `test-and-deploy` then failed its step `Require unit shards and isolated PostgreSQL acceptance`.

## Proofs (frozen before this grade)

No-op on BASE `8aced4b5`: suite exit 1. Gate A failed with right status `failed`, error `Manufacturing timed out (right)`, `open_during_loft=true`, max interactive elapsed 6001 ms. Gate B failed because the advertised JSON schema has no minimum/maximum and the hosted bundle has no `wait_s`. Gates C and D passed on BASE. See `proofs/noop-base.txt`.

Bad-change: a 6000 ms block inside a 5000 ms interactive transaction is rejected; replacing the long-poll with one fetch measured `fetches=1`, `status=pending`, `elapsed_ms=0`; a one-line G-code change and a one-byte STL attribute change were rejected. See `proofs/bad-change.txt`.
