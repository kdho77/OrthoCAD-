// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { GeometryBufferPayload } from "@/lib/geometry/geometry-buffer";
import { closeAndSerializeExportPayload } from "@/lib/geometry/mesh-export-core";

export type MeshExportWorkerRequest = {
    type: "CLOSE_AND_SERIALIZE";
    id: number;
    payload: GeometryBufferPayload;
    topVertexCount: number;
};

export type MeshExportWorkerResponse =
    | {
          type: "STL_READY";
          id: number;
          stlBuffer: ArrayBuffer;
          bottomRimVertexCount: number;
          usedReducedBottom: boolean;
      }
    | {
          type: "ERROR";
          id: number;
          message: string;
      };

self.onmessage = (event: MessageEvent<MeshExportWorkerRequest>) => {
    const msg = event.data;
    if (msg.type !== "CLOSE_AND_SERIALIZE") return;

    try {
        const result = closeAndSerializeExportPayload(msg.payload, msg.topVertexCount);
        (self as DedicatedWorkerGlobalScope).postMessage(
            {
                type: "STL_READY",
                id: msg.id,
                stlBuffer: result.stlBuffer,
                bottomRimVertexCount: result.bottomRimVertexCount,
                usedReducedBottom: result.usedReducedBottom,
            } satisfies MeshExportWorkerResponse,
            [result.stlBuffer],
        );
    } catch (error) {
        (self as DedicatedWorkerGlobalScope).postMessage({
            type: "ERROR",
            id: msg.id,
            message: error instanceof Error ? error.message : String(error),
        } satisfies MeshExportWorkerResponse);
    }
};
