// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Sacrificial belt-printer leader, applied to the manufacturing STL before VertexSlice.
 *
 * Founder-locked (Kendon 2026-11-17; replaces the 1 mm breakaway neck):
 * - bridge 15 wide × 3 thick, 1 mm scissor span past the toe tip, embedded 2 mm
 * - trapezoid block 20 deep × 10 high, width 20 → 30, on Z = 0
 * - block sits at the insole front (the 1 mm span) so the toe cannot fold under
 * - bridge overlaps the block by 2 mm; the block itself does not move
 * - curved toe: embed is measured at the bridge side edges (yc ± 7.5), not at xmax
 * - over the toe the bridge top is the local insole top, capped at 3 mm, so the
 *   joint fills the shell and does not stand up as a pad; the scissor span then
 *   rises to the full 3 mm section before the block
 * - toe = the thinner max-X end in the OrthoCAD frame; abort if that end is not thinner
 *
 * Triangles are appended. The embed intersects the insole, so the mesh is not a boolean union.
 */

export const LEADER_BRIDGE_WIDTH_MM = 15;
export const LEADER_BRIDGE_THICKNESS_MM = 3;
export const LEADER_BRIDGE_LENGTH_MM = 1;
export const LEADER_BRIDGE_EMBED_MM = 2;
/** Bridge continues this far past the block's near face so the joint is not face-touch only. */
export const LEADER_BRIDGE_BLOCK_OVERLAP_MM = 2;
/**
 * Distance past the toe tip where the clipped lip has risen to the full 3 mm section.
 * Stays inside the 1 mm scissor span, so the lap is flush on the toe and the neck
 * is 15 × 3 before it meets the block.
 */
export const LEADER_BRIDGE_RISE_MM = 0.25;
/**
 * Height-field bridge (6 X × 3 Y stations → 68 triangles) plus the 12-triangle block.
 * `splitLeader` peels this suffix; keep the two counts the same.
 */
export const LEADER_SUFFIX_TRIANGLE_COUNT = 80;
export const LEADER_BLOCK_DEPTH_MM = 20;
export const LEADER_BLOCK_HEIGHT_MM = 10;
export const LEADER_BLOCK_WIDTH_INNER_MM = 20;
export const LEADER_BLOCK_WIDTH_OUTER_MM = 30;
const BOTTOM_OUTLINE_Z_MM = 1;
const BOTTOM_OUTLINE_Y_TOL_MM = 0.5;

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
    const xEdge = curvedToeOutlineX(tris, yCenter, bounds.maxX);
    const bridgeX0 = xEdge - LEADER_BRIDGE_EMBED_MM;
    // 1 mm scissor span from the toe tip to the block. Overlap extends the bridge only.
    const toeTip = bounds.maxX;
    const blockX0 = toeTip + LEADER_BRIDGE_LENGTH_MM;
    const bridgeX1 = blockX0 + LEADER_BRIDGE_BLOCK_OVERLAP_MM;
    const half = LEADER_BRIDGE_WIDTH_MM / 2;
    const ys = [yCenter - half, yCenter, yCenter + half];
    const xs = bridgeXStations(bridgeX0, xEdge, toeTip, bridgeX1);
    const zTop = xs.map((x) => bridgeTopRow(tris, x, ys, toeTip));
    const bridge = heightFieldSlab(xs, ys, zTop);
    const block = trapezoidTriangles(
        blockX0,
        blockX0 + LEADER_BLOCK_DEPTH_MM,
        yCenter,
        LEADER_BLOCK_WIDTH_INNER_MM,
        LEADER_BLOCK_WIDTH_OUTER_MM,
        LEADER_BLOCK_HEIGHT_MM,
    );
    const leader = bridge.concat(block);
    if (leader.length !== LEADER_SUFFIX_TRIANGLE_COUNT) {
        throw new Error(
            `leader suffix is ${leader.length} triangles, expected ${LEADER_SUFFIX_TRIANGLE_COUNT}`,
        );
    }
    return leader;
}

