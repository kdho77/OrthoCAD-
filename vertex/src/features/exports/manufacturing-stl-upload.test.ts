// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { gzipSync } from "node:zlib";
import { describe, expect, test } from "@rstest/core";
import { buildManufacturingUploadBody, sha256ArrayBuffer } from "@/features/exports/manufacturing-stl-upload";
import { decodeManufacturingUploadBytes } from "../../../server/src/routers/manufacturing-session";

describe("manufacturing STL upload compression", () => {
    test("gzip round trip preserves bytes when CompressionStream is available", async () => {
        const raw = new Uint8Array(64_000);
        for (let i = 0; i < raw.length; i++) raw[i] = i % 251;
        const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
        const before = await sha256ArrayBuffer(buffer);
        const packed = await buildManufacturingUploadBody(buffer);
        expect(packed.sha256).toBe(before);
        if (packed.compressed) {
            const restored = decodeManufacturingUploadBytes(new Uint8Array(packed.body as ArrayBuffer));
            expect(await sha256ArrayBuffer(restored.buffer)).toBe(before);
        } else {
            expect(await sha256ArrayBuffer(buffer)).toBe(before);
        }
    });

    test("server decode restores gzipped STL bytes", () => {
        const plain = new TextEncoder().encode("solid orthocad\nendsolid\n");
        const gz = gzipSync(plain);
        const out = decodeManufacturingUploadBytes(gz);
        expect(Array.from(out)).toEqual(Array.from(plain));
    });
});
