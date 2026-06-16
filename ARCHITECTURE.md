# OrthoCAD — Master Architecture Document
**Version:** 1.1
**Date:** 2026-06-15
**Status:** Approved design basis — all Cursor prompts and
sprint work derived from this document.
Any deviation requires an explicit update here first.

---

## 1. Product Taxonomy

### Device Types
| Type | Description |
|------|-------------|
| **Solid Orthotic** | EVA/foam-equivalent solid body, flat bottom, total contact with shoe last, variable-density infill zones, corrections integral to body geometry |
| **Shell Orthotic** | Thin shell following foot contour, variable wall thickness per zone (not uniform), open bottom (inner surface offset from outer), posting blocks on inner surface |

### Manufacturing Paths (both device types)
| Path | Output |
|------|--------|
| FDM 3D Print — belt printer | G-code with per-zone infill/wall settings |
| CNC Mill | G-code toolpath (3-axis default, 5-axis optional) |
| STL | Binary STL for external slicers |

### Top Surface Origin
| Source | Description |
|--------|-------------|
| Scan-derived | Patient foot scan ingested, aligned, corrections applied as deformations on real geometry |
| Prefab model | Library base shape, parametric adjustments applied |

Both paths converge to the same internal representation after ingest/generation.

---

## 2. Coordinate System & Scan Ingest

### Canonical Coordinate Frame
X: Medial (+) → Lateral (-)

Y: Posterior/heel (0) → Anterior/toe (+)

Z: Plantar (0) → Dorsal (+)

Origin: Plantar heel contact point

### Supported Input Formats
- **Primary:** GLB, OBJ (iOS TrueDepth/LiDAR via Polycam/Scandy)
- **Also supported:** STL, PLY
- **Scanners:** Artec, Shining3D, photogrammetry, Amfit-export, any scanner producing above formats

### Ingest Pipeline
1. Format detection and parse
2. Orientation detection (plantar-up vs dorsal-up) + auto-rotate to canonical frame
3. Scale normalization — normalize to mm (GLB often exports in meters)
4. Landmark detection (AI-assisted, user-confirmable)
   - Posterior heel centroid → Y=0 origin
   - First and fifth met heads → forefoot reference plane
   - Medial arch peak → arch landmark
5. Mesh cleanup — fill small holes (<5mm), remove floating fragments, light smoothing
6. Registration to canonical frame
7. Store as canonical scan mesh in Supabase Storage (per account)

---

## 3. Core Data Model

### Design Record (persisted to Supabase)
design_id

patient_id

side: 'left' | 'right'

device_type: 'solid' | 'shell'

source_type: 'scan' | 'prefab'

source_asset_id       → storage ref (original scan, immutable)

canonical_mesh_id     → storage ref (post-ingest normalized mesh)

parameter_block       → JSON (versioned, see below)

### Parameter Block (JSON, versioned)

**Top Surface**
arch_height_mm          number        0–18mm (warn below 10mm clinical)

arch_apex_y_mm          number        anterior/posterior apex position

arch_length_mm          number        heel-to-apex distance

heel_cup_depth_mm       number        0–18mm

heel_cup_width_mm       number

rearfoot_wedge_deg      number        + medial / - lateral

forefoot_wedge_deg      number        + medial / - lateral

heel_lift_mm            number        max 12mm hard cap

heel_lift_taper_y_mm    number        taper end point (user-settable)

**Top Trim Line**
trim_preset             'full' | 'sulcus' | 'met_head' | 'custom'

trim_spline             SplinePoint[]   XY perimeter in mm

**Bottom Surface**
bottom_flat             true            always for solid orthotic

bottom_trim_preset      'full' | 'narrow' | 'custom'

bottom_trim_spline      SplinePoint[]

**Shell Parameters (shell device only)**
shell_thickness_zones: {

forefoot_mm           number   default 2.5

midfoot_mm            number   default 3.0

rearfoot_mm           number   default 2.75

transition_blend_mm   number   default 10.0

}

**Material Zones**
zones: MaterialZone[]

zone_id, name, boundary_spline,

infill_pct, wall_count, material_hardness

**Elements**
elements: OrthoticElement[]   (see Section 4)

**Posting Blocks (shell only)**
posts: PostingBlock[]   (see Section 5)

### Versioning
- Every parameter change creates a version snapshot
- Undo/redo = walk version stack
- Versions stored as JSON diffs, not full copies

---

## 4. Orthotic Elements

