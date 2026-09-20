// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { archSkiveCombinedMask, clampArchSkiveDepthMm } from "@/lib/geometry/arch-skive";
import { bump, smoothstep, topCoverAccommodateDeltaAt } from "@/lib/geometry/height-field";
import type { ArchSkiveSide, DesignState, ProductionMethod, Side, SideShapeFinish } from "@/types";

export const TRACK5B_MIN_WALL_MM = 0.8;

export const SHAPE_FINISH_DEFAULTS = {
    topCoverAccommodateMm: { min: 0, max: 3, default: 1.25 },
    trimmableForefootExtraMm: { min: 0, max: 15, default: 5 },
    archGrindDepthMm: { min: 0, max: 6 },
    archSkiveMm: { min: 0, max: 6 },
} as const;

export const TOP_COVER_GATE_TOL_MM = 0.3;
export const TRIMMABLE_FOREFOOT_GATE_TOL_MM = 0.5;
export const ARCH_GRIND_APEX_GATE_TOL_MM = 0.3;
export const ARCH_GRIND_TOP_GATE_TOL_MM = 0.1;

export function getSideShapeFinish(design: DesignState, side: Side): SideShapeFinish {
    const paired = design.paired;
    const method = paired ? (side === "left" ? paired.leftMethod : paired.rightMethod) : design.method;
    const stored = design.shapeFinish?.[side];
    return normalizeSideShapeFinish(stored, method);
}

export function defaultSideShapeFinish(method?: ProductionMethod): SideShapeFinish {
    return {
        topCoverAccommodateMm: SHAPE_FINISH_DEFAULTS.topCoverAccommodateMm.default,
        trimmableForefoot: method !== "milling_3axis",
        trimmableForefootExtraMm: SHAPE_FINISH_DEFAULTS.trimmableForefootExtraMm.default,
        archGrindDepthMm: 0,
        archSkiveMm: 0,
        archSkiveSide: "medial",
    };
}

export function normalizeSideShapeFinish(
    patch: Partial<SideShapeFinish> | undefined,
    method?: ProductionMethod,
): SideShapeFinish {
    const base = defaultSideShapeFinish(method);
    if (!patch) return base;
    const top = patch.topCoverAccommodateMm ?? base.topCoverAccommodateMm;
    const extra = patch.trimmableForefootExtraMm ?? base.trimmableForefootExtraMm;
    const grind = patch.archGrindDepthMm ?? base.archGrindDepthMm;
    const skive = patch.archSkiveMm ?? base.archSkiveMm;
    return {
        topCoverAccommodateMm: Math.max(
            SHAPE_FINISH_DEFAULTS.topCoverAccommodateMm.min,
            Math.min(SHAPE_FINISH_DEFAULTS.topCoverAccommodateMm.max, top),
        ),
        trimmableForefoot: patch.trimmableForefoot ?? base.trimmableForefoot,
        trimmableForefootExtraMm: Math.max(
            SHAPE_FINISH_DEFAULTS.trimmableForefootExtraMm.min,
            Math.min(SHAPE_FINISH_DEFAULTS.trimmableForefootExtraMm.max, extra),
        ),
        archGrindDepthMm: Math.max(
            SHAPE_FINISH_DEFAULTS.archGrindDepthMm.min,
            Math.min(SHAPE_FINISH_DEFAULTS.archGrindDepthMm.max, grind),
        ),
        archSkiveMm: clampArchSkiveDepthMm(skive),
        archSkiveSide: patch.archSkiveSide ?? base.archSkiveSide,
    };
}

/** Extra distal length (mm) applied when trimmable forefoot is enabled. */
export function trimmableForefootLengthDeltaMm(sf: SideShapeFinish): number {
    return sf.trimmableForefoot && sf.trimmableForefootExtraMm > 0 ? sf.trimmableForefootExtraMm : 0;
}

export function effectiveLengthMm(baseLengthMm: number, sf: SideShapeFinish): number {
    return baseLengthMm + trimmableForefootLengthDeltaMm(sf);
}

export { topCoverAccommodateDeltaAt };

/** Arch ellipse mask for bottom plantar grind (midfoot). */
export function archGrindPlantarMask(u: number, av: number): number {
    const archU = bump(u, 0.42, 0.28);
    const archAcross = smoothstep(1.0, 0.25, av);
    return archU * archAcross;
}

/** Positive mm to raise the plantar (bottom) surface into the solid (deepen recess). */
export function archGrindPlantarRaiseAt(u: number, av: number, depthMm: number): number {
    if (depthMm <= 0) return 0;
    return depthMm * archGrindPlantarMask(u, av);
}

