# AFO CAD Geometry Spec (binding)

**Status:** CAD-expert approved geometry basis for the web OrthoCAD AFO module.
**Coordinate frame:** same as OrthoCAD insole (`ARCHITECTURE.md` §2).

Items marked **[K]** are Kendon defaults — ship these values, keep them user-editable.

> Source note: the original attached `AFO_CAD_SPEC.md` was not present in the
> checkout. This file restates the expert rules from that spec as used in
> implementation. Open questions are listed at the end of the PR.

---

## 1. Product

AFO is a **separate product type** chosen at the start of a case. It shares the
viewer, raycast picking, marker UI, and undo/redo with the insole flow, and
must not load or mutate insole stock (`SAMPLE_Top.glb`).

## 2. Canonical frame

| Axis | Direction |
|------|-----------|
| X | Medial (+) → Lateral (−) |
| Y | Posterior / heel (0) → Anterior / toe (+) |
| Z | Plantar (0) → Dorsal (+) |

Origin: plantar heel contact.

## 3. Pipeline

1. **Home / Scan** — import foot+leg scan; 3-point orient (Kabsch, rigid, no scale).
2. **Cast** — production method, Remove Cast offset `c_cast`, shin offset,
   flatten bottom, shin box, toe box %; bony reliefs; tibial crest; insensate.
3. **Corrections** — applied only on the scanned side (malleolar-axis rotations).
4. **Design** — 5 landmarks with auto-rotating views; geodesic trim loop;
   close by clicking the first point; draggable handles; Confirm.
5. **Print** — watertight shell via SDF offset; hide cast.
6. **Export** — STL through existing solid hard gates; send-to-VertexSlice
   (`generateHybridGcode` / manufacturing.generateSolid) unchanged.

Deferred: Cut out, Hole pattern, Corrugation, Add pad, Add volume.

## 4. 3-point orient **[K]**

Scan markers (reuse marker UI):

| Id | Landmark |
|----|----------|
| M1 | Posterior plantar heel |
| M2 | Medial malleolus |
| M3 | Lateral malleolus |

Canonical targets (mm), rigid Kabsch, no scale:

- Heel `(0, 0, 0)`
- Medial malleolus `(35, 40, 80)`
- Lateral malleolus `(-35, 40, 80)`

## 5. Cast **[K]**

| Control | Default |
|---------|---------|
| Production method | `printing_shell` |
| Remove Cast `c_cast` | 0 mm (−10…+10; warn > +3 or < −5) |
| Shin offset `c_shin` | 0 mm (−6…+4) |
| Flatten bottom | off (plane z = 0) |
| Shin box | 80 × 70 × 220 mm, origin at ankle |
| Toe box height | 100–130% of max Z in the toe region |
| Transparent | off |
| 3D model | on |
| Corrected | off |

Remove Cast is a signed offset field (`c>0` shrinks, `c<0` clearance) with
bone protection — see `docs/AFO_CLINICAL_ADDENDUM.md`. Flatten bottom clamps
vertices with z < 0 onto the plantar plane. Shin box clips an AABB; toe box
height is `pct ×` toe-region max Z.

## 6. Corrections (scanned side only) **[K]**

| Parameter | Unit | Default | Range |
|-----------|------|---------|-------|
| Frontal rotation (varus–valgus, mid-malleolar frontal axis) | deg | 0 | −10…10 (warn \|deg\| > 5) |
| Sagittal rotation (PF–DF, malleolar axis) | deg | 0 | −5…+10 (warn > +5) |
| Heel lift | mm | 0 | 0…12 |
| Foot lift medial | mm | 0 | 0…12 |
| Foot lift lateral | mm | 0 | 0…12 |
| Medial arch | mm | 0 | 0…18 |
| Heel width | mm | 0 | −10…10 |
| Brace height | mm | 220 | 80…350 |
| Smooth (Taubin iterations) | — | 4 | 0…12 |

**Identity at zero:** all-zero corrections leave vertex positions unchanged
(smooth iterations = 0 in the identity path).

