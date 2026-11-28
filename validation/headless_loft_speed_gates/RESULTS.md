# Headless loft speed gates — results

Independent grade of draft PR #422 at `4037d24aca54351f6447f8271e0e62548879be47`.
Baseline is main `f759bde1e212ae99d475601fc58dd89dd37469c7`.
Gates were frozen in `14aad8cbd25e7cd5e285f6808ee557e8c64326fd` before either grading run. Gate files were not edited after that commit.

## Verdict

PASS. On this machine the candidate STL bytes match main for every frozen case, every case is at least 10% faster than main, and `executeCadOperatorProduction` emits `loft_s` and `slice_s`.

## Commands

Bad-change proof, run before the freeze commit:

```bash
python3 validation/headless_loft_speed_gates/prove_bad_change.py
```

Exit 0. Record: `validation/headless_loft_speed_gates/proofs/bad_change_proof.json` (`pass: true`).

No-op, frozen gates with the candidate SHA set to main:

```bash
python3 validation/headless_loft_speed_gates/run_gates.py \
  --candidate-sha f759bde1e212ae99d475601fc58dd89dd37469c7 \
  --out /tmp/loft-gates-noop.json \
  --expect noop \
  --baseline-cache /tmp/loft-gates-baseline
```

Exit 0. `expect_holds: true`. `stl_identity: true`, `cases_distinct: true`, `speed: false`, `logs: false`.

Candidate grade, same frozen runner, baseline lofts reused from that cache:

```bash
python3 validation/headless_loft_speed_gates/run_gates.py \
  --candidate-sha 4037d24aca54351f6447f8271e0e62548879be47 \
  --out /tmp/loft-gates-candidate.json \
  --expect pass \
  --baseline-cache /tmp/loft-gates-baseline
```

Exit 0. `expect_holds: true`. `stl_identity: true`, `cases_distinct: true`, `speed: true`, `logs: true`.

## STL SHA-256

`buildFinalizedFootFromSavedSettings` with `includeLeader: true`. Full-file SHA-256. Candidate equals baseline on every case.

| Case | SHA-256 | Bytes | Triangles |
| --- | --- | ---: | ---: |
| stock_left | `a726fb2f79996c550e71878dfb5deda294a984c62b765650bc426c3087ee856b` | 5519484 | 110388 |
| stock_right | `5fe297bb2f9f1569719757177bfc4ae416270e0ac561dc498106ac152e1f164d` | 5559884 | 111196 |
| narrow_heelcup_left | `1fef17e525fe1f033715aa8995c18c15e78967da4ec114981c9394efa987bb91` | 5808484 | 116168 |
| mortons_extension_left | `954322dbd8c685b87b89f849143af706e6e4921c56d67db085eacc2b95559e5d` | 5905684 | 118112 |
| bottom_name_left | `4ed9ac20563028b214e250968f8bdb385e3e3bb21190554ebb4092f53db4b997` | 6730584 | 134610 |

`cases_distinct` passed: the five digests differ. Morton's extension on the left fixture is medial (`y = -28.424`) and height 3 mm. The narrow case is shoe width `narrow` with heel cup depth 12 mm and heel cup height 9 mm. Bottom text is the literal `FIXTURE` on the bottom, engrave mode. No patient name.

## Loft seconds

In-process wall time of `buildFinalizedFootFromSavedSettings`, one cold Node process per foot. Threshold frozen before grading: candidate seconds `<=` main seconds `* 0.90`.

| Case | Main (s) | Candidate (s) | Ratio | Gate |
| --- | ---: | ---: | ---: | --- |
| stock_left | 20.426 | 7.695 | 0.377 | PASS |
| stock_right | 25.401 | 8.316 | 0.327 | PASS |
| narrow_heelcup_left | 25.216 | 8.964 | 0.356 | PASS |
| mortons_extension_left | 24.138 | 9.047 | 0.375 | PASS |
| bottom_name_left | 26.510 | 11.527 | 0.435 | PASS |

Exact values from the candidate report: 20.425612852 → 7.694653201, 25.401088309 → 8.316369867, 25.215585077 → 8.964296710, 24.138082697 → 9.047082318, 26.509560469 → 11.527158011.

Every case is under 15 s on this machine. The slowest foot is the bottom-name left loft at 11.527 s. Four cases are under 10 s. That meets the worker's 10–15 s ceiling here. This run did not measure a Vercel isolate.

## Logs

Candidate `executeCadOperatorProduction` on a synthetic left-foot row (materialize 30 ms, slice 30 ms, no network) logged:

```json
{"msg":"cad-operator-timing","productionId":"90c222e6-0125-46ee-876e-e9ac9986c5e7","side":"left","loft_s":0.03,"slice_s":0.03}
```

