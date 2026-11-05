// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Sacrificial belt-printer leader, applied to the manufacturing STL before VertexSlice.
 *
 * Founder dimensions (do not freestyle):
 * - bridge 10 wide × 2 thick × 2.5 long, embedded 1 mm into the insole
 * - trapezoid block 20 deep × 10 high, width 10 → 20, on Z = 0
 * - centered on the toe mid-width
 * - toe = the thinner max-X end in the OrthoCAD frame; abort if that end is not thinner
 *
 * CAD review is required before this geometry is treated as approved.
 */

export const LEADER_BRIDGE_WIDTH_MM = 10;
export const LEADER_BRIDGE_THICKNESS_MM = 2;
export const LEADER_BRIDGE_LENGTH_MM = 2.5;
export const LEADER_BRIDGE_EMBED_MM = 1;
export const LEADER_BLOCK_DEPTH_MM = 20;
export const LEADER_BLOCK_HEIGHT_MM = 10;
export const LEADER_BLOCK_WIDTH_INNER_MM = 10;
export const LEADER_BLOCK_WIDTH_OUTER_MM = 20;

export type MeshExportKind = "gcode" | "stl" | "3mf" | "glb" | "cnc";

export class LeaderBlockOrientationError extends Error {
    constructor(message = "Leader block aborted: the max-X end is not the thinner toe.") {
        super(message);
        this.name = "LeaderBlockOrientationError";
    }
}

interface Tri {
    ax: number;
    ay: number;
    az: number;
    bx: number;
    by: number;
    bz: number;
    cx: number;
    cy: number;
    cz: number;
}

interface XBand {
    zSpan: number;
    minY: number;
    maxY: number;
    count: number;
}

/** G-code manufacturing STLs include the leader. Mesh-only and CNC exports do not. */
export function manufacturingStlIncludesLeaderBlock(
    kind: MeshExportKind,
    includeLeaderBlock = true,
): boolean {
    return kind === "gcode" && includeLeaderBlock;
}

export function manufacturingStlForExportKind(
    raw: ArrayBuffer,
    kind: MeshExportKind,
    includeLeaderBlock = true,
): ArrayBuffer {
    if (!manufacturingStlIncludesLeaderBlock(kind, includeLeaderBlock)) return raw;
    return applySacrificialLeaderBlock(raw);
}

export function applySacrificialLeaderBlock(stl: ArrayBuffer): ArrayBuffer {
    const tris = readBinaryStl(stl);
    const leader = leaderTrianglesForMesh(tris);
    return writeBinaryStl(tris.concat(leader));
}

export function translateBinaryStlY(stl: ArrayBuffer, dy: number): ArrayBuffer {
    if (dy === 0) return stl;
    const tris = readBinaryStl(stl).map((t) => ({
        ...t,
        ay: t.ay + dy,
        by: t.by + dy,
        cy: t.cy + dy,
    }));
    return writeBinaryStl(tris);
}

export function concatenateBinaryStls(parts: ArrayBuffer[]): ArrayBuffer {
    if (parts.length === 0) throw new Error("No STL parts to concatenate");
    const only = parts[0];
    if (parts.length === 1 && only) return only;
    const tris: Tri[] = [];
    for (const part of parts) tris.push(...readBinaryStl(part));
    return writeBinaryStl(tris);
}

export function binaryStlTriangleCount(stl: ArrayBuffer): number {
    if (stl.byteLength < 84) return 0;
    return new DataView(stl).getUint32(80, true);
}

export function binaryStlBounds(stl: ArrayBuffer): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
} {
    const tris = readBinaryStl(stl);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const t of tris) {
        for (const [x, y, z] of [
            [t.ax, t.ay, t.az],
            [t.bx, t.by, t.bz],
            [t.cx, t.cy, t.cz],
        ] as const) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        }
    }
    return { minX, maxX, minY, maxY, minZ, maxZ };
}

function leaderTrianglesForMesh(tris: Tri[]): Tri[] {
    const bounds = boundsOf(tris);
    const length = bounds.maxX - bounds.minX;
    if (!Number.isFinite(length) || length < 1 || tris.length === 0) {
        throw new LeaderBlockOrientationError(
            "Leader block aborted: manufacturing STL has no usable extent.",
        );
    }
    const band = Math.min(12, Math.max(2, length * 0.12));
    const toe = bandStats(tris, (x) => x >= bounds.maxX - band);
    const heel = bandStats(tris, (x) => x <= bounds.minX + band);
    if (toe.count < 3 || heel.count < 3) {
        throw new LeaderBlockOrientationError(
            "Leader block aborted: could not measure toe and heel thickness.",
        );
    }
    if (!(toe.zSpan < heel.zSpan)) {
        throw new LeaderBlockOrientationError();
    }

    const yCenter = (toe.minY + toe.maxY) / 2;
    const bridgeX0 = bounds.maxX - LEADER_BRIDGE_EMBED_MM;
    const bridgeX1 = bridgeX0 + LEADER_BRIDGE_LENGTH_MM;
    const bridge = boxTriangles(
        bridgeX0,
        yCenter - LEADER_BRIDGE_WIDTH_MM / 2,
        0,
        bridgeX1,
        yCenter + LEADER_BRIDGE_WIDTH_MM / 2,
        LEADER_BRIDGE_THICKNESS_MM,
    );
    const block = trapezoidTriangles(
        bridgeX1,
        bridgeX1 + LEADER_BLOCK_DEPTH_MM,
        yCenter,
        LEADER_BLOCK_WIDTH_INNER_MM,
        LEADER_BLOCK_WIDTH_OUTER_MM,
        LEADER_BLOCK_HEIGHT_MM,
    );
    return bridge.concat(block);
}