## 7. Design landmarks **[K]**

Five required markers, camera auto-rotates to the listed view after each place:

| # | Landmark | View |
|---|----------|------|
| 1 | Proximal medial (shin trim) | medial (`left` or `right` by side) |
| 2 | Proximal lateral | lateral |
| 3 | Medial malleolus | medial |
| 4 | Lateral malleolus | lateral |
| 5 | Distal / sulcus | plantar (`bottom`) |

After landmarks, click-to-place additional geodesic vertices. Closing click on
the first point. Handles remain draggable. Confirm freezes the loop.

## 8. Trim-loop validity

A trim loop is valid iff all of:

1. At least 3 distinct vertices.
2. Explicitly closed (or first point re-clicked).
3. Each consecutive pair is connected by a surface geodesic of finite length.
4. Polyline is non-self-intersecting (no non-adjacent segment intersections).
5. Total length ≥ 20 mm.
6. Projected enclosed area ≥ 100 mm².

Invalid loops cannot be Confirmed.

## 9. Print shell **[K]**

| Parameter | Default | Range |
|-----------|---------|-------|
| Thickness | 4 mm | 1…12 |
| Edge (rim blend width) | 2.5 mm | 0.5…8 |
| Flare (outward at opening) | 2.5 mm | 0…8 |

Heavy work (SDF offset, shell extract) runs in a Web Worker and reports
progress. Hide the cast when a shell exists.

**Offset:** signed distance field of the working positive; isosurface at
`±distance`. Distance 0 is the identity (input mesh cloned).

**Shell:** thicken the trim-bounded keep region by `thickness` along the
outward normal; blend over `edge` mm of the rim; add `flare` mm outward at
the opening. Result must be edge-manifold (watertight) with no triangle
self-intersections.

## 10. Export

- Binary STL through `buildExportStl` / `assertClosedSolidAcceptable`
  (no insole heel-bridge baseline).
- Filename `afo-{side}-{timestamp}.stl`.
- VertexSlice path: existing `generateHybridGcode` → manufacturing STL upload
  → `manufacturing.generateSolid`.

## 11. Acceptance tests (required)

| Id | Rule |
|----|------|
| A1 | Shell is edge-manifold / watertight (`openEdges = 0`, `nonManifold = 0`) |
| A2 | Shell has no triangle self-intersections |
| A3 | SDF / offset at `+10` expands a sphere of r=30 by ~10 mm |
| A4 | Offset at `−10` contracts that sphere by ~10 mm |
| A5 | Trim-loop rules in §8 accept valid loops and reject illegal ones |
| A6 | Identity at zero: offset 0 and zero corrections copy the input |

Tests use a small synthetic closed leg (or sphere) — never commit patient scans.

Clinical addendum tests **a–l** live in `afo-clinical.test.ts` (offset field,
crest, reliefs, ranges, warnings). Binding text: `docs/AFO_CLINICAL_ADDENDUM.md`.

---

## Open questions

The original CAD-expert `AFO_CAD_SPEC.md` and Kendon `AFO_PART1_VIDEO_NOTES.md` were
not in the checkout. This file restates the geometry rules used to ship the
module. Please confirm or correct:

1. **3-point orient targets** — heel `(0,0,0)`, medial mal `(35,40,80)`, lateral
   mal `(-35,40,80)` mm. Confirm against the expert sheet.
2. **Shin / toe box** origins and sizes — keep 80×70×220 shin and 80×90×50 toe
   (confirmed).
3. **Leg rear vs side rotation** — signed off: sagittal about the malleolar
   axis, frontal ⟂ malleolar & leg axes (addendum).
4. **Shell keep-region** — currently triangles with centroid z at or below the
   trim-loop mean z (brace below the opening in the canonical frame).
5. **VertexSlice** — reuse of `generateHybridGcode` / `manufacturing.generateSolid`
   with no new slicer symbol. Confirm that is the intended send path.
6. **Design deferred tools** — Cut out, Hole pattern, Corrugation, Add pad, Add
   volume are out of this PR as requested.
