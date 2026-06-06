import type { IShape, IShapeFactory } from "@chili3d/core";
import type { ManifoldReport } from "@/lib/geometry/manifold";
import { analyzeManifold } from "@/lib/geometry/manifold";
import type { BufferGeometry } from "three";

export interface SolidValidation extends ManifoldReport {
    /** True when OCCT reports a closed solid (BRep check). */
    occtClosed: boolean;
}

/**
 * Attempts to heal an OCCT shape that failed the closed-solid check by unifying
 * coplanar faces/edges, then sewing when still open.
 */
export function repairOcctSolid(factory: IShapeFactory, shape: IShape): IShape {
    if (shape.isClosed()) return shape;

    try {
        const simplified = factory.simplifyShape(shape, true, true, []);
        if (simplified.isOk && simplified.value.isClosed()) {
            return simplified.value;
        }
    } catch {
        // simplify can fail on invalid topology — continue to sewing.
    }

    try {
        const sewn = factory.sewing(shape, shape);
        if (sewn.isOk && sewn.value.isClosed()) {
            return sewn.value;
        }
    } catch {
        // sewing failed — return best effort below.
    }

    try {
        const simplified = factory.simplifyShape(shape, true, true, []);
        if (simplified.isOk) return simplified.value;
    } catch {
        // ignore
    }

    return shape;
}

/** Combines OCCT topology checks with mesh edge analysis for export validation. */
export function validateSolid(shape: IShape, geometry: BufferGeometry): SolidValidation {
    const mesh = analyzeManifold(geometry);
    const occtClosed = shape.isClosed();
    // Trust OCCT topology when `isClosed()` passes; tessellation can introduce
    // spurious open edges at UV seams while the BRep solid remains watertight.
    return {
        ...mesh,
        occtClosed,
        isWatertight: occtClosed ? mesh.nonManifoldEdges === 0 : mesh.isWatertight,
    };
}
