# Load and export performance audit (2026-11-12)

Read-only analysis of **kdho77/OrthoCAD-** at `main` (≥ `0afa26c4`). Local timings used the bundled **SAMPLE_Top** fixture (`vertex/public/Templates/SAMPLE_Top.glb`, 277 032 bytes) and the default procedural export path (Men’s US 9 template 260×95 mm, plus a **275 mm foot** scaling case ≈ 272.4×99.5 mm insole). **No production VertexSlice calls** were made.

**Harness:** `node scripts/perf/run-load-export-benchmark.mjs` (median of 3 runs after warmup; Node 22.23 on Linux). Full JSON: `scripts/perf/load-and-export-benchmark.last.json` when `BENCHMARK_JSON=1`.

## Windows-parity check (Base / Design vs Print)

`shouldLoftProceduralViewer` in `vertex/src/lib/geometry/procedural-wall/preview-loft-ui.ts` returns **false** for `scan`, `setup`, `base`, `corrections`, `elements`, and `design`, and **true** only on `print` and `export` when `wallModel === "procedural"`. The viewer hook `useBaseInsoleGeometry.ts` branches on the same flag: earlier steps show a **composed top sheet + faired bottom pattern** (`composeViewerPrintSolidTop`, pattern worker); **full wall loft** runs only on Print/Export (with optional background worker via `preview-loft-worker.ts`). This matches the rule that walls/solid are built at Print, not on Base/Design.

## Measured artifact sizes

| Artifact | Value |
| -------- | -----: |
| SAMPLE_Top.glb | 277 KB (no Draco/meshopt in file) |
| Manufacturing STL (M9, Round, Full Contact) | 5 515 484 bytes, 110 308 triangles |
| 275 mm foot scale factor | 1.048× → length 272.4 mm |

## Ranked speedups (impact × effort)

Impact uses measured local **ms** where available; server slice/upload times are **not measured** (would need staging). **Geometry-touching** means a change could alter STL/3MF/goldens unless guarded by existing hash tests (`vertex/tests/occt-dormant.test.ts`, etc.).

| Rank | Stage | Measured ms (local) | Root cause | Proposed fix | Expected saving | Geometry-touching? | Suggested model |
| ---: | ----- | ------------------: | ---------- | ------------ | ----------------: | :----------------: | --------------- |
| 1 | **Procedural wall loft** (`reconstructProceduralWalls`) | **17 281** (M9), **25 721** (275 mm foot) | Single-threaded CPU mesh: zonal shell, station pairing, logging-heavy `main` path | Run loft in dedicated **Web Worker** by default on Print entry; keep geometry-buffer protocol in `preview-loft-worker.ts` | **~15–25 s** per cold export foot | **Yes** (numerics) | Opus / Sonnet high |
| 2 | **Export without preview cache** (`buildExportStl` cold) | **18 255** | Re-lofts on every G-code click even when Print preview already built the same fingerprint | **Always publish** preview solid to `manufacturing-solid-cache` before Export; ensure L/R fingerprints stay isolated (tests already cover) | **~17 s** when user visited Print first (loft → **1 ms** warm) | No | Composer |
| 3 | **Watertight validation** | **1 111** | `assertClosedSolidAcceptable` on full solid every export | Skip or lighten validation when `fromManufacturingCache` and fingerprint unchanged; keep full validate on cache miss | **~1 s** per export | **Yes** (safety gate) | Sonnet high |
| 4 | **Faired bottom pattern** (Design load) | **4 403** (`buildProceduralViewerPattern` sync) | Rim inset / synthetic pattern on main thread; worker path not used in benchmark sync API | Route all pattern builds through `buildProceduralViewerPatternInWorker` (already used in hook) and debounce regeneration | **~3–4 s** on pattern regen | No | Composer |
| 5 | **`buildExportStl` warm** (loft cached) | **1 076** | Still runs `closeGlbInsoleToSolid` + validate + STL for procedural solids that are already closed | Short-circuit mesh-close for `userData.wallModel === "procedural"` when validation already passed at preview publish | **~0.5–1 s** | **Yes** | Sonnet high |
| 6 | **Mesh-close** | **492** | Legacy bridge path; procedural loft already produces closed solid | Same as #5: bypass redundant close for procedural | **~0.5 s** | **Yes** | Sonnet |
| 7 | **275 mm+ exports** | +**49%** loft time vs M9 | More stations/triangles after `footprintScale` | Pre-scale cached native top once per layout; parallel L/R lofts in workers | **~8 s** at large sizes | **Yes** | Opus |
| 8 | **STL upload to object storage** | 5.5 MB PUT (not timed) | Uncompressed binary STL; `uploadManufacturingStlDirect` sets only `Content-Type` | **gzip** at edge (client `Content-Encoding` if storage supports) or zstd server-side; optional mesh quantization in transport only | Network **~50–70%** (varies) | No (bytes on wire only) | Composer |
| 9 | **VertexSlice server path** | N/A (prod) | `generateSolid` downloads STL + optional 3MF, then `sliceWithVertexSlice` synchronously (`manufacturing-session.ts`, 300 s function budget) | Async job + polling; **cache slice by STL hash + profile**; co-locate slicer with storage | Dominant wall-clock in prod | No | Opus |
| 10 | **Regional hardness 3MF** | Not isolated | `buildVertexSliceModel` + `exportHardness3mf` before upload when regions active | Build 3MF in worker; upload STL + 3MF in parallel | Seconds when many regions | **Yes** (modifier prisms) | Sonnet |
| 11 | **Paired L/R export** | 2× cold loft if uncached | `buildPrinterFootManufacturingStl` is per-foot; caches are per-side | Background loft **both** feet on Print; `Promise.all` upload | **~17 s** on dual export | No | Composer |
| 12 | **SAMPLE_Top HTTP cache** | fetch uncached on first load | `vercel.json` only sets immutable cache for `/assets/*`; `/Templates/SAMPLE_Top.glb` falls through SPA rewrite | Add `headers` rule for `/Templates/*` → `max-age=31536000, immutable` | Repeat visit **RTT + 277 KB** | No | Composer |
| 13 | **GLB decode / merge** | **51** total pipeline | Already cheap; GLTFLoader, weld, footprint reorient | IndexedDB optional for custom library (stock already in bundle) | **&lt;100 ms** | No | Composer |
| 14 | **Draco/meshopt GLB** | — | Not used today | **Do not** compress SAMPLE_Top without golden verification — float weld order may shift | Small load win | **Yes** (risk) | — |

