# Forefoot seam gap — printed insole split

**Status:** report only. The root cause is not confirmed inside this repo, so no mesh or slicer change is included.
**Date:** 2026-11-13
**Base:** `bbf296fc` (Phase 1: load/export orchestration, #348)
**Report:** Kendon t1954u. Clear TPU, belt printer, insole upright on the bed, forefoot already printed. A straight line runs roughly lengthwise through the forefoot, from the top edge down to the base, and the layers on either side of that line do not bond.

The line is a vertical split through the thickness, along the length of the forefoot. It is not a horizontal delamination between layers.

## What was built

Stock top: `tests/fixtures/SAMPLE_Top.glb` (left foot). Right foot is `mirrorGeometry` of that sheet. Manufacturing solid is `reconstructProceduralPreview` with the default print compose (straight walls, full-contact, zonal shell 3 / 2.5 / 2 mm, flat plantar). Met-pad cases place one `met_pad` through `defaultElementPose` and `baseModifierField`. Hardness is read with `effectiveHardnessRegions(defaultDesign())`.

VertexSlice G-code was not generated. There is no Orca/VertexSlice CLI on this machine, no `.gcode` fixture in the repo, and printer G-code is refused locally (`export-service.ts`: "Local slicing is disabled so the leader block is not dropped"). No printer was contacted.

## Candidate 1 — unwelded mesh slit

Ruled out for the default manufacturing solid and for the same solid with a met pad.

`SAMPLE_Top` before the loft is one open top sheet: 7809 vertices, 15170 triangles, 446 open edges, all on the rim. A dihedral search of the raw sheet found no crease steeper than 20° along the forefoot.

After the loft, quantized at 0.0001 mm (`analyzeManifold` keying, so coincident-but-unwelded vertices still count as one edge):

| Solid | Triangles | Open edges | Non-manifold | Duplicate faces | Unwelded groups |
| --- | ---: | ---: | ---: | ---: | ---: |
| Left, no elements | 75844 | 0 | 0 | 0 | 0 |
| Right, mirrored, no elements | 75756 | 0 | 0 | 0 | 0 |

Left bounds: x −0.7…272.41 mm, y −46.35…46.36 mm, z 0…25.81 mm. Unique positions equal the vertex count (37924 left, 37880 right).

Coronal cuts through the forefoot (constant x at u = 0.72, 0.82, 0.90) are one loop. On the left foot that loop is closed. On the right foot a station that lands on a loft ring drops the in-plane edges and leaves one long chain (about 135–183 mm) plus a scrap under 1 mm; the chain ends are that scrap, not a second wall. The minimum distance between points at least 8 mm apart along the loop is greater than 1.2 mm, so there is no hairline pinch the slicer could wall on both sides. A horizontal cut through the forefoot plate (z = 0.6 mm) is one closed loop on both feet. `vertex/src/lib/geometry/procedural-wall/forefoot-seam-gap.test.ts` re-checks both feet, with and without a met pad. It fails on a second chain longer than 2 mm, on an end gap of 2 mm or more, or on a section pinch under 0.4 mm.

The wrap seam of the loft is the lateral midfoot (`lowCurvatureStartIndex`, u 0.32–0.5), and the vertices on that ring are shared (`assertPeriodicQuadStrip`). Zone thickness is a smooth function of u; the zone boundaries are transverse, not a lengthwise cut. `mergeGeometries` concatenates parts without welding, but the procedural solid is one mesh, not a medial half glued to a lateral half.

A plane that lands exactly on an edge can report an open chain plus a sub-millimetre leftover (right foot at u = 0.72 and u = 0.90 before the nudge). Topology is still 0 open edges, so that is the cutter, not a hole. The mid-height horizontal slice (z ≈ 12.9 mm) is the same grazing artifact: one long open chain where the plane skims vertices. It is not a split.

Loft quality logs from the same run (`[S1-BSEAM] minH` 0.007 mm, 69 wall/sole angles under 5°) are acute triangles at the sole fillet. The shell stayed watertight and the forefoot section stayed thicker than 1.2 mm. Those triangles are not the printed line, and they are not changed here.

## Candidate 2 — hardness modifier boundary

Ruled out for a default print. A real mechanism when a region is actually sent.

`effectiveHardnessRegions(defaultDesign(), side)` is empty on both feet. `regionalSliceDecision` returns STL when the effective region count is 0, and a regional 3MF is built only when `VERTEXSLICE_REGIONAL_3MF` is on and regions exist. A print with no zones and with Split elements off sends one watertight solid and no modifier part.

When a region is sent, the modifier is a separate 3MF `modifier_part` (`export-3mf.ts`), not a cut in the shell. Element prisms (`prism.ts`) extrude side walls wherever occupancy changes, through `depthBelowMm` (default 2 mm, which is the whole forefoot plate) or through the full shell for a zone. The modifier metadata sets infill density, pattern, speed, and line width. It does not set `wall_loops` (`hardness-regions.gates.test.ts`). An Orca-style slicer can still trace a perimeter on that modifier boundary. A user zone with a straight anterior-posterior side, or Morton's extension with Split elements on (the hardness outline is the sharp medial strip, height 3 mm), would draw a lengthwise wall. A met pad outline is a teardrop, not a straight cut down the forefoot. None of that is on the default recipe, so it cannot explain a gap on every print.

## Candidate 3 — slicer seam, overlap, thin walls

Not confirmed. This is the step this repo cannot inspect.

Printer G-code is posted to VertexSlice `POST /v1/slice` with the locked profile `apex-v2-insole-95a` (`APEX_V2_INSOLE_LOCKED_PROFILE_ID`). The form fields OrthoCAD sends are `profile_id`, `material`, `infill_density`, and `model`. `sliceWithVertexSlice` does not send `wall_loops`, `seam_position`, `seam_gap`, wall/infill overlap, or `detect_thin_wall` (`vertexslice-client.ts`: "Wall loops are never sent"). Those knobs live in the locked profile, which is not in this repository.

`prepareManufacturingMeshForSlice` returns the bytes unchanged below `SLICE_MESH_SIMPLIFY_ABOVE` (132000 triangles). The default solid is about 76000 triangles, so the handoff does not remesh it.

The Python belt slicer is not the production G-code path. Its thin-shell fusion runs only when a shell pair is at most `RIBBON_WIDTH_BEADS` (2) times the extrusion width (default 0.48 mm, so 0.96 mm). The forefoot plate is about 2.0–2.2 mm, above that threshold.

The belt leader block (`leader-block.ts`) is appended to the manufacturing STL before VertexSlice and is not a boolean union: a 10 × 1.5 mm bridge, 1 mm neck past the toe, embedded 1 mm, measured at the bridge side edges. That intersection can make a slicer draw an extra wall at the toe tip. It does not cut the forefoot lengthwise.

A Z-seam stacked by the locked profile along one belt-normal station would look like the photo: a straight unbonded line already visible in the printed forefoot, on an otherwise closed mesh. Confirming that needs a slice of this solid on `apex-v2-insole-95a` and a look at the perimeter start points through the forefoot. That slice was not run.

## Candidate 4 — recent merges

None of these change insole forefoot weld or merge.

| PR | What landed | Forefoot topology |
| --- | --- | --- |
| #349 (`07ad9351`) | AFO flat-plate trim smoothing | AFO only |
| #348 (`bbf296fc`) | Load/export orchestration, byte-identical output | No geometry edits. Procedural loft, mesh-close, hardness math, infill, and the leader block are untouched |
| #338 (`3d1505bb`) | AFO trim drag, shell fingerprint, cleanup | AFO only |
| #340 | Manufacturing export access matches design save | ACL only |
| #341 | Long patient-name bottom engraving stays manifold | Plantar text pocket only |

## Which step introduces the seam

The mesh weld/merge step does not. The default left and right solids, with and without a met pad, are watertight, have no coincident duplicate vertices, and have a single closed forefoot section thicker than a bead. A default print also sends no hardness modifier.

The step that can still turn that solid into the photographed line is the locked VertexSlice profile `apex-v2-insole-95a`. OrthoCAD cannot override its seam, overlap, or thin-wall settings, and this repo has no G-code to show where the perimeters start.

## Fix status

No code change to the loft, the export weld, the leader, or the hardness volumes. A speculative mesh edit would not close a gap that is not in the mesh.

Regression: `vertex/src/lib/geometry/procedural-wall/forefoot-seam-gap.test.ts`, registered in `ci/unit-test-shards.json`. It fails on open edges, non-manifold edges, duplicate faces, unwelded coincident vertices, a second forefoot coronal loop, an open chain longer than 3 mm, or a section pinch under 0.4 mm. It passes on current main. No golden or hash was repinned.
