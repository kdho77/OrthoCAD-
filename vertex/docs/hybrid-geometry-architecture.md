# Hybrid geometry architecture (procedural)

Vertex uses a **single procedural Three.js kernel** for interactive preview and
manufacturing export. There is no separate B-rep WASM path in the shipping app.

## Tiers

| Tier | Engine | When | Output |
| --- | --- | --- | --- |
| **Preview** | `ThreeKernel` (`geometry-kernel.ts`) | Drag, slider scrub, gizmo moves | Fast deformed mesh in workers |
| **Export** | Same kernel + `mesh-close` / procedural-wall | Idle debounce, Confirm, Export | Watertight STL via rim-close and perimeter sealing |

## Kernel abstraction (`src/lib/geometry/geometry-kernel.ts`)

`getKernel()` returns the active `IGeometryKernel`. Today this is always
`three-procedural` with `tier: "preview"`. `isAuthoritativeKernel()` is reserved
for a future second-tier kernel but currently returns `false`.

Key methods:

- `buildInsole` / `buildInsoleSolid` — parametric height-field insole
- `buildFromBase` — Base + Modifier displacement on a stock GLB
- `exportSTL` — binary STL from `BufferGeometry`

## Workers

- **`geometry.worker.ts`** — lightweight preview mesh while interacting
- **`procedural-wall.worker.ts`** — print-solid / wall spline workloads off the main thread

## Export pipeline

1. Build solid mesh from design state (`export-geometry.ts`, `kernel-build.ts`).
2. Apply manufacturing close (`mesh-close.ts`, GLB rim-close when using stock bases).
3. Validate with `analyzeManifold` (`solidClosed` remains false for procedural solids).
4. Write STL via `geometryToBinarySTL`.

See `docs/base-modifier-architecture.md` for Base + Modifier flow and
`docs/orthotic-insole-cad-architecture.md` for the full clinical operator model
(updated incrementally as features land).

## Export parity lock (PR1)

The `export parity lock` rstest file pins SHA-256 hashes for default and SAMPLE_Top
export STLs. Do not change those hashes without an intentional geometry change.
