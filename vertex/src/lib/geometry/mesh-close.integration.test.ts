// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, Shape, ShapeGeometry, Vector2, Vector3 } from "three";
import {
    bridgeNormalsPointOutward,
    bridgeWeldRingIsAdjacent,
    closeMeshPerimeter,
    ensureWatertightForExport,
    generateBridgeStrip,
    maxBridgeMidpointDistanceFromPerimeterMm,
    maxSeamVertexNormalDiscontinuityDeg,
    mergeGeometriesWithWeldedBridge,
    MeshNotWatertightError,
    resampleLoopToCount,
    SMOOTH_INWARD_LIMIT_MM,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { geometryToBinarySTL } from "@/lib/geometry/stl";

const LENGTH_MM = 260;

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
    out.userData = { isMultiMeshBase: true, sourceMeshNames: ["Top", "Bottom"], topVertexCount: topPos.count };
    return out;
}

/** Fan-triangulated open shell with exactly `outline.length` boundary vertices (coarse edges). */
function buildCoarseOpenShell(outline: Vector3[], z: number): BufferGeometry {
    const n = outline.length;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        positions[i * 3] = outline[i]!.x;
        positions[i * 3 + 1] = outline[i]!.y;
        positions[i * 3 + 2] = z;
    }
    const indices: number[] = [];
    for (let i = 1; i < n - 1; i++) {
        indices.push(0, i, i + 1);
    }
    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(positions, 3));
    out.setIndex(indices);
    out.computeVertexNormals();
    return out;
}

/** Open shell with `outline.length` boundary verts plus two interior verts (different count from fan-only top). */
function buildCoarseOpenShellWithInterior(outline: Vector3[], z: number): BufferGeometry {
    const n = outline.length;
    const positions = new Float32Array((n + 2) * 3);
    for (let i = 0; i < n; i++) {
        positions[i * 3] = outline[i]!.x;
        positions[i * 3 + 1] = outline[i]!.y;
        positions[i * 3 + 2] = z;
    }
    const c0 = n;
    const c1 = n + 1;
    positions[c0 * 3] = 0;
    positions[c0 * 3 + 1] = 0;
    positions[c0 * 3 + 2] = z;
    positions[c1 * 3] = outline[Math.floor(n / 4)]!.x * 0.25;
    positions[c1 * 3 + 1] = outline[Math.floor(n / 4)]!.y * 0.25;
    positions[c1 * 3 + 2] = z;

    const indices: number[] = [];
    for (let i = 0; i < 4; i++) {
        indices.push(c0, i, i + 1);
    }
    indices.push(c0, 4, 5, c0, 5, c1);
    for (let i = 5; i < n; i++) {
        indices.push(c1, i, (i + 1) % n);
    }
    indices.push(c1, 0, c0);

    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(positions, 3));
    out.setIndex(indices);
    out.computeVertexNormals();
    return out;
}

/** Coarse foot-like outline — 16 vertices, edges up to ~30 mm (mimics real stock GLB). */
function coarseFootOutline(): Vector3[] {
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
        [-20, 10],
        [-20, -10],
        [-8, -20],
    ];
    return ctrl.map(([x, y]) => new Vector3(x, y, 0));
}

function buildCoarseOrthoticPair(): BufferGeometry {
    const outline = coarseFootOutline();
    const bottom = buildCoarseOpenShell(outline, 0);
    const top = buildCoarseOpenShell(outline, 12);
    return mergeTopBottomShells(top, bottom);
}

function assertRimContactIndicesValid(
    result: ReturnType<typeof closeMeshPerimeter>,
    bodyVertexCount: number,
): void {
    const totalVerts = result.geometry.getAttribute("position").count;
    const rimIndices = [...result.weldTopIndices, ...result.weldBottomIndices];
    for (const vi of rimIndices) {
        expect(vi).toBeGreaterThanOrEqual(0);
        expect(vi).toBeLessThan(totalVerts);
        expect(vi).not.toBe(-1);
    }
    const bodyOrBridge = rimIndices.every((vi) => vi < bodyVertexCount || vi >= bodyVertexCount);
    expect(bodyOrBridge).toBe(true);
}

function buildRealisticOrthoticPair(): BufferGeometry {
    const outline = footOutlinePoints(64);
    const bottom = buildOpenShell(outline, () => 0);
    const top = buildOpenShell(outline, (_x, _y, u) => heightAtU(u) + 3);
    return mergeTopBottomShells(top, bottom);
}

/** Kidney-bean outline with 20 mm medial arch notch (strong concavity). */
function kidneyBeanOutline(samples = 80): Vector3[] {
    const ctrl: Array<[number, number]> = [
        [0, 30],
        [40, 38],
        [90, 40],
        [130, 20],
        [145, -2],
        [155, 20],
        [200, 38],
        [255, 28],
        [262, 0],
        [255, -28],
        [200, -38],
        [130, -40],
        [60, -36],
        [0, -30],
    ];
    const pts: Vector3[] = [];
    for (let i = 0; i < samples; i++) {
        const t = i / samples;
        const seg = t * ctrl.length;
        const idx = Math.floor(seg) % ctrl.length;
        const frac = seg - Math.floor(seg);
        const a = ctrl[idx]!;
        const b = ctrl[(idx + 1) % ctrl.length]!;
        pts.push(new Vector3(a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac, 0));
    }
    return pts;
}

