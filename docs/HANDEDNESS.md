# Handedness

One convention for every element, marker, and export. The helper is
`medialSign(side)` in `vertex/src/lib/geometry/handedness.ts`.

```ts
import { medialSign } from "@/lib/geometry/handedness";

medialSign("left"); // -1  → medial is mesh −Y
medialSign("right"); // +1 → medial is mesh +Y
```

`medialSign` is the sign of footprint-frame **mesh Y** that points to the
big-toe side. Future elements must call it. Do not copy a local
`side === "left" ? 1 : -1`. That is the opposite sign, and it is why the
first implementation of a feature keeps landing mirrored.

## Mesh frame

After `reorientToFootprintFrame`:

| Axis | Meaning |
| --- | --- |
| +X | heel → toe |
| +Y | width. Medial is `medialSign(side) * positive` |
| +Z | plantar → dorsal (up) |

The builtin mesh (`SAMPLE_Top.glb`, and `Default.glb` before it) is a
**left** foot. `primarySide` is `"left"`. Its midfoot arch is on **−Y**,
which is `medialSign("left")`.

The right foot is not a second authored mesh. `mirrorGeometry` reflects the
width axis (the middle bounding-box dimension, Y in this frame) about its
centre. Reflection sends the arch from −Y to **+Y**, which is
`medialSign("right")`.

Height-field `vSigned` is not mesh Y. `medialSign` there is the same
function (`left` −1, `right` +1). `m = -(vSigned * medialSign)` is +1 on
the medial edge. Base modifiers turn mesh Y into that `vSigned` with
`widthSign = -(detectArchSideSign * medialSign)`, so the arch dome follows
the measured arch instead of a hardcoded +Y.

## Top-view camera

The viewer does not mirror the mesh. It translates each foot by
`sideOffsetX` (left +, right −) and rotates the pair by Rx(−90°). Local Y
becomes world −Z. Local Z (up) becomes world +Y.

| | |
| --- | --- |
| Top camera | world +Y, looking down. Up vector is +X, so toes are at the top of the screen and the heel is at the bottom. |
| Screen left | the left foot. Its medial −Y faces the gap (toward screen-right of that foot). |
| Screen right | the right foot. Its medial +Y faces the gap (toward screen-left of that foot). |
| Bottom camera | same up vector, from world −Y. Left and right swap on screen. That transposition is the view from underneath, not a geometry mirror. |

A sink that is medial in mesh Y therefore sits on the big-toe side of each
foot in the top view, toward the gap between the pair.

## Export

STL and CNC geometry stay in the footprint frame. They are not put through
the viewer Rx(−90°) and they are not mirrored again at write time.

- Left export: unmirrored stock. Medial is −Y.
- Right export: `mirrorGeometry` of that stock. Medial is +Y.
- Wall text is placed on the already-mirrored right mesh. It is not
  glyph-mirrored a second time.
- Empty sinks return before any vertex write, so a design with no sinks
  keeps the same export bytes.

## Sinks

Sink ovals are authored in anatomical space: `v = 0` is medial, `v = 1` is
lateral, and the smaller anatomical Y is medial. `meshYToAnatomical` uses
`medialYSign`, and when that sign is omitted it is `medialSign(side)`.
The viewer footprint uses `meshYFromAnatomicalLateral`, which is the same
sign. Both feet then put the 1st MPJ and the reverse kinetic wedge on the
medial edge, and the 5th MPJ and the styloid on the lateral edge.
