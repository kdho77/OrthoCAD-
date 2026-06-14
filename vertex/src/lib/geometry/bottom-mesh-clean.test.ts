// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "@rstest/core";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BufferAttribute, BufferGeometry } from "three";
import {
    extractBoundaryChainsForTest,
    sealInternalSlits,
    sealInternalSlitsSafe,
    setMaxWalkStepsForTesting,
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

/** Two triangles sharing only V0 — V0 has four open boundary half-edges (degree-4 node). */
function makeDegree4HubGeometry(): BufferGeometry {
    const positions = new Float32Array([
        0, 0, 0, // 0 hub
        1, 0, 0, // 1
        0, 1, 0, // 2
        -1, 0, 0, // 3
        0, -1, 0, // 4
    ]);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex([0, 1, 2, 0, 3, 4]);
    return geometry;
}

/**
 * Degree-4 hub with two near-closed slit flaps (slit A on 1–10, slit B on 4–50).
 * V0 remains degree-4 with four distinct open boundary spokes.
 */
function makeTwoSlitDegree4Geometry(): BufferGeometry {
    const positions = new Float32Array([
        0, 0, 0, // 0 hub
        0.02, 0, 0, // 1 slit A
        0, 0.02, 0, // 10 slit A tip
        -2, 0, 0, // 2 outer flap
        -2, 1, 0, // 20
        -0.02, 0, 0, // 4 slit B
        0, -0.02, 0, // 50 slit B tip
        2, 0, 0, // 6 outer flap
        2, 1, 0, // 70
    ]);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex([
        0, 1, 10, // slit A flap
        0, 2, 20, // outer flap (keeps V0–2 open)
        0, 4, 50, // slit B flap
        0, 6, 70, // outer flap (keeps V0–6 open)
    ]);
    return geometry;
}

/** Open-boundary triangle strip whose longest boundary chain exceeds small MAX_WALK_STEPS. */
function makeLongBoundaryPathGeometry(segmentCount: number): BufferGeometry {
    const vertCount = segmentCount + 2;
    const positions = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) {
        positions[i * 3] = i * 0.1;
        positions[i * 3 + 1] = i % 2 === 0 ? 0 : 0.05;
        positions[i * 3 + 2] = 0;
    }
    const indices: number[] = [];
    for (let i = 0; i < segmentCount; i++) {
        indices.push(i, i + 1, i + 2);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    return geometry;
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
    afterEach(() => {
        setMaxWalkStepsForTesting(null);
    });

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

    test("Test D — degree-4 synthetic hub completes sealInternalSlitsSafe without hang", async () => {
        const geometry = makeDegree4HubGeometry();
        const t0 = performance.now();
        const result = await sealInternalSlitsSafe(geometry);
        const elapsed = performance.now() - t0;

        expect(result).toBeInstanceOf(BufferGeometry);
        expect(elapsed).toBeLessThan(1000);
        if (result !== geometry) result.dispose();
        geometry.dispose();
    });

    test("Test E — two slits at degree-4 hub extract separate chains and seal reduces open edges", () => {
        const geometry = makeTwoSlitDegree4Geometry();
        const chainsBefore = extractBoundaryChainsForTest(geometry);
        expect(chainsBefore.length).toBeGreaterThanOrEqual(2);

        const openBefore = analyzeManifold(geometry).openEdges;
        const sealed = sealInternalSlits(geometry);
        const openAfter = analyzeManifold(sealed).openEdges;
        expect(openAfter).toBeLessThan(openBefore);

        if (sealed !== geometry) sealed.dispose();
        geometry.dispose();
    });

    test("Test F — MAX_WALK_STEPS guard fires independently of async timeout", () => {
        const geometry = makeLongBoundaryPathGeometry(24);
        const warnSpy = rs.spyOn(console, "warn").mockImplementation(() => {});

        setMaxWalkStepsForTesting(4);
        try {
            const result = sealInternalSlits(geometry);
            expect(result).toBeInstanceOf(BufferGeometry);
            expect(
                warnSpy.mock.calls.some((call) =>
                    String(call[0]).includes("MAX_WALK_STEPS"),
                ),
            ).toBe(true);
            if (result !== geometry) result.dispose();
        } finally {
            setMaxWalkStepsForTesting(null);
            warnSpy.mockRestore();
            geometry.dispose();
        }
    });
});
