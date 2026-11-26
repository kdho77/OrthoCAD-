// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { TRPCError } from "@trpc/server";

import { isStalePre52ManufacturingStlBytes } from "./manufacturing-stl-identity.js";
import { readUpstreamErrorText } from "./upstream-error.js";

export const STALE_MANUFACTURING_STL_MESSAGE =
    "Refusing a stale pre-#52 manufacturing STL (eTag 8f5dc451de66dbba8f8521e046a9e4af). Rematerialize the belt loft before slicing.";

export async function downloadManufacturingStl(url: string): Promise<Uint8Array> {
    if (url.includes("manufacturing-archive/")) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Refusing a stored manufacturing archive STL. Rebuild from the saved design.",
        });
    }
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
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (isStalePre52ManufacturingStlBytes(bytes)) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: STALE_MANUFACTURING_STL_MESSAGE,
        });
    }
    return bytes;
}
