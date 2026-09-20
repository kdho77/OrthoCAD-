// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { archSkiveDepthAtThirdWidth } from "@/lib/geometry/arch-skive";
import { topCoverAccommodateDeltaAt } from "@/lib/geometry/height-field";
import {
    ARCH_GRIND_APEX_GATE_TOL_MM,
    ARCH_GRIND_TOP_GATE_TOL_MM,
    archGrindApexRaiseMm,
    clampArchGrindDepthMm,
    getSideShapeFinish,
    SHAPE_FINISH_DEFAULTS,
    TOP_COVER_GATE_TOL_MM,
    TRACK5B_MIN_WALL_MM,
    TRIMMABLE_FOREFOOT_GATE_TOL_MM,
    thicknessMmForDesignSide,
    trimmableForefootLengthDeltaMm,
} from "@/lib/geometry/shape-finish-modifiers";
import type { DesignState, Side, SideShapeFinish } from "@/types";

export interface ShapeFinishGateResult {
    ok: boolean;
    failures: string[];
}

export type ShapeFinishQcStatus = "pass" | "risk" | "fail";

export interface ShapeFinishQcItem {
    key: string;
    label: string;
    status: ShapeFinishQcStatus;
    /** Plain-language reason (not a raw setpoint echo). */
    detail: string;
}

export interface ShapeFinishQcInput {
    side: Side;
    sf: SideShapeFinish;
    thicknessMm: number;
    archHeightMm: number;
    heelSkiveMedialMm: number;
    heelSkiveLateralMm: number;
}

const WALL_RISK_BUFFER_MM = 0.35;

function gateToStatus(gate: ShapeFinishGateResult, riskHints: string[]): ShapeFinishQcStatus {
    if (gate.ok) return "pass";
    if (riskHints.length > 0 && gate.failures.every((f) => riskHints.some((h) => f.includes(h)))) {
        return "risk";
    }
    return "fail";
}

/**
 * UI QC: runs shape-finish-gates against design-time nominal probes (field setpoints).
 * Export/mesh validation can substitute measured apex / wall from geometry later.
 */
export function evaluateShapeFinishQc(input: ShapeFinishQcInput): ShapeFinishQcItem[] {
    const { sf, thicknessMm, archHeightMm, heelSkiveMedialMm, heelSkiveLateralMm } = input;
    const items: ShapeFinishQcItem[] = [];

    const topProbe = topCoverAccommodateDeltaAt(0.1, 0.85, sf.topCoverAccommodateMm);
    const topGate = gateTopCoverAccommodate(sf.topCoverAccommodateMm, topProbe);
    items.push({
        key: "topCover",
        label: "Top cover clearance",
        status: gateToStatus(topGate, []),
        detail: topGate.ok
            ? sf.topCoverAccommodateMm > 0
                ? `Cup/flange raise ~${topProbe.toFixed(1)} mm at probe — independent of heel cup depth setpoint.`
                : "Off — no extra cover bulk."
            : (topGate.failures[0] ?? "Clearance out of tolerance."),
    });

    const distalExpected = trimmableForefootLengthDeltaMm(sf);
    const trimGate = gateTrimmableForefootLength(sf, distalExpected);
    items.push({
        key: "trimmableForefoot",
        label: "Trimmable forefoot",
        status: gateToStatus(trimGate, []),
        detail: trimGate.ok
            ? sf.trimmableForefoot
                ? `Footprint grows +${distalExpected.toFixed(1)} mm distal (shell trim shortens flange only).`
                : "Off — wear-line length unchanged."
            : (trimGate.failures[0] ?? "Distal extension out of tolerance."),
    });

    const apexRaise = archGrindApexRaiseMm(sf.archGrindDepthMm);
    const minWallEst = thicknessMm - apexRaise;
    const grindGate = gateArchGrindDepth(sf.archGrindDepthMm, apexRaise, 0, minWallEst);
    const grindRisk =
        sf.archGrindDepthMm > 0 &&
        minWallEst >= TRACK5B_MIN_WALL_MM &&
        minWallEst < TRACK5B_MIN_WALL_MM + WALL_RISK_BUFFER_MM;
    let grindStatus: ShapeFinishQcStatus = grindGate.ok ? "pass" : "fail";
    if (!grindGate.ok && grindRisk) grindStatus = "risk";
    items.push({
        key: "archGrind",
        label: "Arch grind (plantar)",
        status: grindStatus,
        detail:
            sf.archGrindDepthMm <= 0
                ? "Off — plantar arch unchanged (not arch height / fill)."
                : grindGate.ok
                  ? `Bottom deepen ~${apexRaise.toFixed(1)} mm at apex; est. min wall ${minWallEst.toFixed(1)} mm (≥ ${TRACK5B_MIN_WALL_MM}). Top arch height (${archHeightMm.toFixed(1)} mm) unchanged.`
                  : grindGate.failures.join(" "),
    });

    const skiveExpected = archSkiveDepthAtThirdWidth(sf.archSkiveMm, sf.archSkiveSide);
    const skiveGate = gateArchSkiveDepth(sf, skiveExpected, 0);
    items.push({
        key: "archSkive",
        label: "Arch skive (midfoot)",
        status: gateToStatus(skiveGate, []),
        detail:
            sf.archSkiveMm <= 0
                ? "Off — distinct from Kirby heel skive."
                : skiveGate.ok
                  ? `${sf.archSkiveSide} ~${skiveExpected.toFixed(1)} mm at 1/3 arch-width; zero outside midfoot mask.`
                  : skiveGate.failures.join(" "),
    });

    const heelMax = Math.max(heelSkiveMedialMm, heelSkiveLateralMm);
    items.push({
        key: "heelSkive",
        label: "Heel skive (Kirby)",
        status: "pass",
        detail:
            heelMax > 0
                ? `Rearfoot Kirby raise med ${heelSkiveMedialMm.toFixed(1)} / lat ${heelSkiveLateralMm.toFixed(1)} mm — listed separately from arch skive.`
                : "Off.",
    });

    return items;
}

