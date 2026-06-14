// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
import { closeMeshPerimeter, ensureWatertightForExport } from "@/lib/geometry/mesh-close";
import { geometryToBinarySTL } from "@/lib/geometry/stl";

function appendShellTriangles(
    geometry: BufferGeometry,
    vertexOffset: number,
    flipWinding: boolean,
    out: number[],
): void {
    const index = geometry.getIndex();
    if (index) {
        for (let t = 0; t < index.count; t += 3) {
            const a = index.getX(t) + vertexOffset;
            const b = index.getX(t + 1) + vertexOffset;
            const c = index.getX(t + 2) + vertexOffset;
            if (flipWinding) out.push(a, c, b);
            else out.push(a, b, c);
        }
        return;
    }

    const count = geometry.getAttribute("position").count;
    for (let i = 0; i < count; i += 3) {
        if (flipWinding) out.push(vertexOffset + i, vertexOffset + i + 2, vertexOffset + i + 1);
        else out.push(vertexOffset + i, vertexOffset + i + 1, vertexOffset + i + 2);
    }
}

/** Concatenate top and bottom shells into one multi-mesh body for perimeter closure. */
export function concatTopBottomShells(topGeometry: BufferGeometry, bottomGeometry: BufferGeometry): BufferGeometry {
    const topPos = topGeometry.getAttribute("position");
    const bottomPos = bottomGeometry.getAttribute("position");
    const topCount = topPos.count;
    const bottomCount = bottomPos.count;
    const totalVerts = topCount + bottomCount;
    const positions = new Float32Array(totalVerts * 3);

    for (let i = 0; i < topCount; i++) {
        positions[i * 3] = topPos.getX(i);
        positions[i * 3 + 1] = topPos.getY(i);
        positions[i * 3 + 2] = topPos.getZ(i);
    }
    for (let i = 0; i < bottomCount; i++) {
        const o = topCount + i;
        positions[o * 3] = bottomPos.getX(i);
        positions[o * 3 + 1] = bottomPos.getY(i);
        positions[o * 3 + 2] = bottomPos.getZ(i);
    }

    const indices: number[] = [];
    appendShellTriangles(topGeometry, 0, false, indices);
    appendShellTriangles(bottomGeometry, topCount, true, indices);

    const merged = new BufferGeometry();
    merged.setAttribute("position", new BufferAttribute(positions, 3));
    merged.setIndex(indices);
    merged.userData = { isMultiMeshBase: true, topVertexCount: topCount };
    return merged;
}

/**
 * Close top and bottom viewer shells into one watertight solid via bridge weld
 * (reuses mesh-close perimeter stitching — Laplacian on bridge midpoints only).
 */
export function closeMeshToSolid(topGeometry: BufferGeometry, bottomGeometry: BufferGeometry): BufferGeometry {
    const merged = concatTopBottomShells(topGeometry, bottomGeometry);
    try {
        const result = closeMeshPerimeter(merged);
        if (result.geometry !== merged) merged.dispose();
        return result.geometry;
    } catch (error) {
        merged.dispose();
        throw error;
    }
}

/** Close a live merged viewer mesh (top+bottom with userData.topVertexCount). */
export function closeLiveViewerMeshToSolid(liveGeometry: BufferGeometry): BufferGeometry {
    return ensureWatertightForExport(liveGeometry);
}

/** Pure-JS binary STL writer — no OCCT dependency on the export path. */
export function serializeBinarySTL(geometry: BufferGeometry): ArrayBuffer {
    return geometryToBinarySTL(geometry);
}
