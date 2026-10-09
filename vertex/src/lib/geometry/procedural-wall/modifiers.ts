// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { heelLiftDeltaAt } from "@/lib/geometry/heel-lift";
import { heelCupDepthBowlDelta, heelCupWidthScaleFactor } from "@/lib/geometry/height-field";
import { archGrindPlantarRaiseAt } from "@/lib/geometry/shape-finish-modifiers";
import type { SideCorrections } from "@/types";
import type { PolyPoint } from "./curves";
import type { DeviceTypePreset, LateralFlangeParams, StockWallModel } from "./types";

export interface ProceduralModifierInput {
    corrections?: SideCorrections;
    thicknessMm?: number;
    stockThicknessMm?: number;
    /** Device preset. Accommodative uses the same stock defaults as functional. */
    deviceType?: DeviceTypePreset;
    lateralFlange?: Partial<LateralFlangeParams>;
    /** Arch grind depth (mm) applied to the plantar sheet only. */
    archGrindDepthMm?: number;
}

export interface ModifiedCurves {
    trim: PolyPoint[];
    outline: PolyPoint[];
}

function clonePoly(pts: PolyPoint[]): PolyPoint[] {
    return pts.map((p) => ({ ...p }));
}

/**
 * Widen and cup depth move only TrimCurve / BottomOutline. Nothing deforms
 * wall vertices — the wall is regenerated from the moved curves.
 *
 * Thickness and heel lift raise the trim (top) only; the plantar outline
 * stays on the ground (bottom-stable).
 */
export function applyCurveModifiers(
    model: StockWallModel,
    input: ProceduralModifierInput = {},
): ModifiedCurves {
    const trim = clonePoly(model.trim.spline.controls);
    const outline = clonePoly(model.outline.spline.controls);
    const c = input.corrections;
    const minX = model.bounds.minX;
    const length = Math.max(1e-3, model.bounds.maxX - model.bounds.minX);
    const widCenter = (model.bounds.minY + model.bounds.maxY) * 0.5;
    const dThick = (input.thicknessMm ?? 0) - (input.stockThicknessMm ?? input.thicknessMm ?? 0);

    const n = Math.min(trim.length, outline.length);
    for (let i = 0; i < n; i++) {
        const o = outline[i]!;
        const t = trim[i]!;
        const u = Math.max(0, Math.min(1, (o.x - minX) / length));
        if (c && c.heelCupWidthMm !== 0) {
            const scale = heelCupWidthScaleFactor(u, c.heelCupWidthMm);
            o.y = widCenter + (o.y - widCenter) * scale;
            t.y = widCenter + (t.y - widCenter) * scale;
        }
        if (c && c.heelCupDepthMm > 0) {
            const halfW = Math.max(1e-3, (model.bounds.maxY - model.bounds.minY) * 0.5);
            const av = Math.abs((t.y - widCenter) / halfW);
            t.z += heelCupDepthBowlDelta(u, Math.min(1, av), c.heelCupDepthMm);
        }
        if (c && c.heelLiftMm > 0) {
            t.z += heelLiftDeltaAt(u, c.heelLiftMm);
        }
        if (dThick) t.z += dThick;
    }
    return { trim, outline };
}

/**
 * Bottom fields (thickness, zonal, posting, grind) act on the extracted
 * plantar sheet vertices. Thickness is bottom-stable (sheet Z unchanged;
 * the top expands). Zonal = arch fill. Posting / grind offset sheet Z.
 */
export function plantarZDelta(
    x: number,
    y: number,
    bounds: StockWallModel["bounds"],
    input: ProceduralModifierInput,
): number {
    const c = input.corrections;
    const minX = bounds.minX;
    const length = Math.max(1e-3, bounds.maxX - minX);
    const widCenter = (bounds.minY + bounds.maxY) * 0.5;
    const halfW = Math.max(1e-3, (bounds.maxY - bounds.minY) * 0.5);
    const u = Math.max(0, Math.min(1, (x - minX) / length));
    const vSigned = (y - widCenter) / halfW;
    const av = Math.abs(vSigned);
    let dz = 0;
    if (c && c.rearfootPostingDeg) {
        const heel = 1 - Math.max(0, Math.min(1, (u - 0.05) / 0.35));
        dz += Math.tan((c.rearfootPostingDeg * Math.PI) / 180) * vSigned * halfW * heel;
    }
    if (c && c.forefootPostingDeg) {
        const fore = Math.max(0, Math.min(1, (u - 0.62) / 0.28));
        dz += Math.tan((c.forefootPostingDeg * Math.PI) / 180) * vSigned * halfW * fore;
    }
    if (c && c.archFillMm) {
        const arch = Math.exp(-(((u - 0.42) / 0.16) ** 2));
        const across = 1 - Math.min(1, av);
        dz += c.archFillMm * arch * across;
    }
    if ((input.archGrindDepthMm ?? 0) > 0) {
        dz += archGrindPlantarRaiseAt(u, av, input.archGrindDepthMm!);
    }
    return dz;
}
