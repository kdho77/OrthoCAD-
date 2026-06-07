# Base + Modifier Geometry Architecture

This extends the hybrid pipeline (see `hybrid-geometry-architecture.md`) from
"generate everything from scratch" to a **Template / Base + Modifier** model
used by real orthotic labs: start from a good base shape, then layer
modifications on top.

## Concept

```
  ┌──────────────┐        ┌──────────────────────────────────────────────┐
  │   BASE        │        │            MODIFIERS (design state)           │
  │  (optional)   │        │  trimline · corrections · posting · skives ·  │
  │  stock / user │   +    │  elements · thickness                         │
  │  GLB template │        │                                               │
  └──────┬───────┘        └───────────────────┬──────────────────────────┘
         │                                     │
         │   no base ⇒ pure parametric         │  applied as deformation
         │   (full generation, unchanged)      │  and/or boolean ops
         ▼                                     ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │                       Resolved insole geometry                       │
   │   preview (fast deform)  ·  authoritative (OCCT booleans on Confirm) │
   └────────────────────────────────────────────────────────────────────┘
```

Two workflows are supported by the **same** design state:

1. **Start from base** — `design.base` references a library GLB (stock template
   or a previously saved custom insole). Modifiers deform / cut / add onto it.
2. **Full parametric** — `design.base` is absent. The existing procedural +
   OCCT generation path runs exactly as before (the fallback / default).

The modifiers (corrections, trimline, elements, thickness, method) are the
*same fields* that already drive parametric generation. There is no second set
of parameters — only a different way of *applying* them when a base is present.

## Data model

```ts
// types/index.ts
export interface DesignBase {
    /** Library / custom asset id that provides the base mesh. */
    assetId: string;
    name?: string;
    /** Where to resolve the GLB from. */
    source: "custom" | "stock";
}

export interface DesignState {
    // ...existing fields (corrections, trimlines, elements, thickness, method)
    /** Optional base template. Absent ⇒ full parametric generation. */
    base?: DesignBase;
}
```

The existing `customPrefabId` / `customPrefabName` fields are kept for backward
compatibility. `getDesignBase(design)` resolves the effective base:

```ts
design.base ?? (design.customPrefabId
    ? { assetId: design.customPrefabId, name: design.customPrefabName, source: "custom" }
    : null)
```

So **existing saved designs migrate transparently**: a design that used a custom
prefab now behaves as a base template with modifiers, while designs with no
prefab stay parametric.

## How modifiers are applied

The shared height field (`height-field.ts`) defines, for every footprint point,
the surface height contributed by each correction/element. The Base + Modifier
model reuses it as a **displacement field** rather than an absolute surface:

```
delta(u, v) = heightAt(u, v, withCorrections) − heightAt(u, v, neutral)
```

`neutral` zeroes all corrections and elements, so `delta` is purely the *change*
the modifiers introduce (arch dome, heel cup, posting tilt, skive cut, element
pads/sinks). Adding `delta` to the base preserves the base's intrinsic shape.

### Clinical surface quality (Phase 2)

The shared height field was reworked for clinical realism (`height-field.ts`),
so both parametric generation *and* base deformation inherit a smoother surface:

- medial/lateral contributions are blended across the centerline with
  `smoothstep` (no crease at `v = 0`);
- a `smoothstep` heel-cup rim flows forward into a wider arch bell;
- additive shaping is feathered toward the trimline for a natural thinning edge,
  while the planar posting tilt stays full-strength at the edge;
- a `softFloor` smooth-max enforces the minimum wall without a clamp crease.

`applyBaseModifiers(base, field, smoothingIterations)` additionally supports an
optional **Laplacian relaxation** of the sampled displacement field over the
mesh topology, giving a clinically smooth top independent of the base's
tessellation. `0` (interactive drags) keeps editing responsive; `1` when idle
and `2` on export.

### Deformation vs. boolean — the rule

| Modifier                                   | Application      | Why                                                      |
| ------------------------------------------ | ---------------- | -------------------------------------------------------- |
| Arch height / fill, heel cup, posting tilt | **Deformation**  | Smooth, continuous surface change; preserves base detail; fast enough for live preview. |
| Thickness                                  | Deformation      | Uniform/graded offset of the surface.                    |
| Trimline                                   | **Boolean cut**  | Changes the footprint outline — a topology change.       |
| Elements (pads = add, sinks = cut)         | Deformation (preview) → **Boolean** (authoritative) | Pads/sinks read as smooth bumps live; baked as exact OCCT fuse/cut on Confirm/Export. |
| Skives                                     | Boolean cut      | Sharp wedge removal near the heel.                       |

