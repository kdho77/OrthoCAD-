# Export-cache double-engrave gates

Independent grade of worker draft PR #411. Gates were frozen at `c95fe6002be2dd9d33e2998003095006e0ef52f5` before this run and were not edited afterward. This file is the grade record only.

| | |
| --- | --- |
| BASE | `9dd3542900fc6c127a4c5ce205c649071cad8690` |
| Candidate | `bff60d64dcbb94a9ed6727f95d5248bd4f0b2028` (PR #411 head) |
| Worker patch | `268aac85847160b5b2703a05688721ea4cb93b24..bff60d64` (6 files) |
| Verdict | **PASS** — 26/26 gates pass on the candidate |

## Commands

```bash
# BASE (this branch, product tree == 9dd35429)
bash validation/export_cache_no_double_engrave_gates/run-gates.sh /tmp/gates-base.jsonl
# exit 1. The 10 defect gates fail on BASE. Every invariant gate passes.

# Candidate (detached worktree at bff60d64, frozen gates copied in, product files untouched)
bash validation/export_cache_no_double_engrave_gates/run-gates.sh /tmp/gates-candidate.jsonl
# exit 0. 26 passed, 0 failed.

# Existing tests on the candidate worktree
npx rstest run --pool.maxWorkers 1 \
  vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.test.ts \
  vertex/src/stores/clinical-workflow-print-loft.test.ts \
  vertex/src/stores/preview-loft-status-store.test.ts
# exit 0. 16 passed, 0 failed.
```

GitHub Actions on `bff60d64` (run 45271990905): unit-tests (1) through (6) success, isolated-postgres-acceptance success, test-and-deploy success. `test-and-deploy` aggregates those jobs and builds the MCP package. It does not deploy. `default-procedural-smoke` skipped (workflow_dispatch only).

## Results

A gate grades the candidate. `expectOnBase=fail` means BASE is supposed to miss the threshold; that row is the defect the worker was asked to fix. Worker PASS means the candidate measurement met the threshold.

| Gate | Expect on BASE | BASE measured | Candidate measured | Worker |
| --- | --- | --- | --- | --- |
| R1 | pass | 0 files differ | 0 files differ | PASS |
| R2 | pass | 0 files differ | 0 files differ | PASS |
| R3 | pass | productFiles=0 | productFiles=6, all on the allowlist | PASS |
| R4 | pass | engrave sources unchanged | engrave sources unchanged | PASS |
| R5 | pass | 0 secret lines | 0 secret lines | PASS |
| R6 | pass | 0 files differ | 0 files differ | PASS |
| T1-control | pass | apply=0 engrave=0 | apply=0 engrave=0 | PASS |
| T1-engraved | fail | apply=2 engrave=0 built=0 reused=2 elapsedMs=2.6 | apply=0 engrave=0 built=0 reused=2 elapsedMs=2.3 | PASS |
| T1-pretext | pass | apply=1 engrave=0 fromCache=true | apply=1 engrave=0 fromCache=true | PASS |
| T2-name | fail | equal=true `9dcc9c838119` | equal=false `667328c9309d` / `32ba9daa2173` | PASS |
| T2-toggle | fail | equal=true | equal=false | PASS |
| T2-extra | pass | equal=false | equal=false | PASS |
| T2-lr | fail | equal=true | equal=false | PASS |
| T2-param | pass | equal=false | equal=false | PASS |
| T2-empty | fail | aligned=true checkboxOffMisses=false | aligned=true checkboxOffMisses=true | PASS |
| T2-fresh-name | fail | rejected=false built=0 reused=1 | rejected=true built=1 reused=0 | PASS |
| T2-fresh-extra | pass | rejected=true built=1 reused=0 | rejected=true built=1 reused=0 | PASS |
| T2-fresh-toggle | fail | rejected=false built=0 reused=1 | rejected=true built=1 reused=0 | PASS |
| T3-export | pass | epoch 5→5, cache print-solid | epoch 5→5, cache print-solid | PASS |
| T3-corrections | pass | epoch=6 dropped=true returnEpoch=6 phases=idle/idle | same | PASS |
| T3-viewer | fail | reconstructCalls=1 phase=error mark=none | reconstructCalls=0 phase=ready mark=print-solid | PASS |
| T4-stock-left | pass | sha `ad742f2e7e6f` tris=110308 euler=2 watertight delta=0 mm warmMs=1316.1 warmBuilt=0 | same sha, tris, euler, delta=0, warmMs=1323.9 warmBuilt=0 | PASS |
| T4-stock-right | pass | sha `9f865d8b380a` tris=111116 euler=2 delta=0 warmMs=1271.5 | same sha, tris, euler, delta=0, warmMs=1106.8 | PASS |
| T4-engrave-left | fail | sha `3f543a6dd8a9` tris=148648 euler=2 delta=0 warmMs=9608.6 | same sha, tris, euler, delta=0, warmMs=1402.2 | PASS |
| T4-engrave-right | fail | sha `e8152598d74b` tris=150284 euler=2 delta=0 warmMs=9462.1 | same sha, tris, euler, delta=0, warmMs=1402.9 | PASS |
| T4-other-name | pass | sha `028fe4eeae76` tris=146112 euler=2 delta=0 differs from GATE SAMPLE | same | PASS |

Thresholds (frozen in `support.ts`): T1 reuse `elapsedMs<500` and `apply=0` on an already engraved solid; fingerprints differ when the name, toggle, extra line, per-foot line, or heel-cup height changes; empty default key stays aligned with no text marking and checkbox-off misses; Print→Export keeps epoch 5 and the cache; Print→Corrections bumps to 6 and drops the cache; Export viewer `reconstructCalls=0`; STL sha matches the BASE oracle or vertex delta `<=0.0` mm, euler=2, watertight, warm STL `<8000` ms, warmBuilt=0.

## What the numbers say

On this machine a warm export of an already engraved patient name takes 9608.6 ms (left) and 9462.1 ms (right) on BASE, and 1402.2 ms / 1402.9 ms on the candidate. The bytes do not change (`3f543a6dd8a9` left, `e8152598d74b` right). That is the second manifold pass no longer running. Stock SAMPLE_Top stays byte-identical to main (110308 and 111116 triangles, the same counts the worker published) with warm export 1323.9 ms left and 1106.8 ms right. The viewer loft call goes from 1 to 0 when the fingerprint matches.

The worker's PR body says about 12.8 s for the failing second pass and about 19 s for the wall loft, measured on their runner. This grade did not reproduce those two figures. It reproduced the behavior: the second engrave is skipped, the loft is not started again, and the STL matches main.

## Proofs, run before the freeze commit

No-op on BASE passed: T1-control, T1-pretext, T2-extra, T2-param, T2-fresh-extra, T3-export, T3-corrections, R1–R6. Defect gates failed on unmodified BASE: T1-engraved (apply=2), T2-name (equal=true), T3-viewer (reconstructCalls=1).

Bad copies failed: T1-control, T1-pretext, T2-extra, T3-export, R1–R6 (surface edit plus a fake `api_key` line), T4-stock-left after a 0.25 mm shift (`coldDeltaMm=0.25`, euler=1, watertight=false, sha `6b060afdb110`).

Positive controls passed: good-t1 made T1-engraved pass and made T4-engrave-left pass at warmMs=1816.3 with sha `3f543a6dd8a9` and delta 0 mm; good-t2 made the T2 gates pass; good-t3 made T3-viewer pass.

## Residual

The candidate branch point is `268aac85`, three commits behind BASE (`a4c2c2d7`, `f435d670`, `9dd35429`). Those commits are not in the worker patch. SAMPLE_Top stock and the two engraved names still match current main byte for byte, and GitHub reports PR #411 mergeable. Rebase onto `9dd35429` before merge so that history is the one under test.
