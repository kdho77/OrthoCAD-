import { geometryToPayload } from "@/lib/geometry/geometry-buffer";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import type { InsoleParams } from "@/lib/geometry/insole";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { analyzeManifoldBuffers } from "@/lib/geometry/manifold-core";
import { applyEditsToPayload } from "@/lib/geometry/mesh-edit-core";
import type { SerializedTrimLine, SerializedVertexOverride } from "@/lib/geometry/mesh-edit-serialize";
import { deserializeTrimlineCurve } from "@/lib/geometry/trimline";
import { buildTrimlineInsoleMesh } from "@/lib/geometry/trimline-mesh";
import type { TrimlinePoint } from "@/types";

export interface TrimlineMeshRequestPayload {
    /** Serialised closed trimline (XY in local footprint mm, z ignored). */
    trimline: TrimlinePoint[];
    /** Height field params (same shape used by the insole builder). */
    field: Omit<HeightFieldParams, "trimline"> & { trimline?: null };
    perimeterSamples?: number;
    topRings?: number;
    bottomRings?: number;
    bottomInsetMm?: number;
    minWallThicknessMm?: number;
    bottomZ?: number;
}

export type WorkerRequest =
    | { id: number; type: "build"; params: InsoleParams }
    | {
          id: number;
          type: "buildWithEdits";
          params: InsoleParams;
          trimLines: SerializedTrimLine[];
          vertexOverrides: SerializedVertexOverride[];
      }
    | { id: number; type: "manifold"; positions: Float32Array; indices: Uint32Array | null }
    | { id: number; type: "buildTrimlineMesh"; payload: TrimlineMeshRequestPayload };

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
            return;
        }

        if (msg.type === "buildTrimlineMesh") {
            const { payload } = msg;
            const trimline = deserializeTrimlineCurve(payload.trimline);
            const geometry = buildTrimlineInsoleMesh({
                trimline,
                field: { ...payload.field, trimline },
                perimeterSamples: payload.perimeterSamples,
                topRings: payload.topRings,
                bottomRings: payload.bottomRings,
                bottomInsetMm: payload.bottomInsetMm,
                minWallThicknessMm: payload.minWallThicknessMm,
                bottomZ: payload.bottomZ,
            });
            const out = geometryToPayload(geometry);
            geometry.dispose();
            const transfer: Transferable[] = [out.positions.buffer as ArrayBuffer];
            if (out.indices) transfer.push(out.indices.buffer as ArrayBuffer);
            (self as DedicatedWorkerGlobalScope).postMessage(
                { id: msg.id, type: "geometry", payload: out } satisfies WorkerResponse,
                transfer,
            );
            return;
        }
    } catch (e) {
        (self as DedicatedWorkerGlobalScope).postMessage({
            id: msg.id,
            type: "error",
            message: e instanceof Error ? e.message : String(e),
        } satisfies WorkerResponse);
    }
};
