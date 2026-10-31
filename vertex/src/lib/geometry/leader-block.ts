// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Belt leader block added to the viewer STL before a VertexSlice upload.
 *
 * VertexSlice `add_leader_block.py` is not in the public tree or the headless
 * image. This is the same keel solid the belt transform prints first:
 * toe-first placement (Z rotation 270°, the VertexSlice default) puts the
 * block in front of the insole, on a floor Z = 0.004/√2 mm above the sole.
 * Before `y_mach_offset`, the first ApexLight slice (layer 0.46 mm) is the
 * point G1 … Y0.004 Z0.651 (Z = 0.46·√2). ApexLight files often print that
 * gantry Y as Y0. The block is not applied to CNC or STL passthrough.
 */

export const TOE_FIRST_ROTATION_Z_DEG = 270;

/** ApexLight layer height whose first belt slice lands at Z ≈ 0.651 mm. */
export const APEX_LIGHT_LAYER_HEIGHT_MM = 0.46;

/** Unclamped gantry Y of the leader floor (√2 × floor Z). */
export const LEADER_START_GANTRY_Y_MM = 0.004;

/** Along-belt length, across-belt width, and thickness of the leader box (mm). */
export const LEADER_ALONG_BELT_MM = 10;
export const LEADER_ACROSS_BELT_MM = 16;
export const LEADER_HEIGHT_MM = 2;

const LEADER_TRIANGLES = 12;

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

/** Floor height that maps to gantry Y 0.004 under Y_mach = √2 × Z_model. */
export function leaderFloorZMm(): number {
    return LEADER_START_GANTRY_Y_MM / Math.SQRT2;
}

/**
 * Machine start of the leader's first slice, before `y_mach_offset`.
 * Z_mach = layerHeight / cos(45°). Y_mach = √2 × floor Z.
 */
export function predictedLeaderStart(layerHeightMm: number = APEX_LIGHT_LAYER_HEIGHT_MM): {
    y: number;
    z: number;
} {
    const floorZ = leaderFloorZMm();
    return {
        y: Math.SQRT2 * floorZ,
        z: layerHeightMm / Math.cos(Math.PI / 4),
    };
}

/** Viewer STL for a belt G-code upload. Leader on unless the toggle is off. */
export function stlForBeltGcodeExport(
    viewerStl: ArrayBuffer,
    options: BeltExportStlOptions = {},
): ArrayBuffer {
    if (options.addLeaderBlock === false) return viewerStl;
    return appendLeaderBlock(viewerStl);
}

export function appendLeaderBlock(viewerStl: ArrayBuffer): ArrayBuffer {
    const tris = readBinaryStl(viewerStl);
    if (tris.length === 0) return viewerStl;
    const leader = leaderTrianglesInViewerFrame(tris);
    return writeBinaryStl([...tris, ...leader]);
}

/** Toe-first belt rotation used by VertexSlice `prepare_orthocad_insole_stl`. */
export function rotateToeFirst(v: Vec3): Vec3 {
    return { x: v.y, y: -v.x, z: v.z };
}

function leaderTrianglesInViewerFrame(part: Vec3[][]): Vec3[][] {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const tri of part) {
        for (const v of tri) {
            const r = rotateToeFirst(v);
            if (r.x < minX) minX = r.x;
            if (r.y < minY) minY = r.y;
            if (r.z < minZ) minZ = r.z;
            if (r.x > maxX) maxX = r.x;
            if (r.y > maxY) maxY = r.y;
        }
    }
    const centerX = (minX + maxX) / 2;
    const halfW = LEADER_ACROSS_BELT_MM / 2;
    const floorZ = minZ + leaderFloorZMm();
    const box = axisBox(
        centerX - halfW,
        minY - LEADER_ALONG_BELT_MM,
        floorZ,
        centerX + halfW,
        minY,
        floorZ + LEADER_HEIGHT_MM,
    );
    return box.map((tri) => tri.map(unrotateToeFirst));
}

function unrotateToeFirst(v: Vec3): Vec3 {
    return { x: -v.y, y: v.x, z: v.z };
}

function axisBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Vec3[][] {
    const p = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
    const v = [
        p(x0, y0, z0),
        p(x1, y0, z0),
        p(x1, y1, z0),
        p(x0, y1, z0),
        p(x0, y0, z1),
        p(x1, y0, z1),
        p(x1, y1, z1),
        p(x0, y1, z1),
    ];
    const faces: Array<[number, number, number]> = [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [3, 6, 2],
        [3, 7, 6],
        [0, 4, 7],
        [0, 7, 3],
        [1, 2, 6],
        [1, 6, 5],
    ];
    return faces.map(([a, b, c]) => [v[a], v[b], v[c]]);
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
    tris.forEach((tri, i) => {
        const base = 84 + i * 50;
        view.setFloat32(base, 0, true);
        view.setFloat32(base + 4, 0, true);
        view.setFloat32(base + 8, 0, true);
        tri.forEach((v, k) => {
            const o = base + 12 + k * 12;
            view.setFloat32(o, v.x, true);
            view.setFloat32(o + 4, v.y, true);
            view.setFloat32(o + 8, v.z, true);
        });
    });
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

export function rotatedBounds(tris: Vec3[][]): Bounds {
    return stlBounds(tris.map((tri) => tri.map(rotateToeFirst)));
}

export const LEADER_TRIANGLE_COUNT = LEADER_TRIANGLES;
