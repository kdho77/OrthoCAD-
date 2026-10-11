# OrthoCAD Catalyst pilot (Development only)

Approved bounded pilot: prove **hosting** — SPA on Catalyst Slate, optional **short** AppSail routes. **G-code and `manufacturing.generateSolid` stay on Render.** No synchronous long routes on AppSail. Vercel production is unchanged. This repo does **not** deploy. A later Development deploy waits for a CLI token **and** Kendon enabling Slate/AppSail (**Start Exploring**).

Confirmed account (MCP, 2026-10-11):

| Field | Value |
| --- | --- |
| Org | Kendon / `942536996` (US DC, default) |
| Project | `orthocad` / `123088000000017001` |
| Environment | Development / `123088000000017018` |
| Timezone | America/Boise |
| Serverless domain | https://orthocad-942536996.development.catalystserverless.com |
| Console | https://console.catalyst.zoho.com/baas/942536996/index |

Slate and AppSail are **empty** on this project today (listed via MCP). First deploy creates the Slate `*.onslate.com` host and the AppSail `*.catalystappsail.com` hosts (ZAID is assigned then).

Identity files (seeded from MCP so `catalyst deploy` can link after login; the CLI may rewrite absolute Slate paths):

- [`catalyst.json`](../../catalyst.json)
- [`.catalystrc`](../../.catalystrc)

`catalyst.json` / `.catalystrc` were authored for this pilot because `catalyst init` needs a CLI login we do not have. After `catalyst login --dc us -ni`, re-run `catalyst init --org 942536996 -p 123088000000017001 -ni` if the CLI rejects the seeded files.

## Mapping

| Piece | Pilot host | Notes |
| --- | --- | --- |
| SPA (Vite/React in `vertex/`) | Slate `orthocad-web` | Hosting proof. Config is in `catalyst.json`; do not deploy until token + Start Exploring. |
| Short tRPC (`user.health`, CRUD, STL prepare/upload URL, `getGcodeDownloadUrl`) | Render today; AppSail `vertex-api` only if every handler stays well under 30 s | Do not point the browser at an AppSail API that still runs `generateSolid`. |
| `manufacturing.generateSolid` + Python `POST /manufacture` G-code | **Render** (`vertex-manufacturing`) | GM: stay on Render. Do **not** deploy `python-service` to AppSail for this pilot. See [async-jobs.md](./async-jobs.md). |
| Preview wall reconstruct | Browser worker | ~25 s/foot. Not an AppSail route. |
| Database | **Postgres on Supabase** | Pilot does not move the DB. Neon is a **later, separate** step — do not fold it in. |
| Auth | **Supabase Auth** (stays) | `catalyst_auth: false`. Pilot proves hosting only. |
| Files | **Supabase Storage** (stays) | See [dependencies.md](./dependencies.md). No Stratus cutover. |

Cross-origin: Slate is `*.onslate.com`, AppSail is `*.catalystappsail.com`. The Node API echoes `CORS_ORIGIN` (comma-separated). **Order for a later dev deploy:** deploy first, **then** set `CORS_ORIGIN` / `VITE_API_URL` from the assigned hosts (and whitelist the Slate origin). Do not invent those URLs before the first deploy.

## AppSail limits (pilot)

