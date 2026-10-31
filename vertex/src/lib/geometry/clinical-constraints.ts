// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { migrateSideCorrections } from "@/lib/geometry/migrate-corrections";
import {
    FLOOR_MIN_MM,
    LATERAL_WALL_MIN_MM,
    mergeSinkWarnings,
    type SinkSurfaceContext,
    type SinkWarning,
    sinkDepthWarnings,
    sinkOverlapWarnings,
} from "@/lib/geometry/sink";
import type { PlacedElement, SideCorrections, TextMarking, WedgeCorrection } from "@/types";

/**
 * ClinicalSpec for structured clinical rules (added for wedge system completeness).
 * Allows future expansion for per-field rules, unit-aware limits, and export validation.
 */
export interface ClinicalSpec {
    min: number;
    max: number;
    unit?: "mm" | "deg" | "mixed";
    description: string;
    isCritical?: boolean; // if true, blocks export
}

// Example ClinicalSpec entries for wedges (per refined design)
export const WEDGE_CLINICAL_SPECS: Record<string, ClinicalSpec> = {
    rearfootWedge: {
        min: 0,
        max: 10,
        unit: "mixed", // mm or deg (value interpretation depends on unit in object)
        description: "Rearfoot medial/lateral wedge (surface raise on plantar side)",
        isCritical: false, // soft warning; hard clamp only
    },
    forefootWedge: {
        min: 0,
        max: 10,
        unit: "mixed",
        description: "Forefoot medial/lateral wedge (surface raise on plantar side)",
        isCritical: false,
    },
};

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
    forefootPostingDeg: { min: 0, max: 0 },
    rearfootPostingDeg: { min: 0, max: 0 },
    medialSkiveMm: { min: 0, max: 8.0 },
    lateralSkiveMm: { min: 0, max: 8.0 },
    skiveAngleDeg: { min: 5, max: 30 },
    skiveLocationPct: { min: 0, max: 100 },
    archHeightMm: { min: -10.0, max: 14.0 },
    archFillMm: { min: 0, max: 0 },
    archEaseMm: { min: 0, max: 6.0 },
    heelCupHeightMm: { min: 0, max: 12.0 },
    /** Biomechanics lock 2026-09-20: usable 12–18 mm when enabled; 0 = off (see clamp below). */
    heelCupDepthMm: { min: 12, max: 18.0 },
    /** Signed: + widens heel cup, − narrows (same |scale| budget as widen). */
    heelCupWidthMm: { min: -10.0, max: 10.0 },
    /** Signed per-side forefoot outline offset (mm at full envelope, each side). */
    forefootWidthMm: { min: -10.0, max: 10.0 },
    // Heel lift raises the heel region; Biomechanics hard cap 12 mm (2026-09-20).
    heelLiftMm: { min: 0, max: 12.0 },
    apexMoveMm: { min: -12, max: 12 },
    medialFlangeMm: { min: 0, max: 8.0 },
    lateralFlangeMm: { min: 0, max: 8.0 },
    // Wedge limits (per the wedge design). Applied to the .value inside the wedge object.
    // mm: absolute raise on the edge. deg: angle (converted internally for clamping).
    rearfootWedgeMm: { min: 0, max: 10 },
    rearfootWedgeDeg: { min: 0, max: 10 },
    forefootWedgeMm: { min: 0, max: 10 },
    forefootWedgeDeg: { min: 0, max: 10 },
} as const;

/** Product default when a heel cup depth is suggested without an explicit value (Biomechanics lock 2026-09-20). */
export const HEEL_CUP_DEPTH_DEFAULT_MM = 12;

/** Deep heel cup keyword heuristic — upper clinical range, not the product default (Biomechanics lock 2026-09-20). */
export const HEEL_CUP_DEPTH_DEEP_MM = 16;

export const MIN_WALL_MM = 1.6; // absolute production minimum wall after all shaping

