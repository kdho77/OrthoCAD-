// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Kendon's approved sacrificial leader (2026-10-23), ported from add_leader_block.py.
 *
 * Frame is the raw OrthoCAD scan, before belt270: length along X, bottom at Z = 0.
 * The max-X end is the toe. A bridge embeds 1 mm into the toe and a 10 mm tall
 * trapezoid sits in front of it. manifold-3d unions them into one watertight body.
 */

import { loadManifoldApi, manifoldToMesh } from "@/lib/hardness/manifold-runtime";

/** Bridge width, nominal thickness, gap length, embed into the insole (mm). */
const BR_W = 10;
const BR_T = 2;
const BR_L = 2.5;
const EMBED = 1;
/** Block depth, height, width at the insole, width at the front face (mm). */
const BK_D = 20;
const BK_H = 10;
const BK_NEAR = 10;
const BK_FAR = 20;
/** Bridge overlap into the block (mm). */
const BR_INTO_BLOCK = 1;

export interface BeltExportStlOptions {
    /**
     * Print/Export "Add leader block". Default on.
     * `false` returns the viewer STL unchanged.
     */
    addLeaderBlock?: boolean;
}

interface Vec3 {
    x: number;
    y: number;
    z: number;
}

interface Bounds {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

interface IndexedMesh {
    positions: Float32Array;
    indices: Uint32Array;
}

interface LeaderManifold {
    add(other: LeaderManifold): LeaderManifold;
    translate(v: readonly [number, number, number]): LeaderManifold;
    getMesh(): { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number };
    status(): string;
    decompose(): LeaderManifold[];
    delete(): void;
}

interface LeaderManifoldApi {
    Manifold: {
        new (mesh: unknown): LeaderManifold;
        cube(size: readonly [number, number, number], center?: boolean): LeaderManifold;
        extrude(polygons: Array<Array<[number, number]>>, height: number): LeaderManifold;
    };
    Mesh: new (params: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }) => unknown;
}

/** Viewer STL for a belt G-code upload. Leader on unless the toggle is off. */
export async function stlForBeltGcodeExport(
    viewerStl: ArrayBuffer,
    options: BeltExportStlOptions = {},
): Promise<ArrayBuffer> {
    if (options.addLeaderBlock === false) return viewerStl;
    return appendLeaderBlock(viewerStl);
}

/** Translate to Z = 0, union the approved bridge and trapezoid, require one watertight body. */
export async function appendLeaderBlock(viewerStl: ArrayBuffer): Promise<ArrayBuffer> {
    const tris = readBinaryStl(viewerStl);
    if (tris.length === 0) return viewerStl;
    const shifted = translateMinZToZero(indexTriangles(tris));
    assertToeIsMaxX(shifted);
    const placed = placeLeader(shifted);
    const api = (await loadManifoldApi()) as unknown as LeaderManifoldApi;
    const insole = new api.Manifold(
        new api.Mesh({ numProp: 3, vertProperties: shifted.positions, triVerts: shifted.indices }),
    );
    const bridge = api.Manifold.cube([placed.bridgeDx, BR_W, placed.thickness], true).translate([
        placed.bridgeCx,
        placed.yc,
        placed.thickness / 2,
    ]);
    const block = api.Manifold.extrude([placed.trapezoid], BK_H);
    const union = insole.add(bridge).add(block);
    const parts = union.decompose();
    try {
        const status = union.status();
        if (status !== "NoError" || parts.length !== 1) {
            throw new Error(
                `leader union is not one watertight body (status ${status}, bodies ${parts.length})`,
            );
        }
        return writeBinaryStl(trianglesFromMesh(manifoldToMesh(union)));
    } finally {
        for (const part of parts) part.delete();
        union.delete();
        block.delete();
        bridge.delete();
        insole.delete();
    }
}

function placeLeader(mesh: IndexedMesh): {
    yc: number;
    bridgeDx: number;
    bridgeCx: number;
    thickness: number;
    trapezoid: Array<[number, number]>;
} {
    const { positions } = mesh;
    let xmax = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        if (x > xmax) xmax = x;
    }
    let yMin = Infinity;
    let yMax = -Infinity;
    let toeSamples = 0;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        const y = positions[i + 1] ?? 0;
        const z = positions[i + 2] ?? 0;
        if (x > xmax - 10 && z < 1) {
            toeSamples += 1;
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
        }
    }
    if (toeSamples === 0) throw new Error("no bottom vertices within 10 mm of the toe tip");
    const yc = (yMin + yMax) / 2;
    const x0 = xmax;
    const xEdge = Math.min(edgeX(positions, yc - BR_W / 2), edgeX(positions, yc + BR_W / 2));
    let toeH = -Infinity;
    let near = 0;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        const y = positions[i + 1] ?? 0;
        const z = positions[i + 2] ?? 0;
        if (Math.abs(x - xEdge) < 1.5 && Math.abs(y - yc) < BR_W / 2) {
            near += 1;
            if (z > toeH) toeH = z;
        }
    }
    if (near === 0) throw new Error("no vertices at the toe edge for bridge thickness");
    const thickness = toeH < BR_T ? toeH - 0.2 : BR_T;
    if (!(thickness > 0)) throw new Error(`bridge thickness ${thickness} mm is not positive`);
    const xn = x0 + BR_L;
    const xf = x0 + BR_L + BK_D;
    const b0 = xEdge - EMBED;
    const b1 = xn + BR_INTO_BLOCK;
    return {
        yc,
        bridgeDx: b1 - b0,
        bridgeCx: (b0 + b1) / 2,
        thickness,
        trapezoid: [
            [xn, yc - BK_NEAR / 2],
            [xf, yc - BK_FAR / 2],
            [xf, yc + BK_FAR / 2],
            [xn, yc + BK_NEAR / 2],
        ],
    };
}

