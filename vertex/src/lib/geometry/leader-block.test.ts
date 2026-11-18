// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    applySacrificialLeaderBlock,
    binaryStlBounds,
    binaryStlTriangleCount,
    LEADER_BLOCK_DEPTH_MM,
    LEADER_BLOCK_HEIGHT_MM,
    LEADER_BLOCK_WIDTH_INNER_MM,
    LEADER_BLOCK_WIDTH_OUTER_MM,
    LEADER_BRIDGE_BLOCK_OVERLAP_MM,
    LEADER_BRIDGE_EMBED_MAX_MM,
    LEADER_BRIDGE_EMBED_STEP_MM,
    LEADER_BRIDGE_EMBED_TARGET_MM,
    LEADER_BRIDGE_LENGTH_MM,
    LEADER_BRIDGE_RISE_MM,
    LEADER_BRIDGE_THICKNESS_MM,
    LEADER_BRIDGE_WIDTH_MM,
    LEADER_SUFFIX_TRIANGLE_COUNT,
    LeaderBlockOrientationError,
    leaderEmbedPlan,
    manufacturingStlForExportKind,
    manufacturingStlIncludesLeaderBlock,
} from "./leader-block";

function maxZNear(stl: ArrayBuffer, x: number, yAbs: number): number {
    const row = verticesNear(stl, x).filter((v) => Math.abs(Math.abs(v[1]) - yAbs) < 0.02);
    return Math.max(...row.map((v) => v[2]));
}

/** Bridge top samples along X at |y| = yAbs (centerline when yAbs is 0). Bottom vertices are dropped. */
function topProfile(
    stl: ArrayBuffer,
    bodyTriangles: number,
    yAbs: number,
): Array<{ x: number; z: number }> {
    const buckets = new Map<number, number>();
    for (const v of suffixVertices(stl, bodyTriangles)) {
        if (v[2] <= 0.02) continue;
        if (Math.abs(Math.abs(v[1]) - yAbs) >= 0.02) continue;
        const key = Math.round(v[0] * 1e4) / 1e4;
        const prev = buckets.get(key);
        buckets.set(key, prev === undefined ? v[2] : Math.max(prev, v[2]));
    }
    return [...buckets.entries()].map(([x, z]) => ({ x, z })).sort((a, b) => a.x - b.x);
}

