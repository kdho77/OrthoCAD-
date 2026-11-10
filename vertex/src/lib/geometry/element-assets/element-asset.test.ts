// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import * as os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "@rstest/core";
import {
    injectElementAssetSource,
    loadElementManifest,
    resetElementAssetSourceForTests,
} from "./element-asset";

const ELEMENTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../public/elements");

afterEach(() => {
    resetElementAssetSourceForTests();
});

describe("element asset source injection", () => {
    test("elementsBaseDir is used when cwd has no public/elements", async () => {
        const previous = process.cwd();
        try {
            process.chdir(os.tmpdir());
            injectElementAssetSource({ elementsBaseDir: ELEMENTS_DIR });
            const manifest = await loadElementManifest();
            expect(manifest.elements.some((entry) => entry.glb === "met_bar_1.right.glb")).toBe(true);
        } finally {
            process.chdir(previous);
        }
    });

    test("a reader supplies bytes without cwd or fetch", async () => {
        const previous = process.cwd();
        const index = readFileSync(resolve(ELEMENTS_DIR, "index.json"));
        let fetches = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => {
            fetches += 1;
            throw new Error("fetch should not run");
        };
        try {
            process.chdir(os.tmpdir());
            injectElementAssetSource({
                reader: (relativePath) => {
                    if (relativePath !== "index.json") throw new Error(`unexpected ${relativePath}`);
                    return new Uint8Array(index);
                },
            });
            const manifest = await loadElementManifest();
            expect(manifest.elements.length).toBeGreaterThan(0);
            expect(fetches).toBe(0);
        } finally {
            globalThis.fetch = originalFetch;
            process.chdir(previous);
        }
    });
});
