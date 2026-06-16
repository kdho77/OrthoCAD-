# OrthoCAD — Sprint Plan
**Version:** 1.1
**Last updated:** 2026-06-15
**Based on:** Full codebase audit commit `3e73ef84`

Update this file at the end of every sprint.

---

## Sprint Status Legend
- ✅ COMPLETE — merged to main, smoke tested
- 🔄 IN PROGRESS — branch open, PR active
- ⏳ READY — unblocked, next in queue
- 🔒 BLOCKED — dependencies not met
- ⬜ FUTURE — planned, not yet started

---

## Completed Sprints

### Sprint 0 — Watertight STL Export ✅
**PR:** #98 | **Merged:** 2026-06-15 | **Commit:** `3e7fad9a`

**Delivered:**
- `extractBoundaryLoopsBranchedWithIndices` — handles degree>2 junction vertices
- `extractAllBoundaryCyclesWithIndices` — DFS walker for branched topology
- `resolveBottomRim()` — seals internal slit cycles, extracts outer 1184-vert rim
- Bridge: top[446] → bottom[1184] via cycle-index snapping
- Loading state: empty dark scene while GLB loads
- `buildExportGeometry` throws if no GLB (no parametric fallback)
- `buildExportStl` re-throws on error (no silent open mesh)
- Token deducted after successful download only

**Smoke test result:** PASS — open loops = 0 ✓ SOLID

---

### Sprint 0.1 — Side Label Fix ✅
**PR:** #99 | **Merged:** 2026-06-15

**Delivered:**
- Left/right side label inversion fixed in UI and STL filename
- Right selection now exports right geometry labeled correctly

---

## Active Sprint

### Sprint 1 — Corrections Alignment ⏳
**Branch:** `cursor/corrections-alignment-sprint1`
**PR:** #100 (to be opened)
**Goal:** Align store fields, clinical limits, and UI labels to
ARCHITECTURE.md spec. Stable field names unblock AI agent and
all downstream sprints.

**Scope:**
- [ ] Canonical field names aligned to ARCHITECTURE.md Section 3
- [ ] `heel_lift_mm` hard cap: 12mm (remove 20mm allow)
- [ ] `heel_cup_depth_mm` range: 0–18mm (warn below 10mm)
- [ ] Rearfoot post cap: 8° (currently 12° in constraints.ts)
- [ ] `heel_lift_taper_y_mm`: expose as user-settable input
- [ ] `arch_length_mm`: clarify vs `archFillMm`, implement if distinct
- [ ] STL filename: `{lastname}-{firstname}_{side}_{date}.stl`
- [ ] Export routing tests: fix 2 failing tests to match reality
- [ ] All existing tests still pass (935/937 baseline)

**Blocked by:** Nothing — ready to start

---

## Upcoming Sprints

### Sprint 2 — Trim Line Completion 🔒
**Blocked by:** Sprint 1 (field names must be stable first)
**Goal:** Independent top + bottom trim lines with presets
and live sidewall in both viewer modes.

**Scope:**
- [ ] Top trim presets: full, sulcus, met_head
- [ ] Bottom trim line: independent spline, user-editable
- [ ] Sidewall: live-computed in GLB base mode (currently export-only)
- [ ] Shoe type presets: standard, narrow, wide toe box, dress, sport

---

### Sprint 3 — Scan Ingest Pipeline 🔒
**Blocked by:** Sprint 1 (canonical frame definition stable)
**Goal:** Upload any patient scan → normalized → stored in
Supabase → registered to base → persistent.

**Scope:**
- [ ] Add GLB + PLY format support (STL/OBJ already work)
- [ ] Orientation detection + auto-rotate to canonical frame
- [ ] Scale normalization (mm)
- [ ] Wire `registration.ts` to `ScanImport` UI
- [ ] Server upload router + Supabase Storage per account
- [ ] Wire `scans` table (schema exists, not wired to UI)
- [ ] Landmark detection: heel, met heads, arch peak

---

### Sprint 4 — AI Agent Completion 🔒
**Blocked by:** Sprint 1 (field names), Sprint 3 (scan persistence)
**Goal:** Full prescription parser + natural language commands.

**Scope:**
- [ ] Parser extracts all ARCHITECTURE.md Section 9 fields
- [ ] Parsed elements placed at anatomical positions (not 0,0)
- [ ] Natural language command bar
- [ ] Programmatic API documentation

