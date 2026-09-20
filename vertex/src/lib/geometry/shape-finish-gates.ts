// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { archSkiveDepthAtThirdWidth } from "@/lib/geometry/arch-skive";
import { topCoverAccommodateDeltaAt } from "@/lib/geometry/height-field";
import {
    ARCH_GRIND_APEX_GATE_TOL_MM,
    ARCH_GRIND_TOP_GATE_TOL_MM,
    archGrindApexRaiseMm,
    SHAPE_FINISH_DEFAULTS,
    TOP_COVER_GATE_TOL_MM,
    TRACK5B_MIN_WALL_MM,
    TRIMMABLE_FOREFOOT_GATE_TOL_MM,
    trimmableForefootLengthDeltaMm,
} from "@/lib/geometry/shape-finish-modifiers";
import type { SideShapeFinish } from "@/types";

export interface ShapeFinishGateResult {
    ok: boolean;
    failures: string[];
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
