// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { TubeGeometry, Vector3 } from "three";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { defaultElementPose } from "@/lib/geometry/elements";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { applyShoeWidthToPoints, type ShoeWidthId, shoeWidthExtentOfPoints } from "@/lib/geometry/shoe-width";
import { extractMeshOutline, trimlineToCurve } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState, PlacedElement, TextMarking } from "@/types";
import { composePrintSolidTop } from "./procedural-wall/print-solid-compose";
import { printSolidOptions } from "./procedural-wall/print-solid-options";
import {
    applyExportText,
    loadSampleTopGeometry,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "./procedural-wall/sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");

const WIDTH_SWITCH: ShoeWidthId[] = ["medium", "wide", "medium", "narrow", "extra_wide"];

function patientNameMarking(): TextMarking {
    return {
        text: "",
        addPatientName: true,
        surface: "bottom",
        mode: "engrave",
        bold: true,
        capHeightMm: 4,
        depthMm: 0.6,
        heightMm: 0.6,
        letterSpacingMm: 0,
        rotationDeg: 0,
        placementU: 0.42,
        anchor: "arch",
        feet: "both",
        differentOnLR: false,
        textLeft: "",
        textRight: "",
        nudgeAlongMm: 0,
        nudgeAcrossMm: 0,
    };
}

/** L/R insole with the corrections on the reported design. Heel-cup width stays 0. */
function designAt(width: ShoeWidthId): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.shoeWidth = width;
    design.shoeWidthBySide = { left: width, right: width };
    const patch = {
        heelCupDepthMm: 12,
        heelCupHeightMm: 9,
        heelCupWidthMm: 0,
        heelLiftMm: 4,
        medialFlangeMm: 3,
        lateralFlangeMm: 2,
        rearfootWedge: {
            side: "medial" as const,
            value: 4,
            unit: "deg" as const,
            degreeMode: "station" as const,
        },
        forefootWedge: {
            side: "lateral" as const,
            value: 3,
            unit: "deg" as const,
            degreeMode: "station" as const,
        },
    };
    design.corrections = {
        ...design.corrections,
        linked: true,
        left: { ...design.corrections.left, ...patch },
        right: { ...design.corrections.right, ...patch },
    };
    const layout = insoleLayoutFromDesign(design);
    const elements: PlacedElement[] = [];
    for (const side of ["left", "right"] as const) {
        for (const kind of ["met_pad", "mortons_extension"] as const) {
            const pose = defaultElementPose(kind, side, layout.lengthMm, layout.widthMm);
            elements.push({
                id: `${kind}-${side}`,
                kind,
                side,
                position: pose.position,
                rotationDeg: pose.rotationDeg,
                scale: pose.scale,
                heightMm: pose.heightMm,
                ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
            });
        }
    }
    design.elements = elements;
    design.textMarking = patientNameMarking();
    return design;
}

function assertFinitePoints(
    points: readonly { x: number; y: number; z?: number }[],
    label: string,
    minCount = 4,
) {
    expect(points.length, label).toBeGreaterThanOrEqual(minCount);
    for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.z != null && !Number.isFinite(p.z))) {
            throw new Error(`${label} non-finite point ${i}`);
        }
    }
}

/** Same tube the trimline overlay builds during render. NaN Y throws distanceToSquared. */
function tubeClosedOutline(points: readonly { x: number; y: number; z?: number }[]) {
    const display = points.map((p) => new Vector3(p.x, p.y, (p.z ?? 0) + 1.5));
    const curve = trimlineToCurve(display, true);
    const tube = new TubeGeometry(curve, Math.max(48, display.length * 2), 0.35, 8, true);
    const pos = tube.getAttribute("position");
    expect(pos.count).toBeGreaterThan(8);
    tube.dispose();
}

function assertMesh(
    geo: { getAttribute: (name: string) => { count: number; array: ArrayLike<number> } | undefined },
    label: string,
) {
    const pos = geo.getAttribute("position");
    expect(pos, label).toBeTruthy();
    expect(pos!.count, label).toBeGreaterThan(100);
    const arr = pos!.array;
    for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i]!)) throw new Error(`${label} non-finite position at ${i}`);
    }
}

