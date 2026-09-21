// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { buildTrimPresetCurve } from "@/lib/geometry/trim-presets";
import { sampleDefaultOutline } from "@/lib/geometry/trimline";

describe("trim presets", () => {
    test("sulcus shortens distal AP vs full", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const full = buildTrimPresetCurve("full", { lengthMm, widthMm });
        const sulcus = buildTrimPresetCurve("sulcus", { lengthMm, widthMm });
        const maxFull = Math.max(...full.points.map((p) => p.x));
        const maxSulcus = Math.max(...sulcus.points.map((p) => p.x));
        expect(maxSulcus).toBeLessThan(maxFull - 5);
    });

    test("met-head is shorter than sulcus", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const sulcus = buildTrimPresetCurve("sulcus", { lengthMm, widthMm });
        const met = buildTrimPresetCurve("met_head", { lengthMm, widthMm });
        const maxSulcus = Math.max(...sulcus.points.map((p) => p.x));
        const maxMet = Math.max(...met.points.map((p) => p.x));
        expect(maxMet).toBeLessThan(maxSulcus);
    });

    test("respects ±3 mm distal offset", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const base = sampleDefaultOutline(lengthMm, widthMm);
        const a = buildTrimPresetCurve("sulcus", {
            lengthMm,
            widthMm,
            baseCurve: base,
            distalApOffsetMm: -3,
        });
        const b = buildTrimPresetCurve("sulcus", { lengthMm, widthMm, baseCurve: base, distalApOffsetMm: 3 });
        const maxA = Math.max(...a.points.map((p) => p.x));
        const maxB = Math.max(...b.points.map((p) => p.x));
        expect(maxB - maxA).toBeGreaterThanOrEqual(5);
    });
});
