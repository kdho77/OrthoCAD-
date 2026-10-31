# One-click scan + Rx generation — reuse audit (2026-10-31)

## Objective

Orchestrate existing scan measurement, registration, parametric fit, and Rx parsing into a single **Generate Orthotic** transaction without replacing geometry engines or the SAMPLE_Top stock mesh.

## Existing modules (reuse)

| Area | Module | Role in one-click flow |
|------|--------|------------------------|
| Scan import / cleanup | `ScanImport.tsx`, `scan-components.ts`, `ScanCleanupPanel.tsx` | Import, component keep-set, slice planes (unchanged) |
| Landmark suggest | `scan-landmark-suggest.ts` | M1/M2/M3 heuristics — **extended** with ARCH apex suggest |
| Foot measures | `measure-foot-from-scan.ts` | Length, ball width, shoe size suggestion |
| Registration | `scan-registration-wire.ts`, `scan-store` `computeRegistration` | Dorsal + Kabsch + side ID — **extracted** to `scan-registration-compute.ts` for pure tests |
| Arch / heel fit | `fit-arch-from-scan.ts`, `fit-scan-clinical-params.ts`, `match-design-from-scan.ts` | Size-scaled reference, marker arch raise, gap-fit fallback, heel cup width |
| Rx parse | `parse-service.ts`, `heuristic.ts`, server AI | Text/image Rx → `PrescriptionParseResult` |
| Design apply | `design-store.applyPrescription`, `updateCorrection`, `constrainSideCorrections` | Parametric patches only |
| Clinical UI rail | `clinical-workflow-store`, `ClinicalScanStepPanel` | **Generate Orthotic** panel added on Scan step |
| Constraints | `clinical-constraints.ts` | Clamp + violation reporting after merge |
| Presets | `correction-presets.ts` | Not auto-applied; Rx explicit params only |
| Stock base | `base-asset.ts`, SAMPLE_Top | Unchanged mesh; sizing via existing layout maps |

## Gaps addressed in this branch

1. **Unified service** — `generateOrthoticFromScanAndRx()` composes scan analysis, fit, Rx merge, and constraint clamp in one deterministic result (no partial design on failure).
2. **ARCH auto-suggest** — Medial midfoot apex on cleaned scan; low confidence → review item, not silent registration.
3. **Gap-fit fallback** — When ARCH marker is absent but gap-fit is reliable, use `fitArchParamsFromScan` (existing solver); marker path preferred when ARCH is placed/suggested with high confidence.
4. **Rx vs scan merge** — Explicit Rx correction keys override scan-derived anatomy fit; scan never invents posting/skives/wedges.
5. **Medial/lateral** — Central `medialSign()` + tests on landmark Y ordering for L/R.
6. **UI** — Prominent generate control, summary of measures, Rx, warnings, restore via design checkpoint.

## Out of scope (per brief)

- Licensing, tokens, VertexSlice/slicer, SAMPLE_Top mesh edits, Print Farm branch.
- AI mesh generation or using scan surface as the insole.
- Changing shoe-size conversion formulas or width delta table (still 5 mm steps vs Medium).

## Risks / limitations (v1)

- Bilateral **different shoe sizes** share one design size field — second foot warns when suggestion diverges >0.5 US.
- Element kinds from Rx are **review suggestions** (same as `applyPrescription` — placement stays in Elements library).
- Image-only Rx requires configured AI server; offline uses heuristic text parser.
- Gap-fit arch remains sensitive to registration RMS and medial plantar coverage; high RMS blocks generation.
