// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Render narrowed shells to PNG for visual CAD review (writes /tmp/renders). */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, test } from "@rstest/core";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import type { SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import { encodePng, renderMesh } from "./helpers/render-png";

function neutral(): SideCorrections {
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

function makeField(c: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 2,
        corrections: { ...neutral(), ...c },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

describe("render narrowed shell", () => {
    test("render base / narrow / scan-match to /tmp/renders", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const index = raw.index!.array as Uint32Array | Uint16Array;
        mkdirSync("/tmp/renders", { recursive: true });

        const scenarios: [string, Partial<SideCorrections> | null][] = [
            ["base", null],
            ["narrow-10", { heelCupWidthMm: -10 }],
            ["scanmatch", { heelCupWidthMm: -5.1, archHeightMm: 13.3, apexMoveMm: -12 }],
        ];

        // Axes: detect via bbox (thick smallest, width middle, length largest)
        raw.computeBoundingBox();
        const box = raw.boundingBox!;
        const sizes: [number, number][] = [
            [0, box.max.x - box.min.x],
            [1, box.max.y - box.min.y],
            [2, box.max.z - box.min.z],
        ];
        sizes.sort((a, b) => a[1] - b[1]);
        const thickAxis = sizes[0]![0]!;
        const widthAxis = sizes[1]![0]!;
        const lengthAxis = sizes[2]![0]!;
        const axisVec = (a: number, sign = 1): [number, number, number] => {
            const v: [number, number, number] = [0, 0, 0];
            v[a] = sign;
            return v;
        };

        for (const [name, c] of scenarios) {
            const geo = c ? applyBaseModifiers(raw, makeField(c), 1) : raw;
            const pos = geo.getAttribute("position")!.array as Float32Array;

            // Left view: screen x = length, screen y = thickness
            const leftView = renderMesh(
                pos,
                index,
                {
                    right: axisVec(lengthAxis),
                    up: axisVec(thickAxis),
                    light: [-0.3, -0.5, -0.8],
                },
                1400,
                500,
            );
            writeFileSync(`/tmp/renders/${name}-left.png`, encodePng(1400, 500, leftView));

            // Top view: screen x = length, screen y = width
            const topView = renderMesh(
                pos,
                index,
                {
                    right: axisVec(lengthAxis),
                    up: axisVec(widthAxis),
                    light: [-0.3, -0.5, -0.8],
                },
                1400,
                600,
            );
            writeFileSync(`/tmp/renders/${name}-top.png`, encodePng(1400, 600, topView));

            // 3/4 free view: rotate around thickness axis then tilt
            const c45 = Math.cos(0.7),
                s45 = Math.sin(0.7);
            const right: [number, number, number] = [0, 0, 0];
            right[lengthAxis] = c45;
            right[widthAxis] = s45;
            const tilt = 0.5;
            const up: [number, number, number] = [0, 0, 0];
            up[lengthAxis] = -s45 * Math.sin(tilt);
            up[widthAxis] = c45 * Math.sin(tilt);
            up[thickAxis] = Math.cos(tilt);
            const freeView = renderMesh(
                pos,
                index,
                { right, up, light: [-0.4, -0.4, -0.75] },
                1200,
                700,
            );
            writeFileSync(`/tmp/renders/${name}-free.png`, encodePng(1200, 700, freeView));

            if (c) geo.dispose();
            console.log(`[RENDER] wrote /tmp/renders/${name}-{left,top,free}.png`);
        }
        raw.dispose();
    });
});
