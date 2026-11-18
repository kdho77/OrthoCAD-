// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Sacrificial belt-printer leader, applied to the manufacturing STL before VertexSlice.
 *
 * Founder-locked (Kendon 2026-11-17; the neck is a scissor tab, and the joint has to
 * be a strong bond with no weak layers). Kendon 2026-11-17 5:16 PM, after the Jabbour
 * right print: where the neck ends on the toe it feathers flush into the insole top.
 * No proud pad and no ridge or step.
 * - bridge 15 wide × 3 thick, 1 mm scissor span past the toe tip
 * - the embed walks back from the toe tip, one sample step at a time, until the
 *   insole's bottom-to-top thickness across the full 15 mm is at least 3 mm
 * - the walk stops at 12 mm; a cap that is still thinner than 3 mm stays buried
 *   on the local insole top (it is not held up at a 3 mm pad)
 * - over the whole embed the bridge top is the local insole top, capped at 3 mm,
 *   so the neck is inside the shell and the surface is the insole's own surface
 * - the bridge bottom stays on Z = 0; past the tip the section rises to the full 3 mm
 * - trapezoid block 20 deep × 10 high, width 20 → 30, on Z = 0
 * - block sits at the insole front (the 1 mm span) so the toe cannot fold under
 * - bridge overlaps the block by 2 mm; the block itself does not move
 * - toe = the thinner max-X end in the OrthoCAD frame; abort if that end is not thinner
 *
 * Triangles are appended. The embed intersects the insole, so the mesh is not a boolean union.
 * The blend is sampled on a copy of the shell and written only as that suffix. The insole
 * triangles stay the input mesh, so an outline or forefoot-width measurement of the shell
 * cannot pick up the neck.
 */

export const LEADER_BRIDGE_WIDTH_MM = 15;
export const LEADER_BRIDGE_THICKNESS_MM = 3;
export const LEADER_BRIDGE_LENGTH_MM = 1;
/** Sample step while walking the embed back from the toe tip. Also the shortest embed. */
export const LEADER_BRIDGE_EMBED_STEP_MM = 0.25;
/** Stop the walk once every sample across the bridge width is at least this thick. */
export const LEADER_BRIDGE_EMBED_TARGET_MM = 3;
/** The embed never reaches further than this into the insole, measured from the toe tip. */
export const LEADER_BRIDGE_EMBED_MAX_MM = 12;
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

export interface LeaderEmbedPlan {
    /** How far the bridge reaches back from the toe tip. */
    depthMm: number;
    /**
     * Minimum bottom-to-top thickness across the 15 mm width at that depth.
     * A sample that misses the shell counts as empty, so a gap under the footprint is 0.
     */
    thicknessMm: number;
    /**
     * How far the bridge top stands above the insole. The embed is flush
     * (Kendon 2026-11-17 5:16 PM), so this is 0. A toe thinner than 3 mm stays
     * on the local top instead of being padded up.
     */
    padMm: number;
}

/** Embed the bridge would use on this manufacturing STL. Same walk as the leader mesh. */
export function leaderEmbedPlan(stl: ArrayBuffer): LeaderEmbedPlan {
    const tris = readBinaryStl(stl);
    const frame = measureToeFrame(tris);
    return planEmbed(tris, frame.toeTip, embedSampleYs(frame.yCenter));
}

function cloneTri(t: Tri): Tri {
    return { ...t };
}

