# Stream-download grade

Candidate `f1a412badbff4b66beb4d408c6e65a588006c2c8` (PR #415) graded with gates frozen at `83d88b15d84b746c2c016b9d7beef4bcc9fc8f07`. BASE is `da317e858655aa0f4c0d69b24ce25b4ba690959e`. The gate files were not edited after that freeze.

Foot 1's browser download does start before foot 2 finishes. The partial-failure sentence misses the frozen wording threshold. The candidate tree is also not current main: its parent is `268aac85`, four commits behind BASE, so geometry and engraving files differ from main even though the worker commit itself edits only the three export files.

## Candidate vs threshold

| Gate | Threshold | Measured on candidate | Result |
| --- | --- | --- | --- |
| G_T1_STREAM and ONE | earlyLeft >= 1, earlyRight == 0, early blob equals `;gate-left\n`, slicesStarted == 2, foot 2 still pending | earlyLeft=1, earlyRight=0, bytes match, slicesStarted=2, foot2Pending=true, file `Stream_Gate_ApexCore_L.gcode` | PASS |
| G_T2_PARTIAL | ok is false, earlyLeft >= 1, reason has no "No files were downloaded", and the reason matches left/foot 1 plus download, and right/foot 2 plus fail | ok=false, earlyLeft=1, downloads=[`Stream_Gate_ApexCore_L.gcode`], reason=`Right G-code failed after Stream_Gate_ApexCore_L.gcode downloaded. Server manufacturing request failed` | FAIL |
| G_T3_SINGLE_LEFT | one left file, leader STL, G-code bytes, slice JSON | downloadCount=1, filename match, gcodeMatch=true, uploadMatch=true, uploadTriangles=104, rawTriangles=24, sliceMatch=true | PASS |
| G_T3_SINGLE_RIGHT | one right file, same byte rules | downloadCount=1, filename match, gcodeMatch=true, uploadMatch=true, 104 > 24, sliceMatch=true | PASS |
| G_T3_CANCEL_BEFORE | 0 downloads, 0 slices, reason exactly `Export cancelled. No G-code was downloaded.` | downloads=0, slicesStarted=0, cancelled=true, reason matches | PASS |
| G_T3_CANCEL_INFLIGHT | abort while both slices are pending; 0 downloads; same reason | downloads=0, slicesStarted=2, cancelled=true, reason matches | PASS |
| G_BYTES_PAIR | 0 G-code mismatches, 0 upload mismatches, 0 filename mismatches, slice JSON equals golden, no foot missing a leader | mismatches 0/0/0, sliceMatch=true, feetWithNoLeader=0, triangles 104 and 104 vs raw 24 and 24 | PASS |
| G_BYTES_SINGLE | same byte rules for the omitted-feet left export | mismatches 0/0/0, sliceMatch=true, feetWithNoLeader=0 | PASS |
| G_R1_SURFACE | 0 changed lines in geometry + kiri + hardness | 256 changed lines, all under geometry: `narrow-heelcup-preloft.test.ts` 155, `sample-top-preview.ts` 56, `text-marking/gates.ts` 45. kiri and hardness are 0. | FAIL |
| G_R2_SEAMS | 0 geometry/kiri lines and 0 added seam or layer-change lines | geometryAndKiriChangedLines=256, seamOrLayerAddedLines=0 | FAIL |
| G_R3_SCOPE | product paths that differ from BASE are only the three export files | 15 disallowed paths (18 changed, 3 allowed) | FAIL |
| G_R4_SECRETS | 0 secret assignments on added lines | secretAssignments=0, addedLines=219 | PASS |
| G_R4_PHI | 0 emails, phones, or SSNs on added lines | phiLines=0 | PASS |
| G_R4_RAILWAY | 0 paths naming vertex-web, vertex-api, or railway | railwayPaths=[] | PASS |
| G_R4_MAIN | `git rev-parse main` equals BASE | mainSha=`da317e85…`, baseSha=`da317e85…` | PASS |
| G_R5_SPANS | 0 character delta on STL, 3MF, leader call, filename, and `generateSolid.mutate` spans | compared=27, mismatches=0 | PASS |
| G_MUST_ENGRAVE | 0 lines under `text-marking` | `text-marking/gates.ts` changedLines=45 | FAIL |
| G_MUST_LEADER_FILE | 0 lines in `leader-block.ts` | changedLines=0 | PASS |
| G_EXISTING_TESTS | rstest exit code 0 on 17 export test files | exitCode=0, files=17, report listed 62 tests and no failures | PASS |

G_T2 meets every clause except the left-foot word. The sentence does not say "No files were downloaded". It says the right foot failed and names `Stream_Gate_ApexCore_L.gcode` as downloaded. The frozen judge also requires the substring `left` or `foot 1`. That substring is absent (`_L` is not `left`), so the gate fails.

## Why the tree gates fail

`git diff f1a412^ f1a412 --name-only` is only:

- `vertex/src/features/exports/export-panel-clinical.ts`
- `vertex/src/features/exports/export-service.ts`
- `vertex/src/features/exports/export-panel-clinical.test.ts`

The parent of `f1a412` is `268aac85847160b5b2703a05688721ea4cb93b24`. That parent is an ancestor of BASE, and BASE is four commits ahead of it. The frozen gates compare the candidate tree to BASE (`git diff da317e85` in the candidate checkout). That two-dot diff is 18 files, 219 insertions and 1874 deletions, including geometry and `text-marking/gates.ts`. Those files are the commits on main that this SHA does not contain, including the bottom-name engraving fix and the pre-loft geometry fix. kiri, hardness, and `leader-block.ts` contribute 0 lines.

## Unchanged main, before the freeze

Command: `npx rstest --config validation/stream_download_gates/rstest.config.ts` and `node validation/stream_download_gates/source-gates.mjs` on BASE.

| Gate | Measured on BASE | Expected |
| --- | --- | --- |
| G_T1_STREAM | earlyLeft=0, earlyRight=0, slicesStarted=2, foot2Pending=true | Fails. Main holds the first file. |
| G_T2_PARTIAL | earlyLeft=0, reason contains `No files were downloaded` | Fails. Main still uses that sentence. |
| G_T3_SINGLE_LEFT / RIGHT | filenames `Stream_Gate_ApexCore_L.gcode` and `_R`, gcodeMatch, uploadMatch, 104 > 24, sliceMatch | Pass |
| G_T3_CANCEL_BEFORE / INFLIGHT | 0 downloads, exact cancel reason | Pass |
| G_BYTES_PAIR / SINGLE | 0 mismatches, sliceMatch | Pass |
| G_R1 through G_R5, engraving, leader | source gates `failed: []` | Pass |
| G_EXISTING_TESTS | 17 files, 61 tests, exit 0 | Pass |

Proofs, still on unchanged main, before the freeze:

- Stream judge accepts a trace with earlyLeft=1 and rejects a hold-until-both trace.
- Partial judge accepts `Left downloaded. Right failed.` and rejects `No files were downloaded`.
- A throwaway copy that calls `downloadNamedBlobs` as each foot returns: earlyLeft=1, earlyRight=0, G_T1 pass.
- A throwaway copy that appends bytes to the G-code blob: pair gcodeMismatches=2, G_BYTES_SINGLE fail.
- A comment inside `buildPrinterFootManufacturingStl`: span mismatches=1.
- A comment at the end of `leader-block.ts`: surface changedLines=2, disallowed=1, leader gate fail.
- Planted `api_key = "supersecretvalue"` and a planted email fail the scanner. A plain `deferDownload` line does not.
- Flipping one `toBe(true)` to `toBe(false)` in the clinical test: rstest exit 1.

## Commands

```bash
npx rstest --config validation/stream_download_gates/rstest.config.ts
node validation/stream_download_gates/source-gates.mjs
node validation/stream_download_gates/run-gates.mjs --mode controls
npx rstest --config rstest.config.ts <17 export test files>
node validation/stream_download_gates/run-gates.mjs --mode grade --root /tmp/grade-candidate-f1a412
```

Output that might contain secrets was filtered with a case-insensitive `api_key|token|bearer` drop. None of the recorded measurements matched.

## Rule-compliance report

R1 (2026-11-20 12:59 PM MT): "print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality."

FAIL. G_R1_SURFACE measured 256 changed lines against a threshold of 0. Command: `git diff --numstat da317e858655aa0f4c0d69b24ce25b4ba690959e -- vertex/src/lib/geometry vertex/src/lib/kiri vertex/src/lib/hardness`. The lines are `narrow-heelcup-preloft.test.ts`, `sample-top-preview.ts`, and `text-marking/gates.ts`. kiri is not in that file list.

R2 (2026-11-20 11:38 AM MT): "seams and layer changes must always be on the bottom (plantar/belt face)."

FAIL. G_R2_SEAMS measured geometryAndKiriChangedLines=256 against a threshold of 0. seamOrLayerAddedLines=0, which meets that half of the threshold. Command: `git diff -U0 da317e858655aa0f4c0d69b24ce25b4ba690959e -- vertex/src/lib/kiri vertex/src/lib/geometry`.

R3 (2026-11-21 8:41-8:45 PM MT): "slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions."

FAIL. G_R3_SCOPE measured 15 disallowed paths against a threshold of an empty disallowed list. Command: `git diff --name-only da317e858655aa0f4c0d69b24ce25b4ba690959e -- . ':(exclude)validation/stream_download_gates'`. The worker commit's own name-only diff is the three allowed export files. The candidate tree still differs from BASE on the other 15 paths because the branch point is four commits behind.

R4 Security: "never print secrets (filter output through grep -v -i \"api_key\\|token\\|bearer\"); no PHI; never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes."

PASS. G_R4_SECRETS secretAssignments=0. G_R4_PHI phiLines=0. G_R4_RAILWAY railwayPaths=[]. G_R4_MAIN `git rev-parse main` = `da317e858655aa0f4c0d69b24ce25b4ba690959e`. This grade did not push main, did not deploy, and did not write a database.

R5: "do not change geometry, STL building, leader block, text engraving, hardness, or VertexSlice request payloads. Only change when each completed foot's file is handed to the browser download."

FAIL. G_R5_SPANS compared=27 mismatches=0, and the byte harness sliceMatch=true with 0 G-code and upload mismatches, and `leader-block.ts` changedLines=0. G_MUST_ENGRAVE measured 45 changed lines in `text-marking/gates.ts` against a threshold of 0. That engraving file is part of the same behind-main tree delta.

PUSH: "new branch cursor/stream-download-gates-1123 (from BASE) -> ONE draft PR \"[GATES ONLY - DO NOT MERGE] stream-download gates\". Never push to the worker branch; never push/merge main, deploy, Railway (never touch vertex-web / vertex-api or #310), printers, production orders."

PASS for this grade's git operations once that draft PR exists and the only push is `cursor/stream-download-gates-1123`. The worker branch was not pushed. main was not pushed.

FILES: "validation/stream_download_gates/** only (new); read-only everything else - do not modify product code or the worker's tests - don't explore beyond. Worker changed only vertex/src/features/exports/export-panel-clinical.ts, vertex/src/features/exports/export-service.ts, and vertex/src/features/exports/export-panel-clinical.test.ts."

PASS for this grade. The freeze commit and this results file are only under `validation/stream_download_gates/`. Product files in this checkout match BASE. The worker commit's own diff is those three files.

MUST-MATCH: "exported STL/3MF/G-code bytes, filenames, leader block, patient name engraving, and slice request fields are byte-identical to current main; single-foot exports behave identically. No geometry or surface-quality regression."

FAIL. G_BYTES_PAIR and G_BYTES_SINGLE pass (G-code text `;gate-left\n` / `;gate-right\n`, filenames `Stream_Gate_ApexCore_L.gcode` and `Stream_Gate_ApexCore_R.gcode`, upload bytes equal leader+stamp, slice JSON equals `golden-slice.json`). G_MUST_LEADER_FILE passes at 0 lines. Single-foot gates pass. G_MUST_ENGRAVE fails at 45 lines, and G_R1_SURFACE fails at 256 lines, so engraving and geometry are not identical to current main on this SHA.

TESTS: "(1) on a 2-foot belt G-code export where foot 1 resolves before foot 2 (controlled deferred promises), foot 1's browser download triggers immediately upon foot 1 completing, before foot 2 resolves; (2) if foot 2 fails after foot 1 already downloaded, the returned outcome clearly reports foot 1 downloaded and foot 2 failed (does not claim \"No files were downloaded\"); (3) single-foot export and cancelled export before any foot finishes still work as before; exported STL/G-code bytes stay identical to main; existing export tests green"

(1) PASS. earlyLeft=1, earlyRight=0, early blob equals `;gate-left\n`, foot 2 still pending.
(2) FAIL. earlyLeft=1 and the reason avoids "No files were downloaded", and it names the downloaded file, but it does not contain `left` or `foot 1`. Threshold requires that substring.
(3) PASS. G_T3_SINGLE_LEFT, G_T3_SINGLE_RIGHT, G_T3_CANCEL_BEFORE, G_T3_CANCEL_INFLIGHT, G_BYTES_PAIR, G_BYTES_SINGLE, and G_EXISTING_TESTS all pass.

ONE: "When exporting a pair of belt G-code files in the browser, start downloading each foot's G-code file as soon as that foot finishes slicing instead of holding the first file until both feet complete."

PASS. Same measurement as G_T1_STREAM: the left file's anchor click happens after foot 1's deferred slice resolves and before foot 2 resolves. earlyLeft=1, earlyRight=0.

## Hard prohibition

This grade did not change the outer surface, seams, layer-change placement, or surface quality. It did not edit product code, the worker branch, Railway, vertex-web, vertex-api, or PR #310. It did not deploy, merge main, or write a database. Scope stayed on grading when each finished foot's G-code is handed to the browser. No patient identifiers were written into the gates or this report. The fixture name on the download is `Stream_Gate`.
