// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { sinkFootprintPose } from "@/components/viewer/element-footprints";
import { detectArchSideSign } from "@/lib/geometry/base-modifier";
import { medialSign } from "@/lib/geometry/handedness";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { applySinkCutToGeometry, type SinkOutlinePoint, sinkFrame } from "@/lib/geometry/sink";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedSink, SinkKind } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function placed(kind: SinkKind, id = kind): PlacedSink {
    return { id, kind, depthMm: kind === "mpj1" ? 4 : 2 };
}

/** Mesh-Y rectangle. `medialY` is the big-toe edge for this foot. */
function meshRect(lengthMm: number, medialY: number, lateralY: number): SinkOutlinePoint[] {
    const n = 8;
    const pts: SinkOutlinePoint[] = [];
    for (let i = 0; i < n; i++) pts.push({ x: (lengthMm * i) / (n - 1), y: medialY });
    for (let i = n - 1; i >= 0; i--) pts.push({ x: (lengthMm * i) / (n - 1), y: lateralY });
    return pts;
}

function yExtent(geometry: BufferGeometry): { minY: number; maxY: number; centerY: number } {
    const pos = geometry.getAttribute("position");
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return { minY, maxY, centerY: (minY + maxY) / 2 };
}

describe("medialSign", () => {
    test("left stock is −Y medial and the mirrored right is +Y medial", () => {
        expect(medialSign("left")).toBe(-1);
        expect(medialSign("right")).toBe(1);
    });

    test("MPJ1 and the reverse kinetic wedge sit on the medial side of both feet", () => {
        const lengthMm = 260;
        for (const side of ["left", "right"] as const) {
            const sign = medialSign(side);
            const medialY = sign * 36;
            const lateralY = -sign * 52;
            const outline = meshRect(lengthMm, medialY, lateralY);
            for (const kind of ["mpj1", "rkw"] as const) {
                const pose = sinkFootprintPose(placed(kind), side, lengthMm, 95, outline);
                if (!pose) throw new Error(`${kind} footprint missing`);
                expect(Math.abs(pose.y - medialY)).toBeLessThan(Math.abs(pose.y - lateralY));
                expect((pose.y - (medialY + lateralY) / 2) * sign).toBeGreaterThan(0);
            }
            for (const kind of ["mpj5", "styloid"] as const) {
                const pose = sinkFootprintPose(placed(kind), side, lengthMm, 95, outline);
                if (!pose) throw new Error(`${kind} footprint missing`);
                expect(Math.abs(pose.y - lateralY)).toBeLessThan(Math.abs(pose.y - medialY));
                expect((pose.y - (medialY + lateralY) / 2) * sign).toBeLessThan(0);
            }

            const grid = new BufferGeometry();
            const positions: number[] = [];
            for (let i = 0; i < 48; i++) {
                for (let j = 0; j < 21; j++) {
                    const x = (lengthMm * i) / 47;
                    const y = medialY + ((lateralY - medialY) * j) / 20;
                    positions.push(x, y, 8);
                }
            }
            grid.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
            const before = new Float32Array(positions);
            applySinkCutToGeometry(grid, grid, {
                side,
                lengthMm,
                widthMm: Math.abs(lateralY - medialY),
                sinks: [placed("mpj1")],
            });
            const cut = grid.getAttribute("position");
            let best = 0;
            let bestY = 0;
            for (let i = 0; i < cut.count; i++) {
                const drop = (before[i * 3 + 2] ?? 0) - cut.getZ(i);
                if (drop > best) {
                    best = drop;
                    bestY = cut.getY(i);
                }
            }
            expect(best).toBeGreaterThan(3);
            expect(Math.abs(bestY - medialY)).toBeLessThan(Math.abs(bestY - lateralY));
            expect((bestY - (medialY + lateralY) / 2) * sign).toBeGreaterThan(0);
            const frame = sinkFrame(placed("mpj1"), {
                side,
                lengthMm,
                widthMm: 95,
                sinks: [placed("mpj1")],
                footOutline: outline,
            });
            if (!frame) throw new Error("mpj1 frame missing");
            expect(frame.v).toBeLessThan(0.2);
            grid.dispose();
        }
    });

    test("SAMPLE_Top arch and the 1st MPJ cut share medialSign on both feet", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const left = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        );
        const right = mirrorGeometry(left);
        try {
            for (const [side, geo] of [
                ["left", left],
                ["right", right],
            ] as const) {
                expect(detectArchSideSign(geo)).toBe(medialSign(side));
                const { minY, maxY, centerY } = yExtent(geo);
                const span = maxY - minY;
                const medialEdge = medialSign(side) > 0 ? maxY : minY;
                const cut = geo.clone();
                applySinkCutToGeometry(cut, geo, {
                    side,
                    lengthMm: 260,
                    widthMm: span,
                    sinks: [placed("mpj1", `mpj1-${side}`)],
                });
                const sunk = cut.getAttribute("position");
                const base = geo.getAttribute("position");
                let best = 0;
                let bestY = centerY;
                const n = Math.min(sunk.count, base.count);
                for (let i = 0; i < n; i++) {
                    const drop = base.getZ(i) - sunk.getZ(i);
                    if (drop > best) {
                        best = drop;
                        bestY = base.getY(i);
                    }
                }
                expect(best).toBeGreaterThan(1);
                expect((bestY - centerY) * medialSign(side)).toBeGreaterThan(0);
                expect(Math.abs(bestY - medialEdge)).toBeLessThan(span * 0.45);
                cut.dispose();
            }
        } finally {
            left.dispose();
            right.dispose();
        }
    });
});
