// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";

import { downloadManufacturingStl } from "./manufacturing-stl-download.js";

const ORIGINAL_FETCH = globalThis.fetch;
const SIGNED = "https://files.example.test/object/sign/file.stl?token=sekret-token&X-Amz-Signature=abc";

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
});

function capture(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const originals = {
        log: console.log,
        error: console.error,
        warn: console.warn,
    };
    const push = (...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    };
    console.log = push;
    console.error = push;
    console.warn = push;
    return {
        lines,
        restore() {
            console.log = originals.log;
            console.error = originals.error;
            console.warn = originals.warn;
        },
    };
}

describe("manufacturing STL download", () => {
    test("logs byte count after one transient retry and never logs the signed URL", async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            if (calls === 1) {
                return new Response("token=sekret-token settingsJson Jane Doe", { status: 503 });
            }
            return new Response(new Uint8Array([9, 8, 7, 6]), { status: 200 });
        }) as typeof fetch;
        const logged = capture();
        try {
            const bytes = await downloadManufacturingStl(SIGNED, { sleep: async () => undefined });
            expect(bytes).toEqual(new Uint8Array([9, 8, 7, 6]));
        } finally {
            logged.restore();
        }
        expect(calls).toBe(2);
        const text = logged.lines.join("\n");
        expect(text).toContain("[manufacturing] STL download complete");
        expect(text).toContain('"stlBytes":4');
        expect(text).not.toMatch(/sekret|settingsJson|Jane Doe|https?:\/\/|\?|token/);
    });

    test("a 404 is not retried", async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            return new Response("missing token=sekret-token", { status: 404 });
        }) as typeof fetch;
        await expect(downloadManufacturingStl(SIGNED, { sleep: async () => undefined })).rejects.toThrow(
            /Could not download manufacturing STL \(404\)/,
        );
        expect(calls).toBe(1);
    });
});
