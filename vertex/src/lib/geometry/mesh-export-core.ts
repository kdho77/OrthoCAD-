// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { GeometryBufferPayload } from "@/lib/geometry/geometry-buffer";
import { payloadToGeometry } from "@/lib/geometry/geometry-buffer";
import type { ExportRimPoint } from "@/lib/geometry/mesh-close";
import {
    closeMeshPerimeter,
    prepareReducedExportGeometry,
    validateExportHeightAxis,
} from "@/lib/geometry/mesh-close";
import { geometryToBinarySTL } from "@/lib/geometry/stl";

export interface CloseAndSerializeExportResult {
    stlBuffer: ArrayBuffer;
    bottomRimVertexCount: number;
    usedReducedBottom: boolean;
}

export interface CloseAndSerializeExportOptions {
    precomputedBottomRim?: ExportRimPoint[];
}

/** Worker-safe: reduce bottom shell → bridge weld → binary STL. */
export function closeAndSerializeExportPayload(
    payload: GeometryBufferPayload,
    topVertexCount: number,
    options: CloseAndSerializeExportOptions = {},
): CloseAndSerializeExportResult {
    const geometry = payloadToGeometry(payload);
    geometry.userData = {
        isMultiMeshBase: true,
        topVertexCount,
    };

    const { geometry: reduced, bottomRimVertexCount, usedReducedBottom } = prepareReducedExportGeometry(
        geometry,
        { precomputedBottomRim: options.precomputedBottomRim },
    );
    geometry.dispose();

    const reducedTopVc =
        (reduced.userData as { topVertexCount?: number }).topVertexCount ?? topVertexCount;

    if (usedReducedBottom && bottomRimVertexCount < 3) {
        reduced.dispose();
        throw new Error("Bottom rim loop too small to bridge (< 3 vertices)");
    }

    try {
        validateExportHeightAxis(reduced, reducedTopVc);
        const closed = closeMeshPerimeter(reduced, { exportMode: true });
        try {
            const stlBuffer = geometryToBinarySTL(closed.geometry);
            return { stlBuffer, bottomRimVertexCount, usedReducedBottom };
        } finally {
            closed.geometry.dispose();
        }
    } finally {
        reduced.dispose();
    }
}