export interface ApplyArchGrindMeshParams {
    lengthAxis: 0 | 1 | 2;
    widthAxis: 0 | 1 | 2;
    thickAxis: 0 | 1 | 2;
    lenMin: number;
    lenSize: number;
    widCenter: number;
    widSize: number;
    widthSign: number;
    topVertexCount: number;
    vertexCount: number;
    plantarZMax: number;
    archGrindDepthMm: number;
}

/** Bottom-sheet plantar deepen only — never moves top vertices. */
export function applyArchGrindToBottomMesh(
    positions: Float32Array,
    params: ApplyArchGrindMeshParams,
): number {
    const depth = params.archGrindDepthMm;
    if (depth <= 0) return 0;

    let maxRaise = 0;
    const {
        lengthAxis,
        widthAxis,
        thickAxis,
        lenMin,
        lenSize,
        widCenter,
        widSize,
        widthSign,
        topVertexCount,
        vertexCount,
        plantarZMax,
    } = params;

    for (let i = topVertexCount; i < vertexCount; i++) {
        const z = positions[i * 3 + thickAxis]!;
        if (z > plantarZMax) continue;
        const u = (positions[i * 3 + lengthAxis]! - lenMin) / (lenSize || 1);
        const y = positions[i * 3 + widthAxis]!;
        const vSigned = ((y - widCenter) / (widSize / 2 || 1)) * widthSign;
        const av = Math.abs(vSigned);
        const raise = archGrindPlantarRaiseAt(u, av, depth);
        if (raise <= 0) continue;
        positions[i * 3 + thickAxis] = z + raise;
        if (raise > maxRaise) maxRaise = raise;
    }

    return maxRaise;
}

export interface ApplyTrimmableForefootParams {
    lengthAxis: 0 | 1 | 2;
    lenMin: number;
    lenSize: number;
    vertexCount: number;
    extraMm: number;
}

/** Distal stretch: grows footprint length past the wear trim (flange only). */
export function applyTrimmableForefootExtension(
    positions: Float32Array,
    params: ApplyTrimmableForefootParams,
): void {
    const { lengthAxis, lenMin, lenSize, vertexCount, extraMm } = params;
    if (extraMm <= 0 || lenSize <= 0) return;

    for (let i = 0; i < vertexCount; i++) {
        const len = positions[i * 3 + lengthAxis]!;
        const u = (len - lenMin) / lenSize;
        if (u < 0.72) continue;
        const t = smoothstep(0.72, 1.0, Math.min(1.05, u));
        positions[i * 3 + lengthAxis] = len + extraMm * t;
    }
}

export interface ShapeFinishQcLine {
    key: string;
    label: string;
    value: string;
}

export function shapeFinishQcLines(
    side: Side,
    sf: SideShapeFinish,
    heelSkive: { medial: number; lateral: number },
): ShapeFinishQcLine[] {
    const lines: ShapeFinishQcLine[] = [
        {
            key: "topCover",
            label: "Top cover accommodate",
            value: `${sf.topCoverAccommodateMm.toFixed(1)} mm`,
        },
        {
            key: "trimmableForefoot",
            label: "Trimmable forefoot",
            value: sf.trimmableForefoot ? `on (+${sf.trimmableForefootExtraMm.toFixed(1)} mm)` : "off",
        },
        {
            key: "archGrind",
            label: "Arch grind depth",
            value: `${sf.archGrindDepthMm.toFixed(1)} mm (plantar)`,
        },
        {
            key: "archSkive",
            label: "Arch skive",
            value: sf.archSkiveMm > 0 ? `${sf.archSkiveSide} ${sf.archSkiveMm.toFixed(1)} mm` : "off",
        },
        {
            key: "heelSkive",
            label: "Heel skive (Kirby)",
            value: `med ${heelSkive.medial.toFixed(1)} / lat ${heelSkive.lateral.toFixed(1)} mm`,
        },
    ];
    return lines;
}

/** Sample mask at arch apex for gate tests (u≈0.42, medial av). */
export function archGrindApexRaiseMm(depthMm: number): number {
    return archGrindPlantarRaiseAt(0.42, 0.35, depthMm);
}

export function archSkiveOutsideMask(
    u: number,
    vSigned: number,
    side: Side,
    archSide: ArchSkiveSide,
): number {
    if (u < 0.05 || u > 0.78) return archSkiveCombinedMask(u, vSigned, side, archSide);
    return 0;
}
