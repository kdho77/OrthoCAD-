// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { sealInternalSlitsSafe } from "@/lib/geometry/bottom-mesh-clean";
import {
    ensureWatertightForExport,
    extractAllBoundaryCyclesForTest,
    extractBoundaryLoops,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { loadRawDefaultGlb } from "../../../../tests/helpers/load-production-default-glb";

describe("Default.glb stock base closure", () => {
    test("mesh-close path is exercised with correct [top][bottom] vertex split", async () => {
        const raw = await loadRawDefaultGlb();
        const topVc = (raw.userData as { topVertexCount: number }).topVertexCount;
        expect(topVc).toBeGreaterThan(40_000);
        expect(raw.getAttribute("position").count).toBeGreaterThan(topVc);
        expect((raw.userData as { isMultiMeshBase?: boolean }).isMultiMeshBase).toBe(true);

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
        const raw = await loadRawDefaultGlb();
        const topN = (raw.userData as { topVertexCount: number }).topVertexCount;
        const pos = raw.getAttribute("position")!;
        const index = raw.index!;
        const botPositions: number[] = [];
        const oldToNew = new Map<number, number>();
        for (let i = topN; i < pos.count; i++) {
            oldToNew.set(i, botPositions.length / 3);
            botPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        }
        const botIndices: number[] = [];
        for (let t = 0; t < index.count; t += 3) {
            const a = index.getX(t),
                b = index.getX(t + 1),
                c = index.getX(t + 2);
            if (a < topN || b < topN || c < topN) continue;
            botIndices.push(oldToNew.get(a)!, oldToNew.get(b)!, oldToNew.get(c)!);
        }
        let bottomGeometry = new THREE.BufferGeometry();
        bottomGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(botPositions), 3));
        bottomGeometry.setIndex(botIndices);
        bottomGeometry = mergeVertices(bottomGeometry);

        const start = performance.now();
        await sealInternalSlitsSafe(bottomGeometry);
        const elapsed = performance.now() - start;
        console.log("[BENCH] sealInternalSlitsSafe elapsed:", elapsed, "ms");
        expect(elapsed).toBeLessThan(5000);

        bottomGeometry.dispose();
        raw.dispose();
    });
});
