// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, Color, Vector3 } from "three";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, Side } from "@/types";
import { getBaseFootprintFrame } from "./base-modifier";
import { applyElementsToTopMeshLast } from "./element-assets/apply-elements";
import {
    applyDesignElementColors,
    DESIGN_ELEMENT_COLOR,
    ELEMENT_IDS_KEY,
    ELEMENT_LIFT_ATTRIBUTE,
    ELEMENT_OWNER_ATTRIBUTE,
    MIN_VISIBLE_RAISE_MM,
} from "./element-visualization";
import { defaultElementPose } from "./elements";
import { medialSign } from "./handedness";
import { sampleTopFromArrayBuffer } from "./procedural-wall/sample-top-preview";
import { clipGeometryToOutline } from "./trimline";

const purple = new Color(DESIGN_ELEMENT_COLOR);

function isPurple(geometry: BufferGeometry, index: number): boolean {
    return Math.abs(geometry.getAttribute("color").getX(index) - purple.r) < 1e-5;
}

describe("design element visualization", () => {
    test("colors actual lift only, supports selection and resets heightmap colors", () => {
        const geometry = new BufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array([0, 0, 20, 0, 1, 20, 0, 2, 20]), 3),
        );
        geometry.setAttribute(ELEMENT_LIFT_ATTRIBUTE, new BufferAttribute(new Float32Array([2, 0, -2]), 1));
        geometry.setAttribute(ELEMENT_OWNER_ATTRIBUTE, new BufferAttribute(new Float32Array([1, 0, 0]), 1));
        geometry.userData[ELEMENT_IDS_KEY] = ["placed"];
        applyDesignElementColors(geometry);
        expect(isPurple(geometry, 0)).toBe(true);
        expect(geometry.getAttribute("color").getX(1)).toBe(1);
        expect(geometry.getAttribute("color").getX(2)).toBe(1);
        applyDesignElementColors(geometry, true, "placed");
        expect(geometry.getAttribute("color").getY(0)).toBeCloseTo(new Color("#22c55e").g, 5);
        applyDesignElementColors(geometry, false);
        expect(Array.from(geometry.getAttribute("color").array)).toEqual(new Array(9).fill(1));
        geometry.deleteAttribute(ELEMENT_LIFT_ATTRIBUTE);
        applyDesignElementColors(geometry);
        expect(Array.from(geometry.getAttribute("color").array)).toEqual(new Array(9).fill(1));
        geometry.dispose();
    });

    test("Dancer GLB colors match actual raised vertices on both feet and survive trim clipping", async () => {
        const bytes = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
        const raw = await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        for (const side of ["left", "right"] as Side[]) {
            const base = side === "left" ? mirrorGeometry(raw) : raw.clone();
            const frame = getBaseFootprintFrame(base, side);
            for (const placementMode of ["flow", "noFlow"] as const) {
                const element: PlacedElement = {
                    id: `dancer-${side}`,
                    kind: "dancers_pad",
                    side,
                    position: { x: frame.lenSize * 0.14, y: 3 },
                    rotationDeg: 23,
                    scale: { x: 0.9, y: 1.1 },
                    heightMm: 2.5,
                    placementMode,
                };
                const composed = base.clone();
                await applyElementsToTopMeshLast(
                    composed,
                    base,
                    {
                        side,
                        lengthMm: frame.lenSize,
                        widthMm: frame.widSize,
                        thicknessMm: 3,
                        elements: [element],
                        corrections: {
                            forefootPostingDeg: 0,
                            rearfootPostingDeg: 0,
                            medialSkiveMm: 0,
                            lateralSkiveMm: 0,
                            archFillMm: 0,
                            archHeightMm: 0,
                            archEaseMm: 0,
                            heelCupDepthMm: 0,
                            heelCupHeightMm: 0,
                            heelCupWidthMm: 0,
                            heelLiftMm: 0,
                            apexMoveMm: 0,
                            medialFlangeMm: 0,
                            lateralFlangeMm: 0,
                        },
                    },
                    { subdivide: false },
                );
                applyDesignElementColors(composed);
                const original = base.getAttribute("position");
                const positions = composed.getAttribute("position");
                let raised = 0;
                let unchanged = 0;
                for (let i = 0; i < positions.count; i++) {
                    const delta =
                        positions.getComponent(i, frame.thickAxis) -
                        original.getComponent(i, frame.thickAxis);
                    expect(isPurple(composed, i)).toBe(delta > MIN_VISIBLE_RAISE_MM);
                    if (delta > MIN_VISIBLE_RAISE_MM) raised++;
                    else unchanged++;
                }
                expect(raised).toBeGreaterThan(20);
                expect(unchanged).toBeGreaterThan(20);
                const clipped = clipGeometryToOutline(
                    composed,
                    {
                        points: [
                            new Vector3(frame.lenMin, -100, 0),
                            new Vector3(frame.lenMin + frame.lenSize * 0.8, -100, 0),
                            new Vector3(frame.lenMin + frame.lenSize * 0.8, 100, 0),
                            new Vector3(frame.lenMin, 100, 0),
                        ],
                    },
                    0,
                );
                applyDesignElementColors(clipped);
                expect(clipped.userData[ELEMENT_IDS_KEY]).toEqual([element.id]);
                const lift = clipped.getAttribute(ELEMENT_LIFT_ATTRIBUTE);
                expect(lift.count).toBe(clipped.getAttribute("position").count);
                for (let i = 0; i < lift.count; i++)
                    expect(isPurple(clipped, i)).toBe(lift.getX(i) > MIN_VISIBLE_RAISE_MM);
                clipped.dispose();
                composed.dispose();
            }
            base.dispose();
        }
        raw.dispose();
    }, 120_000);

    test("Morton's extension raises and colors the medial 1st-ray strip on the export mesh", async () => {
        const bytes = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
        const raw = await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        const corrections = {
            forefootPostingDeg: 0,
            rearfootPostingDeg: 0,
            medialSkiveMm: 0,
            lateralSkiveMm: 0,
            archFillMm: 0,
            archHeightMm: 0,
            archEaseMm: 0,
            heelCupDepthMm: 0,
            heelCupHeightMm: 0,
            heelCupWidthMm: 0,
            heelLiftMm: 0,
            apexMoveMm: 0,
            medialFlangeMm: 0,
            lateralFlangeMm: 0,
        };
        try {
            for (const side of ["left", "right"] as Side[]) {
                const base = side === "right" ? mirrorGeometry(raw) : raw.clone();
                const frame = getBaseFootprintFrame(base, side);
                const pose = defaultElementPose("mortons_extension", side, frame.lenSize, frame.widSize);
                const element: PlacedElement = {
                    id: `mortons-${side}`,
                    kind: "mortons_extension",
                    side,
                    ...pose,
                };
                const composed = base.clone();
                await applyElementsToTopMeshLast(
                    composed,
                    base,
                    {
                        side,
                        lengthMm: frame.lenSize,
                        widthMm: frame.widSize,
                        thicknessMm: 3,
                        elements: [element],
                        corrections,
                    },
                    { subdivide: false },
                );
                applyDesignElementColors(composed);
                const original = base.getAttribute("position");
                const positions = composed.getAttribute("position");
                const sign = medialSign(side);
                let medialRaise = 0;
                let lateralRaise = 0;
                let purple = 0;
                for (let i = 0; i < positions.count; i++) {
                    const delta =
                        positions.getComponent(i, frame.thickAxis) -
                        original.getComponent(i, frame.thickAxis);
                    const u = (original.getComponent(i, frame.lengthAxis) - frame.lenMin) / frame.lenSize;
                    const meshY = original.getComponent(i, frame.widthAxis) - frame.widCenter;
                    if (u < 0.62 || u > 0.96) continue;
                    if (meshY * sign > 0) medialRaise = Math.max(medialRaise, delta);
                    else lateralRaise = Math.max(lateralRaise, delta);
                    if (isPurple(composed, i)) purple++;
                }
                expect(medialRaise).toBeGreaterThan(1);
                expect(lateralRaise).toBeLessThan(0.25);
                expect(purple).toBeGreaterThan(0);
                composed.dispose();
                base.dispose();
            }
        } finally {
            raw.dispose();
        }
    }, 120_000);
});
