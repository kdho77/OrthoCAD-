# Stream-download gates (frozen)

Independent gates for the belt pair download. Product code is read-only. These files are the gate. They are frozen in the commit that adds them, before the candidate commit is graded. Do not edit them after that commit. `RESULTS.md` is the grade, written after the frozen gates run.

BASE is `da317e858655aa0f4c0d69b24ce25b4ba690959e`. The candidate is graded later and is not an input to these thresholds.

## What is measured

A 2-foot belt export calls the real `exportClinicalPrinterGcode` path. Geometry upload is the real leader plus single-foot stamp. The VertexSlice mutate is a deferred promise per foot, so foot 1 can finish while foot 2 is still pending. Browser download means an anchor `click` whose blob text is the server G-code bytes.

Fixture filenames are `Stream_Gate_ApexCore_L.gcode` and `Stream_Gate_ApexCore_R.gcode`. The fixture names are not a patient.

## Gates

| Id | Threshold | Unchanged main | Broken copy |
| --- | --- | --- | --- |
| G_T1_STREAM / ONE | earlyLeft >= 1, earlyRight == 0, early blob equals `;gate-left\n`, slicesStarted == 2, foot 2 still pending | Fails. Measured earlyLeft is 0. | A copy that downloads inside the foot callback passes. A hold-until-both trace fails the judge. |
| G_T2_PARTIAL | ok is false, earlyLeft >= 1, reason has no "No files were downloaded", and the reason reports the left foot downloaded and the right foot failed | Fails. Main still says "No files were downloaded" and earlyLeft is 0. | The judge rejects that main phrase. |
| G_T3_SINGLE_LEFT | one left download, filename and G-code bytes and leader STL and slice JSON match | Passes | A tampered G-code blob fails G_BYTES_SINGLE |
| G_T3_SINGLE_RIGHT | one right download, same byte rules | Passes | Same tamper |
| G_T3_CANCEL_BEFORE | 0 downloads, 0 slices, cancelled, reason exactly `Export cancelled. No G-code was downloaded.` | Passes | — |
| G_T3_CANCEL_INFLIGHT | abort flips on while both slices are pending; 0 downloads; same cancel reason | Passes | — |
| G_BYTES_PAIR | pair G-code, filenames, leader STL, and slice JSON byte-match the golden file; upload triangles 104 > raw 24 on each foot | Passes | Appending bytes to the G-code blob fails |
| G_BYTES_SINGLE | same rules for the omitted-feet left export | Passes | Same tamper |
| G_R1_SURFACE | 0 changed lines under `vertex/src/lib/geometry`, `vertex/src/lib/kiri`, and `vertex/src/lib/hardness` | Passes | A comment in `leader-block.ts` fails |
| G_R2_SEAMS | 0 changed lines under kiri and geometry, and 0 added diff lines matching seam / layer-change / z-seam | Passes | The same leader comment fails the geometry count |
| G_R3_SCOPE | every product path changed vs BASE is one of `export-panel-clinical.ts`, `export-service.ts`, `export-panel-clinical.test.ts` | Passes | The leader file is disallowed |
| G_R4_SECRETS | 0 added lines that assign a secret | Passes | A planted `api_key = "..."` line fails the scanner |
| G_R4_PHI | 0 added lines with an email, phone, or SSN | Passes | A planted email fails the scanner |
| G_R4_RAILWAY | 0 changed paths naming vertex-web, vertex-api, or railway | Passes | — |
| G_R4_MAIN | `git rev-parse main` equals BASE | Passes | — |
| G_R5_SPANS | 0 character delta on STL, 3MF, leader call, filename, engraving-name, and `generateSolid.mutate` payload spans. The `deferDownload` call line is the handoff and is not part of the payload span. | Passes | A comment inside `buildPrinterFootManufacturingStl` fails |
| G_MUST_ENGRAVE | 0 changed lines under `vertex/src/lib/geometry/text-marking` | Passes | — |
| G_MUST_LEADER_FILE | 0 changed lines in `leader-block.ts` | Passes | The leader comment fails |
| G_EXISTING_TESTS | rstest exit code 0 on the 17 export test files listed in `run-gates.mjs` | Passes | Flipping one `toBe(true)` to `toBe(false)` in the clinical test exits non-zero |

`golden-slice.json` is the frozen slice-request document from unchanged main: preset `apex-v2-insole-95a`, material `apex_core`, belt angle 45, rounded grinding radius 3, gyroid Medium, empty zones, and the fixture filenames.

## Run

From the repo root:

```bash
node validation/stream_download_gates/run-gates.mjs --mode noop
node validation/stream_download_gates/run-gates.mjs --mode controls
node validation/stream_download_gates/run-gates.mjs --mode grade --root <checkout>
```

`noop` must agree with the "unchanged main" column. `controls` mutates throwaway worktrees only. `grade` writes a JSON report and does not edit these gates.
