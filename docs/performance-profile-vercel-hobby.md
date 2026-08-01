# Vertex Orthopedic on Vercel Hobby — Performance Profile

**Target:** `https://ortho-cad-mcp.vercel.app/` (Vercel project `ortho-cad-mcp`)  
**Method:** Chrome headless CDP — Network, Performance timeline, CPU profiler, Memory, long-task observer, in-page WASM ShapeFactory benches  
**Date:** 2026-08-01  
**Region:** CDN edge `cle1` (Cleveland); Serverless `iad1` (US East)

## Verdict

Interactive lag is **browser-side**, not Vercel Hobby. Correction/thickness slider edits block the main thread for **~3.3–4.0 s per input** inside `applyBaseModifiers` / mesh deformation (Three.js `BufferAttribute` getX/getY/getZ). OpenCascade WASM is **not loaded during editing**; when forced, OCCT ops finish in **tens of milliseconds**. Do **not** upgrade Vercel until a server-side bottleneck appears — prioritize workers, debouncing, progressive tessellation, and geometry caching.

---

## 1. Initial JS and WASM download sizes

| Asset | Transfer (br) | Decoded | Cold download |
| --- | ---: | ---: | ---: |
| `index-*.js` (app) | 159 KB | 500 KB | ~15–17 ms |
| `three-*.js` | 195 KB | 738 KB | ~24–38 ms |
| `r3f-*.js` | 95 KB | 293 KB | ~22–24 ms |
| `trpc-*.js` | 66 KB | 243 KB | ~20–24 ms |
| `index-*.css` | 5 KB | 23 KB | ~11–21 ms |
| **Initial JS+CSS total** | **~520 KB** | **~1.8 MB** | **&lt;50 ms parallel** |
| `chili-wasm.js` (lazy) | 32 KB | 116 KB | ~14–16 ms |
| `chili-wasm.wasm` (lazy) | **5.4 MB** | **15.2 MB** | **676–715 ms** |
| `Default.glb` (Supabase) | 1.73 MB | 1.73 MB | **90–126 ms** |

WASM is cached immutable (`max-age=31536000`) but is **deferred until manufacturing export / explicit kernel init** — it does not delay first interactive viewport.

---

## 2. Time until CAD viewport is interactive

| Milestone | Wall time (cold, cache disabled) |
| --- | ---: |
| DOMContentLoaded | ~95 ms |
| Login form painted | ~134 ms |
| Canvas present after Sign-in | ~0.7–1.1 s |
| Stock GLB fetched | ~1.0–1.1 s |
| **Viewport interactive** (canvas ready, loading gone) | **~6.3–7.9 s** |

Breakdown of the ~6–8 s to interactive:

1. Supabase auth token — **535–861 ms**
2. `stock_bases` REST lookup — **270–630 ms**
3. `Default.glb` download — **~110 ms** (not the bottleneck)
4. **Main-thread mesh pipeline** (`sealInternalSlits` + first `applyBaseModifiers` / GPU upload) — multi-second `RunTask`s attributed to app + R3F bundles
5. tRPC `library.listElements,listPrefabs` cold start — **981–1859 ms** (overlaps; does not gate the canvas)

Status bar at interactive: **“Procedural worker kernel”** (Three.js preview path).

---

## 3. Main-thread blocking tasks &gt; 50 ms

### Cold load (Performance trace)

| Rank | Duration | Attribution |
| ---: | ---: | --- |
| 1 | **3964 ms** | FunctionCall in `r3f-*.js` (geometry commit / R3F render path) |
| 2 | **3667 ms** | same |
| 3 | **3594 ms** | same |
| 4 | **3425 ms** | same |
| 5 | **1009 ms** | `RunMicrotasks` (post-login async work) |
| 6–10 | 305–505 ms | R3F / app geometry |

45 long tasks observed on cold load alone.

### Correction slider (Shell thickness — 4 `input` events)

| Metric | Value |
| --- | ---: |
| Wall time | **24.4 s** |
| Long tasks | **69** |
| Long-task sum | **24.3 s** |
| Largest blocks | **3437, 3430, 3377, 3375 ms** (~one per slider event) |
| Secondary blocks | many **160–390 ms** |

### CPU profiler hotspots (self time during slider session)

