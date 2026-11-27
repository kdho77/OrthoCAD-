// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { generateOrthoticFromScanAndRx } from "@/lib/clinical/generateOrthoticFromScanAndRx";
import {
    measurePlantarArch,
    measureScanArchHeightMm,
    type PlantarArchMeasurement,
    resolveScanArchAssignment,
    SCAN_ARCH_TIER_CONFIG,
    tierForNormalizedArchMm,
} from "@/lib/clinical/measure-scan-arch";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { heightAt } from "@/lib/geometry/height-field";
import { buildScanDisplayInfo } from "@/lib/geometry/scan-display";
import { createDesignWithStockPlaceholder, defaultDesign } from "@/stores/design-store";
import type { SideCorrections } from "@/types";
import { plantarArchScan } from "../../../../tests/helpers/arch-height-scan";

function corrections(archHeightMm: number): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        forefootWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(archHeightMm: number): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: 3,
        corrections: corrections(archHeightMm),
        includeElements: false,
        includeSkives: false,
    };
}

function fakeMeasurement(
    measuredArchMm: number,
    footLengthMm = 260,
    lowCoverage = false,
): PlantarArchMeasurement {
    return {
        measuredArchMm: lowCoverage ? null : measuredArchMm,
        archApexU: lowCoverage ? null : 0.45,
        apexLocal: lowCoverage ? null : { x: 117, y: 20, z: measuredArchMm },
        footLengthMm,
        forefootWidthMm: 90,
        heelWidthMm: 62,
        forefootVarusDeg: 1.2,
        rearfootAngleDeg: -0.4,
        plantarBandTriangles: lowCoverage ? 1 : 40,
        lowCoverage,
        likelyArtifact: measuredArchMm < 5 || measuredArchMm > 45,
        landmarksPlaced: true,
        reviewFlags: lowCoverage
            ? ["Low plantar coverage in the arch band — Medium until the scan is reviewed"]
            : [],
    };
}

describe("arch tier bins", () => {
    test("21.75 and 25.0 are Medium; outside those edges is Low or High", () => {
        expect(tierForNormalizedArchMm(21.749)).toBe("low");
        expect(tierForNormalizedArchMm(21.75)).toBe("medium");
        expect(tierForNormalizedArchMm(25)).toBe("medium");
        expect(tierForNormalizedArchMm(25.001)).toBe("high");
        expect(SCAN_ARCH_TIER_CONFIG.tiers.low.deltaMm).toBe(-3.5);
        expect(SCAN_ARCH_TIER_CONFIG.tiers.medium.deltaMm).toBe(0);
        expect(SCAN_ARCH_TIER_CONFIG.tiers.high.deltaMm).toBe(3);
        expect(SCAN_ARCH_TIER_CONFIG.tiers.low.absoluteMm).toBe(20);
        expect(SCAN_ARCH_TIER_CONFIG.tiers.medium.absoluteMm).toBe(23.5);
        expect(SCAN_ARCH_TIER_CONFIG.tiers.high.absoluteMm).toBe(26.5);
        expect(SCAN_ARCH_TIER_CONFIG.lengthNormalization).toBe(true);
        expect(SCAN_ARCH_TIER_CONFIG.scanModeOffsetMm).toEqual({ NWB: 0, "semi-WB": 0, FWB: 0 });
    });

    test("length normalization uses 260 / L and can be turned off", () => {
        const short = fakeMeasurement(20, 200);
        const on = resolveScanArchAssignment({ measurement: short, captureMode: "NWB" });
        const off = resolveScanArchAssignment({
            measurement: short,
            lengthNormalization: false,
            captureMode: "FWB",
        });
        expect(on.record.normalizedArchMm).toBeCloseTo(26, 5);
        expect(on.record.assignedArchTier).toBe("high");
        expect(on.record.archHeightDeltaMm).toBe(3);
        expect(off.record.normalizedArchMm).toBeCloseTo(20, 5);
        expect(off.record.assignedArchTier).toBe("low");
        expect(off.record.archHeightDeltaMm).toBe(-3.5);
        expect(off.record.scanCaptureMode).toBe("FWB");
    });

    test("no plantar coverage falls back to Medium", () => {
        const resolved = resolveScanArchAssignment({ measurement: fakeMeasurement(30, 260, true) });
        expect(resolved.record.assignmentSource).toBe("fallback_no_scan");
        expect(resolved.record.assignedArchTier).toBe("medium");
        expect(resolved.record.archHeightDeltaMm).toBe(0);
        expect(resolved.record.assignedArchHeightMm).toBe(23.5);
        expect(resolved.record.reviewFlags.some((flag) => /coverage|apex/i.test(flag))).toBe(true);
    });
});

