// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
import { geometryToPayload } from "@/lib/geometry/geometry-buffer";
import type {
    ProceduralWallWorkerRequest,
    ProceduralWallWorkerResponse,
} from "@/lib/geometry/procedural-wall/preview-loft-worker";
import {
    buildProceduralViewerPattern,
    reconstructProceduralPreview,
} from "@/lib/geometry/procedural-wall/sample-top-preview";

self.onmessage = (event: MessageEvent<ProceduralWallWorkerRequest>) => {
    const msg = event.data;
    void (async () => {
        try {
            if (msg.type === "buildPattern") {
                const geo = new BufferGeometry();
                geo.setAttribute("position", new BufferAttribute(msg.positions, 3));
                if (msg.indices) geo.setIndex(new BufferAttribute(msg.indices, 1));
                const pattern = buildProceduralViewerPattern(geo, msg.scanPattern, msg.corrections);
                geo.dispose();
                const response: ProceduralWallWorkerResponse = {
                    id: msg.id,
                    type: "pattern",
                    pattern,
                };
                (self as DedicatedWorkerGlobalScope).postMessage(response);
                return;
            }
            if (msg.type !== "reconstruct") {
                throw new Error(`Unknown procedural wall worker message: ${String(msg.type)}`);
            }
            const geo = new BufferGeometry();
            geo.setAttribute("position", new BufferAttribute(msg.positions, 3));
            if (msg.indices) geo.setIndex(new BufferAttribute(msg.indices, 1));
            const preview = await reconstructProceduralPreview(geo, msg.options);
            geo.dispose();
            const payload = geometryToPayload(preview.geometry);
            const userData = preview.geometry.userData ?? {};
            preview.geometry.dispose();
            const transfer: Transferable[] = [payload.positions.buffer as ArrayBuffer];
            if (payload.indices) transfer.push(payload.indices.buffer as ArrayBuffer);
            const response: ProceduralWallWorkerResponse = {
                id: msg.id,
                type: "geometry",
                payload,
                pattern: preview.pattern,
                userData: {
                    stationCount: userData.stationCount ?? userData.loftN,
                    loftN: userData.loftN,
                    bottomOutlineB: JSON.parse(JSON.stringify(userData.bottomOutlineB ?? null)),
                    bottomPatternSource: userData.bottomPatternSource,
                },
            };
            (self as DedicatedWorkerGlobalScope).postMessage(response, transfer);
        } catch (e) {
            const response: ProceduralWallWorkerResponse = {
                id: msg.id,
                type: "error",
                message: e instanceof Error ? e.message : String(e),
            };
            (self as DedicatedWorkerGlobalScope).postMessage(response);
        }
    })();
};
