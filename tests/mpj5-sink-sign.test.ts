// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { medialSign, meshYFromAnatomicalLateral } from "@/lib/geometry/handedness";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { footOutlineFromGeometry, sinkFrame } from "@/lib/geometry/sink";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedSink, Side } from "@/types";

/**
 * US 9.5 ApexCore (procedural SAMPLE_Top). A 5th-met sink must recess the
 * top by about its depth. The old writer left a dome of depth + 0.5 mm
 * where the wide thickness blend outran the cut.
 */
const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const MPJ5: PlacedSink = { id: "mpj5", kind: "mpj5", depthMm: 2 };
const US_95_SCALE = insoleLayoutForUsMenSize(9.5).scale;

async function loadTop(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

async function exportFoot(top: BufferGeometry, side: Side, sinks: PlacedSink[]): Promise<BufferGeometry> {
    const raw = side === "right" ? mirrorGeometry(top) : top.clone();
    try {
        const preview = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side,
            sinks,
            footprintScale: US_95_SCALE,
        });
        return preview.geometry;
    } finally {
        raw.dispose();
    }
}

function topCount(geo: BufferGeometry): number {
    const n = (geo.userData as { topVertexCount?: number }).topVertexCount;
    const count = geo.getAttribute("position").count;
    return n && n > 0 ? Math.min(n, count) : count;
}

function metHead(geo: BufferGeometry, side: Side, sink: PlacedSink): { x: number; y: number } {
    const pos = geo.getAttribute("position");
    const n = topCount(geo);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
        minX = Math.min(minX, pos.getX(i));
        maxX = Math.max(maxX, pos.getX(i));
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
    }
    const frame = sinkFrame(sink, {
        side,
        lengthMm: Math.max(1e-3, maxX - minX),
        widthMm: Math.max(1e-3, maxY - minY),
        sinks: [sink],
        medialYSign: medialSign(side),
        footOutline: footOutlineFromGeometry(geo, 0, 1, n) ?? undefined,
    });
    if (!frame) throw new Error(`no ${side} mpj5 frame`);
    return { x: frame.dx, y: meshYFromAnatomicalLateral(frame.dy, side) };
}

function topZAt(geo: BufferGeometry, x: number, y: number): number {
    const pos = geo.getAttribute("position");
    const n = topCount(geo);
    let best = Infinity;
    let z = Number.NaN;
    for (let i = 0; i < n; i++) {
        const d = (pos.getX(i) - x) ** 2 + (pos.getY(i) - y) ** 2;
        if (d < best) {
            best = d;
            z = pos.getZ(i);
        }
    }
    return z;
}

/** Highest rise of `sunk` above `plain` inside radius of the met head. */
function maxRise(sunk: BufferGeometry, plain: BufferGeometry, x: number, y: number, radius: number): number {
    const a = sunk.getAttribute("position");
    const b = plain.getAttribute("position");
    const nA = topCount(sunk);
    const nB = topCount(plain);
    const r2 = radius * radius;
    let rise = 0;
    for (let i = 0; i < nA; i++) {
        const dx = a.getX(i) - x;
        const dy = a.getY(i) - y;
        if (dx * dx + dy * dy > r2) continue;
        let best = Infinity;
        let z = 0;
        const ax = a.getX(i);
        const ay = a.getY(i);
        for (let j = 0; j < nB; j++) {
            const d = (b.getX(j) - ax) ** 2 + (b.getY(j) - ay) ** 2;
            if (d < best) {
                best = d;
                z = b.getZ(j);
            }
        }
        rise = Math.max(rise, a.getZ(i) - z);
    }
    return rise;
}

describe("MPJ5 sink export sign", () => {
    test("left, right, and both 5th-met sinks cut the top down about 2 mm", async () => {
        const top = await loadTop();
        const leftPlain = await exportFoot(top, "left", []);
        const leftSink = await exportFoot(top, "left", [MPJ5]);
        const rightPlain = await exportFoot(top, "right", []);
        const rightSink = await exportFoot(top, "right", [MPJ5]);
        const rightPlainMirrored = mirrorGeometry(rightPlain);
        try {
            const headL = metHead(leftPlain, "left", MPJ5);
            const leftVsMirroredRight =
                topZAt(leftSink, headL.x, headL.y) - topZAt(rightPlainMirrored, headL.x, headL.y);
            const headR = metHead(rightPlain, "right", MPJ5);
            const rightOnly = topZAt(rightSink, headR.x, headR.y) - topZAt(rightPlain, headR.x, headR.y);
            const bothLeft = topZAt(leftSink, headL.x, headL.y) - topZAt(leftPlain, headL.x, headL.y);
            const bothRight = rightOnly;
            const dome = maxRise(leftSink, rightPlainMirrored, headL.x, headL.y, 18);
            console.log(
                "[MPJ5-SINK-SIGN]",
                JSON.stringify({
                    scale: US_95_SCALE,
                    headL,
                    headR,
                    leftVsMirroredRight,
                    rightOnly,
                    bothLeft,
                    dome,
                }),
            );
            expect(leftVsMirroredRight, "left met head vs mirrored right").toBeLessThan(-1.5);
            expect(leftVsMirroredRight, "left met head vs mirrored right").toBeGreaterThan(-2.6);
            expect(dome, "no thickness dome beside the cut").toBeLessThan(0.35);
            expect(rightOnly, "right-only met head").toBeLessThan(-1.5);
            expect(rightOnly, "right-only met head").toBeGreaterThan(-2.6);
            expect(bothLeft, "both feet, left").toBeLessThan(-1.5);
            expect(bothLeft, "both feet, left").toBeGreaterThan(-2.6);
            expect(bothRight, "both feet, right").toBeLessThan(-1.5);
            expect(bothRight, "both feet, right").toBeGreaterThan(-2.6);
        } finally {
            top.dispose();
            leftPlain.dispose();
            leftSink.dispose();
            rightPlain.dispose();
            rightSink.dispose();
            rightPlainMirrored.dispose();
        }
    }, 180_000);
});
