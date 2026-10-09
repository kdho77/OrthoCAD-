// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { heelLiftDeltaAt } from "@/lib/geometry/heel-lift";
import { heelCupDepthBowlDelta, heelCupWidthScaleFactor } from "@/lib/geometry/height-field";
import type { SideCorrections } from "@/types";
import { rescaleProfileAffine } from "./profile";
import type { ColumnProfile, PlanformColumn, PlanformFrame, StockWallModel } from "./types";

export interface ProceduralModifierInput {
    corrections?: SideCorrections;
    thicknessMm?: number;
    stockThicknessMm?: number;
}

function cloneColumns(cols: PlanformColumn[]): PlanformColumn[] {
    return cols.map((c) => ({
        ...c,
        outline: { ...c.outline },
        rim: { ...c.rim },
        n: { ...c.n },
        tangent: { ...c.tangent },
    }));
}

/**
 * Widen / cup depth / heel lift / thickness move only the trim and outline
 * curves. Profile interiors are then affinely rescaled in the local (n, z) frame.
 * No Laplacian / sidewall smoothing.
 */
export function applyCurveModifiers(
    model: StockWallModel,
    input: ProceduralModifierInput = {},
): { columns: PlanformColumn[]; profiles: ColumnProfile[]; frame: PlanformFrame } {
    if (!model.planform || !model.columns) {
        throw new Error("S1 planform/columns missing — extractStockWallModel first");
    }
    const c = input.corrections;
    const columns = cloneColumns(model.planform.columns);
    const minX = model.bounds.minX;
    const length = Math.max(1e-3, model.bounds.maxX - model.bounds.minX);
    const widCenter = (model.bounds.minY + model.bounds.maxY) * 0.5;
    const dThick = (input.thicknessMm ?? 0) - (input.stockThicknessMm ?? input.thicknessMm ?? 0);

    for (const col of columns) {
        const u = Math.max(0, Math.min(1, (col.outline.x - minX) / length));
        if (c && c.heelCupWidthMm !== 0) {
            const scale = heelCupWidthScaleFactor(u, c.heelCupWidthMm);
            const shift = (scale - 1) * (col.outline.y - widCenter);
            // Width scale is about the centerline (Y). Move both curves only.
            col.outline.y += shift;
            col.rim.y += shift;
        }
        if (c && c.heelCupDepthMm > 0) {
            const avRim = 0.92;
            const bowl = heelCupDepthBowlDelta(u, avRim, c.heelCupDepthMm);
            col.rim.z += bowl;
        }
        if (c && c.heelLiftMm > 0) {
            col.rim.z += heelLiftDeltaAt(u, c.heelLiftMm);
        }
        if (dThick) {
            col.rim.z += dThick;
        }
    }

    const profiles = model.columns.map((p, i) => {
        const col = columns[i]!;
        const plantar = { n: 0, z: col.outline.z };
        const rimN = (col.rim.x - col.outline.x) * col.n.x + (col.rim.y - col.outline.y) * col.n.y;
        return rescaleProfileAffine(p, plantar, { n: rimN, z: col.rim.z });
    });

    const frame: PlanformFrame = {
        ...model.planform,
        columns,
    };
    return { columns, profiles, frame };
}
