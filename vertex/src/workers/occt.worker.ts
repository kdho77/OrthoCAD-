// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { geometryToPayload } from "@/lib/geometry/geometry-buffer";
import type { InsoleParams } from "@/lib/geometry/insole";
import { shapeToBufferGeometry } from "@/lib/geometry/mesh-bridge";
import { buildOcctInsoleSolid } from "@/lib/geometry/occt-insole";

export type OcctWorkerRequest = { id: number; type: "build"; params: InsoleParams; wasmUrl: string };

export type OcctWorkerResponse =
    | { id: number; type: "geometry"; payload: ReturnType<typeof geometryToPayload> }
    | { id: number; type: "ready" }
    | { id: number; type: "error"; message: string };

let wasmReady = false;

async function ensureWasm(wasmUrl: string): Promise<void> {
    if (wasmReady) return;
    const response = await fetch(wasmUrl);
    const wasmBinary = await response.arrayBuffer();
    await initWasm({ wasmBinary });
    wasmReady = true;
}

self.onmessage = async (event: MessageEvent<OcctWorkerRequest>) => {
    const msg = event.data;
    try {
        if (msg.type === "build") {
            await ensureWasm(msg.wasmUrl);
            const factory = new ShapeFactory();
            const solid = buildOcctInsoleSolid(factory, msg.params);
            const geometry = shapeToBufferGeometry(solid);
            const payload = geometryToPayload(geometry);
            geometry.dispose();
            const transfer: Transferable[] = [payload.positions.buffer as ArrayBuffer];
            if (payload.indices) transfer.push(payload.indices.buffer as ArrayBuffer);
            (self as DedicatedWorkerGlobalScope).postMessage(
                { id: msg.id, type: "geometry", payload } satisfies OcctWorkerResponse,
                transfer,
            );
        }
    } catch (e) {
        (self as DedicatedWorkerGlobalScope).postMessage({
            id: msg.id,
            type: "error",
            message: e instanceof Error ? e.message : String(e),
        } satisfies OcctWorkerResponse);
    }
};
