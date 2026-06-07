// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { clipGeometryToOutline, extractMeshOutline, type TrimlineCurve } from "./trimline";

/**
 * Synthetic insole-like slab: flat bottom at z = 0, flat top at z = thick, an
 * elliptical footprint (length along X, width along Y) so the silhouette has a
 * clear medial / lateral boundary the outline extractor should trace.
 */
function makeEllipticalBase(opts?: {
    lengthMm?: number;
    widthMm?: number;
    thickMm?: number;
    cx?: number;
}): BufferGeometry {
    const lengthMm = opts?.lengthMm ?? 260;
    const widthMm = opts?.widthMm ?? 90;
    const thickMm = opts?.thickMm ?? 20;
    const cx = opts?.cx ?? 0; // footprint centre offset along X (origin need not be heel)
    const nx = 60;
    const ny = 24;
    const positions: number[] = [];

    for (let i = 0; i <= nx; i++) {
        const u = i / nx; // 0..1 along length
        const x = cx - lengthMm / 2 + u * lengthMm;
        // Elliptical half-width: 0 at the tips, max in the middle.
        const hw = (widthMm / 2) * Math.sin(Math.PI * u);
        for (let j = 0; j <= ny; j++) {
            const v = (j / ny) * 2 - 1;
            const y = v * hw;
            for (const z of [0, thickMm]) positions.push(x, y, z);
        }
    }

    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    g.computeBoundingBox();
    return g;
}

describe("extractMeshOutline", () => {
    test("returns null for degenerate geometry", () => {
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0]), 3));
        expect(extractMeshOutline(g)).toBeNull();
    });

    test("traces the base silhouette in the mesh's own frame", () => {
        const lengthMm = 260;
        const widthMm = 90;
        const cx = 40; // deliberately off-centre origin
        const g = makeEllipticalBase({ lengthMm, widthMm, cx });
        const outline = extractMeshOutline(g);
        expect(outline).not.toBeNull();
        const pts = outline!.points;
        expect(pts.length).toBeGreaterThanOrEqual(8);

        // Outline must live in the mesh's raw coordinate frame (so it lines up
        // with how the base is rendered), i.e. centred on the same X centre.
        let minX = Infinity;
        let maxX = -Infinity;
        let maxAbsY = 0;
        for (const p of pts) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            maxAbsY = Math.max(maxAbsY, Math.abs(p.y));
        }
        expect(minX).toBeGreaterThanOrEqual(cx - lengthMm / 2 - 1);
        expect(maxX).toBeLessThanOrEqual(cx + lengthMm / 2 + 1);
        // Widest cross-section should approach the true half-width near the middle.
        expect(maxAbsY).toBeGreaterThan((widthMm / 2) * 0.7);
        expect(maxAbsY).toBeLessThan(widthMm / 2 + 1);
    });

    test("handles a base whose length runs along Y", () => {
        // Build an X-length base then swap X/Y so length is along Y.
        const src = makeEllipticalBase({ lengthMm: 260, widthMm: 90 });
        const pos = src.getAttribute("position");
        const swapped = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
            swapped[i * 3] = pos.getY(i);
            swapped[i * 3 + 1] = pos.getX(i);
            swapped[i * 3 + 2] = pos.getZ(i);
        }
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(swapped, 3));
        const outline = extractMeshOutline(g);
        expect(outline).not.toBeNull();
        let extentY = 0;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of outline!.points) {
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        extentY = maxY - minY;
        // Length (the longer extent) is now along Y ⇒ outline spans ~260 in Y.
        expect(extentY).toBeGreaterThan(200);
    });
});

describe("clipGeometryToOutline", () => {
    function makeIndexedQuadGrid(): BufferGeometry {
        // 20x20mm plane in XY at z = 0, centred on origin, two triangles per cell.
        const n = 10;
        const positions: number[] = [];
        const indices: number[] = [];
        for (let i = 0; i <= n; i++) {
            for (let j = 0; j <= n; j++) {
                positions.push((i / n) * 20 - 10, (j / n) * 20 - 10, 0);
            }
        }
        const idx = (i: number, j: number) => i * (n + 1) + j;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                indices.push(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1));
                indices.push(idx(i, j), idx(i + 1, j + 1), idx(i, j + 1));
            }
        }
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
        g.setIndex(indices);
        return g;
    }

    test("drops triangles outside the outline polygon", () => {
        const g = makeIndexedQuadGrid();
        const fullTris = g.getIndex()!.count / 3;

        // Small central square outline (±4mm) ⇒ only the centre survives.
        const square: TrimlineCurve = {
            points: [
                new Vector3(-4, -4, 0),
                new Vector3(4, -4, 0),
                new Vector3(4, 4, 0),
                new Vector3(-4, 4, 0),
            ],
        };
        const clipped = clipGeometryToOutline(g, square, 0);
        const clippedTris = clipped.getAttribute("position").count / 3;
        expect(clippedTris).toBeGreaterThan(0);
        expect(clippedTris).toBeLessThan(fullTris);
    });

    test("keeps the whole surface when the outline encloses it", () => {
        const g = makeIndexedQuadGrid();
        const fullTris = g.getIndex()!.count / 3;
        const big: TrimlineCurve = {
            points: [
                new Vector3(-50, -50, 0),
                new Vector3(50, -50, 0),
                new Vector3(50, 50, 0),
                new Vector3(-50, 50, 0),
            ],
        };
        const clipped = clipGeometryToOutline(g, big, 0);
        const clippedTris = clipped.getAttribute("position").count / 3;
        expect(clippedTris).toBe(fullTris);
    });
});
