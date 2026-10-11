// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import {
    extractTopOnlyModel,
    fairInsetMm,
    PATTERN_FOREFOOT_INSET_MM,
    PATTERN_HEEL_INSET_MM,
    PATTERN_SOURCE_SYNTHETIC,
} from "@/lib/geometry/procedural-wall";
import {
    buildFairedPatternFromTop,
    SAMPLE_TOP_ASSET_ID,
    SAMPLE_TOP_NAME,
    sampleTopFromArrayBuffer,
} from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

describe("SAMPLE_Top faired preview inputs", () => {
    test("fair inset is heel ~8 mm, toe 1 mm, medial arch cut-in", () => {
        expect(fairInsetMm(0.05, false)).toBeGreaterThanOrEqual(PATTERN_FOREFOOT_INSET_MM);
        expect(fairInsetMm(0.08, true)).toBeGreaterThan(6);
        expect(fairInsetMm(0.08, true)).toBeLessThanOrEqual(PATTERN_HEEL_INSET_MM);
        expect(fairInsetMm(0.9, true)).toBeLessThanOrEqual(PATTERN_FOREFOOT_INSET_MM + 0.05);
        expect(fairInsetMm(0.4, true)).toBeGreaterThan(fairInsetMm(0.4, false));
    });

    test("SAMPLE_Top builds a faired pattern inside the top rim", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const geo = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const model = extractTopOnlyModel(geo, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
        expect(model.top.rimLocal?.length).toBeGreaterThan(8);
        const pattern = buildFairedPatternFromTop(model);
        expect(pattern.length).toBeGreaterThan(16);
        const length = model.bounds.maxX - model.bounds.minX;
        let heelInset = Infinity;
        let toeInset = Infinity;
        const rimLocal = model.top.rimLocal ?? [];
        const pos = model.top.meshPositions ?? new Float32Array();
        const rim = rimLocal.map((i) => ({
            x: pos[i * 3] ?? 0,
            y: pos[i * 3 + 1] ?? 0,
        }));
        const insetAt = (p: { x: number; y: number }) => {
            let best = Infinity;
            for (let i = 0; i < rim.length; i++) {
                const a = rim[i]!;
                const b = rim[(i + 1) % rim.length]!;
                const ex = b.x - a.x;
                const ey = b.y - a.y;
                const len2 = ex * ex + ey * ey;
                const t =
                    len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
                best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t)));
            }
            return best;
        };
        for (const p of pattern) {
            const u = (p.x - model.bounds.minX) / length;
            const d = insetAt(p);
            if (u < 0.12) heelInset = Math.min(heelInset, d);
            if (u > 0.88) toeInset = Math.min(toeInset, d);
        }
        expect(toeInset).toBeLessThan(2.5);
        expect(heelInset).toBeGreaterThan(3);
        expect(PATTERN_SOURCE_SYNTHETIC).toBe("synthetic");
        geo.dispose();
    }, 60_000);
});
