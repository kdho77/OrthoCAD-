// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    closeGlbInsoleToSolid,
    extractBoundaryLoops,
    extractOrderedBoundaryLoopWithIndices,
    submeshByVertexRange,
} from "@/lib/geometry/mesh-close";
import {
    extractMergedGeometry,
    loadGlbFromBuffer,
    mirrorGeometry,
    reorientToFootprintFrame,
} from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const DEFAULT_GLB_CACHE = "/tmp/Default.glb";
const DEFAULT_GLB_URL =
    "https://wstneucimlemaokoyjwh.supabase.co/storage/v1/object/public/stock-bases/Templates/Default.glb";

function defaultCorrections(archHeightMm = 0): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

async function loadDefaultGlbBuffer(): Promise<ArrayBuffer> {
    if (!existsSync(DEFAULT_GLB_CACHE)) {
        const res = await fetch(DEFAULT_GLB_URL);
        if (!res.ok) throw new Error(`Failed to download Default.glb (${res.status})`);
        writeFileSync(DEFAULT_GLB_CACHE, Buffer.from(await res.arrayBuffer()));
    }
    return readFileSync(DEFAULT_GLB_CACHE).buffer.slice(0);
}

async function loadStockGeometry(mirrored: boolean) {
    const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
    const merged = extractMergedGeometry(group);
    const reoriented = reorientToFootprintFrame(merged!.geometry);
    return mirrored ? mirrorGeometry(reoriented) : reoriented;
}

function exportField(side: "left" | "right", archHeightMm: number): HeightFieldParams {
    return {
        side,
        lengthMm: 260,
        widthMm: 90,
        thicknessMm: 25,
        corrections: defaultCorrections(archHeightMm),
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

describe("Default.glb mirrored export closure", () => {
    test("mirrored right arch smoothing=0 closes solid with correction", async () => {
        const raw = await loadStockGeometry(true);
        const modified = applyBaseModifiers(raw, exportField("right", 5), 0);
        const topVc = (raw.userData as { topVertexCount: number }).topVertexCount;
        const topSub = submeshByVertexRange(modified, 0, topVc);
        expect(extractOrderedBoundaryLoopWithIndices(topSub).positions.length).toBeGreaterThan(100);

        const closed = closeGlbInsoleToSolid(modified);
        expect(extractBoundaryLoops(closed).length).toBe(0);

        topSub.dispose();
        closed.dispose();
        modified.dispose();
        raw.dispose();
    });

    test("mirrored right no correction smoothing=2 closes solid", async () => {
        const raw = await loadStockGeometry(true);
        const modified = applyBaseModifiers(raw, exportField("right", 0), 2);
        const closed = closeGlbInsoleToSolid(modified);
        expect(extractBoundaryLoops(closed).length).toBe(0);
        closed.dispose();
        modified.dispose();
        raw.dispose();
    });
});
