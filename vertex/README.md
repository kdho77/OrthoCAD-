# Vertex Orthopedic — Insole CAD

Browser-based replacement for the Windows Rhino-based orthotic insole CAD
workflow: client management, 3D scan/prefab import, parametric corrections,
element addition, solid/shell generation, TPU printing (incl. belt printers) and
3-axis CNC toolpaths — with licensing and a token-based export system.

## Tech stack

- **Frontend:** React 18 + Vite + TypeScript + TailwindCSS + shadcn-style UI + React Three Fiber
- **3D kernel:** Forked Chili3D (OpenCascade WASM) via `IGeometryKernel` — auto-loads OCCT at boot with procedural + worker fallback
- **Workers:** Procedural preview mesh (`geometry.worker.ts`); OCCT tessellation (`occt.worker.ts`)
- **Slicing / CAM:** Kiri:Moto-compatible in-house engine (`lib/kiri`)
- **State:** Zustand
- **Backend:** Node.js + tRPC (type-safe)
- **DB:** Prisma + PostgreSQL (Supabase)
- **Auth:** Supabase Auth
- **AI:** Server-side prescription parsing via Anthropic (Claude) or xAI (Grok)
- **Storage:** Supabase Storage (custom GLB library) + local-first offline mode

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  React UI (Production / Clients / Admin)                    │
├─────────────────────────────────────────────────────────────┤
│  Zustand stores → useInsoleGeometry / geometryEngine        │
│    interacting  → geometry.worker (procedural preview)      │
│    idle + OCCT  → occt.worker (WASM tessellation)           │
│    export/save  → getKernel().buildInsole() (main thread)   │
├─────────────────────────────────────────────────────────────┤
│  IGeometryKernel: OcctKernel │ ThreeKernel (fallback)        │
│  occt-insole: loft → skives → booleans → shell → repair     │
├─────────────────────────────────────────────────────────────┤
│  tRPC API: auth, export.authorize, ai, library, design      │
│  Prisma + Supabase Postgres + Storage                       │
└─────────────────────────────────────────────────────────────┘
```

## Getting started

```bash
cd vertex
npm install
cp .env.example .env   # optional — runs offline without it
npm run prepare:wasm     # copy OCCT WASM to public/chili-wasm/
npm run dev              # frontend  → http://localhost:5180
npm run dev:server       # tRPC API  → http://localhost:5181 (optional)
```

Build OCCT WASM from repo root (first time or after C++ changes):

```bash
cd .. && npm run setup:wasm && npm run build:wasm
cd vertex && npm run prepare:wasm
```

Without Supabase credentials the app runs in **offline dev mode** with a local
`super_admin` user (100 export tokens, active license) so the full workspace is
usable.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘/Ctrl+P | Open AI prescription upload |
| ⌘/Ctrl+E | Export STL (left side) |
| ⌘/Ctrl+S | Save design (via Save control when wired) |
| T | Toggle transparent insole view |
| Esc | Deselect element |

### Export modes

- **Server-authoritative** (`VITE_API_URL` + `SUPABASE_*` set): `export.authorize`
  validates the license and **atomically** deducts tokens, recording an `Export`,
  a `TokenTransaction` and an `AuditLog` row in one DB transaction.
- **Offline fallback** (no API): client-side license/token gate with optimistic
  local deduction.

### Database

```bash
npm run prisma:generate
npm run prisma:migrate    # requires DATABASE_URL / DIRECT_URL
```

## Project structure

```
vertex/src/
  components/   UI panels, layout, viewer, admin, ErrorBoundary
  features/     clients, corrections, elements, library, exports, ai-prescription
  lib/          chili3d kernel, geometry engine, kiri CAM, trpc, supabase
  workers/      geometry.worker.ts, occt.worker.ts
  stores/       zustand (design, auth, kernel, performance, custom-library)
  hooks/        useInsoleGeometry, useSolidValidation, useKeyboardShortcuts
vertex/server/  tRPC routers + rate limiting + GLB validation
prisma/         Postgres schema
```

## Phases (0–9 complete)

| Phase | Summary |
| --- | --- |
| 0–5 | Foundation, AI Rx, CAM, clients, auth, Render blueprint |
| 6 | Custom GLB library + OCCT WASM kernel |
| 7 | Web Worker preview, 60fps optimizations, FPS monitor |
| 8 | Full OCCT integration via `IGeometryKernel`, shelling, validation |
| 9 | Production polish: OCCT worker, custom GLB booleans, rate limits, Vercel deploy, docs |

See `VALIDATION.md` for the full clinical workflow checklist.

## Deployment

### Vercel (recommended for SPA)

Root `vercel.json` builds `vertex/` and serves the Vite SPA with WASM asset caching.
Set environment variables in the Vercel dashboard:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` → your tRPC backend URL

Deploy the API separately (Render or any Node host) with `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY`, and `CORS_ORIGIN` set to your Vercel domain.

### Render (full stack)

Blueprint at repo root (`render.yaml`):

- **vertex-web** — static SPA (`vertex/dist`)
- **vertex-api** — Node tRPC on port 5181, runs `prisma migrate deploy` on start

Set secrets: `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_*`, `AI_API_KEY`, `VITE_API_URL`, `CORS_ORIGIN`.

## Testing

```bash
# From repo root
npm run test:wasm -- packages/wasm/test/vertex-insole.wasm.test.ts
npx rstest vertex/server/src/lib/*.test.ts

# From vertex/
npm run typecheck && npm run build
```