/** True when grind or arch skive may breach min wall — prompt before commit. */
export function shapeFinishWallRisk(input: ShapeFinishQcInput): { atRisk: boolean; message: string } {
    const { sf, thicknessMm } = input;
    const apexRaise = archGrindApexRaiseMm(sf.archGrindDepthMm);
    const minWallEst = thicknessMm - apexRaise;
    if (sf.archGrindDepthMm > 0 && minWallEst < TRACK5B_MIN_WALL_MM) {
        return {
            atRisk: true,
            message: `Arch grind may leave ~${minWallEst.toFixed(1)} mm wall (minimum ${TRACK5B_MIN_WALL_MM} mm). Continue?`,
        };
    }
    if (sf.archSkiveMm > 0 && minWallEst < TRACK5B_MIN_WALL_MM + WALL_RISK_BUFFER_MM) {
        return {
            atRisk: true,
            message: `Arch skive with thin shell (~${minWallEst.toFixed(1)} mm est. wall). Continue?`,
        };
    }
    return { atRisk: false, message: "" };
}

export function gateTopCoverAccommodate(setpointMm: number, measuredMm: number): ShapeFinishGateResult {
    const failures: string[] = [];
    if (setpointMm <= 0 && Math.abs(measuredMm) < 1e-6) return { ok: true, failures };
    const expected = topCoverAccommodateDeltaAt(0.1, 0.85, setpointMm);
    if (Math.abs(measuredMm - expected) > TOP_COVER_GATE_TOL_MM) {
        failures.push(
            `Top cover clearance ${measuredMm.toFixed(2)} mm vs setpoint ${expected.toFixed(2)} mm (±${TOP_COVER_GATE_TOL_MM})`,
        );
    }
    return { ok: failures.length === 0, failures };
}

export function gateTrimmableForefootLength(
    sf: SideShapeFinish,
    measuredExtraMm: number,
): ShapeFinishGateResult {
    const failures: string[] = [];
    const expected = trimmableForefootLengthDeltaMm(sf);
    if (Math.abs(measuredExtraMm - expected) > TRIMMABLE_FOREFOOT_GATE_TOL_MM) {
        failures.push(
            `Distal extension ${measuredExtraMm.toFixed(2)} mm vs +${expected.toFixed(2)} mm (±${TRIMMABLE_FOREFOOT_GATE_TOL_MM})`,
        );
    }
    return { ok: failures.length === 0, failures };
}

