# Plantar name lock

The bottom name on the physical plantar face of the final belt G-code must read left to right, cap up, when the sole is viewed from below. This job slices the live VertexSlice #52 image (Y-negate, then Rz). A placement flip turns it red.

`JABBOUR` is a synthetic string, not a patient name. Unit coverage of `GNRF` is `plantar-glyph-chirality.test.ts`.

## Path

1. Design: bundled `SAMPLE_Top`, both feet, default bottom `textMarking` (engrave, 12 mm bold, depth 0.6 mm), text `JABBOUR`.
2. `buildPrinterFootManufacturingStl(side, true)` — the STL the bot sends, leader included, `beltPrint` on.
3. VertexSlice `POST /v1/slice` with `profile_id=apex-v2-insole-95a`, `wall_loops=1`, `infill_density=26`, `belt_insole_place=true`. The matrix is `apex_core` / `toe_first`, `apex_light` / `toe_first`, and `apex_light` / `heel_first`, each for both feet. `apex_core` ignores a heel-first request, so heel-first is sliced on `apex_light`, whose chain honours `print_direction`.
4. Belt-contact walls (`Y <= 0.6`, or the engrave band `Y <= 1.6` when the contact band has no seven letters) drawn in the physical reading frame.
5. All six cells must match #435: linear map `a > 0.5`, `d > 0.5`, `|b| < 0.15`, `|c| < 0.15`, advance `> 20` mm, J hook lower-left (`1.5` / `0.75` mm), glyph order `JABBOUR` toward `+reading-x`.
6. Heel-first G-code must put the heel cup at the low `zt` end (the `hand_classify.py` end-fifth rule). A toe-first file in that cell fails. Toe-first cells must put the cup at the high `zt` end.

## Reading frame

Belt G-code is right-handed: X across the belt, Y height off the belt, Z along the belt. De-shear with `zt = Z - Y`. From below, toe toward the viewer in both print directions, then turned cap-up. On a toe-first print the heel is at high `zt` and the cap points toward `+X`. A heel-first print is a 180° turn on the belt, which flips X and `zt` together, so the reading of a correct name does not change. A mirror flips one axis and the verdict flips. Thresholds are the #435 gate (`21b9bef3`). They are not loosened.

## Images

The default CI image is live VertexSlice

`ghcr.io/kdho77/vertexslice-server@sha256:979e31bdf64b2eab4559717b8cc4e862a030fc35e235be2482c253cb2fd3b782`

(VertexSlice #52 `2bfc6f43a6`, live on Railway). Its `validation/stl_preprocess.py` negates Y and then rotates Z. That is the slicer the press runs. Do not copy another `stl_preprocess.py` over it.

Dispatch the workflow with `vertexslice_image` set to another digest to grade that image. The gateway timeout overlay (`260` → `880`) is the same wait-only edit as `validation/seam_fuse_gates/slice_all.sh`. It does not change G-code.

## Local

```bash
NAME_PLANTAR_STL_DIR=/tmp/name-plantar/stl npx rstest tests/name-plantar-e2e/build-stls.test.ts
bash tests/name-plantar-e2e/slice-feet.sh <image> /tmp/name-plantar/stl /tmp/name-plantar/gcode
NAME_PLANTAR_GCODE_DIR=/tmp/name-plantar/gcode \
  npx rstest --config tests/name-plantar-e2e/rstest.config.ts \
  tests/name-plantar-e2e/measure-gcode.optional.test.ts
```

`chirality.test.ts` locks the frame and the #435 numbers without a slicer. `build-stls.test.ts` is the unit-shard STL builder. Measured numbers for the live image, the fix image, and the local `#436` placement are in `PROOFS.md`.