**Recommendation:** use vertex **deformation** for everything that is a smooth
surface change (it is cheap, keeps the mesh watertight, and never fails), and
reserve **boolean** operations for topology-changing features (trim, discrete
add/subtract), running them only on Confirm/Export through the OCCT kernel.

### OCCT boolean modifiers (`base-modifier-booleans.ts`)

The topology-changing booleans are implemented in `base-modifier-booleans.ts`
and run inside the authoritative OCCT loft (`buildOcctInsoleSolid`), reserved
for Confirm / Export / idle:

- **Trimline cutting** — `applyTrimlineCut` builds a vertical prism from the
  closed trimline and computes `solid − (boundingBox − prism)` for a clean
  perimeter cut. Opt-in via `InsoleParams.useBooleanTrimline` (the loft already
  honours the trimline by width sampling, so this is for exact cuts).
- **Discrete elements** — `applyElements` fuses additive tools (met pad/bar,
  Cluffy/Morton's) and cuts subtractive ones (sinks, kinetic/reverse wedges).
- **Skives / posting wedges** — `applySkives` cuts heel skive wedges.

Every pass **fails soft**: on any boolean error the previous valid solid is
kept, so the result never regresses below the deformation-only output, and the
whole pass is skipped when the OCCT WASM kernel is not loaded. Wiring these
booleans into the *base* path (`buildFromBase`) — so a loaded base GLB is sewn
into a BRep solid and trimmed/cut exactly — is the remaining Phase 3 seam.

### Top-modification on a stable bottom

A real clinical base (e.g. a Rhino STL) has a distinct contoured **top surface**
and a defined **bottom surface**, and the user expects edits to reshape the top
and sides while the bottom stays faithful to the original. `applyBaseModifiers`
enforces this:

1. **Orientation-robust axes.** The length / width / thickness axes are detected
   from the base's extents (thickness = smallest extent = up; length = largest;
   width = the remainder) rather than assuming `x = length`. This handles bases
   authored in any orientation — e.g. the sample Rhino insole whose length runs
   along **Y** (X≈90 mm, Y≈266 mm, Z≈25 mm).
2. **Top / bottom classification** (`classifyBaseTopFactors`). Every vertex gets
   a 0..1 *top factor* from its **vertex normal** along the up axis (so the
   contoured top — whose height varies a lot — is recognised regardless of `z`)
   plus a thin **bottom-band guard** that anchors the genuine bottom face.
   Normal orientation is auto-detected (inverted-normal STLs are flipped). The
   result is cached per base mesh (the base is stable across edits).
   - top sheet → factor 1 (free to move), bottom sheet → 0 (held fixed),
     side walls (near-horizontal normals) → blended so they stretch cleanly.
3. **Weighted displacement.** The modifier delta is applied along the up axis
   scaled by the top factor, so corrections / posting / skives / flanges reshape
   the top and walls while the **original bottom contour is preserved**.
4. **Directional thickness.** The neutral baseline is evaluated at a fixed
   reference thickness (`BASE_REFERENCE_THICKNESS_MM`), so the thickness slider
   produces a real upward delta on the top (weighted by the top factor) instead
   of cancelling out — thickness **expands upward from the fixed bottom** rather
   than squashing the whole mesh.
5. **Medial-side orientation** (`detectArchSideSign`). The medial arch must land
   on the anatomically medial side regardless of how the base was modelled. The
   arch side is inferred *from the geometry* — in the midfoot band the medial
   side carries the taller top surface — and the footprint width coordinate is
   adjusted (`widthSign = −(archSideSign · medialSign)`) so the dome/posting/
   skive always land medial. The mesh vertices are **not** mirrored (the bottom
   is never moved); only the sampling coordinate is flipped. Symmetric bases and
   negligible asymmetry no-op. Cached per base mesh.

**Fallback (requirement 7):** if no recognisable bottom surface is found (e.g.
an open shell, `< 1%` downward-facing area), classification returns `null` and
the deformation falls back to a plain normalised-height weight — never worse
than the previous behaviour, never throws.

### Automated validation metrics

`validateBaseResult(base, modified, topFactors?)` compares the deformed result
against the original base (read-only — it does not change the deformation) and
returns:

