// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Print-solid correction audit (no geometry change — CAD sign-off required).
 *
 * Viewer (Base / Scan): `useBaseInsoleGeometry` → `applyBaseModifiers(raw, baseModifierField)`.
 *   Kirby skive is a post-sync top-only raise (`includeSkives: false` in F, then R11).
 *
 * Print loft: `useBaseInsoleGeometry` passes the **unmodified** SAMPLE_Top clone
 *   (`baseGeoRef` / `raw`) into `reconstructProceduralPreviewInWorker`.
 *   `reconstructProceduralPreview` (`sample-top-preview.ts`) does **not** pass
 *   `sourceGeometry` / `sourceField`, so `reconstructProceduralWalls` never
 *   steals a modifier-applied top. It copies the native top and runs
 *   `applyAnalyticTopDeltas` only when `hasCurveOrTopModifiers` is true.
 *
 * `applyAnalyticTopDeltas` builds a HeightField with `includeSkives: false`,
 * `elements: []`, and no `shapeFinish`.
 */

export type PrintSolidAuditVerdict = "survives" | "lost" | "partial";

export interface PrintSolidAuditRow {
    id: string;
    label: string;
    verdict: PrintSolidAuditVerdict;
    /** Where the Print build drops or keeps the correction. */
    drop: string;
    proposedFix: string;
}

