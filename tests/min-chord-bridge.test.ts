// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * buildMinChordBridgeTriangles — unit tests on synthetic loops plus
 * live multi-correction integration on Default.glb.
 *
 * The DP emits a monotone staircase: exactly n+m triangles, every top rim
 * edge in exactly one 2-top-vert triangle, every bot rim edge in exactly one
 * 2-bot-vert triangle, and (measured invariant on all tested geometry) zero
 * bridge self-intersections.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import { type BufferGeometry, Vector3 } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    buildMinChordBridgeTriangles,
    closeGlbInsoleToSolid,
    countHeelBridgeSelfIntersections,
    triTriIntersect,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");

function makeCircleLoop(count: number, radius: number, z: number, jitterZ = 0): Vector3[] {
    const loop: Vector3[] = [];
    for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 2;
        const zz = jitterZ > 0 && i % 2 === 1 ? z + jitterZ : z;
        loop.push(new Vector3(Math.cos(t) * radius, Math.sin(t) * radius, zz));
    }
    return loop;
}

interface SyntheticBridge {
    tris: number[];
    positions: number[];
    topIdx: number[];
    botIdx: number[];
}

function bridgeLoops(top: Vector3[], bot: Vector3[]): SyntheticBridge {
    const positions: number[] = [];
    const push = (v: Vector3) => {
        const i = positions.length / 3;
        positions.push(v.x, v.y, v.z);
        return i;
    };
    const topIdx = top.map(push);
    const botIdx = bot.map(push);
    const centroid = new Vector3();
    for (const p of [...top, ...bot]) centroid.add(p);
    centroid.multiplyScalar(1 / (top.length + bot.length));
    const getPosition = (vi: number) =>
        new Vector3(positions[vi * 3]!, positions[vi * 3 + 1]!, positions[vi * 3 + 2]!);
    const tris = buildMinChordBridgeTriangles(top, topIdx, bot, botIdx, getPosition, centroid);
    return { tris, positions, topIdx, botIdx };
}

function edgeKey(a: number, b: number) {
    return a < b ? `${a},${b}` : `${b},${a}`;
}

/** Assert staircase coverage: every rim edge in exactly one bridge tri. */
function assertCoverage(b: SyntheticBridge, topLen: number, botLen: number): void {
    expect(b.tris.length % 3).toBe(0);
    expect(b.tris.length / 3).toBe(topLen + botLen);
    const topSet = new Set(b.topIdx);
    const topEdges = new Map<string, number>();
    const botEdges = new Map<string, number>();
    for (let t = 0; t < b.tris.length; t += 3) {
        const verts = [b.tris[t]!, b.tris[t + 1]!, b.tris[t + 2]!];
        const tops = verts.filter((v) => topSet.has(v));
        const bots = verts.filter((v) => !topSet.has(v));
        expect(tops.length + bots.length).toBe(3);
        if (tops.length === 2) {
            const k = edgeKey(tops[0]!, tops[1]!);
            topEdges.set(k, (topEdges.get(k) ?? 0) + 1);
        } else {
            expect(bots.length).toBe(2);
            const k = edgeKey(bots[0]!, bots[1]!);
            botEdges.set(k, (botEdges.get(k) ?? 0) + 1);
        }
    }
    expect(topEdges.size).toBe(topLen);
    expect(botEdges.size).toBe(botLen);
    for (const c of topEdges.values()) expect(c).toBe(1);
    for (const c of botEdges.values()) expect(c).toBe(1);
}

function countBridgeSI(b: SyntheticBridge): number {
    const getV = (vi: number) =>
        new Vector3(b.positions[vi * 3]!, b.positions[vi * 3 + 1]!, b.positions[vi * 3 + 2]!);
    type T = { i: [number, number, number]; v: [Vector3, Vector3, Vector3] };
    const tris: T[] = [];
    for (let t = 0; t < b.tris.length; t += 3) {
        const i: [number, number, number] = [b.tris[t]!, b.tris[t + 1]!, b.tris[t + 2]!];
        tris.push({ i, v: [getV(i[0]), getV(i[1]), getV(i[2])] });
    }
    let count = 0;
    for (let i = 0; i < tris.length; i++) {
        for (let j = i + 1; j < tris.length; j++) {
            if (tris[i]!.i.some((v) => tris[j]!.i.includes(v))) continue;
            if (triTriIntersect(tris[i]!.v, tris[j]!.v)) count++;
        }
    }
    return count;
}

