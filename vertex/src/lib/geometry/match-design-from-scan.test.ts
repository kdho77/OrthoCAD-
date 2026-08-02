// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import {
    ARCH_MATCH_MAX_RMS_MM,
    archFitReferenceFromBaseSized,
    gateArchMatch,
    isDefaultShoeSize,
    shouldAutoApplySize,
} from "@/lib/geometry/match-design-from-scan";
import type { SizeSuggestion } from "@/lib/geometry/measure-foot-from-scan";
import { insoleLayoutForUsMenSize, scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";

function boxGeometry(lengthMm: number, widthMm: number): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions: number[] = [];
    for (let i = 0; i <= 10; i++) {
        for (let j = 0; j <= 6; j++) {
            positions.push((lengthMm * i) / 10, -widthMm / 2 + (widthMm * j) / 6, 2);
        }
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.userData.topVertexCount = positions.length / 3;
    return geo;
}

describe("gateArchMatch", () => {
    test("warns but allows clinical-range registration RMS", () => {
        const g = gateArchMatch({
            residualRmsMm: 25,
            incomplete: false,
            error: null,
            hasRawBase: true,
            sizeAccepted: true,
        });
        expect(g.ok).toBe(true);
        if (g.ok) expect(g.warning).toMatch(/25/);
    });

    test("refuses absurd registration RMS", () => {
        const g = gateArchMatch({
            residualRmsMm: 80,
            incomplete: false,
            error: null,
            hasRawBase: true,
            sizeAccepted: true,
        });
        expect(g.ok).toBe(false);
        if (!g.ok) expect(g.code).toBe("rms");
    });

    test("allows RMS at the warn threshold without warning", () => {
        const g = gateArchMatch({
            residualRmsMm: ARCH_MATCH_MAX_RMS_MM,
            incomplete: false,
            error: null,
            hasRawBase: true,
            sizeAccepted: true,
        });
        expect(g.ok).toBe(true);
        if (g.ok) expect(g.warning).toBeUndefined();
    });
});

describe("shouldAutoApplySize / isDefaultShoeSize", () => {
    test("default Men’s 9 is default", () => {
        expect(isDefaultShoeSize({ usMenSize: 9, sizeSystem: "us" })).toBe(true);
        expect(isDefaultShoeSize({ usMenSize: 11, sizeSystem: "us" })).toBe(false);
    });

    test("auto-apply only for in-range high/medium confidence on default size", () => {
        const layout = insoleLayoutForUsMenSize(10);
        const suggestion: SizeSuggestion = {
            footLengthMm: layout.footLengthMm,
            ballWidthMm: 95,
            usMenSize: 10,
            ukSize: layout.ukSize,
            layout,
            confidence: "high",
            warnings: [],
            inRange: true,
        };
        expect(shouldAutoApplySize({ usMenSize: 9 }, suggestion)).toBe(true);
        expect(shouldAutoApplySize({ usMenSize: 11 }, suggestion)).toBe(false);
        expect(
            shouldAutoApplySize({ usMenSize: 9 }, { ...suggestion, confidence: "low", inRange: false }),
        ).toBe(false);
    });
});

describe("archFitReferenceFromBaseSized", () => {
    test("scales reference length to the target layout", () => {
        const native = boxGeometry(260, 95);
        const sizedLayout = insoleLayoutForUsMenSize(12);
        const ref = archFitReferenceFromBaseSized(native, sizedLayout.lengthMm, sizedLayout.widthMm);
        expect(ref.kind).toBe("base");
        if (ref.kind !== "base") return;
        expect(ref.lengthSize).toBeCloseTo(sizedLayout.lengthMm, 5);
        // Matches scaleGeometryToInsoleSize footprint.
        const scaled = scaleGeometryToInsoleSize(native, sizedLayout.lengthMm, sizedLayout.widthMm);
        scaled.computeBoundingBox();
        const box = scaled.boundingBox;
        expect(box).toBeTruthy();
        if (!box) return;
        expect(box.max.x - box.min.x).toBeCloseTo(ref.lengthSize, 5);
        native.dispose();
        scaled.dispose();
    });
});
