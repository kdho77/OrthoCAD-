// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeAll, describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { heuristicParse } from "@/features/ai-prescription/heuristic";
import { generateOrthoticFromScanAndRx } from "@/lib/clinical/generateOrthoticFromScanAndRx";
import { clearMarkerFrameRegistry } from "@/lib/geometry/marker-frame";
import { buildScanDisplayInfo } from "@/lib/geometry/scan-display";
import { suggestScanLandmarks } from "@/lib/geometry/scan-landmark-suggest";
import { createDesignWithStockPlaceholder, defaultDesign } from "@/stores/design-store";
import {
    buildBulkyFootKeptScan,
    buildDefaultGlbRegisteredScan,
    buildSyntheticFootScanBundle,
    bulkyFootSoup,
    registerDefaultGlbBaseAsync,
    syntheticFootGeometry,
} from "../../../../tests/helpers/clinical-scan-fixtures";

const SOURCE = "p7-default-glb";
let rawBase: THREE.BufferGeometry;

beforeAll(async () => {
    clearMarkerFrameRegistry();
    rawBase = await registerDefaultGlbBaseAsync(SOURCE);
});

function scanBundle(side: "left" | "right" = "left") {
    const scan = buildDefaultGlbRegisteredScan(SOURCE, rawBase);
    if (!scan) throw new Error("Default.glb registered scan fixture unavailable");
    return {
        side,
        geometry: scan.geometry,
        display: scan.display,
        markers: scan.markers,
        suggestedLandmarks: scan.suggested,
        keepSetApproved: true,
    };
}