/** Open edges in the leader suffix. A closed bridge plus a closed block is zero. */
function openEdgeCount(stl: ArrayBuffer, bodyTriangles: number): number {
    const view = new DataView(stl);
    const count = view.getUint32(80, true);
    const edges = new Map<string, number>();
    const key = (x: number, y: number, z: number) =>
        `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    for (let t = bodyTriangles; t < count; t++) {
        const base = 84 + t * 50 + 12;
        const ids: string[] = [];
        for (let k = 0; k < 3; k++) {
            const offset = base + k * 12;
            ids.push(
                key(
                    view.getFloat32(offset, true),
                    view.getFloat32(offset + 4, true),
                    view.getFloat32(offset + 8, true),
                ),
            );
        }
        for (let k = 0; k < 3; k++) {
            const a = ids[k];
            const b = ids[(k + 1) % 3];
            if (!a || !b || a === b) continue;
            const e = a < b ? `${a}|${b}` : `${b}|${a}`;
            edges.set(e, (edges.get(e) ?? 0) + 1);
        }
    }
    let open = 0;
    for (const n of edges.values()) if (n !== 2) open += 1;
    return open;
}

/** Signed volume of triangles [start, end). Outward faces sum positive. */
function leaderVolume(stl: ArrayBuffer, start: number, end: number): number {
    const view = new DataView(stl);
    let v = 0;
    for (let t = start; t < end; t++) {
        const base = 84 + t * 50 + 12;
        const p: number[] = [];
        for (let k = 0; k < 9; k++) p.push(view.getFloat32(base + k * 4, true));
        const ax = p[0] ?? 0;
        const ay = p[1] ?? 0;
        const az = p[2] ?? 0;
        const bx = p[3] ?? 0;
        const by = p[4] ?? 0;
        const bz = p[5] ?? 0;
        const cx = p[6] ?? 0;
        const cy = p[7] ?? 0;
        const cz = p[8] ?? 0;
        v += ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by);
    }
    return v / 6;
}

/** Unit normal z of one STL triangle. Straight down is -1. */
function facetNormalZ(stl: ArrayBuffer, triangle: number): number {
    const view = new DataView(stl);
    const base = 84 + triangle * 50 + 12;
    const p: number[] = [];
    for (let k = 0; k < 9; k++) p.push(view.getFloat32(base + k * 4, true));
    const ax = p[0] ?? 0;
    const ay = p[1] ?? 0;
    const az = p[2] ?? 0;
    const bx = p[3] ?? 0;
    const by = p[4] ?? 0;
    const bz = p[5] ?? 0;
    const cx = p[6] ?? 0;
    const cy = p[7] ?? 0;
    const cz = p[8] ?? 0;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return nz / len;
}

function suffixVertices(stl: ArrayBuffer, bodyTriangles: number): Array<[number, number, number]> {
    const view = new DataView(stl);
    const count = view.getUint32(80, true);
    const found: Array<[number, number, number]> = [];
    for (let t = bodyTriangles; t < count; t++) {
        const base = 84 + t * 50 + 12;
        for (let k = 0; k < 3; k++) {
            const offset = base + k * 12;
            found.push([
                view.getFloat32(offset, true),
                view.getFloat32(offset + 4, true),
                view.getFloat32(offset + 8, true),
            ]);
        }
    }
    return found;
}

function verticesNear(stl: ArrayBuffer, x: number): Array<[number, number, number]> {
    const view = new DataView(stl);
    const count = view.getUint32(80, true);
    const found: Array<[number, number, number]> = [];
    for (let t = 0; t < count; t++) {
        const base = 84 + t * 50 + 12;
        for (let k = 0; k < 3; k++) {
            const offset = base + k * 12;
            const vx = view.getFloat32(offset, true);
            if (Math.abs(vx - x) > 0.02) continue;
            found.push([vx, view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)]);
        }
    }
    return found;
}

function writeBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): ArrayBuffer {
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
    const buffer = new ArrayBuffer(84 + faces.length * 50);
    const view = new DataView(buffer);
    view.setUint32(80, faces.length, true);
    let offset = 84;
    for (const [a, b, c] of faces) {
        offset += 12;
        for (const i of [a, b, c]) {
            const p = i === undefined ? undefined : v[i];
            const x = p?.[0];
            const y = p?.[1];
            const z = p?.[2];
            if (x === undefined || y === undefined || z === undefined) {
                throw new Error("test box vertex missing");
            }
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

/**
 * Closed toe from `xRear` to `xTip`. Top is `tipTop` at the tip and rises by `slopePerMm`
 * toward the rear. Bottom is on Z = 0, so thickness equals the top height.
 */
function writeSlopedToe(
    xRear: number,
    xTip: number,
    y0: number,
    y1: number,
    tipTop: number,
    slopePerMm: number,
): ArrayBuffer {
    const zRear = tipTop + (xTip - xRear) * slopePerMm;
    const v = [
        [xRear, y0, 0],
        [xTip, y0, 0],
        [xTip, y1, 0],
        [xRear, y1, 0],
        [xRear, y0, zRear],
        [xTip, y0, tipTop],
        [xTip, y1, tipTop],
        [xRear, y1, zRear],
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
    const buffer = new ArrayBuffer(84 + faces.length * 50);
    const view = new DataView(buffer);
    view.setUint32(80, faces.length, true);
    let offset = 84;
    for (const [a, b, c] of faces) {
        offset += 12;
        for (const i of [a, b, c]) {
            const p = i === undefined ? undefined : v[i];
            const x = p?.[0];
            const y = p?.[1];
            const z = p?.[2];
            if (x === undefined || y === undefined || z === undefined) {
                throw new Error("test wedge vertex missing");
            }
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

/** Tip at x=220; bottom outline at y=±7.5 sits at x=200 (the 15 mm bridge edges). */
function curvedToe(): ArrayBuffer {
    const heel = writeBox(0, -20, 0, 15, 20, 30);
    const beak = writeTriangles([
        [200, -7.5, 0],
        [200, 7.5, 0],
        [220, 0, 0],
        [200, -7.5, 0],
        [220, 0, 3],
        [200, 7.5, 0],
        [200, -7.5, 2],
        [220, 0, 3],
        [200, 7.5, 2],
    ]);
    return concatStls([heel, beak]);
}

function writeTriangles(corners: Array<[number, number, number]>): ArrayBuffer {
    const triCount = corners.length / 3;
    const buffer = new ArrayBuffer(84 + triCount * 50);
    const view = new DataView(buffer);
    view.setUint32(80, triCount, true);
    let offset = 84;
    for (let t = 0; t < triCount; t++) {
        offset += 12;
        for (let k = 0; k < 3; k++) {
            const p = corners[t * 3 + k];
            if (!p) throw new Error("test triangle vertex missing");
            view.setFloat32(offset, p[0], true);
            view.setFloat32(offset + 4, p[1], true);
            view.setFloat32(offset + 8, p[2], true);
            offset += 12;
        }
        view.setUint16(offset, 0, true);
        offset += 2;
    }
    return buffer;
}

function concatStls(parts: ArrayBuffer[]): ArrayBuffer {
    const counts = parts.map((part) => binaryStlTriangleCount(part));
    const total = counts.reduce((sum, n) => sum + n, 0);
    const out = new ArrayBuffer(84 + total * 50);
    new DataView(out).setUint32(80, total, true);
    let cursor = 84;
    for (const part of parts) {
        const bytes = new Uint8Array(part).subarray(84);
        new Uint8Array(out).set(bytes, cursor);
        cursor += bytes.length;
    }
    return out;
}

/** Thick heel at min X, toe of `topZ` at max X. */
function toeAtMaxX(topZ = 4): ArrayBuffer {
    const heel = writeBox(0, -30, 0, 10, 30, 24);
    const toe = writeBox(180, -15, 0, 200, 15, topZ);
    const heelTris = binaryStlTriangleCount(heel);
    const toeTris = binaryStlTriangleCount(toe);
    const out = new ArrayBuffer(84 + (heelTris + toeTris) * 50);
    const view = new DataView(out);
    view.setUint32(80, heelTris + toeTris, true);
    new Uint8Array(out).set(new Uint8Array(heel).subarray(84), 84);
    new Uint8Array(out).set(new Uint8Array(toe).subarray(84), 84 + heelTris * 50);
    return out;
}

describe("sacrificial leader block", () => {
    test("G-code manufacturing STL includes the leader; mesh and CNC do not", () => {
        expect(manufacturingStlIncludesLeaderBlock("gcode")).toBe(true);
        expect(manufacturingStlIncludesLeaderBlock("gcode", false)).toBe(false);
        for (const kind of ["stl", "3mf", "glb", "cnc"] as const) {
            expect(manufacturingStlIncludesLeaderBlock(kind)).toBe(false);
        }
        const raw = toeAtMaxX();
        expect(manufacturingStlForExportKind(raw, "stl")).toBe(raw);
        expect(manufacturingStlForExportKind(raw, "cnc")).toBe(raw);
        const gcodeStl = manufacturingStlForExportKind(raw, "gcode");
        expect(gcodeStl).not.toBe(raw);
        expect(binaryStlTriangleCount(gcodeStl)).toBeGreaterThan(binaryStlTriangleCount(raw));
    });

    test("founder-locked constants (Kendon 2026-11-17)", () => {
        expect(LEADER_BLOCK_DEPTH_MM).toBe(20);
        expect(LEADER_BLOCK_HEIGHT_MM).toBe(10);
        expect(LEADER_BRIDGE_WIDTH_MM).toBe(15);
        expect(LEADER_BRIDGE_THICKNESS_MM).toBe(3);
        expect(LEADER_BRIDGE_LENGTH_MM).toBe(1);
        expect(LEADER_BRIDGE_EMBED_STEP_MM).toBe(0.25);
        expect(LEADER_BRIDGE_EMBED_TARGET_MM).toBe(3);
        expect(LEADER_BRIDGE_EMBED_TARGET_MM).toBe(LEADER_BRIDGE_THICKNESS_MM);
        expect(LEADER_BRIDGE_EMBED_MAX_MM).toBe(12);
        // The 2 mm proud pad was removed (Kendon 2026-11-17 5:16 PM). The embed
        // top is the insole top, so there is no pad span left to lock.
        expect(LEADER_BRIDGE_BLOCK_OVERLAP_MM).toBe(2);
        expect(LEADER_BRIDGE_RISE_MM).toBeLessThan(LEADER_BRIDGE_LENGTH_MM);
        expect(LEADER_BLOCK_WIDTH_INNER_MM).toBe(20);
        expect(LEADER_BLOCK_WIDTH_OUTER_MM).toBe(30);
        expect(LEADER_SUFFIX_TRIANGLE_COUNT).toBe(80);
    });

    test("places the bridge and trapezoid on the thinner max-X toe", () => {
        const raw = toeAtMaxX();
        const before = binaryStlBounds(raw);
        const plan = leaderEmbedPlan(raw);
        const withLeader = applySacrificialLeaderBlock(raw);
        const after = binaryStlBounds(withLeader);
        // The 4 mm toe is already past the target, so the embed is one sample step.
        expect(plan.depthMm).toBe(LEADER_BRIDGE_EMBED_STEP_MM);
        expect(plan.padMm).toBe(0);
        expect(plan.thicknessMm).toBeCloseTo(4, 2);
        // Block starts after the 1 mm neck and is 20 mm deep.
        const blockX0 = before.maxX + LEADER_BRIDGE_LENGTH_MM;
        const expectedMaxX = blockX0 + LEADER_BLOCK_DEPTH_MM;
        expect(after.maxX).toBeCloseTo(expectedMaxX, 3);
        expect(after.maxX - before.maxX).toBeCloseTo(21, 3);
        expect(after.maxZ).toBeCloseTo(Math.max(before.maxZ, LEADER_BLOCK_HEIGHT_MM), 3);
        expect(after.minZ).toBeCloseTo(0, 3);
        const outer = verticesNear(withLeader, expectedMaxX);
        const outerYExtent = Math.max(...outer.map((v) => v[1])) - Math.min(...outer.map((v) => v[1]));
        expect(outerYExtent).toBeCloseTo(LEADER_BLOCK_WIDTH_OUTER_MM, 2);
        expect(outer.some((v) => Math.abs(v[1] - LEADER_BLOCK_WIDTH_OUTER_MM / 2) < 0.01 && v[2] === 0)).toBe(
            true,
        );
        expect(
            outer.some(
                (v) =>
                    Math.abs(v[1] + LEADER_BLOCK_WIDTH_OUTER_MM / 2) < 0.01 &&
                    v[2] === LEADER_BLOCK_HEIGHT_MM,
            ),
        ).toBe(true);
        const bridgeStart = before.maxX - plan.depthMm;
        const embedded = verticesNear(withLeader, bridgeStart);
        expect(embedded.some((v) => Math.abs(v[2]) < 1e-4)).toBe(true);
        expect(embedded.some((v) => Math.abs(v[2] - LEADER_BRIDGE_THICKNESS_MM) < 1e-4)).toBe(true);
        const embedWidth = Math.max(...embedded.map((v) => v[1])) - Math.min(...embedded.map((v) => v[1]));
        expect(embedWidth).toBeCloseTo(LEADER_BRIDGE_WIDTH_MM, 2);
        const overlapEnd = blockX0 + LEADER_BRIDGE_BLOCK_OVERLAP_MM;
        const overlap = verticesNear(withLeader, overlapEnd);
        expect(overlap.some((v) => Math.abs(v[2] - LEADER_BRIDGE_THICKNESS_MM) < 1e-4)).toBe(true);
        const overlapWidth = Math.max(...overlap.map((v) => v[1])) - Math.min(...overlap.map((v) => v[1]));
        expect(overlapWidth).toBeCloseTo(LEADER_BRIDGE_WIDTH_MM, 2);
        const blockNear = verticesNear(withLeader, blockX0);
        expect(blockNear.some((v) => Math.abs(v[1] - LEADER_BLOCK_WIDTH_INNER_MM / 2) < 0.01)).toBe(true);
        expect(binaryStlTriangleCount(withLeader)).toBe(
            binaryStlTriangleCount(raw) + LEADER_SUFFIX_TRIANGLE_COUNT,
        );
        const bodyTris = binaryStlTriangleCount(raw);
        expect(openEdgeCount(withLeader, bodyTris)).toBe(0);
        const bridgeTris = LEADER_SUFFIX_TRIANGLE_COUNT - 12;
        expect(leaderVolume(withLeader, bodyTris, bodyTris + bridgeTris)).toBeGreaterThan(0);
        expect(
            leaderVolume(withLeader, bodyTris + bridgeTris, bodyTris + LEADER_SUFFIX_TRIANGLE_COUNT),
        ).toBeGreaterThan(0);
    });

    test("each leader shell starts with a facet that is not straight down", () => {
        const raw = toeAtMaxX();
        const withLeader = applySacrificialLeaderBlock(raw);
        const bodyTris = binaryStlTriangleCount(raw);
        const bridgeTris = LEADER_SUFFIX_TRIANGLE_COUNT - 12;
        const bridgeFirst = bodyTris;
        const blockFirst = bodyTris + bridgeTris;
        // A straight-down first facet is what makes the slicer flip the shell.
        expect(facetNormalZ(withLeader, bridgeFirst)).toBeGreaterThan(-0.9);
        expect(facetNormalZ(withLeader, blockFirst)).toBeGreaterThan(-0.9);
        expect(leaderVolume(withLeader, bodyTris, blockFirst)).toBeGreaterThan(0);
        expect(leaderVolume(withLeader, blockFirst, bodyTris + LEADER_SUFFIX_TRIANGLE_COUNT)).toBeGreaterThan(
            0,
        );
        expect(binaryStlTriangleCount(withLeader) - bodyTris).toBe(LEADER_SUFFIX_TRIANGLE_COUNT);
    });

    test("curved beak that never reaches 3 mm across the bridge width caps the embed at 12 mm", () => {
        const raw = curvedToe();
        const before = binaryStlBounds(raw);
        expect(before.maxX).toBeCloseTo(220, 3);
        const plan = leaderEmbedPlan(raw);
        const withLeader = applySacrificialLeaderBlock(raw);
        // The beak is narrower than 15 mm until its base, so the footprint stays empty inside the cap.
        expect(plan.depthMm).toBe(LEADER_BRIDGE_EMBED_MAX_MM);
        expect(plan.thicknessMm).toBe(0);
        expect(plan.padMm).toBe(0);
        const bridgeStart = before.maxX - plan.depthMm;
        const embedded = verticesNear(withLeader, bridgeStart);
        // Centerline shell at 12 mm back is 2.4 mm. The bridge follows it instead of a 3 mm pad.
        expect(Math.max(...embedded.map((v) => v[2]))).toBeCloseTo(2.4, 2);
        expect(embedded.some((v) => Math.abs(v[2] - LEADER_BRIDGE_THICKNESS_MM) < 1e-4)).toBe(false);
        expect(embedded.some((v) => Math.abs(v[2]) < 1e-4)).toBe(true);
        const blockX0 = before.maxX + LEADER_BRIDGE_LENGTH_MM;
        const overlapEnd = blockX0 + LEADER_BRIDGE_BLOCK_OVERLAP_MM;
        expect(binaryStlBounds(withLeader).maxX).toBeCloseTo(blockX0 + LEADER_BLOCK_DEPTH_MM, 3);
        expect(verticesNear(withLeader, overlapEnd).length).toBeGreaterThan(0);
        expect(verticesNear(withLeader, blockX0).length).toBeGreaterThan(0);
    });

    test("15 × 3 mm neck keeps the 1 mm scissor span and overlaps the block by 2 mm", () => {
        const raw = toeAtMaxX();
        const before = binaryStlBounds(raw);
        const plan = leaderEmbedPlan(raw);
        const withLeader = applySacrificialLeaderBlock(raw);
        const bridgeStart = before.maxX - plan.depthMm;
        const blockX0 = before.maxX + LEADER_BRIDGE_LENGTH_MM;
        const overlapEnd = blockX0 + LEADER_BRIDGE_BLOCK_OVERLAP_MM;
        const riseX = before.maxX + LEADER_BRIDGE_RISE_MM;
        for (const x of [bridgeStart, before.maxX, riseX, overlapEnd]) {
            const row = verticesNear(withLeader, x);
            const bridge = row.filter((v) => Math.abs(Math.abs(v[1]) - LEADER_BRIDGE_WIDTH_MM / 2) < 0.02);
            expect(bridge.length, `bridge corners at x=${x}`).toBeGreaterThan(0);
            const width = Math.max(...bridge.map((v) => v[1])) - Math.min(...bridge.map((v) => v[1]));
            expect(width, `width at x=${x}`).toBeCloseTo(LEADER_BRIDGE_WIDTH_MM, 2);
        }
        // Toe is 4 mm, so the short embed stays buried at the full 3 mm section, bottom on the bed.
        expect(maxZNear(withLeader, bridgeStart, LEADER_BRIDGE_WIDTH_MM / 2)).toBeCloseTo(3, 3);
        expect(maxZNear(withLeader, before.maxX, LEADER_BRIDGE_WIDTH_MM / 2)).toBeCloseTo(3, 3);
        expect(maxZNear(withLeader, riseX, LEADER_BRIDGE_WIDTH_MM / 2)).toBeCloseTo(3, 3);
        expect(maxZNear(withLeader, overlapEnd, LEADER_BRIDGE_WIDTH_MM / 2)).toBeCloseTo(3, 3);
        expect(overlapEnd - blockX0).toBeCloseTo(LEADER_BRIDGE_BLOCK_OVERLAP_MM, 3);
        expect(blockX0 - before.maxX).toBeCloseTo(LEADER_BRIDGE_LENGTH_MM, 3);
        expect(plan.depthMm).toBe(LEADER_BRIDGE_EMBED_STEP_MM);
    });

    test("embed walks back until the toe is 3 mm thick and stays under the insole top", () => {
        // 0.5 mm at the tip, +0.75 mm per mm back: 2.9375 at 3.25 mm, 3.125 at 3.5 mm.
        const tipTop = 0.5;
        const slope = 0.75;
        const heel = writeBox(0, -30, 0, 20, 30, 40);
        const toe = writeSlopedToe(150, 200, -20, 20, tipTop, slope);
        const raw = concatStls([heel, toe]);
        const before = binaryStlBounds(raw);
        const plan = leaderEmbedPlan(raw);
        const withLeader = applySacrificialLeaderBlock(raw);
        expect(plan.depthMm).toBe(3.5);
        expect(plan.depthMm).toBeLessThanOrEqual(LEADER_BRIDGE_EMBED_MAX_MM);
        expect(plan.thicknessMm).toBeCloseTo(tipTop + 3.5 * slope, 2);
        expect(plan.thicknessMm).toBeGreaterThanOrEqual(LEADER_BRIDGE_EMBED_TARGET_MM);
        expect(plan.padMm).toBe(0);
        const bridgeStart = before.maxX - plan.depthMm;
        const edge = verticesNear(withLeader, bridgeStart).filter(
            (v) => Math.abs(Math.abs(v[1]) - LEADER_BRIDGE_WIDTH_MM / 2) < 0.02,
        );
        expect(edge.some((v) => Math.abs(v[2]) < 1e-4)).toBe(true);
        expect(Math.max(...edge.map((v) => v[2]))).toBeCloseTo(LEADER_BRIDGE_THICKNESS_MM, 2);
        const width = Math.max(...edge.map((v) => v[1])) - Math.min(...edge.map((v) => v[1]));
        expect(width).toBeCloseTo(LEADER_BRIDGE_WIDTH_MM, 2);
        const localTop = (x: number) => tipTop + (before.maxX - x) * slope;
        const overToe = suffixVertices(withLeader, binaryStlTriangleCount(raw)).filter(
            (v) => v[0] <= before.maxX + 1e-3 && v[2] > 0.02,
        );
        expect(overToe.length).toBeGreaterThan(0);
        for (const v of overToe) {
            expect(v[2], `bridge above the insole at x=${v[0]}`).toBeLessThanOrEqual(localTop(v[0]) + 0.02);
        }
        const blockX0 = before.maxX + LEADER_BRIDGE_LENGTH_MM;
        expect(binaryStlBounds(withLeader).maxX).toBeCloseTo(blockX0 + LEADER_BLOCK_DEPTH_MM, 3);
        expect(openEdgeCount(withLeader, binaryStlTriangleCount(raw))).toBe(0);
        expect(binaryStlTriangleCount(withLeader)).toBe(
            binaryStlTriangleCount(raw) + LEADER_SUFFIX_TRIANGLE_COUNT,
        );
    });

    test("a toe that stays under 3 mm caps the embed at 12 mm and feathers flush", () => {
        const topZ = 1.2;
        const raw = toeAtMaxX(topZ);
        const before = binaryStlBounds(raw);
        const plan = leaderEmbedPlan(raw);
        const withLeader = applySacrificialLeaderBlock(raw);
        expect(plan.depthMm).toBe(LEADER_BRIDGE_EMBED_MAX_MM);
        expect(plan.thicknessMm).toBeCloseTo(topZ, 3);
        expect(plan.padMm).toBe(0);
        const bridgeStart = before.maxX - plan.depthMm;
        const riseX = before.maxX + LEADER_BRIDGE_RISE_MM;
        const overlapEnd = before.maxX + LEADER_BRIDGE_LENGTH_MM + LEADER_BRIDGE_BLOCK_OVERLAP_MM;
        const bodyTris = binaryStlTriangleCount(raw);
        for (const yAbs of [0, LEADER_BRIDGE_WIDTH_MM / 2]) {
            const embed = topProfile(withLeader, bodyTris, yAbs).filter(
                (p) => p.x >= bridgeStart - 1e-3 && p.x <= before.maxX + 1e-3,
            );
            expect(embed.length, `embed samples at |y|=${yAbs}`).toBeGreaterThan(2);
            for (let i = 0; i < embed.length; i++) {
                const p = embed[i];
                if (!p) continue;
                expect(p.z, `proud at x=${p.x}`).toBeLessThanOrEqual(topZ + 0.05);
                expect(p.z, `flush height at x=${p.x}`).toBeCloseTo(topZ, 3);
                const prev = embed[i - 1];
                if (!prev) continue;
                expect(p.z, `step from x=${prev.x} to x=${p.x}`).toBeGreaterThanOrEqual(prev.z - 1e-4);
                expect(Math.abs(p.z - prev.z), `jump from x=${prev.x}`).toBeLessThanOrEqual(0.05);
            }
        }
        expect(maxZNear(withLeader, bridgeStart, LEADER_BRIDGE_WIDTH_MM / 2)).toBeCloseTo(topZ, 3);
        expect(maxZNear(withLeader, before.maxX, LEADER_BRIDGE_WIDTH_MM / 2)).toBeCloseTo(topZ, 3);
        expect(
            verticesNear(withLeader, bridgeStart).some((v) => Math.abs(v[2]) < 1e-4),
            "bottom on Z=0",
        ).toBe(true);
        expect(maxZNear(withLeader, riseX, LEADER_BRIDGE_WIDTH_MM / 2)).toBeCloseTo(
            LEADER_BRIDGE_THICKNESS_MM,
            3,
        );
        expect(maxZNear(withLeader, overlapEnd, LEADER_BRIDGE_WIDTH_MM / 2)).toBeCloseTo(
            LEADER_BRIDGE_THICKNESS_MM,
            3,
        );
        expect(openEdgeCount(withLeader, bodyTris)).toBe(0);
        expect(binaryStlTriangleCount(withLeader) - bodyTris).toBe(LEADER_SUFFIX_TRIANGLE_COUNT);
    });

    test("Jabbour and Men's 9 toes at 2.21 mm feather flush with no ridge", () => {
        // Jabbour / Men's 9 hit the 12 mm cap with the toe 2.21 mm thick, which used
        // to stand a 0.79 mm pad. The flat shell is that section: its bridge top is
        // constant, so it is continuous and monotone non-decreasing out to the tip.
        // The taper is the same cap with the toe thinning to 1.01 mm. The bridge
        // follows that fall, so it stays flush instead of holding a higher plateau.
        const flatTop = 2.21;
        const tipTop = 1.01;
        const slope = 0.1;
        const cases = [
            {
                name: "mens-9",
                raw: toeAtMaxX(flatTop),
                localTop: (_x: number) => flatTop,
                monotone: true,
            },
            {
                name: "jabbour",
                raw: concatStls([
                    writeBox(0, -30, 0, 20, 30, 40),
                    writeSlopedToe(150, 200, -20, 20, tipTop, slope),
                ]),
                localTop: (x: number) => tipTop + (200 - x) * slope,
                monotone: false,
            },
        ];
        for (const specimen of cases) {
            const before = binaryStlBounds(specimen.raw);
            const plan = leaderEmbedPlan(specimen.raw);
            const withLeader = applySacrificialLeaderBlock(specimen.raw);
            expect(plan.depthMm, specimen.name).toBe(LEADER_BRIDGE_EMBED_MAX_MM);
            expect(plan.thicknessMm, specimen.name).toBeCloseTo(flatTop, 2);
            expect(plan.padMm, specimen.name).toBe(0);
            const bridgeStart = before.maxX - plan.depthMm;
            const bodyTris = binaryStlTriangleCount(specimen.raw);
            let maxProud = 0;
            for (const yAbs of [0, LEADER_BRIDGE_WIDTH_MM / 2]) {
                const embed = topProfile(withLeader, bodyTris, yAbs).filter(
                    (p) => p.x >= bridgeStart - 1e-3 && p.x <= before.maxX + 1e-3,
                );
                expect(embed.length, `${specimen.name} samples at |y|=${yAbs}`).toBeGreaterThan(2);
                for (let i = 0; i < embed.length; i++) {
                    const p = embed[i];
                    if (!p) continue;
                    const shell = specimen.localTop(p.x);
                    const proud = p.z - shell;
                    maxProud = Math.max(maxProud, proud);
                    expect(proud, `${specimen.name} proud at x=${p.x}`).toBeLessThanOrEqual(0.05);
                    expect(p.z, `${specimen.name} height at x=${p.x}`).toBeCloseTo(
                        Math.min(shell, LEADER_BRIDGE_THICKNESS_MM),
                        2,
                    );
                    const prev = embed[i - 1];
                    if (!prev) continue;
                    const clippedDz =
                        Math.min(specimen.localTop(p.x), LEADER_BRIDGE_THICKNESS_MM) -
                        Math.min(specimen.localTop(prev.x), LEADER_BRIDGE_THICKNESS_MM);
                    expect(
                        Math.abs(p.z - prev.z - clippedDz),
                        `${specimen.name} step from x=${prev.x} to x=${p.x}`,
                    ).toBeLessThanOrEqual(0.05);
                    if (specimen.monotone) {
                        expect(p.z, `${specimen.name} drop at x=${p.x}`).toBeGreaterThanOrEqual(prev.z - 1e-4);
                    }
                }
            }
            expect(maxProud, `${specimen.name} max proud`).toBeLessThanOrEqual(0.05);
            const bridgeTris = LEADER_SUFFIX_TRIANGLE_COUNT - 12;
            expect(facetNormalZ(withLeader, bodyTris), `${specimen.name} bridge normal`).toBeGreaterThan(-0.9);
            expect(
                facetNormalZ(withLeader, bodyTris + bridgeTris),
                `${specimen.name} block normal`,
            ).toBeGreaterThan(-0.9);
            expect(leaderVolume(withLeader, bodyTris, bodyTris + bridgeTris), specimen.name).toBeGreaterThan(0);
            expect(
                leaderVolume(withLeader, bodyTris + bridgeTris, bodyTris + LEADER_SUFFIX_TRIANGLE_COUNT),
                specimen.name,
            ).toBeGreaterThan(0);
            // splitLeader peels this same 80-triangle suffix.
            expect(binaryStlTriangleCount(withLeader) - bodyTris, specimen.name).toBe(80);
            expect(openEdgeCount(withLeader, bodyTris), specimen.name).toBe(0);
            const riseX = before.maxX + LEADER_BRIDGE_RISE_MM;
            const blockFace = before.maxX + LEADER_BRIDGE_LENGTH_MM;
            const overlapEnd = blockFace + LEADER_BRIDGE_BLOCK_OVERLAP_MM;
            expect(maxZNear(withLeader, riseX, 0), `${specimen.name} rise`).toBeCloseTo(3, 2);
            expect(maxZNear(withLeader, overlapEnd, 0), `${specimen.name} overlap`).toBeCloseTo(3, 2);
            expect(blockFace, `${specimen.name} block face inside the 3 mm span`).toBeGreaterThan(riseX);
            expect(blockFace, specimen.name).toBeLessThan(overlapEnd);
        }
    });

    test("the flush blend is appended and the insole vertices stay the input mesh", () => {
        const raw = toeAtMaxX(2.21);
        const n = binaryStlTriangleCount(raw);
        const withLeader = applySacrificialLeaderBlock(raw);
        expect(binaryStlTriangleCount(withLeader)).toBe(n + LEADER_SUFFIX_TRIANGLE_COUNT);
        const before = new DataView(raw);
        const after = new DataView(withLeader);
        for (let t = 0; t < n; t++) {
            const base = 84 + t * 50 + 12;
            for (let b = 0; b < 36; b += 4) {
                expect(after.getFloat32(base + b, true)).toBe(before.getFloat32(base + b, true));
            }
        }
    });

    test("aborts when the max-X end is the thick end", () => {
        const thickToe = writeBox(180, -20, 0, 200, 20, 30);
        const thinHeel = writeBox(0, -10, 0, 12, 10, 3);
        const a = binaryStlTriangleCount(thickToe);
        const b = binaryStlTriangleCount(thinHeel);
        const out = new ArrayBuffer(84 + (a + b) * 50);
        new DataView(out).setUint32(80, a + b, true);
        new Uint8Array(out).set(new Uint8Array(thickToe).subarray(84), 84);
        new Uint8Array(out).set(new Uint8Array(thinHeel).subarray(84), 84 + a * 50);
        expect(() => applySacrificialLeaderBlock(out)).toThrow(LeaderBlockOrientationError);
    });
});
