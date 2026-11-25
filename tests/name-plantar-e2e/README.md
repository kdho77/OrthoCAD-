# Plantar name lock

The bottom name on the physical plantar face of the final belt G-code must read left to right. This job is the lock from Kendon 2026-11-24 4:52 PM MT. A slicer-mirror flip or a placement flip turns it red.

`JABBOUR` is a synthetic string, not a patient name.

## Path

1. Design: bundled `SAMPLE_Top`, both feet, default bottom `textMarking` (engrave, 12 mm bold, depth 0.6 mm), text `JABBOUR`.
2. `buildPrinterFootManufacturingStl(side, true)` — the STL the bot sends, leader included, `beltPrint` on.
3. VertexSlice `POST /v1/slice` with `profile_id=apex-v2-insole-95a`, `wall_loops=1`, `infill_density=26`, `belt_insole_place=true`. The matrix is `apex_core` / `toe_first`, `apex_light` / `toe_first`, and `apex_light` / `heel_first`, each for both feet. `apex_core` ignores a heel-first request, so heel-first is sliced on `apex_light`, whose chain honours `print_direction`.
4. Belt-contact walls (`Y <= 0.6`, or the engrave band `Y <= 1.6` when the contact band has no seven letters) drawn in the physical reading frame.
5. All six cells must match #435: linear map `a > 0.5`, `d > 0.5`, `|b| < 0.15`, `|c| < 0.15`, advance `> 20` mm, J hook lower-left (`1.5` / `0.75` mm), glyph order `JABBOUR` toward `+reading-x`.
6. Heel-first G-code must put the heel cup at the low `zt` end (the `hand_classify.py` end-fifth rule). A toe-first file in that cell fails. Toe-first cells must put the cup at the high `zt` end.

## Reading frame

Belt G-code is right-handed: X across the belt, Y height off the belt, Z along the belt. De-shear with `zt = Z - Y`. From below, toe toward the viewer in both print directions, then turned cap-up. On a toe-first print the heel is at high `zt`, image right is `-X`, and image up is `+zt`. A heel-first print is a 180° turn on the belt, which flips X and `zt` together, so the reading of a correct name does not change. A mirror flips one axis and the verdict flips. Thresholds are the #435 gate (`21b9bef3`). They are not loosened.

## Images

The default CI image is the VertexSlice fix: published live image

`ghcr.io/kdho77/vertexslice-server@sha256:8cac1d54c5e1a12f4693412c32fe40dd9c5682b9279e2b1d38f1225760aca579`

(`origin/main` `d935197976`) plus `validation/stl_preprocess.py` from the deploying VertexSlice #52 head `9fe936425ad4449ee6a6d932b636a432c8dd2ea2` (Y-negate before Rz270). That is the image the fix branch slices with. It is not a modelled slicer.

Dispatch the workflow with `vertexslice_image` set to the live digest to grade current main. That run is red while main still mirrors the name.

After VertexSlice #52 merges and deploys, `LIVE_IMAGE` in `.github/workflows/name-plantar-e2e.yml` must be bumped to the new live digest so the default run uses production. The fix pin (live digest plus `stl_preprocess.py` from `9fe936425ad4449ee6a6d932b636a432c8dd2ea2`) stays until that deploy replaces it.

The gateway timeout overlay (`260` → `880`) is the same wait-only edit as `validation/seam_fuse_gates/slice_all.sh`. It does not change G-code.

## Local

```bash
NAME_PLANTAR_STL_DIR=/tmp/name-plantar/stl npx rstest tests/name-plantar-e2e/build-stls.test.ts
bash tests/name-plantar-e2e/slice-feet.sh <image> /tmp/name-plantar/stl /tmp/name-plantar/gcode
NAME_PLANTAR_GCODE_DIR=/tmp/name-plantar/gcode \
  npx rstest --config tests/name-plantar-e2e/rstest.config.ts \
  tests/name-plantar-e2e/measure-gcode.optional.test.ts
```

`chirality.test.ts` locks the frame and the #435 numbers without a slicer. `build-stls.test.ts` is the unit-shard STL builder. Measured numbers for the live image, the fix image, and the local `#436` placement are in `PROOFS.md`.

## Production-path gates

`production-path-gates.test.ts` extends this lock. It does not replace the six cells or their thresholds. It lofts design paths `0d3db1c0` and `ad1e0cc5`, plus one-factor variants, through `buildFinalizedFootFromSavedDesign` / `buildFinalizedBeltPairFromSavedSettings` with `beltPrint` on. The reading frame is the same #442 frame after the live #52 Y-negate (`production-frame.ts`). `bottomimg.py` is not used. Synthetic string remains `JABBOUR`.

Non-text hashes for feet that already engrave a readable name are in `frozen-surface-hashes.ts`. A blanket X flip of every belt path fails G1 on the #442 control and on `ad1e0cc5`. Measured identity on BASE is in `validation/name_chirality_gates/RESULTS.md`.

`full-design-identity.test.ts` is the t2699u gate. An unchanged saved design reuses the stored manufacturing STL. Mutating any one persisted field, `beltPrint`, or the OrthoCAD geometry version must miss that STL, the checkpoint fingerprint, and `manufacturingSolidIdentity`. The table fails on BASE where the identity is still a hand-picked field list.