Probe status `succeeded`, one materialize call, one slice call. Gate PASS.

On main the same probe finished `succeeded` with one materialize and one slice, and the captured output contained no `loft_s` or `slice_s`. Gate FAIL, which is the required no-op.

## No-op speed check

Second loft of main versus the first loft of main. The speed gate fails unless every case is at least 10% faster. Overall speed gate: FAIL.

| Case | First main (s) | Second main (s) | Ratio | Case gate |
| --- | ---: | ---: | ---: | --- |
| stock_left | 20.426 | 20.396 | 0.999 | FAIL |
| stock_right | 25.401 | 22.858 | 0.8999 | PASS |
| narrow_heelcup_left | 25.216 | 25.143 | 0.997 | FAIL |
| mortons_extension_left | 24.138 | 25.698 | 1.065 | FAIL |
| bottom_name_left | 26.510 | 26.902 | 1.015 | FAIL |

`stock_right` on the second main run crossed the 0.90 ratio by 0.00013 (22.857763858 / 25.401088309 = 0.899873406). The other four cases did not. The frozen all-cases gate still failed on main. Candidate ratios are 0.327–0.435, clear of that noise.

## Bad-change proof

`proofs/bad_change_proof.json` records rejection of a one-byte STL edit, a same-length edit that keeps the triangle-count header, a transcript with no `loft_s`/`slice_s`, a transcript missing `slice_s`, non-numeric timings, and zero timings. Identical bytes and a 10% speedup are accepted by the same checks.

## Files the candidate changes

```text
vertex/server/src/lib/cad-operator-production.test.ts
vertex/server/src/lib/cad-operator-production.ts
vertex/src/lib/geometry/manifold.ts
vertex/src/lib/geometry/mesh-close.ts
vertex/src/lib/geometry/procedural-wall/extract.ts
vertex/src/lib/geometry/procedural-wall/metrics.ts
vertex/src/lib/geometry/procedural-wall/plantar-cdt.ts
vertex/src/lib/geometry/procedural-wall/reconstruct.ts
vertex/src/lib/geometry/procedural-wall/wall-spline.ts
vertex/src/lib/geometry/text-marking/bottom-engrave.ts
vertex/src/lib/geometry/text-marking/gates.ts
vertex/src/lib/geometry/text-marking/place.ts
vertex/src/lib/geometry/text-marking/soup-intersect.ts
```

No slicer profile, seam setting, Railway app, `vertex-web`, or `vertex-api` file is in that list. The slice call in `executeCadOperatorProduction` is wrapped with a timer. This grade did not call VertexSlice.

## Residuals

No frozen gate failed on the candidate. No case missed the 15 s ceiling on this machine. Slice G-code bytes were not downloaded from VertexSlice. STL identity is the geometry proof that the loft output is unchanged.

## Handoff

