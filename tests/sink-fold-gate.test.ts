// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { SINK_KIND_ORDER, SINK_PROFILES } from "@/lib/geometry/sink";
import type { PlacedSink, SinkKind } from "@/types";

/**
 * Stock hybrid crease. The forefoot-width gate uses mesh X 72–77; the same
 * faces continue to 77.1, so the sink gate ignores that strip through 78.
 */
const HYBRID_CREASE_X0 = 72;
const HYBRID_CREASE_X1 = 78;
const EDGE_LIMIT_DEG = 60;

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

type WallStyle = "straight" | "round" | "hybrid";

function loadTop(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function faceNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] | null {
    const ax = pos[a * 3]!;
    const ay = pos[a * 3 + 1]!;
    const az = pos[a * 3 + 2]!;
    const ux = pos[b * 3]! - ax;
    const uy = pos[b * 3 + 1]! - ay;
    const uz = pos[b * 3 + 2]! - az;
    const vx = pos[c * 3]! - ax;
    const vy = pos[c * 3 + 1]! - ay;
    const vz = pos[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return null;
    return [nx / len, ny / len, nz / len];
}

function triArea(pos: Float32Array, idx: ArrayLike<number>, f: number): number {
    const a = idx[f]!;
    const b = idx[f + 1]!;
    const c = idx[f + 2]!;
    const ux = pos[b * 3]! - pos[a * 3]!;
    const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!;
    const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
    const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
}

/** Sharpest two-face edge. Hybrid's existing crease band is reported separately. */
function edgeFold(geo: BufferGeometry, wall: WallStyle): { maxDeg: number; outsideDeg: number } {
    const pos = geo.getAttribute("position").array as Float32Array;
    const idx = geo.getIndex()!.array as Uint32Array | Uint16Array;
    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = p < q ? `${p},${q}` : `${q},${p}`;
            let faces = edgeFaces.get(k);
            if (!faces) {
                faces = [];
                edgeFaces.set(k, faces);
            }
            faces.push(f);
        }
    }
    let maxDeg = 0;
    let outsideDeg = 0;
    for (const [key, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const f1 = faces[0]!;
        const f2 = faces[1]!;
        if (triArea(pos, idx, f1) < 1e-3 || triArea(pos, idx, f2) < 1e-3) continue;
        const [sa, sb] = key.split(",").map(Number) as [number, number];
        const elen = Math.hypot(
            pos[sa * 3]! - pos[sb * 3]!,
            pos[sa * 3 + 1]! - pos[sb * 3 + 1]!,
            pos[sa * 3 + 2]! - pos[sb * 3 + 2]!,
        );
        if (elen < 0.12) continue;
        const n1 = faceNormal(pos, idx[f1]!, idx[f1 + 1]!, idx[f1 + 2]!);
        const n2 = faceNormal(pos, idx[f2]!, idx[f2 + 1]!, idx[f2 + 2]!);
        if (!n1 || !n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        const deg = (Math.acos(dot) * 180) / Math.PI;
        if (deg > maxDeg) maxDeg = deg;
        const x = 0.5 * (pos[sa * 3]! + pos[sb * 3]!);
        const inHybridBand = wall === "hybrid" && x >= HYBRID_CREASE_X0 && x <= HYBRID_CREASE_X1;
        if (!inHybridBand && deg > outsideDeg) outsideDeg = deg;
    }
    return { maxDeg, outsideDeg };
}

function maxSink(kind: SinkKind): PlacedSink {
    return { id: kind, kind, depthMm: SINK_PROFILES[kind].maxDepthMm };
}

describe("sink rim folds stay at or below 60 degrees", () => {
    test("every two-face edge outside Hybrid's crease band, all six sinks at max, all three walls", async () => {
        const raw = await loadTop();
        const rows: Array<{ wall: string; sink: string; maxDeg: number; outsideDeg: number }> = [];
        for (const wall of ["straight", "round", "hybrid"] as const) {
            const plain = await reconstructProceduralPreview(raw, { wallStyle: wall, side: "left" });
            const plainFold = edgeFold(plain.geometry, wall);
            rows.push({
                wall,
                sink: "none",
                maxDeg: Number(plainFold.maxDeg.toFixed(2)),
                outsideDeg: Number(plainFold.outsideDeg.toFixed(2)),
            });
            plain.geometry.dispose();
            expect(plainFold.outsideDeg, `${wall} unsunk`).toBeLessThanOrEqual(EDGE_LIMIT_DEG);

            const cases: Array<{ name: string; sinks: PlacedSink[] }> = [
                ...SINK_KIND_ORDER.map((kind) => ({ name: kind, sinks: [maxSink(kind)] })),
                { name: "all", sinks: SINK_KIND_ORDER.map((kind) => maxSink(kind)) },
            ];
            for (const c of cases) {
                const preview = await reconstructProceduralPreview(raw, {
                    wallStyle: wall,
                    side: "left",
                    sinks: c.sinks,
                });
                const fold = edgeFold(preview.geometry, wall);
                rows.push({
                    wall,
                    sink: c.name,
                    maxDeg: Number(fold.maxDeg.toFixed(2)),
                    outsideDeg: Number(fold.outsideDeg.toFixed(2)),
                });
                preview.geometry.dispose();
                expect(fold.outsideDeg, `${wall} ${c.name}`).toBeLessThanOrEqual(EDGE_LIMIT_DEG);
            }
        }
        console.log("[SINK-FOLD]", JSON.stringify(rows));
        raw.dispose();
    }, 900_000);
});
