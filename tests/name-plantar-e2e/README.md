# Plantar name lock

The bottom name on the physical plantar face of the final belt G-code must read left to right. This job is the lock from Kendon 2026-11-24 4:52 PM MT. A slicer-mirror flip or a placement flip turns it red.

`JABBOUR` is a synthetic string, not a patient name.

## Path

1. Design: bundled `SAMPLE_Top`, both feet, default bottom `textMarking` (engrave, 12 mm bold, depth 0.6 mm), text `JABBOUR`.
2. `buildPrinterFootManufacturingStl(side, true)` — the STL the bot sends, leader included, `beltPrint` on.
3. VertexSlice `POST /v1/slice` with `profile_id=apex-v2-insole-95a`, `material=apex_core`, `wall_loops=1`, `infill_density=26`, `print_direction=toe_first`, `belt_insole_place=true`.
4. Belt-contact walls (`Y <= 0.6`, or the engrave band `Y <= 1.6` when the contact band has no seven letters) drawn in the physical reading frame.
5. Both feet must match #435: linear map `a > 0.5`, `d > 0.5`, `|b| < 0.15`, `|c| < 0.15`, advance `> 20` mm, J hook lower-left (`1.5` / `0.75` mm), glyph order `JABBOUR` toward `+reading-x`.

## Reading frame

Belt G-code is right-handed: X across the belt, Y height off the belt, Z along the belt. De-shear with `zt = Z - Y`. From below, image right is `-X` and image up is `+zt` (heel), toe toward the viewer. A 90° turn puts the toe to the right and the cap up. Thresholds are the #435 gate (`21b9bef3`). They are not loosened.

## Images

The default CI image is the VertexSlice fix: published live image

`ghcr.io/kdho77/vertexslice-server@sha256:8cac1d54c5e1a12f4693412c32fe40dd9c5682b9279e2b1d38f1225760aca579`

(`origin/main` `d935197976`) plus `validation/stl_preprocess.py` from `cursor/lr-swap-belt-mirror-1124` @ `0415b656d42d7ae0828e435b98f6fdae4f6f0486` (X mirror and winding reversal after Rz270, before X centring at 140). That is the image the fix branch slices with. It is not a modelled slicer.

Dispatch the workflow with `vertexslice_image` set to the live digest to grade current main. That run is red while main still mirrors the name.

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
