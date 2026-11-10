// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { TRPCError } from "@trpc/server";

import {
    sanitizeTransportDetail,
    type TransientRetryOptions,
    withOneTransientRetry,
} from "./cad-operator-production.js";
import { readUpstreamErrorText } from "./upstream-error.js";

async function downloadManufacturingStlOnce(url: string): Promise<Uint8Array> {
    let response: Response;
    try {
        response = await fetch(url);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Could not download manufacturing STL: ${sanitizeTransportDetail(message)}`,
        });
    }
    if (!response.ok) {
        const detail = await readUpstreamErrorText(response);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Could not download manufacturing STL (${response.status}): ${sanitizeTransportDetail(detail)}`,
        });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    console.log("[manufacturing] STL download complete", { stlBytes: bytes.byteLength });
    return bytes;
}

/** One retry for a dropped connection or 408/429/5xx. The URL is never logged. */
export async function downloadManufacturingStl(
    url: string,
    retry?: TransientRetryOptions,
): Promise<Uint8Array> {
    return withOneTransientRetry(() => downloadManufacturingStlOnce(url), {
        opName: "stl-download",
        ...retry,
    });
}
