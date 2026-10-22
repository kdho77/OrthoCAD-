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

self.onmessage = async (event: MessageEvent<ProceduralWallWorkerRequest>) => {
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
            let outGeo = preview.geometry;
            const marking = msg.options.textMarking;
            let textGuide: unknown = null;
            let textFitError: string | null = null;
            if (marking?.text.trim()) {
                const { buildTextGuide } = await import("@/lib/geometry/text-marking/place");
                textGuide = buildTextGuide(preview.geometry);
                const { applyTextMarkingToPrintSolid } = await import("@/lib/geometry/text-marking/apply");
                const { TextMarkingError } = await import("@/lib/geometry/text-marking/errors");
                try {
                    outGeo = await applyTextMarkingToPrintSolid(preview.geometry, marking, {
                        side: msg.options.side ?? "right",
                    });
                } catch (e) {
                    if (!(e instanceof TextMarkingError)) throw e;
                    textFitError = e.message;
                    outGeo = preview.geometry;
                }
                if (outGeo !== preview.geometry) preview.geometry.dispose();
            }
            const carriedFit = (outGeo.userData as { textFitError?: string | null }).textFitError ?? null;
            outGeo.userData = { ...outGeo.userData, textGuide, textFitError: textFitError ?? carriedFit };
            const clamp = (outGeo.userData as { textPlacementClamp?: unknown }).textPlacementClamp;
            if (textGuide && clamp) {
                const { guideWithPlacementClamp } = await import("@/lib/geometry/text-marking/place");
                textGuide = guideWithPlacementClamp(
                    textGuide as import("@/lib/geometry/text-marking/place").TextGuide,
                    clamp as import("@/lib/geometry/text-marking/place").TextPlacementClamp,
                );
                outGeo.userData = { ...outGeo.userData, textGuide };
            }
            const payload = geometryToPayload(outGeo);
            const userData = outGeo.userData ?? {};
            outGeo.dispose();
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
                    textMarking: userData.textMarking ?? null,
                    textGuide: userData.textGuide ?? null,
                    textFitError: userData.textFitError ?? null,
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
