# Vertex Orthopedic — Insole CAD

Browser-based replacement for the Windows Rhino-based orthotic insole CAD
workflow: client management, 3D scan/prefab import, parametric corrections,
element addition, solid/shell generation, TPU printing (incl. belt printers) and
3-axis CNC toolpaths — with licensing and a token-based export system.

## Tech stack

- **Frontend:** React 18 + Vite + TypeScript + TailwindCSS + shadcn-style UI + React Three Fiber
- **3D kernel:** Forked Chili3D (OpenCascade WASM) — abstracted behind `IGeometryKernel`; Phase 0 ships a Three.js procedural kernel
- **Slicing / CAM:** Kiri:Moto (Phase 3)
- **State:** Zustand
- **Backend:** Node.js + tRPC (type-safe)
- **DB:** Prisma + PostgreSQL (Supabase)
- **Auth:** Supabase Auth
- **AI:** Server-side prescription parsing via Anthropic (Claude) or xAI (Grok)
- **Storage:** Local-first + S3-compatible

## Getting started

```bash
cd vertex
npm install
cp .env.example .env   # optional — runs offline without it
npm run dev            # frontend  → http://localhost:5180
npm run dev:server     # tRPC API  → http://localhost:5181 (optional)
```

Without Supabase credentials the app runs in **offline dev mode** with a local
`super_admin` user (100 export tokens, active license) so the full workspace is
usable.

### Export modes

- **Server-authoritative** (`VITE_API_URL` + `SUPABASE_*` set): `export.authorize`
  validates the license and **atomically** deducts tokens, recording an `Export`,
  a `TokenTransaction` and an `AuditLog` row in one DB transaction. The file is
  generated client-side only after the server returns `ok`.
- **Offline fallback** (no API): client-side license/token gate with optimistic
  local deduction.

### Database

```bash
npm run prisma:generate
npm run prisma:migrate    # requires DATABASE_URL / DIRECT_URL
```

## Project structure

```
src/
  components/   UI panels, layout, viewer, admin, prescription-upload, primitives
  features/     clients, corrections, elements, scans, licensing, exports, ai-prescription
  lib/          chili3d kernel wrapper, kiri integration, geometry utils, trpc, supabase
  stores/       zustand stores (design, auth, scan)
  hooks/        auth bootstrap
  types/        shared domain types
prisma/         complete schema (users, licenses, tokens, clients, designs, scans,
                corrections, elements, productions, exports, prescriptions, audit_logs)
server/         Node + tRPC API (auth ctx, export.authorize, user.me, ai.parsePrescription)
```

## Phases

- **Phase 0 (this):** project setup, 3D viewer + orbit controls, parametric
  insole geometry + STL export, full Prisma schema, Supabase Auth foundation,
  dark UI shell (TopNav / sidebar / Base·Design·Printing·Export panels),
  token-gated export flow, Super Admin Portal scaffold.
- **Phase 1 (done):** STL/OBJ import (welded + manifold-analyzed), kernel
  watertight-solid validation, real-time solid status, tRPC server with
  server-authoritative token-gated export (atomic deduct + audit), and
  **AI prescription upload** (text/image → structured params via Anthropic/xAI,
  token-consuming, with an offline heuristic fallback).
- **Phase 2 (done):** full corrections engine (apex/flanges), elements library
  with 3D drag/scale/rotate gizmos welded into the solid, real-time updates, and
  AI auto-apply of parsed prescriptions.
- **Phase 3 (done):** in-house CAM engine behind the Kiri:Moto seam — FDM contour
  slicer with 45° belt transform, 3-axis CNC raster toolpaths, printer presets
  (Apex Belt V2), token-protected G-code export.
- **Phase 4 (done):** client/design management (master-detail, local-first +
  tRPC routers), functional Super Admin Portal (tokens/licenses/audit), save
  control, status bar.
- **Phase 5 (done):** Supabase auth enforcement + login/sign-out, comprehensive
  audit logs, input clamping, vendor code-splitting + drag throttling, and a
  Render Blueprint. See `VALIDATION.md`.
- **Phase 6 (done):** user custom GLB creation and personal library — trim/vertex
  mesh editing, GLTFExporter export, Supabase Storage upload, `custom_elements` /
  `custom_prefabs` Prisma tables, token-gated save, and "My Custom Library" in the
  Elements panel and pattern selector.
- **Phase 7 (done):** high-performance optimization — Web Worker geometry pipeline,
  preview/full mesh quality, debounced slider + gizmo preview/commit, instanced
  element markers, worker-offloaded manifold checks, optional FPS monitor.

## Deployment

A Render Blueprint is provided at the repo root (`render.yaml`): a static SPA
(`vertex-web`) on the CDN plus a Node + tRPC web service (`vertex-api`) with a
`/user.health` health check. Set the secrets (`DATABASE_URL`, `DIRECT_URL`,
`SUPABASE_*`, `AI_API_KEY`, `VITE_API_URL`, `CORS_ORIGIN`) in the Render
dashboard, then deploy the Blueprint.
