// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Vector3 } from "three";
import {
    applyTopOutlineLockZone,
    lockedBottomOutlineIndices,
    resolveDesignBuildLength,
} from "@/lib/geometry/bottom-pattern";
import {
    anteriorU,
    archEndU,
    HEEL_LIFT_TAPER_END,
    lockZoneURange,
    MAX_ARCH_MARGIN_MM,
    MIN_ARCH_MARGIN_MM,
    SULCUS_OFFSET_MM,
} from "@/lib/geometry/heel-lift";
import { deformTrimlineSection, deformTrimlineSectionMulti } from "@/lib/geometry/trimline";
import { defaultDesign } from "@/stores/design-store";
import type { TrimlineCurve } from "@/lib/geometry/trimline";

describe("archEndU / anteriorU / lock zone", () => {
    test("HEEL_LIFT_TAPER_END u-axis is heel=0 toe=1", () => {
        expect(HEEL_LIFT_TAPER_END).toBe(0.75);
        // Formula assumes heel=0: archEndU must be < taper end
        expect(archEndU(260)).toBeLessThan(HEEL_LIFT_TAPER_END);
        expect(archEndU(260)).toBeGreaterThan(0.5);
    });

    test("archEndU margin clamps at MIN/MAX across lengths", () => {
        // Short insole: 0.06*L may be below MIN → clamp to MIN
        const short = 100; // 0.06*100=6 < MIN 10
        expect(archEndU(short)).toBeCloseTo(HEEL_LIFT_TAPER_END - MIN_ARCH_MARGIN_MM / short, 10);

        // Mid: 0.06*260=15.6 in [10,25]
        const mid = 260;
        expect(archEndU(mid)).toBeCloseTo(HEEL_LIFT_TAPER_END - (0.06 * mid) / mid, 10);
        expect(archEndU(mid)).toBeCloseTo(HEEL_LIFT_TAPER_END - 0.06, 10);

        // Long: 0.06*500=30 > MAX 25 → clamp to MAX
        const long = 500;
        expect(archEndU(long)).toBeCloseTo(HEEL_LIFT_TAPER_END - MAX_ARCH_MARGIN_MM / long, 10);
    });

    test("anteriorU for all three buildLength classes", () => {
        const L = 260;
        const end = archEndU(L);
        expect(anteriorU("full", L)).toBe(1);
        expect(anteriorU("three_quarter", L)).toBeCloseTo(end, 10);
        expect(anteriorU("sulcus", L)).toBeCloseTo(end + SULCUS_OFFSET_MM / L, 10);
        expect(anteriorU("sulcus", L)).toBeLessThan(1);
    });

    test("three_quarter lock zone is zero-width; full/sulcus active with different fractions", () => {
        const L = 260;
        const tq = lockZoneURange("three_quarter", L);
        expect(tq.active).toBe(false);
        expect(tq.anterior - tq.archEnd).toBeCloseTo(0, 10);

        const full = lockZoneURange("full", L);
        expect(full.active).toBe(true);
        const fullFrac = full.anterior - full.archEnd;
        expect(fullFrac).toBeGreaterThan(0.15); // ~0.31 at L=260

        const sulcus = lockZoneURange("sulcus", L);
        expect(sulcus.active).toBe(true);
        const sulcusFrac = sulcus.anterior - sulcus.archEnd;
        expect(sulcusFrac).toBeCloseTo(SULCUS_OFFSET_MM / L, 10);
        expect(sulcusFrac).toBeLessThan(fullFrac);
        // Not a fixed percentage across classes
        expect(Math.abs(fullFrac - sulcusFrac)).toBeGreaterThan(0.1);
    });

    test("legacy designs without buildLength resolve to full", () => {
        expect(resolveDesignBuildLength(defaultDesign())).toBe("full");
        expect(resolveDesignBuildLength({ ...defaultDesign(), buildLength: "sulcus" })).toBe("sulcus");
    });
});

describe("lock-zone outline matching", () => {
    function ovalOutline(lenHalf: number, widHalf: number, n = 24): TrimlineCurve {
        const points: Vector3[] = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            points.push(new Vector3(lenHalf * Math.cos(a) + lenHalf, widHalf * Math.sin(a), 0));
        }
        return { points };
    }

    test("within lock zone, bottom points snap to top outline", () => {
        const top = ovalOutline(130, 45);
        // Bottom starts smaller / offset — lock zone should overwrite distal points.
        const bottom = ovalOutline(120, 40).points.map((p) => p.clone());
        const locked = lockedBottomOutlineIndices(bottom, top, "full", 260);
        expect(locked.size).toBeGreaterThan(0);
        const snapped = applyTopOutlineLockZone(bottom, top, locked);
        for (const i of locked) {
            const p = snapped[i]!;
            // Must land on some top outline vertex (exact match from matcher).
            const onTop = top.points.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < 1e-6);
            expect(onTop).toBe(true);
        }
        // Unlocked points unchanged.
        for (let i = 0; i < bottom.length; i++) {
            if (locked.has(i)) continue;
            expect(snapped[i]!.x).toBeCloseTo(bottom[i]!.x, 5);
            expect(snapped[i]!.y).toBeCloseTo(bottom[i]!.y, 5);
        }
    });

    test("three_quarter yields empty lock set (no crash)", () => {
        const top = ovalOutline(130, 45);
        const bottom = ovalOutline(120, 40).points;
        const locked = lockedBottomOutlineIndices(bottom, top, "three_quarter", 260);
        expect(locked.size).toBe(0);
    });
});

describe("deformTrimlineSectionMulti smoothness", () => {
    test("multi-anchor max-Gaussian matches single-anchor when one selected", () => {
        const pts = Array.from({ length: 20 }, (_, i) => new Vector3(i * 10, 0, 0));
        const delta = new Vector3(0, 5, 0);
        const single = deformTrimlineSection(pts, 10, delta, 4);
        const multi = deformTrimlineSectionMulti(pts, [10], delta, 4);
        for (let i = 0; i < pts.length; i++) {
            expect(multi[i]!.y).toBeCloseTo(single[i]!.y, 10);
        }
    });

    test("multi-point drag stays smooth (no kink between anchors)", () => {
        const pts = Array.from({ length: 30 }, (_, i) => new Vector3(i * 5, 0, 0));
        const delta = new Vector3(0, 8, 0);
        const out = deformTrimlineSectionMulti(pts, [8, 9, 10, 11], delta, 5);
        // Second differences of Y should not spike (smooth envelope).
        const ys = out.map((p) => p.y);
        const d2: number[] = [];
        for (let i = 1; i < ys.length - 1; i++) {
            d2.push(ys[i - 1]! - 2 * ys[i]! + ys[i + 1]!);
        }
        const maxAbsD2 = Math.max(...d2.map(Math.abs));
        // Jagged polyline edit would produce large second diffs near anchors; Gaussian max stays mild.
        expect(maxAbsD2).toBeLessThan(2.5);
        // Skip indices leave locked points fixed.
        const locked = new Set([15, 16]);
        const withSkip = deformTrimlineSectionMulti(pts, [10], delta, 5, { skipIndices: locked });
        expect(withSkip[15]!.y).toBe(0);
        expect(withSkip[16]!.y).toBe(0);
        expect(withSkip[10]!.y).toBeGreaterThan(7);
    });
});