export function gateArchGrindDepth(
    setpointMm: number,
    apexBottomDeltaMm: number,
    maxTopDeltaMm: number,
    minWallMm: number,
): ShapeFinishGateResult {
    const failures: string[] = [];
    if (setpointMm <= 0) {
        if (Math.abs(apexBottomDeltaMm) > ARCH_GRIND_APEX_GATE_TOL_MM) {
            failures.push(`Arch grind off but plantar moved ${apexBottomDeltaMm.toFixed(2)} mm`);
        }
        return { ok: failures.length === 0, failures };
    }
    const expected = archGrindApexRaiseMm(setpointMm);
    if (Math.abs(apexBottomDeltaMm - expected) > ARCH_GRIND_APEX_GATE_TOL_MM) {
        failures.push(
            `Arch grind apex bottom ${apexBottomDeltaMm.toFixed(2)} mm vs ${expected.toFixed(2)} mm (±${ARCH_GRIND_APEX_GATE_TOL_MM})`,
        );
    }
    if (maxTopDeltaMm > ARCH_GRIND_TOP_GATE_TOL_MM) {
        failures.push(
            `Arch grind top sink ${maxTopDeltaMm.toFixed(2)} mm exceeds ±${ARCH_GRIND_TOP_GATE_TOL_MM}`,
        );
    }
    if (minWallMm < TRACK5B_MIN_WALL_MM) {
        failures.push(`Min wall ${minWallMm.toFixed(2)} mm < ${TRACK5B_MIN_WALL_MM} mm after arch grind`);
    }
    return { ok: failures.length === 0, failures };
}

export function gateArchSkiveDepth(
    sf: SideShapeFinish,
    measuredAtThirdMm: number,
    outsideMaskMax: number,
): ShapeFinishGateResult {
    const failures: string[] = [];
    if (sf.archSkiveMm <= 0) {
        if (measuredAtThirdMm > 0.05) failures.push("Arch skive off but raise detected");
        return { ok: failures.length === 0, failures };
    }
    const expected = archSkiveDepthAtThirdWidth(sf.archSkiveMm, sf.archSkiveSide);
    if (Math.abs(measuredAtThirdMm - expected) > 0.3) {
        failures.push(
            `Arch skive depth ${measuredAtThirdMm.toFixed(2)} mm vs ${expected.toFixed(2)} mm at 1/3 arch-width (±0.3)`,
        );
    }
    if (outsideMaskMax > 0.05) {
        failures.push("Arch skive mask non-zero outside midfoot band");
    }
    return { ok: failures.length === 0, failures };
}

export function assertShapeFinishDefaults(sf: SideShapeFinish): void {
    if (sf.topCoverAccommodateMm < SHAPE_FINISH_DEFAULTS.topCoverAccommodateMm.min) {
        throw new Error("topCover below min");
    }
}

/** Hard-fail manufacturing export when shape/finish gates do not pass (min wall 0.8, etc.). */
export function assertShapeFinishExportAllowed(design: DesignState, side: Side): void {
    const sf = getSideShapeFinish(design, side);
    const thicknessMm = thicknessMmForDesignSide(design, side);
    const c = design.corrections[side];
    const appliedGrindMm = clampArchGrindDepthMm(sf.archGrindDepthMm, thicknessMm);
    const apex = archGrindApexRaiseMm(appliedGrindMm);
    const minWallEst = thicknessMm - apex;
    const grindGate = gateArchGrindDepth(appliedGrindMm, apex, 0, minWallEst);
    if (!grindGate.ok) {
        throw new Error(`Shape/finish export blocked: ${grindGate.failures.join("; ")}`);
    }

    const skiveExpected = archSkiveDepthAtThirdWidth(sf.archSkiveMm, sf.archSkiveSide);
    const skiveGate = gateArchSkiveDepth(sf, skiveExpected, 0);
    if (!skiveGate.ok) {
        throw new Error(`Shape/finish export blocked: ${skiveGate.failures.join("; ")}`);
    }

    const sfApplied =
        appliedGrindMm === sf.archGrindDepthMm ? sf : { ...sf, archGrindDepthMm: appliedGrindMm };
    const qc = evaluateShapeFinishQc({
        side,
        sf: sfApplied,
        thicknessMm,
        archHeightMm: c.archHeightMm + c.archFillMm,
        heelSkiveMedialMm: c.medialSkiveMm,
        heelSkiveLateralMm: c.lateralSkiveMm,
    });
    const fails = qc.filter((i) => i.status === "fail");
    if (fails.length > 0) {
        throw new Error(`Shape/finish export blocked: ${fails.map((f) => f.detail).join(" ")}`);
    }
}
