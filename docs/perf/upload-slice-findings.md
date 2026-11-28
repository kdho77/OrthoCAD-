# Upload, slice, and download — where the time goes

Measured 2026-11-28 on this host (Node v22.23.4, Linux). Fixture: bundled `vertex/public/Templates/SAMPLE_Top.glb`, Men's US 9, procedural solid, belt print. Numbers are in `scripts/perf/upload-slice-benchmark.last.json`. Re-run with `node scripts/perf/run-upload-slice-benchmark.mjs`.

## Summary

After the solid exists, OrthoCAD's own work is about **a third of a second per foot**. The leader, the gzip upload body, the server mesh check, and the handedness scan are all in that budget. A loopback copy of the gzipped STL (2.3 MB) was 7 ms, and a loopback copy of an 8 MB stand-in for G-code was 12 ms. The bytes are not the wait.

The wait is **one Orca process per foot, and the pair runs one after the other**. The Print/Export click builds a binary STL, appends the 80-triangle leader, gzips it, and PUTs it to Supabase. The Vercel function (300 s budget) downloads that object, gunzips it, and POSTs the raw STL to VertexSlice `POST /v1/slice`. That call sits on a **single worker thread**. Apex Core (the clinical default) then runs one `orca-slicer` subprocess and four Python post-process programs. The G-code comes back through the Vercel function, is uploaded to Supabase again, and the browser downloads it from a signed URL. UI G-code stays in the bucket until the 24 h sweep.

This machine has no Orca binary and no `VERTEXSLICE_SLICER_URL`, so the slice itself was not timed. The only hard number in the slicer is the gateway cutoff. Railway's edge closes `/v1/slice` at 270 s (HTTP 499). The chain stops the slicer earlier so the edge can still return an error. The error text records an Apex Light right foot that was still inside the slicer when that cutoff hit. Apex Core uses the same stop. A pair on one worker is two slices, back to back.

Near-instant, as in the click returning in under a second, is possible only if the slice has **already finished** when the user clicks. Compression, skipping storage, and running the Python stages in-process save seconds. Two warm workers turn a pair from two slices into one. Starting that pair when the Print tab opens, holding the G-code in memory, and streaming it straight to the browser is the path that makes the click feel instant, and it stores nothing at rest.

The solid build is out of scope here. On this run it was 7.4 s (left) and 7.3 s (right) with no elements, and 7.7 s / 8.6 s with a 3 mm Morton's extension on both feet. A separate agent owns that stage.

## What the click does today

Clinical Export of a belt pair (`exportClinicalPrinterGcode`) starts both feet with `Promise.all`. Each foot calls `generateHybridGcode`:

1. **STL.** `buildPrinterFootManufacturingStl` → `buildExportStl` (solid, close, validate, `geometryToBinarySTL`). Binary STL is already the format. ASCII STL is not on this path.
2. **Leader.** `applySacrificialLeaderBlock` appends 80 triangles (bridge + block). The insole triangles are unchanged. This is mesh, not a G-code edit.
3. **Stamp.** `stampSingleFootStl` writes `OrthoCAD single-foot left|right` into the 80-byte header.
4. **Upload prep.** `buildManufacturingUploadBody` gzips when the buffer is over 64 KB, gunzips to check the SHA-256, and falls back to raw bytes if gzip does not shrink.
5. **Signed PUT.** `prepareManufacturingStlUpload` then a browser PUT to Supabase (`manufacturing-temp/…`). The temp key is deleted after the slice, on failure, or by the 24 h sweep. Nothing is copied to `manufacturing-archive`.
6. **`manufacturing.generateSolid`.** License, design access, token balance, a signed download of the temp object, gunzip, optional regional 3MF, `prepareManufacturingMeshForSlice` (no rewrite under 132,000 triangles), `GET /v1/materials`, then `POST /v1/slice`.
7. **Slice.** VertexSlice queues the request on one thread (`SliceJobQueue._loop`, thread name `slice-job-worker`). Apex Core (`apex_core`, profile `apex-v2-insole-95a`, the clinical default) first runs `prepare_orthocad_insole_stl` (belt, toe-first, X center 140 mm), then one `slice_apexcore_g2b.py` — the Y offset is locked at −1.146, so there is no probe slice — then `postprocess_g2b.py match`, `pullback_v2.py`, `topfix_apexcore.py`, and `check_gcode.py` as separate processes. Apex Light is one Orca call inside `h_curaE.py` (`VS_FORCE_OFFSET` skips the probe) and then in-process post.
8. **Handedness.** `assertGcodeHandedness` reads the G-code and refuses a mismatch. It does not rewrite the file.
9. **Charge, store, sign.** The function uploads the G-code to `gcode/…`, writes the key onto the export and production rows, and returns a signed URL. The inline `gcode` field is omitted whenever that URL exists.
10. **Download.** The browser fetches the signed URL and saves the file. The object remains until the sweep so the URL keeps working.

