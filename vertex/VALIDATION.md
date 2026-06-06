# Vertex Web Orthotic CAD — Validation Checklist

Validation of the web app against the Vertex Orthopedic Rhino workflow and the
project requirements. ✅ = implemented, ◑ = implemented with a documented
production seam.

## Workflow parity

| Vertex capability | Status | Where |
| --- | --- | --- |
| Client management | ✅ | `features/clients`, `stores/client-store`, `server/routers/client` |
| Design management (save/open) | ✅ | `SaveControl`, `client-store`, `server/routers/design` |
| 3D scan / prefab import (STL/OBJ) | ✅ | `lib/geometry/import`, `features/scans` |
| Pattern selection | ✅ | `LeftSidebar` (full contact, prefab 3D, flat, custom) |
| Custom GLB library | ✅ | `features/library`, `custom_elements` / `custom_prefabs`, Supabase Storage |
| Trim / vertex mesh editing | ✅ | `MeshEditTools`, `mesh-edit-store` |
| Production methods | ✅ | printing solid / shell, 3-axis milling |
| Parametric corrections | ✅ | `features/corrections`, `lib/geometry/insole` |
| — Pronation/Supination L/R, fore/rear, mm/deg | ✅ | independent + linkable, unit toggle |
| — Medial/Lateral skive | ✅ | |
| — Arch (height/fill), heel cup (depth/height) | ✅ | |
| — Apex move, flanges | ✅ | |
| Elements library | ✅ | met pad/bar, Cluffy, Morton's, reverse Morton's, kinetic wedge, sinks |
| — clickable add, drag / scale / reshape | ✅ | `ElementMarkers` + TransformControls |
| Real-time 3D updates | ✅ | reactive Zustand → memoized geometry rebuild |
| Solid / shell generation | ✅ | watertight heightmap solid; shell = 0% infill |
| Watertight validation | ✅ | `lib/geometry/manifold` |
| TPU printing incl. 45° belt | ✅ | `lib/kiri` slicer + belt transform, Apex Belt V2 preset |
| 3-axis CNC toolpaths + G-code | ✅ | `lib/kiri/cnc` |
| AI prescription upload (text/image) | ✅ | `server/routers/ai`, `features/ai-prescription` |
| AI auto-apply to 3D model | ✅ | `applyPrescription` |
| STL export | ✅ | `features/exports` |
| G-code export | ✅ | Printing tab |

## Monetization & security

| Requirement | Status | Where |
| --- | --- | --- |
| Supabase Auth, roles super_admin/admin/clinician | ✅ | `lib/supabase`, `useAuthBootstrap`, `LoginScreen` |
| Auth enforcement (gate when configured) | ✅ | `App.tsx` |
| Licenses: monthly/yearly/per-seat + expiration | ✅ | Prisma `License`, `admin.createLicense/renew/revoke` |
| Export tokens (STL/G-code consume tokens) | ✅ | `export.authorize` (atomic deduct) |
| AI generation consumes tokens | ✅ | `ai.parsePrescription` (3 tokens) |
| Server-side license + token checks | ✅ | guarded decrement in a DB transaction |
| Super Admin Portal | ✅ | `components/admin/AdminPortal` + `server/routers/admin` |
| Audit logs | ✅ | Prisma `AuditLog`; server writes on export/AI/admin/design; session mirror in `audit-store` |

## Production seams (forked-engine swap points)

| Seam | Current | Production |
| --- | --- | --- |
| Geometry kernel | Three.js procedural (`ThreeKernel`) | Forked Chili3D OpenCascade WASM via `loadOcctKernel()` — `cpp/` + `packages/wasm` build |
| CAM engine | In-house slicer/CAM (`lib/kiri`) | Hosted Kiri:Moto engine behind the same `generateGcode` interface |
| Client/design/admin data | Local-first (localStorage) | tRPC routers + Supabase Postgres (wire repositories in deployment) |

## Performance

- Memoized geometry rebuilds; superseded geometry disposed (no GPU leak).
- Element drag coalesced to one store write per animation frame.
- Vendor code-split (three / r3f / react / trpc) for faster first paint.
- Correction inputs clamped to medically valid ranges.

## Manual smoke test

1. `npm run dev` (+ optional `npm run dev:server`).
2. Production tab: adjust corrections → insole updates in real time; "Watertight solid" stays green.
3. Add a met pad → drag/scale/rotate via the gizmo; the bump follows.
4. AI Rx: paste a prescription → Parse → Apply → corrections/elements populate.
5. Import an STL/OBJ scan → renders beside the insole with a manifold badge.
6. Export tab: Export STL (tokens decrement). Printing tab: Generate toolpath → Export G-code.
7. Clients tab: create a client, new design, Save, reopen.
8. Admin (super_admin): grant tokens, renew/revoke license, view audit log.