### Element Model
```typescript
OrthoticElement {
  element_id:       string
  library_seed_id:  string           // ref to seed mesh in library
  name:             string
  position_xy:      [number, number] // mm from canonical origin
  rotation_deg:     number           // in XY plane
  scale_1d:         { axis: 'x'|'y'|'z', factor: number }[]
  scale_2d:         { axes: 'xy'|'xz'|'yz', factors: [number,number] }[]
  control_points:   ControlPoint[]   // for shape deformation
  height_mm:        number           // extrusion above surface
  blend_radius_mm:  number           // transition to top surface
}
```

### Standard Element Library (system-provided seeds)
- Metatarsal pad (teardrop, round, neuroma variants)
- Metatarsal bar (transverse, full-width)
- Scaphoid pad
- Heel cushion insert
- Morton's extension / Reverse Morton's
- Dancer's pad
- Kinetic wedge
- Cluffy wedge
- Forefoot wedge element
- Rearfoot wedge element

### Element Manipulation Tools
| Tool | Input |
|------|-------|
| Translate | Drag on surface or mm entry |
| Rotate | Spin in XY plane or deg entry |
| Scale 1D | Single-axis stretch — length or width independently |
| Scale 2D | Two-axis scale — footprint size, uniform or non-uniform |
| Point deform | Grab control point, reshape organically |

All transforms numeric-enterable (not gesture-only).

### User Library Elements
- Save to personal library with name and category
- Stored as: seed mesh GLB + default parameter block
- Never pushed to system library without explicit publish action
- Scoped to account_id in Supabase

---

## 5. Posting Blocks (Shell Orthotic)

### Hybrid Parametric Model
Seed shape from library (clinically validated topology)
\+ parametric deformation — NOT pure generation from equations.

```typescript
PostingBlock {
  post_id:              string
  type:                 'rearfoot' | 'forefoot' | 'combined'
  seed_id:              string    // library seed mesh
  position:             'medial' | 'lateral' | 'full_width'
  height_mm:            number
  grind_angle_deg:      number    // max 8° — DO NOT EXCEED without override
  width_mm:             number
  length_mm:            number
  taper_anterior_mm:    number    // blend into shell
  attachment:           'integral' | 'bonded'
}
```

### Clinical Defaults
| Post | Default |
|------|---------|
| Valgus (pronation control) | Medial, 4° grind, neutral |
| Varus (supination control) | Lateral, 4° grind, neutral |
| Maximum functional post | 8° — require explicit override above this |

---

## 6. Geometry Pipeline

### Layer Stack (both device types)
┌──────────────────────────────────────────────────────┐

│  LAYER 0: Canonical source mesh (IMMUTABLE)          │

│           Scan GLB or prefab base model              │

├──────────────────────────────────────────────────────┤

│  LAYER 1: Top surface                                │

│           Source mesh + parametric corrections       │

│           Trimmed by top_trim_spline                 │

├──────────────────────────────────────────────────────┤

│  LAYER 2: Elements                                   │

│           Boolean union onto top surface             │

│           Each element independently transformed     │

├──────────────────────────────────────────────────────┤

│  LAYER 3: Bottom surface                             │

│           Solid: flat plane, bottom_trim_spline      │

│           Shell: inner offset of top at              │

│                  zone-variable thickness             │

│           Trimmed independently from top               │

├──────────────────────────────────────────────────────┤

│  LAYER 4: Sidewall (LIVE COMPUTED)                   │

│           Closes gap between top rim and             │

│           bottom rim dynamically                     │

│           Rebuilt on every trim change               │

├──────────────────────────────────────────────────────┤

│  LAYER 5: Posting blocks (shell only)                │

│           Attached to inner surface                  │

│           Parametric seed deformation                │

├──────────────────────────────────────────────────────┤

│  LAYER 6: Material zone boundaries                   │

│           Spline-defined regions                     │

│           Drive slicer settings on export            │

└──────────────────────────────────────────────────────┘

### Sidewall Algorithm
Inputs:  topRim (ordered 3D loop), botRim (ordered 3D loop)

Steps:

Project both rims to XY plane
Find closest-point alignment (no fixed start index)
Resample to common vertex count N = max(both)
Build quad strip: top[i]→bot[i]→bot[i+1]→top[i+1]
Verify watertight (open edges = 0)
Smooth sidewall normals at junctions

Trigger: any change to top_trim_spline or bottom_trim_spline


---

## 7. Manipulation Tools

Applies to: insole body, elements, posting blocks, trim lines.

| Tool | Target | Input |
|------|--------|-------|
| Translate | element, post | XY drag or mm entry |
| Rotate | element, post | drag or deg entry |
| Scale 1D | element, post, insole body | axis selector + factor or mm |
| Scale 2D | element, post, insole body | axis pair + factors or mm |
| Point deform | element, post, trim spline | grab control point, drag |
| Numeric entry | all parameters | direct mm / deg input |
| Arch adjust | top surface | height, apex Y, length |
| Heel cup | top surface | depth mm, width mm |
| Wedge | top surface | deg, medial/lateral |
| Heel lift | top surface | mm + taper length mm |
| Shell thickness | shell zones | mm per zone |
| Trim line edit | top or bottom rim | point grab or preset |