describe("plantar arch golden scans", () => {
    test("Low, Medium, and High scans are deterministic and set the tier delta", () => {
        const cases = [
            { height: 20, tier: "low" as const, delta: -3.5, absolute: 20 as const },
            { height: 23.5, tier: "medium" as const, delta: 0, absolute: 23.5 as const },
            { height: 27, tier: "high" as const, delta: 3, absolute: 26.5 as const },
        ];
        for (const row of cases) {
            const scan = plantarArchScan({ archHeightMm: row.height, lengthMm: 260 });
            const first = measurePlantarArch({
                geometry: scan.geometry,
                side: "left",
                landmarks: scan.landmarks,
            });
            const second = measurePlantarArch({
                geometry: scan.geometry,
                side: "left",
                landmarks: scan.landmarks,
            });
            expect(JSON.stringify(first), String(row.height)).toBe(JSON.stringify(second));
            expect(first.measuredArchMm, String(row.height)).toBeCloseTo(row.height, 1);
            expect(first.archApexU, String(row.height)).toBeGreaterThan(0.35);
            expect(first.archApexU!, String(row.height)).toBeLessThan(0.55);
            const resolved = resolveScanArchAssignment({ measurement: first });
            expect(resolved.record.assignedArchTier, String(row.height)).toBe(row.tier);
            expect(resolved.record.archHeightDeltaMm, String(row.height)).toBe(row.delta);
            expect(resolved.record.assignedArchHeightMm, String(row.height)).toBe(row.absolute);
            expect(resolved.record.assignmentSource).toBe("scan_measured");
            expect(resolved.record.measuredArchMm).toBeCloseTo(row.height, 1);
            scan.geometry.dispose();
        }
    });

    test("a steep medial wall and an upward cap are not the arch", () => {
        for (const side of ["left", "right"] as const) {
            const scan = plantarArchScan({
                side,
                archHeightMm: 23.5,
                lengthMm: 260,
                decoyHeightMm: 40,
            });
            const pos = scan.geometry.getAttribute("position");
            let maxZ = -Infinity;
            for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i));
            expect(maxZ, side).toBeCloseTo(40, 5);
            const measured = measurePlantarArch({
                geometry: scan.geometry,
                side,
                landmarks: scan.landmarks,
            });
            expect(measured.measuredArchMm, side).toBeCloseTo(23.5, 1);
            expect(measured.measuredArchMm!, side).toBeLessThan(30);
            const resolved = resolveScanArchAssignment({ measurement: measured });
            expect(resolved.record.assignedArchTier, side).toBe("medium");
            expect(resolved.record.archHeightDeltaMm, side).toBe(0);
            scan.geometry.dispose();
        }
    });

    test("an empty arch band falls back to Medium", () => {
        const scan = plantarArchScan({ archHeightMm: 30, omitArchBand: true });
        const measured = measurePlantarArch({
            geometry: scan.geometry,
            side: "left",
            landmarks: scan.landmarks,
        });
        const resolved = resolveScanArchAssignment({ measurement: measured });
        expect(measured.lowCoverage).toBe(true);
        expect(resolved.record.assignmentSource).toBe("fallback_no_scan");
        expect(resolved.record.assignedArchTier).toBe("medium");
        expect(resolved.record.archHeightDeltaMm).toBe(0);
        scan.geometry.dispose();
    });

    test("dragging the arch marker recomputes from that point", () => {
        const scan = plantarArchScan({ archHeightMm: 23.5, lengthMm: 260 });
        const auto = measurePlantarArch({
            geometry: scan.geometry,
            side: "left",
            landmarks: scan.landmarks,
        });
        const dragged = measurePlantarArch({
            geometry: scan.geometry,
            side: "left",
            landmarks: scan.landmarks,
            manualApex: { x: scan.heelSeat.x, y: scan.heelSeat.y, z: scan.heelSeat.z },
        });
        const resolved = resolveScanArchAssignment({
            measurement: dragged,
            markerSource: "manual_override",
        });
        expect(auto.measuredArchMm).toBeCloseTo(23.5, 1);
        expect(dragged.measuredArchMm).toBeCloseTo(0, 1);
        expect(resolved.record.assignmentSource).toBe("manual_override");
        expect(resolved.record.assignedArchTier).toBe("low");
        expect(resolved.record.archHeightDeltaMm).toBe(-3.5);
        expect(resolved.record.reviewFlags.some((flag) => /artifact/i.test(flag))).toBe(true);
        scan.geometry.dispose();
    });

    test("left and right tiers stay independent on the default mesh", () => {
        const left = plantarArchScan({ side: "left", archHeightMm: 20, lengthMm: 260 });
        const right = plantarArchScan({ side: "right", archHeightMm: 27, lengthMm: 260 });
        const baseline = createDesignWithStockPlaceholder(defaultDesign());
        const before = JSON.stringify(baseline);
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: baseline,
            scans: [
                {
                    side: "left",
                    geometry: left.geometry,
                    display: buildScanDisplayInfo(left.geometry),
                    markers: {
                        M1: left.landmarks.m1,
                        M2: left.landmarks.m5,
                        M3: left.landmarks.heel,
                        ARCH: null,
                    },
                    keepSetApproved: true,
                },
                {
                    side: "right",
                    geometry: right.geometry,
                    display: buildScanDisplayInfo(right.geometry),
                    markers: {
                        M1: right.landmarks.m1,
                        M2: right.landmarks.m5,
                        M3: right.landmarks.heel,
                        ARCH: null,
                    },
                    keepSetApproved: true,
                },
            ],
            shoeSize: { system: "us", value: 9 },
            prescriptionText: "Left pronation, raise the arch",
        });
        if (!out.ok) throw new Error(out.reason);
        expect(JSON.stringify(baseline)).toBe(before);
        expect(out.design.corrections.left.archHeightMm).toBe(-3.5);
        expect(out.design.corrections.right.archHeightMm).toBe(3);
        expect(out.design.corrections.left.rearfootPostingDeg).toBe(0);
        expect(out.design.corrections.right.forefootPostingDeg).toBe(0);
        expect(out.perFoot.find((foot) => foot.side === "left")?.scanArch.assignmentSource).toBe(
            "pathology_guardrail",
        );
        expect(out.perFoot.find((foot) => foot.side === "right")?.scanArch.assignmentSource).toBe(
            "scan_measured",
        );
        expect(out.design.scanArchBySide?.left?.assignedArchTier).toBe("low");
        expect(out.design.scanArchBySide?.right?.assignedArchHeightMm).toBe(26.5);
        expect(out.design.corrections.linked).toBe(false);
        left.geometry.dispose();
        right.geometry.dispose();
    });

    test("an explicit arch tier overrides the scan and warns above 5 mm", () => {
        const scan = plantarArchScan({ archHeightMm: 20, lengthMm: 260 });
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [
                {
                    side: "left",
                    geometry: scan.geometry,
                    display: buildScanDisplayInfo(scan.geometry),
                    markers: {
                        M1: scan.landmarks.m1,
                        M2: scan.landmarks.m5,
                        M3: scan.landmarks.heel,
                        ARCH: null,
                    },
                    keepSetApproved: true,
                },
            ],
            shoeSize: { system: "us", value: 9 },
            prescriptionText: "Left arch tier high",
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.design.corrections.left.archHeightMm).toBe(3);
        expect(out.perFoot[0]?.scanArch.assignmentSource).toBe("rx_explicit_override");
        expect(out.perFoot[0]?.scanArch.assignedArchTier).toBe("high");
        expect(out.warnings.some((warning) => warning.includes("more than 5 mm"))).toBe(true);
        scan.geometry.dispose();
    });

    test("the tier delta is the same archHeightMm the parametric mesh evaluates", () => {
        const scan = plantarArchScan({ archHeightMm: 27, lengthMm: 260 });
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [
                {
                    side: "left",
                    geometry: scan.geometry,
                    display: buildScanDisplayInfo(scan.geometry),
                    keepSetApproved: true,
                },
            ],
            shoeSize: { system: "us", value: 9 },
        });
        if (!out.ok) throw new Error(out.reason);
        const delta = out.design.corrections.left.archHeightMm;
        expect(delta).toBe(3);
        expect(out.perFoot[0]?.scanArch.archHeightDeltaMm).toBe(delta);
        const u = 0.42;
        const v = 0.86;
        expect(heightAt(u, v, field(delta)) - heightAt(u, v, field(0))).toBeCloseTo(delta, 1);
        const direct = measureScanArchHeightMm(scan.geometry, "left", 1);
        expect(direct?.heightMm).toBeGreaterThan(25);
        scan.geometry.dispose();
    });
});
