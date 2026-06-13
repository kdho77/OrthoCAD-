// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import {
    ensureWatertightForExport,
    extractAllBoundaryCyclesForTest,
    MeshNotWatertightError,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";

const DEFAULT_GLB_URL =
    "https://wstneucimlemaokoyjwh.supabase.co/storage/v1/object/public/stock-bases/Templates/Default.glb";
const DEFAULT_GLB_CACHE = "/tmp/Default.glb";

async function loadDefaultGlbBuffer(): Promise<ArrayBuffer> {
    if (!existsSync(DEFAULT_GLB_CACHE)) {
        const res = await fetch(DEFAULT_GLB_URL);
        if (!res.ok) throw new Error(`Failed to download Default.glb (${res.status})`);
        writeFileSync(DEFAULT_GLB_CACHE, Buffer.from(await res.arrayBuffer()));
    }
    return readFileSync(DEFAULT_GLB_CACHE).buffer.slice(0);
}

describe("Default.glb stock base closure", () => {
    test("mesh-close path is exercised with correct [top][bottom] vertex split", async () => {
        const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
        const merged = extractMergedGeometry(group);
        expect(merged).not.toBeNull();
        expect(merged!.meshCount).toBe(2);
        expect(merged!.meshNames[0]).toMatch(/top/i);

        const raw = merged!.geometry;
        const topVc = (raw.userData as { topVertexCount: number }).topVertexCount;
        expect(topVc).toBeGreaterThan(40_000);
        expect(raw.getAttribute("position").count).toBeGreaterThan(topVc);

        const pre = validateManifold(raw);
        expect(pre.openEdges).toBeGreaterThan(1000);

        const cycles = extractAllBoundaryCyclesForTest(raw);
        expect(cycles.length).toBeGreaterThan(0);

        expect(() => ensureWatertightForExport(raw.clone())).toThrow(MeshNotWatertightError);

        raw.dispose();
    });
});