/**
 * Six strictly increasing X stations: deep embed, outline or mid-span, near tip,
 * toe tip, end of the short rise, and the overlap end. On a curved toe the second
 * station is the side-edge outline so the lip meets that surface instead of
 * bridging over it. The rise sits inside the scissor span.
 */
function bridgeXStations(bridgeX0: number, xEdge: number, toeTip: number, bridgeX1: number): number[] {
    const riseX = toeTip + LEADER_BRIDGE_RISE_MM;
    const curved = xEdge > bridgeX0 + 0.15 && toeTip - xEdge > 0.15;
    let mid: number;
    let nearTip: number;
    if (curved) {
        mid = xEdge;
        const back = Math.min((toeTip - xEdge) * 0.5, 0.6);
        nearTip = toeTip - back;
        if (nearTip <= mid + 0.15) nearTip = (mid + toeTip) / 2;
    } else {
        const span = toeTip - bridgeX0;
        const back = Math.min(span * 0.5, 0.6);
        nearTip = toeTip - back;
        mid = (bridgeX0 + nearTip) / 2;
    }
    const xs = [bridgeX0, mid, nearTip, toeTip, riseX, bridgeX1];
    for (let i = 1; i < xs.length; i++) {
        const prev = xs[i - 1];
        const next = xs[i];
        if (prev === undefined || next === undefined || next <= prev + 1e-4) {
            throw new Error("leader bridge stations collapsed");
        }
    }
    return xs;
}

/**
 * Over the toe, the bridge top is the local insole top capped at 3 mm (full local
 * thickness when the shell is thinner than the neck, buried when it is thicker).
 * A sample that misses the shell takes the lowest hit on that station so the
 * span cannot tent above the footprint. Past the tip the section is the full 3 mm.
 */
function bridgeTopRow(tris: Tri[], x: number, ys: number[], toeTip: number): number[] {
    if (x > toeTip + 1e-4) return ys.map(() => LEADER_BRIDGE_THICKNESS_MM);
    const sampleAt = (sx: number) => ys.map((y) => topZAt(tris, sx, y));
    let raw = sampleAt(x);
    const usable = (z: number | null) => z != null && z >= 1e-3;
    if (!raw.some(usable)) raw = sampleAt(Math.max(0, x - 0.05));
    const hits: number[] = [];
    for (const z of raw) {
        if (z == null || z < 1e-3) continue;
        hits.push(Math.min(LEADER_BRIDGE_THICKNESS_MM, z));
    }
    if (hits.length === 0) return ys.map(() => LEADER_BRIDGE_THICKNESS_MM);
    let floor = hits[0] ?? LEADER_BRIDGE_THICKNESS_MM;
    for (const hit of hits) floor = Math.min(floor, hit);
    return raw.map((z) => {
        if (z == null || z < 1e-3) return floor;
        return Math.min(LEADER_BRIDGE_THICKNESS_MM, z);
    });
}

/** Highest insole intersection of a vertical line. That is the top surface. */
function topZAt(tris: Tri[], x: number, y: number): number | null {
    let top: number | null = null;
    for (const t of tris) {
        const z = triangleZAtXY(t, x, y);
        if (z == null) continue;
        if (top === null || z > top) top = z;
    }
    return top;
}

function triangleZAtXY(t: Tri, x: number, y: number): number | null {
    const v0x = t.bx - t.ax;
    const v0y = t.by - t.ay;
    const v1x = t.cx - t.ax;
    const v1y = t.cy - t.ay;
    const v2x = x - t.ax;
    const v2y = y - t.ay;
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-12) return null;
    const inv = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;
    if (u < -1e-5 || v < -1e-5 || u + v > 1 + 1e-5) return null;
    const w = 1 - u - v;
    return w * t.az + u * t.bz + v * t.cz;
}

/**
 * Closed slab. Bottom is on Z = 0. Top follows `zTop` (X major, then Y).
 *  nx = xs-1, ny = ys-1 → 4*(nx*ny + nx + ny) triangles.
 */
