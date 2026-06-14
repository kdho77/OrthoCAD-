// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
    extractBoundaryChainsForTest,
    sealInternalSlits,
    splitDegree4BranchNodes,
} from "@/lib/geometry/bottom-mesh-clean";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
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

function extractBottomPart(group: THREE.Group): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    group.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) {
            parts.push(obj.geometry.clone());
        }
    });
    expect(parts.length).toBeGreaterThanOrEqual(2);
    const welded = mergeVertices(parts[1]!);
    if (welded !== parts[1]) parts[1]!.dispose();
    return welded;
}

describe("bottom-mesh-clean", () => {
    test("splitDegree4BranchNodes duplicates branch vertices and separates boundary chains", async () => {
        const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
        const bottom = extractBottomPart(group);
        const split = splitDegree4BranchNodes(bottom);
        expect(split.getAttribute("position").count).toBeGreaterThan(bottom.getAttribute("position").count);
        const chainsBefore = extractBoundaryChainsForTest(bottom).length;
        const chainsAfter = extractBoundaryChainsForTest(split).length;
        expect(chainsAfter).toBeGreaterThan(chainsBefore);
        if (split !== bottom) split.dispose();
        bottom.dispose();
    });

    test("sealInternalSlits reduces Default.glb bottom open edges (viewer best-effort)", async () => {
        const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
        const bottom = extractBottomPart(group);
        const before = analyzeManifold(bottom).openEdges;
        expect(before).toBeGreaterThan(1000);

        const cleaned = sealInternalSlits(bottom);
        const after = analyzeManifold(cleaned).openEdges;
        expect(after).toBeLessThan(before);
        expect(after).toBeGreaterThan(400);

        if (cleaned !== bottom) cleaned.dispose();
        bottom.dispose();
    });

    test("extractMergedGeometry applies sealBottomSlits only when requested", async () => {
        const top = new THREE.BufferGeometry();
        top.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]), 3));
        top.setIndex([0, 1, 2]);

        const bottom = new THREE.BufferGeometry();
        bottom.setAttribute(
            "position",
            new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.1, 0, 0]), 4),
        );
        bottom.setIndex([0, 1, 2, 0, 2, 3]);

        const group = new THREE.Group();
        const topMesh = new THREE.Mesh(top, new THREE.MeshStandardMaterial());
        topMesh.name = "Top";
        const bottomMesh = new THREE.Mesh(bottom, new THREE.MeshStandardMaterial());
        bottomMesh.name = "Bottom";
        group.add(topMesh);
        group.add(bottomMesh);

        const raw = extractMergedGeometry(group)!;
        const sealed = extractMergedGeometry(group, { sealBottomSlits: true })!;
        expect(raw.meshCount).toBe(2);
        expect(sealed.meshCount).toBe(2);
        expect(sealed.geometry.getAttribute("position").count).toBeGreaterThan(0);

        raw.geometry.dispose();
        sealed.geometry.dispose();
    });
});
