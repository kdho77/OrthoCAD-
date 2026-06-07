// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { SideCorrections } from "@/types";

/**
 * Clinical production constraints for orthotic insole design.
 *
 * These limits exist to keep manufactured devices within safe structural,
 * printing, and biomechanical bounds (TPU belt/solid printing, 3-axis milling,
 * minimum wall for fatigue life, posting angles that do not create knife-edge
 * sections, etc.). They are intentionally conservative for a general clinic;
 * individual labs may tighten further via configuration in later phases.
 *
 * Phase 3A: hard clamping on every mutation path + lightweight violation
 * reporting. No "override" mode yet (that would be a deliberate logged action).
 */

export const CLINICAL_LIMITS = {
    thicknessMm: { min: 1.5, max: 8.0 },
    forefootPostingDeg: { min: -12, max: 12 },
    rearfootPostingDeg: { min: -10, max: 10 },
    medialSkiveMm: { min: 0, max: 7.0 },
    lateralSkiveMm: { min: 0, max: 7.0 },
    archHeightMm: { min: 0, max: 18.0 },
    archFillMm: { min: 0, max: 12.0 },
    heelCupHeightMm: { min: 0, max: 12.0 },
    heelCupDepthMm: { min: 0, max: 10.0 },
    apexMoveMm: { min: -12, max: 12 },
    medialFlangeMm: { min: 0, max: 8.0 },
    lateralFlangeMm: { min: 0, max: 8.0 },
} as const;

export const MIN_WALL_MM = 1.6; // absolute production minimum wall after all shaping

export interface ConstraintViolation {
    field: keyof SideCorrections | "thickness" | "combined";
    message: string;
    /** The value that was requested before clamping. */
    requested?: number;
    /** The value that was applied after clamping. */
    applied?: number;
}

export interface ConstrainResult {
    constrained: SideCorrections;
    thicknessMm: number;
    violations: ConstraintViolation[];
}

/** Clamp a scalar to [min, max]. Record violation if it changed. */
function clamp(
    value: number,
    min: number,
    max: number,
    field: ConstraintViolation["field"],
): { value: number; violation?: ConstraintViolation } {
    if (value < min) {
        return {
            value: min,
            violation: { field, message: `Clamped to minimum ${min}`, requested: value, applied: min },
        };
    }
    if (value > max) {
        return {
            value: max,
            violation: { field, message: `Clamped to maximum ${max}`, requested: value, applied: max },
        };
    }
    return { value };
}

/**
 * Apply clinical limits to a SideCorrections patch (or full set) and the design
 * thickness. Returns a fully constrained copy plus any violations that were
 * corrected. This is the single choke point for safe design mutations in 3A.
 *
 * Combined-wall heuristic: when thickness + heel cup depth + negative (inverted)
 * posting would produce < MIN_WALL in the rear-medial or rear-lateral zones, we
 * reduce the most aggressive contributor (prefer reducing cup depth first, then
 * arch/height contributions, then posting magnitude). This is approximate (the
 * true height field + trimline determine final local thickness) but good enough
 * to prevent the most common "impossible shell" states during interactive editing.
 */
