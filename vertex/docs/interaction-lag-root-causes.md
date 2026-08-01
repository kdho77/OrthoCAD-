# Interaction Lag — Root Cause Analysis

**Status:** Diagnosis (research only; no code changes in this document)  
**Date:** 2026-08-01  
**Scope:** Slider scrubbing, parametric corrections, foot-scan drag/drop, scan load  

Architecture already targets **&lt; 16 ms preview frames** and **no OCCT during drag/slider scrub** ([hybrid-geometry-architecture.md](./hybrid-geometry-architecture.md), R5 in [orthotic-insole-cad-architecture.md](./orthotic-insole-cad-architecture.md)). OCCT is largely kept off the interaction path. Lag comes from **heavy main-thread mesh work that still runs every preview frame** on the Base + Modifier (loaded GLB) path.

---

## Executive verdict

| Symptom | Primary cause |
|---------|---------------|
| Sliders feel delayed / mesh doesn’t keep up | Sync full-mesh `applyBaseModifiers` (+ trim clip + `EdgesGeometry`) on the UI thread every preview tick |
| Dragging a 3D foot scan: can’t see where it’s going | Unthrottled `setManualOffset` every `pointermove`, plus `interacting` forcing base rebuilds at drag start/end |
| Scan load hitches the UI | Sync weld/label/manifold on the main thread after parse |
| Parametric (no base) path | Healthier (worker + reduced preview quality); not the main lag source when a stock/foot base is loaded |

**This is not “the GPU can’t keep up.”** It is CPU work on the main thread that blocks pointer handling and React commits, so the viewport updates late relative to the cursor/slider.

---

## Hot path (stock / foot base loaded)

```
Slider onChange / preview store update
        │
        ▼
useBaseInsoleGeometry effect (per side: left + right)
        │
        ├── applyBaseModifiers(raw, field)     ← base.clone() + ~70k–208k verts
        ├── [optional] heel-cup debug scan + console.log
        ├── [if trimline] clipGeometryToOutline  ← O(triangles) + new buffers + normals
        └── setGeometry(display)
                │
                ▼
BaseInsoleMesh remounts geometry
                │
                └── <edgesGeometry args={[geometry, 35]} />  ← edge extract every swap
```

Parametric (no base) uses `useInsoleGeometry` → worker preview at reduced grid quality while `interacting`. That path matches the hybrid contract much more closely.

---

## Root causes (ranked)

### 1. Full-mesh clone + deform on every slider preview frame (critical)

**Where:** `vertex/src/hooks/useBaseInsoleGeometry.ts` (modifier effect), `vertex/src/lib/geometry/base-modifier.ts` → `applyBaseModifiers`

**What happens:**

- Correction previews update `performance-store` (often rAF-throttled).
- That triggers a React effect that calls `applyBaseModifiers(raw, field, interacting ? 0 : 1)` **synchronously**.
- `applyBaseModifiers` always does `base.clone()` then walks essentially the full vertex set with height-field / classification / edge-profile work.
- Both feet mount `BaseInsoleMesh` → **two full rebuilds** when shared deps (`interacting`, shared design) change.
- Comments already acknowledge ~208k-vertex bases are too expensive for main-thread sealing on load (`sealBottomSlits: false`); the same class of mesh is still deformed live on scrub.

**Why it breaks the slider contract:** Preview is meant to be &lt; 16 ms. A 100k–200k vertex deform + clone routinely exceeds one frame budget, so the UI thread stalls between pointer samples.

**Mitigations already present (insufficient alone):**

- Skip Laplacian smoothing while `interacting` (`smoothingIterations = 0`).
- Preview vs commit split in `SliderField` (design store only on pointer-up).
- `rafThrottle` on most correction previews.

---

### 2. `EdgesGeometry` rebuilt on every geometry swap (critical)

**Where:** `vertex/src/components/viewer/BaseInsoleMesh.tsx`

```tsx
<edgesGeometry args={[geometry, 35]} />
```

R3F/`EdgesGeometry` recomputes edge adjacency whenever `geometry` identity changes. That happens on every successful modifier pass. Edge extraction on large meshes is often comparable to or worse than the deform itself and adds nothing clinically during scrub.

---

### 3. Trimline clip after every modifier pass (high)

**Where:** `useBaseInsoleGeometry.ts` → `clipGeometryToOutline` in `vertex/src/lib/geometry/trimline.ts`

When a draft or committed trimline exists:

1. Centroid-in-polygon over all triangles  
2. Allocate new position buffer  
3. `computeVertexNormals` / bbox / sphere  

Architecture (§4) intends lightweight width-envelope during **trimline drag**, and full clip on confirm. In practice, **any** active trimline causes full clip on **every correction slider tick** as well.

---

### 4. Scan / foot mesh drag: unthrottled store updates + collateral base rebuilds (high)

**Where:** `vertex/src/components/viewer/ScanTransformTool.tsx`

- After a 3px threshold, every `pointermove` calls `setManualOffset(...)` with **no `rafThrottle`**.
- Drag start sets `setInteracting(true, "gizmo")`; end clears it.
- `interacting` is a dependency of the base-geometry effect → full `applyBaseModifiers` on **both** sides at drag start, and again on drag end with `smoothingIterations = 1`.

