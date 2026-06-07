# Base + Modifier Architecture

Vertex builds an orthotic two ways that share **one** clinical definition
(corrections · trimline · elements):

- **Parametric mode** — the whole insole is generated from the shared height
  field (`height-field.ts`). There is no external base; the surface *is* the
  corrections.
- **Base mode** — an externally authored surface (a loaded **GLB base**, e.g. a
  scanned/prefab insole) is the starting point, and the same clinical
  corrections / elements / trimline are applied on top of it as **modifiers**.

A *modifier* is anything that changes the base. Modifiers come in two classes,
chosen by what the operation actually needs to do:

| Modifier class            | Engine                          | When it runs            | Examples                                   |
| ------------------------- | ------------------------------- | ----------------------- | ------------------------------------------ |
| **Vertical deformation**  | shared height field (THREE)     | every interactive frame | arch dome, heel cup, posting tilt, met pads, sinks |
| **OCCT boolean**          | OpenCascade kernel (WASM)       | Confirm / Export / idle | clean trimline cut, discrete elements, skive/posting wedges |

```
                ┌──────────────────────────────────────────────┐
                │   Design state (corrections·trimline·elements) │
                └───────────────┬───────────────────┬────────────┘
        base mode?              │                   │
   ┌───────────────────────────▼──┐        ┌────────▼─────────────────────┐
   │  BASE: loaded GLB surface      │        │  PARAMETRIC: no base          │
   └───────────────┬────────────────┘        └────────┬─────────────────────┘
                   │ deformBaseGeometry()              │ buildInsoleGeometry() / OCCT loft
                   ▼                                   ▼
        ┌──────────────────────┐            ┌──────────────────────┐
        │  Vertical deformation │  (shared height field, < 16 ms)   │
        └───────────┬───────────┘            └───────────┬──────────┘
                    │  Confirm / Export                  │
                    ▼                                     ▼
        ┌─────────────────────────────────────────────────────────┐
        │  OCCT boolean modifiers (base-modifier-booleans.ts)        │
        │  trimline cut · elements · skive/posting wedges            │
        │  → falls back to deformation-only when OCCT is unavailable │
        └─────────────────────────────────────────────────────────┘
```

## Modules

| Module                                   | Responsibility                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `src/lib/geometry/height-field.ts`       | The single source of clinical surface shape (`heightAt`). Shared by every path. |
| `src/lib/geometry/base-modifier.ts`      | Mode resolution + **vertical deformation** of a base mesh (the real-time path). |
| `src/lib/geometry/base-modifier-booleans.ts` | **OCCT boolean** modifiers (trimline cut, elements, skives) — Confirm/Export.  |
| `src/lib/geometry/occt-insole.ts`        | Authoritative parametric loft; delegates its boolean passes to the module above. |
| `src/components/viewer/CustomPrefabMesh.tsx` | Renders + live-deforms the base GLB, with base-mode tint/outline.            |

## 1. Deformation quality & clinical realism

`heightAt(u, vSigned, params)` returns the **top** surface height (mm); the
bottom is always the flat `z = 0` plane, so it stays a clean print/contact
surface and thickness `= heightAt(...)`. The field was reworked for clinical
realism while staying pure-math fast (no extra passes in the hot loop):

- **No centerline crease.** Medial/lateral contributions (arch dome, heel cup,
  skive, flange) are blended with `smoothstep` across the centerline instead of
  a hard `medial ? a : 0`, so the longitudinal arch no longer steps at `v = 0`.
- **Heel ↔ arch transition.** The heel cup uses a `smoothstep` rim (not `pow`)
  and a wider longitudinal bell so the rearfoot flows into the midfoot like a
  vacuum-formed shell rather than meeting it at a ridge.
- **Natural thickness / feathered edge.** Additive shaping is feathered toward
  the trimline (`edgeFeather`) so the perimeter thins to a clinical edge, while
  the **posting wedge is exempt** (a planar tilt must stay full-strength at the
  edge) and the base wall is preserved.
- **Soft floor.** Minimum wall thickness is enforced with `softFloor` (a
  blended lower bound) instead of `Math.max`, removing the clamp crease.

For **base mode**, `deformBaseGeometry()` samples this field at every base-mesh
vertex and lifts vertices toward the top in proportion to how high up the wall
they sit (`topness`), so:

- the **flat bottom is preserved** (bottom vertices, `topness = 0`, never move);
- only the *additive* clinical shaping is applied — flat regions of the base are
  left untouched because the base's measured thickness is the field baseline;
- an optional **Laplacian smoothing** pass over the sampled displacement field
  gives a smooth top independent of the base's tessellation. It is **skipped
  while dragging** (`smoothingIterations = 0`) and enabled when idle/exporting
  (`1`–`2`) to keep real-time editing responsive.

Convention: bases are laid out `X = length, Y = width, Z = thickness (up)`,
matching the parametric pipeline and app-exported GLBs.

## 2. OCCT boolean operations (Phase 2)

`base-modifier-booleans.ts` performs topology-changing modifiers with the OCCT
kernel, reserved for Confirm / Export / idle so live editing never blocks:

- **Trimline cutting** — `applyTrimlineCut()` builds a vertical prism from the
  closed trimline and computes `solid − (boundingBox − prism)`, a clean
  perimeter cut that is more robust than a direct intersection. Opt-in via
  `InsoleParams.useBooleanTrimline` (the parametric loft already honours the
  trimline by width sampling, so this is for cases needing an exact cut).
- **Discrete elements** — `applyElements()` fuses additive tools (met pad/bar,
  Cluffy/Morton's extensions) and cuts subtractive ones (sinks, kinetic/reverse
  wedges).
- **Skives / posting wedges** — `applySkives()` cuts heel skive wedges.

Every pass **fails soft**: on any boolean error the previous valid solid is
kept, so the export never regresses below the deformation-only result. When the
OCCT WASM kernel is not loaded, the booleans are simply not run and the
deformation result (which already bakes skives/elements into the height field)
is used as-is.

### Scheduling / performance contract

- Interactive frames only ever run the height-field deformation (preview tier).
- OCCT booleans run inside the authoritative kernel build, which the geometry
  engine schedules on the OCCT worker (or a `requestAnimationFrame` main-thread
  fallback) on Confirm/Export/idle — never on a drag frame.
- `geometryEngine.cancelStaleBuilds()` drops superseded drag builds.

## 3. Visual feedback & mode clarity

- `resolveDesignMode(design)` reports `"base"` (with the base name/id) vs
  `"parametric"`; `hasActiveModifiers(design)` reports whether any
  correction/element/trimline modifier is shaping the design.
- The viewer shows a **mode badge**: a violet `Base: <name> · modifiers applied`
  pill in base mode, or a sky `Parametric mode` pill otherwise.
- `CustomPrefabMesh` renders the base with a **distinct violet tint and a base
  outline overlay**, so it is obvious the user is modifying a loaded base rather
  than a parametric shell, and that modifiers are deforming it live.

## Fallback summary

1. **OCCT available** → deformation preview while editing; authoritative OCCT
   solid with boolean modifiers on Confirm/Export.
2. **OCCT unavailable** → height-field deformation everywhere (skives/elements
   baked into the field); watertight trimline mesh for export.
3. **Degenerate base** (no usable extent) → `deformBaseGeometry` returns the base
   unchanged, so the pipeline never throws.

All pure-parametric flows are unchanged: base mode only engages when a design
references a custom prefab (`design.customPrefabId`).
