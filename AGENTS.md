# OrthoCAD agent notes

## Footprint-frame medial and lateral

The stock insole is a left foot. In the footprint frame, mesh Y medial (big toe) is **−Y on the left** and **+Y on the right**. Lateral is the opposite sign. Do not copy a left-foot world Y onto the right foot.

Height-field samples use the opposite sign: +Y is left-foot medial. Convert with `heightFieldYFromMeshY`.

## Placement

Element and sink placement must go through `vertex/src/lib/geometry/handedness.ts`:

- `meshYSign(footSide, "medial" | "lateral")`
- `meshYForAnatomicalSide(footSide, anatomicalSide, magnitudeMm)`
- `meshYFromAnatomicalLateral` / `medialSign` for outline conversion

Register the border on `ELEMENT_PROFILES.anatomicalSide` or `SINK_PROFILES.anatomicalSide`. Do not add a one-off `side === "left" ? -1 : 1`.

## Viewer

Every placed element and every placed sink must draw a visible planform or colored surface in the Elements viewer. A gizmo alone is not enough.

## Tests

New element or sink kinds need the registry test in `vertex/src/lib/geometry/anatomical-side.test.ts` to cover them (it walks `ELEMENT_PROFILES` and `SINK_KIND_ORDER`) and a viewer check that the overlay is non-empty. Morton's extension stays medial, 3 mm, and present in the export mesh.