**All tools addressable programmatically (AI agent parity).**

---

## 8. User Library

### Item Types
| Type | Description |
|------|-------------|
| Complete design | Full parameter block + mesh snapshots |
| Element | Seed mesh + default params + name/category |
| Posting block preset | Seed mesh + param defaults |
| Correction preset | Named parameter block subset |
| Material zone template | Named zone layout |

### Storage
Supabase table: user_library_items

item_id, account_id, item_type, name, category,

thumbnail_url, mesh_asset_id, param_defaults (JSON),

created_at, updated_at, is_public (default false)
Asset storage: Supabase Storage bucket per account

Scoped by account_id — no cross-account access

System library: separate bucket, read-only to all accounts

### Rules
- Personal library: account-scoped items only
- System library: Anthropic/admin-curated seeds, read-only
- Save to personal library: one click from any design or element
- **Never auto-publish to system library**

---

## 9. AI Agent API

### Principle
Agent calls the **same parameter setters as the UI**.
No agent-only code paths. Full parity.

### Entry Points
1. Prescription upload → parse → populate parameter block
2. Natural language command → map to parameter setter(s)
3. Measurement input → compute parameters → apply

### Natural Language Examples
"Add 3mm to the rearfoot heel lift"     → heel_lift_mm += 3

"Set arch height to 18mm"               → arch_height_mm = 18

"Move the met pad 5mm anterior"         → elements[met_pad].position_xy[1] += 5

"Widen the heel cup to 52mm"            → heel_cup_width_mm = 52

"3 degrees valgus forefoot wedge"       → forefoot_wedge_deg = 3

"Sulcus length trim"                    → trim_preset = 'sulcus'

---

## 10. Export Pipeline

| Target | Format | Notes |
|--------|--------|-------|
| STL | Binary STL | Watertight, clinical filename |
| FDM 3D Print | G-code | Per-zone infill, belt printer orientation |
| CNC Mill | G-code | Roughing + finishing, tool change markers |
| GLB | GLB | Viewer-compatible, not for print |

### Clinical Filename Format
{patient-lastname}-{patient-firstname}{side}{YYYY-MM-DD}.stl

Example: smith-john_right_2026-06-15.stl

---

## 11. Permanent Constraints

### Clinical (non-negotiable)
SMOOTH_INWARD_LIMIT_MM = 3.0              — never change

assertRimContactIndicesInRange            — never remove

Heel lift hard cap: 12mm                  — require explicit override above

Rearfoot post hard cap: 8°                — require explicit override above

Arch corrections: relative to patient landmarks, not absolute coords

Shell thickness minimum: 1.5mm            — below this = print failure risk

### Architectural (non-negotiable)
Export: NO parametric fallback — GLB source required

Export: throws on error — no silent open mesh fallback

Export: NO buildInsoleSolid on export path

Sidewall: live computed — never manually edited

Layer 0 source mesh: always immutable

User library: never auto-published to system library

Agent API: no special paths — uses same setters as UI

### Manufacturing
Bottom surface: always watertight before G-code generation

Zone boundaries: must not create non-manifold geometry

CNC minimum tool radius consideration: 1.5mm ball default

---

## 12. Implementation Notes (current codebase, as of audit 2026-06-15)

### Field Name Map (store → architecture spec)
| Store field | Architecture field | Status |
|-------------|-------------------|--------|
| `apexMoveMm` | `arch_apex_y_mm` | Alias needed |
| `archFillMm` | `arch_length_mm` | Clarify distinction |
| `heelLiftMm` | `heel_lift_mm` | Rename or alias |
| `heelCupDepthMm` | `heel_cup_depth_mm` | Rename or alias |
| `design.method` | `device_type` | Extend, not replace |

### Known Deviations (to be corrected in Sprint 1)
- `heel_lift_mm` UI allows 0–20mm (spec: max 12mm hard cap)
- `heel_cup_depth_mm` UI allows 0–10mm (spec: 0–18mm)
- `heel_lift_taper_y_mm` is hardcoded at 75% length (spec: user input)
- STL filename is timestamp-only (spec: clinical naming)
- Export routing tests (2) reference OCCT path not currently invoked

---

*This document is the single source of truth for OrthoCAD architecture.
Update this file before changing any architectural decision.
All Cursor agent prompts reference this document by section number.*
