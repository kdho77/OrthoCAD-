import { BufferAttribute, BufferGeometry } from "three";
import type { ManifoldReport } from "@/lib/geometry/manifold";

/** Serializable geometry payload transferred from the worker. */
export interface GeometryBufferPayload {
    positions: Float32Array;
    indices: Uint32Array | null;
}

export interface ManifoldBufferPayload extends ManifoldReport {}

export function geometryToPayload(geometry: BufferGeometry): GeometryBufferPayload {
    const posAttr = geometry.getAttribute("position");
    const positions = new Float32Array(posAttr.array as ArrayLike<number>);
    const index = geometry.getIndex();
    const indices = index ? new Uint32Array(index.array as ArrayLike<number>) : null;
    return { positions, indices };
}

export function payloadToGeometry(payload: GeometryBufferPayload): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(payload.positions, 3));
    if (payload.indices) {
        geometry.setIndex(new BufferAttribute(payload.indices, 1));
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

/** Clone payload buffers for transferables (worker postMessage). */
export function clonePayloadForTransfer(payload: GeometryBufferPayload): {
    payload: GeometryBufferPayload;
    transfer: ArrayBuffer[];
} {
    const positions = new Float32Array(payload.positions);
    const indices = payload.indices ? new Uint32Array(payload.indices) : null;
    const transfer: ArrayBuffer[] = [positions.buffer];
    if (indices) transfer.push(indices.buffer);
    return { payload: { positions, indices }, transfer };
}