| Symbol (minified) | Bundle | Self time | Role |
| --- | --- | ---: | --- |
| `Ue` | `index-*.js` | **11.8 s** | Per-vertex height-field / correction sample |
| `(anonymous)` @290 | `index-*.js` | 7.7 s | Modifier loop body |
| `Mi` | `index-*.js` | 5.5 s | `applyBaseModifiers` / `modifiedBaseResult` family (`Mi.O.topEdgeAvProfile`) |
| `Cu` | `index-*.js` | 5.3 s | Vertex walk calling `Ue` + `getX/Y/Z` |
| `Gd` | `three-*.js` | 3.4 s | Triangle/normal work (`getNormal`, `dot`, `fromBufferAttribute`) |
| `getX` / `getY` / `getZ` | `three-*.js` | **~2.4 s** | BufferAttribute accessors |
| `computeVertexNormals` | three | 55 ms+ | Post-deform normals |
| GC | V8 | ~1.0 s | Allocation churn from mesh clones |

`Default.glb` topology exercised: **Top 15,170 tris / 7,809 verts** + **Bottom 70,589 tris / 35,890 verts** = **85,759 tris** (topology preserved under modifiers).

---

## 4. Five slowest OpenCascade operations

Measured in-page on production WASM (`chili-wasm.wasm` already instantiated). These are **not** on the interactive edit path today.

| Rank | Operation | Time | After mesh (deflection 0.1) |
| ---: | --- | ---: | --- |
| 1 | `booleanFuse` (two boxes) | **42.0 ms** | 36 tris, 12 faces, 60 verts |
| 2 | `loft` (40 cross-section stations, solid) | **39.5 ms** | 62 tris, 5 faces, 70 verts |
| 3 | `booleanCut` (box − cylinder) | **23.7 ms** | 76 tris, 7 faces, 90 verts |
| 4 | `simplifyShape` (loft) | **4.6 ms** | 62→62 tris, 5→5 faces (no change) |
| 5 | `box` | **4.4 ms** | 12 tris, 6 faces, 24 verts |

Also timed: `cylinder` 0.9 ms (248 tris / 3 faces), `sphere` 0.2 ms (2022 tris / 1 face), `polygon×40` 1.1 ms.

**WASM init (when first needed):** load+instantiate **~1.2–1.3 s** (download ~0.68 s of 5.4 MB br).

**Export path observed via ⌘/Ctrl+E:** still used **mesh-close** (not OCCT sew) in this session:

- `botRim` 1184 verts, `topRim` 446 verts  
- Result: **V=250,765**, `openEdges=0`, Euler=3, watertight  
- Triangle count grows substantially vs input 85,759 tris because sidewall bridging densifies the solid

---

## 5. Triangle / face counts before & after operations

### Stock base (network model)

| Stage | Tris | Faces / notes | Verts |
| --- | ---: | --- | ---: |
| `Default.glb` Top mesh | 15,170 | 1 mesh | 7,809 |
| `Default.glb` Bottom mesh | 70,589 | 1 mesh | 35,890 |
| **Combined import** | **85,759** | 2 meshes | **43,699** |
| After `applyBaseModifiers` (slider) | **~85,759** (topology preserved) | same | same |
| After mesh-close export | ≫ input (densified shell) | watertight solid | **250,765** |

### OCCT micro-bench (synthetic solids)

| Op | Faces before | Faces after | Tris before | Tris after |
| --- | ---: | ---: | ---: | ---: |
| booleanFuse boxes | (2 boxes × 6) | **12** | — | **36** |
| loft 40 stations | 40 wires | **5** | — | **62** |
| booleanCut box−cyl | 6 + 3 | **7** | — | **76** |
| simplifyShape loft | **5** | **5** | **62** | **62** |
| box | — | **6** | — | **12** |

---

## 6. React components causing unnecessary rerenders

72 React commits sampled during load + slider session (DevTools hook).

**DOM tree (renderer 1)** — full UI commit ~**867 fibers**:

| Type | Count in tree | Notes |
| --- | ---: | --- |
| `div` | 183 | Layout chrome |
| Anonymous | 83 | Minified feature components |
| `path` / `svg` | 82+34 | Lucide icons re-created |
| `button` | 58 | Toolbar + tabs |
| `input` | 58 | **29 range sliders** live under Corrections |
| `label` | 29 | One per slider |
| `TabsTrigger` / `TabsContent` | 8+8 | Right panel |

**R3F tree (renderer 2)** — ~**66 fibers** per commit, re-committed when geometry updates:

`mesh`×7, `group`×6, `meshBasicMaterial`×4, `lineSegments`/`edgesGeometry`/`tubeGeometry`, lights.