export interface ConstraintViolation {
    field: keyof SideCorrections | "thickness" | "combined" | "skiveAngleDeg" | "skiveLocationPct";
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
export function constrainSideCorrections(corrections: SideCorrections, thicknessMm: number): ConstrainResult {
    const v: ConstraintViolation[] = [];

    const migrated = migrateSideCorrections(corrections);

    let t = thicknessMm;
    const tc = clamp(t, CLINICAL_LIMITS.thicknessMm.min, CLINICAL_LIMITS.thicknessMm.max, "thickness");
    t = tc.value;
    if (tc.violation) v.push(tc.violation);

    const c: SideCorrections = { ...migrated };

    // Scalar clamps
    const pairs: Array<[keyof SideCorrections, { min: number; max: number }]> = [
        ["forefootPostingDeg", CLINICAL_LIMITS.forefootPostingDeg],
        ["rearfootPostingDeg", CLINICAL_LIMITS.rearfootPostingDeg],
        ["medialSkiveMm", CLINICAL_LIMITS.medialSkiveMm],
        ["lateralSkiveMm", CLINICAL_LIMITS.lateralSkiveMm],
        ["archHeightMm", CLINICAL_LIMITS.archHeightMm],
        ["archFillMm", CLINICAL_LIMITS.archFillMm],
        ["archEaseMm", CLINICAL_LIMITS.archEaseMm],
        ["heelCupHeightMm", CLINICAL_LIMITS.heelCupHeightMm],
        ["heelCupWidthMm", CLINICAL_LIMITS.heelCupWidthMm],
        ["forefootWidthMm", CLINICAL_LIMITS.forefootWidthMm],
        ["heelLiftMm", CLINICAL_LIMITS.heelLiftMm],
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

    // Heel cup depth: 0 = disabled; positive values clamp to Biomechanics range 12–18 mm.
    {
        const raw = c.heelCupDepthMm;
        if (raw <= 0) {
            c.heelCupDepthMm = 0;
        } else {
            const res = clamp(
                raw,
                CLINICAL_LIMITS.heelCupDepthMm.min,
                CLINICAL_LIMITS.heelCupDepthMm.max,
                "heelCupDepthMm",
            );
            c.heelCupDepthMm = res.value;
            if (res.violation) v.push(res.violation);
        }
    }

    if (c.skiveAngleDeg != null) {
        const res = clamp(
            c.skiveAngleDeg,
            CLINICAL_LIMITS.skiveAngleDeg.min,
            CLINICAL_LIMITS.skiveAngleDeg.max,
            "skiveAngleDeg",
        );
        c.skiveAngleDeg = res.value;
        if (res.violation) v.push(res.violation);
    }
    if (c.skiveLocationPct != null) {
        const res = clamp(
            c.skiveLocationPct,
            CLINICAL_LIMITS.skiveLocationPct.min,
            CLINICAL_LIMITS.skiveLocationPct.max,
            "skiveLocationPct",
        );
        c.skiveLocationPct = res.value;
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

    // --- Wedge clamps (object fields per design) ---
    // Wedges are {side, value, unit}. We clamp the .value using unit-specific limits from CLINICAL_LIMITS.
    // mm = absolute edge raise on the chosen side (tapers linearly to 0 opposite).
    // deg = angle; maxRaise computed at runtime in wedgeDeltaAt using current local width.
    // We clamp the input 'value' here (deg value or mm value).
    // No combined wall adjustment for wedges (they raise one side and taper to 0; they do not "eat" material).
    // Uses ClinicalSpec for documentation and future hard/soft classification.
    const wedgeKeys: Array<keyof SideCorrections> = ["rearfootWedge", "forefootWedge"];
    for (const key of wedgeKeys) {
        const w = (c as any)[key] as WedgeCorrection | undefined;
        if (!w) continue;

        const spec = WEDGE_CLINICAL_SPECS[key as string] || { min: 0, max: 10, description: String(key) };
        const limKey =
            w.unit === "mm"
                ? key === "rearfootWedge"
                    ? "rearfootWedgeMm"
                    : "forefootWedgeMm"
                : key === "rearfootWedge"
                  ? "rearfootWedgeDeg"
                  : "forefootWedgeDeg";
        const lim = (CLINICAL_LIMITS as any)[limKey] || { min: 0, max: 10 };

        const rawVal = w.value;
        const res = clamp(rawVal, lim.min, lim.max, key);
        if (res.value !== rawVal) {
            (c as any)[key] = { ...w, value: res.value };
            const isCritical = spec.isCritical;
            v.push({
                field: key,
                message: `${isCritical ? "Hard limit" : "Soft warning"}: Clamped ${key} (${w.side}, ${w.unit}) to ${res.value} (${spec.description})`,
                requested: rawVal,
                applied: res.value,
            });
        }
    }

    // Full-length wedge: 0 is off. Degrees clamp to 1–10. Millimetres stay as a
    // heel rise; the angle clamp (1–10°) is applied when the rim width is known.
    {
        const w = c.fullLengthWedge;
        if (w && w.value != null && Number.isFinite(w.value)) {
            if (w.value <= 0) {
                c.fullLengthWedge = { ...w, value: 0 };
            } else if ((w.unit ?? "mm") === "deg") {
                const res = clamp(w.value, 1, 10, "fullLengthWedge");
                if (res.value !== w.value) {
                    c.fullLengthWedge = { ...w, value: res.value, unit: "deg" };
                    v.push({
                        field: "fullLengthWedge",
                        message: `Clamped full-length wedge angle to ${res.value}° (1–10°)`,
                        requested: w.value,
                        applied: res.value,
                    });
                }
            }
        }
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
        // For wedges (objects), mirror the left wedge exactly (same side/ value/ unit) rather than averaging,
        // since wedges are directional surface features and mutual exclusion is per-zone.
        const leftWedge = r1.constrained.rearfootWedge;
        const rightWedge = r1.constrained.forefootWedge; // use left's for symmetry
        const merged = constrainSideCorrections(
            {
                ...r1.constrained,
                // average extremes slightly toward safety for scalar postings
                forefootPostingDeg:
                    (r1.constrained.forefootPostingDeg + r2.constrained.forefootPostingDeg) / 2,
                rearfootPostingDeg:
                    (r1.constrained.rearfootPostingDeg + r2.constrained.rearfootPostingDeg) / 2,
                // Mirror wedges for linked symmetry (do not average objects)
                rearfootWedge: leftWedge,
                forefootWedge: rightWedge,
                fullLengthWedge: r1.constrained.fullLengthWedge,
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

/** Soft warnings for wedge values approaching limits (non-blocking but shown in UI). */
export function hasWedgeViolations(violations: ConstraintViolation[]): boolean {
    return violations.some(
        (vi) =>
            vi.field === "rearfootWedge" || vi.field === "forefootWedge" || vi.field === "fullLengthWedge",
    );
}

/**
 * Sink depth, element overlap, and text overlap. Floor and lateral-wall limits
 * are the named constants the mesh guards use; those warnings are attached on
 * the geometry when a guard actually reduces a cut.
 */
export function evaluateSinkConstraints(
    ctx: SinkSurfaceContext,
    elements?: PlacedElement[] | null,
    text?: TextMarking | null,
): SinkWarning[] {
    return mergeSinkWarnings(sinkDepthWarnings(ctx.sinks), sinkOverlapWarnings(ctx, elements, text));
}

export const SINK_CLINICAL_FLOORS = {
    floorMinMm: FLOOR_MIN_MM,
    lateralWallMinMm: LATERAL_WALL_MIN_MM,
} as const;

/** Warn when the full-length high-edge rise exceeds this (mm), any station. */
export const MAX_RISE_WARN_MM = 12;

/**
 * Baseline heel-cup wall above the seat (mm) plus the high-side rise.
 * The shoe counter warning uses this outside height; cup height itself stays put.
 */
export const STOCK_HEEL_CUP_MM = 12;
export const SHOE_COUNTER_HEIGHT_WARN_MM = 20;

/**
 * Soft UI warning when a posting angle exceeds 8° (still allowed up to 10°).
 * `resolvedFullLengthDeg` is the angle an mm full-length entry works out to.
 */
export function hasPostingAngleWarning(c: SideCorrections, resolvedFullLengthDeg = 0): boolean {
    if (resolvedFullLengthDeg > 8) return true;
    for (const w of [c.rearfootWedge, c.forefootWedge, c.fullLengthWedge]) {
        if (w?.unit === "deg" && (w.value ?? 0) > 8) return true;
    }
    return false;
}

export function hasMaxRiseWarning(riseMm: number): boolean {
    return riseMm > MAX_RISE_WARN_MM;
}

/** High-side outside heel height (stock cup + extra cup + rise) vs the shoe counter. */
export function hasShoeCounterHeightWarning(c: SideCorrections, heelRiseMm: number): boolean {
    if (!(heelRiseMm > 0) && !(c.fullLengthWedge && (c.fullLengthWedge.value ?? 0) > 0)) return false;
    const outside = STOCK_HEEL_CUP_MM + Math.max(0, c.heelCupHeightMm ?? 0) + Math.max(0, heelRiseMm);
    return outside > SHOE_COUNTER_HEIGHT_WARN_MM;
}