export const PRINT_SOLID_CORRECTION_AUDIT: PrintSolidAuditRow[] = [
    {
        id: "posting",
        label: "Rearfoot / forefoot posting (deg)",
        verdict: "survives",
        drop: "hasCurveOrTopModifiers + applyAnalyticTopDeltas + postingZDelta / clampPostingOnTopSheet in reconstruct.ts",
        proposedFix: "Keep. Confirm clampPostingOnTopSheet does not silently zero small posts.",
    },
    {
        id: "heel-lift",
        label: "Heel lift",
        verdict: "survives",
        drop: "hasCurveOrTopModifiers includes heelLiftMm; applyAnalyticTopDeltas uses heightAt (heelLiftDeltaAt). Plantar stays z=0.",
        proposedFix: "Keep. Viewer and Print both raise the top only.",
    },
    {
        id: "heel-widen",
        label: "Heel widen (heelCupWidthMm)",
        verdict: "survives",
        drop: "applyAnalyticTopDeltas scales top Y; pattern follow in reconstructProceduralWalls when live pattern is passed.",
        proposedFix: "Keep. Do not pass a stale auto-pattern that predates widen.",
    },
    {
        id: "heel-cup-depth",
        label: "Heel cup depth / height",
        verdict: "survives",
        drop: "hasCurveOrTopModifiers + heightAt heelCupDepthBowlDelta / heelCupHeightMm in applyAnalyticTopDeltas.",
        proposedFix: "Keep.",
    },
    {
        id: "arch-height",
        label: "Arch height / arch fill",
        verdict: "survives",
        drop: "hasCurveOrTopModifiers + heightAt dome in applyAnalyticTopDeltas. This is the analytic F, not applyBaseModifiers.",
        proposedFix: "Keep. Compare magnitudes to viewer applyBaseModifiers before retuning.",
    },
    {
        id: "arch-apex",
        label: "Arch apex move (apexMoveMm alone)",
        verdict: "lost",
        drop: "apexMoveMm is used inside heightAt only when the analytic pass runs. hasCurveOrTopModifiers ignores apexMoveMm, so an apex-only edit never triggers applyAnalyticTopDeltas. reconstruct.ts:hasCurveOrTopModifiers / applyAnalyticTopDeltas.",
        proposedFix: "Add apexMoveMm !== 0 to hasCurveOrTopModifiers. Do not change F until CAD sign-off.",
    },
    {
        id: "skive",
        label: "Kirby heel skive (medial / lateral + angle / location)",
        verdict: "lost",
        drop: "Viewer applies kirbySkiveRaiseAt after applyBaseModifiers (base-modifier.ts ~2914). Print applyAnalyticTopDeltas hard-sets includeSkives:false and hasCurveOrTopModifiers ignores medialSkiveMm/lateralSkiveMm. Worker is given unmodified SAMPLE_Top (useBaseInsoleGeometry.ts reconstructProceduralPreviewInWorker(raw)).",
        proposedFix:
            "After CAD sign-off: include skive in hasCurveOrTopModifiers and apply the same R11 Kirby raise on the Print top sheet (or pass modifier-applied top as sourceGeometry without extractTopSheet-on-combined).",
    },
    {
        id: "flanges-correction",
        label: "Medial / lateral flange mm (SideCorrections)",
        verdict: "lost",
        drop: "heightAt includes flange mm, but hasCurveOrTopModifiers ignores medialFlangeMm/lateralFlangeMm, so the analytic pass never runs for flange-only edits. Viewer lateralFlangeHeightMm is a separate Print dropdown (does survive as reconstruct options.lateralFlange).",
        proposedFix:
            "Include flange mm in hasCurveOrTopModifiers, or map correction flanges onto reconstruct lateralFlange.",
    },
    {
        id: "wedges",
        label: "Rearfoot / forefoot surface wedges",
        verdict: "lost",
        drop: "wedgeDeltaAt lives in heightAt, but hasCurveOrTopModifiers ignores rearfootWedge/forefootWedge. Print never starts the analytic pass for a wedge-only design.",
        proposedFix: "Treat a present wedge as a curve/top modifier in hasCurveOrTopModifiers.",
    },
    {
        id: "elements",
        label: "Placed elements (met pad, bar, …)",
        verdict: "lost",
        drop: "applyAnalyticTopDeltas sets elements: []. reconstructProceduralPreview does not forward design.elements.",
        proposedFix: "Pass merged elements into ReconstructOptions / HeightFieldParams after CAD sign-off.",
    },
    {
        id: "shape-finish",
        label: "Shape finish (top cover, trimmable forefoot, arch grind, arch skive)",
        verdict: "lost",
        drop: "applyBaseModifiers applies shapeFinish (base-modifier.ts ~2864). applyAnalyticTopDeltas builds a field with no shapeFinish. reconstruct archGrindDepthMm only selects wall style (plantarZDelta is 0). Defaults (topCover 1.25, trimmable +5) are why the viewer badge says modifiers applied.",
        proposedFix:
            "Forward getSideShapeFinish into the Print field, or apply shape-finish after the loft. Grind must not offset plantar (already flat).",
    },
    {
        id: "trimline",
        label: "Trimline edits / trim presets",
        verdict: "lost",
        drop: "Viewer clips with clipGeometryToOutline on the non-Print path. Print reconstruct never receives the trimline; outline is the faired/live bottom pattern only.",
        proposedFix: "Clip or retarget the Print top/pattern to the committed trimline after CAD sign-off.",
    },
    {
        id: "bottom-pattern",
        label: "Bottom pattern edits",
        verdict: "survives",
        drop: "useBaseInsoleGeometry resolveLiveBottomPattern → reconstruct options.bottomPattern. Worker copies the polyline.",
        proposedFix: "Keep. Ensure a remount does not replace an edited pattern with auto.",
    },
    {
        id: "shoe-width",
        label: "Whole-insole shoe width",
        verdict: "partial",
        drop: "Viewer scales the pattern (applyShoeWidthToPoints) and keeps native SAMPLE_Top (no scaleGeometryToInsoleSize on procedural). Print gets the live pattern (width baked) but insoleWidthScale is never passed, so the top sheet stays native width.",
        proposedFix:
            "Pass insoleWidthScale from shoeWidthForSide into reconstructProceduralPreview after CAD sign-off.",
    },
    {
        id: "presets",
        label: "Correction presets / macros",
        verdict: "partial",
        drop: "Presets only write SideCorrections / elements / thickness (correction-presets.ts). Thickness, posting, lift, cup, arch height survive; skive / apex-only / wedges / elements / shape-finish in the payload follow their own verdicts.",
        proposedFix: "No preset-specific Print path. Fix the lost fields those presets write.",
    },
    {
        id: "thickness",
        label: "Device thickness",
        verdict: "survives",
        drop: "hasCurveOrTopModifiers treats thicknessMm !== stockThicknessMm. applyAnalyticTopDeltas adds the F thickness delta.",
        proposedFix: "Keep. stockThicknessMm must stay BASE_REFERENCE (2 mm) so a 3 mm device still raises.",
    },
];

export function auditRow(id: string): PrintSolidAuditRow {
    const row = PRINT_SOLID_CORRECTION_AUDIT.find((r) => r.id === id);
    if (!row) throw new Error(`unknown print-solid audit id: ${id}`);
    return row;
}
