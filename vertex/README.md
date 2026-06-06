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
- **Backend:** Node.js + tRPC (Phase 4)
- **DB:** Prisma + PostgreSQL (Supabase)
- **Auth:** Supabase Auth
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
  components/   UI panels, layout, viewer, admin, shadcn primitives
  features/     clients, designs, corrections, elements, licensing, exports
  lib/          chili3d kernel wrapper, kiri integration, geometry utils
  stores/       zustand stores (design, auth)
  hooks/        auth bootstrap
  types/        shared domain types
prisma/         complete schema (users, licenses, tokens, clients, designs,
                scans, corrections, elements, productions, audit_logs)
server/         Node + tRPC API (context/auth, export.authorize, user.me)
```

## Phases

- **Phase 0 (this):** project setup, 3D viewer + orbit controls, parametric
  insole geometry + STL export, full Prisma schema, Supabase Auth foundation,
  dark UI shell (TopNav / sidebar / Base·Design·Printing·Export panels),
  token-gated export flow, Super Admin Portal scaffold.
- **Phase 1 (done):** STL/OBJ import (welded + manifold-analyzed), kernel
  watertight-solid validation, real-time solid status, tRPC server with
  server-authoritative token-gated export (atomic deduct + audit).
- **Phase 2:** full corrections engine + elements drag/scale + real-time solids.
- **Phase 3:** Kiri:Moto slicing (belt 45°) + 3-axis CNC + printer presets.
- **Phase 4:** UI polish, client/design management, Super Admin Portal, full
  licensing & token system over tRPC.
- **Phase 5:** auth enforcement, audit logs, validation, deployment.
