import { geometryToPayload } from "@/lib/geometry/geometry-buffer";
import type { InsoleParams } from "@/lib/geometry/insole";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { analyzeManifoldBuffers } from "@/lib/geometry/manifold-core";
import { applyEditsToPayload } from "@/lib/geometry/mesh-edit-core";
import type { SerializedTrimLine, SerializedVertexOverride } from "@/lib/geometry/mesh-edit-serialize";

export type WorkerRequest =
    | { id: number; type: "build"; params: InsoleParams }
    | {
          id: number;
          type: "buildWithEdits";
          params: InsoleParams;
          trimLines: SerializedTrimLine[];
          vertexOverrides: SerializedVertexOverride[];
      }
    | { id: number; type: "manifold"; positions: Float32Array; indices: Uint32Array | null };

export type WorkerResponse =
    | { id: number; type: "geometry"; payload: ReturnType<typeof geometryToPayload> }
    | { id: number; type: "manifold"; report: ReturnType<typeof analyzeManifoldBuffers> }
    | { id: number; type: "error"; message: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data;
    try {
        if (msg.type === "build") {
            const geometry = buildInsoleGeometry(msg.params);
            const payload = geometryToPayload(geometry);
            geometry.dispose();
            const transfer: Transferable[] = [payload.positions.buffer as ArrayBuffer];
            if (payload.indices) transfer.push(payload.indices.buffer as ArrayBuffer);
            (self as DedicatedWorkerGlobalScope).postMessage(
                { id: msg.id, type: "geometry", payload } satisfies WorkerResponse,
                transfer,
            );
            return;
        }

        if (msg.type === "buildWithEdits") {
            const geometry = buildInsoleGeometry(msg.params);
            let payload = geometryToPayload(geometry);
            geometry.dispose();
            payload = applyEditsToPayload(payload, msg.trimLines, msg.vertexOverrides);
            const transfer: Transferable[] = [payload.positions.buffer as ArrayBuffer];
            if (payload.indices) transfer.push(payload.indices.buffer as ArrayBuffer);
            (self as DedicatedWorkerGlobalScope).postMessage(
                { id: msg.id, type: "geometry", payload } satisfies WorkerResponse,
                transfer,
            );
            return;
        }

        if (msg.type === "manifold") {
            const report = analyzeManifoldBuffers(msg.positions, msg.indices);
            (self as DedicatedWorkerGlobalScope).postMessage({
                id: msg.id,
                type: "manifold",
                report,
            } satisfies WorkerResponse);
        }
    } catch (e) {
        (self as DedicatedWorkerGlobalScope).postMessage({
            id: msg.id,
            type: "error",
            message: e instanceof Error ? e.message : String(e),
        } satisfies WorkerResponse);
    }
};
