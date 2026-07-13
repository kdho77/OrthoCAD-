// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Phase 3 validation for two-pointer walk steering (MAX_BOT_RUN + tetra forceTop):
 *   - rim-edge coverage (446 top / 1184 bot advances, each rim edge once)
 *   - tetra-volume distribution + force-fire counts
 *   - SI at depth 0/3/8/15 + live-2963 multi-correction stack
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import { type BufferGeometry, Vector3 } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    BRIDGE_QUAD_MAX_TETRA_VOL_MM3,
    closeGlbInsoleToSolid,
    countHeelBridgeSelfIntersections,
    HEEL_BRIDGE_Y_MAX_MM,
    TWO_POINTER_MAX_BOT_RUN,
    type TwoPointerWalkDiagnostics,
    triTriIntersect,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");
const OUT = "/tmp/phase3-walk-steering.json";

/** Pre-fix diagnosis baselines (heelSI / fan tetra heelMax / allBridgeSI). */
const PRE_FIX = {
    heelSI: { 0: 249, 3: 277, 8: 296, 15: 365 } as Record<number, number>,
    fanTetraHeelMax: { 0: 0.1301, 15: 0.4571 } as Record<number, number>,
    liveAllBridgeSI: 2958,
    liveHeelSI: 366,
    fanMax: 5,
};

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

function tetraVolumeMm3(a: Vector3, b: Vector3, c: Vector3, d: Vector3): number {
    return (
        Math.abs(
            new Vector3()
                .subVectors(b, a)
                .dot(
                    new Vector3().crossVectors(
                        new Vector3().subVectors(c, a),
                        new Vector3().subVectors(d, a),
                    ),
                ),
        ) / 6
    );
}

interface BridgeAnalysis {
    topAdvances: number;
    botAdvances: number;
    otherAdvances: number;
    uniqueTopEdges: number;
    uniqueBotEdges: number;
    topEdgeMaxUse: number;
    botEdgeMaxUse: number;
    heelSI: number;
    allBridgeSI: number;
    fanMax: number;
    fanMean: number;
    fanTetra: { max: number; mean: number; heelMax: number; n: number; p50: number; p95: number };
    openEdges: number;
    nonManifold: number;
    euler: number;
}

