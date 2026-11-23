import { describe, expect, test } from "@rstest/core";
import {
    applyAnalyticSinkToLoftedSolid,
    footOutlineFromPositions,
    meshYToAnatomical,
    sinkCutMm,
    sinkFrame,
} from "@/lib/geometry/sink";
import type { PlacedSink, SinkKind } from "@/types";

/**
 * Flat 3 mm shell: top sheet at z = 3, plantar at z = 0.
 * A depthMm 2 sink must leave a 1 mm floor under the plateau.
 */
function uniformShell(length = 270, width = 100) {
    const nx = 90;
    const ny = 40;
    const positions: number[] = [];
    const indexOf = (ix: number, iy: number) => iy * nx + ix;
    for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
            const x = (ix / (nx - 1)) * length;
            const y = -width / 2 + (iy / (ny - 1)) * width;
            positions.push(x, y, 3);
        }
    }
    const rim: number[] = [];
    for (let ix = 0; ix < nx; ix++) rim.push(indexOf(ix, 0));
    for (let iy = 1; iy < ny; iy++) rim.push(indexOf(nx - 1, iy));
    for (let ix = nx - 2; ix >= 0; ix--) rim.push(indexOf(ix, ny - 1));
    for (let iy = ny - 2; iy >= 1; iy--) rim.push(indexOf(0, iy));
    const nS = rim.length;
    const nJ = 4;
    const topCount = positions.length / 3;
    for (let row = 1; row < nJ; row++) {
        const t = row / (nJ - 1);
        for (let s = 0; s < nS; s++) {
            const vi = rim[s]!;
            positions.push(positions[vi * 3]!, positions[vi * 3 + 1]!, row === nJ - 1 ? 0 : 3 * (1 - t));
        }
    }
    const vertAt = (row: number, station: number) => {
        const s = ((station % nS) + nS) % nS;
        if (row <= 0) return rim[s]!;
        return topCount + (row - 1) * nS + s;
    };
    return {
        positions,
        topCount,
        nS,
        nJ,
        vertAt,
        bounds: { minX: 0, maxX: length, minY: -width / 2, maxY: width / 2 },
    };
}

function floorSamples(
    positions: number[],
    topCount: number,
    sink: PlacedSink,
    radius: number,
): number[] {
    const outline = footOutlineFromPositions(positions, topCount);
    const ctx = {
        side: "left" as const,
        lengthMm: 270,
        widthMm: 100,
        sinks: [sink],
        medialYSign: -1 as const,
        footOutline: outline,
    };
    const frame = sinkFrame(sink, ctx);
    if (!frame) return [];
    const zs: number[] = [];
    for (let i = 0; i < topCount; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        if (Math.hypot(x - frame.dx, y - frame.dy) > radius) continue;
        const cut = sinkCutMm(x, meshYToAnatomical(y, "left", -1), ctx);
        if (cut.weight < 0.98) continue;
        zs.push(positions[i * 3 + 2]!);
    }
    zs.sort((a, b) => a - b);
    return zs;
}

function median(sorted: number[]): number {
    return sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.NaN;
}

describe("uniform 3 mm shell sink floor", () => {
    test("mpj5 and mpj1 at depth 2 leave a 1 mm floor", () => {
        const sinks: PlacedSink[] = [
            { id: "mpj5", kind: "mpj5" as SinkKind, depthMm: 2 },
            { id: "mpj1", kind: "mpj1" as SinkKind, depthMm: 2 },
        ];
        for (const sink of sinks) {
            const shell = uniformShell();
            applyAnalyticSinkToLoftedSolid({
                positions: shell.positions,
                topCount: shell.topCount,
                nS: shell.nS,
                nJ: shell.nJ,
                vertAt: shell.vertAt,
                bounds: shell.bounds,
                medialYSign: -1,
                side: "left",
                sinks: [sink],
            });
            const zs = floorSamples(shell.positions, shell.topCount, sink, 4);
            expect(zs.length).toBeGreaterThan(3);
            expect(zs[0]).toBeGreaterThan(0.85);
            expect(zs[0]).toBeLessThan(1.15);
            const mid = median(zs);
            expect(mid).toBeGreaterThan(0.85);
            expect(mid).toBeLessThan(1.15);
            // The plateau of a flat 3 mm shell drops by the configured depth.
            for (const z of zs) expect(3 - z).toBeLessThan(2.15);
        }
    });

    test("a wall under the plateau keeps 1 mm of material", () => {
        const sink: PlacedSink = { id: "mpj5", kind: "mpj5", depthMm: 2 };
        const shell = uniformShell();
        const outline = footOutlineFromPositions(shell.positions, shell.topCount);
        const ctx = {
            side: "left" as const,
            lengthMm: 270,
            widthMm: 100,
            sinks: [sink],
            medialYSign: -1 as const,
            footOutline: outline,
        };
        const frame = sinkFrame(sink, ctx)!;
        const shelfZ = 0.6;
        const base = shell.positions.length / 3;
        const s0 = [frame.dx - 8, frame.dy - 8, shelfZ];
        const s1 = [frame.dx + 8, frame.dy - 8, shelfZ];
        const s2 = [frame.dx - 8, frame.dy + 8, shelfZ];
        const s3 = [frame.dx + 8, frame.dy + 8, shelfZ];
        shell.positions.push(...s0, ...s1, ...s2, ...s3);
        const shelf = [base, base + 1, base + 2, base + 3];
        const oldN = shell.nJ;
        const prev = shell.vertAt;
        shell.nJ = oldN + 2;
        shell.vertAt = (row: number, station: number) => {
            if (row < oldN) return prev(row, station);
            const s = ((station % shell.nS) + shell.nS) % shell.nS;
            const which = row === oldN ? s : s + 2;
            if (which === 0) return shelf[0]!;
            if (which === 1) return shelf[1]!;
            if (which === 2) return shelf[2]!;
            if (which === 3) return shelf[3]!;
            return shelf[2]!;
        };
        applyAnalyticSinkToLoftedSolid({
            positions: shell.positions,
            topCount: shell.topCount,
            nS: shell.nS,
            nJ: shell.nJ,
            vertAt: shell.vertAt,
            bounds: shell.bounds,
            medialYSign: -1,
            side: "left",
            sinks: [sink],
        });
        const zs = floorSamples(shell.positions, shell.topCount, sink, 5);
        expect(zs.length).toBeGreaterThan(1);
        // 0.6 mm wall + 1.0 mm floor. The full 2 mm cut would have left 1.0 mm
        // and only 0.4 mm of material.
        expect(zs[0]).toBeGreaterThan(1.45);
        expect(zs[0]).toBeLessThan(1.75);
        const mid = median(zs);
        expect(mid).toBeGreaterThan(1.45);
        expect(mid).toBeLessThan(1.75);
    });
});
