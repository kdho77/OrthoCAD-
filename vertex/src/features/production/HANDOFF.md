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

## Local Moonraker bridge

The shop computer runs `vertex/print-bridge/main.ts`. It opens an outbound HTTPS connection to `ORTHOCAD_BRIDGE_CLOUD_ORIGIN` and then talks to Moonraker on the LAN. It does not listen for inbound printer traffic. Moonraker is not given a public port.

Documented Moonraker calls, and only these: `POST /server/files/upload` with `print=false`, `POST /printer/print/start`, `GET /printer/objects/query?webhooks&virtual_sdcard&print_stats`, JSON-RPC `printer.objects.query` on `/websocket`, and `POST /printer/print/pause|resume|cancel` when the operator asked and cancellation is explicit. `printer.gcode.script` is not called. Upload and start are separate. A timeout after a possible start stays uncertain and is not sent again.

Printer addresses are operator-entered. Production policy allows RFC1918 hosts with an explicit port and rejects loopback, link-local, metadata, public hosts, userinfo, redirects, and a DNS answer that is not LAN. `testLoopbackAddressPolicy` exists for fake localhost servers and is not used by `main.ts`.

Config names:

- `ORTHOCAD_CLOUD_ORIGIN` — server only. The https origin that serves `/print-bridge/v1`. It must be the same string as the bridge's `ORTHOCAD_BRIDGE_CLOUD_ORIGIN`. `production.createBridgeEnrollment` refuses with "Cloud origin is not configured." when this is unset or not https. It is not set on the hosted project by this change.
- `ORTHOCAD_BRIDGE_CLOUD_ORIGIN` — bridge. Must equal `ORTHOCAD_CLOUD_ORIGIN`.
- `ORTHOCAD_BRIDGE_ID` — bridge.
- `ORTHOCAD_BRIDGE_STATE_DIR` — bridge. The credential file is written here, mode 0600.
- `ORTHOCAD_BRIDGE_ENROLLMENT_PROOF` — bridge, one enroll only.
- `ORTHOCAD_MOONRAKER_API_KEY_FILE` — bridge, optional filesystem path. The bridge reads that file once at startup and sends the contents as `X-Api-Key` on Moonraker HTTP calls only. The key is not sent to the cloud, not written into the credential file, and not logged. If the variable is set and the file is missing, empty, or unreadable, the bridge exits before it dials anything. If the variable is unset, Moonraker is called without a key and the shop should use Moonraker `[authorization] trusted_clients`. The websocket status query does not put the key on the URL; authenticated status uses the HTTP query.

Founder example addresses are not stored in this repo.

`/print-bridge/v1/enroll`, `heartbeat`, `report`, and `artifact` are served by the Vercel function `vertex/api/print-bridge` and by the standalone Node server. Both call `handlePrintBridgeNode`. Enrollments and credential hashes persist in `shop_bridges` and `shop_enrollments`. A proof is redeemed once. Artifact reads are ranges of 1 MiB so a multi-megabyte insole G-code stays under Vercel's response limit. The bridge checks sha256 after it reassembles the ranges.

Start, from `vertex/`: `npx tsx print-bridge/main.ts`. Node 22. Revocation makes the next heartbeat fail and stops new work. An in-flight print is not cancelled automatically and is not sent again.

`print-bridge.review.sql` is not under `prisma/migrations`. `shop-rls.review.sql` enables row level security on `shop_printers`, `shop_jobs`, and `job_gcode` and is also not under `prisma/migrations`. Neither file is applied by this change. Apply only with Founder approval, after the foundation migration. The five ledger and bridge tables already have row level security on. The API reaches these tables through Prisma as the table owner.

Gates still open: review, deploy, bridge install, enroll, printer config on the shop LAN, read-only connectivity check, then a separately authorized controlled print.

## How to verify locally

```bash
npm test -- vertex/shared/printer-adapter.test.ts vertex/server/src/lib/production-jobs.test.ts vertex/server/src/lib/production-jobs.dispatch.test.ts vertex/server/src/lib/tenancy.test.ts vertex/server/src/lib/prisma-bridge-directory.test.ts vertex/api/print-bridge/print-bridge-function.test.ts vertex/api/print-bridge/routing.test.ts vertex/server/src/routers/production-bridge-admin.test.ts vertex/src/features/production/ProductionPage.enrollment.test.tsx vertex/shared/print-bridge-moonraker-key.test.ts vertex/src/features/production/shop-rls.review.test.ts vertex/print-bridge/print-bridge.e2e.test.ts
```

Do not point those tests at a printer. Optional UI smoke remains `scripts/production-e2e.mjs` with `?e2eLogin=1`, and it still must not dial hardware.
