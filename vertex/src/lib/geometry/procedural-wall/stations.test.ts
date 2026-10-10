// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { FLARE_BOUNDS } from "./defaults";
import {
    countPlanViewChordCrossings,
    FLARE_DEV_CAP_DEG,
    mapLoopByMatchedFeatures,
    pairAtNativeTop,
    pairByHarmonic,
    pairByOutwardRay,
    raySegHit2D,
    reparameterizeBArcLength,
    smoothAndCapFlare,
    smoothClosedParameters,
    spreadClosedOnLoop,
    TB_SMOOTH_SIGMA_MM,
    unwrapStrictlyIncreasing,
} from "./stations";

describe("outward-ray station pairing", () => {
    test("ray hits the nearest +n segment", () => {
        const hit = raySegHit2D(0, 0, 1, 0, 4, -1, 4, 1);
        expect(hit).not.toBeNull();
        expect(hit!.t).toBeCloseTo(4, 6);
        expect(hit!.u).toBeCloseTo(0.5, 6);
        expect(raySegHit2D(0, 0, 1, 0, -4, -1, -4, 1)).toBeNull();
    });

    test("unwrap requires a single increasing circuit", () => {
        const ok = unwrapStrictlyIncreasing([0.1, 0.3, 0.6, 0.9, 0.05]);
        expect(ok.ok).toBe(true);
        const fold = unwrapStrictlyIncreasing([0.1, 0.9, 0.8, 0.7, 0.6]);
        expect(fold.ok).toBe(false);
    });

    test("concentric rectangles pair with 0 crossings and low skew", () => {
        const inner = [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: -4, z: 0 },
            { x: 20, y: 0, z: 0 },
            { x: 10, y: 4, z: 0 },
        ];
        const outer = [
            { x: -1, y: 0, z: 8 },
            { x: 10, y: -6, z: 8 },
            { x: 21, y: 0, z: 8 },
            { x: 10, y: 6, z: 8 },
        ];
        const paired = pairByOutwardRay(inner, outer, 16);
        expect(paired.monotonic).toBe(true);
        expect(paired.chordCrossings).toBe(0);
        expect(paired.maxSkewMm).toBeLessThan(2);
        expect(countPlanViewChordCrossings(paired.plantar, paired.top)).toBe(0);
    });

    test("harmonic midline pairing is strictly increasing with 0 crossings", () => {
        const ellipse = (rx: number, ry: number, z: number, n = 32) =>
            Array.from({ length: n }, (_, i) => {
                const a = (i / n) * Math.PI * 2;
                return { x: 10 + rx * Math.cos(a), y: ry * Math.sin(a), z };
            });
        const plantar = ellipse(12, 7, 0);
        const top = ellipse(10, 5, 8);
        const paired = pairByHarmonic(plantar, top, 24);
        expect(paired.method).toBe("harmonic");
        expect(paired.monotonic).toBe(true);
        expect(paired.chordCrossings).toBe(0);
        expect(countPlanViewChordCrossings(paired.plantar, paired.top)).toBe(0);
        for (let i = 1; i < paired.s01.length; i++) {
            expect(paired.s01[i]!).toBeGreaterThan(paired.s01[i - 1]!);
        }
    });

    test("pairAtNativeTop keeps exact TopSheet rim vertices", () => {
        const ellipse = (rx: number, ry: number, z: number, n = 24) =>
            Array.from({ length: n }, (_, i) => {
                const a = (i / n) * Math.PI * 2;
                return { x: 10 + rx * Math.cos(a), y: ry * Math.sin(a), z };
            });
        const plantar = ellipse(12, 7, 0);
        const top = ellipse(10, 5, 8, 20);
        const paired = pairAtNativeTop(plantar, top);
        expect(paired.top.length).toBe(top.length);
        expect(paired.plantar.length).toBe(top.length);
        expect(paired.chordCrossings).toBe(0);
        for (let i = 0; i < top.length; i++) {
            expect(paired.top[i]!.x).toBe(top[i]!.x);
            expect(paired.top[i]!.y).toBe(top[i]!.y);
            expect(paired.top[i]!.z).toBe(top[i]!.z);
        }
    });

    test("where T and P coincide the harmonic column is vertical", () => {
        const loop = [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: -3, z: 0 },
            { x: 20, y: 0, z: 0 },
            { x: 10, y: 3, z: 0 },
        ];
        const top = loop.map((p) => ({ x: p.x, y: p.y, z: 8 }));
        const paired = pairByHarmonic(loop, top, 16);
        expect(paired.chordCrossings).toBe(0);
        let maxPlan = 0;
        for (let i = 0; i < paired.plantar.length; i++) {
            maxPlan = Math.max(
                maxPlan,
                Math.hypot(paired.top[i]!.x - paired.plantar[i]!.x, paired.top[i]!.y - paired.plantar[i]!.y),
            );
        }
        expect(maxPlan).toBeLessThan(0.35);
    });

    test("±25° cap does not override the lateral-midfoot 41° default", () => {
        expect(FLARE_BOUNDS.lateralMidfoot.recommended).toBe(41);
        expect(FLARE_DEV_CAP_DEG).toBe(25);
        const outline = Array.from({ length: 8 }, (_, i) => ({
            x: Math.cos((i / 8) * Math.PI * 2) * 20,
            y: Math.sin((i / 8) * Math.PI * 2) * 10,
            z: 0,
        }));
        const region = outline.map(() => 41);
        const { flare, report } = smoothAndCapFlare(outline, region, region);
        for (const f of flare) expect(f).toBeCloseTo(41, 5);
        expect(report.stillNeeded).toBe(false);
        const spiked = region.slice();
        spiked[3] = 80;
        const capped = smoothAndCapFlare(outline, region, spiked);
        expect(capped.flare[3]!).toBeLessThanOrEqual(41 + FLARE_DEV_CAP_DEG);
        expect(capped.flare.some((f) => Math.abs(f - 41) < 1e-6 || f >= 41)).toBe(true);
    });

    test("smoothClosedParameters keeps a uniform circuit near the input", () => {
        const n = 24;
        const rim = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 30 * Math.cos(a), y: 18 * Math.sin(a), z: 4 };
        });
        const s01 = rim.map((_, i) => i / n);
        s01[5] = (5 / n + 0.08) % 1;
        const sm = smoothClosedParameters(s01, rim, TB_SMOOTH_SIGMA_MM);
        expect(sm).toHaveLength(n);
        for (const s of sm) {
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThan(1);
        }
        const mapped = mapLoopByMatchedFeatures(rim, rim, { minX: -30, maxX: 30 }, 1);
        expect(mapped).toHaveLength(n);
        let err = 0;
        for (let i = 0; i < n; i++) {
            err += Math.hypot(mapped[i]!.x - rim[i]!.x, mapped[i]!.y - rim[i]!.y);
        }
        expect(err / n).toBeLessThan(2);
    });

    test("spreadClosedOnLoop fans collapsed heel hits around the wrap", () => {
        const loop = Array.from({ length: 40 }, (_, i) => {
            const a = (i / 40) * Math.PI * 2;
            return { x: 20 * Math.cos(a), y: 12 * Math.sin(a), z: 0 };
        });
        const apex = loop[0]!;
        const pts = loop.map((p, i) => (i < 6 || i > 36 ? { ...apex } : { ...p }));
        const spread = spreadClosedOnLoop(pts, loop, 0.4);
        for (let i = 0; i < spread.length; i++) {
            const a = spread[i]!;
            const b = spread[(i + 1) % spread.length]!;
            expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.15);
        }
    });

    test("reparameterizeBArcLength equalizes B and stays monotone", () => {
        const n = 20;
        const loop = Array.from({ length: 80 }, (_, i) => {
            const a = (i / 80) * Math.PI * 2;
            return { x: 20 * Math.cos(a), y: 12 * Math.sin(a), z: 0 };
        });
        const stations = Array.from({ length: n }, (_, i) => {
            // Monotone 2:1 clump: one short step then one long step.
            let t = i / n;
            if (i === 4) t = 3 / n + 1 / n / 2;
            if (i > 4) t = (i + 0.5) / n;
            t = ((t % 1) + 1) % 1;
            const p = loop[Math.round(t * 80) % 80]!;
            const a = (i / n) * Math.PI * 2;
            return {
                tB: t,
                outline: { x: p.x, y: p.y, z: 0 },
                rim: { x: 24 * Math.cos(a), y: 15 * Math.sin(a), z: 8 },
            };
        });
        const ok = reparameterizeBArcLength(stations, loop);
        expect(ok).toBe(true);
        const ds: number[] = [];
        for (let i = 0; i < n; i++) {
            const a = stations[i]!.outline;
            const b = stations[(i + 1) % n]!.outline;
            ds.push(Math.hypot(b.x - a.x, b.y - a.y));
        }
        let maxNeighbour = 0;
        for (let i = 0; i < n; i++) {
            const a = ds[i]!;
            const b = ds[(i + n - 1) % n]!;
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            if (lo > 1e-9) maxNeighbour = Math.max(maxNeighbour, hi / lo);
        }
        expect(maxNeighbour).toBeLessThanOrEqual(1.5);
        const t = stations.map((s) => s.tB ?? 0);
        for (let i = 1; i < n; i++) {
            const d = (t[i]! - t[i - 1]! + 1) % 1;
            expect(d).toBeGreaterThan(0);
        }
    });
});
