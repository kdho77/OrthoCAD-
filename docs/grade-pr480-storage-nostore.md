# Independent grade: PR #480 storage-nostore

**Graded subject:** [PR #480](https://github.com/kdho77/OrthoCAD-/pull/480) @ `b7494709b24b0e030b0eba614453d636dade759d`  
**Grader branch:** `cursor/grade-pr-480-storage-nostore-1125`  
**Overall verdict:** **PASS-WITH-RESIDUALS**

## Criterion table

| ID | Brief requirement | Verdict | Evidence |
|----|-------------------|---------|----------|
| C1 | Remove permanent `manufacturing-archive` copy; do not write `exports.sourceStlPath` | PASS | `archiveManufacturingSourceStl` removed; grader G1; `manufacturing-stl-lifecycle.test.ts` success path; grader G2 |
| C2 | Temp STL deleted after slice success and failure | PASS | `discardManufacturingTempStl` in routers; lifecycle integration test; session order now ends with `delete` not `archive` |
| C3 | Cad-operator G-code deleted after VO attach confirmed; 24h sweep for `gcode/` and `manufacturing-temp/` | PASS | `releaseGcodeAfterVoAttach` TRPC + MCP handler; `deleteCadOperatorGcodeAfterVoAttach`; lifecycle sweep test; grader G7 |
| C4 | UI G-code download via short-lived signed URL; object removed by sweep (not on read) | PASS | `MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC=3600`; `readGcodeFromSignedUrl`; lifecycle + `gcode-signed-download.test.ts`; grader G6 |
| C5 | Attach retry: each URL once per attempt; bounded retries (3) | PASS* | `VO_ATTACH_MAX_ATTEMPTS=3`; `vo-attach-download.test.ts`; grader G5. *Helpers are not called from any in-repo production attach client besides tests (see residuals). |
| C6 | G-code bytes unchanged vs main fixture | PASS | Production path still slices to `tests/fixtures/handedness/true_left_toe_first.gcode.gz` bytes in lifecycle test; no fixture diff in PR |
| C7 | No destructive migration; column nullable | PASS | No new migration in PR diff |
| C8 | No prod deletion; dry-run list script; `--confirm` does not delete | PASS | `list-stored-manufacturing-files.ts`; `storedManufacturingListPlan`; grader G4 |
| C9 | Extend cleanup sweep; document trigger | PASS | `cleanup-manufacturing-temp.ts` documents `0 9 * * *` host cron; grader G3 |
| C10 | No geometry / gate / baseline / slicer changes in PR scope | PASS | GitHub PR file list = 20 paths; grader G0; `git diff main...b7494709` has 0 bytes on fixtures/gates |
| C11 | Refuse reuse of stored archive STL | PASS | `downloadManufacturingStl` rejects `manufacturing-archive/` URLs |
| C12 | CI green on graded SHA | PASS | GitHub Actions run `45761065983`: `isolated-postgres-acceptance` success; all `unit-tests` shards success; Vercel success (checked 2026-11-26) |

## Independent tests added (grader only)

- `vertex/server/src/lib/pr480-storage-nostore.grader.test.ts` (G0–G7), registered in `ci/unit-test-shards.json`
- Local run: 17 tests across worker + grader files — all passed on graded tree before grader commit

## Residuals (not FAIL — documented for merge review)

1. **Short-lived at-rest window:** New jobs still persist G-code (and temps until slice) in `vertex-manufacturing` for up to **24 hours**; legacy `manufacturing-archive/*` objects are **never** deleted by this PR (per brief).
2. **Bounded attach download helpers** (`downloadVoAttachFilesForAttempt` / `downloadVoAttachWithBoundedRetries`) are **unit-tested only**; `prepare_vo_attachment` handoff still primarily uses `content_base64`, and no other in-repo caller invokes the download helpers yet.
3. **Bucket default change:** Sweep default max age moves from 48h → **24h** (capped); host cron must run `cleanup-manufacturing-temp.ts` — documented in script header, not enforced in CI.

## Out of scope

This grader does **not** modify PR #480’s branch. Do **not** merge either PR from this run.