function analyzeClosed(solid: BufferGeometry): BridgeAnalysis {
    const topN = (solid.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const index = solid.index!;
    const arr = solid.getAttribute("position")!.array as Float32Array;
    const getV = (vi: number) => new Vector3(arr[vi * 3]!, arr[vi * 3 + 1]!, arr[vi * 3 + 2]!);
    const report = validateManifold(solid);
    const heelSI = countHeelBridgeSelfIntersections(solid, topN);

    type BTri = {
        i: [number, number, number];
        v: [Vector3, Vector3, Vector3];
        adv: "top" | "bot" | "other";
        topVerts: number[];
        botVerts: number[];
        inHeel: boolean;
    };
    const bridge: BTri[] = [];
    const topEdgeUse = new Map<string, number>();
    const botEdgeUse = new Map<string, number>();

    for (let t = 0; t < index.count / 3; t++) {
        const ia = index.getX(t * 3);
        const ib = index.getX(t * 3 + 1);
        const ic = index.getX(t * 3 + 2);
        const verts = [ia, ib, ic];
        const topVerts = verts.filter((v) => v < topN);
        const botVerts = verts.filter((v) => v >= topN);
        if (topVerts.length === 0 || botVerts.length === 0) continue;
        const va = getV(ia);
        const vb = getV(ib);
        const vc = getV(ic);
        const ymin = Math.min(va.y, vb.y, vc.y);
        let adv: "top" | "bot" | "other" = "other";
        if (topVerts.length === 1 && botVerts.length === 2) {
            adv = "bot";
            botEdgeUse.set(
                edgeKey(botVerts[0]!, botVerts[1]!),
                (botEdgeUse.get(edgeKey(botVerts[0]!, botVerts[1]!)) ?? 0) + 1,
            );
        } else if (topVerts.length === 2 && botVerts.length === 1) {
            adv = "top";
            topEdgeUse.set(
                edgeKey(topVerts[0]!, topVerts[1]!),
                (topEdgeUse.get(edgeKey(topVerts[0]!, topVerts[1]!)) ?? 0) + 1,
            );
        }
        bridge.push({
            i: [ia, ib, ic],
            v: [va, vb, vc],
            adv,
            topVerts,
            botVerts,
            inHeel: ymin < HEEL_BRIDGE_Y_MAX_MM,
        });
    }

    let allBridgeSI = 0;
    for (let i = 0; i < bridge.length; i++) {
        for (let j = i + 1; j < bridge.length; j++) {
            if (shares(bridge[i]!.i, bridge[j]!.i)) continue;
            if (triTriIntersect(bridge[i]!.v, bridge[j]!.v)) allBridgeSI++;
        }
    }

    const fans = new Map<number, BTri[]>();
    for (const b of bridge) {
        if (b.adv !== "bot") continue;
        const st = b.topVerts[0]!;
        const list = fans.get(st) ?? [];
        list.push(b);
        fans.set(st, list);
    }
    const fanSizes = [...fans.values()].map((l) => l.length);
    const vols: number[] = [];
    let heelMax = 0;
    for (const [, fan] of fans) {
        if (fan.length < 2) continue;
        for (let k = 0; k < fan.length - 1; k++) {
            const a = fan[k]!;
            const b = fan[k + 1]!;
            const verts = [...new Set([...a.i, ...b.i])];
            if (verts.length < 4) continue;
            const vol = tetraVolumeMm3(getV(verts[0]!), getV(verts[1]!), getV(verts[2]!), getV(verts[3]!));
            vols.push(vol);
            if (a.inHeel && vol > heelMax) heelMax = vol;
        }
    }
    vols.sort((a, b) => a - b);

    return {
        topAdvances: bridge.filter((b) => b.adv === "top").length,
        botAdvances: bridge.filter((b) => b.adv === "bot").length,
        otherAdvances: bridge.filter((b) => b.adv === "other").length,
        uniqueTopEdges: topEdgeUse.size,
        uniqueBotEdges: botEdgeUse.size,
        topEdgeMaxUse: topEdgeUse.size ? Math.max(...topEdgeUse.values()) : 0,
        botEdgeMaxUse: botEdgeUse.size ? Math.max(...botEdgeUse.values()) : 0,
        heelSI,
        allBridgeSI,
        fanMax: fanSizes.length ? Math.max(...fanSizes) : 0,
        fanMean: fanSizes.length
            ? Number((fanSizes.reduce((a, b) => a + b, 0) / fanSizes.length).toFixed(2))
            : 0,
        fanTetra: {
            max: vols.length ? Number(vols[vols.length - 1]!.toFixed(4)) : 0,
            mean: vols.length ? Number((vols.reduce((a, b) => a + b, 0) / vols.length).toFixed(4)) : 0,
            heelMax: Number(heelMax.toFixed(4)),
            n: vols.length,
            p50: vols.length ? Number(vols[Math.floor(vols.length * 0.5)]!.toFixed(4)) : 0,
            p95: vols.length ? Number(vols[Math.floor(vols.length * 0.95)]!.toFixed(4)) : 0,
        },
        openEdges: report.openEdges,
        nonManifold: report.nonManifoldEdges,
        euler: report.eulerCharacteristic,
    };
}

describe("Phase 3 walk-steering validation", () => {
    let base: BufferGeometry;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report: Record<string, any> = {
        PRE_FIX,
        TWO_POINTER_MAX_BOT_RUN,
        BRIDGE_QUAD_MAX_TETRA_VOL_MM3,
    };

    beforeAll(async () => {
        expect(existsSync(FIXTURE)).toBe(true);
        const buf = readFileSync(FIXTURE);
        const group = await loadGlbFromBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        base = extractMergedGeometry(group)!.geometry;
    });

    test("depth sweep + rim coverage + tetra + live combo", () => {
        const configs: Array<{ name: string; patch: Partial<SideCorrections>; depthKey?: number }> = [
            { name: "d0", patch: { heelCupDepthMm: 0 }, depthKey: 0 },
            { name: "d3", patch: { heelCupDepthMm: 3 }, depthKey: 3 },
            { name: "d8", patch: { heelCupDepthMm: 8 }, depthKey: 8 },
            { name: "d15", patch: { heelCupDepthMm: 15 }, depthKey: 15 },
            {
                name: "live2963",
                patch: {
                    heelCupDepthMm: 9,
                    heelCupWidthMm: 5,
                    archHeightMm: 12,
                    apexMoveMm: 5,
                },
            },
            {
                name: "live2963b",
                patch: {
                    heelCupDepthMm: 10,
                    heelCupWidthMm: 5,
                    archHeightMm: 12,
                    apexMoveMm: 5,
                },
            },
        ];

        const rows = [];
        for (const cfg of configs) {
            const mod = applyBaseModifiers(base, field(cfg.patch), 0);
            const solid = closeGlbInsoleToSolid(mod);
            const analysis = analyzeClosed(solid);
            const diag =
                (
                    solid.userData as {
                        twoPointerWalkDiagnostics?: TwoPointerWalkDiagnostics;
                    }
                ).twoPointerWalkDiagnostics ?? null;

            // ADDITION 1 — hard rim-edge coverage gate
            expect(analysis.topAdvances).toBe(446);
            expect(analysis.botAdvances).toBe(1184);
            expect(analysis.otherAdvances).toBe(0);
            expect(analysis.uniqueTopEdges).toBe(446);
            expect(analysis.uniqueBotEdges).toBe(1184);
            expect(analysis.topEdgeMaxUse).toBe(1);
            expect(analysis.botEdgeMaxUse).toBe(1);
            expect(analysis.openEdges).toBe(0);
            expect(analysis.nonManifold).toBe(0);
            expect(analysis.euler).toBe(3);
            expect(analysis.fanMax).toBeLessThanOrEqual(TWO_POINTER_MAX_BOT_RUN);

            rows.push({
                name: cfg.name,
                patch: cfg.patch,
                ...analysis,
                preFixHeelSI: cfg.depthKey !== undefined ? PRE_FIX.heelSI[cfg.depthKey] : null,
                heelSI_reduction:
                    cfg.depthKey !== undefined ? PRE_FIX.heelSI[cfg.depthKey]! - analysis.heelSI : null,
                walkDiag: diag
                    ? {
                          topAdvances: diag.topAdvances,
                          botAdvances: diag.botAdvances,
                          forceTopByRunCap: diag.forceTopByRunCap,
                          forceTopByTetra: diag.forceTopByTetra,
                          maxBotRunSeen: diag.maxBotRunSeen,
                          tetraForceCount: diag.tetraForceVolumesMm3.length,
                          tetraForceMin: diag.tetraForceVolumesMm3.length
                              ? Number(Math.min(...diag.tetraForceVolumesMm3).toFixed(4))
                              : null,
                          tetraForceMax: diag.tetraForceVolumesMm3.length
                              ? Number(Math.max(...diag.tetraForceVolumesMm3).toFixed(4))
                              : null,
                          tetraForceMean: diag.tetraForceVolumesMm3.length
                              ? Number(
                                    (
                                        diag.tetraForceVolumesMm3.reduce((a, b) => a + b, 0) /
                                        diag.tetraForceVolumesMm3.length
                                    ).toFixed(4),
                                )
                              : null,
                      }
                    : null,
            });

            solid.dispose();
            mod.dispose();
        }

        report.rows = rows;
        // ADDITION 2 summary
        report.tetraThresholdAssessment = {
            constant: BRIDGE_QUAD_MAX_TETRA_VOL_MM3,
            note: "forceTopByTetra counts from walkDiag; fanTetra is post-emit distribution",
            perConfig: rows.map((r) => ({
                name: r.name,
                forceTopByTetra: r.walkDiag?.forceTopByTetra ?? null,
                forceTopByRunCap: r.walkDiag?.forceTopByRunCap ?? null,
                fanTetraHeelMax: r.fanTetra.heelMax,
                fanTetraP95: r.fanTetra.p95,
                preFixHeelMax:
                    r.name === "d0"
                        ? PRE_FIX.fanTetraHeelMax[0]
                        : r.name === "d15"
                          ? PRE_FIX.fanTetraHeelMax[15]
                          : null,
            })),
        };
        // ADDITION 3
        const live = rows.find((r) => r.name === "live2963")!;
        const liveB = rows.find((r) => r.name === "live2963b")!;
        report.liveCombo = {
            preFixAllBridgeSI: PRE_FIX.liveAllBridgeSI,
            preFixHeelSI: PRE_FIX.liveHeelSI,
            after_d9: { heelSI: live.heelSI, allBridgeSI: live.allBridgeSI },
            after_d10: { heelSI: liveB.heelSI, allBridgeSI: liveB.allBridgeSI },
            allBridgeReduction_d9: PRE_FIX.liveAllBridgeSI - live.allBridgeSI,
            heelReduction_d9: PRE_FIX.liveHeelSI - live.heelSI,
        };

        writeFileSync(OUT, JSON.stringify(report, null, 2));

        // Meaningful reduction at every depth
        for (const r of rows) {
            if (r.preFixHeelSI != null) {
                expect(r.heelSI).toBeLessThan(r.preFixHeelSI);
            }
        }
        expect(live.allBridgeSI).toBeLessThan(PRE_FIX.liveAllBridgeSI);
    });
});