- `maxBottomDeltaMm` — max |Δ| along the up axis over **bottom-sheet** vertices
  (top factor `< 0.1`). Good GLB output keeps this `< BASE_BOTTOM_DELTA_TOLERANCE_MM`
  (0.05 mm).
- `avgTopLiftMm` — mean Δ over **top-sheet** vertices (top factor `> 0.9`).
- `manifold` / `isWatertight` / `normalsConsistent` — basic topology checks
  (two-manifold ⇒ consistent winding/normals).
- `bottomStable`, `ok` — pass flags.

`modifiedBaseResult(base, field, smoothing, validate=true)` runs it after a
deformation and warns if the bottom moved beyond tolerance. The unit test
(`base-modifier.test.ts`) builds synthetic insole bases (including a Y-length
base like the sample STL, and symmetric/asymmetric arches) and asserts these
metrics.

Bases should still be authored as **neutral templates** (no corrections baked
in) to avoid double-applying. Trimline *cutting* of a base (true perimeter
removal) remains a Confirm/Export boolean (the Phase 3 seam); interactive
trimline/correction edits are bottom-safe deformations.

## Preview vs. authoritative

- **Preview (interactive):** `applyBaseModifiers(baseGeometry, field)` — a pure
  buffer-space vertical displacement. O(vertices), runs on demand, no topology
  change, never blocks. Drives the live viewport (`BaseInsoleMesh`).
- **Authoritative (Confirm / Export):** `IGeometryKernel.buildFromBase(base,
  field)` returns a validated `SolidResult`. Phase 1 reuses the deformation and
  reports manifold/topology stats; later phases sew the base into an OCCT solid
  and apply trimline/element/skive booleans for an exact watertight result.

## Kernel interface change

```ts
export interface IGeometryKernel {
    // ...existing
    /** Apply design modifiers (corrections/elements) onto a base mesh. */
    buildFromBase(base: BufferGeometry, field: HeightFieldParams, smoothingIterations?: number): SolidResult;
}
```

Implemented in both `ThreeKernel` (preview tier) and `OcctKernel`
(authoritative tier). Both currently share the deformation implementation; the
OCCT kernel is the seam where boolean refinement of the base lands in later
phases. `smoothingIterations` lets callers trade smoothness for speed
(interactive `0` vs export `2`).

## Visual feedback & mode clarity

`resolveDesignMode(design)` (via `getDesignBase`) reports `"base"` (with the
base name/id) vs `"parametric"`, and `hasActiveModifiers(design)` reports
whether any correction / element / trimline modifier is shaping the design. The
viewer uses these to make the mode obvious:

- a **mode badge** — violet `Base: <name> · modifiers applied` in base mode, or
  a sky `Parametric mode` pill otherwise;
- `BaseInsoleMesh` renders the base with a **distinct violet tint and a base
  outline overlay**, so it is clear the user is modifying a loaded base and that
  modifiers are deforming it live.

## Phased rollout

- **Phase 1 (done):** data model + store actions + migration; the deformation
  modifier; `buildFromBase` on both kernels; `BaseInsoleMesh` renders a base
  with corrections/elements applied live; export applies modifiers to the base
  instead of passing it through raw. *Success criterion: loading a base GLB and
  adjusting corrections visibly deforms it.*
- **Phase 2 (done):** clinical surface-quality pass on the shared height field +
  optional Laplacian smoothing of the displacement; **top-modification on a
  stable bottom** (orientation-robust axes, normal-based top/bottom
  classification, directional thickness, height-weight fallback); OCCT boolean
  modifiers (`base-modifier-booleans.ts`: trimline cut, element fuse/cut, skive
  wedges) in the authoritative loft with soft fallback; visual base-vs-parametric
  mode clarity (badge + base outline).
- **Phase 3:** sew arbitrary base GLBs into OCCT BRep solids and apply the
  trimline/element/skive booleans directly to the *base* path (`buildFromBase`);
  graded thickness and shell offset on the base; posting wedges as first-class
  boolean tools.
- **Phase 4:** library of curated clinical base templates; per-region blend
  weights so modifiers can be localised (e.g. medial arch only).

## Migration / fallback guarantees

- No base ⇒ identical to the current parametric pipeline.
- Legacy `customPrefabId` designs resolve to a base automatically.
- If a base fails to load or the modifier throws, the pipeline falls back to the
  raw base mesh and then to parametric generation, so exports never hard-fail.
