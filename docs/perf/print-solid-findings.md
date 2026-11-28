# Print tab solid: why it waits, and what would make it faster

Opening the Print tab builds a walled solid for the left foot, then the right foot, one after the other. On this machine that is **about 12 seconds** for a default Men's 9 insole, and **about 13.5 seconds** with a met pad, a Morton's extension, and a 6 mm heel lift. The shape work is already off the UI thread in a web worker. The wait is the math, run twice in a row.

The mesh that comes out is already watertight. A second Print → Export does not build it again (the in-memory cache returns in about 1 ms). Leaving Print for a design step throws that cache away, so the next Print pays the full 12 seconds even when nothing changed.

Nothing below changes the product. The numbers in the ranked table are from the first measurement on this machine (`scripts/perf/print-solid-benchmark.test.ts`, Node 22, 4 vCPU, 28 Nov 2026). A phone is slower: the splash already says the walls can take up to a minute there.

## What landed

Options 1, 2, and 3 are in. Station spacing was not changed (`OUTLINE_STATION_SPACING_MM` is still 1.5 mm). That was the option that would have moved triangles.

The solid matches the one main built, vertex for vertex. `print-solid-golden-parity.test.ts` hashes the position buffer, then the index buffer, for both feet. The four cases are a default Men's 9 with round walls, the same size with a met pad, a Morton's extension, and a 6 mm heel lift, straight walls, and hybrid walls. All eight hashes match the solids recorded from main before these speedups, and each solid is watertight (Euler characteristic 2). The exporter cuts G-code from that solid, so the toolpath does not change. The golden test is the proof; it does not write a G-code file.

The before column is a fresh run of main's loft on this same machine, taken before the speedups. It is the same kind of result as the table further down, not the same sample.

The Print tab now starts the left foot and the right foot together, on two workers. This benchmark still lofts the feet one after the other on the main thread, so the "both feet together" column is the slower foot, not a second stopwatch. A unit test checks that two worker jobs are in flight at the same time. The feet do not share writable geometry. This machine has 4 CPUs, and the two lofts can contend for memory, so a real wait can sit a little above the slower foot. It is no longer the sum.

| | Before | After, one foot | After, both feet together |
| --- | ---: | ---: | ---: |
| Default loft | 12.07 s (5.91 + 6.16) | 5.64 s left, 6.16 s right | **6.16 s** |
| Met pad + Morton's + 6 mm heel lift | 13.37 s (6.41 + 6.96) | 6.32 s left, 7.05 s right | **7.05 s** |
| Straight walls, left only | 5.37 s | **3.97 s** | — |
| Print again, nothing edited | the full pair (leaving Print threw the solid away) | | **1 ms** |

Opening Print again with the same design is the cache hit that export already had. Leaving Print used to clear that slot. It no longer does. Size, width, an element, a correction, hardness, trim, and text each still miss, and those misses have tests.

On one default left loft, the CPU sample shows the plantar-cap checks at 1.11 s before and 0.56 s after, and the round-spline sampling at 0.59 s before and 0.47 s after. Garbage collection on that same sample rose from 0.69 s to 1.08 s, so the round-wall foot only finished a few hundred milliseconds sooner. Straight walls spend more of the loft in the cap, which is why that foot dropped by 1.4 s. A separate test checks the faster outline-distance query against a plain segment scan on a 420-point loop: the distances match exactly, and the band decisions match. No sample point was moved to buy that.

## Ranked options

Savings are for the **first open of Print with both feet showing**, unless the row says otherwise. "Same output" means the solid's triangles stay as they are today.

