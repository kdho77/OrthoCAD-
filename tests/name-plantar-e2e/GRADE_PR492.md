# Independent grade: PR #492 (`51c9a2bd`)

Graded commit: `51c9a2bdb207e2d891c6e45d09034735a3b6cabc`  
Worker PR: https://github.com/kdho77/OrthoCAD-/pull/492 (draft, do not merge)  
Base: `main` @ merge-base `91e0062a`  
Grader branch: `cursor/grade-pr-492-plantar-name-frame-1125`

Evidence is from this grader’s tests and file inspection, not worker claims.

## Verdict: **PASS-WITH-RESIDUALS**

Brief criteria met by code and local tests. **Residual:** at grade time (`2026-11-26T05:51Z`), GitHub CI on `51c9a2bd` had `plantar-name` and `unit-tests (3)` still **in progress**; shards 1, 2, 4, 5, 6 and `isolated-postgres` were **success**. Reconcile C6 when those runs finish.

## Criterion table

| ID | Criterion (brief) | Verdict | Evidence |
| --- | --- | --- | --- |
| C1 | Left and right printed soles read forward (L→R, not mirrored) when viewed from below the plantar face (+Z at Z=0) on belt-print and flat-bed | **PASS** | `belt-print-frame.test.ts`: J-hook lower-left + advance >20 mm, left and right, toe-first, heel-first, flat bed. `plantar-glyph-chirality.test.ts`: GNRF on both feet, belt + flat bed + heel-first; `a,d > 0.5`, asymmetric N/F/R checks. |
| C2 | Fix matches live production belt chain (Rz 270°, BeltTransform det −1, no pre-rotation Y negate) | **PASS** | `place.ts`: `const ySign = -1` for all bottom text (belt and flat). `belt-print-frame.ts`: `printedPlantarView` aligned with `physicalReadingView`; `beltPrintFrameDet()` −1. Grader G-placement repro: main-style `ySign +1` gives `d < −0.5` from below; `−Y` gives `d > 0.5`. |
| C3 | Explain / lock why plantar-name CI missed the live bug | **PASS** | Main workflow copied `stl_preprocess.py` from `9fe93642` (Y-negate before Rz270), cancelling upside-down placement. PR workflow removes `FIX_SHA` / `COPY validation/stl_preprocess.py`, slices `LIVE_IMAGE` only. README documents the trap. |
| C4 | Harden CI: asymmetric glyph chirality (G, N, R, F) from below on both feet | **PASS** | `plantar-glyph-chirality.test.ts` (synthetic `GNRF`). Registered in `ci/unit-test-shards.json` shard 5. |
| C5 | Register new tests in `ci/unit-test-shards.json` | **PASS** | Shard list includes `plantar-glyph-chirality.test.ts`. |
| C6 | Full CI green on worker head | **PENDING** | Actions run [45762770566](https://github.com/kdho77/OrthoCAD-/actions/runs/45762770566): shards 1,2,4,5,6 success; shard 3 in progress at grade stamp; `plantar-name` [45762770588](https://github.com/kdho77/OrthoCAD-/actions/runs/45762770588) in progress (~15+ min job). |
| C7 | No other geometry changes (outline, arch, heel cup, thickness, width, seams, layer-change) | **PASS** | `git diff --name-only` merge-base..`51c9a2bd` is exactly nine brief paths (grader G-scope). `place.ts` delta is comment + unified `ySign = -1`; no cx/cy/scale/outline edits. Centroid XY unchanged belt vs flat bed (`plantar-glyph-chirality.test.ts`). |
| C8 | No X-mirror string reversal (#436 trap) | **PASS** | No `xSign` in `placeBottomText`. `plantar-glyph-chirality.test.ts` asserts unflipped `+Y` belt fails; belt test asserts pre-rotation Y negate fails hook. |
| C9 | No secrets / PHI in committed files | **PASS** | Tests use `JABBOUR` and `GNRF` only (grader G-hygiene). |

## Independent tests run locally

```bash
npx rstest vertex/src/lib/geometry/text-marking/pr492-plantar-name.grader.test.ts
npx rstest vertex/src/lib/geometry/text-marking/belt-print-frame.test.ts
npx rstest vertex/src/lib/geometry/text-marking/plantar-glyph-chirality.test.ts
```

## Residuals

None for brief scope. Operational note: grader VM has no Docker; end-to-end G-code slice was not re-run here — reliance on CI `plantar-name` job on live VertexSlice image per C3.