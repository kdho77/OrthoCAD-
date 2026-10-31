// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { heuristicParse } from "@/features/ai-prescription/heuristic";
import { generateOrthoticFromScanAndRx } from "@/lib/clinical/generateOrthoticFromScanAndRx";
import { medialWidthSignForSide } from "@/lib/clinical/medial-sign";
import { mergeScanFitWithPrescription } from "@/lib/clinical/resolve-rx-vs-scan-corrections";
import { clearMarkerFrameRegistry, registerRawBaseGeometry } from "@/lib/geometry/marker-frame";
import { buildScanDisplayInfo } from "@/lib/geometry/scan-display";
import { suggestScanLandmarks } from "@/lib/geometry/scan-landmark-suggest";
import { extractMergedGeometry, loadGlbFromBuffer, reorientToFootprintFrame } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder, defaultDesign } from "@/stores/design-store";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");
const SOURCE_ID = "test-sample-top";

const mockClinicalMatch = () => ({
    correction: { archHeightMm: 2.5, apexMoveMm: 0, archFillMm: 0 },
    message: "mock arch fit",
    archSource: "gap" as const,
    heel: null,
});

let rawBase: THREE.BufferGeometry;

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

beforeAll(async () => {
    clearMarkerFrameRegistry();
    const buf = readFileSync(FIXTURE);
    const group = await loadGlbFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const merged = extractMergedGeometry(group);
    if (!merged) throw new Error("fixture load failed");
    rawBase = reorientToFootprintFrame(merged.geometry);
    registerRawBaseGeometry(SOURCE_ID, rawBase, { primarySide: "left" });
});

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
    test("left scan end-to-end succeeds with auto landmarks", () => {
        const foot = syntheticFootGeometry();
        const display = buildScanDisplayInfo(foot);
        const baseline = createDesignWithStockPlaceholder(defaultDesign());
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: baseline,
            scans: [
                {
                    side: "left",
                    geometry: foot,
                    display,
                    markers: { M1: null, M2: null, M3: null, ARCH: null },
                    suggestedLandmarks: suggestScanLandmarks(foot, "left"),
                    keepSetApproved: true,
                },
            ],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE_ID,
            prescription: null,
            matchClinical: mockClinicalMatch,
        });
        if (!out.ok) throw new Error(`${out.failedStep}: ${out.reason}`);
        expect(out.perFoot[0]?.side).toBe("left");
        expect(out.design.corrections.left.archHeightMm).toBe(2.5);
        foot.dispose();
    });

    test("Rx applies only to the prescribed side (left)", () => {
        const foot = syntheticFootGeometry(270, "left");
        const display = buildScanDisplayInfo(foot);
        const rx = heuristicParse("Left medial heel skive 4mm");
        const baseline = createDesignWithStockPlaceholder({
            ...defaultDesign(),
            corrections: {
                ...defaultDesign().corrections,
                linked: false,
            },
        });
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: baseline,
            scans: [
                {
                    side: "left",
                    geometry: foot,
                    display,
                    markers: { M1: null, M2: null, M3: null, ARCH: null },
                    suggestedLandmarks: suggestScanLandmarks(foot, "left"),
                    keepSetApproved: true,
                },
            ],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE_ID,
            prescription: rx,
            matchClinical: mockClinicalMatch,
        });
        if (!out.ok) throw new Error(`${out.failedStep}: ${out.reason}`);
        expect(out.design.corrections.left.medialSkiveMm).toBeGreaterThan(0);
        expect(out.design.corrections.right.medialSkiveMm ?? 0).toBe(0);
        foot.dispose();
    });

    test("deterministic corrections for identical inputs", () => {
        const foot = syntheticFootGeometry(265);
        const display = buildScanDisplayInfo(foot);
        const sug = suggestScanLandmarks(foot, "left");
        const baseline = createDesignWithStockPlaceholder(defaultDesign());
        const input = {
            baselineDesign: baseline,
            scans: [
                {
                    side: "left" as const,
                    geometry: foot,
                    display,
                    markers: { M1: null, M2: null, M3: null, ARCH: null },
                    suggestedLandmarks: sug,
                    keepSetApproved: true,
                },
            ],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE_ID,
            prescription: null,
            matchClinical: mockClinicalMatch,
        };
        const a = generateOrthoticFromScanAndRx(input);
        const b = generateOrthoticFromScanAndRx(input);
        if (!a.ok || !b.ok) throw new Error("expected success");
        expect(JSON.stringify(a.design.corrections)).toBe(JSON.stringify(b.design.corrections));
        foot.dispose();
    });

    test("unchanged default design when generation fails early", () => {
        const baseline = createDesignWithStockPlaceholder(defaultDesign());
        const before = JSON.stringify(baseline.corrections);
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: baseline,
            scans: [],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE_ID,
            prescription: null,
        });
        expect(out.ok).toBe(false);
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
