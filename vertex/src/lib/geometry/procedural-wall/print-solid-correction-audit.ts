// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Print-solid correction audit (CAD-approved compose-once path).
 *
 * Viewer (Base / Scan): `useBaseInsoleGeometry` → `applyBaseModifiers(raw, baseModifierField)`.
 *   Kirby skive is a post-sync top-only raise (`includeSkives: false` in F, then R11).
 *
 * Print loft: compose once (`composePrintSolidTop`):
 *   width affine → applyBaseModifiers(full sourceField) → trimline clip
 *   → extractTopOnlyModel(composed) → reconstruct with composedTop (no analytic deltas).
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
        label: "Rearfoot / forefoot zone posting (wedge)",
        verdict: "survives",
        drop: "composePrintSolidTop → applyBaseModifiers wedgeDeltaAt. Loft skips applyAnalyticTopDeltas.",
        proposedFix: "Keep. Composed top is the loft source.",
    },
    {
        id: "heel-lift",
        label: "Heel lift",
        verdict: "survives",
        drop: "applyBaseModifiers / heelLiftDeltaAt on the composed top. Plantar stays z=0.",
        proposedFix: "Keep.",
    },
    {
        id: "heel-widen",
        label: "Heel widen (heelCupWidthMm)",
        verdict: "survives",
        drop: "applyBaseModifiers lateral heel-width delta on the composed top. Live pattern already follows.",
        proposedFix: "Keep.",
    },
    {
        id: "heel-cup-depth",
        label: "Heel cup depth / height",
        verdict: "survives",
        drop: "applyBaseModifiers heightAt heel cup on the composed top.",
        proposedFix: "Keep.",
    },
    {
        id: "arch-height",
        label: "Arch height / arch ease",
        verdict: "survives",
        drop: "applyBaseModifiers heightAt dome on the composed top.",
        proposedFix: "Keep.",
    },
    {
        id: "arch-apex",
        label: "Arch apex move (apexMoveMm alone)",
        verdict: "survives",
        drop: "compose-once always runs applyBaseModifiers; apexMoveMm is inside heightAt. Gate includes apexMoveMm.",
        proposedFix: "Keep.",
    },
    {
        id: "skive",
        label: "Kirby heel skive (medial / lateral + angle / location)",
        verdict: "survives",
        drop: "applyBaseModifiers R11 Kirby raise on the composed SAMPLE_Top (single-mesh topFactors path).",
        proposedFix: "Keep.",
    },
    {
        id: "flanges-correction",
        label: "Medial / lateral flange mm (SideCorrections)",
        verdict: "survives",
        drop: "applyBaseModifiers heightAt flange mm on the composed top. Gate includes flange mm.",
        proposedFix: "Keep.",
    },
    {
        id: "wedges",
        label: "Rearfoot / forefoot surface wedges",
        verdict: "survives",
        drop: "applyBaseModifiers wedgeDeltaAt on the composed top. Gate treats a present wedge as a top modifier.",
        proposedFix: "Keep.",
    },
    {
        id: "elements",
        label: "Placed elements (met pad, bar, …)",
        verdict: "survives",
        drop: "sourceField.elements + includeElements → heightAt → elementHeightAt with rim feathering.",
        proposedFix: "Keep.",
    },
    {
        id: "shape-finish",
        label: "Shape finish (top cover, trimmable forefoot, arch grind, arch skive)",
        verdict: "survives",
        drop: "sourceField.shapeFinish forwarded into applyBaseModifiers (same as viewer).",
        proposedFix: "Keep. Grind stays bottom-only; Print plantar is z=0.",
    },
    {
        id: "trimline",
        label: "Trimline edits / trim presets",
        verdict: "survives",
        drop: "clipGeometryToOutline on the composed top before extractTopOnlyModel / rim extraction.",
        proposedFix: "Keep.",
    },
    {
        id: "bottom-pattern",
        label: "Bottom pattern edits",
        verdict: "survives",
        drop: "useBaseInsoleGeometry resolveLiveBottomPattern → reconstruct options.bottomPattern.",
        proposedFix: "Keep.",
    },
    {
        id: "shoe-width",
        label: "Whole-insole shoe width",
        verdict: "survives",
        drop: "applyShoeWidthToGeometry uses the same affine as applyShoeWidthToPoints before modifiers.",
        proposedFix: "Keep.",
    },
    {
        id: "presets",
        label: "Correction presets / macros",
        verdict: "survives",
        drop: "Presets write SideCorrections / elements / thickness; compose-once applies those fields.",
        proposedFix: "Keep.",
    },
    {
        id: "thickness",
        label: "Device thickness",
        verdict: "survives",
        drop: "sourceField.thicknessMm through applyBaseModifiers. stockThicknessMm stays BASE_REFERENCE (2 mm).",
        proposedFix: "Keep.",
    },
];

export function auditRow(id: string): PrintSolidAuditRow {
    const row = PRINT_SOLID_CORRECTION_AUDIT.find((r) => r.id === id);
    if (!row) throw new Error(`unknown print-solid audit id: ${id}`);
    return row;
}
