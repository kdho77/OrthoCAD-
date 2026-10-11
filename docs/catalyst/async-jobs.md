# SCOPE: submit-then-poll manufacturing jobs (not implemented)

**Status:** documentation only. This PR does **not** add job tables, queues, poll RPCs, or Catalyst Job / Cron / Event functions.

**GM decision for the Catalyst hosting pilot:** `POST /manufacture` G-code and tRPC `manufacturing.generateSolid` **stay on Render**. AppSail must not expose synchronous long routes. Preview wall reconstruct stays in the **browser worker**.

This note is the later-work scope if we ever replace Render with a Catalyst-native async path. Checked against current official Zoho docs on 2026-10-11.

## Limits (cited)

| Component | Timeout | Memory | Sources |
| --- | --- | --- | --- |
| AppSail HTTP request | **30 s** (then timeout). Listen within 10 s. Scale-down after 5 min idle. Max 5 instances. | Default 512 MB (256–2048 MB typical). Pilot manufacturing was sketched at 2048 MB. | [AppSail basics](https://docs.catalyst.zoho.com/en/serverless/help/appsail/appsail-basics/) |
| Job function | **15 minutes** constant (`context.getMaxExecutionTimeMs()`). Exceed → **Timeout**. Immediate and scheduled jobs use the same cap. | Per function **128–512 MB**, default **256 MB**. Function Job Pool must be **larger than** the functions it triggers; pool max **10 GB** / project (dispatch, not extra per-job heap). | [Job functions](https://docs.catalyst.zoho.com/en/serverless/help/functions/job-functions/), [Job pool key concepts](https://docs.catalyst.zoho.com/en/job-scheduling/help/jobpool/key-concepts/), [Configure function memory](https://docs.catalyst.zoho.com/en/cli/v1/working-with-functions/configure-function-memory/), [Function implementation](https://docs.catalyst.zoho.com/en/serverless/help/functions/implementation/) |
| Event function | **15 minutes** (`getMaxExecutionTimeMs`). | Same 128–512 MB function range. | [Event functions](https://docs.catalyst.zoho.com/en/serverless/help/functions/event-functions/), [Serverless FAQ](https://docs.catalyst.zoho.com/en/faq/serverless/) |
| Cron function | **15 minutes**. Standalone Cron scheduler is legacy; new schedules should use Job Scheduling. | Same 128–512 MB function range. | [Cron functions](https://docs.catalyst.zoho.com/en/serverless/help/functions/cron-functions/), [Serverless FAQ](https://docs.catalyst.zoho.com/en/faq/serverless/) |
| Basic I/O / Advanced I/O | **30 s** | 128–512 MB | [Serverless FAQ](https://docs.catalyst.zoho.com/en/faq/serverless/) |
| Job Scheduling | Cron min interval **1 minute**. Targets: Job Function, Webhook (any URL), Circuit, or **AppSail**. AppSail / webhook / Circuit pools: max **10** parallel targets. | Function pools: memory as above. AppSail pools: count, not RAM. | [Job Scheduling introduction](https://docs.catalyst.zoho.com/en/job-scheduling/getting-started/introduction/), [Job pool key concepts](https://docs.catalyst.zoho.com/en/job-scheduling/help/jobpool/key-concepts/) |

Job runtimes: Java 7/11/17, Node 18, Python 3.10–3.13. Zip / CLI function, **not** an OCI container. [Job functions](https://docs.catalyst.zoho.com/en/serverless/help/functions/job-functions/).

Job Scheduling **can** target AppSail, but that still **HTTP-invokes** the service. The AppSail **30 s request timeout still applies** ([AppSail basics](https://docs.catalyst.zoho.com/en/serverless/help/appsail/appsail-basics/), [Job Scheduling introduction](https://docs.catalyst.zoho.com/en/job-scheduling/getting-started/introduction/)). A job that POSTs `/manufacture` to AppSail does not buy a 15-minute AppSail request.

The plugin note “use AppSail when work exceeds 15 minutes (no timeout)” is **wrong for HTTP**: official AppSail docs cap a request at 30 s. AppSail is billed on instance uptime, not on an unbounded request.

## Fit vs measured work

From [manufacturing-30s.md](./manufacturing-30s.md):

| Work | Time | 30 s AppSail HTTP | 15 min Job / Event / Cron |
| --- | --- | --- | --- |
| Coupon `/manufacture` G-code | 7 ms measured | Fits | Fits |
| Dense 12k-face foot-size G-code | ~8 s est. | Fits | Fits |
| Production-density G-code (`Default.glb` scale) | **~194 s** est. (119 × 1.608 s/layer) | **Does not fit** | **Fits** (~3.2 min, ~11 min headroom) |
| Preview wall reconstruct | **~25 s/foot** (browser worker) | **Near / over** if moved to a sync AppSail route | **Fits** |

**Memory fit is the blocker for Catalyst Jobs**, not the 15-minute clock:

- Official function RAM is **at most 512 MB**.
- The manufacturing service was sized at **2048 MB** on AppSail for trimesh / numpy / shapely / gyroid.
- `Default.glb` is 85k faces. A Job/Event/Cron function cannot use the existing Docker image (`libgl1`, full `python-service`).
- The 10 GB figure is **Job Pool** capacity (how many function instances you can dispatch), not 10 GB for one G-code run.

So: **time-wise, ~194 s G-code and ~25 s/foot reconstruct fit a Job/Event/Cron function. Memory- and packaging-wise, they do not fit the current service.** Putting reconstruct on AppSail as a sync route is still rejected (NEAR_30S).

## Recommendation

**Keep Render for G-code and `generateSolid` for this pilot.** Do not implement Catalyst Jobs now.

| Option | Verdict |
| --- | --- |
| Sync AppSail `/manufacture` or `generateSolid` | No. 30 s cap vs ~194 s. |
| Job Scheduling → AppSail `/manufacture` | No. Still a 30 s AppSail HTTP call. |
| Job / Event / Cron function hosting the slicer | Timeout OK (~194 s < 15 min). **Reject for now:** 512 MB cap, no OCI, rewrite of `python-service`. |
| Job Scheduling webhook → **Render** `/manufacture` | Would work as a later async glue layer. Not this pilot. |
| **Leave manufacturing on Render** | **Yes.** Hosting proof is Slate (+ optional short AppSail routes). |

## Later submit-then-poll shape (do not build)

If Render is ever replaced:

1. Client uploads STL (existing signed URL).
2. Short tRPC `submitManufacture` writes `queued` and returns `{ jobId }` in well under 30 s. Charge tokens the same way as today or on success.
3. A worker (Render process **or**, only after a memory spike, a Catalyst Job function) runs `/manufacture`, writes G-code to Supabase Storage, sets `done` / `failed`.
4. Client polls `getManufactureJob({ jobId })` or waits on a signed download URL.
5. Preview wall reconstruct stays in the browser worker. Do not schedule it as an AppSail request.

Out of scope here: schema, poll RPC, Job function zip, Job pool, webhook, Circuits.

## Pilot routing

| Route | Host |
| --- | --- |
| SPA | Slate (when token + Start Exploring exist) |
| Short tRPC (`user.health`, CRUD, `prepareManufacturingStlUpload`, `getGcodeDownloadUrl`) | Render today; AppSail only if those handlers stay short |
| `manufacturing.generateSolid`, `POST /manufacture` G-code | **Render** |
| Preview wall reconstruct | **Browser worker** |