describe("buildMinChordBridgeTriangles — synthetic loops", () => {
    test("4:8 unequal circles: staircase coverage + zero SI", () => {
        const top = makeCircleLoop(4, 10, 5);
        const bot = makeCircleLoop(8, 10, 0);
        const b = bridgeLoops(top, bot);
        assertCoverage(b, 4, 8);
        expect(countBridgeSI(b)).toBe(0);
    });

    test("8:8 equal circles: staircase coverage + zero SI", () => {
        const top = makeCircleLoop(8, 10, 5);
        const bot = makeCircleLoop(8, 10, 0);
        const b = bridgeLoops(top, bot);
        assertCoverage(b, 8, 8);
        expect(countBridgeSI(b)).toBe(0);
    });

    test("6:16 with jagged-Z bottom (mixed plantar/wall analogue): coverage + zero SI", () => {
        const top = makeCircleLoop(6, 10, 8);
        const bot = makeCircleLoop(16, 11, 0, 3); // alternating z=0 / z=3 zigzag
        const b = bridgeLoops(top, bot);
        assertCoverage(b, 6, 16);
        expect(countBridgeSI(b)).toBe(0);
    });

    test("degenerate inputs return empty", () => {
        const top = makeCircleLoop(2, 10, 5);
        const bot = makeCircleLoop(8, 10, 0);
        const positions: number[] = [];
        const push = (v: Vector3) => {
            const i = positions.length / 3;
            positions.push(v.x, v.y, v.z);
            return i;
        };
        const topIdx = top.map(push);
        const botIdx = bot.map(push);
        const getPosition = (vi: number) =>
            new Vector3(positions[vi * 3]!, positions[vi * 3 + 1]!, positions[vi * 3 + 2]!);
        expect(buildMinChordBridgeTriangles(top, topIdx, bot, botIdx, getPosition, new Vector3())).toEqual(
            [],
        );
    });
});

describe("min-chord bridge — live multi-correction (Default.glb)", () => {
    let base: BufferGeometry;

    function neu(): SideCorrections {
        return {
            forefootPostingDeg: 0,
            rearfootPostingDeg: 0,
            medialSkiveMm: 0,
            lateralSkiveMm: 0,
            archFillMm: 0,
            archHeightMm: 0,
            heelCupDepthMm: 0,
            heelCupHeightMm: 0,
            heelCupWidthMm: 0,
            heelLiftMm: 0,
            apexMoveMm: 0,
            medialFlangeMm: 0,
            lateralFlangeMm: 0,
        };
    }

    function field(patch: Partial<SideCorrections>): HeightFieldParams {
        return {
            side: "right",
            lengthMm: 266,
            widthMm: 95,
            thicknessMm: 3,
            corrections: { ...neu(), ...patch },
            elements: [],
            includeSkives: true,
            includeElements: true,
            trimline: null,
        };
    }

    beforeAll(async () => {
        expect(existsSync(FIXTURE)).toBe(true);
        const buf = readFileSync(FIXTURE);
        const group = await loadGlbFromBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        base = extractMergedGeometry(group)!.geometry;
    });

    for (const cfg of [
        {
            name: "live d9 (w5,a12,apex5)",
            patch: { heelCupDepthMm: 9, heelCupWidthMm: 5, archHeightMm: 12, apexMoveMm: 5 },
        },
        {
            name: "live d10 (w5,a12,apex5)",
            patch: { heelCupDepthMm: 10, heelCupWidthMm: 5, archHeightMm: 12, apexMoveMm: 5 },
        },
    ]) {
        test(`${cfg.name}: heelSI=0, manifold, Euler=3`, () => {
            const mod = applyBaseModifiers(base, field(cfg.patch), 0);
            try {
                const solid = closeGlbInsoleToSolid(mod);
                try {
                    const topN = (solid.userData as { topVertexCount?: number }).topVertexCount ?? 0;
                    const report = validateManifold(solid);
                    expect(report.openEdges).toBe(0);
                    expect(report.nonManifoldEdges).toBe(0);
                    expect(report.eulerCharacteristic).toBe(3);
                    expect(countHeelBridgeSelfIntersections(solid, topN)).toBe(0);
                } finally {
                    solid.dispose();
                }
            } finally {
                mod.dispose();
            }
        });
    }
});