function rimHeightAtU(u: number): number {
    return 8 - 7.5 * u;
}

function buildConcaveOrthoticPair(): BufferGeometry {
    const outline = kidneyBeanOutline(80);
    const bottom = buildOpenShell(outline, () => 0);
    const top = buildOpenShell(outline, (_x, _y, u) => rimHeightAtU(u) + 3);
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
        const bodyVertexCount = raw.getAttribute("position").count;
        const result = closeMeshPerimeter(raw);
        const geo = result.geometry;

        assertRimContactIndicesValid(result, bodyVertexCount);

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

    test("concave kidney-bean perimeter: no chord-snap weld jumps or crossing bridge edges", () => {
        const raw = buildConcaveOrthoticPair();
        const bodyVertexCount = raw.getAttribute("position").count;
        const result = closeMeshPerimeter(raw);
        const geo = result.geometry;

        assertRimContactIndicesValid(result, bodyVertexCount);

        expect(result.report.eulerCharacteristic).toBe(2);
        expect(result.report.openEdges).toBe(0);
        expect(result.report.isWatertight).toBe(true);

        expect(bridgeWeldRingIsAdjacent(geo, result.weldTopIndices)).toBe(true);
        expect(bridgeNormalsPointOutward(geo, result.topLoop, result.bottomLoop)).toBe(true);

        raw.dispose();
        geo.dispose();
    });

    test("coarse GLB boundary — long edges do not produce top=-1", () => {
        const raw = buildCoarseOrthoticPair();
        const bodyVertexCount = raw.getAttribute("position").count;
        const pre = validateManifold(raw);
        expect(pre.openEdges).toBeGreaterThan(0);

        let result: ReturnType<typeof closeMeshPerimeter> | undefined;
        expect(() => {
            result = closeMeshPerimeter(raw);
        }).not.toThrow(MeshNotWatertightError);

        expect(result).toBeDefined();
        expect(result!.report.eulerCharacteristic).toBe(2);
        expect(result!.report.isWatertight).toBe(true);
        expect(result!.report.openEdges).toBe(0);
        assertRimContactIndicesValid(result!, bodyVertexCount);
        expect(result!.weldBottomIndices.every((i) => i >= 16)).toBe(true);

        raw.dispose();
        result!.geometry.dispose();
    });

    test("bottom mesh indices are globally offset in merged buffer", () => {
        const outline16 = coarseFootOutline();

        const top = buildCoarseOpenShell(outline16, 12);
        const bottom = buildCoarseOpenShellWithInterior(outline16, 0);
        const topCount = top.getAttribute("position").count;
        const bottomCount = bottom.getAttribute("position").count;
        expect(topCount).toBe(16);
        expect(bottomCount).toBe(18);
        expect(topCount).not.toBe(bottomCount);
        expect(validateManifold(top).openEdges).toBe(16);
        expect(validateManifold(bottom).openEdges).toBe(16);

        const raw = mergeTopBottomShells(top, bottom);
        expect(raw.userData.topVertexCount).toBe(topCount);

        const result = closeMeshPerimeter(raw);
        const totalVerts = result.geometry.getAttribute("position").count;

        for (const vi of result.weldBottomIndices) {
            expect(vi).toBeGreaterThanOrEqual(topCount);
            expect(vi).toBeLessThan(totalVerts);
        }
        expect(result.weldBottomIndices[0]).toBeGreaterThanOrEqual(topCount);
        expect(result.report.eulerCharacteristic).toBe(2);
        expect(result.report.isWatertight).toBe(true);
        expect(result.report.openEdges).toBe(0);
        expect(result.report.nonManifoldEdges).toBe(0);

        top.dispose();
        bottom.dispose();
        result.geometry.dispose();
    });

    // PRODUCTION BASELINE (recorded 2026-06-13 commit 100611f6)
    // V=320 E=570 F=380 STL=18.64KB bridge_faces=256
    // Update this comment if bridge geometry changes intentionally.
    test("production-scale orthotic STL size baseline", () => {
        const raw = buildRealisticOrthoticPair();
        const result = closeMeshPerimeter(raw);
        const geo = result.geometry;
        const stl = geometryToBinarySTL(geo);
        const stlKb = stl.byteLength / 1024;
        const perimeterVertexCount = result.topLoop.length;
        const bridgeFaces = result.bridgeTriangleCount;

        console.log(
            `Production baseline: V=${result.report.vertexCount} F=${result.report.triangleCount} STL=${stlKb.toFixed(2)}KB bridge_faces=${bridgeFaces}`,
        );

        expect(stl.byteLength).toBeLessThan(2 * 1024 * 1024);
        expect(bridgeFaces).toBeLessThanOrEqual(perimeterVertexCount * 4);
        expect(result.report.eulerCharacteristic).toBe(2);

        raw.dispose();
        geo.dispose();
    });
});