Name engraving is not a G-code post-process. `applyExportText` cuts the name into the solid before the STL is written. The default design in this benchmark has no `textMarking`, so that step did not run. The leader and the engraving orientation stay correct only if the same mesh and the same VertexSlice chain run. This plan does not change either.

CAD-operator exports already try `POST /v1/slice/jobs` and poll. The human Print/Export path does not. It holds the Vercel function open for the whole slice.

## Baseline timings

Solid times are one sample each. Post-solid times are the median of five runs after one warmup. VertexSlice was not called.

### Local end-to-end, solid included (context)

| Case | Left | Right | Pair, one after the other |
| --- | ---: | ---: | ---: |
| Default SAMPLE_Top | 7,359 ms | 7,325 ms | 14,684 ms |
| Morton's extension, 3 mm, both feet | 7,654 ms | 8,581 ms | 16,235 ms |

`Promise.all` of the two default feet took 13,881 ms, and each foot's own timer also read ~13.9 s. `Worker` is `undefined` in this headless runtime, so the two lofts shared the main thread. The browser pool is two workers (`EXPORT_SOLID_WORKER_POOL_SIZE`). That overlap was not measured here.

| | Left triangles | Left STL | Right triangles | Right STL |
| --- | ---: | ---: | ---: | ---: |
| Default | 110,308 | 5,515,484 B | 111,116 | 5,555,884 B |
| Morton's 3 mm | 111,548 | 5,577,484 B | 111,428 | 5,571,484 B |

Morton's adds about 1.5 s and about a thousand triangles to the pair. It does not change the upload shape.

### After the solid exists (default left foot)

| Stage | Time | Size |
| --- | ---: | --- |
| Leader append (80 triangles) | 150 ms | 5,515,484 → 5,519,484 B |
| Header stamp | 5 ms | same length |
| gzip (zlib) | 80 ms | 2,347,596 B (57% smaller) |
| gunzip | 13 ms | back to 5,519,484 B |
| zstd compress | 19 ms | 1,956,037 B |
| zstd decompress | 5 ms | |
| Client upload body (gzip, gunzip, two SHA-256s) | 148 ms | gzip, `Content-Encoding: gzip` |
| Server mesh gate | 5 ms | same bytes, 110,388 triangles (110,308 + 80) |
| Handedness scan, compact fixture (1.09 MB) | 27 ms | not a full toolpath |
| Handedness scan, fixture repeated to 8 MB | 241 ms | linear in file size |
| Loopback PUT+GET of the gzipped STL | 7 ms | 2.3 MB |
| Loopback PUT+GET of an 8 MB buffer | 12 ms | stand-in, not real G-code |

The mesh gate rewrites only above 132,000 triangles. This foot is under that line, which is the range the code comment calls "a few seconds" inside Orca. That comment and the 260 s production cutoff are both in the tree. They describe different failures. This run did not decide which one a live Apex Core slice hits.

### Not measured, and why it dominates