| Rank | Change | Time saved | Risk | Effort |
| --- | --- | --- | --- | --- |
| 1 | Loft left and right at the same time (two workers) | **~6 s** (12.1 s → ~6.3 s) | Same output (safe) | Medium |
| 2 | Keep the in-memory solid when the design hash did not change | **~12 s** on the next Print if nothing was edited. **0 s** the first time | Same output (safe) if the hash already covers every input | Small |
| 3 | Speed the plantar cap checks without moving triangles | **~1.3 s** on the pair | Same output (safe) only while the accepted triangles stay put | Medium |
| 4 | Tighten the round-wall spline loops without moving sample points | **~0.8 s** on the pair | Same output (safe) only while the points stay put | Medium |
| 5 | Fewer wall stations (1.5 mm spacing → about 3 mm) | **On the order of 4 s** on the pair. Not measured | Changes geometry (needs CAD review) | Small in code, the review is the work |

Switching the default grind from round walls to straight walls was measured and is a poor trade: **0.45 s** on the left foot, and the wall changes (76 rows → 37, 55k vertices → 38k).

## What the clock actually does

Default design: Men's 9, medium width, 2 mm reference with the zonal shell (rear 3 / mid 2.5 / fore 2), full-contact pattern, round walls, no elements, no patient name. Both feet are visible, so both solids are built.

| | Left | Right | Both, one after the other |
| --- | ---: | ---: | ---: |
| Default loft | 5.83 s | 6.28 s | **12.1 s** |
| Met pad + Morton's extension + 6 mm heel lift | 6.50 s | 7.04 s | **13.5 s** |
| Straight walls (left only) | 5.38 s | — | — |

Default left solid: 55,156 vertices, 110,308 triangles, 452 stations, 76 rows. It is watertight (Euler characteristic 2). The right foot is a separate loft of the mirrored sheet, not a mirror of the finished left solid. Medium width does not take the "loft the left and reflect it" path.

The elements case adds about **0.7 s per foot**. Morton's extension adds two stations (452 → 454). Heel lift is a height change inside the same loft, not a second solid and not a boolean.

Export, after the solid exists:

| Step | Time | On the Print tab? |
| --- | ---: | --- |
| Top-sheet compose, no elements | 42 ms | Yes, again on the UI thread after the worker, for pad placement. Small. |
| Top-sheet compose, with the pads | 232 ms | Same, a bit longer. |
| Close + watertight check | 0.30 s + 0.29 s | No. The loft is already closed. Export runs this. |
| Cold export loft (one foot) | 5.48 s | Only if Print did not already build it. |
| Warm export, same design | **1 ms** | Print → Export already hits the cache. |

### One left foot, from the CPU profile

Sampled time 5.95 s. Inclusive times nest, so they are not added.

| Stage | Inclusive | What it is |
| --- | ---: | --- |
| Whole preview (`reconstructProceduralPreview`) | 5.20 s | Compose, extract, then walls |
| Extract the top rim | 0.59 s | `extractTopOnlyModel` |
| Build the walls (`reconstructProceduralWalls`) | 4.58 s | Pattern, stations, cap, columns |
| Of which the quad grid | 2.64 s | `buildQuadGrid` |
| — round columns | 1.53 s | `buildBezierColumns` |
| — of which the round spline | 1.13 s | `applySplineWalls` |
| — plantar cap (CDT) | 1.09 s | `buildGeneratedPlantar` |
| Pattern clearance | 0.63 s | `adjustPatternForClearance` (inside the wall build) |
| Chord-crossing repair | 0.37 s | `limitPairingSkew` |
| Garbage collection | 0.63 s | Spread through the loft |

The top sheet itself is not the wait. Compose is 42 ms. The 452 stations, the cap triangulation, and the round spline are the wait.

Hot leaves inside those stages: distance-to-outline scans (`minDistToLoop` 319 ms, boundary aspect 273 ms, boundary angle 260 ms), full chord-crossing rebuilds (315 ms), and spline sampling (`curveSTFromPolyline` 193 ms, arc lengths 192 ms).

## Why it feels stuck

1. **Both feet, one worker.** This is what the first measurement saw. The queue now runs two jobs, and the worker file keeps a pool of two. Print shows both feet (`showLeft` and `showRight` start true), and on Print the mirror foot is not deferred. Wall clock is the slower foot.

