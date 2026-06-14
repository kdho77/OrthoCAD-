// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { GeometryBufferPayload } from "@/lib/geometry/geometry-buffer";
import { payloadToGeometry } from "@/lib/geometry/geometry-buffer";
import { closeMeshPerimeter, prepareReducedExportGeometry } from "@/lib/geometry/mesh-close";
import { geometryToBinarySTL } from "@/lib/geometry/stl";

export interface CloseAndSerializeExportResult {
    stlBuffer: ArrayBuffer;
    bottomRimVertexCount: number;
    usedReducedBottom: boolean;
}

/** Worker-safe: reduce bottom shell → bridge weld → binary STL. */
export function closeAndSerializeExportPayload(
    payload: GeometryBufferPayload,
    topVertexCount: number,
): CloseAndSerializeExportResult {
    const geometry = payloadToGeometry(payload);
    geometry.userData = {
        isMultiMeshBase: true,
        topVertexCount,
    };

    const { geometry: reduced, bottomRimVertexCount, usedReducedBottom } = prepareReducedExportGeometry(geometry);
    geometry.dispose();

    try {
        const closed = closeMeshPerimeter(reduced);
        try {
            const stlBuffer = geometryToBinarySTL(closed.geometry);
            return { stlBuffer, bottomRimVertexCount, usedReducedBottom };
        } finally {
            closed.geometry.dispose();
        }
    } finally {
        if (reduced !== geometry) reduced.dispose();
    }
}
