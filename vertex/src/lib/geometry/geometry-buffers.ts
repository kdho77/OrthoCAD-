import { BufferAttribute, BufferGeometry } from "three";

/** Transferable mesh payload for worker ↔ main thread. */
export interface MeshBuffers {
    position: Float32Array;
    index: Uint32Array;
}

export function geometryToBuffers(geometry: BufferGeometry): MeshBuffers {
    const positionAttr = geometry.getAttribute("position");
    const indexAttr = geometry.getIndex();
    if (!indexAttr) {
        throw new Error("Geometry must be indexed for worker transfer");
    }
    return {
        position: new Float32Array(positionAttr.array),
        index: new Uint32Array(indexAttr.array),
    };
}

export function buffersToGeometry(buffers: MeshBuffers): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(buffers.position, 3));
    geometry.setIndex(Array.from(buffers.index));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}