export function constrainSideCorrections(
    corrections: SideCorrections,
    thicknessMm: number,
): ConstrainResult {
    const v: ConstraintViolation[] = [];

    let t = thicknessMm;
    const tc = clamp(t, CLINICAL_LIMITS.thicknessMm.min, CLINICAL_LIMITS.thicknessMm.max, "thickness");
    t = tc.value;
    if (tc.violation) v.push(tc.violation);

    const c: SideCorrections = { ...corrections };

    // Scalar clamps
    const pairs: Array<[keyof SideCorrections, { min: number; max: number }]> = [
        ["forefootPostingDeg", CLINICAL_LIMITS.forefootPostingDeg],
        ["rearfootPostingDeg", CLINICAL_LIMITS.rearfootPostingDeg],
        ["medialSkiveMm", CLINICAL_LIMITS.medialSkiveMm],
        ["lateralSkiveMm", CLINICAL_LIMITS.lateralSkiveMm],
        ["archHeightMm", CLINICAL_LIMITS.archHeightMm],
        ["archFillMm", CLINICAL_LIMITS.archFillMm],
        ["heelCupHeightMm", CLINICAL_LIMITS.heelCupHeightMm],
        ["heelCupDepthMm", CLINICAL_LIMITS.heelCupDepthMm],
        ["apexMoveMm", CLINICAL_LIMITS.apexMoveMm],
        ["medialFlangeMm", CLINICAL_LIMITS.medialFlangeMm],
        ["lateralFlangeMm", CLINICAL_LIMITS.lateralFlangeMm],
    ];

    for (const [key, lim] of pairs) {
        const raw = (c as any)[key] as number;
        const res = clamp(raw, lim.min, lim.max, key);
        (c as any)[key] = res.value;
        if (res.violation) v.push(res.violation);
    }

    // Combined wall guard (very conservative rearfoot check).
    // Effective rear wall rough estimate: thickness - max(0, heelCupDepth) + small posting lift term.
    // If too thin, pull back the largest "eater" of material.
    const rearCup = Math.max(0, c.heelCupDepthMm);
    const rearPostingEffect = Math.max(0, -c.rearfootPostingDeg) * 0.12; // approx mm lift per deg (conservative)
    const approxRearWall = t - rearCup + rearPostingEffect;

    if (approxRearWall < MIN_WALL_MM) {
        const deficit = MIN_WALL_MM - approxRearWall;
        // Reduce cup depth first (most common over-edit).
        if (c.heelCupDepthMm > 0) {
            const reduce = Math.min(deficit, c.heelCupDepthMm);
            c.heelCupDepthMm -= reduce;
            v.push({
                field: "combined",
                message: `Reduced heelCupDepthMm by ${reduce.toFixed(1)} mm to maintain ≥ ${MIN_WALL_MM} mm wall`,
                requested: corrections.heelCupDepthMm,
                applied: c.heelCupDepthMm,
            });
        }
        // Still short? Reduce arch height contribution (affects rear transition).
        if (t - Math.max(0, c.heelCupDepthMm) + rearPostingEffect < MIN_WALL_MM && c.archHeightMm > 0) {
            const reduce = Math.min(1.5, c.archHeightMm * 0.3);
            const before = c.archHeightMm;
            c.archHeightMm = Math.max(0, c.archHeightMm - reduce);
            v.push({
                field: "combined",
                message: `Reduced archHeightMm to protect minimum wall in rearfoot`,
                requested: before,
                applied: c.archHeightMm,
            });
        }
        // Last resort: tone down negative rear posting.
        if (t - Math.max(0, c.heelCupDepthMm) + Math.max(0, -c.rearfootPostingDeg) * 0.12 < MIN_WALL_MM) {
            const before = c.rearfootPostingDeg;
            c.rearfootPostingDeg = Math.min(0, c.rearfootPostingDeg + 3);
            v.push({
                field: "combined",
                message: `Limited rearfootPostingDeg (negative) to protect wall thickness`,
                requested: before,
                applied: c.rearfootPostingDeg,
            });
        }
    }

    // Arch total (height + fill) should not create an excessively tall rigid column on thin shells.
    const archTotal = c.archHeightMm + c.archFillMm;
    if (t < 3.5 && archTotal > 14) {
        const scale = 14 / archTotal;
        const ahBefore = c.archHeightMm;
        const afBefore = c.archFillMm;
        c.archHeightMm = Math.round(c.archHeightMm * scale * 10) / 10;
        c.archFillMm = Math.round(c.archFillMm * scale * 10) / 10;
        v.push({
            field: "combined",
            message: `Scaled arch features for thin shell (thickness ${t.toFixed(1)} mm)`,
            requested: ahBefore + afBefore,
            applied: c.archHeightMm + c.archFillMm,
        });
    }

    return { constrained: c, thicknessMm: t, violations: v };
}

/** Convenience: constrain a full Corrections block (both sides) + thickness. */
export function constrainDesignCorrections(
    left: SideCorrections,
    right: SideCorrections,
    thicknessMm: number,
    linked: boolean,
): { left: SideCorrections; right: SideCorrections; thicknessMm: number; violations: ConstraintViolation[] } {
    const r1 = constrainSideCorrections(left, thicknessMm);
    let r2 = constrainSideCorrections(right, r1.thicknessMm);
    if (linked) {
        // When linked, force symmetry after individual clamping (use the more restrictive result).
        const merged = constrainSideCorrections(
            {
                ...r1.constrained,
                // average extremes slightly toward safety
                forefootPostingDeg: (r1.constrained.forefootPostingDeg + r2.constrained.forefootPostingDeg) / 2,
                rearfootPostingDeg: (r1.constrained.rearfootPostingDeg + r2.constrained.rearfootPostingDeg) / 2,
            },
            r2.thicknessMm,
        );
        r2 = merged;
        return {
            left: merged.constrained,
            right: merged.constrained,
            thicknessMm: merged.thicknessMm,
            violations: [...r1.violations, ...r2.violations],
        };
    }
    return {
        left: r1.constrained,
        right: r2.constrained,
        thicknessMm: r2.thicknessMm,
        violations: [...r1.violations, ...r2.violations],
    };
}

/** Quick boolean for UI "is this state production-viable". */
export function hasCriticalViolations(violations: ConstraintViolation[]): boolean {
    return violations.some((vi) => vi.field === "combined" || vi.field === "thickness");
}
