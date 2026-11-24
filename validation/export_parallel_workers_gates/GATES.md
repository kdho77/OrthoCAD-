# Frozen gates: export parallel workers

These gates grade worker PR #412. They were written against base `9dd3542900fc6c127a4c5ce205c649071cad8690` before that candidate was measured. Do not edit `checker.mjs`, `observe-source.mjs`, `run-gates.mjs`, `proofs/**`, `live/**`, or `rstest.gates.config.ts` after the freeze commit.

The checker is `checker.mjs`. A gate passes only when every measured value meets its threshold.

## What is measured

- **G1** calls `exportDesign("stl")` on a cold Men's 9 SAMPLE_Top pair with a probe `Worker`. Pass when `maxActiveWorkers >= 2` and `distinctWorkersPosted >= 2` before either job finishes. That is two worker instances in flight at once, not one shared worker and not a serial main-thread loop.
- **G2-identity** builds Left and Right STL with `buildExportStl` for stock SAMPLE_Top and for the same design with bottom `textMarking` engrave (`addPatientName`, patient fixture "Sample Patient"). Pass when each mesh is watertight, Euler characteristic is 2, triangle count is at least 1, and `maxAbsDeltaMm <= 0.0` against the reference STL. Left and right hashes differ. Engraved hashes differ from stock.
- **G2-worker** passes only when the export graph constructs at least one worker, every worker script calls `reconstructProceduralPreview`, `buildProceduralExportSolid`, `buildExportStl`, or `buildClosedExportGeometry`, the worker does not define its own loft, and G2-identity passes.
- **G3** deletes `Worker` and repeats the single-foot stock export. Pass when `typeof Worker` is `"undefined"`, the export returns, the source has a main-thread fallback when a worker exists (inherent main thread when no worker exists), and the single-foot STL matches stock left within 0.0 mm.
- **G4** passes when the export worker host (or a module that imports it and terminates it) contains `.terminate(` or a `terminate*` call, contains an abort/cancel/unmount hook, and the probe workers are all `terminate()`d after those hooks run. `terminated >= constructed >= 1`.
- **G-existing** runs this rstest subset and requires exit code 0:
  - `vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.test.ts`
  - `vertex/src/lib/geometry/procedural-wall/preview-loft-worker.test.ts`
  - `vertex/src/lib/geometry/export-geometry.routing.test.ts`
  - `vertex/src/lib/geometry/procedural-wall/print-export-cache-parity.test.ts`
- **R1** surface files unchanged versus the baseline tree, and G2-identity passes. Surface files: `reconstruct.ts`, `wall-spline.ts`, `bezier-column.ts`, `curves.ts`, `ring-seam.ts`, `mesh-close.ts`.
- **R2** seam and layer-change files unchanged, and G2-identity passes. Files: `ring-seam.ts`, `curves.ts`, `wall-spline.ts`, `bezier-column.ts`, `kiri/slicer.ts`, `kiri/gcode.ts`.
- **R3** every path in `git diff --name-only <base> HEAD` is on the worker-dispatch allowlist (export entry files, worker modules whose names contain `worker` or `parallel`, and test files).
- **R4** `vertex/src/lib/geometry/text-marking/**` and `vertex/shared/bottom-text-marking.ts` unchanged. The engraved run uses `surface: "bottom"`, `mode: "engrave"`, `addPatientName: true`. Engraved STL matches the reference within 0.0 mm and differs from stock.
- **R5** the diff contains no `vertex-web`, `vertex-api`, `railway`, `fly.toml`, or `render.yaml` path.
- **R6** `manufacturingSolidFingerprint` body hash unchanged, cache-invalidation files unchanged (`manufacturing-solid-cache.ts`, `manufacturing-solid-context.ts`, `preview-loft-status-store.ts`), and G2-identity passes.

Reference STL for a baseline run is the run itself (`maxAbsDeltaMm` 0). The candidate run compares bytes, then vertex positions, to the baseline STL files.

## Proofs

`node validation/export_parallel_workers_gates/proofs/run-proofs.mjs`

- No-op: `proofs/noop-tree` is a parallel pool of 2 that falls back, terminates on abort, and delegates to `reconstructProceduralPreview`. The checker grades a matching observation as pass on every gate.
- Bad change: `proofs/bad-tree` is a serial singleton worker with its own loft and no terminate/fallback. A one-byte fingerprint edit and a 0.5 mm STL vertex flip must fail the gates that watch those outputs.

## Run

```bash
node validation/export_parallel_workers_gates/run-gates.mjs \
  --product <tree> --baseline <base-tree> --diff-from <base-sha> \
  --label <name> --out validation/export_parallel_workers_gates/artifacts \
  --baseline-stl <dir-of-reference-stls>
```

`--skip-geometry` and `--skip-existing` are only for debugging a single phase. The grade in RESULTS.md uses a full run.
