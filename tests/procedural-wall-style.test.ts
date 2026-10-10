// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    ACROSS_STATION_MAX_DEG,
    ACROSS_STATION_P99_MAX_DEG,
    countSelfIntersections,
    extractStockWallModel,
    G1_MAX_DEG,
    hybridBulgeAt,
    plantarFlatDeltaMm,
    RING_TURNING_MAX_DEG,
    reconstructionManifold,
    reconstructProceduralWalls,
} from "@/lib/geometry/procedural-wall";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import { encodePng, renderMesh } from "./helpers/render-png";

type Style = "straight" | "round" | "hybrid";

function writeArtifact(relPath: string, data: Buffer | Uint8Array): void {
    const slash = relPath.lastIndexOf("/");
    const sub = slash >= 0 ? relPath.slice(0, slash) : "";
    for (const root of ["/opt/cursor/artifacts", "/tmp/s1-stls"]) {
        try {
            mkdirSync(sub ? `${root}/${sub}` : root, { recursive: true });
            writeFileSync(`${root}/${relPath}`, data);
        } catch {
            /* agent-store can be 0-byte */
        }
    }
}

function topDeltaMm(a: BufferGeometry, b: BufferGeometry): number {
    const n = Math.min(
        (a.userData as { topVertexCount?: number }).topVertexCount ?? 0,
        (b.userData as { topVertexCount?: number }).topVertexCount ?? 0,
    );
    const pa = a.getAttribute("position").array as Float32Array;
    const pb = b.getAttribute("position").array as Float32Array;
    let max = 0;
    for (let i = 0; i < n * 3; i++) max = Math.max(max, Math.abs(pa[i]! - pb[i]!));
    return max;
}

function rimDeltaMm(a: BufferGeometry, b: BufferGeometry): number {
    const ra = (a.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> }).outlineRing ?? [];
    const rb = (b.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> }).outlineRing ?? [];
    const n = Math.min(ra.length, rb.length);
    let max = 0;
    for (let i = 0; i < n; i++) {
        const p = ra[i]!;
        const q = rb[i]!;
        max = Math.max(max, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
    }
    return max;
}

function styleMisses(geo: BufferGeometry, style: Style, straight?: BufferGeometry): string[] {
    const ud = geo.userData as {
        columnQuality?: {
            maxG1EDeg?: number;
            maxG1FDeg?: number;
            maxAcrossDeg?: number;
            maxAcrossP99Deg?: number;
            maxETurningPlanDeg?: number;
            maxFTurningPlanDeg?: number;
            maxETurningDeg?: number;
            maxFTurningDeg?: number;
        };
        wallFrames?: Array<{ u: number; midWeight?: number; overhangMm?: number }>;
        medialYSign?: 1 | -1;
        footLengthMm?: number;
        stationCount?: number;
        generatedStart?: number;
        nRound?: number;
        nLine?: number;
    };
    const q = ud.columnQuality ?? {};
    const misses: string[] = [];
    const g1Cap = style === "straight" ? G1_MAX_DEG : 1;
    if ((q.maxG1EDeg ?? 0) > g1Cap + 1e-6) misses.push(`G1-E ${q.maxG1EDeg?.toFixed(2)}>${g1Cap}`);
    if ((q.maxG1FDeg ?? 0) > g1Cap + 1e-6) misses.push(`G1-F ${q.maxG1FDeg?.toFixed(2)}>${g1Cap}`);
    if ((q.maxAcrossP99Deg ?? 0) > ACROSS_STATION_P99_MAX_DEG + 1e-6) {
        misses.push(`across-p99 ${q.maxAcrossP99Deg?.toFixed(2)}`);
    }
    if ((q.maxAcrossDeg ?? 0) > ACROSS_STATION_MAX_DEG + 0.05) {
        misses.push(`across-p100 ${q.maxAcrossDeg?.toFixed(2)}`);
    }
    const eTurn = q.maxETurningPlanDeg ?? q.maxETurningDeg ?? 0;
    const fTurn = q.maxFTurningPlanDeg ?? q.maxFTurningDeg ?? 0;
    if (eTurn > RING_TURNING_MAX_DEG + 0.01) misses.push(`E-turn ${eTurn.toFixed(2)}`);
    if (fTurn > RING_TURNING_MAX_DEG + 0.01) misses.push(`F-turn ${fTurn.toFixed(2)}`);
    const hits = countSelfIntersections(geo);
    if (hits.real !== 0) misses.push(`SI ${hits.real}`);
    const man = reconstructionManifold(geo);
    if (!man.watertight) misses.push("not-watertight");
    if (man.nonManifoldEdges !== 0) misses.push(`NM ${man.nonManifoldEdges}`);
    if (plantarFlatDeltaMm(geo) > 1e-3) misses.push(`plantar-z ${plantarFlatDeltaMm(geo).toFixed(4)}`);
    if (straight) {
        const top = topDeltaMm(geo, straight);
        if (top > 1e-6) misses.push(`top-vs-straight ${top.toFixed(6)}`);
        const rim = rimDeltaMm(geo, straight);
        if (rim > 1e-3) misses.push(`rim-vs-straight ${rim.toFixed(4)}`);
    }
    const frames = ud.wallFrames ?? [];
    if (style === "hybrid" && frames.length) {
        const heel = frames.filter((f) => f.u <= 0.12);
        const midfoot = frames.filter((f) => f.u >= 0.5 && f.u <= 0.7);
        if (heel.some((f) => hybridBulgeAt(f.u, 1, 250, 0.6) > 1e-6)) {
            misses.push("hybrid heel bulge");
        }
        if (midfoot.length && midfoot.every((f) => hybridBulgeAt(f.u, 1, 250, 0.6) < 0.5)) {
            misses.push("hybrid midfoot not round");
        }
        const us = [0, 0.15, 0.25, 0.35, 0.5, 0.7, 0.9];
        for (let i = 1; i < us.length; i++) {
            if (hybridBulgeAt(us[i]!, 1, 250, 0.6) + 1e-9 < hybridBulgeAt(us[i - 1]!, 1, 250, 0.6)) {
                misses.push("bulge-not-monotone");
            }
        }
    }
    return misses;
}

