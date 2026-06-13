// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, Shape, ShapeGeometry, Vector2, Vector3 } from "three";
import {
    bridgeNormalsPointOutward,
    closeMeshPerimeter,
    ensureWatertightForExport,
    maxBridgeMidpointDistanceFromPerimeterMm,
    maxSeamVertexNormalDiscontinuityDeg,
    SMOOTH_INWARD_LIMIT_MM,
    validateManifold,
} from "@/lib/geometry/mesh-close";

const LENGTH_MM = 260;
const WIDTH_MM = 80;

/** Non-convex foot-like closed outline (~260 mm L × ~80 mm W). */
function footOutlinePoints(samples = 64): Vector3[] {
    const ctrl: Array<[number, number]> = [
        [0, -28],
        [45, -36],
        [95, -40],
        [150, -38],
        [210, -30],
        [255, -14],
        [262, 0],
        [255, 14],
        [210, 32],
        [150, 40],
        [95, 38],
        [45, 34],
        [0, 26],
    ];
    const pts: Vector3[] = [];
    for (let i = 0; i < samples; i++) {
        const t = i / samples;
        const seg = t * ctrl.length;
        const idx = Math.floor(seg) % ctrl.length;
        const frac = seg - Math.floor(seg);
        const a = ctrl[idx]!;
        const b = ctrl[(idx + 1) % ctrl.length]!;
        const x = a[0] + (b[0] - a[0]) * frac;
        const y = a[1] + (b[1] - a[1]) * frac;
        pts.push(new Vector3(x, y, 0));
    }
    return pts;
}

function heightAtU(u: number): number {
    if (u < 0.18) return 4 + 14 * (u / 0.18);
    if (u < 0.52) return 18 - 4 * ((u - 0.18) / 0.34);
    return 14 - 10 * ((u - 0.52) / 0.48);
}

/** Single open shell (boundary along perimeter only). */
function buildOpenShell(outline: Vector3[], zFn: (x: number, y: number, u: number) => number): BufferGeometry {
    const shape = new Shape(outline.map((p) => new Vector2(p.x, p.y)));
    const geo = new ShapeGeometry(shape, 48);
    const pos = geo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const u = Math.max(0, Math.min(1, x / LENGTH_MM));
        pos.setZ(i, zFn(x, y, u));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
}

/** Merge Top + Bottom open shells the same way loaders.ts does for GLB bases. */
function mergeTopBottomShells(top: BufferGeometry, bottom: BufferGeometry): BufferGeometry {
    const topPos = top.getAttribute("position");
    const botPos = bottom.getAttribute("position");
    const total = topPos.count + botPos.count;
    const positions = new Float32Array(total * 3);
    positions.set(topPos.array as Float32Array, 0);
    positions.set(botPos.array as Float32Array, topPos.count * 3);

    const topIdx = top.index ? Array.from(top.index.array) : Array.from({ length: topPos.count }, (_, i) => i);
    const botIdx = bottom.index
        ? Array.from(bottom.index.array).map((i) => i + topPos.count)
        : Array.from({ length: botPos.count }, (_, i) => i + topPos.count);

    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(positions, 3));
    out.setIndex([...topIdx, ...botIdx]);
    out.userData = { isMultiMeshBase: true, sourceMeshNames: ["Top", "Bottom"] };
    return out;
}

function buildRealisticOrthoticPair(): BufferGeometry {
    const outline = footOutlinePoints(64);
    const bottom = buildOpenShell(outline, () => 0);
    const top = buildOpenShell(outline, (x, _y, u) => heightAtU(u) + 3);
    return mergeTopBottomShells(top, bottom);
}

describe("mesh-close — realistic orthotic integration", () => {
    test("ensureWatertightForExport closes foot-shaped open shells", () => {
        const raw = buildRealisticOrthoticPair();
        const pre = validateManifold(raw);
        expect(pre.openEdges).toBeGreaterThan(0);

        const closed = ensureWatertightForExport(raw);
        const report = validateManifold(closed);
        expect(report.isWatertight).toBe(true);
        expect(report.openEdges).toBe(0);
        expect(report.eulerCharacteristic).toBe(2);

        raw.dispose();
        closed.dispose();
    });

    test("seam quality: clinical guard, outward normals, smooth shading proxy", () => {
        const raw = buildRealisticOrthoticPair();
        const result = closeMeshPerimeter(raw);
        const geo = result.geometry;

        const topLoop = result.topLoop;
        const bottomLoop = result.bottomLoop;

        const inward = maxBridgeMidpointDistanceFromPerimeterMm(geo, topLoop, bottomLoop);
        expect(inward).toBeLessThanOrEqual(SMOOTH_INWARD_LIMIT_MM + 0.5);

        expect(bridgeNormalsPointOutward(geo, topLoop, bottomLoop)).toBe(true);

        const maxDisc = maxSeamVertexNormalDiscontinuityDeg(geo, result.seamTopIndices);
        expect(maxDisc).toBeLessThan(15);

        raw.dispose();
        geo.dispose();
    });
});