| Stage | What the code does | Bound we have |
| --- | --- | --- |
| Supabase PUT of the gzipped STL | Browser → `manufacturing-temp` | 2.3 MB. Loopback was 7 ms, so the cost is the network, not the copy. |
| Vercel cold start + license, design access, balance | Before the slicer is contacted | Function budget 300 s. Round trips not timed. |
| Server GET + gunzip | `downloadManufacturingStl` then `decodeManufacturingUploadBytes` | Gunzip of this file is 13 ms. |
| `GET /v1/materials` | Every slice, before the POST | One HTTPS round trip. |
| POST of the **raw** 5.5 MB STL | Gzip is undone before `buildSliceForm` | The supabase hop saved 3.2 MB. The slicer hop sends all of it again. |
| Queue | `SliceJobQueue`, one thread per process. Sync `/v1/slice` and job `/v1/slice/jobs` share it. | A pair that arrives together waits. The second foot starts when the first Orca exits. |
| Container cold start | `railway.json` has a health check and no minimum instance. Image is Orca + GTK + WebKit. | Health check is allowed 300 s. Sleep-to-wake was not timed. |
| Orca | New subprocess every slice, not a resident daemon. Apex Core: belt prep, one slice, then four Python processes. | The chain's own error text: an Apex Light right foot was still inside the slicer when the 270 s edge closed the connection. Apex Core uses the same stop. Not timed here. |
| G-code post | In VertexSlice, not OrthoCAD. OrthoCAD only classifies the foot. | Handedness at 8 MB is 241 ms. The Python stages were not timed on a real toolpath. |
| G-code storage + download | Upload, signed URL, browser GET. UI object lives until the 24 h sweep. | A real insole G-code was not on disk. An 8 MB loopback copy is 12 ms. |

Existing unit tests, 71 of them in 9 files, passed again at 2026-11-28T00:54:14Z (5.7 s): `vertexslice-client`, `slice-mesh`, `gcode-handedness`, `manufacturing-session`, `manufacturing-stl-lifecycle`, `leader-block`, `manufacturing-stl-upload`, `vertexslice-gcode-path`, and `pair-gcode-isolation`. They mock the slicer. They do not time it.

## The six ideas

`T` is one warm Orca slice of one foot. It was not measured. It is the thing that has reached 260 s. Everything else below is measured or is a few network round trips on a 2.3 MB body.

### 1. Start the pair when the Print tab opens

Hold both results in the slicer process. On click, stream the bytes to the browser and drop them. Re-slice if the design fingerprint changes. Charge when the file is delivered, not when the speculative job starts.

- **New total:** the click is a handoff, about the 0.3 s of local work plus a download, when the tab has been open for one `T`. A click on a cold tab still waits one `T` (with two workers) instead of two.
- **Risk:** medium. A wasted slice if they never export. A stale slice if the fingerprint check is wrong. G-code stays identical because it is the same chain. The bytes must live only in memory and must be deleted on download, cancel, or edit. That matches "no G-code at rest" more closely than the 24 h object.
- **Cost:** CPU on the Railway box already in use. No new vendor.
- **Effort:** medium.
- **Files:** `vertex/src/features/exports/export-panel-clinical.ts`, `vertex/src/features/exports/export-service.ts`, the Print step that mounts that call, `vertex/server/src/routers/manufacturing-session.ts`, `vertex/server/src/lib/vertexslice-client.ts` (the job API is already here). Worker count is `server/jobs.py` in kdho77/VertexSlice.

### 2. Keep the slicer warm and run left and right together

`SliceJobQueue._loop` is one thread. `exportClinicalPrinterGcode` already fires both feet together, and the server still slices them in order. Orca's own startup is inside every `T` (new process, resources, offscreen Qt). The extra cold start is the container, if Railway sleeps it.

- **New total:** one `T` for the pair, plus today's network, instead of two `T`. Removes the sleep-to-wake in front of the first slice.
- **Risk:** low for the G-code (same binary, same chain). The box needs memory for two Orca processes during a pair.
- **Cost:** the existing service stays up. A second worker is RAM on that service, not a second bill.
- **Effort:** small on the queue. Confirming the service does not sleep is a Railway setting (`railway.json` does not set one).
- **Files:** VertexSlice `server/jobs.py`, `server/app.py`, `railway.json`. OrthoCAD's pair call is already parallel.

### 3. Return the G-code in the response and skip storage

`runSessionGenerateSolid` uploads the G-code and then hides the inline string. The browser downloads what the function already held. The temp STL is deleted; the G-code is not, until the sweep.

- **New total:** two `T` (still one worker) plus about a second of handoff instead of a supabase PUT and a signed GET. A multi-megabyte string inside the tRPC JSON is how the STL path hit "Request Entity Too Large". The return path has to be a binary or streamed body, which `readGcodeFromSignedUrl` can be pointed at.
- **Risk:** low if the body is not JSON. The handedness check still runs before anything is sent. Delete on the way out so a retry rebuilds from the design, which is the rule already.
- **Cost:** none.
- **Effort:** medium.
- **Files:** `vertex/server/src/routers/manufacturing-session.ts`, `vertex/server/src/lib/storage.ts`, `vertex/src/features/exports/export-service.ts` (`generateHybridGcode`, `readGcodeFromSignedUrl`).

