# AppSail 30s timeout — manufacturing measurements

AppSail kills a request at **30 seconds**. Scale-to-zero after 5 minutes idle adds a cold start in front of that budget. This note lists every manufacturing HTTP/tRPC call, with **measured** times from `python-service/scripts/measure_appsail_timeout.py` (2026-10-11, CPython 3.12, numpy/trimesh/shapely stack) or an **estimate** called out as such.

Re-run:

```bash
PYTHONPATH=python-service python3 python-service/scripts/measure_appsail_timeout.py
```

Thresholds used in the script: `OK` < 20s, `NEAR_30S` ≥ 20s, `OVER_30S` ≥ 30s.

**GM (pilot):** G-code and `manufacturing.generateSolid` **stay on Render**. No synchronous long routes on AppSail. Submit-then-poll is scoped in [async-jobs.md](./async-jobs.md) only — not built.

## Finding

**`POST /manufacture` with `output_type=gcode` on a production-density mesh does not fit in AppSail’s 30s.** It **does** fit a 15-minute Catalyst Job/Event/Cron clock (~194 s) but **not** the 512 MB function memory / zip runtime. Keep Render.

- Measured **1.608 s/layer** belt-wall slice on `tests/fixtures/Default.glb` (85,759 faces, 43,699 verts).
- After a 45° belt transform that mesh spans **35.7 mm** in Z → **~119 layers** at 0.3 mm → **~194 s** estimated G-code. **OVER_30S**.
- The approved plan’s **procedural wall reconstruct is ~25 s per foot in the preview**. That path is the **browser geometry worker today** (not AppSail), but it is **NEAR_30S** and would fail the timeout if it were moved server-side as a synchronous request.
- Coupon / low-face solids are fine (measured **7 ms** end-to-end G-code on the 40×40×6 STL). Do not treat the coupon number as production.

`httpx` in `stl_loader.py` uses a **120 s** download timeout, which is already longer than AppSail’s request limit. A slow signed-URL fetch of a large STL will lose the race even before slicing starts.

`fetch()` in `callManufacture` has **no AbortSignal**. The Node AppSail request waits for Python; if either side hits 30s the browser sees a failed `manufacturing.generateSolid`.

## Endpoint table

| Endpoint | Role | Time | Flag | Source |
| --- | --- | --- | --- | --- |
| `GET /health` | liveness | ~2 ms | OK | constant JSON |
| `POST /manufacture` `output=stl` (40×40×6 coupon) | validate + return STL | **3 ms** | OK | measured |
| `POST /manufacture` `output=gcode` (coupon, 1.0 mm layers) | belt + slice + emit | **7 ms** | OK | measured |
| `POST /manufacture` `output=gcode` (subdivided 250×90×12, 12,288 faces, 0.3 mm) | one-foot proxy | **~8.2 s** (57 × 108 ms) | OK | measured per-layer, estimated total |
| `POST /manufacture` `output=gcode` (`Default.glb` density, 0.3 mm) | production-like | **~194 s** (119 × 1.608 s) | **OVER_30S** | measured per-layer, estimated total |
| `POST /manufacture` `output=gcode` (two feet in one request) | pair | 2× one-foot | **OVER_30S** at production density | estimated |
| Preview procedural wall reconstruct (per foot) | client worker | **~25 s** | **NEAR_30S** | plan / preview figure |
| `manufacturing.prepareManufacturingStlUpload` | tRPC → Supabase signed upload | ~0.4 s | OK | estimated (Storage RTT) |
| `manufacturing.uploadManufacturingStl` | tRPC inline ≤8 MB | ~1–5 s | OK | estimated |
| `manufacturing.generateSolid` | tRPC → `/manufacture` + charge RPC + Storage put | Python time + ~1–3 s | **OVER_30S** when Python G-code is | estimated wrap |
| `manufacturing.getGcodeDownloadUrl` | tRPC signed GET | ~0.3 s | OK | estimated |

Related, not manufacturing compute:

| Call | Typical | Flag vs 30s |
| --- | --- | --- |
| `export.authorize` | Postgres RPC only; file is client-side | OK |
| `ai.parsePrescription` | Anthropic/xAI round-trip, usually 2–10 s | OK unless the provider stalls |
| `library.*` / `stock.*` GLB upload | Supabase Storage | OK if the object is small; large admin GLBs can approach the limit |

## Stage measurements (supporting)

| Stage | Mesh | Measured |
| --- | --- | --- |
| STL load + watertight repair | coupon 12 faces | 3 ms |
| `apply_belt_transform` 45° | coupon | 1 ms |
| `apply_belt_transform` 45° | 12,288-face box | 31 ms |
| `apply_belt_transform` 45° | Default.glb 85,759 faces | 224 ms |
| `slice_belt_layer_contours` one layer | coupon | <1 ms |
| same | 12,288-face box | 108 ms |
| same | Default.glb | **1.608 s** |
| `slice_belt_layer_contours` one layer | procedural 250 mm / 1,008 faces | 7 ms |

`Default.glb` is the production stock-base mesh (not a finished watertight manufacturing STL). It is the best in-repo stand-in for face count. A finished insole STL is the same order of magnitude or denser after client export; treat **~194 s** as the conservative G-code number, not the coupon **7 ms**.

## Pilot decision and later options

**This pilot:** keep G-code / `generateSolid` on **Render**. Do not deploy `python-service` to AppSail. Do not add sync long routes on AppSail. Wall reconstruct stays in the browser worker.

Later options (see [async-jobs.md](./async-jobs.md); **do not implement here**):

1. Submit-then-poll, worker still on Render (or a Job Scheduling webhook to Render).
2. Catalyst Job function — 15 min timeout would cover ~194 s, but 128–512 MB and no OCI image do not match this slicer.
3. Job Scheduling → AppSail `/manufacture` — still a 30 s HTTP request. Reject.
4. Split / decimate — quality risk; not the pilot path.

Until an async path exists, AppSail is only for **hosting proof** (Slate + optional short routes).
