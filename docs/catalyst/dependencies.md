# DB, auth, and storage inventory (Catalyst pilot)

The database **stays Postgres on Supabase** for this pilot. Catalyst Data Store (ZCQL) is not Postgres and is out of scope. **Neon is a later, separate step** — do not fold it into the hosting pilot (no URL swap, no RPC port, no hostname-rewriter removal).

**GM:** **Supabase Auth and Supabase Storage stay.** The pilot only proves hosting (Slate / optional short AppSail). Every Auth and Storage call site is still flagged below. None move to Catalyst Auth or Stratus.

## Database (Postgres — keep)

| Item | Where | Supabase-specific? | Catalyst note |
| --- | --- | --- | --- |
| Prisma datasource `postgresql` | `vertex/prisma/schema.prisma` | Provider-agnostic SQL | Stays on Supabase Postgres for this pilot |
| `DATABASE_URL` (pooled) / `DIRECT_URL` (direct) | `vertex/.env.example`, Render, Vercel | Today these are Supabase pooler + direct hosts | Keep pointing at **non-production** Supabase for any Catalyst-side migrate. Neon later, not here. |
| Host rewrite for invalid `postgres.{ref}` | `vertex/server/src/lib/prisma.ts` | **Yes — Supabase hostname heuristics** | Leave as-is. Neon cleanup is a later step. |
| `extractSupabaseProjectRef` / `db.{ref}.supabase.co` | same | **Yes** | Leave as-is. |
| Application tables (`users`, `licenses`, `clients`, `designs`, `scans`, `corrections`, `elements`, `productions`, `exports`, `prescriptions`, `custom_elements`, `custom_prefabs`, `audit_logs`, `stock_bases`, …) | Prisma schema | No | Stay on Postgres |
| Security-definer RPCs | `vertex/server/supabase/rpcs/*.sql` | **Yes — created in Supabase Postgres** | Stay on Supabase. Names: `vertex_ensure_app_user`, `vertex_assert_active_license`, `vertex_grant_admin_tokens`, `vertex_save_design`, `vertex_create_stock_base`, `vertex_update_stock_base`, `vertex_delete_stock_base`, `vertex_ensure_default_stock_base`, `vertex_charge_library_save`, `vertex_charge_ai_prescription`, `vertex_authorize_export`, `vertex_charge_manufacturing_hybrid`, `vertex_deduct_user_tokens` |
| RLS mentioned on `stock_bases` | schema comments | **Yes — Supabase RLS** | App uses the service role; RLS is defense-in-depth. Unchanged. |
| `User.id` mirrors `auth.users` UUID | Prisma `User` | **Yes — Supabase Auth identity** | **Supabase Auth stays** for the pilot. |

**Neon (later, not this pilot):** keep Prisma + the RPC SQL, then change `DATABASE_URL` / `DIRECT_URL` and drop the Supabase hostname rewriter. Do not start that work here. Auth and Storage can remain on Supabase even after a Neon DB move.

**Do not use:** Catalyst Data Store / ZCQL, Catalyst NoSQL, Catalyst Cache (not Redis; we have no BullMQ here anyway).

## Auth — Supabase Auth (flagged)

| Item | Where | Flag |
| --- | --- | --- |
| Browser client `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)` | `vertex/src/lib/supabase.ts` | **Supabase Auth + session persistence** |
| `signInWithPassword` | `vertex/src/features/auth/LoginScreen.tsx`, `useAuthBootstrap.ts` | **Supabase Auth** |
| `auth.getSession` / `onAuthStateChange` | `useAuthBootstrap.ts`, `vertex/src/lib/trpc.ts` | **Supabase Auth** |
| Bearer JWT on every tRPC call | `vertex/src/lib/trpc.ts` | **Supabase access_token** |
| Server `auth.getUser(token)` | `vertex/server/src/context.ts` | **Supabase Auth admin** |
| Service role client | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | **Supabase Auth + bypass RLS** |
| `vertex_ensure_app_user` | `ensure-user.ts` | **Supabase Auth UUID → app `users` row** |
| Offline `Bearer dev:` bypass | `dev-auth.ts` | Not Supabase; disabled when Supabase is configured in production |
| Hardcoded default stock URL project ref `wstneucimlemaokoyjwh` | `stock-resolve-supabase.ts`, `verify-default-glb-manifold.ts` | **Supabase project coupling** |

Catalyst Authentication is **not** enabled (`catalyst_auth: false` on both AppSail services). Turning it on would intercept requests and break the Supabase JWT flow.

## Storage — Supabase Storage (flagged)

| Bucket (default) | Env override | Used for | Flag |
| --- | --- | --- | --- |
| `vertex-assets` | `STORAGE_BUCKET` | custom library GLBs, scans, generic uploads | **Supabase Storage** |
| `vertex-manufacturing` | `MANUFACTURING_BUCKET` | temp STLs, archives, G-code / STL output | **Supabase Storage** (signed upload + signed download) |
| `stock-bases` | `STOCK_STORAGE_BUCKET` / `VITE_STOCK_STORAGE_BUCKET` | public stock-base GLBs (`Templates/Default.glb`) | **Supabase Storage** (public URL) |

Code: `vertex/server/src/lib/storage.ts`, `manufacturing-stl-lifecycle.ts`, `routers/manufacturing.ts`, `routers/library.ts`, `routers/stock.ts`, `vertex/src/lib/geometry/stock-resolve-supabase.ts`, `scripts/cleanup-manufacturing-temp.ts`, `scripts/seed-default-stock-base.ts`.

Prefixes: `manufacturing-temp/`, `manufacturing-archive/`, `gcode/`, `manufacturing-output/`, `stock/`.

The Python service does **not** talk to Supabase. It pulls `stl_url` (a Supabase signed URL produced by the Node API) over HTTPS.

Stratus is an optional later replacement behind an S3-like adapter. Not in this pilot.

## What stays off Catalyst

- Vercel production SPA + optional Vercel tRPC (`vertex/api/trpc`, `vertex/vercel.json`) — **untouched**
- Render blueprint (`render.yaml`) — **G-code / `generateSolid` stay here** for the pilot
- No custom domain, no DNS, no paid Catalyst upgrades in this PR
- No Neon cutover
- No Catalyst Job / async-poll implementation
