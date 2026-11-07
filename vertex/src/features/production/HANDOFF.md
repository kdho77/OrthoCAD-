# Production / Print Farm foundation — handoff

## Implemented (this PR + #236)

- **Production section** with Queue, Printers, and History tabs (`/production/*`, legacy `/orders` redirects).
- **Send to Print Farm** on the Print step (`PrintingPanel`): after G-code is generated (client export or belt server hybrid), queues the job via `production.enqueue` when the API is configured, or the session `production-store` fallback when offline. Requires a **saved** design (valid UUID in the client directory) so enqueue inputs match the DB.
- **Portable job core** in `vertex/shared/production-jobs.ts`: enqueue, assign, hold, cancel, retry, mill download/mark-done, history re-run, 90-day G-code retention with visible countdown (`vertex/shared/retention.ts`).
- **Postgres models** `ShopJob`, `JobGcode`, `ShopPrinter` + migration `20261101170000_production_jobs` (file only; not applied to production).
- **tRPC** `production.*` routes backed by Prisma (`vertex/server/src/routers/production.ts`).
- **Mock Moonraker registration** (`vertex/shared/mock-moonraker.ts`, `production.registerMockPrinter`) — pairing metadata only; no live HTTP or printer commands. `liveVerified` and `protocolVerified` stay false. The mock is not a controller.
- **Printer adapter contract** (`vertex/shared/printer-adapter.ts`) — `createMockMoonrakerAdapter()` is mock-only. `createContractTransport()` is the software seam over an injected controller. The server calls `closedPrinterDispatch()`, which is unbound and does not read a secret. No vendor protocol is documented in this repo, so the seam is not shop-verified.
- **Duplicate enqueue guard** — same tenant, design, and G-code sha256 while still in-queue returns the existing job (retry/network safe).
- **Targeted tests** — `vertex/server/src/lib/production-jobs.test.ts`, production routes in `routes.test.ts`, tenancy coverage in `tenancy.test.ts`.

## Reused

- #236 client/design repository and nav (`DirectoryHeader` Production entry).
- OrthoCAD conventions: shared domain logic, thin tRPC router, Zustand session fallback when API is absent.

## Two-printer dispatch seam (this change)

Queue, assign, and the Print step all use the shop-job path. Dispatch, readiness, reconcile, and explicit cancel call the same functions. The Print step only enqueues. It does not dispatch.

The server router always passes `closedPrinterDispatch()`: transport unbound, credential gate absent, no socket. Tests inject `createContractTransport(fakeIo)`. `liveVerified` and `protocolVerified` stay false. A mock printer cannot be dispatched.

Configured printers are independent rows. A job is sent only to its assigned printer, and only when that printer is idle, recently marked ready, and no other job on it is in `started`, `uncertain`, or `acknowledged`. A timeout or an acknowledgement without a controller job id becomes `uncertain` and is not sent again. Retry is refused in that state. A second concurrent dispatch claims the job once.

Cancellation is sent only by `cancelDispatchedPrint`, and only when that printer's configuration says `explicit` and a controller job id is stored. Queue cancel refuses once a dispatch may have reached a printer.

Spoolman is not implemented. Dispatch does not check filament, color, or remaining weight. Operators must confirm material outside this software. A later bridge could start a job on the wrong spool.

Package extraction to a private `vertex-print-farm` repo is not done. This code stays in OrthoCAD. There is no separate agent process and no polling loop.

## Readiness

| State | This change |
| --- | --- |
| Code-ready | Dispatch, reconcile, and cancel state machine, with fake-controller tests. Mock stays mock. |
| Local connectivity | Not done. No socket, tunnel, or open port. Vercel is not assumed to reach a printer LAN. |
| Permission setup | Not done. No printer secret is bound. The gate returns absent and does not read env. |
| Deployed | Not done. |
| Read-only hardware verified | No. |
| Controlled physical test | Not authorized. |

## Missing contract

No make, model, endpoint, or vendor API is documented in this repo. The mock Moonraker name is not that contract. `orthocad-local-bridge` is only this software seam. Before a genuine binding:

1. The controller identity for each of the two printers.
2. A documented wire protocol with readiness, dispatch (idempotency key, G-code sha256, G-code bytes, durable controller job id), status by that id, and whether cancel exists.
3. A shop-network bridge owner. This server must not be assumed to dial the LAN.
4. A presence-only credential binding in the existing secret store. Do not add a new auth grant. `vertex/server/src/lib/env.ts` has no printer secret.
5. Founder approval to promote `vertex/src/features/production/dispatch-ledger.review.sql` into `vertex/prisma/migrations` and apply it. Until those tables exist, Postgres refuses to store a controller job id.

## Migration review

`20261101170000_production_jobs` creates `shop_printers`, `shop_jobs`, and `job_gcode`. It is already under `vertex/prisma/migrations`. Render's `vertex-api` start command runs `npx prisma migrate deploy`, so that existing file is on the deploy path. This change does not edit it and does not run it.

The dispatch ledger SQL is review-only at `vertex/src/features/production/dispatch-ledger.review.sql`. It is not under `prisma/migrations`, so this change does not apply it. It foreign-keys `shop_jobs` and `shop_printers` and does not alter those tables. Apply the foundation migration first, then the ledger, only after Founder approval. Promoting the review file into `prisma/migrations` would make the next Render start apply it.

Rollback of the ledger only, if those rows are disposable:

```sql
DROP TABLE IF EXISTS "shop_dispatch_events";
DROP TABLE IF EXISTS "shop_dispatch_records";
DROP TABLE IF EXISTS "shop_printer_configs";
```

Do not drop `shop_jobs`, `shop_printers`, or `job_gcode` as part of that rollback.

## Incomplete / next

- Vendor controller binding, shop-network bridge, and credential presence check.
- Vertex Print Agent, progress polling, and auto-start. Not started here.
- Export-step entry point; clinical Print stays preview-only.
- Filament / Spoolman and belt-printer controller support.
- Package extraction to private `vertex-print-farm`.

## Risks

- Do not apply either production migration until the Founder approves.
- `JobGcode.body` is inline text. Large farms may need object storage later.
- The session store does not sync printers across browsers. Postgres is authoritative when the ledger tables exist.
- An uncertain dispatch must be reconciled by an operator. The software will not send it again.

## How to verify locally

```bash
npm test -- vertex/shared/printer-adapter.test.ts vertex/server/src/lib/production-jobs.test.ts vertex/server/src/lib/production-jobs.dispatch.test.ts vertex/server/src/lib/tenancy.test.ts
```

Do not point those tests at a printer. Optional UI smoke remains `scripts/production-e2e.mjs` with `?e2eLogin=1`, and it still must not dial hardware.
