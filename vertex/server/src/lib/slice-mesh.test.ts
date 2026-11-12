// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { publicProductionError } from "./cad-operator-production.js";
import {
    prepareManufacturingMeshForSlice,
    SLICE_MESH_SIMPLIFY_ABOVE,
    SLICE_MESH_TARGET_TRIANGLES,
    sliceMeshStats,
    UnsliceableMeshError,
} from "./slice-mesh.js";

function writeStl(tris: number[][], header = "test"): Uint8Array {
    const out = new Uint8Array(84 + tris.length * 50);
    new TextEncoder().encodeInto(header, out);
    const view = new DataView(out.buffer);
    view.setUint32(80, tris.length, true);
    let offset = 84;
    const put = (x: number, y: number, z: number) => {
        view.setFloat32(offset, x, true);
        offset += 4;
        view.setFloat32(offset, y, true);
        offset += 4;
        view.setFloat32(offset, z, true);
        offset += 4;
    };
    for (const t of tris) {
        put(0, 0, 0);
        put(t[0]!, t[1]!, t[2]!);
        put(t[3]!, t[4]!, t[5]!);
        put(t[6]!, t[7]!, t[8]!);
        offset += 2;
    }
    return out;
}

function boxTriangles(): number[][] {
    const v = [
        [0, 0, 0],
        [20, 0, 0],
        [20, 10, 0],
        [0, 10, 0],
        [0, 0, 8],
        [20, 0, 8],
        [20, 10, 8],
        [0, 10, 8],
    ];
    const faces = [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
    ];
    return faces.map(([a, b, c]) => {
        const pa = v[a]!;
        const pb = v[b]!;
        const pc = v[c]!;
        return [pa[0]!, pa[1]!, pa[2]!, pb[0]!, pb[1]!, pb[2]!, pc[0]!, pc[1]!, pc[2]!];
    });
}

/** Closed box. Every face is an n×n quad grid so the shell is watertight and flat. */
function subdividedBox(n: number): Uint8Array {
    const size = [80, 40, 20];
    const otherAxes = (fixed: number): [number, number] =>
        fixed === 0 ? [1, 2] : fixed === 1 ? [0, 2] : [0, 1];
    const key = (p: number[]) => p.map((v) => v.toFixed(5)).join(",");
    const index = new Map<string, number>();
    const coords: number[] = [];
    const idOf = (p: number[]): number => {
        const k = key(p);
        const hit = index.get(k);
        if (hit != null) return hit;
        const id = coords.length / 3;
        coords.push(p[0]!, p[1]!, p[2]!);
        index.set(k, id);
        return id;
    };
    const tris: number[] = [];
    const pushFace = (fixedAxis: number, fixed: number) => {
        const [u, v] = otherAxes(fixedAxis);
        const du = size[u]! / n;
        const dv = size[v]! / n;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const p = [0, 0, 0];
                const quad = [0, 1, 2, 3].map((corner) => {
                    const ii = i + (corner === 1 || corner === 2 ? 1 : 0);
                    const jj = j + (corner >= 2 ? 1 : 0);
                    const q = p.slice();
                    q[fixedAxis] = fixed;
                    q[u] = ii * du;
                    q[v] = jj * dv;
                    return idOf(q);
                });
                const outward = fixed === 0 ? [quad[0]!, quad[2]!, quad[1]!] : [quad[0]!, quad[1]!, quad[2]!];
                const outwardB =
                    fixed === 0 ? [quad[0]!, quad[3]!, quad[2]!] : [quad[0]!, quad[2]!, quad[3]!];
                tris.push(...outward, ...outwardB);
            }
        }
    };
    for (let axis = 0; axis < 3; axis++) {
        pushFace(axis, 0);
        pushFace(axis, size[axis]!);
    }
    const raw: number[][] = [];
    for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t]! * 3;
        const b = tris[t + 1]! * 3;
        const c = tris[t + 2]! * 3;
        raw.push([
            coords[a]!,
            coords[a + 1]!,
            coords[a + 2]!,
            coords[b]!,
            coords[b + 1]!,
            coords[b + 2]!,
            coords[c]!,
            coords[c + 1]!,
            coords[c + 2]!,
        ]);
    }
    return writeStl(raw, "OrthoCAD single-foot left");
}

