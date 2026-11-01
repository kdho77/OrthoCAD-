// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { outlineHalfWidth } from "@/lib/geometry/height-field";
import { sideOffsetX } from "@/lib/geometry/layout";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";
import {
    type MortonsSampleContext,
    medialSign,
    mortonsQuery,
    mortonsRegionOutlineMm,
    mortonsVSigned,
} from "./mortons";

const layout = insoleLayoutForUsMenSize(9);

function zeroCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function ctx(side: Side): MortonsSampleContext {
    return {
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        mortons: { mode: "extension", amountMm: 3 },
        widthMmAt: (u) => outlineHalfWidth(u) * layout.widthMm,
    };
}

describe("Morton's region is on the medial side of both feet", () => {
    test("medialSign matches the stock pair (left Y−, mirrored right Y+)", () => {
        expect(medialSign("left")).toBe(-1);
        expect(medialSign("right")).toBe(1);
    });

    test("outline centroid sits on the first ray and covers the fillet taper", () => {
        for (const side of ["left", "right"] as const) {
            const sample = ctx(side);
            const pts = mortonsRegionOutlineMm(sample);
            expect(pts.length).toBeGreaterThan(12);
            let sx = 0;
            let sy = 0;
            let maxSpec = 0;
            let minU = 1;
            for (const p of pts) {
                sx += p.x;
                sy += p.y;
                const u = p.x / layout.lengthMm;
                const specV = 0.5 - p.y / (layout.widthMm * medialSign(side));
                if (specV > maxSpec) maxSpec = specV;
                if (u < minU) minU = u;
            }
            const cx = sx / pts.length;
            const cy = sy / pts.length;
            expect(Math.sign(cy)).toBe(medialSign(side));
            expect(Math.abs(cy)).toBeGreaterThan(layout.widthMm * 0.12);
            const edge = Math.max(...pts.map((p) => Math.abs(p.y)));
            expect(edge).toBeGreaterThan(layout.widthMm * 0.45);
            const u = cx / layout.lengthMm;
            const specV = 0.5 - cy / (layout.widthMm * medialSign(side));
            const weight = mortonsQuery(u, mortonsVSigned(specV, side), sample).weight;
            expect(weight).toBeGreaterThan(0.5);
            expect(maxSpec).toBeGreaterThan(0.4);
            expect(maxSpec).toBeLessThan(0.55);
            expect(minU).toBeLessThan(0.63);
            const lateral = mortonsQuery(0.85, mortonsVSigned(0.85, side), sample).weight;
            expect(lateral).toBe(0);
        }
    });

    test("SAMPLE_Top raise centroid is medial on the left mesh and the mirrored right", async () => {
        const buf = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
        const left = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const right = mirrorGeometry(left);
        for (const [side, geo] of [
            ["left", left],
            ["right", right],
        ] as const) {
            const field: HeightFieldParams = {
                side,
                lengthMm: layout.lengthMm,
                widthMm: layout.widthMm,
                thicknessMm: 3,
                corrections: zeroCorrections(),
                includeSkives: false,
                includeElements: false,
                mortons: { mode: "extension", amountMm: 3 },
            };
            const off = applyBaseModifiers(geo, { ...field, mortons: undefined }, 0, { skipNormals: true });
            const on = applyBaseModifiers(geo, field, 0, { skipNormals: true });
            const offP = off.getAttribute("position")!.array as Float32Array;
            const onP = on.getAttribute("position")!.array as Float32Array;
            const q = (v: number) => Math.round(v * 20);
            const offZ = new Map<string, number>();
            for (let i = 0; i < offP.length; i += 3) {
                offZ.set(`${q(offP[i]!)}:${q(offP[i + 1]!)}`, offP[i + 2]!);
            }
            let sy = 0;
            let n = 0;
            for (let i = 0; i < onP.length; i += 3) {
                const base = offZ.get(`${q(onP[i]!)}:${q(onP[i + 1]!)}`);
                if (base == null) continue;
                if (onP[i + 2]! - base > 1.5) {
                    sy += onP[i + 1]!;
                    n++;
                }
            }
            expect(n).toBeGreaterThan(100);
            const cy = sy / n;
            expect(Math.sign(cy)).toBe(medialSign(side));
            geo.computeBoundingBox();
            const box = geo.boundingBox!;
            const half = (box.max.y - box.min.y) / 2;
            expect(Math.abs(cy)).toBeGreaterThan(half * 0.25);
            const offset = sideOffsetX(side, layout.widthMm);
            const centerZ = -offset;
            const regionZ = -(cy + offset);
            expect(Math.abs(regionZ)).toBeLessThan(Math.abs(centerZ));
            off.dispose();
            on.dispose();
        }
        left.dispose();
        right.dispose();
    });
});