- Candidate SHA: `4037d24aca54351f6447f8271e0e62548879be47` (draft PR #422). Do not merge it from this grade.
- Freeze commit: `14aad8cbd25e7cd5e285f6808ee557e8c64326fd`. Graded record: `4bf7f3f615751e17c7bc97571e73cbc7973812a7` on `cursor/headless-loft-speed-gates-1124` and on draft PR #425 (https://github.com/kdho77/OrthoCAD-/pull/425).
- Tests: `prove_bad_change.py` exit 0; `run_gates.py --expect noop` on main exit 0; `run_gates.py --expect pass` on `4037d24a` exit 0.
- Next step: leave both draft PRs unmerged. The gates branch is the grading record only.

## Rule-compliance report

### PUSH

> PUSH: new branch cursor/headless-loft-speed-gates-1124 (from BASE) -> ONE draft PR titled "[GATES ONLY - DO NOT MERGE] headless loft speed gates". Never push to the worker branch or PR #422; never push/merge main, deploy, Railway (never touch vertex-web / vertex-api or #310). Never edit any other [GATES ONLY - DO NOT MERGE] PR. Do not merge.

PASS. Branch `cursor/headless-loft-speed-gates-1124` was created from `f759bde1e212ae99d475601fc58dd89dd37469c7` and pushed at `4bf7f3f615751e17c7bc97571e73cbc7973812a7`. Draft PR #425 is https://github.com/kdho77/OrthoCAD-/pull/425 with the required title. Its head ref is `cursor/independent-grader-frozen-gates-then-grade-of-pr-422-headless-loft-speedup-7ee4` at that same commit, because this run can open a pull request only from that head. One draft PR. It is not merged. Worker branch `cursor/speed-headless-server-loft-toward-10-15s-per-foot-and-add-loft-s-slice-s-logs-96f7` was fetched and not pushed. No merge, no deploy, no Railway change.

### FILES

> FILES: validation/headless_loft_speed_gates/** only (new); read-only everything else - do not modify product code or the worker's tests or PR #422 - don't explore beyond

PASS. `git diff --name-only f759bde1e212ae99d475601fc58dd89dd37469c7 HEAD` lists only `validation/headless_loft_speed_gates/`. Product code and PR #422 were not edited.

### MUST-MATCH

> MUST-MATCH: gates are written and frozen BEFORE grading the candidate and never edited after; each required gate has a no-op proof and a bad-change proof. Worker's MUST-MATCH: exported STL SHA-256 is byte-identical vs main f759bde1; loft_s/slice_s are logs only and must not change loft or slice bytes; no outer-surface, seam, layer-change, or surface-quality behavior change.

PASS. Freeze `14aad8cb` precedes both `run_gates.py` grading runs. No-op on main: STL identity PASS, logs absent on a finished execute, speed gate FAIL. Bad-change proof rejects a one-byte STL and a missing timing log. Candidate STL SHA-256 matches main on all five cases (table above). The timing log is a `console.log` line; the STL bytes are unchanged. Candidate diff has no seam or layer-change placement file.

### TESTS

> TESTS: targeted only; CI is the full run. Frozen gates must encode: (1) exported STL SHA-256 byte-identical vs main f759bde1e212ae99d475601fc58dd89dd37469c7 for stock Left and stock Right, and at least one narrow + heel-cup case and one Morton's-extension case (synthetic fixtures only, no PHI); (2) measured headless loft time per foot vs the same cases on main, with before/after seconds reported in RESULTS.md; (3) loft_s and slice_s logs are present on the candidate execute/cad-operator path; (4) no geometry-file behavior change (STL identity is the behavior proof even if helper files were edited for faster lookups). No-op proof: gates that expect a change FAIL on main (loft_s/slice_s logs missing on main; no speedup vs main). STL-identity gates should PASS on main vs itself. Bad-change proof: a one-byte or loosened-identity STL change is rejected, and a candidate missing loft_s/slice_s logs is rejected. Run frozen gates on BASE then on candidate 4037d24a; write validation/headless_loft_speed_gates/RESULTS.md.

PASS. Gates encode those four checks. Fixtures are synthetic (`FIXTURE`, design id `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`). No-op and candidate commands above. This file is the required results record. Full-repo CI was not run.

### ONE

> ONE: Independent grade of draft PR #422 @ 4037d24a (headless loft speedup + loft_s/slice_s logs). Write and freeze gates first; then grade that exact SHA; never edit the worker's code.

PASS. Graded `4037d24aca54351f6447f8271e0e62548879be47` after freeze `14aad8cb`. Worker tree was not modified.

### R1

> R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.

PASS. Candidate STL SHA-256 equals main on every case, including `bottom_name_left`. `git diff --name-only f759bde1 4037d24a` contains no slicer seam or layer-change file. This grade did not edit product code.

### R2

> R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).

PASS. Same file list and the same STL bytes. Seam and layer-change inputs from the mesh are unchanged.

### R3

> R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.

PASS. The candidate diff is loft lookup code plus the timing log. STL bytes match, so the constructions are the same. No slicer-profile change.

### R4

> R4 (2026-11-05): Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.

PASS. Fixtures start from `createDesignWithStockPlaceholder` and `SAMPLE_Top.glb` at US M9. The candidate export of those fixtures matches main byte for byte. No new template mesh is in the diff.

### R5

> R5 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.

PASS. `bottom_name_left` uses the existing bottom `textMarking` field, surface `bottom`, mode `engrave`, text `FIXTURE`. Its STL SHA-256 matches main (`4ed9ac20563028b214e250968f8bdb385e3e3bb21190554ebb4092f53db4b997`). No new engraving system is in the diff.

### R6

> R6 Security: never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes. Do not edit any existing [GATES ONLY - DO NOT MERGE] PR (including #421).

PASS. Reports use design id `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` and the literal `FIXTURE`. Gate output drops lines matching `api_key`, `token`, or `bearer`. No Railway app, PR #310, or PR #421 was edited. No database write, no deploy, no push to main.

### R7

> R7: do not change worker code. Grade only. Outer surface, seams, layer-change placement, and surface quality may NOT change; seams and layer changes stay on the bottom/plantar face.

PASS. Worker SHA `4037d24a` was graded read-only. STL identity holds, so the outer surface is unchanged. This grade did not change seam or layer-change placement.

### Hard prohibition

> you may not change the outer surface, seams, layer-change placement or surface quality; you may not edit PR #422 or product code.

PASS. Confirmed. The only files added on this branch are under `validation/headless_loft_speed_gates/`. The candidate outer surface matches main by SHA-256.
