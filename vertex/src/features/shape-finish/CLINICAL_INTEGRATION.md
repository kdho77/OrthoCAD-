# Shape / Finish (Track 5b) — clinical rail integration

## Temporary mount (main without #168)

`ShapeFinishPanel` renders in **Right panel → Printing** tab only (`printing-tab-fallback`), gated by `shouldShowShapeFinishInPrintingTab()` in `shape-finish-mount.ts`.

## After PR #168 (clinical UX spine)

1. Set `CLINICAL_RAIL_PR168_AVAILABLE = true` in `shape-finish-mount.ts`.
2. Remove the fallback block from `RightPanel.tsx` (printing tab).
3. Import `ShapeFinishPanel` in:
   - **Shape step** panel (recommended primary), or
   - `ClinicalPrintStepPanel` **Advanced** section (`shouldShowShapeFinishInPrintAdvanced()`).

`ActiveFootSideBar` + `useActiveFootSide()` already drive per-foot edits; extend `ActiveFootSideBar` with `acknowledgeExplicitFootSide` when the clinical workflow store is present.
