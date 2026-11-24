# Export parallel workers — gate results

Frozen gate commit: `44f9f999d29cbc3d8f4322cea453b3e4360e95f8` (gates were not edited after this commit).

- BASE: `main` @ `9dd3542900fc6c127a4c5ce205c649071cad8690`
- Candidate: PR #412 head `f059edf74b9bed33071a4deb8ad3c9674d289dfd` (`cursor/run-cold-left-and-right-browser-export-solid-builds-in-parallel-web-workers-e7a3`)
- Merge-base of those two SHAs: `268aac85847160b5b2703a05688721ea4cb93b24`. The candidate is that base plus one commit. `main` has three later commits the candidate does not contain (`a4c2c2d7`, `f435d670`, `9dd35429`).

Proof command (no-op traces pass, bad-change traces fail):

```bash
node validation/export_parallel_workers_gates/proofs/run-proofs.mjs
```

Result: all no-op proofs passed and all bad-change proofs failed.

Grade command:

```bash
node validation/export_parallel_workers_gates/run-gates.mjs \
  --product <tree> --baseline <base-tree> --diff-from 9dd3542900fc6c127a4c5ce205c649071cad8690 \
  --baseline-stl <base-stl-dir> --label <base|candidate> --out /tmp/gate-results
```

The candidate tree was graded by running that frozen runner from a byte-identical copy of this folder inside the candidate worktree, because rstest only loads tests that sit inside its project root. `diff -rq` against the freeze tree matched. Product code was not modified.

## Verdict

Candidate **does not pass every gate**. Parallel dispatch, STL identity, headless fallback, and the focused existing tests pass. Cancellation runtime, diff scope, and the text-marking tree hash fail.

| Gate | BASE measured | Candidate measured | Threshold | BASE | Candidate |
| --- | --- | --- | --- | --- | --- |
| G1 parallel workers | maxActiveWorkers=0, distinctWorkersPosted=0 | maxActiveWorkers=2, distinctWorkersPosted=2 | both >= 2 | FAIL (feature absent) | PASS |
| G2-identity STL | delta 0.0 mm, watertight, Euler 2 | same hashes as BASE, delta 0.0 mm, watertight, Euler 2 | delta <= 0.0 mm, watertight, Euler 2 | PASS | PASS |
| G2-worker delegation | exportWorkerHosts=0 | hosts=1, delegates=true, ownLoft=false, delta 0.0 mm | hosts >= 1, delegates, no own loft, delta <= 0.0 | FAIL | PASS |
| G3 Worker undefined | headlessExportOk=true, typeof Worker = undefined, single-foot sha = stock left | same | headless ok, Worker undefined, single-foot delta <= 0.0 | PASS | PASS |
| G4 cancel/cleanup | constructed=0, terminated=0, terminateCalls=0 | constructed=2, terminated=0, terminateCalls=16, lifecycleHooks=2 | terminated >= constructed >= 1, and source hooks >= 1 | FAIL | FAIL |
| G-existing | exit 0 | exit 0 | exit 0 | PASS | PASS |
| R1 surface files | changed=[] , delta 0.0 mm | changed=[] , delta 0.0 mm | no surface-file change, delta <= 0.0 | PASS | PASS |
| R2 seam/layer files | changed=[] , delta 0.0 mm | changed=[] , delta 0.0 mm | no seam-file change, delta <= 0.0 | PASS | PASS |
| R3 scope | violations=[] | 5 paths (below) | violations=[] | PASS | FAIL |
| R4 text marking | dir unchanged, bottom/engrave, delta 0.0 mm | dir hash differs, marking bottom/engrave, STL delta 0.0 mm | text tree unchanged and delta <= 0.0 | PASS | FAIL |
| R5 forbidden paths | [] | [] | [] | PASS | PASS |
| R6 fingerprint and cache | fingerprintChanged=false, cacheInvalidationChanged=false, delta 0.0 mm | same | both false, delta <= 0.0 | PASS | PASS |

## STL measurements (byte-identical)

`buildExportStl` with `Worker` forced undefined. Candidate `maxAbsDeltaMm` is against the BASE STL. SHA-256 matches on every file, so the vertex delta is 0.0 mm.

| Mesh | Triangles | Euler | Watertight | SHA-256 |
| --- | --- | --- | --- | --- |
| Stock left | 75844 | 2 | true | `4c0e3fa857504ddf81f2722737c83f47b20eac9b642e406656e06ed3deab13e1` |
| Stock right | 75756 | 2 | true | `ccd6fd7f92b381334c1fd7f90bd62869884ae58c38bafb539806ccbd832dada1` |
| Engraved left | 112756 | 2 | true | `55e8327e9ca11577cfa70a68efcdd73673ed8eb3359c876f178c3c3cdf980818` |
| Engraved right | 113416 | 2 | true | `c6ffad1e8bd03dd8a2e37a15cd4b45e59c53e27c5fdace06a4d1502487d76481` |

Single-foot left uses the same bytes as stock left. Engraved meshes differ from stock (the bottom name is in the solid) and match BASE. Engraving settings: `surface: "bottom"`, `mode: "engrave"`, `addPatientName: true`, fixture name Sample Patient.

Existing-test command (exit 0 on both trees):

```bash
npx rstest --config rstest.config.ts \
  vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.test.ts \
  vertex/src/lib/geometry/procedural-wall/preview-loft-worker.test.ts \
  vertex/src/lib/geometry/export-geometry.routing.test.ts \
  vertex/src/lib/geometry/procedural-wall/print-export-cache-parity.test.ts
```

## Why G4, R3, and R4 fail

**G4.** During `exportDesign("stl")` the probe constructed 2 workers and both had an in-flight `postMessage` (`maxActiveWorkers=2`). After the probe called exported `terminate*` / `cancel*` / `abort*` functions, fired abort listeners, and dispatched `pagehide` / `beforeunload`, `terminated` stayed 0. Source on the candidate does contain `terminateExportSolidWorkers` (it loops the pool and calls `terminate()`) and the G-code abort path calls that function. The runtime counter did not move. One plausible cause is that the probe's dynamic import is a second module instance, so it cleared an empty pool while the live pool stayed up. The frozen checker still requires `terminated >= constructed >= 1`, so the gate is FAIL.

**R3.** `git diff --name-only 9dd35429 f059edf` lists paths outside the allowlist:

- In the worker commit itself: `vertex/src/features/exports/export-panel-clinical.ts` (three lines that call `terminateExportSolidWorkers()` when a G-code export aborts).
- Present only because the branch does not contain later `main` commits: `ci/unit-test-shards.json`, `vertex/server/src/lib/saved-design-snapshot.ts`, `vertex/shared/saved-design-snapshot.ts`, `vertex/src/lib/geometry/text-marking/gates.ts`.

**R4.** `vertex/src/lib/geometry/text-marking` hashes differ from `main`. That diff is `gates.ts`, and it is not in the worker commit; `main` commit `f435d670` is missing from the branch. The engraved STL bytes still match `main`.

## What the candidate does

A cold two-foot STL export starts the left and right solid builds together (`Promise.all` in `buildOrderPairGeometry`). Each foot checks out its own worker from a pool of size 2. The worker module calls the existing procedural loft (`reconstructProceduralPreview` / the export-solid build); it does not define a second loft. With `Worker` undefined, that path calls `buildProceduralExportSolid` on the main thread, which is what the Node STL run measured.

## Hard prohibition

This branch does not change product geometry, the outer surface, seam placement, layer-change placement, or surface quality. The only files versus `main` are under `validation/export_parallel_workers_gates/`.