function heightFieldSlab(xs: number[], ys: number[], zTop: number[][]): Tri[] {
    const nx = xs.length - 1;
    const ny = ys.length - 1;
    const out: Tri[] = [];
    const at = (i: number, j: number, top: boolean): [number, number, number] => {
        const x = xs[i];
        const y = ys[j];
        const row = zTop[i];
        const z = top ? row?.[j] : 0;
        if (x === undefined || y === undefined || z === undefined) {
            throw new Error("leader slab vertex is incomplete");
        }
        return [x, y, z];
    };
    const push = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
        out.push(tri(a, b, c));
    };
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            const sw = at(i, j, false);
            const se = at(i + 1, j, false);
            const ne = at(i + 1, j + 1, false);
            const nw = at(i, j + 1, false);
            push(sw, ne, se);
            push(sw, nw, ne);
            const swt = at(i, j, true);
            const set = at(i + 1, j, true);
            const net = at(i + 1, j + 1, true);
            const nwt = at(i, j + 1, true);
            push(swt, set, net);
            push(swt, net, nwt);
        }
    }
    for (let i = 0; i < nx; i++) {
        const y0 = 0;
        const y1 = ny;
        push(at(i, y0, false), at(i + 1, y0, false), at(i + 1, y0, true));
        push(at(i, y0, false), at(i + 1, y0, true), at(i, y0, true));
        push(at(i + 1, y1, false), at(i, y1, false), at(i, y1, true));
        push(at(i + 1, y1, false), at(i, y1, true), at(i + 1, y1, true));
    }
    for (let j = 0; j < ny; j++) {
        const x0 = 0;
        const x1 = nx;
        push(at(x0, j + 1, false), at(x0, j, false), at(x0, j, true));
        push(at(x0, j + 1, false), at(x0, j, true), at(x0, j + 1, true));
        push(at(x1, j, false), at(x1, j + 1, false), at(x1, j + 1, true));
        push(at(x1, j, false), at(x1, j + 1, true), at(x1, j, true));
    }
    return out;
}

/**
 * Toe-side bottom outline at the bridge edges y = yc ± half the bridge width.
 * Each station uses the maximum X (the front of the foot). x_edge is the minimum of those
 * two, so a curved toe embeds the full bridge width by at least LEADER_BRIDGE_EMBED_MM.
 */
function curvedToeOutlineX(tris: Tri[], yCenter: number, maxX: number): number {
    const half = LEADER_BRIDGE_WIDTH_MM / 2;
    const left = frontBottomOutlineX(tris, yCenter - half);
    const right = frontBottomOutlineX(tris, yCenter + half);
    const samples = [left, right].filter((x): x is number => x !== null);
    if (samples.length === 0) return maxX;
    return Math.min(...samples);
}

function frontBottomOutlineX(tris: Tri[], yTarget: number): number | null {
    let front: number | null = null;
    const take = (x: number) => {
        front = front === null ? x : Math.max(front, x);
    };
    for (const t of tris) {
        const verts: Array<[number, number, number]> = [
            [t.ax, t.ay, t.az],
            [t.bx, t.by, t.bz],
            [t.cx, t.cy, t.cz],
        ];
        for (let i = 0; i < 3; i++) {
            const a = verts[i];
            const b = verts[(i + 1) % 3];
            if (!a || !b) continue;
            if (a[2] >= BOTTOM_OUTLINE_Z_MM || b[2] >= BOTTOM_OUTLINE_Z_MM) continue;
            if (Math.abs(a[1] - yTarget) < BOTTOM_OUTLINE_Y_TOL_MM) take(a[0]);
            if (Math.abs(b[1] - yTarget) < BOTTOM_OUTLINE_Y_TOL_MM) take(b[0]);
            const dy = b[1] - a[1];
            if (Math.abs(dy) < 1e-8) continue;
            if ((a[1] - yTarget) * (b[1] - yTarget) >= 0) continue;
            const tParam = (yTarget - a[1]) / dy;
            const z = a[2] + tParam * (b[2] - a[2]);
            if (z >= BOTTOM_OUTLINE_Z_MM) continue;
            take(a[0] + tParam * (b[0] - a[0]));
        }
    }
    return front;
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
