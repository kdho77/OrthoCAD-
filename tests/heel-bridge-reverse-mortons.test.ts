// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Design 2be9d906 / order 2a31cd8e: reverse Morton's on both feet at the
// default 3 mm, shell thickness 3 mm, US men's 7.5 Medium. Headless Generate
// refused the solid because heelBridgeSelfIntersections was 4 (left) against
// the procedural baseline of 0.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { defaultElementPose } from "@/lib/geometry/elements";
import { buildValidatedExportGeometry } from "@/lib/geometry/export-geometry";
import { countHeelBridgeSelfIntersections, validateManifold } from "@/lib/geometry/mesh-close";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { DesignState, PlacedElement, Side } from "@/types";

const originalFetch = globalThis.fetch;
const sampleBytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
});

function installSampleTopFetch(): void {
    globalThis.fetch = (async () => new Response(sampleBytes)) as typeof fetch;
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
}

function reverseMortons(side: Side, lengthMm: number, widthMm: number): PlacedElement {
    const pose = defaultElementPose("reverse_mortons", side, lengthMm, widthMm);
    return {
        id: `reverse_mortons-${side}`,
        kind: "reverse_mortons",
        side,
        position: pose.position,
        rotationDeg: pose.rotationDeg,
        scale: pose.scale,
        heightMm: pose.heightMm,
        ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
    };
}

function useDesign(design: DesignState): void {
    useDesignStore.setState({
        design,
        viewer: {
            transparent: false,
            heightmap: false,
            showLeft: true,
            showRight: true,
            showScans: true,
            view: "iso",
            wallModel: "procedural",
            wallStyle: "round",
        },
    });
}

async function exportSide(side: Side): Promise<{
    si: number;
    openEdges: number;
    nonManifoldEdges: number;
    euler: number;
    watertight: boolean;
    md5: string;
}> {
    const geometry = await buildValidatedExportGeometry(side);
    try {
        const report = validateManifold(geometry);
        const topN = (geometry.userData as { topVertexCount?: number }).topVertexCount ?? 0;
        const md5 = createHash("md5")
            .update(Buffer.from(geometryToBinarySTL(geometry)))
            .digest("hex");
        return {
            si: countHeelBridgeSelfIntersections(geometry, topN),
            openEdges: report.openEdges,
            nonManifoldEdges: report.nonManifoldEdges,
            euler: report.eulerCharacteristic,
            watertight: report.isWatertight,
            md5,
        };
    } finally {
        geometry.dispose();
    }
}

describe("heel bridge with reverse Morton's", () => {
    for (const side of ["left", "right"] as const) {
        test(`${side} US_M 7.5 Medium thickness 3 reverse_mortons L+R exports watertight`, async () => {
            installSampleTopFetch();
            const layout = insoleLayoutForUsMenSize(7.5);
            const design = createDesignWithStockPlaceholder({
                ...defaultDesign(),
                sizeSystem: "us",
                usMenSize: layout.usMenSize,
                footLengthMm: layout.footLengthMm,
                thicknessMm: 3,
                shoeWidth: "medium",
                elements: [
                    reverseMortons("left", layout.lengthMm, layout.widthMm),
                    reverseMortons("right", layout.lengthMm, layout.widthMm),
                ],
            });
            expect(design.elements.every((element) => element.heightMm === 3)).toBe(true);
            useDesign(design);
            const solid = await exportSide(side);
            expect(solid.si).toBe(0);
            expect(solid.openEdges).toBe(0);
            expect(solid.nonManifoldEdges).toBe(0);
            expect(solid.euler).toBe(2);
            expect(solid.watertight).toBe(true);
        }, 300_000);
    }
});

describe("SAMPLE_Top stock is unchanged by the reverse Morton's rim hold", () => {
    test("default stock, no corrections, left", async () => {
        installSampleTopFetch();
        useDesign(createDesignWithStockPlaceholder(defaultDesign()));
        const solid = await exportSide("left");
        // Binary STL of the closed solid on current main, no corrections.
        expect(solid.md5).toBe("96969efc2727da8e85e063e59c6bbda4");
        expect(solid.si).toBe(0);
        expect(solid.watertight).toBe(true);
        expect(solid.euler).toBe(2);
        expect(solid.openEdges).toBe(0);
    }, 180_000);

    test("US_M 7.5 Medium thickness 3, no elements, left", async () => {
        installSampleTopFetch();
        const layout = insoleLayoutForUsMenSize(7.5);
        useDesign(
            createDesignWithStockPlaceholder({
                ...defaultDesign(),
                sizeSystem: "us",
                usMenSize: layout.usMenSize,
                footLengthMm: layout.footLengthMm,
                thicknessMm: 3,
                shoeWidth: "medium",
                elements: [],
            }),
        );
        const solid = await exportSide("left");
        // Same shell as main: thickness 3, US 7.5 Medium, no elements.
        expect(solid.md5).toBe("7c3d22733d9f4ef22bc34dfb92d5dc30");
        expect(solid.si).toBe(0);
        expect(solid.watertight).toBe(true);
        expect(solid.euler).toBe(2);
        expect(solid.openEdges).toBe(0);
    }, 180_000);
});
