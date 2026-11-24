# Independent grade — PR #437

Graded **2026-11-24** (UTC). Gates frozen before grading; gate test sources not edited after freeze.

## Candidate

| Field | Value |
|-------|-------|
| PR | [#437](https://github.com/kdho77/OrthoCAD-/pull/437) |
| SHA | `675b690033da3b6e0d6d3f04ecec63924a99ecc1` (unchanged vs brief) |
| BASE | `cc6482be37175bd7db3c25e3179e22753e5dd899` |

## Proofs (BASE tree = gates branch)

| Proof | Command | Outcome |
|-------|---------|---------|
| No-op | `./validation/cadop_slice_submit_unavailable_gates/scripts/run-noop-proof.sh` | **PASS** — gate suite exit 1 on BASE client (4/9 tests failed: G1×2, G2×2, G4×1; G3 already passes on BASE) |
| Bad-change | `./validation/cadop_slice_submit_unavailable_gates/scripts/run-bad-change-proof.sh` | **PASS** — 4/4 anti-pattern meta tests |

## Candidate grade (detached worktree @ candidate SHA)

| Proof | Command | Outcome |
|-------|---------|---------|
| Full gates | `./validation/cadop_slice_submit_unavailable_gates/scripts/grade-candidate.sh` | **PASS** — 9/9 tests |

### Per-gate grades

| Gate | Grade | Measured |
|------|-------|----------|
| **G1** Concurrent submit + poll | **PASS** | `posted=2`; job ids `gate-job-1`/`gate-job-2` (fast path) and `late-1`/`late-2` after 50s materials + 21s POST; both polled to gcode |
| **G2** Bounded retry after >20s | **PASS** | First hung POST still alone at 59s simulated; `posted=2` after 61s; retry backoff gap ≥250ms measured |
| **G3** No retry on 4xx/5xx | **PASS** | POST count = 1 for status 400, 422, 500 |
| **G4** Missed 202 → one poll | **PASS** with **residual** | `enqueuedJobIds=2` (`job-orphan`, `job-live`); `polledToCompletion=1` (`job-live`); **orphan count = 1** |
| **G5** Diff scope | **PASS** | 3 files only: `vertexslice-client.ts`, `vertexslice-client.test.ts`, `cad-operator-production.test.ts` |

## CI on #437 @ `675b6900`

GitHub Actions run [45512289484](https://github.com/kdho77/OrthoCAD-/actions/runs/45512289484) on head SHA:

- **isolated-postgres-acceptance** — success  
- **unit-tests (2–5, 3)** — success (at grade time)  
- **unit-tests (1, 6)** — still `in_progress` at first grade poll; re-check before merge  
- **default-procedural-smoke** — skipped (path filter)  
- **Vercel** — success  

Combined commit status API: **success** (Vercel deployment).

## Overall

**Candidate PASSES** independent frozen gates G1–G5. **Documented residual:** one orphan queued job when a 202 is lost and retry enqueues `job-live` (G4 measured orphan count **1**).

## Next step

Wait for Kendon's merge-and-deploy go on **#437**. This grader did **not** merge, deploy, or run live pair `generate_gcode`.