async function loadTemplate() {
    resetSampleTopGeometryCache();
    const bytes = readFileSync(SAMPLE_TOP_PATH);
    primeSampleTopGeometry(
        await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        ),
    );
}

describe("shoe width change", () => {
    test("a missing X extent no longer writes NaN Y onto a wide outline", () => {
        const pts = [
            { x: 0, y: -20, z: 0 },
            { x: 40, y: -30, z: 0 },
            { x: 120, y: 10, z: 0 },
            { x: 200, y: -15, z: 0 },
            { x: 80, y: 25, z: 0 },
        ];
        const extent = shoeWidthExtentOfPoints(pts);
        const honest = applyShoeWidthToPoints(pts, "wide", {
            ballWidthMm: 95,
            heelWidthMm: 95 * 0.62,
            minX: extent.minX,
            lengthMm: extent.lengthMm,
        });
        const missing = applyShoeWidthToPoints(pts, "wide", {
            ballWidthMm: 95,
            heelWidthMm: 95 * 0.62,
            minX: undefined as unknown as number,
            lengthMm: Number.NaN,
        });
        assertFinitePoints(honest, "honest wide");
        assertFinitePoints(missing, "missing extent");
        for (let i = 0; i < pts.length; i++) {
            expect(missing[i]!.y).toBeCloseTo(honest[i]!.y, 6);
            expect(missing[i]!.x).toBe(pts[i]!.x);
        }
        const medium = applyShoeWidthToPoints(pts, "medium", {
            ballWidthMm: 95,
            heelWidthMm: 95 * 0.62,
            minX: undefined as unknown as number,
            lengthMm: Number.NaN,
        });
        expect(medium).toBe(pts);
        tubeClosedOutline(honest);
        tubeClosedOutline(missing);
    });

    test("Medium, Wide, Narrow, and Extra Wide keep a finite outline tube and a valid L/R mesh", async () => {
        await loadTemplate();
        const raw = await loadSampleTopGeometry();
        const outline = extractMeshOutline(raw);
        expect(outline).toBeTruthy();
        const points = outline!.points;
        const extent = shoeWidthExtentOfPoints(points);
        const layout = insoleLayoutFromDesign(designAt("medium"));
        for (const width of WIDTH_SWITCH) {
            const scaled = applyShoeWidthToPoints(points, width, {
                ballWidthMm: layout.widthMm,
                heelWidthMm: layout.widthMm * 0.62,
                minX: extent.minX,
                lengthMm: extent.lengthMm,
            });
            assertFinitePoints(scaled, `outline ${width}`, 9);
            tubeClosedOutline(scaled);
            if (width === "medium") {
                expect(scaled).toBe(points);
            } else {
                expect(scaled.some((p, i) => p.y !== points[i]!.y)).toBe(true);
            }
        }

        for (const side of ["left", "right"] as const) {
            for (const width of WIDTH_SWITCH) {
                const design = designAt(width);
                const field = baseModifierFieldAuthoritative(design, side, design.thicknessMm);
                const options = printSolidOptions({
                    design,
                    side,
                    field,
                    viewer: {
                        wallModel: "procedural",
                        wallStyle: "round",
                        lateralFlangeHeightMm: 8,
                        lateralFlangeLengthMm: 40,
                    },
                    trimline: null,
                    bottomPattern: null,
                });
                options.patientDisplayName = "Barbara Fleming";
                const top = side === "right" ? mirrorGeometry(raw) : raw.clone();
                const label = `${side} ${width}`;
                const mesh = await composePrintSolidTop(top, {
                    sourceField: field,
                    shoeWidth: options.shoeWidth,
                    trimline: null,
                });
                assertMesh(mesh, label);
                if (width === "wide") {
                    const named = await applyExportText(mesh, { ...options, side });
                    assertMesh(named, `${label} name`);
                    if (named !== mesh) named.dispose();
                }
                if (mesh !== top) mesh.dispose();
                top.dispose();
            }
        }
        raw.dispose();
    }, 400_000);
});
