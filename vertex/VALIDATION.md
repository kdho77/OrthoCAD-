# Vertex Web Orthotic CAD — Validation Checklist

Validation of the web app against the Vertex Orthopedic Rhino workflow and
production readiness requirements. ✅ = implemented, ◑ = partial / documented seam.

## Workflow parity

| Vertex capability | Status | Where |
| --- | --- | --- |
| Client management | ✅ | `features/clients`, `stores/client-store`, `server/routers/client` |
| Design management (save/open) | ✅ | `SaveControl`, `client-store`, `server/routers/design` |
| 3D scan / prefab import (STL/OBJ) | ✅ | `lib/geometry/import`, `features/scans` |
| Pattern selection | ✅ | `LeftSidebar` (full contact, prefab 3D, flat, custom) |
| Custom GLB library | ✅ | `features/library`, Supabase Storage, token-gated save |
| Custom GLB → OCCT booleans | ✅ | `custom-element-bounds` + oriented box fuse in `occt-insole` |
| Custom prefab export (STL/G-code) | ✅ | `export-geometry.ts` loads saved GLB |
| Trim / vertex mesh editing | ✅ | `MeshEditTools`, `mesh-edit-store` |
| Performance (60fps CAD) | ✅ | Worker preview, OCCT worker, instanced markers, FPS toggle |
| Production methods | ✅ | printing solid / shell, 3-axis milling |
| Parametric corrections | ✅ | `features/corrections`, height-field + OCCT loft |
| Elements library | ✅ | stock + custom elements, 3D gizmos |
| Real-time 3D updates | ✅ | `useInsoleGeometry`, preview/commit pipeline |
| Solid / shell generation | ✅ | OCCT loft + booleans + `makeThickSolidByJoin` |
| Watertight validation | ✅ | OCCT `isClosed()` + mesh edge analysis |
| TPU printing incl. 45° belt | ✅ | `lib/kiri` slicer + belt transform |
| 3-axis CNC toolpaths + G-code | ✅ | `lib/kiri/cnc` |
| AI prescription upload | ✅ | `server/routers/ai`, rate-limited |
| AI auto-apply to 3D model | ✅ | `applyPrescription` |
| STL / G-code export | ✅ | `export-service`, custom prefab aware |

## Monetization & security

| Requirement | Status | Where |
| --- | --- | --- |
| Supabase Auth + role gates | ✅ | `App.tsx`, `server/trpc.ts` |
| License + token checks (atomic) | ✅ | export, AI, library routers |
| Rate limiting (export / AI / library) | ✅ | `server/lib/rate-limit.ts` |
| GLB upload validation (magic + 15 MB cap) | ✅ | `server/lib/glb-validation.ts` |
| Token deduct after successful library save | ✅ | `library.ts` (upload then deduct) |
| Audit logs (server + admin UI) | ✅ | Prisma + `AdminPortal` `listAuditLogs` |
| CORS + env warnings | ✅ | `server/lib/env.ts` |

## Production deployment

| Platform | Status | Notes |
| --- | --- | --- |
| Vercel SPA + self-contained tRPC | ✅ | `vertex/vercel.json` (rootDirectory=vertex), single self-contained `api/trpc/[[...trpc]].ts` function (no `functions` config), WASM headers |
| Render Blueprint | ✅ | `render.yaml` web + API, `prisma migrate deploy` |
| OCCT WASM bundle | ✅ | ~16 MB, lazy-loaded, worker offload |

## Performance targets

| Metric | Target | Implementation |
| --- | --- | --- |
| Interactive slider/gizmo | 60 fps | Preview mesh (48×24) in geometry worker |
| Idle full-quality rebuild | < 2 s typical | OCCT worker + rAF main-thread fallback |
| First paint | Code-split | Vite manual chunks (three/r3f/trpc) |
| GPU memory | No leaks | Geometry dispose on rebuild |

## Manual smoke test (clinical workflow)

1. `npm run dev` (+ optional `npm run dev:server`).
2. Wait for OCCT banner → status bar shows `opencascade wasm`.
3. Adjust corrections → preview updates smoothly; release → full OCCT mesh.
4. Add met pad + custom library element → drag/scale; OCCT fuse on idle.
5. AI Rx: ⌘P → paste prescription → Apply → corrections populate.
6. Import STL scan → renders with manifold badge.
7. Export STL (⌘E) → watertight check green; tokens decrement.
8. Printing tab → Generate toolpath → Export G-code.
9. Save custom element to library → appears in Elements panel.
10. Admin → Audit tab shows server log entries (when API configured).

## Comparison vs Rhino / legacy Vertex

| Area | Web Vertex | Notes |
| --- | --- | --- |
| Correction accuracy | Height-field parity | Same parametric model; OCCT loft vs Rhino NURBS — validate against reference STLs per clinic |
| Boolean elements | OCCT BRep | Custom GLB uses bounds-approximated box tool; full mesh BRep import is future work |
| Shell printing | OCCT thick solid | Falls back to solid if shell offset fails |
| Export formats | STL + G-code | STEP/3MF future |

## Automated tests

```bash
npm run test:wasm -- packages/wasm/test/vertex-insole.wasm.test.ts
npx rstest vertex/server/src/lib/glb-validation.test.ts vertex/server/src/lib/rate-limit.test.ts
cd vertex && npm run typecheck && npm run build
```

## Known limitations

- Custom GLB elements use oriented bounding-box OCCT tools (not full mesh BRep) — sufficient for pad-like elements; complex meshes may differ from Rhino.
- OCCT worker duplicates WASM memory (~16 MB per worker tab) — acceptable for clinical single-design sessions.
- Client/design sync remains local-first unless `VITE_API_URL` is configured.
