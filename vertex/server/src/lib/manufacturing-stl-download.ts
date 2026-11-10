// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { TRPCError } from "@trpc/server";

import { readUpstreamErrorText } from "./upstream-error.js";

export async function downloadManufacturingStl(url: string): Promise<Uint8Array> {
    let response: Response;
    try {
        response = await fetch(url);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Could not download manufacturing STL: ${message}`,
        });
    }
    if (!response.ok) {
        const detail = await readUpstreamErrorText(response);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Could not download manufacturing STL (${response.status}): ${detail}`,
        });
    }
    return new Uint8Array(await response.arrayBuffer());
}