### 4. Send the mesh straight to the slicer, compressed

The STL is already binary. Gzip already runs on the browser→Supabase hop (measured: 5.52 MB → 2.35 MB in 148 ms including the check). zstd is smaller (1.96 MB) and faster (19 ms) but Supabase is sent `Content-Encoding: gzip` only. The server gunzips and POSTs the raw STL. 3MF is the regional-hardness package, not a faster mesh.

- **New total:** two `T` plus about a second. Dropping the temp object removes one signed-URL round trip, one 2.3 MB PUT, and one GET. The slicer still receives 5.5 MB unless VertexSlice accepts gzip or zstd. That is a small VertexSlice change (`server/app.py` `_read_upload`), and the mesh bytes after decompression must be the same buffer Orca sees today.
- **Risk:** low for the toolpath if the decompressed bytes match. The browser must not see `VERTEXSLICE_API_KEY`. A short-lived upload token, which `prepareManufacturingStlUpload` already mints for Supabase, is the same shape pointed at the slicer.
- **Cost:** none.
- **Effort:** medium.
- **Files:** `vertex/src/features/exports/manufacturing-stl-upload.ts`, `vertex/src/features/exports/export-service.ts`, `vertex/server/src/routers/manufacturing-session.ts`, `vertex/server/src/lib/vertexslice-client.ts` (`buildSliceForm`). VertexSlice `server/app.py`.

### 5. Run the Apex Core post-process in the same process

The long stage is Orca. After it, Apex Core starts four Python processes and writes the G-code to disk between them (`raw` → `matched` → `pulled` → `final`). Apex Light already does its post in-process.

- **New total:** still two `T`. The saving is process startup and three full-file writes, on the order of a second or a few seconds per foot. Not measured on a production toolpath. An 8 MB scan in OrthoCAD was 241 ms, which is the shape of these passes.
- **Risk:** low only with a byte match against the locked Apex Core golden (`slice_apexcore_g2b.py` records the printed SHA-256). Same functions, called in-process.
- **Cost:** none.
- **Effort:** small, and it is in VertexSlice.
- **Files:** `server/chains/apex_core.py`, `scripts/g2b_heelmod/postprocess_g2b.py`, `pullback_v2.py`, `topfix_apexcore.py`, `check_gcode.py`.

### Browser slicer (WASM or a worker)

Evaluated and not in the five. Orca is a C++ application linked with the GUI library. The G-code OrthoCAD ships is that binary plus the locked Apex Core chain (match, pullback, topfix, check). A WASM build would still take one slice — often longer than native — and a port of the chain is where the printed file would drift. Upload time would go to zero. The click would not become instant. No vendor cost, and a large amount of work, in a new client slicer plus the VertexSlice chain. The leader is the reason local Kiri is already refused (`export-service.ts`: "Local slicing is disabled so the leader block is not dropped.").

## Recommended path

Do these in order. Each one leaves the G-code bytes on the same chain.

1. **Two workers, service left running.** Pair wall-clock becomes one slice. No new vendor. This is `server/jobs.py` and the Railway service.
2. **Start that pair when Print opens.** Key it by the design fingerprint. Keep it in memory. On click, stream it and delete it. If they edit, drop it and start again. Charge on delivery.
3. **Stop using Supabase as the shuttle.** The function that already has the STL should not download it from itself, and the G-code should not be stored so the browser can download it. A streamed response does both, and it matches the rule that G-code goes to the browser or to VertexOrders and is then deleted.

Steps 4 and 5 (zstd on the wire, in-process post) are worth doing in the same change only because they are small. They are not how the click gets fast.

What "near instant" means after that: if the person has been on Print longer than one slice, the download starts immediately and the local work left is the leader and the upload body they already paid while the solid was building (~0.3 s). If they export the moment the solid appears, they wait **one** slice, not two, and they do not wait for a cold container or a storage round trip. Getting under a second with a cold slicer would mean a different slicer, which changes the locked file. That is the wrong trade.
