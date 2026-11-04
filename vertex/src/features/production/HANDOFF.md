# Production / Print Farm foundation — handoff

## Implemented (this PR + #236)

- **Production section** with Queue, Printers, and History tabs (`/production/*`, legacy `/orders` redirects).
- **Portable job core** in `vertex/shared/production-jobs.ts`: enqueue, assign, hold, cancel, retry, mill download/mark-done, history re-run, 90-day G-code retention with visible countdown (`vertex/shared/retention.ts`).
- **Postgres models** `ShopJob`, `JobGcode`, `ShopPrinter` + migration `20261101170000_production_jobs` (file only; not applied to production).
- **tRPC** `production.*` routes backed by Prisma (`vertex/server/src/routers/production.ts`).
- **Mock Moonraker registration** (`vertex/shared/mock-moonraker.ts`, `production.registerMockPrinter`) — pairing metadata only; no live HTTP or printer commands.
- **Duplicate enqueue guard** — same tenant, design, and G-code sha256 while still in-queue returns the existing job (retry/network safe).
- **Targeted tests** — `vertex/server/src/lib/production-jobs.test.ts`, production routes in `routes.test.ts`, tenancy coverage in `tenancy.test.ts`.

## Reused

- #236 client/design repository and nav (`DirectoryHeader` Production entry).
- OrthoCAD conventions: shared domain logic, thin tRPC router, Zustand session fallback when API is absent.

## Incomplete / next

- Live Moonraker/Klipper adapter, Vertex Print Agent, progress polling, auto-start policies (explicitly out of scope for foundation).
- “Send to Print Farm” from the design Print step (enqueue API exists; UI hook not wired).
- Printer CRUD beyond mock register; filament / Spoolman; belt printers.
- Package extraction to private `vertex-print-farm` repo (Phase 4).

## Risks

- Migration must not run on production until Kendon approves.
- `JobGcode.body` is inline text — large farms may need object storage later.
- Session fallback store does not sync printers across browsers (Postgres is authoritative when configured).

## How to verify locally

```bash
npm test -- vertex/server/src/lib/production-jobs.test.ts vertex/src/features/clients/routes.test.ts
```

Optional UI smoke: `scripts/production-e2e.mjs` against a dev server with `?e2eLogin=1`.
