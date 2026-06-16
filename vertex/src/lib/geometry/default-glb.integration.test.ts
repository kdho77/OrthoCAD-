// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import {
    ensureWatertightForExport,
    extractAllBoundaryCyclesForTest,
    extractBoundaryLoops,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { sealInternalSlitsSafe } from "@/lib/geometry/bottom-mesh-clean";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as THREE from "three";

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

        const closed = ensureWatertightForExport(raw.clone());
        const openLoops = extractBoundaryLoops(closed);
        expect(openLoops.length).toBe(0);

        const post = validateManifold(closed);
        expect(post.openEdges).toBeLessThan(pre.openEdges);

        closed.dispose();
        raw.dispose();
    });

    test("sealInternalSlitsSafe completes on Default.glb bottom mesh (benchmark)", async () => {
        const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
        const parts: THREE.BufferGeometry[] = [];
        group.traverse((obj) => {
            if (obj instanceof THREE.Mesh && obj.geometry) {
                parts.push(obj.geometry.clone());
            }
        });
        expect(parts.length).toBeGreaterThanOrEqual(2);
        let bottomGeometry = mergeVertices(parts[1]!);
        if (bottomGeometry !== parts[1]) parts[1]!.dispose();

        const start = performance.now();
        await sealInternalSlitsSafe(bottomGeometry);
        const elapsed = performance.now() - start;
        console.log("[BENCH] sealInternalSlitsSafe elapsed:", elapsed, "ms");
        expect(elapsed).toBeLessThan(5000);

        bottomGeometry.dispose();
    });
});
