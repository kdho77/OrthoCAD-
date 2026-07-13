// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Closed-solid bridge invariants on Default.glb across the heel-cup depth sweep.
 * Originally validated PR #113's walk steering; now validates the min-chord DP
 * bridge (buildMinChordBridgeTriangles) that replaced it on the unequal-rim path:
 *   - rim-edge coverage exact (446 top-edge tris / 1184 bot-edge tris, each edge once)
 *   - allBridgeSI = 0 and heelSI = 0 (complete self-intersection elimination)
 *   - Euler=3 (separate slit-cap residue, unchanged), openEdges=0, nonManifold=0
 * Live multi-correction configs are covered in tests/min-chord-bridge.test.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import { type BufferGeometry, Vector3 } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    closeGlbInsoleToSolid,
    countHeelBridgeSelfIntersections,
    triTriIntersect,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");

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

function shares(a: number[], b: number[]) {
    return a.some((v) => b.includes(v));
}

function edgeKey(a: number, b: number) {
    return a < b ? `${a},${b}` : `${b},${a}`;
}

interface BridgeInvariants {
    bridgeTris: number;
    topEdgeTris: number;
    botEdgeTris: number;
    uniqueTopEdges: number;
    uniqueBotEdges: number;
    heelSI: number;
    allBridgeSI: number;
    openEdges: number;
    nonManifold: number;
    euler: number;
}

function measureBridge(solid: BufferGeometry): BridgeInvariants {
    const topN = (solid.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const index = solid.index!;
    const arr = solid.getAttribute("position")!.array as Float32Array;
    const getV = (vi: number) => new Vector3(arr[vi * 3]!, arr[vi * 3 + 1]!, arr[vi * 3 + 2]!);
    const report = validateManifold(solid);

    type BTri = { i: [number, number, number]; v: [Vector3, Vector3, Vector3] };
    const bridge: BTri[] = [];
    const topEdges = new Map<string, number>();
    const botEdges = new Map<string, number>();
    let topEdgeTris = 0;
    let botEdgeTris = 0;
    for (let t = 0; t < index.count / 3; t++) {
        const ia = index.getX(t * 3);
        const ib = index.getX(t * 3 + 1);
        const ic = index.getX(t * 3 + 2);
        const verts = [ia, ib, ic];
        const tops = verts.filter((v) => v < topN);
        const bots = verts.filter((v) => v >= topN);
        if (tops.length === 0 || bots.length === 0) continue;
        if (tops.length === 2) {
            topEdgeTris++;
            const k = edgeKey(tops[0]!, tops[1]!);
            topEdges.set(k, (topEdges.get(k) ?? 0) + 1);
        }
        if (bots.length === 2) {
            botEdgeTris++;
            const k = edgeKey(bots[0]!, bots[1]!);
            botEdges.set(k, (botEdges.get(k) ?? 0) + 1);
        }
        bridge.push({ i: [ia, ib, ic], v: [getV(ia), getV(ib), getV(ic)] });
    }
    let allBridgeSI = 0;
    for (let i = 0; i < bridge.length; i++) {
        for (let j = i + 1; j < bridge.length; j++) {
            if (shares(bridge[i]!.i, bridge[j]!.i)) continue;
            if (triTriIntersect(bridge[i]!.v, bridge[j]!.v)) allBridgeSI++;
        }
    }
    // Every rim edge consumed exactly once.
    for (const c of topEdges.values()) expect(c).toBe(1);
    for (const c of botEdges.values()) expect(c).toBe(1);

    return {
        bridgeTris: bridge.length,
        topEdgeTris,
        botEdgeTris,
        uniqueTopEdges: topEdges.size,
        uniqueBotEdges: botEdges.size,
        heelSI: countHeelBridgeSelfIntersections(solid, topN),
        allBridgeSI,
        openEdges: report.openEdges,
        nonManifold: report.nonManifoldEdges,
        euler: report.eulerCharacteristic,
    };
}

describe("min-chord DP bridge invariants — depth sweep (Default.glb)", () => {
    let base: BufferGeometry;

    beforeAll(async () => {
        expect(existsSync(FIXTURE)).toBe(true);
        const buf = readFileSync(FIXTURE);
        const group = await loadGlbFromBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        base = extractMergedGeometry(group)!.geometry;
    });

    for (const depthMm of [0, 3, 8, 15] as const) {
        test(`depth=${depthMm}mm: coverage exact, SI=0, manifold`, () => {
            const mod = applyBaseModifiers(base, field({ heelCupDepthMm: depthMm }), 0);
            try {
                const solid = closeGlbInsoleToSolid(mod);
                try {
                    const m = measureBridge(solid);
                    expect(m.bridgeTris).toBe(1630);
                    expect(m.topEdgeTris).toBe(446);
                    expect(m.botEdgeTris).toBe(1184);
                    expect(m.uniqueTopEdges).toBe(446);
                    expect(m.uniqueBotEdges).toBe(1184);
                    expect(m.heelSI).toBe(0);
                    expect(m.allBridgeSI).toBe(0);
                    expect(m.openEdges).toBe(0);
                    expect(m.nonManifold).toBe(0);
                    expect(m.euler).toBe(3);
                } finally {
                    solid.dispose();
                }
            } finally {
                mod.dispose();
            }
        });
    }
});