2. **The cache used to be thrown away on purpose.** Leaving Print for a design step still bumps `printLoftEpoch` so the viewer re-enters, and it still cancels a loft that is in flight. It no longer clears the manufacturing solid, and the epoch is no longer part of the cache key. An unchanged design hits. Print → Export already did, which is why the warm export is 1 ms. Hardness is in the key on its own, because the placement key ignores it.

3. **The worker is already there.** The loft does not block the UI thread, except for the extra compose after the worker returns (42 ms, or 232 ms with pads). Tests fall back to the same function on the main thread when `Worker` is missing. A progress splash already exists. The bar is elapsed time against a 60 s budget per foot, not these stages.

4. **Preview and export do not both loft** when the fingerprints match. `buildProceduralExportSolid` waits for an in-flight loft and then clones the cached mesh. Production that never opened Print still lofts once per foot. That rebuild-from-the-design rule stays; this is an in-memory cache, not a stored STL.

5. **No mesh boolean on this path.** Pads and Morton's extension are a height-field lift (`apply-elements.ts`). Heel lift is a Z delta in `base-modifier.ts`. `manifold-3d` is used when a name is engraved, not for the default solid. There is nothing to "boolean once" on a blank insole.

6. **Round vs straight is not the lever.** Straight walls skip `applySplineWalls` and cut the row count in half, but the shared station and cap work remains, so the left foot only dropped from 5.83 s to 5.38 s.

## The five options, in more detail

### 1. Two workers — same output (safe)

**Saved:** about 6.1 s on the default pair (the shorter foot). The tab would wait for the slower foot, about 6.3 s, instead of 12.1 s. With pads and heel lift, about 7.0 s instead of 13.5 s.

**Risk:** none for the shape. Each foot already runs `reconstructProceduralPreview` on its own mesh. They do not share writable geometry. Two workers do the same calls side by side.

**Effort:** medium. The queue and the worker are built for one job. A pool of two, still cancellable, with the same paint yield so the splash can update.

**Files:** `vertex/src/lib/geometry/procedural-wall/preview-loft-queue.ts`, `vertex/src/lib/geometry/procedural-wall/preview-loft-worker.ts`, `vertex/src/workers/procedural-wall.worker.ts`, `vertex/src/hooks/useBaseInsoleGeometry.ts`.

### 2. Remember the solid for an unchanged design — same output (safe)

**Saved:** the whole pair, about 12 s, every time someone opens Print again without an edit. The first open is unchanged. Print → Export is already this fast (1 ms).

**Risk:** the solid matches today when the fingerprint matches. `printLoftEpoch` is in that fingerprint specifically so a step change misses. Dropping the epoch, and not clearing the slot on a step change, is safe only if every geometry input is already in `manufacturingSolidIdentity`. Corrections, elements, shell, trim, pattern, shoe width, and text are in there. A missing input would show a stale solid, so the hash should be checked before this lands. The current test expects a rebuild on Print → Corrections → Print even with no edit; that test is the policy, not a shape difference.

**Effort:** small.

**Files:** `vertex/src/stores/preview-loft-status-store.ts`, `vertex/src/stores/clinical-workflow-store.ts`, `vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.ts`, `vertex/src/lib/geometry/procedural-wall/preview-loft-ui.ts` (the viewer key also includes the epoch).

### 3. Faster plantar cap, same triangles — same output (safe)

**Saved:** about 1.3 s on the pair. The cap is 1.09 s per foot. Most of that is walking every face against a 452-point outline (`minDistToLoop` 319 ms, `maxBoundaryAspect` 273 ms, `maxBoundaryMinAngleDeg` 260 ms) inside up to 10 CDT passes (`cdtDiskOf` in `plantar-cdt.ts`). A distance index, and not rebuilding that scan from scratch on every trial, can cut a large part of that 852 ms. This estimate takes about three quarters of it, times two feet, not the whole cap.