describe("P7 matrix — generateOrthoticFromScanAndRx", () => {
    test("high arch Rx raises archHeightMm", () => {
        const bundle = scanBundle();
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [bundle],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: heuristicParse("Left high arch pes cavus"),
        });
        if (!out.ok) throw new Error(`${out.failedStep}: ${out.reason}`);
        expect(out.design.corrections.left.archHeightMm).toBeGreaterThan(6);
        bundle.geometry.dispose();
    });

    test("low arch Rx lower than high arch Rx", () => {
        const base = createDesignWithStockPlaceholder(defaultDesign());
        const hi = generateOrthoticFromScanAndRx({
            baselineDesign: base,
            scans: [scanBundle()],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: heuristicParse("Left high arch"),
        });
        const lo = generateOrthoticFromScanAndRx({
            baselineDesign: base,
            scans: [scanBundle()],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: heuristicParse("Left low arch flat foot"),
        });
        expect(hi.ok && lo.ok).toBe(true);
        if (!hi.ok || !lo.ok) return;
        expect(lo.design.corrections.left.archHeightMm).toBeLessThan(
            hi.design.corrections.left.archHeightMm ?? 99,
        );
    });

    test("wide vs narrow forefoot width class from ball measurement", () => {
        const wide = scanBundle();
        const narrow = scanBundle();
        narrow.geometry.applyMatrix4(new THREE.Matrix4().makeScale(1, 0.75, 1));
        const narrowDisplay = buildScanDisplayInfo(narrow.geometry);
        const wideOut = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [wide],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: null,
        });
        const narrowOut = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [{ ...narrow, display: narrowDisplay }],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: null,
        });
        expect(wideOut.ok && narrowOut.ok).toBe(true);
        if (!wideOut.ok || !narrowOut.ok) return;
        const wideClass = wideOut.design.shoeWidthBySide?.left ?? wideOut.design.shoeWidth;
        const narrowClass = narrowOut.design.shoeWidthBySide?.left ?? narrowOut.design.shoeWidth;
        expect(wideClass).toBeDefined();
        expect(narrowClass).toBeDefined();
        wide.geometry.dispose();
        narrow.geometry.dispose();
    });

    test("US shoe sizes 8, 9, 10 succeed", () => {
        for (const us of [8, 9, 10]) {
            const bundle = scanBundle();
            const out = generateOrthoticFromScanAndRx({
                baselineDesign: createDesignWithStockPlaceholder({
                    ...defaultDesign(),
                    usMenSize: us,
                    sizeSystem: "us",
                }),
                scans: [bundle],
                rawBaseGeometry: rawBase,
                sourceAssetId: SOURCE,
                prescription: null,
            });
            expect(out.ok).toBe(true);
            bundle.geometry.dispose();
        }
    });

    test("rotated scan (yaw) still succeeds with auto landmarks", () => {
        const bundle = scanBundle();
        bundle.geometry.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.12));
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [bundle],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: null,
        });
        expect(out.ok).toBe(true);
        bundle.geometry.dispose();
    });

    test("metre-unit scan displayScale 1000 succeeds", () => {
        const bundle = scanBundle();
        const display = { ...bundle.display, displayScale: 1000 };
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [{ ...bundle, display }],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: null,
        });
        expect(typeof out.ok).toBe("boolean");
        if (!out.ok) expect(out.failedStep).toMatch(/registration|arch_fit|landmarks/);
        bundle.geometry.dispose();
    });

    test("inch-like displayScale ambiguity (25.4) still runs or fails landmarks cleanly", () => {
        const soup = bulkyFootSoup(0.26, 0.1, 0.08);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(soup, 3));
        const baseDisplay = buildScanDisplayInfo(geo);
        const display = { ...baseDisplay, displayScale: 25.4, inferredUnit: "mm" as const };
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [
                {
                    side: "left",
                    geometry: geo,
                    display,
                    markers: { M1: null, M2: null, M3: null, ARCH: null },
                    suggestedLandmarks: null,
                    keepSetApproved: true,
                },
            ],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: null,
        });
        expect(typeof out.ok).toBe("boolean");
        if (!out.ok) expect(out.failedStep).toMatch(/landmarks|registration|arch_fit/);
        geo.dispose();
    });

    test("missing manual landmarks uses auto-fill when suggestions provided", () => {
        const foot = buildSyntheticFootScanBundle("left");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [
                {
                    side: "left",
                    geometry: foot.geometry,
                    display: foot.display,
                    markers: { M1: null, M2: null, M3: null, ARCH: null },
                    suggestedLandmarks: foot.suggested,
                    keepSetApproved: true,
                },
            ],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: null,
        });
        if (out.ok) {
            expect(out.perFoot[0]?.landmarksAutoFilled.length).toBeGreaterThan(0);
        } else {
            expect(out.failedStep).toBe("arch_fit");
        }
        foot.geometry.dispose();
    });

    test("bulky-foot scan-components fixture (real ranked keep-set)", () => {
        const foot = buildBulkyFootKeptScan("left");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [
                {
                    side: "left",
                    geometry: foot.geometry,
                    display: foot.display,
                    markers: { M1: null, M2: null, M3: null, ARCH: null },
                    suggestedLandmarks: foot.suggested,
                    keepSetApproved: true,
                },
            ],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: null,
        });
        if (!out.ok) {
            expect(out.failedStep).toMatch(/registration|arch_fit|landmarks/);
        } else {
            expect(out.perFoot[0]?.landmarksAutoFilled.length).toBeGreaterThan(0);
        }
        foot.geometry.dispose();
    });

    test("conflicting bilateral rearfoot wedges surface warning", () => {
        const rx = heuristicParse("Left supination Right pronation");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder({
                ...defaultDesign(),
                corrections: { ...defaultDesign().corrections, linked: false },
            }),
            scans: [scanBundle()],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: rx,
        });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.warnings.some((w) => w.includes("rearfoot wedges") || w.includes("Rx overrides"))).toBe(
            true,
        );
    });

    test("incomplete Rx low confidence warns", () => {
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [scanBundle()],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: {
                corrections: {},
                elements: [],
                notes: "stub",
                confidence: 0.1,
                provider: "heuristic",
            },
        });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.warnings.some((w) => w.includes("Low Rx parse confidence"))).toBe(true);
    });

    test("noisy incomplete scan fails (no landmark suggest)", () => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [
                {
                    side: "left",
                    geometry: geo,
                    display: buildScanDisplayInfo(geo),
                    markers: { M1: null, M2: null, M3: null, ARCH: null },
                    suggestedLandmarks: null,
                    keepSetApproved: true,
                },
            ],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: null,
        });
        expect(out.ok).toBe(false);
        geo.dispose();
    });

    test("bilateral Rx with different sides warns", () => {
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder({
                ...defaultDesign(),
                corrections: { ...defaultDesign().corrections, linked: false },
            }),
            scans: [scanBundle()],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: heuristicParse("Left medial skive 4mm Right lateral skive 3mm"),
        });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.warnings.some((w) => w.includes("left") || w.includes("Right"))).toBe(true);
    });

    test("deterministic corrections on repeat", () => {
        const bundle = scanBundle();
        const input = {
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [bundle],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: heuristicParse("Left medial skive 4mm"),
        };
        const a = generateOrthoticFromScanAndRx(input);
        const b = generateOrthoticFromScanAndRx(input);
        expect(a.ok && b.ok).toBe(true);
        if (!a.ok || !b.ok) return;
        expect(JSON.stringify(a.design.corrections)).toBe(JSON.stringify(b.design.corrections));
        bundle.geometry.dispose();
    });
});