function bandStats(tris: Tri[], inBand: (x: number) => boolean): XBand {
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let count = 0;
    for (const t of tris) {
        for (const [x, y, z] of [
            [t.ax, t.ay, t.az],
            [t.bx, t.by, t.bz],
            [t.cx, t.cy, t.cz],
        ] as const) {
            if (!inBand(x)) continue;
            count += 1;
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        }
    }
    return { zSpan: count ? maxZ - minZ : 0, minY, maxY, count };
}

function boundsOf(tris: Tri[]): { minX: number; maxX: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const t of tris) {
        minX = Math.min(minX, t.ax, t.bx, t.cx);
        maxX = Math.max(maxX, t.ax, t.bx, t.cx);
    }
    return { minX, maxX };
}

function boxTriangles(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Tri[] {
    const v = [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
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
    return faces.map(([a, b, c]) => tri(corner(v, a), corner(v, b), corner(v, c)));
}

function trapezoidTriangles(
    x0: number,
    x1: number,
    yCenter: number,
    width0: number,
    width1: number,
    height: number,
): Tri[] {
    const y0a = yCenter - width0 / 2;
    const y0b = yCenter + width0 / 2;
    const y1a = yCenter - width1 / 2;
    const y1b = yCenter + width1 / 2;
    const v = [
        [x0, y0a, 0],
        [x1, y1a, 0],
        [x1, y1b, 0],
        [x0, y0b, 0],
        [x0, y0a, height],
        [x1, y1a, height],
        [x1, y1b, height],
        [x0, y0b, height],
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
    return faces.map(([a, b, c]) => tri(corner(v, a), corner(v, b), corner(v, c)));
}

function corner(v: number[][], index: number | undefined): [number, number, number] {
    const row = index === undefined ? undefined : v[index];
    const x = row?.[0];
    const y = row?.[1];
    const z = row?.[2];
    if (x === undefined || y === undefined || z === undefined) {
        throw new Error("leader vertex is incomplete");
    }
    return [x, y, z];
}

function tri(a: [number, number, number], b: [number, number, number], c: [number, number, number]): Tri {
    return {
        ax: a[0],
        ay: a[1],
        az: a[2],
        bx: b[0],
        by: b[1],
        bz: b[2],
        cx: c[0],
        cy: c[1],
        cz: c[2],
    };
}

function readBinaryStl(buffer: ArrayBuffer): Tri[] {
    if (buffer.byteLength < 84) throw new Error("STL too short");
    const view = new DataView(buffer);
    const triCount = view.getUint32(80, true);
    const expected = 84 + triCount * 50;
    if (view.byteLength < expected)
        throw new Error(`binary STL truncated: ${view.byteLength} < ${expected} bytes`);
    const tris: Tri[] = [];
    for (let t = 0; t < triCount; t++) {
        const offset = 84 + t * 50 + 12;
        tris.push({
            ax: view.getFloat32(offset, true),
            ay: view.getFloat32(offset + 4, true),
            az: view.getFloat32(offset + 8, true),
            bx: view.getFloat32(offset + 12, true),
            by: view.getFloat32(offset + 16, true),
            bz: view.getFloat32(offset + 20, true),
            cx: view.getFloat32(offset + 24, true),
            cy: view.getFloat32(offset + 28, true),
            cz: view.getFloat32(offset + 32, true),
        });
    }
    return tris;
}

function writeBinaryStl(tris: Tri[]): ArrayBuffer {
    const buffer = new ArrayBuffer(84 + tris.length * 50);
    const view = new DataView(buffer);
    view.setUint32(80, tris.length, true);
    let offset = 84;
    for (const t of tris) {
        const n = normalOf(t);
        view.setFloat32(offset, n[0], true);
        view.setFloat32(offset + 4, n[1], true);
        view.setFloat32(offset + 8, n[2], true);
        offset += 12;
        for (const [x, y, z] of [
            [t.ax, t.ay, t.az],
            [t.bx, t.by, t.bz],
            [t.cx, t.cy, t.cz],
        ] as const) {
            view.setFloat32(offset, x, true);
            view.setFloat32(offset + 4, y, true);
            view.setFloat32(offset + 8, z, true);
            offset += 12;
        }
        view.setUint16(offset, 0, true);
        offset += 2;
    }
    return buffer;
}

function normalOf(t: Tri): [number, number, number] {
    const ux = t.bx - t.ax;
    const uy = t.by - t.ay;
    const uz = t.bz - t.az;
    const vx = t.cx - t.ax;
    const vy = t.cy - t.ay;
    const vz = t.cz - t.az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    return [nx, ny, nz];
}
