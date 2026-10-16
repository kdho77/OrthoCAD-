// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { ElementManifest } from "./types";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function elementsDir(): string {
    const a = resolve(process.cwd(), "vertex/public/elements");
    const b = resolve(process.cwd(), "public/elements");
    return existsSync(a) ? a : b;
}

describe("element library thumbnails", () => {
    test("every library asset has a committed heatmap thumbnail", () => {
        const dir = elementsDir();
        const index = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8")) as ElementManifest;
        expect(index.elements.length).toBeGreaterThan(0);
        for (const entry of index.elements) {
            const thumb = entry.thumb ?? "";
            expect(thumb.length).toBeGreaterThan(0);
            const thumbPath = resolve(dir, thumb);
            expect(existsSync(thumbPath)).toBe(true);
            const bytes = readFileSync(thumbPath);
            expect(bytes.length).toBeGreaterThan(100);
            expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
        }
    });
});
