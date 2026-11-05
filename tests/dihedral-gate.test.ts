// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";

/**
 * Permanent fold gate. Worst edge dihedral outside Hybrid's crease band is
 * at most 60 degrees on the print solid. The crease (native X 72–78, mapped
 * through the footprint scale about the top center, ±1 mm) is exempt.
 * Default solids have no wedge, so nothing is allowed up to 66 degrees.
 * Same edge skips as the sink fold gate: area under 1e-3 mm², length under 0.12 mm.
 */

const SAMPLE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const HYBRID_CREASE_X0 = 72;
const HYBRID_CREASE_X1 = 78;
type WallStyle = "straight" | "round" | "hybrid";

function faceNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] | null {
    const ax = pos[a * 3] ?? 0;
    const ay = pos[a * 3 + 1] ?? 0;
    const az = pos[a * 3 + 2] ?? 0;
    const ux = (pos[b * 3] ?? 0) - ax;
    const uy = (pos[b * 3 + 1] ?? 0) - ay;
    const uz = (pos[b * 3 + 2] ?? 0) - az;
    const vx = (pos[c * 3] ?? 0) - ax;
    const vy = (pos[c * 3 + 1] ?? 0) - ay;
    const vz = (pos[c * 3 + 2] ?? 0) - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return null;
    return [nx / len, ny / len, nz / len];
}

function triArea(pos: Float32Array, idx: ArrayLike<number>, f: number): number {
    const a = idx[f] ?? 0;
    const b = idx[f + 1] ?? 0;
    const c = idx[f + 2] ?? 0;
    const ux = (pos[b * 3] ?? 0) - (pos[a * 3] ?? 0);
    const uy = (pos[b * 3 + 1] ?? 0) - (pos[a * 3 + 1] ?? 0);
    const uz = (pos[b * 3 + 2] ?? 0) - (pos[a * 3 + 2] ?? 0);
    const vx = (pos[c * 3] ?? 0) - (pos[a * 3] ?? 0);
    const vy = (pos[c * 3 + 1] ?? 0) - (pos[a * 3 + 1] ?? 0);
    const vz = (pos[c * 3 + 2] ?? 0) - (pos[a * 3 + 2] ?? 0);
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
}

function outsideBandDeg(geo: BufferGeometry, wall: WallStyle, band: { x0: number; x1: number }): number {
    const pos = geo.getAttribute("position").array as Float32Array;
    const idx = geo.getIndex()?.array;
    if (!idx) throw new Error("print solid has no index");
    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f] ?? 0;
        const b = idx[f + 1] ?? 0;
        const c = idx[f + 2] ?? 0;
        for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = p < q ? `${p},${q}` : `${q},${p}`;
            const faces = edgeFaces.get(k);
            if (faces) faces.push(f);
            else edgeFaces.set(k, [f]);
        }
    }
    let outsideDeg = 0;
    let scored = 0;
    for (const [key, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const f1 = faces[0] ?? 0;
        const f2 = faces[1] ?? 0;
        if (triArea(pos, idx, f1) < 1e-3 || triArea(pos, idx, f2) < 1e-3) continue;
        const parts = key.split(",").map(Number);
        const sa = parts[0] ?? 0;
        const sb = parts[1] ?? 0;
        const elen = Math.hypot(
            (pos[sa * 3] ?? 0) - (pos[sb * 3] ?? 0),
            (pos[sa * 3 + 1] ?? 0) - (pos[sb * 3 + 1] ?? 0),
            (pos[sa * 3 + 2] ?? 0) - (pos[sb * 3 + 2] ?? 0),
        );
        if (elen < 0.12) continue;
        const n1 = faceNormal(pos, idx[f1] ?? 0, idx[f1 + 1] ?? 0, idx[f1 + 2] ?? 0);
        const n2 = faceNormal(pos, idx[f2] ?? 0, idx[f2 + 1] ?? 0, idx[f2 + 2] ?? 0);
        if (!n1 || !n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        const deg = (Math.acos(dot) * 180) / Math.PI;
        const x = 0.5 * ((pos[sa * 3] ?? 0) + (pos[sb * 3] ?? 0));
        const inHybridBand = wall === "hybrid" && x >= band.x0 && x <= band.x1;
        scored++;
        if (!inHybridBand && deg > outsideDeg) outsideDeg = deg;
    }
    if (scored < 100) throw new Error(`scored ${scored} edges`);
    return outsideDeg;
}

function hybridBand(rawMinX: number, rawMaxX: number, scale: number): { x0: number; x1: number } {
    const cx = (rawMinX + rawMaxX) / 2;
    const a = cx + (HYBRID_CREASE_X0 - cx) * scale;
    const b = cx + (HYBRID_CREASE_X1 - cx) * scale;
    return { x0: Math.min(a, b) - 1, x1: Math.max(a, b) + 1 };
}

describe("outside-band dihedral gate", () => {
    test("US 9 and US 1 straight, round, and hybrid stay at or under 60 degrees", async () => {
        const buf = readFileSync(SAMPLE);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const pos = raw.getAttribute("position").array as Float32Array;
        let rawMinX = Infinity;
        let rawMaxX = -Infinity;
        for (let i = 0; i < pos.length; i += 3) {
            const x = pos[i] ?? 0;
            if (x < rawMinX) rawMinX = x;
            if (x > rawMaxX) rawMaxX = x;
        }
        const walls: WallStyle[] = ["straight", "round", "hybrid"];
        try {
            for (const usMen of [9, 1] as const) {
                const layout = insoleLayoutForUsMenSize(usMen);
                const design = createDesignWithStockPlaceholder({
                    ...defaultDesign(),
                    sizeSystem: "us",
                    usMenSize: layout.usMenSize,
                    footLengthMm: layout.footLengthMm,
                });
                const field = baseModifierFieldAuthoritative(design, "left", design.thicknessMm);
                const band = hybridBand(rawMinX, rawMaxX, layout.scale);
                for (const wall of walls) {
                    const viewer = {
                        transparent: false,
                        heightmap: false,
                        showLeft: true,
                        showRight: true,
                        showScans: true,
                        view: "iso" as const,
                        wallModel: "procedural" as const,
                        wallStyle: wall,
                    };
                    useDesignStore.setState({ design, viewer });
                    const solid = await reconstructProceduralPreview(
                        raw,
                        printSolidOptions({
                            design,
                            side: "left",
                            field,
                            viewer,
                            trimline: null,
                            bottomPattern: null,
                        }),
                    );
                    const outsideDeg = outsideBandDeg(solid.geometry, wall, band);
                    solid.geometry.dispose();
                    expect(outsideDeg, `US ${usMen} ${wall}`).toBeLessThanOrEqual(60);
                }
            }
        } finally {
            raw.dispose();
        }
    }, 600_000);
});