export function applySacrificialLeaderBlock(stl: ArrayBuffer): ArrayBuffer {
    const body = readBinaryStl(stl);
    // The neck is built from a copy and concatenated. body is written unchanged,
    // so the blend cannot move an insole vertex the outline is measured from.
    const leader = leaderTrianglesForMesh(body.map(cloneTri));
    return writeBinaryStl(body.concat(leader));
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

interface ToeFrame {
    toeTip: number;
    yCenter: number;
    xEdge: number;
}

function measureToeFrame(tris: Tri[]): ToeFrame {
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
    return {
        toeTip: bounds.maxX,
        yCenter,
        xEdge: curvedToeOutlineX(tris, yCenter, bounds.maxX),
    };
}

function leaderTrianglesForMesh(tris: Tri[]): Tri[] {
    const frame = measureToeFrame(tris);
    const { toeTip, yCenter, xEdge } = frame;
    const plan = planEmbed(tris, toeTip, embedSampleYs(yCenter));
    const bridgeX0 = toeTip - plan.depthMm;
    // 1 mm scissor span from the toe tip to the block. Overlap extends the bridge only.
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
 * station is the side-edge outline when that outline sits inside the embed, so the
 * lip meets that surface. Heights at these stations follow the insole top, so the
 * embed has no pad step. The rise sits inside the scissor span.
 */
function bridgeXStations(
    bridgeX0: number,
    xEdge: number,
    toeTip: number,
    bridgeX1: number,
): number[] {
    const riseX = toeTip + LEADER_BRIDGE_RISE_MM;
    let mid: number;
    let nearTip: number;
    const span = toeTip - bridgeX0;
    if (xEdge > bridgeX0 + 0.2 && xEdge < toeTip - 0.2) {
        mid = xEdge;
        const back = Math.min((toeTip - xEdge) * 0.5, 0.6);
        nearTip = toeTip - back;
        if (nearTip <= mid + 0.15) nearTip = (mid + toeTip) / 2;
    } else {
        const back = Math.min(span * 0.5, 0.6);
        nearTip = toeTip - back;
        mid = (bridgeX0 + nearTip) / 2;
        if (!(mid > bridgeX0 + 1e-4 && nearTip > mid + 1e-4 && nearTip < toeTip - 1e-4)) {
            mid = bridgeX0 + span / 3;
            nearTip = bridgeX0 + (2 * span) / 3;
        }
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

/** Seven samples from edge to edge. A miss anywhere under the 15 mm footprint is empty. */
function embedSampleYs(yCenter: number): number[] {
    const half = LEADER_BRIDGE_WIDTH_MM / 2;
    const segments = 6;
    const ys: number[] = [];
    for (let i = 0; i <= segments; i++) ys.push(yCenter - half + (LEADER_BRIDGE_WIDTH_MM * i) / segments);
    return ys;
}

/**
 * Walk from the toe tip back into the insole. The first station whose minimum
 * thickness across the bridge width reaches the target wins. The search starts
 * one step in, so a tip that is already thick still gets a real overlap, and it
 * never passes the 12 mm cap.
 */
function planEmbed(tris: Tri[], toeTip: number, ys: number[]): LeaderEmbedPlan {
    const step = LEADER_BRIDGE_EMBED_STEP_MM;
    const steps = Math.round(LEADER_BRIDGE_EMBED_MAX_MM / step);
    const xMin = toeTip - LEADER_BRIDGE_EMBED_MAX_MM - 0.5;
    const window = tris.filter(
        (t) => Math.max(t.ax, t.bx, t.cx) >= xMin && Math.min(t.ax, t.bx, t.cx) <= toeTip + 0.5,
    );
    let depthMm = step;
    let thicknessMm = 0;
    for (let i = 1; i <= steps; i++) {
        const depth = i * step;
        const minMm = thicknessAcross(window, toeTip - depth, ys);
        depthMm = depth;
        thicknessMm = minMm;
        if (minMm + 1e-4 >= LEADER_BRIDGE_EMBED_TARGET_MM) break;
    }
    // Flush embed: the bridge top is the insole top, so the proud height is 0
    // even when the cap is still thinner than 3 mm.
    return { depthMm, thicknessMm, padMm: 0 };
}

function thicknessAcross(tris: Tri[], x: number, ys: number[]): number {
    let minMm = Number.POSITIVE_INFINITY;
    let anyHit = false;
    for (const y of ys) {
        const col = columnZ(tris, x, y);
        if (!col) {
            minMm = 0;
            continue;
        }
        anyHit = true;
        minMm = Math.min(minMm, col.top - col.bottom);
    }
    if (!anyHit) return 0;
    return minMm;
}

/** Bottom and top of the shell on a vertical line. A single graze is not a thickness. */
function columnZ(tris: Tri[], x: number, y: number): { top: number; bottom: number } | null {
    let top = Number.NEGATIVE_INFINITY;
    let bottom = Number.POSITIVE_INFINITY;
    let hits = 0;
    for (const t of tris) {
        if (x < t.ax && x < t.bx && x < t.cx) continue;
        if (x > t.ax && x > t.bx && x > t.cx) continue;
        if (y < t.ay && y < t.by && y < t.cy) continue;
        if (y > t.ay && y > t.by && y > t.cy) continue;
        const z = triangleZAtXY(t, x, y);
        if (z == null) continue;
        hits += 1;
        if (z > top) top = z;
        if (z < bottom) bottom = z;
    }
    if (hits < 2 || top - bottom < 1e-3) return null;
    return { top, bottom };
}

/**
 * Over the whole embed the bridge top is the local insole top capped at 3 mm.
 * It is never raised above that surface, so the neck feathers flush and the
 * embedded portion stays inside the shell. A sample that misses the shell takes
 * the lowest hit on that station so the span cannot tent above the footprint.
 * Past the tip the section is the full 3 mm.
 */
function bridgeTopRow(tris: Tri[], x: number, ys: number[], toeTip: number): number[] {
    return clippedTopRow(tris, x, ys, toeTip);
}

function clippedTopRow(tris: Tri[], x: number, ys: number[], toeTip: number): number[] {
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
    // Top faces before the bottom. The first facet of this shell must not point
    // straight down: the slicer flips a whole shell when that facet does, and the
    // flipped bridge cancels the toe where they overlap.
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            const swt = at(i, j, true);
            const set = at(i + 1, j, true);
            const net = at(i + 1, j + 1, true);
            const nwt = at(i, j + 1, true);
            push(swt, set, net);
            push(swt, net, nwt);
            const sw = at(i, j, false);
            const se = at(i + 1, j, false);
            const ne = at(i + 1, j + 1, false);
            const nw = at(i, j + 1, false);
            push(sw, ne, se);
            push(sw, nw, ne);
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
 * two. When that outline falls inside the adaptive embed, a bridge station is placed on it.
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
    // [4, 5, 6] is the top. It has to be the first facet so the slicer does not
    // flip this shell inside out. Winding of each face is unchanged.
    const faces = [
        [4, 5, 6],
        [4, 6, 7],
        [0, 2, 1],
        [0, 3, 2],
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
