// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import {
    appendLeaderBlock,
    readBinaryStl,
    stlBounds,
    stlForBeltGcodeExport,
    writeBinaryStl,
} from "@/lib/geometry/leader-block";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { geometryToBinarySTL } from "@/lib/geometry/stl";

function wedgeStl(heelH: number, toeH: number): ArrayBuffer {
    const length = 220;
    const halfW = 40;
    const nx = 40;
    const ny = 16;
    const positions: number[] = [];
    const grid: number[][] = [];
    let vIndex = 0;
    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const row: number[] = [];
        for (let j = 0; j <= ny; j++) {
            const y = ((j / ny) * 2 - 1) * halfW;
            positions.push(u * length, y, heelH * (1 - u) + toeH * u);
            row.push(vIndex++);
        }
        grid.push(row);
    }
    const bottom: number[][] = [];
    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const row: number[] = [];
        for (let j = 0; j <= ny; j++) {
            const y = ((j / ny) * 2 - 1) * halfW;
            positions.push(u * length, y, 0);
            row.push(vIndex++);
        }
        bottom.push(row);
    }
    const indices: number[] = [];
    const quad = (a: number, b: number, c: number, d: number) => {
        indices.push(a, b, c, a, c, d);
    };
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            const top = grid[i];
            const topNext = grid[i + 1];
            const bot = bottom[i];
            const botNext = bottom[i + 1];
            if (!top || !topNext || !bot || !botNext) continue;
            quad(top[j] ?? 0, top[j + 1] ?? 0, topNext[j + 1] ?? 0, topNext[j] ?? 0);
            quad(bot[j] ?? 0, botNext[j] ?? 0, botNext[j + 1] ?? 0, bot[j + 1] ?? 0);
        }
    }
    for (let i = 0; i < nx; i++) {
        const top = grid[i];
        const topNext = grid[i + 1];
        const bot = bottom[i];
        const botNext = bottom[i + 1];
        if (!top || !topNext || !bot || !botNext) continue;
        quad(top[0] ?? 0, topNext[0] ?? 0, botNext[0] ?? 0, bot[0] ?? 0);
        quad(top[ny] ?? 0, bot[ny] ?? 0, botNext[ny] ?? 0, topNext[ny] ?? 0);
    }
    for (let j = 0; j < ny; j++) {
        const heelTop = grid[0];
        const toeTop = grid[nx];
        const heelBot = bottom[0];
        const toeBot = bottom[nx];
        if (!heelTop || !toeTop || !heelBot || !toeBot) continue;
        quad(heelTop[j] ?? 0, heelBot[j] ?? 0, heelBot[j + 1] ?? 0, heelTop[j + 1] ?? 0);
        quad(toeTop[j] ?? 0, toeTop[j + 1] ?? 0, toeBot[j + 1] ?? 0, toeBot[j] ?? 0);
    }
    const tris = [];
    for (let t = 0; t < indices.length; t += 3) {
        const tri = [];
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
    return writeBinaryStl(tris);
}

function toeMidpoint(tris: ReturnType<typeof readBinaryStl>): { x0: number; yc: number } {
    let zmin = Infinity;
    for (const tri of tris) {
        for (const v of tri) if (v.z < zmin) zmin = v.z;
    }
    let xmax = -Infinity;
    for (const tri of tris) {
        for (const v of tri) if (v.x > xmax) xmax = v.x;
    }
    const tipYs: number[] = [];
    for (const tri of tris) {
        for (const v of tri) {
            if (v.x > xmax - 10 && v.z - zmin < 1) tipYs.push(v.y);
        }
    }
    return { x0: xmax, yc: (Math.min(...tipYs) + Math.max(...tipYs)) / 2 };
}

describe("belt export leader block", () => {
    test("toggle off omits the leader", async () => {
        const viewer = wedgeStl(16, 3);
        const exported = await stlForBeltGcodeExport(viewer, { addLeaderBlock: false });
        expect(exported).toBe(viewer);
        expect(stlBounds(readBinaryStl(exported))).toEqual(stlBounds(readBinaryStl(viewer)));
    });

    test("throws when the max-X end is not the low toe", async () => {
        await expect(appendLeaderBlock(wedgeStl(3, 16))).rejects.toThrow(/thinner \(toe\) end/);
    });

    test("approved leader on a toe-thin solid is one body past the toe", async () => {
        const viewer = wedgeStl(16, 3);
        const frame = toeMidpoint(readBinaryStl(viewer));
        const out = readBinaryStl(await appendLeaderBlock(viewer));
        expectLeader(out, frame);
    });

    test("stock procedural default round insole gets the approved leader", async () => {
        const buf = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
        const geo = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const preview = await reconstructProceduralPreview(geo, { wallStyle: "round" });
        geo.dispose();
        const viewer = geometryToBinarySTL(preview.geometry);
        preview.geometry.dispose();
        const frame = toeMidpoint(readBinaryStl(viewer));
        const out = readBinaryStl(await appendLeaderBlock(viewer));
        expectLeader(out, frame);
    }, 240_000);
});

function expectLeader(tris: ReturnType<typeof readBinaryStl>, frame: { x0: number; yc: number }): void {
    const bounds = stlBounds(tris);
    expect(bounds.maxX).toBeCloseTo(frame.x0 + 22.5, 2);
    const leader = tris.flat().filter((v) => v.x > frame.x0 + 0.05);
    expect(leader.length).toBeGreaterThan(0);
    const zs = leader.map((v) => v.z);
    const ys = leader.map((v) => v.y);
    expect(Math.min(...zs)).toBeCloseTo(0, 2);
    expect(Math.max(...zs)).toBeCloseTo(10, 2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20, 2);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(frame.yc, 2);
}
