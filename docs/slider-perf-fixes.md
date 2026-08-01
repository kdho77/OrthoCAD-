# Slider performance fixes — before/after measurements

Branch: `cursor/slider-perf-worker-3931`  
Target path: stock-base `applyBaseModifiers` + Corrections sliders (not OCCT / not hosting).

## Hot loops identified

| Location | Cost |
| --- | --- |
| `vertex/src/lib/geometry/base-modifier.ts` → `applyBaseModifiers` | Full-mesh deform; previously `base.clone()` + `computeVertexNormals()` (Three `getX/Y/Z`) |
| `vertex/src/hooks/useBaseInsoleGeometry.ts` | Sync apply on every preview tick; `setGeometry(newMesh)` remounts R3F |
| `vertex/src/components/viewer/BaseInsoleMesh.tsx` | New `geometry` identity + `edgesGeometry` rebuild per tick |
| `vertex/src/components/ui/slider-field.tsx` | Controlled value waited on parent; no local immediate UI buffer |

## Changes

1. **Float32 stride-3** — bounds + optional normals via `compute-normals.ts`; deform loops already used `array[i*3+axis]`
2. **Immutable source** — every apply does `out.set(sourcePositions)` before deform; `options.target` mutates display mesh in place
3. **Slider scheduling** — `SliderScheduler`: UI immediate; preview ≤1/75 ms; full on pointer-up / 200 ms idle
4. **Worker** — `base-modifier.worker.ts` + `base-modifier-engine.ts` (request IDs, stale discard, transferables, fallback)
5. **LOD** — `buildInteractiveLodGeometry` targets 10–20k tris while dragging; full ~86k on release
6. **Stable R3F mesh** — same geometry/material keys; `position.needsUpdate`; edges only when idle/full
7. **Instrumentation** — `window.__MODIFIER_PERF__` / `modifierPerf.snapshot()`

## Measurements (unit microbench)

`npx rstest vertex/src/lib/geometry/base-modifier-bench.test.ts`

| Metric | Before (profile) | After (bench) |
| --- | ---: | ---: |
| Main-thread long task per slider input (full ~86k) | **3.3–4.0 s** | Off main thread via worker; copy-back ≪ 50 ms |
| LOD preview apply p50 (`skipNormals`, sync fallback) | n/a | **~50–70 ms** on CI VM (assert &lt; 75 ms throttle) |
| Preview triangle count while dragging | ~85,759 | **10k–20k** |
| Full editing mesh after release | ~85,759 | **unchanged topology** |
| Mesh remounts per slider tick | 1+ (new geometry) | **0** (stable identity) |
| Cumulative deformation | risk if mutating last result | **None** (reset from source each apply) |

Production Chrome profile (pre-change) is documented in `docs/performance-profile-vercel-hobby.md`.

## How to verify in the browser

1. Open Corrections, drag Shell thickness / arch sliders.
2. UI numbers should move immediately; mesh updates in ≤100 ms on LOD.
3. Console: `window.__MODIFIER_PERF__.snapshot()` after ~50 drags — check `staleDiscarded`, `meshMountCount` (should stay ~1–2 per side), `lastHeapMB` bounded.
4. Export STL — still mesh-close/OCCT path; watertight behavior unchanged (no OCCT edits in this PR).
