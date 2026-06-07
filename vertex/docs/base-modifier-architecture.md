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

### Coordinate convention

Bases are interpreted in **footprint mm space**: `x ∈ [0, length]` heel→toe,
`y` across width centred on 0, `z` up. This matches what the app already exports
via `buildExportGlb`, so a previously-saved insole loads back as a valid base.
`applyBaseModifiers` normalises any base via its bounding box (`x→u`, `y→vSigned`)
and weights the vertical displacement by normalised height so the flat bottom is
preserved and only the top surface lifts. Bases should be authored as **neutral
templates** (no corrections baked in) to avoid double-applying.

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
    buildFromBase(base: BufferGeometry, field: HeightFieldParams): SolidResult;
}
```

Implemented in both `ThreeKernel` (preview tier) and `OcctKernel`
(authoritative tier). Both currently share the deformation implementation; the
OCCT kernel is the seam where boolean refinement lands in later phases.

## Phased rollout

- **Phase 1 (this change):** data model + store actions + migration; the
  deformation modifier; `buildFromBase` on both kernels; `BaseInsoleMesh`
  renders a base with corrections/elements applied live; export applies
  modifiers to the base instead of passing it through raw. *Success criterion:
  loading a base GLB and adjusting corrections visibly deforms it.*
- **Phase 2:** trimline boolean cut of the base (perimeter trim) on Confirm via
  OCCT; element pads/sinks baked as exact OCCT booleans on Export.
- **Phase 3:** sew arbitrary base GLBs into OCCT BRep solids; graded thickness
  and shell offset on the base; posting wedges as first-class boolean tools.
- **Phase 4:** library of curated clinical base templates; per-region blend
  weights so modifiers can be localised (e.g. medial arch only).

## Migration / fallback guarantees

- No base ⇒ identical to the current parametric pipeline.
- Legacy `customPrefabId` designs resolve to a base automatically.
- If a base fails to load or the modifier throws, the pipeline falls back to the
  raw base mesh and then to parametric generation, so exports never hard-fail.
