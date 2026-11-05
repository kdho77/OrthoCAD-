// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    applySacrificialLeaderBlock,
    binaryStlBounds,
    binaryStlTriangleCount,
    LEADER_BLOCK_DEPTH_MM,
    LEADER_BLOCK_HEIGHT_MM,
    LEADER_BLOCK_WIDTH_OUTER_MM,
    LEADER_BRIDGE_EMBED_MM,
    LEADER_BRIDGE_LENGTH_MM,
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

    test("places the bridge and trapezoid on the thinner max-X toe", () => {
        const raw = toeAtMaxX();
        const before = binaryStlBounds(raw);
        const withLeader = applySacrificialLeaderBlock(raw);
        const after = binaryStlBounds(withLeader);
        const expectedMaxX =
            before.maxX - LEADER_BRIDGE_EMBED_MM + LEADER_BRIDGE_LENGTH_MM + LEADER_BLOCK_DEPTH_MM;
        expect(after.maxX).toBeCloseTo(expectedMaxX, 3);
        expect(after.maxZ).toBeCloseTo(Math.max(before.maxZ, LEADER_BLOCK_HEIGHT_MM), 3);
        expect(after.minZ).toBeCloseTo(0, 3);
        const outer = verticesNear(withLeader, expectedMaxX);
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
        expect(embedded.some((v) => v[2] === 2)).toBe(true);
        expect(binaryStlTriangleCount(withLeader)).toBe(binaryStlTriangleCount(raw) + 24);
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