---

### Sprint 5 — Shell Orthotic Completion 🔒
**Blocked by:** Sprint 1 (corrections stable)
**Goal:** True zonal shell thickness model.

**Scope:**
- [ ] `shell_thickness_zones` store field + UI sliders
- [ ] Per-zone inner surface offset (not global OCCT shell)
- [ ] Smooth zone transitions (no step artifacts)
- [ ] Shell export produces correct variable-wall geometry

---

### Sprint 6 — Elements Completion 🔒
**Blocked by:** Sprint 1
**Goal:** Complete element type library + posting blocks
\+ true boolean union + organic point deformation.

**Scope:**
- [ ] Missing element types: scaphoid pad, heel cushion,
      dancer's pad, forefoot/rearfoot wedge elements
- [ ] Posting block system with seed library + grind angle (max 8°)
- [ ] True CAD boolean for custom GLB elements
- [ ] Organic point deformation (not Z-nudge only)
- [ ] Scale 1D gizmo (true single-axis)

---

### Sprint 7 — User Library Completion 🔒
**Blocked by:** Sprint 6 (element types stable)
**Goal:** Unified personal library for all item types.

**Scope:**
- [ ] `user_library_items` table (migration from custom_elements/prefabs)
- [ ] Personal tab + System tab (read-only)
- [ ] Save complete design, correction preset, posting preset
- [ ] Account scoping: RLS + application layer

---

### Sprint 8 — Material Zones + G-code Completion 🔒
**Blocked by:** Sprint 7 (library stable)
**Goal:** Per-zone infill for print, multi-pass CNC.

**Scope:**
- [ ] Material zone boundary splines
- [ ] Per-zone: infill %, wall count, material hardness
- [ ] FDM G-code: per-zone slicer settings
- [ ] CNC G-code: roughing + finishing passes, tool change markers
- [ ] Zone painter in viewer

---

### Sprint 9 — Patient Data + Clinical Workflow 🔒
**Blocked by:** Sprint 3 (scan persistence)
**Goal:** Persistent patient records, server-synced designs.

**Scope:**
- [ ] Patient DOB + scan history linkage
- [ ] Wire `SaveControl` to tRPC `design.save` (currently local only)
- [ ] Multi-device: designs load from server not localStorage
- [ ] Multi-clinic isolation: `clinic_id` on all records

---

### Sprint 10 — Annotation + Mobile ⬜
**Future — not blocking clinical deployment**

**Scope:**
- [ ] Measurement / annotation tools in viewer
- [ ] Mobile-responsive layout

---

## Audit Snapshot (2026-06-15, commit `3e73ef84`)

### DONE (15 items)
1. Production method selector (solid/shell/3-axis) → store + geometry
2. Core corrections (arch, heel cup, heel lift, wedges, skives) → wired
3. Top trimline spline editor (live preview, confirm/cancel)
4. Element placement (8 stock types, drag gizmos, numeric entry)
5. STL watertight export (mesh-close + OCCT sew)
6. GLB export with trimline-mesh sidewalls
7. FDM G-code (Kiri engine + hybrid belt server path)
8. CNC 3-axis raster G-code (single pass)
9. AI prescription upload + parse + applyPrescription
10. Custom element/prefab library (Supabase storage)
11. Stock base GLB system
12. Auth, tokens, licenses, audit logs, AdminPortal
13. Undo/redo, paired L/R viewer, orbit + view presets
14. OCCT WASM kernel + geometry/occt workers
15. Scan import UI (STL/OBJ viewer overlay — local only)

### PARTIAL (18 items)
See ARCHITECTURE.md Section 12 for full list and field name map.

### GAPS (14 items)
1. Shell thickness zones (forefoot/midfoot/rearfoot mm)
2. PLY format + GLB as foot scan input
3. Landmark detection
4. Scan → Supabase Storage per account
5. Bottom trim line with presets + spline editor
6. Posting block system
7. Missing element types (scaphoid, dancer's, heel cushion)
8. Material zone system
9. Natural language command interface
10. `user_library_items` table + correction/posting presets
11. Multi-clinic / org isolation
12. Patient DOB + scan history
13. Annotation / measurement tools
14. Mobile-responsive layout

---

*Update this file at the end of every sprint by checking off
completed items and moving the sprint to the Completed section.*
