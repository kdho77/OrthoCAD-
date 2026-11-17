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
    LEADER_BRIDGE_EMBED_PAD_SPAN_MM,
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
        expect(LEADER_BRIDGE_EMBED_PAD_SPAN_MM).toBe(2);
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
        expect(plan.padMm).toBeGreaterThan(0);
        const bridgeStart = before.maxX - plan.depthMm;
        const embedded = verticesNear(withLeader, bridgeStart);
        expect(embedded.some((v) => Math.abs(v[2] - LEADER_BRIDGE_THICKNESS_MM) < 1e-4)).toBe(true);
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

    test("a toe that stays under 3 mm caps the embed at 12 mm and pads only the deep 2 mm", () => {
        const topZ = 1.2;
        const raw = toeAtMaxX(topZ);
        const before = binaryStlBounds(raw);
        const plan = leaderEmbedPlan(raw);
        const withLeader = applySacrificialLeaderBlock(raw);
        expect(plan.depthMm).toBe(LEADER_BRIDGE_EMBED_MAX_MM);
        expect(plan.thicknessMm).toBeCloseTo(topZ, 3);
        expect(plan.padMm).toBeCloseTo(LEADER_BRIDGE_THICKNESS_MM - topZ, 3);
        const bridgeStart = before.maxX - plan.depthMm;
        const padEnd = bridgeStart + LEADER_BRIDGE_EMBED_PAD_SPAN_MM;
        const dropX = padEnd + LEADER_BRIDGE_EMBED_STEP_MM;
        const riseX = before.maxX + LEADER_BRIDGE_RISE_MM;
        const overlapEnd = before.maxX + LEADER_BRIDGE_LENGTH_MM + LEADER_BRIDGE_BLOCK_OVERLAP_MM;
        for (const x of [bridgeStart, padEnd]) {
            const row = verticesNear(withLeader, x);
            expect(
                row.some((v) => Math.abs(v[2]) < 1e-4),
                `bottom at x=${x}`,
            ).toBe(true);
            expect(maxZNear(withLeader, x, LEADER_BRIDGE_WIDTH_MM / 2), `pad height at x=${x}`).toBeCloseTo(
                LEADER_BRIDGE_THICKNESS_MM,
                3,
            );
            const width = Math.max(...row.map((v) => v[1])) - Math.min(...row.map((v) => v[1]));
            expect(width, `width at x=${x}`).toBeCloseTo(LEADER_BRIDGE_WIDTH_MM, 2);
        }
        for (const x of [dropX, before.maxX]) {
            const tops = verticesNear(withLeader, x).filter(
                (v) => Math.abs(v[1]) <= LEADER_BRIDGE_WIDTH_MM / 2 + 0.02 && v[2] > 0.01,
            );
            expect(tops.length, `tops at x=${x}`).toBeGreaterThan(0);
            for (const v of tops)
                expect(v[2], `pad past the deep end at x=${x}`).toBeLessThanOrEqual(topZ + 1e-3);
            expect(Math.max(...tops.map((v) => v[2])), `clipped height at x=${x}`).toBeCloseTo(topZ, 3);
            expect(
                verticesNear(withLeader, x).some((v) => Math.abs(v[2]) < 1e-4),
                `bottom at x=${x}`,
            ).toBe(true);
        }
        expect(maxZNear(withLeader, riseX, LEADER_BRIDGE_WIDTH_MM / 2)).toBeCloseTo(
            LEADER_BRIDGE_THICKNESS_MM,
            3,
        );
        expect(maxZNear(withLeader, overlapEnd, LEADER_BRIDGE_WIDTH_MM / 2)).toBeCloseTo(
            LEADER_BRIDGE_THICKNESS_MM,
            3,
        );
        expect(openEdgeCount(withLeader, binaryStlTriangleCount(raw))).toBe(0);
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