/** Closed 24-triangle leader past the toe. Each face is a 4-triangle fan so shared edges match. */
function leaderBlock(x0: number): number[][] {
    const y0 = -5;
    const y1 = 5;
    const z1 = 10;
    const x1 = x0 + 20;
    const v = [
        [x0, y0, 0],
        [x1, y0, 0],
        [x1, y1, 0],
        [x0, y1, 0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
    ];
    const faces = [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
    ];
    const tris: number[][] = [];
    for (const loop of faces) {
        const center = [0, 0, 0];
        for (const i of loop) {
            const p = v[i]!;
            center[0] += p[0]!;
            center[1] += p[1]!;
            center[2] += p[2]!;
        }
        center[0] /= loop.length;
        center[1] /= loop.length;
        center[2] /= loop.length;
        for (let i = 0; i < loop.length; i++) {
            const a = v[loop[i]!]!;
            const b = v[loop[(i + 1) % loop.length]!]!;
            tris.push([center[0]!, center[1]!, center[2]!, a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!]);
        }
    }
    return tris;
}

describe("pre-slice manufacturing mesh", () => {
    test("a normal closed mesh is returned as the same bytes", () => {
        const stl = writeStl(boxTriangles(), "OrthoCAD single-foot left");
        const prepared = prepareManufacturingMeshForSlice(stl);
        expect(prepared).toBe(stl);
        expect(sliceMeshStats(prepared).triangles).toBe(12);
        expect(sliceMeshStats(prepared).manifold?.isWatertight).toBe(true);
    });

    test("a non-STL payload is left unchanged", () => {
        const junk = new Uint8Array([1, 2, 3, 4]);
        expect(prepareManufacturingMeshForSlice(junk)).toBe(junk);
    });

    test("coordinates far outside the plate fail before a slice", () => {
        const tris = boxTriangles();
        tris[0]![0] = 50_000;
        expect(() => prepareManufacturingMeshForSlice(writeStl(tris))).toThrow(UnsliceableMeshError);
        expect(() => prepareManufacturingMeshForSlice(writeStl(tris))).toThrow(/outside the belt plate/);
    });

    test("a non-finite coordinate fails before a slice", () => {
        const tris = boxTriangles();
        tris[0]![2] = Number.NaN;
        expect(() => prepareManufacturingMeshForSlice(writeStl(tris))).toThrow(/not finite/);
    });

    test("an oversized flat shell is simplified and stays watertight, with the leader kept", () => {
        const n = 106;
        const body = subdividedBox(n);
        const bodyTris = (body.byteLength - 84) / 50;
        expect(bodyTris).toBeGreaterThan(SLICE_MESH_SIMPLIFY_ABOVE);
        const leader = leaderBlock(100);
        expect(leader).toHaveLength(24);
        const merged = writeStl([...readTris(body), ...leader], "OrthoCAD single-foot left");
        expect(sliceMeshStats(merged).triangles).toBe(bodyTris + 24);
        expect(sliceMeshStats(merged).manifold?.isWatertight).toBe(true);
        expect(sliceMeshStats(merged).manifold?.shells).toBe(2);
        const prepared = prepareManufacturingMeshForSlice(merged);
        expect(prepared).not.toBe(merged);
        const stats = sliceMeshStats(prepared);
        expect(stats.triangles).toBeLessThanOrEqual(SLICE_MESH_TARGET_TRIANGLES);
        expect(stats.triangles).toBeLessThan(sliceMeshStats(merged).triangles);
        expect(stats.manifold?.isWatertight).toBe(true);
        expect(stats.manifold?.shells).toBe(2);
        expect(stats.bbox?.maxX).toBeGreaterThan(100);
        expect(stats.bbox?.maxZ).toBeGreaterThan(12);
        const header = new TextDecoder().decode(prepared.subarray(0, 40));
        expect(header.startsWith("OrthoCAD single-foot left")).toBe(true);
        expect(tailTriangles(prepared, 24)).toEqual(tailTriangles(merged, 24));
    });

    test("a mesh at the simplify cap is the same bytes", () => {
        const stl = blankStl(SLICE_MESH_SIMPLIFY_ABOVE);
        expect(prepareManufacturingMeshForSlice(stl)).toBe(stl);
    });

    test("an oversized mesh that cannot be repaired fails before a slice", () => {
        const stl = blankStl(SLICE_MESH_SIMPLIFY_ABOVE + 1);
        expect(() => prepareManufacturingMeshForSlice(stl)).toThrow(UnsliceableMeshError);
        expect(() => prepareManufacturingMeshForSlice(stl)).toThrow(/not sliceable/);
    });

    test("an unsliceable mesh stays visible on the production row", () => {
        const message = publicProductionError(
            new UnsliceableMeshError(
                "Manufacturing mesh is not sliceable: bounding box is outside the belt plate",
            ),
        );
        expect(message).toBe("Manufacturing mesh is not sliceable: bounding box is outside the belt plate");
    });
});

function blankStl(triangles: number): Uint8Array {
    const out = new Uint8Array(84 + triangles * 50);
    new DataView(out.buffer).setUint32(80, triangles, true);
    return out;
}

function tailTriangles(stl: Uint8Array, count: number): number[] {
    const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    const n = view.getUint32(80, true);
    const start = 84 + (n - count) * 50;
    const xyz: number[] = [];
    for (let t = 0; t < count; t++) {
        let offset = start + t * 50 + 12;
        for (let k = 0; k < 9; k++) {
            xyz.push(view.getFloat32(offset, true));
            offset += 4;
        }
    }
    return xyz;
}

function readTris(stl: Uint8Array): number[][] {
    const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    const n = view.getUint32(80, true);
    const tris: number[][] = [];
    let offset = 84;
    for (let t = 0; t < n; t++) {
        offset += 12;
        const tri: number[] = [];
        for (let k = 0; k < 9; k++) {
            tri.push(view.getFloat32(offset, true));
            offset += 4;
        }
        offset += 2;
        tris.push(tri);
    }
    return tris;
}
