# Grader report: PR #497

**DO NOT MERGE.** This branch only grades the worker change. It does not modify the manufacturing code.

**Verdict: PASS-WITH-RESIDUALS**

Graded commit: `8c9137ff86ca53fbc639333e925e6eeadc47bddf`
Parent (the tree the commit edits): `91e0062a7fd1de564b7d8b9f14b869a752464a7b`
Current `main` tip, which does not contain this PR: `39f988339dd341f8a843414affd417f1905665c9`

The grader rebuilt the solids itself. Full-length hashes were produced in separate checkouts of the parent and of `main`, then compared with the PR checkout. Short trims were built through `buildPrinterFootManufacturingStl` and `buildFinalizedFootFromSavedDesign` on US M9 `SAMPLE_Top`, both feet, with bottom marking text `ADA` and a synthetic patient name `Ada Grade`.

## Verdict table

| Gate | Result | What was measured |
| --- | --- | --- |
| G1 Scope and invariants | PASS | The commit touches six files, all part of the short-trim fix. `TRIM_PRESET_LANDMARK_U` is still `full=1`, `sulcus=0.72`, `met_head=0.66`. `station-gates.ts` and `trim-presets.ts` are byte-identical to the parent. `assertPreLoftStations` still runs, and the thresholds are still 15° heading, skew/inset ratio 0.5, and 150° post-loft dihedral. |
| G2 Full-length invariance | PASS | Untrimmed US M9 manufacturing STLs are byte-identical to the parent and to current `main`. Left payload `ae4a1b614726cd0704a406f82ec98ab40a150962fb702ebe2943f47986369ca7` (110,308 triangles, 273.11 mm). Right payload `f30ad810bd930d0ccd4de0d8e78ec1c61dca85a57a9e85c38c85b253d50def13` (111,116 triangles, 273.10 mm). |
| G3 Closed manifold on short trims | PASS | Left and right `met_head` and `sulcus`, no belt leader: watertight, Euler characteristic 2, zero open edges, zero non-manifold edges, zero degenerate triangles, positive volume. Plantar min Z is 0. The patient-name recess is present. |
| G4 Shortened shape | PASS | `met_head` is 34.44% shorter than full (179.05 mm). `sulcus` is 28.34% shorter (195.70 mm) and 16.7 mm longer than `met_head`. Outer-border medial lead is 12.5 mm on `met_head` and 12.7 mm on `sulcus`. Heel cup over the posterior 55 mm is 23.66 mm against 23.55 mm on the full foot. The sole contact plane sits on Z = 0. |
| G5 UI vs headless parity | PASS | `buildFinalizedFootFromSavedDesign` matches `buildPrinterFootManufacturingStl` on both presets and both feet, with the leader off and with the belt leader on. The leader upload has more triangles than the foot solid and is a coherent STL. |
| G6 Existing tests and shard manifest | PASS | `station-gates`, `narrow-heelcup-preloft`, `export-solid`, and `print-solid-parity`: 17 passed. This grader: 2 passed. `node scripts/ci/validate-unit-test-shards.mjs`: OK, 390 files across 6 shards. |

## Residuals

These did not fail a gate. They are what a reviewer should still know.

1. **The cut is the filleted clip, not the raw landmark vertex.** The preset curve's medial-versus-lateral apex is 19.0 mm on this foot (the 0.07 length obliquity, clamped between 10 and 22 mm). After the 0.25 mm margin, the 1.5 mm anterior simplify, and the 12 mm corner fillet, the manufactured solid's outer-border lead is 12.7 mm on sulcus and the apex-to-apex lead is about 15.3 mm. The foot is still oblique in the correct direction, and the length loss matches the landmarks within half a percentage point. A clinic that needs the raw vertex, rather than this rounded cut, needs a separate tolerance change. Do not get there by loosening `assertPreLoftStations`.

2. **The branch does not contain current `main`.** GitHub reports the PR dirty against `main`. `main` has later edits in `station-gates.ts` (the #469 snap that slides a station onto the existing cap and does not raise it), `reconstruct.ts`, `print-solid-compose.ts`, and `sample-top-preview.ts`. The untrimmed US M9 STL still matches `main` byte for byte, so those later commits did not move this particular full-length solid. A rebase can still conflict, and this branch does not include the #469 snap.

3. **The belt leader is its own block.** The foot with the leader off is the closed solid. The upload with the leader on is a larger STL whose triangle payload matches between the UI and the headless path. It is not checked as one watertight shell, which matches the other leader tests.

4. **Two full-length code paths changed and then did not move this mesh.** `rimJunctions` now skips a zero-area face and falls back to +Z, and the `[S1-PAIRS]` log line is gone. On this US M9 pair the STL bytes did not change. That does not prove every other size and width is untouched; the narrow-heel-cup pins in the existing suite did still match.

## How to read a failure later

`vertex/tests/pr497-short-trim-preloft.grader.test.ts` encodes the gates above. It checks out the parent and `main` in temporary worktrees and refuses the full-length comparison if those checkouts accidentally load the PR-only blunt-cut helper. Worker files on this branch match `8c9137ff`; only the grader test, this report, and the shard manifest registration were added.
