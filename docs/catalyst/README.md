# OrthoCAD Catalyst pilot (Development only)

Approved bounded pilot: host the **web OrthoCAD SPA on Catalyst Slate**, and the **Node tRPC API + Python manufacturing service on AppSail**. Vercel production is unchanged. This repo does **not** deploy — a Catalyst CLI token is required and is not stored here.

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

| Piece | Catalyst service | Source | Runtime |
| --- | --- | --- | --- |
| SPA (Vite/React in `vertex/`) | Slate (`orthocad-web`) | `vertex` | `react-vite` |
| tRPC API | AppSail `vertex-api` | `vertex` | managed Node 22 |
| Manufacturing | AppSail `vertex-manufacturing` | `python-service` | OCI container (`Dockerfile`), or managed Python 3.11 fallback |
| Database | **external Postgres** | Supabase today; Neon considered | not Catalyst Data Store |
| Auth | **existing Supabase Auth** | `catalyst_auth: false` | do not enable Catalyst SSO |
| Files | **existing Supabase Storage** | see [dependencies.md](./dependencies.md) | Stratus is optional later |

Cross-origin: Slate is `*.onslate.com`, AppSail is `*.catalystappsail.com`. The Node API echoes `CORS_ORIGIN` (comma-separated). Set `catalyst_auth` to `false` on both AppSail services so Catalyst SSO does not intercept Supabase JWTs. After the first Slate deploy, add that exact origin to `CORS_ORIGIN` and to Console → Authentication → Whitelisting (CORS toggle).

## AppSail limits (pilot)

Documented platform limits ([AppSail basics](https://docs.catalyst.zoho.com/en/serverless/help/appsail/appsail-basics/)):

| Limit | Value | OrthoCAD impact |
| --- | --- | --- |
| Request timeout | **30s** | `POST /manufacture` G-code on production-density meshes is **over 30s**. See [manufacturing-30s.md](./manufacturing-30s.md). |
| Scale-to-zero | after **5 min** idle | Cold start on the next request; manufacturing must still finish inside 30s after listen. |
| Max instances | **5** per app (raise via support) | Fine for internal use. |
| Services per project | **5** | This pilot uses 2 AppSail + 1 Slate. |
| Listen window | **10s** | Do **not** run `prisma migrate deploy` in the start command. Migrate as a pre-deploy step. |
| Default memory / disk | 512 MB / 256 MB | API stays 512 MB; manufacturing is set to 2048 MB. |
| Custom domains | 1 per Slate app; max 5 per application; **no apex**; Zoho SSL up to 48h | Not used. No DNS cutover. Vercel production stays put. |

## Setup (no secrets in git)

1. Install CLI ≥ 1.27.2: `npm install -g zcatalyst-cli`
2. `catalyst login --dc us -ni` (browser OAuth; needs a human)
3. Confirm `catalyst whoami` and that `.catalystrc` points at `orthocad` / Development
4. One-time console: project → Slate → **Start Exploring**; same for AppSail
5. Set AppSail env vars **in the Catalyst console** (do not commit values). Required keys:

**vertex-api**

- `DATABASE_URL`, `DIRECT_URL` (Postgres; keep Supabase or point at Neon)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGIN` — `http://localhost:5180,<slate-https-origin>`
- `MANUFACTURING_SERVICE_URL` — AppSail manufacturing origin (no trailing slash)
- `MANUFACTURING_INTERNAL_API_KEY` (generate; share with manufacturing)
- `AI_PROVIDER`, `AI_API_KEY` (optional)
- `STORAGE_BUCKET`, `MANUFACTURING_BUCKET`, `STOCK_STORAGE_BUCKET` (optional overrides)

**vertex-manufacturing**

- `MANUFACTURING_INTERNAL_API_KEY`
- `CORS_ORIGIN` (optional; browser does not call this service today)
- `X_ZOHO_CATALYST_LISTEN_PORT` is injected by the platform

**orthocad-web (Slate, build-time only)**

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` — `https://vertex-api-<ZAID>.development.catalystappsail.com/trpc`
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

Prisma: `npm run db:push` or `npx prisma migrate deploy` **before** the process listens. AppSail kills instances that are not listening within 10s.

## Deploy to Development (token required — do not run yet)

Vercel production, DNS, and custom domains stay untouched. Target **Development only**.

```bash
# 0. Login (human)
catalyst login --dc us -ni

# 1. Pre-deploy migrate (external Postgres). Never put this in the start command.
cd vertex && npx prisma migrate deploy && cd ..

# 2. Local verify
catalyst serve -ni
# curl AppSail health: GET /trpc/user.health  and  GET /health

# 3. Slate (SPA)
cd vertex && npm run build && mkdir -p dist/.catalyst && \
  cp .catalyst/slate-config.toml dist/.catalyst/slate-config.toml && cd ..
catalyst deploy slate orthocad-web -ni

# 4. API (managed Node)
catalyst deploy appsail --name vertex-api \
  --build-path "$(pwd)/vertex" --stack node22 \
  --command "sh -c 'npx tsx server/src/index.ts'" -ni

# 5. Manufacturing (OCI, linux/amd64)
docker build --platform linux/amd64 -t orthocad-manufacturing:local python-service
catalyst deploy appsail --name vertex-manufacturing \
  --source docker://orthocad-manufacturing:local -ni
```

After deploy: set `CORS_ORIGIN` and `VITE_API_URL` to the real hosts, rebuild Slate, smoke-test login + `user.health` + a coupon `/manufacture`. Do **not** map a custom domain. Do **not** promote to Production.

## What this pilot does not do

- No deploy from this PR (no CLI token in CI)
- No Vercel / DNS / paid-plan changes
- No secrets in git
- No Catalyst Data Store, Catalyst Auth, or Stratus cutover
- No self-trigger on CI or Vercel status events