**Issue:** each slider `input` triggers Zustand preview → `useInsoleGeometry` effect → full `applyBaseModifiers` → new `BufferGeometry` → R3F mesh props change → both React trees commit. With **no effective debounce under 100 ms pointer moves**, four discrete sets already burned **24 s** of main-thread time.

High-churn culprits to target: Corrections panel range inputs, `useInsoleGeometry`, any parent that selects broad Zustand slices (full `design.corrections` object), and R3F meshes that replace `geometry` instead of mutating attributes in place.

---

## 7. Function / API response times and regions

| Call | Cold | Warm | Region |
| --- | ---: | ---: | --- |
| `POST` Supabase `/auth/v1/token` | 535–861 ms | 122 ms | Cloudflare (`CMH`) |
| `GET` Supabase `stock_bases` | 270–630 ms | 10–15 ms | Cloudflare |
| `GET` Supabase `Default.glb` | 90–126 ms | cached | Cloudflare |
| `GET` `/trpc/library.listElements,listPrefabs` | **981–1859 ms** | ~208–470 ms* | `cle1`→`iad1` |
| `GET` `/trpc/user.health` | — | **54–162 ms** | `iad1` |
| `GET` `/trpc/export.authorize` | — | observed on export | `iad1` |

\*Warm library call without auth cookies returned 401 in one probe; authenticated warm path is still hundreds of ms, not multi-second.

Static assets: `x-vercel-cache: HIT`, edge `cle1`, sub-40 ms.

---

## 8. Is Vercel Hobby affecting performance?

| Hobby concern | Observed? | Impact on CAD lag |
| --- | --- | --- |
| Serverless cold start | **Yes** — first `/trpc` ~1–1.9 s to `iad1` | Minor — overlaps boot; not on slider path |
| Bandwidth / CDN | Static + WASM served fine; WASM 5.4 MB br when needed | Only on first export kernel init |
| Execution time / concurrency | Health warm ~55–160 ms | **No** evidence of throttling on interactive path |
| Edge vs function region | CDN `cle1`, functions `iad1` | Extra ~tens of ms; not multi-second UI stalls |

**Conclusion:** Hobby cold starts add ~1–2 s to **first API** after idle. They do **not** explain 3–4 s slider freezes. **Do not upgrade Vercel** based on this profile.

Memory at steady edit: **~183 MB** used JS heap / **~305 MB** total (headless).

---

## Bottleneck ranking (interactive UX)

1. **Three.js / main-thread `applyBaseModifiers`** on ~86k-tris stock base — **dominant**
2. **React + R3F rerenders** amplifying each geometry rebuild — secondary
3. **Network GLB/JS** — small after first paint; WASM deferred
4. **OpenCascade/WASM** — fast when loaded; unused while editing
5. **Vercel Functions / DB** — cold start only; not the edit-path cost

---

## Recommended browser-side fixes (priority order)

1. **Debounce / coalesce slider `input`** (100–150 ms) and only run full-quality builds on `change` / pointer-up; keep `usePerformanceStore.interacting` forcing `quality: "preview"` with a **decimated** base (e.g. 10–20% tris) while dragging.
2. **Move `applyBaseModifiers` fully into `geometry.worker`** for the stock-base path (parametric insole already has a worker; base-modifier still burns main thread — CPU profile proves it).
3. **Mutate `position` attributes in place** + `needsUpdate` instead of `geometry.clone()` per rebuild to cut GC and R3F identity churn.
4. **Replace `getX/getY/getZ` loops** with raw `Float32Array` index math in hot modifier kernels.
5. **Geometry result cache** keyed by `(assetId, corrections hash, thickness, smoothing)` — skip rebuild when hash unchanged.
6. **Progressive tessellation / LOD**: preview mesh for viewport, full mesh on idle (1–2 s after last input) and for export.
7. **Scan decimation** before registration/deviation (existing pick-decimate thresholds) — keep clinical scans off the main-thread modifier path.
8. **Prefetch WASM** during idle after first interactive frame (hides 1.2 s export penalty) — optional; not required for edit UX.

---

## Artifacts

Profiling raw JSON and screenshots: `/opt/cursor/artifacts/profile/`

- `pass1-summary.json` — network + cold long tasks  
- `pass2-summary.json` — CPU tops + React commits  
- `pass5-report.json` — OCCT timings + slider long tasks  
- `occt-mesh-stats.json` — face/tri counts per OCCT op  
- `mesh-and-export.json` — export mesh-close log  
- `cold-load-viewport.png`, `viewport-pass2.png`, `export-panel.png`
