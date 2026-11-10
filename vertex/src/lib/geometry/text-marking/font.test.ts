// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import * as os from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { loadTextFont, primeTextFont, resetTextFontCacheForTests } from "./font";

const originalFetch = globalThis.fetch;

function bundledFontBytes(): ArrayBuffer {
    const buf = readFileSync(resolve("vertex/public/fonts/Inter-Bold.ttf"));
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(buf);
    return copy;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetTextFontCacheForTests();
});

describe("primeTextFont", () => {
    test("primed bytes load with no fetch when cwd has no font", async () => {
        const previous = process.cwd();
        const bytes = bundledFontBytes();
        let fetches = 0;
        globalThis.fetch = async () => {
            fetches += 1;
            throw new Error("fetch should not run");
        };
        try {
            resetTextFontCacheForTests();
            process.chdir(os.tmpdir());
            const primed = primeTextFont(bytes);
            const loaded = await loadTextFont();
            expect(fetches).toBe(0);
            expect(loaded).toBe(primed);
            expect(loaded.unitsPerEm).toBeGreaterThan(0);
        } finally {
            process.chdir(previous);
        }
    });
});
