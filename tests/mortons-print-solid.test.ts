// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import { MORTONS_LATERAL_TAPER_MM, MORTONS_PROXIMAL_TAPER_MM, medialSign } from "@/lib/geometry/mortons";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";
import { SAMPLE_TOP_GLB_FIXTURE_PATH } from "./helpers/load-sample-top-glb";
import { encodePng, renderMesh } from "./helpers/render-png";

function serveSampleTopFixture(): void {
    const bytes = readFileSync(SAMPLE_TOP_GLB_FIXTURE_PATH);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("SAMPLE_Top.glb")) {
            return new Response(body, { status: 200 });
        }
        return nativeFetch(input, init);
    }) as typeof fetch;
    resetSampleTopGeometryCache();
}

const ARTIFACTS = "/opt/cursor/artifacts";
const STYLES = ["round", "straight", "hybrid"] as const;

function stlTriangles(buf: ArrayBuffer): Float32Array {
    const view = new DataView(buf);
    const count = view.getUint32(80, true);
    const pos = new Float32Array(count * 9);
    let offset = 84;
    let write = 0;
    for (let i = 0; i < count; i++) {
        offset += 12;
        for (let k = 0; k < 9; k++) {
            pos[write++] = view.getFloat32(offset, true);
            offset += 4;
        }
        offset += 2;
    }
    return pos;
}

function upperMean(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const start = Math.floor(sorted.length * 0.8);
    let sum = 0;
    let n = 0;
    for (let i = start; i < sorted.length; i++) {
        sum += sorted[i]!;
        n++;
    }
    return n ? sum / n : Number.NaN;
}

/** Forefoot first-ray top minus the lateral forefoot top. Positive means the raise is medial. */
function medialRaiseMm(
    pos: Float32Array,
    side: Side,
): { raiseMm: number; centroidY: number; lifted: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    const sign = medialSign(side);
    const medialEdge = sign < 0 ? minY : maxY;
    const lateralEdge = sign < 0 ? maxY : minY;
    const medial: number[] = [];
    const lateral: number[] = [];
    for (let i = 0; i < n; i++) {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        const z = pos[i * 3 + 2]!;
        const u = (x - minX) / spanX;
        if (u < 0.8 || u > 0.93) continue;
        if (Math.abs(y - medialEdge) < spanY * 0.2) medial.push(z);
        else if (Math.abs(y - lateralEdge) < spanY * 0.2) lateral.push(z);
    }
    const medTop = upperMean(medial);
    const latTop = upperMean(lateral);
    let sy = 0;
    let lifted = 0;
    for (let i = 0; i < n; i++) {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        const z = pos[i * 3 + 2]!;
        const u = (x - minX) / spanX;
        if (u < 0.8 || u > 0.93) continue;
        if (z < latTop + 1.2) continue;
        sy += y;
        lifted++;
    }
    return {
        raiseMm: medTop - latTop,
        centroidY: lifted ? sy / lifted : 0,
        lifted,
    };
}

function watertight(style: string, path: string): { watertight: boolean; winding: boolean; bodies: number } {
    const helper = resolve(process.cwd(), "tests/helpers/stl-gates.py");
    const out = execFileSync("python3", [helper, style, path], { encoding: "utf8" });
    return JSON.parse(out) as { watertight: boolean; winding: boolean; bodies: number };
}

describe("Morton's print solid export", () => {
    test("keeps the approved blend lengths", () => {
        expect(MORTONS_PROXIMAL_TAPER_MM).toBe(12);
        expect(MORTONS_LATERAL_TAPER_MM).toBe(3);
        expect(medialSign("left")).toBe(-1);
        expect(medialSign("right")).toBe(1);
    });

    test("both feet export a watertight solid with the raise on the medial side", async () => {
        serveSampleTopFixture();
        useBottomPatternStore.getState().clear();
        mkdirSync(ARTIFACTS, { recursive: true });
        const design = createDesignWithStockPlaceholder({
            ...defaultDesign(),
            method: "printing_solid",
            thicknessMm: 2,
            mortons: {
                left: { mode: "extension", amountMm: 3 },
                right: { mode: "extension", amountMm: 3 },
            },
        });
        for (const wallStyle of STYLES) {
            useDesignStore.setState((s) => ({
                design,
                viewer: { ...s.viewer, wallModel: "procedural", wallStyle },
            }));
            for (const side of ["left", "right"] as const) {
                const stl = await buildExportStl(side);
                const file = resolve(ARTIFACTS, `mortons-m9-${side}-${wallStyle}.stl`);
                writeFileSync(file, Buffer.from(stl));
                const gate = watertight(wallStyle, file);
                expect(gate.watertight, `${wallStyle} ${side} watertight`).toBe(true);
                expect(gate.winding, `${wallStyle} ${side} winding`).toBe(true);
                expect(gate.bodies, `${wallStyle} ${side} bodies`).toBe(1);
                const pos = stlTriangles(stl);
                const medial = medialRaiseMm(pos, side);
                expect(medial.lifted, `${wallStyle} ${side} lifted`).toBeGreaterThan(30);
                expect(medial.raiseMm, `${wallStyle} ${side} raise`).toBeGreaterThan(1.5);
                expect(Math.sign(medial.centroidY), `${wallStyle} ${side} medial`).toBe(medialSign(side));
                if (wallStyle === "round") {
                    const idx = new Uint32Array(pos.length / 3);
                    for (let i = 0; i < idx.length; i++) idx[i] = i;
                    const top = renderMesh(
                        pos,
                        idx,
                        {
                            right: [1, 0, 0],
                            up: [0, 1, 0],
                            light: [0.25, 0.35, 0.9],
                        },
                        900,
                        680,
                    );
                    const oblique = renderMesh(
                        pos,
                        idx,
                        {
                            right: [0.86, 0.2, 0],
                            up: [-0.12, 0.28, 0.95],
                            light: [0.35, 0.4, 0.85],
                        },
                        900,
                        680,
                    );
                    writeFileSync(
                        resolve(ARTIFACTS, `mortons-m9-${side}-round-top.png`),
                        encodePng(900, 680, top),
                    );
                    writeFileSync(
                        resolve(ARTIFACTS, `mortons-m9-${side}-round-oblique.png`),
                        encodePng(900, 680, oblique),
                    );
                }
            }
        }
    }, 600_000);
});
