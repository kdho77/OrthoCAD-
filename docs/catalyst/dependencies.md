# DB, auth, and storage inventory (Catalyst pilot)

The database **stays Postgres**. Catalyst Data Store (ZCQL) is not Postgres and would force a Prisma/RPC rewrite — out of scope. A **Neon** move is considered as a later host change of the same Postgres URL pair (`DATABASE_URL` + `DIRECT_URL`). No data migration is required for the Slate/AppSail pilot.

Every **Supabase Auth** and **Supabase Storage** dependency is flagged below. None of these move to Catalyst Auth or Stratus in this pilot.

## Database (Postgres — keep)

| Item | Where | Supabase-specific? | Catalyst note |
| --- | --- | --- | --- |
| Prisma datasource `postgresql` | `vertex/prisma/schema.prisma` | Provider-agnostic SQL | Works against Supabase, Neon, RDS, or local Postgres |
| `DATABASE_URL` (pooled) / `DIRECT_URL` (direct) | `vertex/.env.example`, Render, Vercel | Today these are Supabase pooler + direct hosts | Point at Neon if we switch; AppSail is a normal outbound TLS client |
| Host rewrite for invalid `postgres.{ref}` | `vertex/server/src/lib/prisma.ts` | **Yes — Supabase hostname heuristics** | Harmless on Neon if URLs are already correct; do not remove until Supabase is gone |
| `extractSupabaseProjectRef` / `db.{ref}.supabase.co` | same | **Yes** | Neon does not need this |
| Application tables (`users`, `licenses`, `clients`, `designs`, `scans`, `corrections`, `elements`, `productions`, `exports`, `prescriptions`, `custom_elements`, `custom_prefabs`, `audit_logs`, `stock_bases`, …) | Prisma schema | No | Stay on Postgres |
| Security-definer RPCs | `vertex/server/supabase/rpcs/*.sql` | **Yes — created in Supabase Postgres** | Port the SQL to Neon (or any Postgres) before cutting over. Names: `vertex_ensure_app_user`, `vertex_assert_active_license`, `vertex_grant_admin_tokens`, `vertex_save_design`, `vertex_create_stock_base`, `vertex_update_stock_base`, `vertex_delete_stock_base`, `vertex_ensure_default_stock_base`, `vertex_charge_library_save`, `vertex_charge_ai_prescription`, `vertex_authorize_export`, `vertex_charge_manufacturing_hybrid`, `vertex_deduct_user_tokens` |
| RLS mentioned on `stock_bases` | schema comments | **Yes — Supabase RLS** | App uses the service role, so RLS is defense-in-depth. Neon would need equivalent policies or rely on the API |
| `User.id` mirrors `auth.users` UUID | Prisma `User` | **Yes — Supabase Auth identity** | Neon-only DB still needs those UUIDs from Supabase Auth (or a new IdP) |

**Neon move (considered, not in this PR):** keep Prisma + the RPC SQL; change `DATABASE_URL` / `DIRECT_URL`; drop the Supabase hostname rewriter once URLs are Neon. Auth and Storage can stay on Supabase independently.

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
- Render blueprint (`render.yaml`) — still the documented full-stack fallback
- No custom domain, no DNS, no paid Catalyst upgrades in this PR