Documented platform limits ([AppSail basics](https://docs.catalyst.zoho.com/en/serverless/help/appsail/appsail-basics/)):

| Limit | Value | OrthoCAD impact |
| --- | --- | --- |
| Request timeout | **30s** | Why G-code / `generateSolid` stay on Render. See [manufacturing-30s.md](./manufacturing-30s.md) and [async-jobs.md](./async-jobs.md). |
| Scale-to-zero | after **5 min** idle | Cold start on the next short request only. G-code is not on AppSail. |
| Max instances | **5** per app (raise via support) | Fine for internal use. |
| Services per project | **5** | Pilot: Slate + optional 1 short AppSail API. Do not add manufacturing AppSail. |
| Listen window | **10s** | Do **not** run `prisma migrate deploy` in the start command. |
| Default memory / disk | 512 MB / 256 MB | Short API only if AppSail is used. Manufacturing RAM stays on Render. |
| Custom domains | 1 per Slate app; max 5 per application; **no apex**; Zoho SSL up to 48h | Not used. No DNS cutover. Vercel production stays put. |

## Setup (no secrets in git)

1. Install CLI ≥ 1.27.2: `npm install -g zcatalyst-cli`
2. `catalyst login --dc us -ni` (browser OAuth; needs a human)
3. Confirm `catalyst whoami` and that `.catalystrc` points at `orthocad` / Development
4. **Kendon:** project → Slate → **Start Exploring**; same for AppSail. Required before any remote deploy.
5. Console env vars (no values in git), **after** the first deploy when hosts exist — see deploy order below.

**vertex-api** (only if a short-route AppSail API is deployed later)

- `DATABASE_URL`, `DIRECT_URL` — existing **non-production** Supabase Postgres (not a Neon cutover; not production)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — **Supabase Auth stays**
- `CORS_ORIGIN` — set **after** deploy, once the Slate origin is known
- `MANUFACTURING_SERVICE_URL` — **Render** manufacturing origin (not AppSail)
- `MANUFACTURING_INTERNAL_API_KEY` (shared with Render manufacturing)
- `AI_PROVIDER`, `AI_API_KEY` (optional)
- `STORAGE_BUCKET`, `MANUFACTURING_BUCKET`, `STOCK_STORAGE_BUCKET` (optional; **Supabase Storage stays**)

**Do not deploy `vertex-manufacturing` to AppSail** in this pilot.

**orthocad-web (Slate, build-time only)**

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — **Supabase Auth stays**
- `VITE_API_URL` — set **after** deploy. For generateSolid, keep pointing at **Render** tRPC (or a host that still calls Render manufacturing).
- `VITE_STOCK_STORAGE_BUCKET` (optional)

Do not put secrets in `app-config.json` `env_variables`. A linked CLI deploy **replaces** console env vars with that object (an empty object wipes runtime vars).

## Local run

Prefer the existing local loop (no Catalyst token required):

```bash
# API
cd vertex
cp .env.example .env   # fill locally; never commit
npm install
npm run prisma:generate
npm run dev:server     # http://localhost:5181/trpc

# SPA
npm run prepare:wasm
npm run dev            # http://localhost:5180

# Manufacturing
cd python-service
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

Both servers honor `X_ZOHO_CATALYST_LISTEN_PORT` when present (AppSail / `catalyst serve`).

When a CLI token exists:

```bash
# from repo root, after login
catalyst serve -ni
```

That serves Slate + AppSail locally; managed Catalyst services proxy to Development. Do **not** use `catalyst serve` as a substitute for `npm run test` / `npm run check`.

Prisma: never put `prisma migrate deploy` in an AppSail start command (10 s listen window). When you migrate, use a **non-production** database only.

## Deploy to Development (later — do not run in this PR)

Blocked until (a) a Catalyst CLI token exists and (b) Kendon has enabled Slate and AppSail (**Start Exploring**). Vercel production, DNS, and custom domains stay untouched. Target **Development only**. **Do not deploy manufacturing to AppSail.**

**Order:**

1. **First deploy** Slate (and, if used, a short-route AppSail API). No `CORS_ORIGIN` / `VITE_API_URL` guesses before hosts exist.
2. **Then set** `CORS_ORIGIN` and `VITE_API_URL` from the assigned Slate / API hosts. Rebuild Slate if the API URL is a build-time Vite var. Keep `VITE_API_URL` / `MANUFACTURING_SERVICE_URL` on **Render** for `generateSolid` / G-code.
3. **`prisma migrate deploy` only against a non-production DB.** Never the production Supabase/Vercel database. Never in the AppSail start command.

```bash
# 0. Human, after token + Start Exploring
catalyst login --dc us -ni

# 1. First deploy — Slate hosting proof
cd vertex && npm run build && mkdir -p dist/.catalyst && \
  cp .catalyst/slate-config.toml dist/.catalyst/slate-config.toml && cd ..
catalyst deploy slate orthocad-web -ni

# Optional short-route API only (no generateSolid traffic)
# catalyst deploy appsail --name vertex-api --build-path "$(pwd)/vertex" --stack node22 \
#   --command "sh -c 'npx tsx server/src/index.ts'" -ni

# 2. Then set CORS_ORIGIN and VITE_API_URL from the assigned hosts (console / rebuild)

# 3. Migrate only a non-production Postgres (not production, not a Neon cutover)
# cd vertex && DATABASE_URL=... DIRECT_URL=... npx prisma migrate deploy
```

Do **not** map a custom domain. Do **not** promote to Production. Do **not** `catalyst deploy` `vertex-manufacturing`.

## What this pilot does not do

- No deploy from this PR (no CLI token in CI)
- No Vercel / DNS / paid-plan changes
- No secrets in git
- No Catalyst Data Store, Catalyst Auth, or Stratus cutover
- No Neon cutover (later, separate)
- No async job implementation ([async-jobs.md](./async-jobs.md) is scope only)
- No self-trigger on CI or Vercel status events
