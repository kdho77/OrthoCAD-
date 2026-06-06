# Hybrid Geometry Architecture

Vertex generates orthotic insole geometry through **two complementary pipelines**
that share a single parametric definition (corrections + trimline + elements).
The goal is to keep interactive editing instant while still producing a
clinically usable, watertight solid for manufacturing.

```
                       ┌──────────────────────────────────────────┐
                       │      Design state (single source)         │
                       │  corrections · trimline · elements · units │
                       └───────────────┬──────────────┬────────────┘
                                       │              │
                  shared height field  │              │  shared height field
                  (height-field.ts)    │              │  (height-field.ts)
                                       ▼              ▼
                ┌───────────────────────────┐  ┌───────────────────────────────┐
                │  PREVIEW  (procedural)     │  │  AUTHORITATIVE  (OCCT / WASM)  │
                │  ThreeKernel               │  │  OcctKernel                    │
                │  buildInsoleGeometry()     │  │  buildOcctInsoleSolid()        │
                │  heightmap grid + walls    │  │  lofted clinical sections      │
                │  runs in geometry.worker   │  │  runs in occt.worker           │
                │  target: < 16 ms / frame   │  │  target: watertight BRep solid │
                └───────────────────────────┘  └───────────────────────────────┘
                                       │              │
                                       ▼              ▼
                        live R3F viewport        Confirm · STL · GLB · G-code
```

## Why two paths

The procedural heightmap mesher is fast enough to rebuild on every drag frame,
but it produces an open/loosely-manifold preview shell that is *not* a
guaranteed watertight solid. The OpenCascade (OCCT) WASM kernel produces a true
BRep solid (watertight, manifold, exact side walls and variable thickness) but
is too heavy to run on every interaction.

The hybrid rule:

- **While interacting** (dragging trimline points, scrubbing correction
  sliders): always use the procedural preview at reduced quality. Never block
  the main thread on OCCT.
- **When idle / on Confirm / on Export**: build the authoritative geometry. Use
  the OCCT solid when the WASM kernel is loaded; otherwise fall back to the
  procedural watertight trimline mesh.

## Kernel abstraction (`src/lib/chili3d/kernel.ts`)

Both engines implement `IGeometryKernel`. The interface now carries an explicit
`tier` so callers can reason about *what kind of geometry they will get* without
sniffing the kernel name:

| Member                 | Procedural (`ThreeKernel`)        | OCCT (`OcctKernel`)                       |
| ---------------------- | --------------------------------- | ----------------------------------------- |
| `tier`                 | `"preview"`                       | `"authoritative"`                         |
| `buildInsole()`        | heightmap grid mesh               | tessellation of the OCCT solid            |
| `buildInsoleSolid()`   | mesh + manifold report            | watertight BRep solid + topology validation |
| `exportSTL()`          | mesh → STL                        | OCCT → STL (falls back to mesh)           |

`getKernel()` returns whichever engine is active. `loadOcctKernel()` swaps the
procedural kernel for the OCCT kernel once the WASM module is ready and notifies
the kernel store so React views re-validate.

## The shared height field — corrections in one place

`src/lib/geometry/height-field.ts` is the canonical definition of the insole
surface: `heightAt(u, vSigned, params)` returns the top-surface height (mm) at a
normalized footprint coordinate, incorporating every correction (arch height,
arch fill, heel cup height/depth, fore/rearfoot posting, medial/lateral skive,
flanges) and any placed elements.

Because **both** pipelines evaluate the same `heightAt`, a correction edit
changes the preview and the OCCT solid identically — there is exactly one place
to add a new correction.

## OCCT insole generator (`src/lib/geometry/occt-insole.ts`)

`buildOcctInsoleSolid(factory, params)` produces the authoritative solid:

1. **Top boundary = the trimline.** Each longitudinal station's medial/lateral
   extent is driven by the (optionally user-edited) trimline via
   `resolveOutlineHalfWidth`, so the solid's footprint matches what the user
   drew.
2. **Clinical cross-sections.** At each station the section profile samples the
   shared height field *across the width* (medial → lateral) at several points,
   so the lofted top surface follows the real arch dome / heel cup / posting
   contour instead of a flat ruled line. The profile closes along a flat bottom,
   giving variable thickness (top height − bottom plane).
3. **Loft → solid.** Stations are lofted into a single solid (ruled, capped).
4. **Boolean corrections.** Heel skive wedges and additive/subtractive elements
   are applied as OCCT booleans on top of the lofted base.
5. **Shelling.** `printing_shell` hollows the solid to a wall thickness.
6. **Repair.** `repairOcctSolid` unifies faces and sews open shells so the
   result passes `isClosed()` (watertight) before tessellation/export.

This keeps the first-pass solid *correct* (watertight, manifold, clinically
contoured) even if the surfacing is not yet perfectly smooth.

## Export / Confirm wiring (`src/lib/geometry/export-geometry.ts`)

`buildExportSolid(side)` chooses the best available geometry:

1. Custom-prefab GLB asset, if the design references one (unchanged).
2. **OCCT authoritative solid** when the WASM kernel is active and it produces a
   closed solid — this is the high-quality manufacturing path.
3. Procedural watertight trimline mesh (`buildTrimlineInsoleMesh`) as the
   always-available fallback.
4. Last-resort procedural kernel build.

STL export prefers the kernel's native exporter (OCCT → STL). GLB export wraps
the chosen solid with metadata and serialises with `GLTFExporter`.

## Performance contract

- Interactive frames only ever touch the procedural worker at `"preview"`
  quality; `geometryEngine.cancelStaleBuilds()` drops superseded drag builds.
- OCCT runs in `occt.worker.ts` (off the main thread) when available, with a
  `requestAnimationFrame`-scheduled main-thread fallback.
- Validation (`useSolidValidation`) is debounced and only asks the kernel for a
  solid when idle.

## Roadmap — driving the solid from every correction

The foundation here lets each correction/element flow into the OCCT solid:

- Corrections already flow through `heightAt`, so they shape the lofted top.
- Skives and elements are applied as explicit booleans (extend
  `applyElements` / `applySkives` with new tools as features are added).
- Next phases: replace the ruled loft with a B-spline skinned surface for
  smoother tops, build the trimline as an exact OCCT wire (instead of
  per-station width sampling), and add posting wedges / forefoot extensions as
  first-class boolean tools.
