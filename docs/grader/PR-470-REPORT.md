# [Grader] PR #470 — Reverse Morton's watertight (independent)

**Subject:** kdho77/OrthoCAD- PR [#470](https://github.com/kdho77/OrthoCAD-/pull/470) @ `eac20fa4c8a5abcd1b340bf883ea4940fca8bf60`  
**Base:** `228c72f2771a74e5b7c1d515ab0d01e4dd44d751`  
**Verdict:** **PASS-WITH-RESIDUALS**

## Gate table

| Gate | Verdict | Evidence |
| --- | --- | --- |
| **ONE:** reverse Morton's builds watertight on both feet | **PASS** | Independent subprocess: `grader-pr-470-export-smoke.test.ts` L+R US M9 t3 cut 2 mm watertight euler 2 on subject worktree. Worker matrix 13/13 via subprocess on `eac20fa4`. |
| Latino `2a31cd8e` / design `2be9d906` repro (2 mm L+R, t3) | **PASS-WITH-RESIDUAL** | Patient name "Alex Latino" in export path; elements match brief (2 mm both feet, t3). US size not in repo — worker and grader use **US M9** (Latino-proxy). Exact shoe size unverified. |
| Milligan `427ddb58` same settings | **PASS-WITH-RESIDUAL** | Same element/thickness matrix as Latino-proxy; no Milligan fixture in repo (settings equivalence only). |
| Repro on main before fix | **PASS** | `grader-pr-470-independent.test.ts` main repro: base `apply-elements` + US M9 t3 2 mm left → `MeshNotWatertightError` (`heelBridgeSelfIntersections` > 0). |
| Permanent regression (both feet, t2/3, cut 1–3 mm) | **PASS** | `reverse-mortons-watertight.test.ts` on subject SHA: 12 export cases + 1 rim-hold unit test; grader subprocess confirms 13 passed. |
| Guard not loosened | **PASS** | `git diff 228c72f2..eac20fa4 -- mesh-close.ts` empty; `DEFAULT_GLB_CLOSED_BASELINE.heelBridgeSelfIntersections` still 0 on HEAD. |
| Register tests in `ci/unit-test-shards.json` | **PASS** | Subject SHA adds `reverse-mortons-watertight.test.ts` shard 4; CI unit-tests 1–6 success on `eac20fa4`. |
| **G-scope** (FILES only) | **PASS** | Diff names only: `apply-elements.ts`, `reverse-mortons-watertight.test.ts`, `ci/unit-test-shards.json`. |
| **G-invent** (no invented clinical mm) | **PASS** | Diff adds `N_TOP_PATCH_MM`, `ELEMENT_SUBDIVIDE_EDGE_MM`; floor still `REMAINING_MATERIAL_MM` (pre-existing). |
| **G-CI** full green on subject | **PASS** | Check runs on `eac20fa4`: `unit-tests (1–6)` success, `test-and-deploy` success, `plantar-name` success, `isolated-postgres-acceptance` success, Vercel success (`default-procedural-smoke` skipped). |
| Production path = saved-design export rebuild | **PASS** | Regression uses `buildSavedDesignSnapshot` → `buildFinalizedFootFromSavedDesign` → manufacturing STL; no checkpoint reuse in test path. |
| Patient name engraved (both feet) | **PASS-WITH-RESIDUAL** | Client store installs "Alex Latino"; export path includes `addPatientName`. Grader did not byte-inspect plantar mesh text. |
| Medium/default byte-identical | **PASS-WITH-RESIDUAL** | No reverse Morton's → `subdivideReverseMortonsInterior` no-ops (code review). No stored STL byte compare. |
| No scope growth / draft only | **PASS** | PR is draft; 3 files, +449/−4. |
| ApexCore material in Latino design | **NOT VERIFIED** | Saved-design regression does not set `hardness` / G-code preset; brief mentions ApexCore for manufacturing context only. Export geometry path does not branch on ApexCore in touched files. |

## Residuals (plain)

1. Latino's exact US shoe size is not in the repository; grading used US M9, which the worker used to reproduce `heelBridgeSelfIntersections=5`.
2. No byte-level STL compare for designs without reverse Morton's.
3. ApexCore / `hardness` not exercised in the regression catalog.
4. Worker noted manufactured border may be shallower than legacy full depth on the rim (elementHeightAt unchanged on border); grader did not re-measure clinical depth.

## Independent test evidence

Run on grader branch:

```bash
npx rstest vertex/src/lib/geometry/grader-pr-470-independent.test.ts
```

Static gates use `git diff` / `git show` against `SUBJECT_SHA`. Export gates spawn a worktree at `eac20fa4` (see `G-ONE`, `G-matrix`).

## Handoff

- **Subject SHA:** `eac20fa4c8a5abcd1b340bf883ea4940fca8bf60`
- **Grader branch:** `cursor/grade-pr-470-reverse-morton-1125`
- **Do not merge** PR #470 based solely on this report without accepting residuals 1–3.
- **Do not merge** this grader PR (audit artifact only).