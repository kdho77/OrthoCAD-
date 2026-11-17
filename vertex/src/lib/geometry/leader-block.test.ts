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
    LEADER_BRIDGE_EMBED_MM,
    LEADER_BRIDGE_LENGTH_MM,
    LEADER_BRIDGE_THICKNESS_MM,
    LeaderBlockOrientationError,
    manufacturingStlForExportKind,
    manufacturingStlIncludesLeaderBlock,
} from "./leader-block";

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

/** Tip at x=220; bottom outline at y=±5 sits at x=200. */
function curvedToe(): ArrayBuffer {
    const heel = writeBox(0, -20, 0, 15, 20, 30);
    const beak = writeTriangles([
        [200, -5, 0],
        [200, 5, 0],
        [220, 0, 0],
        [200, -5, 0],
        [220, 0, 3],
        [200, 5, 0],
        [200, -5, 2],
        [220, 0, 3],
        [200, 5, 2],
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

/** Thick heel at min X, thin toe at max X. */
function toeAtMaxX(): ArrayBuffer {
    const heel = writeBox(0, -30, 0, 10, 30, 24);
    const toe = writeBox(180, -15, 0, 200, 15, 4);
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

    test("founder-locked constants (Kendon 2026-11-06)", () => {
        expect(LEADER_BLOCK_DEPTH_MM).toBe(20);
        expect(LEADER_BLOCK_HEIGHT_MM).toBe(10);
        expect(LEADER_BRIDGE_THICKNESS_MM).toBe(1.5);
        expect(LEADER_BRIDGE_LENGTH_MM).toBe(1);
        expect(LEADER_BRIDGE_EMBED_MM).toBe(1);
        expect(LEADER_BRIDGE_BLOCK_OVERLAP_MM).toBe(1);
        expect(LEADER_BLOCK_WIDTH_INNER_MM).toBe(20);
        expect(LEADER_BLOCK_WIDTH_OUTER_MM).toBe(30);
    });

    test("places the bridge and trapezoid on the thinner max-X toe", () => {
        const raw = toeAtMaxX();
        const before = binaryStlBounds(raw);
        const withLeader = applySacrificialLeaderBlock(raw);
        const after = binaryStlBounds(withLeader);
        // Flat toe: outline at yc±5 is xmax. Block starts after the 1 mm neck and is 20 mm deep.
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
        const bridgeStart = before.maxX - LEADER_BRIDGE_EMBED_MM;
        const embedded = verticesNear(withLeader, bridgeStart);
        expect(embedded.some((v) => Math.abs(v[2] - LEADER_BRIDGE_THICKNESS_MM) < 1e-4)).toBe(true);
        const overlapEnd = blockX0 + LEADER_BRIDGE_BLOCK_OVERLAP_MM;
        const overlap = verticesNear(withLeader, overlapEnd);
        expect(overlap.some((v) => Math.abs(v[2] - LEADER_BRIDGE_THICKNESS_MM) < 1e-4)).toBe(true);
        const blockNear = verticesNear(withLeader, blockX0);
        expect(blockNear.some((v) => Math.abs(v[1] - LEADER_BLOCK_WIDTH_INNER_MM / 2) < 0.01)).toBe(true);
        expect(binaryStlTriangleCount(withLeader)).toBe(binaryStlTriangleCount(raw) + 24);
    });

    test("curved toe starts the bridge at the inset outline, not at xmax - 1", () => {
        const raw = curvedToe();
        const before = binaryStlBounds(raw);
        expect(before.maxX).toBeCloseTo(220, 3);
        const withLeader = applySacrificialLeaderBlock(raw);
        const xEdge = 200;
        const bridgeStart = xEdge - LEADER_BRIDGE_EMBED_MM;
        const tipStart = before.maxX - LEADER_BRIDGE_EMBED_MM;
        expect(bridgeStart).toBeLessThan(tipStart);
        const embedded = verticesNear(withLeader, bridgeStart);
        expect(embedded.some((v) => Math.abs(v[2] - LEADER_BRIDGE_THICKNESS_MM) < 1e-4)).toBe(true);
        expect(verticesNear(withLeader, tipStart).some((v) => Math.abs(v[2] - 1.5) < 1e-4)).toBe(false);
        const blockX0 = before.maxX + LEADER_BRIDGE_LENGTH_MM;
        const overlapEnd = blockX0 + LEADER_BRIDGE_BLOCK_OVERLAP_MM;
        expect(binaryStlBounds(withLeader).maxX).toBeCloseTo(blockX0 + LEADER_BLOCK_DEPTH_MM, 3);
        expect(verticesNear(withLeader, overlapEnd).length).toBeGreaterThan(0);
        expect(verticesNear(withLeader, blockX0).length).toBeGreaterThan(0);
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
