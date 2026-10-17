# AFO Part 1 — UI workflow notes (Kendon demo)

Binding for the OrthoCAD AFO step rail and panels. Geometry numbers live in
`docs/AFO_CAD_SPEC.md`.

## Product choice

At the start of Production, choose **Insole** or **AFO**. AFO is a distinct
workflow; the 3D viewer, raycast, markers, and undo/redo are shared.

## Steps

### 1. Home / Scan

- Import a foot+leg scan (GLB / OBJ / STL / PLY).
- 3-point orient with the existing marker UI: heel, medial malleolus, lateral
  malleolus. Scanned side is explicit (Left / Right).

### 2. Cast

Panel controls:

- Production method
- Remove Cast
- Flatten bottom
- Shin box
- Toe box
- Toggles: Transparent, 3D model, Corrected

### 3. Corrections

Show only the scanned side:

- Leg rear rotation (deg)
- Leg side rotation (deg)
- Heel lift
- Foot lift medial / lateral
- Medial arch
- Heel width
- Brace height
- Smooth

### 4. Design

- Place 5 landmarks; camera auto-rotates per spec.
- Click-to-place geodesic trim line on the mesh.
- Close the loop by clicking the first point.
- Drag handles to edit.
- Confirm.

Deferred on this step: Cut out, Hole pattern, Corrugation, Add pad, Add volume.

### 5. Print

- Thickness 4, edge 2.5, flare 2.5 (all editable).
- Generate watertight shell (worker + progress).
- Cast hides automatically when a shell exists (no Print toggle).
- Footer: Save, Return to patient file.

### 6. Export

- STL (existing hard gates).
- Send to VertexSlice via the existing manufacturing / hybrid G-code path.