## Path notes (where time goes)

### Initial editor load

1. **Fetch** `Templates/SAMPLE_Top.glb` (~277 KB). No Draco/meshopt.
2. **Parse** (`loadGlbFromBuffer` / `GLTFLoader`): ~1 ms locally.
3. **Merge + weld + reorient** (`extractMergedGeometry`, `reorientToFootprintFrame`): ~50 ms.
4. **In-memory cache** (`primeSampleTopGeometry` / `loadSampleTopGeometry` clone): ~1 ms warm.
5. **Design steps:** composed top + modifiers (`composeViewerPrintSolidTop`, `applyBaseModifiers`) and **faired pattern** (~4.4 s sync API; hook prefers worker). **No wall loft.**
6. **Stock resolution:** `loadBaseGeometry` can return `null` while waiting for server placeholder resolution when API is configured (`stockBaseNeedsServerResolution`) — perceived stall, not CPU.
7. **IndexedDB:** custom prefabs/offline library (`custom-library-service.ts`); bundled SAMPLE_Top is not persisted there.

### Solid + VertexSlice export (client portion)

1. **`buildProceduralExportSolid`** → `reconstructProceduralPreview` / `reconstructProceduralWalls`: **~17 s** (M9).
2. **Text engraving** (if enabled): dynamic import + `applyTextMarkingToPrintSolid` (not in default benchmark).
3. **`closeGlbInsoleToSolid`**: ~0.5 s (procedural may not need full bridge close).
4. **`assertClosedSolidAcceptable`**: ~1.1 s.
5. **`geometryToBinarySTL`**: ~0.5 s for ~110k triangles.
6. **Regional hardness:** optional `buildVertexSliceModel` → 3MF replaces STL in `selectVertexSliceUpload` when env gate on.
7. **Upload:** `prepareManufacturingStlUpload` + raw **PUT** (`export-service.ts`).
8. **Server:** download STL from temp key, optional regional 3MF, **VertexSlice** slice, return G-code (`manufacturing.generateSolid`). **Not benchmarked** (no prod calls).

### Duplicate work L vs R

Separate `manufacturingSolidFingerprint` per side; cache collision tests exist in `manufacturing-solid-cache.test.ts`. Right foot uses mirrored SAMPLE_Top — expect **second full loft** unless both sides are pre-warmed on Print.

## Recommendations that must preserve output

Treat as **output-sensitive** (require golden/hash re-run before merge):

- Any change inside `reconstructProceduralWalls`, mesh-close bypass, validation shortcuts, Draco/meshopt assets, or hardness prism math.

Treat as **transport / orchestration only** (STL bytes unchanged):

- HTTP cache headers, gzip upload, parallel uploads, async VertexSlice jobs, worker **offload of existing functions** without algorithm edits.

## Environment reference

- **Vercel:** `vertex/vercel.json` — `maxDuration: 300` on tRPC; SPA rewrite excludes `Templates/` but does not add long-cache headers for templates.
- **Tests / goldens:** `vertex/tests/occt-dormant.test.ts` (SAMPLE_Top STL SHA256), `manufacturing-solid-cache.test.ts` (warm export &lt;500 ms).

---

*Generated by perf audit branch; re-run benchmark after hardware or Node changes.*