Moving a scan is transform-only (`manualOffset` → matrix). The mesh itself is cheap to move. Perceived lag is:

1. Store → React re-render churn every move event  
2. Main-thread hitch when base rebuilds fire because of `interacting`  
3. Competing with any concurrent slider/geometry work  

Contrast: element gizmos and trimline edits already use rAF throttling / pending deltas.

---

### 5. Debug work on the heel-cup rebuild path (medium)

**Where:** `useBaseInsoleGeometry.ts` heel-cup block

When heel-cup depth is non-zero, every rebuild scans top vertices for `maxHeelZDelta` and calls `console.log("[HC-DEPTH] rebuild", ...)`. Logging + extra scans on a hot path amplify scrub jank.

---

### 6. Thickness preview not rAF-throttled (medium)

**Where:** `vertex/src/features/corrections/CorrectionsPanel.tsx`

Correction fields use `rafThrottle(previewCorrection)`. Shell thickness calls `setThicknessPreview(v)` directly. That can schedule more than one geometry rebuild per animation frame under rapid input.

---

### 7. Scan import CPU on the UI thread (medium for load, not drag)

**Where:** `vertex/src/features/scans/ScanImport.tsx`

After async file parse, `weldAndLabelComponents`, ranking, extract, and `analyzeManifold` run synchronously. Large STL/OBJ hitch the UI during import (already noted as “heavy” when elapsed &gt; 250 ms). Separate from drag lag, but part of “loading 3D scans feels delayed.”

---

### 8. Chili3D core parametric path (lower priority for OrthoCAD UI)

Property panel commits on blur/Enter → sync `generateShape()` + WASM tessellation + dispose/recreate Three meshes. Snap `pointerMove` calls `visual.update()` every move without rAF throttle. Relevant to Chili3D CAD editing; OrthoCAD Vertex lag above is dominated by the base-modifier path.

---

## What is *not* the main problem

| Suspect | Finding |
|---------|---------|
| OCCT during slider scrub | Avoided while `interacting` on parametric path; R5 largely honored for booleans |
| Undo history every slider tick | Preview writes performance-store only; design commit on pointer-up |
| localStorage persist every tick | Zustand persist on committed design, not every preview |
| GPU fill rate / shadows | Secondary; hitches correlate with CPU geometry rebuilds |
| Scan remesh on drag | Scan move does not remesh; offset/matrix only |

---

## Architecture contract vs implementation gap

| Contract | Implementation gap |
|----------|-------------------|
| Preview &lt; 16 ms / frame | Base path runs full clone+deform (+ clip + edges) on main thread |
| Field-only during slider scrub | Field deform is correct *kind* of work, but cost is unbounded by vertex count |
| Trimline: light preview during drag, full clip on confirm | Full `clipGeometryToOutline` also runs on correction rebuilds whenever a trimline exists |
| Interactive frames on worker | Parametric path uses worker; **base-modifier path does not** |
| Never block UI on large GLB ops | Sealing disabled on load; live deform still on UI thread |

Known related note: `vertex/IMPLEMENTATION_NOTES.md` — Geometry Worker TODO for sealing ~208k-vertex meshes.

---

## Recommended fix order (for follow-up PRs)

1. **Stop rebuilding `EdgesGeometry` while interacting** (hide overlay or cache static silhouette). Fastest win.  
2. **Defer trim clip during slider scrub** — show unclipped deform while interacting; clip on idle/confirm when architecture allows.  
3. **Move or lighten `applyBaseModifiers` for preview** — worker with transferable buffers, or mutate a reusable position attribute in place (no `clone()` per frame); optional decimated preview mesh.  
4. **rAF-throttle scan `setManualOffset`**; do **not** put scan `interacting` on the base-geometry dependency list (or only skip smoothing without rebuilding).  
5. **Remove heel-cup `console.log` / debug scans** from production rebuild path.  
6. **rAF-throttle thickness preview** like other correction fields.  
7. **Scan import:** move weld/label/manifold to a worker.

---

## Key file index

| File | Role |
|------|------|
| `vertex/src/hooks/useBaseInsoleGeometry.ts` | Sync modifier + clip on preview deps |
| `vertex/src/lib/geometry/base-modifier.ts` | `applyBaseModifiers` clone + per-vertex deform |
| `vertex/src/components/viewer/BaseInsoleMesh.tsx` | Mesh + per-swap `EdgesGeometry` |
| `vertex/src/lib/geometry/trimline.ts` | `clipGeometryToOutline` |
| `vertex/src/components/ui/slider-field.tsx` | Preview/commit + `setInteracting` |
| `vertex/src/features/corrections/CorrectionsPanel.tsx` | Slider previews / thickness gap |
| `vertex/src/components/viewer/ScanTransformTool.tsx` | Unthrottled scan drag |
| `vertex/src/hooks/useInsoleGeometry.ts` | Parametric worker path (healthier) |
| `vertex/src/lib/performance/throttle.ts` | Existing `rafThrottle` helper |
| `vertex/src/features/scans/ScanImport.tsx` | Sync post-parse cleanup |