**Risk:** same triangles only if the accepted disk is the one we accept today. Fewer passes, or a different Steiner spacing, moves the cap. That needs CAD review. Do not change `PLANTAR_STEINER_MM` or the pass limit as a speed trick.

**Effort:** medium.

**Files:** `vertex/src/lib/geometry/procedural-wall/plantar-cdt.ts`, `vertex/src/lib/geometry/procedural-wall/cdt-lib.ts`.

### 4. Faster round spline, same points — same output (safe)

**Saved:** about 0.8 s on the pair. `applySplineWalls` is 1.13 s per foot. The measurable leaves are `curveSTFromPolyline` (193 ms), arc lengths (192 ms), and `densifyPolyline` (108 ms). That is the part that can shrink without moving a sample. The rest of the 1.13 s is the spline itself.

**Risk:** same wall only if every sample point stays put. Replacing round with straight was measured at 0.45 s saved on the left foot and a different mesh. That is a geometry change.

**Effort:** medium.

**Files:** `vertex/src/lib/geometry/procedural-wall/wall-spline.ts`, `vertex/src/lib/geometry/procedural-wall/bezier-column.ts` (`buildBezierColumns`, `applySplineWalls`).

### 5. Wider station spacing — changes geometry (needs CAD review)

**Saved:** not measured. Stations are 452 at `OUTLINE_STATION_SPACING_MM` = 1.5. The cap, the pairing, and the spline all walk that ring. Halving the count is the only change that touches all three, so a drop on the order of 30–40% per foot (about 2 s, about 4 s for the pair) is the honest scale. It will not be 2×, because some work is the top sheet and the checks.

**Risk:** the station set is the approved wall. `preview-loft-queue.ts` already says widening that spacing needs CAD sign-off. Morton's extension has to stay medial and 3 mm; a coarser ring can move it.

**Effort:** the constant is one line. The sign-off and the golden meshes are the work.

**Files:** `vertex/src/lib/geometry/procedural-wall/bezier-column.ts` (`OUTLINE_STATION_SPACING_MM`), `vertex/src/lib/geometry/procedural-wall/densify-stations.ts`, the station golden tests.

## Looked at, and not worth doing for this wait

- **Another web worker, as if there were none.** The loft already runs in `procedural-wall.worker.ts`. The missing piece is a second worker, which is option 1.
- **A progress bar.** `PrintLoftSplash` already shows left walls, right walls, and a bar. The bar is time passed, not these stages. Real stage labels would not shorten the solid.
- **Skipping the second compose.** The UI composes the top again after the worker so element placement has a reference. That is 42 ms, under 1% of the pair.
- **manifold-3d for the wall.** The solid is a station loft, not a boolean. A manifold extrude would be a different shape. Engraving a name is the boolean, and a default design with no name does not run it.
- **Caching an STL on disk.** Production rebuilds from the saved design. The allowed cache is the in-memory one already in `manufacturing-solid-cache.ts`.

## How to re-measure

From the repo root, after `npm ci` in the root and in `vertex/`:

```bash
npx rstest --testTimeout 900000 scripts/perf/print-solid-benchmark.test.ts
```

The test prints `ORTHOCAD_PRINT_SOLID_BENCHMARK` and writes `/tmp/print-solid-benchmark.last.json`. It loads `vertex/public/Templates/SAMPLE_Top.glb`, lofts with `printSolidOptions` and `reconstructProceduralPreview` (the worker's function), and profiles one default left loft with the V8 sampler. Close and watertight times are the export pass, outside that profile.

Baseline on this tree: 24 tests passed in those six files (`print-solid-compose`, `print-solid-parity`, `export-solid`, `print-export-cache-parity`, `manufacturing-solid-cache`, `export-parity`). Rstest reported 30.3 s for the run. They confirm the current solid still closes and the warm export still matches a cold one. They are not the timings above.
