// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { BufferAttribute, BufferGeometry } from "three";
import { geometryToPayload } from "@/lib/geometry/geometry-buffer";
import type {
    ProceduralWallWorkerRequest,
    ProceduralWallWorkerResponse,
} from "@/lib/geometry/procedural-wall/preview-loft-worker";
import {
    applyExportText,
    buildProceduralViewerPattern,
    reconstructProceduralPreview,
} from "@/lib/geometry/procedural-wall/sample-top-preview";

export interface ProceduralWallWorkerResult {
    response: ProceduralWallWorkerResponse;
    transfer?: Transferable[];
}

/** Drop functions so userData can cross postMessage. Cycles become null. */
function stripFunctions(value: unknown, stack = new WeakSet<object>()): unknown {
    if (typeof value === "function" || typeof value === "symbol") return undefined;
    if (value === null || typeof value !== "object") return value;
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
    if (value instanceof Date || value instanceof Map || value instanceof Set) return value;
    if (stack.has(value)) return null;
    stack.add(value);
    try {
        if (Array.isArray(value)) return value.map((item) => stripFunctions(item, stack));
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            const next = stripFunctions(entry, stack);
            if (next !== undefined) out[key] = next;
        }
        return out;
    } finally {
        stack.delete(value);
    }
}

function cloneUserData(userData: unknown): Record<string, unknown> {
    const stripped = stripFunctions(userData ?? {});
    try {
        return structuredClone(stripped) as Record<string, unknown>;
    } catch {
        const ud = (stripped ?? {}) as Record<string, unknown>;
        const subset = {
            wallModel: ud.wallModel,
            topVertexCount: ud.topVertexCount,
            loftN: ud.loftN,
            stationCount: ud.stationCount,
            bottomOutlineB: ud.bottomOutlineB ?? null,
            bottomPatternSource: ud.bottomPatternSource,
            textMarking: ud.textMarking ?? null,
            textGuide: ud.textGuide ?? null,
            textFitError: ud.textFitError ?? null,
        };
        try {
            return structuredClone(subset) as Record<string, unknown>;
        } catch {
            return {
                wallModel: typeof ud.wallModel === "string" ? ud.wallModel : undefined,
                topVertexCount: typeof ud.topVertexCount === "number" ? ud.topVertexCount : undefined,
            };
        }
    }
}

/**
 * Same reconstruct / pattern / cold-export work the main thread runs.
 * The export solid message lofts the mesh it is given (already mirrored) and
 * applies text with {@link applyExportText} so belt-print engraving matches.
 */
export async function handleProceduralWallWorkerRequest(
    msg: ProceduralWallWorkerRequest,
): Promise<ProceduralWallWorkerResult> {
    try {
        if (msg.type === "buildPattern") {
            const geo = new BufferGeometry();
            geo.setAttribute("position", new BufferAttribute(msg.positions, 3));
            if (msg.indices) geo.setIndex(new BufferAttribute(msg.indices, 1));
            const pattern = buildProceduralViewerPattern(geo, msg.scanPattern, msg.corrections);
            geo.dispose();
            return {
                response: {
                    id: msg.id,
                    type: "pattern",
                    pattern,
                },
            };
        }
        if (msg.type === "exportSolid") {
            const geo = new BufferGeometry();
            geo.setAttribute("position", new BufferAttribute(msg.positions, 3));
            if (msg.indices) geo.setIndex(new BufferAttribute(msg.indices, 1));
            try {
                const preview = await reconstructProceduralPreview(geo, msg.options);
                const prePayload = geometryToPayload(preview.geometry);
                const preUserData = cloneUserData(preview.geometry.userData);
                const marked = await applyExportText(preview.geometry, msg.options);
                const postPayload = geometryToPayload(marked);
                const postUserData = cloneUserData(marked.userData);
                // applyExportText disposes the pre-text mesh when engraving returns a new one.
                marked.dispose();
                const transfer: Transferable[] = [
                    prePayload.positions.buffer as ArrayBuffer,
                    postPayload.positions.buffer as ArrayBuffer,
                ];
                if (prePayload.indices) transfer.push(prePayload.indices.buffer as ArrayBuffer);
                if (postPayload.indices) transfer.push(postPayload.indices.buffer as ArrayBuffer);
                return {
                    response: {
                        id: msg.id,
                        type: "exportSolid",
                        prePayload,
                        postPayload,
                        preUserData,
                        postUserData,
                    },
                    transfer,
                };
            } finally {
                geo.dispose();
            }
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
        const { buildTextGuide } = await import("@/lib/geometry/text-marking/place");
        const textGuide = buildTextGuide(preview.geometry);
        const marking = msg.options.textMarking;
        let textFitError: string | null = null;
        const { hasActiveComposedTextMarking } = await import("@/lib/geometry/text-marking/compose");
        if (
            marking &&
            hasActiveComposedTextMarking(marking, msg.options.patientDisplayName, msg.options.side ?? "right")
        ) {
            const { applyTextMarkingToPrintSolid } = await import("@/lib/geometry/text-marking/apply");
            const { TextMarkingError } = await import("@/lib/geometry/text-marking/errors");
            try {
                outGeo = await applyTextMarkingToPrintSolid(
                    preview.geometry,
                    marking,
                    {
                        side: msg.options.side ?? "right",
                    },
                    msg.options.patientDisplayName,
                );
            } catch (e) {
                if (!(e instanceof TextMarkingError)) throw e;
                textFitError = e.message;
                outGeo = preview.geometry;
            }
            if (outGeo !== preview.geometry) preview.geometry.dispose();
        }
        outGeo.userData = { ...outGeo.userData, textGuide, textFitError };
        const payload = geometryToPayload(outGeo);
        const userData = outGeo.userData ?? {};
        outGeo.dispose();
        const transfer: Transferable[] = [payload.positions.buffer as ArrayBuffer];
        if (payload.indices) transfer.push(payload.indices.buffer as ArrayBuffer);
        return {
            response: {
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
            },
            transfer,
        };
    } catch (e) {
        return {
            response: {
                id: msg.id,
                type: "error",
                message: e instanceof Error ? e.message : String(e),
            },
        };
    }
}

function bindProceduralWallWorker(): void {
    if (typeof DedicatedWorkerGlobalScope === "undefined") return;
    const scope = self as DedicatedWorkerGlobalScope;
    if (!(scope instanceof DedicatedWorkerGlobalScope)) return;
    scope.onmessage = (event: MessageEvent<ProceduralWallWorkerRequest>) => {
        void handleProceduralWallWorkerRequest(event.data).then((result) => {
            if (result.transfer && result.transfer.length > 0) {
                scope.postMessage(result.response, result.transfer);
                return;
            }
            scope.postMessage(result.response);
        });
    };
}

bindProceduralWallWorker();
