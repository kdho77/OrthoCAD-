// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import {
    closeGlbInsoleToSolid,
    extractOrderedBoundaryLoopWithIndices,
    submeshByVertexRange,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { WedgeCorrection } from "@/types";

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

function fieldForWedge(wedge: WedgeCorrection | undefined): HeightFieldParams {
    return {
        side: "right",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections: {
            forefootPostingDeg: 0,
            rearfootPostingDeg: 0,
            medialSkiveMm: 0,
            lateralSkiveMm: 0,
            archFillMm: 0,
            archHeightMm: 0,
            heelCupDepthMm: 0,
            heelCupHeightMm: 0,
            heelCupWidthMm: 0,
            heelLiftMm: 0,
            apexMoveMm: 0,
            medialFlangeMm: 0,
            lateralFlangeMm: 0,
            rearfootWedge: wedge,
        },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

async function diagnose(wedge: WedgeCorrection | undefined, smoothing: number) {
    const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
    const merged = extractMergedGeometry(group);
    expect(merged).not.toBeNull();

    const raw = merged!.geometry;
    const ud = raw.userData as { topVertexCount?: number };
    const topVertexCount = ud.topVertexCount ?? 0;
    const totalVerts = raw.getAttribute("position").count;
    const bottomVerts = totalVerts - topVertexCount;

    const basePos = raw.getAttribute("position")!.array as Float32Array;
    const modified = applyBaseModifiers(raw, fieldForWedge(wedge), smoothing);
    const modPos = modified.getAttribute("position")!.array as Float32Array;

    let maxBottomDrift = 0;
    for (let i = topVertexCount; i < totalVerts; i++) {
        maxBottomDrift = Math.max(maxBottomDrift, Math.abs(modPos[i * 3 + 2]! - basePos[i * 3 + 2]!));
    }

    const topSub = submeshByVertexRange(modified, 0, topVertexCount);
    const topOrdered = extractOrderedBoundaryLoopWithIndices(topSub);
    expect(topOrdered.positions.length).toBeGreaterThan(100);
    topSub.dispose();

    const closed = closeGlbInsoleToSolid(modified);
    const post = validateManifold(closed);

    modified.dispose();
    closed.dispose();
    raw.dispose();

    return { topVertexCount, totalVerts, bottomVerts, maxBottomDrift, post };
}

describe("wedge topcount diagnostic", () => {
    test("Default.glb stays manifold with medial wedge (export path smoothing=0)", async () => {
        const noWedge = await diagnose(undefined, 0);
        const withWedge = await diagnose({ side: "medial", value: 5, unit: "mm" }, 0);

        expect(noWedge.topVertexCount + noWedge.bottomVerts).toBe(noWedge.totalVerts);
        expect(noWedge.maxBottomDrift).toBeLessThan(0.05);
        expect(noWedge.post.openEdges).toBe(0);
        expect(noWedge.post.nonManifoldEdges).toBe(0);
        expect(noWedge.post.eulerCharacteristic).toBe(3);

        expect(withWedge.topVertexCount + withWedge.bottomVerts).toBe(withWedge.totalVerts);
        expect(withWedge.maxBottomDrift).toBeLessThan(0.05);
        expect(withWedge.post.openEdges).toBe(0);
        expect(withWedge.post.nonManifoldEdges).toBe(0);
        expect(withWedge.post.eulerCharacteristic).toBe(3);
    });

    test("Default.glb stays manifold with medial wedge (authoritative smoothing=2)", async () => {
        const withWedge = await diagnose({ side: "medial", value: 5, unit: "mm" }, 2);
        expect(withWedge.maxBottomDrift).toBeLessThan(0.05);
        expect(withWedge.post.openEdges).toBe(0);
        expect(withWedge.post.nonManifoldEdges).toBe(0);
        expect(withWedge.post.eulerCharacteristic).toBe(3);
    });
});