describe("procedural wall styles", () => {
    test("straight / round / hybrid on Default: gates + STL/PNG", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(raw, { id: "default", name: "Default" });
        const styles: Style[] = ["straight", "round", "hybrid"];
        const geos: Partial<Record<Style, BufferGeometry>> = {};
        for (const style of styles) {
            geos[style] = reconstructProceduralWalls(model, { wallStyle: style });
        }
        const straight = geos.straight!;
        const misses: string[] = [];
        for (const style of styles) {
            const geo = geos[style]!;
            const local = styleMisses(geo, style, style === "straight" ? undefined : straight);
            if (local.length) misses.push(`${style}: ${local.join("; ")}`);
            writeArtifact(`procedural-default-${style}.stl`, Buffer.from(geometryToBinarySTL(geo)));
            const pos = geo.getAttribute("position").array as Float32Array;
            const idx = geo.getIndex()!.array as Uint32Array;
            const views = [
                {
                    name: "side",
                    right: [1, 0, 0] as [number, number, number],
                    up: [0, 0, 1] as [number, number, number],
                    light: [0.3, 0.6, 0.7] as [number, number, number],
                },
                {
                    name: "medial",
                    right: [0, 1, 0] as [number, number, number],
                    up: [0, 0, 1] as [number, number, number],
                    light: [0.6, 0.2, 0.7] as [number, number, number],
                },
            ];
            for (const v of views) {
                const rgb = renderMesh(pos, idx, { right: v.right, up: v.up, light: v.light }, 720, 540);
                writeArtifact(`procedural-default-${style}-${v.name}.png`, encodePng(720, 540, rgb));
            }
        }
        console.log(
            "[S1-WALL-STYLE]",
            JSON.stringify(
                styles.map((s) => {
                    const frames = (geos[s]!.userData.wallFrames ?? []) as Array<{ midWeight?: number }>;
                    const weights = frames.map((f) => f.midWeight ?? 0);
                    return {
                        style: s,
                        g1E: geos[s]!.userData.columnQuality?.maxG1EDeg,
                        g1F: geos[s]!.userData.columnQuality?.maxG1FDeg,
                        across: geos[s]!.userData.columnQuality?.maxAcrossDeg,
                        p99: geos[s]!.userData.columnQuality?.maxAcrossP99Deg,
                        eTurn: geos[s]!.userData.columnQuality?.maxETurningPlanDeg,
                        fTurn: geos[s]!.userData.columnQuality?.maxFTurningPlanDeg,
                        plantar: plantarFlatDeltaMm(geos[s]!),
                        topVsStraight: s === "straight" ? 0 : topDeltaMm(geos[s]!, straight),
                        midWmax: weights.length ? Math.max(...weights) : 0,
                        midWmean: weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 0,
                    };
                }),
            ),
        );
        if (misses.length) throw new Error(`[S1-STYLE] ${misses.join(" | ")}`);
        for (const g of Object.values(geos)) g?.dispose();
        raw.dispose();
    }, 180_000);
});
