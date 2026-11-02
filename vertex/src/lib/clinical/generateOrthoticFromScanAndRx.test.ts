// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { heuristicParse } from "@/features/ai-prescription/heuristic";
import { generateOrthoticFromScanAndRx } from "@/lib/clinical/generateOrthoticFromScanAndRx";
import { medialWidthSignForSide } from "@/lib/clinical/medial-sign";
import { mergeScanFitWithPrescription } from "@/lib/clinical/resolve-rx-vs-scan-corrections";
import { buildScanDisplayInfo } from "@/lib/geometry/scan-display";
import { suggestScanLandmarks } from "@/lib/geometry/scan-landmark-suggest";
import { createDesignWithStockPlaceholder, defaultDesign } from "@/stores/design-store";
import { archHeightScan } from "../../../../tests/helpers/arch-height-scan";

function syntheticFootGeometry(length = 270, side: "left" | "right" = "left"): THREE.BufferGeometry {
    const positions: number[] = [];
    const pushTri = (
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        cx: number,
        cy: number,
        cz: number,
    ) => {
        positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    };
    const halfWidthAt = (u: number, s: 1 | -1): number => {
        let w = 20 + 15 * Math.sin(Math.PI * u);
        if (s === 1) {
            const d = (u - 0.75) / 0.04;
            w += 15 * Math.exp(-(d * d));
        } else {
            const d = (u - 0.65) / 0.04;
            w += 15 * Math.exp(-(d * d));
        }
        return w;
    };
    const nu = 80;
    const nv = 24;
    for (let iu = 0; iu < nu; iu++) {
        const u0 = iu / nu;
        const u1 = (iu + 1) / nu;
        for (let iv = 0; iv < nv; iv++) {
            const v0 = iv / nv;
            const v1 = (iv + 1) / nv;
            const yOf = (u: number, v: number) => {
                const wm = halfWidthAt(u, 1);
                const wl = halfWidthAt(u, -1);
                return v >= 0 ? v * wm : v * wl;
            };
            const zOf = (u: number, y: number) => {
                if (u < 1 / 3) return 2 + Math.abs(y) * 0.02;
                return 10 + 8 * u + Math.abs(y) * 0.05;
            };
            const x0 = u0 * length;
            const x1 = u1 * length;
            const vA = -1 + 2 * v0;
            const vB = -1 + 2 * v1;
            const y00 = yOf(u0, vA);
            const y10 = yOf(u1, vA);
            const y01 = yOf(u0, vB);
            const y11 = yOf(u1, vB);
            pushTri(x0, y00, zOf(u0, y00), x1, y10, zOf(u1, y10), x1, y11, zOf(u1, y11));
            pushTri(x0, y00, zOf(u0, y00), x1, y11, zOf(u1, y11), x0, y01, zOf(u0, y01));
        }
    }
    const foot = new THREE.BufferGeometry();
    foot.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (side === "right") {
        foot.applyMatrix4(new THREE.Matrix4().makeScale(1, -1, 1));
    }
    return foot;
}

function bundle(heightMm: number, side: "left" | "right") {
    const geometry = archHeightScan(heightMm, side);
    return { side, geometry, display: buildScanDisplayInfo(geometry), keepSetApproved: true };
}

describe("medial/lateral landmarks", () => {
    test("left foot: M1 is medial to M2 on width axis", () => {
        const foot = syntheticFootGeometry();
        const sug = suggestScanLandmarks(foot, "left");
        expect(sug).not.toBeNull();
        const sign = medialWidthSignForSide("left");
        expect(sug!.M1.y * sign).toBeGreaterThan(sug!.M2.y * sign);
        foot.dispose();
    });

    test("right foot: M1 is medial to M2 on width axis", () => {
        const foot = syntheticFootGeometry(270, "right");
        const sug = suggestScanLandmarks(foot, "right");
        expect(sug).not.toBeNull();
        const sign = medialWidthSignForSide("right");
        expect(sug!.M1.y * sign).toBeGreaterThan(sug!.M2.y * sign);
        foot.dispose();
    });
});

describe("generateOrthoticFromScanAndRx", () => {
    test("left scan sets the arch class and leaves the baseline untouched", () => {
        const foot = bundle(20, "left");
        const baseline = createDesignWithStockPlaceholder(defaultDesign());
        const before = JSON.stringify(baseline);
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: baseline,
            scans: [foot],
            shoeSize: { system: "us", value: 9 },
        });
        if (!out.ok) throw new Error(`${out.failedStep}: ${out.reason}`);
        expect(out.perFoot[0]?.side).toBe("left");
        expect(out.design.corrections.left.archHeightMm).toBe(-3.5);
        expect(JSON.stringify(baseline)).toBe(before);
        foot.geometry.dispose();
    });

    test("Rx applies only to the prescribed side (left)", () => {
        const foot = bundle(24, "left");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [foot],
            shoeSize: { system: "us", value: 9 },
            prescriptionText: "Left: 4° rearfoot varus, medial skive 4 mm",
        });
        if (!out.ok) throw new Error(`${out.failedStep}: ${out.reason}`);
        expect(out.design.corrections.left.medialSkiveMm).toBe(4);
        expect(out.design.corrections.left.rearfootWedge).toEqual({ side: "medial", value: 4, unit: "deg" });
        expect(out.design.corrections.right.medialSkiveMm).toBe(0);
        expect(out.design.corrections.right.rearfootWedge).toBeUndefined();
        foot.geometry.dispose();
    });

    test("deterministic corrections for identical inputs", () => {
        const foot = bundle(26.1, "left");
        const baseline = createDesignWithStockPlaceholder(defaultDesign());
        const input = {
            baselineDesign: baseline,
            scans: [foot],
            shoeSize: { system: "us" as const, value: 10 },
            prescriptionText: "Left heel lift 3 mm",
        };
        const a = generateOrthoticFromScanAndRx(input);
        const b = generateOrthoticFromScanAndRx(input);
        if (!a.ok || !b.ok) throw new Error("expected success");
        expect(a.design.corrections.left.archHeightMm).toBe(3);
        expect(a.design.corrections.left.heelLiftMm).toBe(3);
        expect(a.design.usMenSize).toBe(10);
        expect(JSON.stringify(a.design.corrections)).toBe(JSON.stringify(b.design.corrections));
        foot.geometry.dispose();
    });

    test("unchanged default design when generation fails early", () => {
        const baseline = createDesignWithStockPlaceholder(defaultDesign());
        const before = JSON.stringify(baseline.corrections);
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: baseline,
            scans: [],
            shoeSize: { system: "us", value: 9 },
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.failedStep).toBe("scan");
        expect(JSON.stringify(baseline.corrections)).toBe(before);
    });
});

describe("mergeScanFitWithPrescription", () => {
    test("Rx arch height overrides scan fit", () => {
        const rx = heuristicParse("Left arch 12 mm");
        const { merged } = mergeScanFitWithPrescription({
            side: "left",
            scanFit: { archHeightMm: 3, apexMoveMm: 1 },
            rx,
        });
        expect(merged.archHeightMm).toBe(12);
    });
});
