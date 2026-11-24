# Right-foot [S1-PRELOFT] rim-follow gates

BASE `f759bde1e212ae99d475601fc58dd89dd37469c7`. Gate logic is frozen in the commit that adds this directory. Do not edit the checkers after that commit. This file is the results table.

Candidate: not opened. `cursor/right-preloft-rim-follow-1124` had no pull request when these gates were frozen. Grade that head with `node validation/right_preloft_rim_follow_gates/grade-candidate.mjs <sha>` when it exists. Do not invent a SHA.

## Results on BASE

| Gate | Threshold | Measured on main | Result |
| --- | --- | --- | --- |
| Right US M5 narrow, 9 mm heel cup, default met pad, mirrored | Pass S1-PRELOFT at `SKEW_INSET_RATIO = 0.5` | `[S1-PRELOFT] 360 station(s): skew[20]=0.974>0.912` | FAIL (no-op) |
| Right US M6, same build | Same cap | `[S1-PRELOFT] 361 station(s): skew[20]=0.988>0.920` | FAIL (no-op) |
| Right US M8, same build | Same cap | `[S1-PRELOFT] 374 station(s): skew[20]=0.957>0.945` | FAIL (no-op) |
| `assertPreLoftStations` body | SHA-256 `822d85299ff2e2ad26e43af621da49e09d30391e8169f7eb9eb10428eb28781f` | same hash | PASS |
| `SKEW_INSET_RATIO` | exactly `export const SKEW_INSET_RATIO = 0.5;` | one match | PASS |
| Copy with ratio `1` | rejected | exit 1 | PASS (bad-change) |
| Copy with `skewCap` multiplied by 4 | rejected | exit 1, body hash mismatch | PASS (bad-change) |
| Left pins `s9-medium`, `s8-medium`, `s8.5-narrow-height9-met`, `s10-narrow-height9-met` | SHA-256 and vertex counts in `frozen/left-pins.json` | rstest passedTests 2, failedTests 1, and the only failure is the Right gate | PASS |
| One-nibble Left hash change | rejected | `check-left-pins.mjs --self-test` | PASS (bad-change) |
| Product-file diff vs BASE | 0 paths outside this directory | 0 product paths | PASS |
| A product path in the classifier | rejected | `vertex/src/lib/kiri/slicer.ts` | PASS (bad-change) |
| Outer surface, seam, layer-change, surface-quality files | SHA-256 in `frozen/surface-files.sha256` (10 files) | all match | PASS |
| Copy with outer perimeters reversed | rejected | exit 1 | PASS (bad-change) |
| Copy with layer-change timing edited | rejected | exit 1 | PASS (bad-change) |
| Copy with ring-seam start moved | rejected | exit 1 | PASS (bad-change) |
| Worker candidate | grade `cursor/right-preloft-rim-follow-1124` | branch / draft PR not found | not graded |

Right US M6 on main is the same first skew as the observed Right failure: 361 stations, `skew[20]=0.988>0.920`, still at the 0.5×inset cap.

## Commands

```bash
node validation/right_preloft_rim_follow_gates/check-cap.mjs
node validation/right_preloft_rim_follow_gates/check-surface.mjs
node validation/right_preloft_rim_follow_gates/check-product-diff.mjs
node validation/right_preloft_rim_follow_gates/prove-bad-change.mjs
node validation/right_preloft_rim_follow_gates/prove-noop.mjs
node validation/right_preloft_rim_follow_gates/grade-candidate.mjs <commit>
```

`prove-noop.mjs` exits 0 only when Right M5/M6/M8 each throw `[S1-PRELOFT]` skew and the other two tests in the file pass. On this BASE run it exited 0. Logs: `proofs/noop-main.log`, `proofs/bad-change.log`, `proofs/product-diff.log`, `proofs/static-main.log`.

The geometry file is `right-preloft-rim-follow.optional.test.ts`, so the default unit shards do not run it. The Right cases are expected to fail on main; that failure is the no-op proof, not a product regression in CI.

## Candidate

| Gate | Candidate SHA | Result |
| --- | --- | --- |
| Right M5/M6/M8 pass at 0.5×inset | — | not graded |
| Left pins identical to main | — | not graded |
| Cap and `assertPreLoftStations` unchanged | — | not graded |
| No outer-surface, seam, or layer-change change | — | not graded |
| Grader files untouched | — | not graded |
