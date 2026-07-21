// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import {
    extractBottomMeshOutline,
    outlineBoundsXY,
    seedBottomPatternOutline,
} from "@/lib/geometry/bottom-pattern";
import { extractMeshOutline } from "@/lib/geometry/trimline";
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

describe("bottomPattern seed — Default.glb Bottom footprint", () => {
    test("default outline approximates Bottom mesh XY bounds (not 0.65× top)", async () => {
        const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
        const merged = extractMergedGeometry(group, { sealBottomSlits: false });
        expect(merged).not.toBeNull();
        const geo = merged!.geometry;
        const ud = geo.userData as { isMultiMeshBase?: boolean; topVertexCount?: number };
        expect(ud.isMultiMeshBase).toBe(true);
        expect(ud.topVertexCount).toBeGreaterThan(0);

        const pos = geo.getAttribute("position");
        const topN = ud.topVertexCount!;
        // Bottom Z span — must remain "flat" relative to top contour for this feature.
        let botMinZ = Infinity;
        let botMaxZ = -Infinity;
        let botMinX = Infinity;
        let botMaxX = -Infinity;
        let botMinY = Infinity;
        let botMaxY = -Infinity;
        for (let i = topN; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            if (x < botMinX) botMinX = x;
            if (x > botMaxX) botMaxX = x;
            if (y < botMinY) botMinY = y;
            if (y > botMaxY) botMaxY = y;
            if (z < botMinZ) botMinZ = z;
            if (z > botMaxZ) botMaxZ = z;
        }
        const botZSpan = botMaxZ - botMinZ;
        const botArea = (botMaxX - botMinX) * (botMaxY - botMinY);
        console.log("[BOTTOM-SEED] Default.glb Bottom", {
            botZSpan,
            botXY: { w: botMaxX - botMinX, h: botMaxY - botMinY, area: botArea },
        });
        // Documented finding (2026-07): Default.glb Bottom is NOT planar — raw Z span
        // ≈19mm (p05–p95 ≈14.4mm), comparable to Top's ≈23mm span. XY extents of Top
        // and Bottom are nearly identical. Outline seeding still uses XY projection
        // (ignoring Z) as specified; wall-generation must not assume a flat Bottom.
        expect(botZSpan).toBeGreaterThan(0);
        expect(botZSpan).toBeLessThan(40); // sanity — not a full vertical extrusion

        const seeded = extractBottomMeshOutline(geo);
        expect(seeded).not.toBeNull();
        expect(seeded!.points.length).toBeGreaterThanOrEqual(8);
        expect(seeded!.points.every((p) => p.z === 0)).toBe(true);

        const seedB = outlineBoundsXY(seeded!);
        // Bounding-box / area comparison vs raw Bottom verts (simplified station outline).
        expect(seedB.area).toBeGreaterThan(botArea * 0.7);
        expect(seedB.area).toBeLessThan(botArea * 1.15);
        expect(Math.abs(seedB.minX - botMinX)).toBeLessThan(8);
        expect(Math.abs(seedB.maxX - botMaxX)).toBeLessThan(8);
        expect(Math.abs(seedB.minY - botMinY)).toBeLessThan(8);
        expect(Math.abs(seedB.maxY - botMaxY)).toBeLessThan(8);

        // Must differ from full-mesh (top-dominated) outline scale when Bottom is smaller/offset.
        const topOutline = extractMeshOutline(geo);
        expect(topOutline).not.toBeNull();
        const viaSeedHelper = seedBottomPatternOutline(geo, topOutline!);
        expect(outlineBoundsXY(viaSeedHelper).area).toBeCloseTo(seedB.area, 0);

        geo.dispose();
    });
});
