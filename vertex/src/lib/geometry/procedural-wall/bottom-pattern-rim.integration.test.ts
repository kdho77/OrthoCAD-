// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { composeViewerPrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    buildProceduralViewerPattern,
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";
import {
    bottomPatternOutsideComposedRim,
    composedTopRimPolygon,
    minBottomPatternInsetVsTopRimMm,
    signedBottomPatternInsetVsRimMm,
} from "./bottom-pattern-rim";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function zero(): SideCorrections {
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

describe("SAMPLE_Top composed rim inset (left foot)", () => {
    test("mirrored left — 1 mm outside B triggers warning; baseline inside", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        let raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
        const side: Side = "left";
        const sourceField = {
            side,
            lengthMm: 266,
            widthMm: 95,
            thicknessMm: 3,
            corrections: zero(),
            elements: [],
            includeSkives: false,
            includeElements: false,
            trimline: null,
        };
        const composedTop = composeViewerPrintSolidTop({ raw, sourceField });
        const pattern = buildProceduralViewerPattern(composedTop, "full_contact");
        const preview = reconstructProceduralPreview(composedTop, {
            sourceField,
            composedTop: true,
            wallStyle: "straight",
            scanPattern: "full_contact",
            bottomPattern: pattern,
            lockBottomB: true,
        });
        const baselineInset = minBottomPatternInsetVsTopRimMm(pattern, preview.model);
        expect(baselineInset).toBeGreaterThanOrEqual(0);
        expect(bottomPatternOutsideComposedRim(baselineInset)).toBe(false);

        const rim = composedTopRimPolygon(preview.model);
        let pushI = 0;
        let minInsetAt = Infinity;
        for (let i = 0; i < pattern.length; i++) {
            const p = pattern[i]!;
            const inset = signedBottomPatternInsetVsRimMm(p.x, p.y, rim);
            if (inset < minInsetAt) {
                minInsetAt = inset;
                pushI = i;
            }
        }
        const anchor = pattern[pushI]!;
        let outX = 1;
        let outY = 0;
        if (rim.length >= 4) {
            let best = rim[0]!;
            let bestD = Infinity;
            for (const r of rim) {
                const d = Math.hypot(anchor.x - r.x, anchor.y - r.y);
                if (d < bestD) {
                    bestD = d;
                    best = r;
                }
            }
            const vx = anchor.x - best.x;
            const vy = anchor.y - best.y;
            const vl = Math.hypot(vx, vy) || 1;
            outX = vx / vl;
            outY = vy / vl;
        }
        const pushed = pattern.map((p, i) =>
            i === pushI ? { x: p.x - outX * 1.5, y: p.y - outY * 1.5, z: p.z ?? 0 } : p,
        );
        const pushedInset = minBottomPatternInsetVsTopRimMm(pushed, preview.model);
        expect(pushedInset).toBeLessThan(-0.2);
        expect(bottomPatternOutsideComposedRim(pushedInset)).toBe(true);

        preview.geometry.dispose();
        if (composedTop !== raw) composedTop.dispose();
        raw.dispose();
    }, 180_000);
});