function edgeX(positions: Float32Array, y: number): number {
    let maxX = -Infinity;
    let n = 0;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        const vy = positions[i + 1] ?? 0;
        const z = positions[i + 2] ?? 0;
        if (z < 1 && Math.abs(vy - y) < 0.5) {
            n += 1;
            if (x > maxX) maxX = x;
        }
    }
    if (n === 0) throw new Error(`no bottom outline verts at y=${y.toFixed(2)}`);
    return maxX;
}

function assertToeIsMaxX(mesh: IndexedMesh): void {
    const { positions } = mesh;
    let xmin = Infinity;
    let xmax = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
    }
    let hHi = -Infinity;
    let hLo = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        const z = positions[i + 2] ?? 0;
        if (x > xmax - 30 && z > hHi) hHi = z;
        if (x < xmin + 30 && z > hLo) hLo = z;
    }
    if (hHi >= hLo) {
        throw new Error("max-X end is not the thinner (toe) end; orientation not as expected");
    }
}

function translateMinZToZero(mesh: IndexedMesh): IndexedMesh {
    let zmin = Infinity;
    for (let i = 2; i < mesh.positions.length; i += 3) {
        const z = mesh.positions[i] ?? 0;
        if (z < zmin) zmin = z;
    }
    const positions = new Float32Array(mesh.positions);
    if (zmin !== 0) {
        for (let i = 2; i < positions.length; i += 3) positions[i] = (positions[i] ?? 0) - zmin;
    }
    return { positions, indices: mesh.indices };
}

function indexTriangles(tris: Vec3[][]): IndexedMesh {
    const keyTo = new Map<string, number>();
    const positions: number[] = [];
    const indices: number[] = [];
    const add = (v: Vec3): number => {
        const key = `${v.x},${v.y},${v.z}`;
        const existing = keyTo.get(key);
        if (existing !== undefined) return existing;
        const i = positions.length / 3;
        keyTo.set(key, i);
        positions.push(v.x, v.y, v.z);
        return i;
    };
    for (const tri of tris) {
        indices.push(
            add(tri[0] ?? { x: 0, y: 0, z: 0 }),
            add(tri[1] ?? { x: 0, y: 0, z: 0 }),
            add(tri[2] ?? { x: 0, y: 0, z: 0 }),
        );
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function trianglesFromMesh(mesh: { positions: Float32Array; indices: Uint32Array }): Vec3[][] {
    const tris: Vec3[][] = [];
    const { positions, indices } = mesh;
    for (let t = 0; t < indices.length; t += 3) {
        const tri: Vec3[] = [];
        for (let k = 0; k < 3; k++) {
            const i = indices[t + k] ?? 0;
            tri.push({
                x: positions[i * 3] ?? 0,
                y: positions[i * 3 + 1] ?? 0,
                z: positions[i * 3 + 2] ?? 0,
            });
        }
        tris.push(tri);
    }
    return tris;
}

export function readBinaryStl(buffer: ArrayBuffer): Vec3[][] {
    const view = new DataView(buffer);
    if (view.byteLength < 84) return [];
    const n = view.getUint32(80, true);
    const tris: Vec3[][] = [];
    for (let i = 0; i < n; i++) {
        const base = 84 + i * 50 + 12;
        if (base + 36 > view.byteLength) break;
        const tri: Vec3[] = [];
        for (let k = 0; k < 3; k++) {
            const o = base + k * 12;
            tri.push({
                x: view.getFloat32(o, true),
                y: view.getFloat32(o + 4, true),
                z: view.getFloat32(o + 8, true),
            });
        }
        tris.push(tri);
    }
    return tris;
}

export function writeBinaryStl(tris: Vec3[][]): ArrayBuffer {
    const buffer = new ArrayBuffer(84 + tris.length * 50);
    const view = new DataView(buffer);
    const header = "orthocad belt leader";
    for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
    view.setUint32(80, tris.length, true);
    for (let i = 0; i < tris.length; i++) {
        const tri = tris[i] ?? [];
        const base = 84 + i * 50;
        view.setFloat32(base, 0, true);
        view.setFloat32(base + 4, 0, true);
        view.setFloat32(base + 8, 0, true);
        for (let k = 0; k < 3; k++) {
            const v = tri[k] ?? { x: 0, y: 0, z: 0 };
            const o = base + 12 + k * 12;
            view.setFloat32(o, v.x, true);
            view.setFloat32(o + 4, v.y, true);
            view.setFloat32(o + 8, v.z, true);
        }
    }
    return buffer;
}

export function stlBounds(tris: Vec3[][]): Bounds {
    const b: Bounds = {
        minX: Infinity,
        minY: Infinity,
        minZ: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
        maxZ: -Infinity,
    };
    for (const tri of tris) {
        for (const v of tri) {
            if (v.x < b.minX) b.minX = v.x;
            if (v.y < b.minY) b.minY = v.y;
            if (v.z < b.minZ) b.minZ = v.z;
            if (v.x > b.maxX) b.maxX = v.x;
            if (v.y > b.maxY) b.maxY = v.y;
            if (v.z > b.maxZ) b.maxZ = v.z;
        }
    }
    return b;
}
