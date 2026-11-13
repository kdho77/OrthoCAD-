// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { sha256Hex } from "@/lib/geometry/procedural-wall/sha256";

export async function sha256ArrayBuffer(bytes: ArrayBuffer): Promise<string> {
    if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    const view = new Uint8Array(bytes);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < view.length; i += chunk) {
        binary += String.fromCharCode(...view.subarray(i, i + chunk));
    }
    return sha256Hex(binary);
}

export interface ManufacturingUploadBody {
    body: ArrayBuffer | Uint8Array;
    contentEncoding?: "gzip";
    sha256: string;
    compressed: boolean;
}

function compressionStreamAvailable(): boolean {
    return typeof CompressionStream !== "undefined";
}

async function gzipArrayBuffer(bytes: ArrayBuffer): Promise<ArrayBuffer> {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream).arrayBuffer();
}

async function gunzipArrayBuffer(bytes: ArrayBuffer): Promise<ArrayBuffer> {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).arrayBuffer();
}

function decompressionAvailable(): boolean {
    return typeof DecompressionStream !== "undefined";
}

/**
 * Optional gzip for manufacturing STL / regional 3MF PUT payloads.
 * Verifies SHA-256 before and after compression; falls back to raw bytes when gzip is unavailable.
 */
export async function buildManufacturingUploadBody(bytes: ArrayBuffer): Promise<ManufacturingUploadBody> {
    const sha256 = await sha256ArrayBuffer(bytes);
    if (!compressionStreamAvailable() || !decompressionAvailable()) {
        return { body: bytes, sha256, compressed: false };
    }
    try {
        const compressed = await gzipArrayBuffer(bytes);
        const roundTrip = await gunzipArrayBuffer(compressed);
        if ((await sha256ArrayBuffer(roundTrip)) !== sha256) {
            return { body: bytes, sha256, compressed: false };
        }
        if (compressed.byteLength >= bytes.byteLength) {
            return { body: bytes, sha256, compressed: false };
        }
        return { body: compressed, contentEncoding: "gzip", sha256, compressed: true };
    } catch {
        return { body: bytes, sha256, compressed: false };
    }
}
