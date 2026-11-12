// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { type BufferGeometry, Euler, Vector3 } from "three";
import {
    BASE_REFERENCE_THICKNESS_MM,
    getBaseFootprintFrame,
    vertexFootprintAt,
} from "@/lib/geometry/base-modifier";
import { applyElementsToTopMeshLast, rimBandFadeFactor } from "@/lib/geometry/element-assets/apply-elements";
import {
    loadTransformedAssetPositions,
    resolvePlacedAssetContexts,
} from "@/lib/geometry/element-assets/element-asset";
import { sampleGridBilinear } from "@/lib/geometry/element-assets/height-grid";
import { anchorMmFromPlacement } from "@/lib/geometry/element-assets/no-flow-blend";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { ElementKind, PlacedElement, Side, SideCorrections } from "@/types";
import {
    defaultElementPose,
    ELEMENT_HEIGHT_LIMITS,
    ELEMENT_PROFILES,
    elementFootprintT,
    elementHeightAt,
    elementOutlineLocalMm,
    elementPlacementRefusal,
    loweringMaterialWarning,
    REMAINING_MATERIAL_MM,
    RKW_END_FEATHER_MM,
    RKW_TAPER_MM,
    repositionLegacyFirstRayDesign,
    rkwPlanMm,
} from "./elements";
import { heightFieldYFromMeshY, meshYForAnatomicalSide, meshYSign } from "./handedness";
import {
    MORTONS_FILLET_MM,
    MORTONS_HEIGHT_DEFAULT_MM,
    MORTONS_HEIGHT_MAX_MM,
    MORTONS_HEIGHT_WARN_MM,
    MORTONS_NARROW_LENGTH_MM,
    MORTONS_NARROW_WARN_MM,
    MORTONS_SCALE_MIN,
    MORTONS_TAPER_LATERAL_MM,
    MORTONS_TAPER_PROXIMAL_MM,
    MORTONS_U_CORNER,
    MORTONS_U_DIP,
    MORTONS_V_LATERAL,
    mortonsEdgeMm,
    mortonsExtensionMetrics,
    mortonsExtensionWarnings,
    mortonsFilletRadiusMm,
    mortonsLocalOutline,
    mortonsLocalWidthMm,
    mortonsPlanScale,
    mortonsProximalU,
    mortonsWeightAtUV,
} from "./mortons-extension";
import { insoleLayoutForUsMenSize, scaleGeometryToInsoleSize } from "./shoe-size";
import { SINK_PROFILES } from "./sink";
import { instanceWorldPosition, projectViewNdcX } from "./viewport-side-layout";

const KINDS = Object.keys(ELEMENT_PROFILES) as ElementKind[];

describe("anatomical element footprints", () => {
    test("every stock kind declares a clinical shape profile", () => {
        for (const kind of KINDS) {
            const p = ELEMENT_PROFILES[kind];
            expect(p.rxMm).toBeGreaterThan(2);
            expect(p.ryMm).toBeGreaterThan(2);
            expect(p.defaultHeightMm).toBeGreaterThan(0);
            expect(p.defaultU).toBeGreaterThan(0);
            expect(p.defaultU).toBeLessThan(1);
            expect([
                "teardrop",
                "met_bar",
                "hallux_wedge",
                "first_ray_strip",
                "reverse_mortons",
                "kinetic_oval",
                "heel_cup",
                "navicular_oval",
                "scaphoid_pad",
                "heel_cushion",
                "dancers_pad",
            ]).toContain(p.shape);
        }
    });

    test("met pad is a proximal-tip teardrop (narrow heelward, wide distal)", () => {
        const { rxMm: rx, ryMm: ry } = ELEMENT_PROFILES.met_pad;
        // Proximal tip corridor is narrow.
        expect(elementFootprintT("met_pad", -rx * 0.85, 0, rx, ry)).toBeLessThan(1);
        expect(elementFootprintT("met_pad", -rx * 0.85, ry * 0.55, rx, ry)).toBeGreaterThan(1);
        // Distal bulb is wider.
        expect(elementFootprintT("met_pad", rx * 0.35, ry * 0.7, rx, ry)).toBeLessThan(1);
        // Outside far field.
        expect(elementFootprintT("met_pad", rx * 1.4, 0, rx, ry)).toBeGreaterThan(1);
    });

    test("met bar is elongated medio-laterally and short anteroposteriorly", () => {
        const { rxMm: rx, ryMm: ry } = ELEMENT_PROFILES.met_bar;
        expect(ry).toBeGreaterThan(rx * 2);
        expect(elementFootprintT("met_bar", 0, 0, rx, ry)).toBeLessThan(0.2);
        expect(elementFootprintT("met_bar", 0, ry * 0.85, rx, ry)).toBeLessThan(1);
        expect(elementFootprintT("met_bar", rx * 1.2, 0, rx, ry)).toBeGreaterThan(1);
    });

    test("Morton's extension is long AP and narrow ML", () => {
        const { rxMm: rx, ryMm: ry } = ELEMENT_PROFILES.mortons_extension;
        expect(rx).toBeGreaterThan(ry);
        expect(elementFootprintT("mortons_extension", rx * 0.7, 0, rx, ry)).toBeLessThan(1);
        expect(elementFootprintT("mortons_extension", 0, ry * 1.2, rx, ry)).toBeGreaterThan(1);
    });

    test("Morton's extension defaults to the medial 1st ray at 3 mm, mirrored left and right", () => {
        expect(ELEMENT_PROFILES.mortons_extension.defaultHeightMm).toBe(3);
        const length = 260;
        const width = 95;
        const left = defaultElementPose("mortons_extension", "left", length, width);
        const right = defaultElementPose("mortons_extension", "right", length, width);
        expect(left.heightMm).toBe(3);
        expect(right.heightMm).toBe(3);
        expect(Math.sign(left.position.y)).toBe(meshYSign("left", "medial"));
        expect(Math.sign(right.position.y)).toBe(meshYSign("right", "medial"));
        expect(right.position.y).toBeCloseTo(-left.position.y, 5);
        expect(right.position.x).toBeCloseTo(left.position.x, 5);
        expect(left.position.y).toBeLessThan(0);
        expect(right.position.y).toBeGreaterThan(0);

        for (const side of ["left", "right"] as const) {
            const pose = side === "left" ? left : right;
            const el: PlacedElement = {
                id: side,
                kind: "mortons_extension",
                side,
                position: pose.position,
                rotationDeg: pose.rotationDeg,
                scale: pose.scale,
                heightMm: pose.heightMm,
            };
            const x = length / 2 + pose.position.x;
            const onRay = elementHeightAt([el], x, heightFieldYFromMeshY(pose.position.y), length);
            const offRay = elementHeightAt([el], x, pose.position.y, length);
            expect(onRay).toBeGreaterThan(2);
            expect(offRay).toBe(0);
            expect(pose.position.x).toBeGreaterThan(length * 0.15);
        }
    });

    test("Cluffy wedge tapers to a distal apex", () => {
        const { rxMm: rx, ryMm: ry } = ELEMENT_PROFILES.cluffy_wedge;
        // Broad proximal base.
        expect(elementFootprintT("cluffy_wedge", -rx * 0.7, ry * 0.55, rx, ry)).toBeLessThan(1);
        // Narrow near distal apex.
        expect(elementFootprintT("cluffy_wedge", rx * 0.7, ry * 0.55, rx, ry)).toBeGreaterThan(1);
        expect(elementFootprintT("cluffy_wedge", rx * 0.7, 0, rx, ry)).toBeLessThan(1);
    });

    test("reverse Morton's uses the Morton's footprint and lowers the 1st ray", () => {
        expect(ELEMENT_PROFILES.reverse_mortons.sign).toBe(-1);
        expect(ELEMENT_PROFILES.reverse_mortons.shape).toBe("first_ray_strip");
        expect(ELEMENT_PROFILES.reverse_mortons.defaultHeightMm).toBe(3);
        const length = 300;
        const width = 100 * (100 / mortonsLocalWidthMm(0.7, 100));
        const raised = mortonsExtensionMetrics(length, width, "left");
        const lowered = mortonsExtensionMetrics(length, width, "left");
        expect(lowered.forefootPadMm).toBeCloseTo(raised.forefootPadMm, 4);
        expect(lowered.lengthMm).toBeCloseTo(raised.lengthMm, 4);
        const pose = defaultElementPose("reverse_mortons", "left", length, width);
        const morton = defaultElementPose("mortons_extension", "left", length, width);
        expect(pose.position).toEqual(morton.position);
        const el = (kind: "mortons_extension" | "reverse_mortons"): PlacedElement => ({
            id: kind,
            kind,
            side: "left",
            ...pose,
        });
        const x = length / 2 + pose.position.x;
        const y = heightFieldYFromMeshY(pose.position.y);
        const up = elementHeightAt([el("mortons_extension")], x, y, length, width);
        const down = elementHeightAt([el("reverse_mortons")], x, y, length, width);
        expect(up).toBeCloseTo(3, 1);
        expect(down).toBeCloseTo(-3, 1);
    });

    test("every procedural footprint mirrors across width without reversing heel/toe", () => {
        for (const kind of KINDS) {
            const { rxMm: rx, ryMm: ry } = ELEMENT_PROFILES[kind];
            for (const x of [-0.8, -0.2, 0.4, 0.9]) {
                for (const y of [-0.8, -0.3, 0.2, 0.7]) {
                    expect(elementFootprintT(kind, x * rx, y * ry, rx, ry, "left")).toBeCloseTo(
                        elementFootprintT(kind, x * rx, -y * ry, rx, ry, "right"),
                        8,
                    );
                }
            }
        }
    });

    test("outline sampling produces a closed clinical polygon for each kind", () => {
        for (const kind of KINDS) {
            const pts = elementOutlineLocalMm(kind, 1, 1, "left", 36);
            expect(pts.length).toBeGreaterThanOrEqual(6);
            // Finite, non-degenerate extents.
            const xs = pts.map((p) => p.x);
            const ys = pts.map((p) => p.y);
            expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(4);
            expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(4);
        }
    });

    test("default poses place pads near anatomical landmarks, not midfoot origin", () => {
        const met = defaultElementPose("met_pad", "left");
        expect(met.position.x).toBeCloseTo((0.5473 - 0.5) * 260, 5);
        expect(met.heightMm).toBe(ELEMENT_PROFILES.met_pad.defaultHeightMm);

        const heel = defaultElementPose("heel_sink", "left");
        expect(heel.position.x).toBeLessThan(-50);

        const cluffyL = defaultElementPose("cluffy_wedge", "left");
        const cluffyR = defaultElementPose("cluffy_wedge", "right");
        expect(cluffyL.position.y).toBeLessThan(0); // medial left
        expect(cluffyR.position.y).toBeGreaterThan(0); // medial right
    });

    test("Cluffy starts toward the hallux in the displayed pair on both feet and across sizes", () => {
        for (const [length, width] of [
            [230, 85],
            [260, 95],
            [290, 105],
        ]) {
            for (const side of ["left", "right"] as const) {
                const pose = defaultElementPose("cluffy_wedge", side, length, width);
                const origin = instanceWorldPosition(side);
                const placed = new Vector3(pose.position.x, pose.position.y, 0)
                    .applyEuler(new Euler(-Math.PI / 2, 0, 0))
                    .add(origin);
                expect(Math.abs(projectViewNdcX("top", placed))).toBeLessThan(
                    Math.abs(projectViewNdcX("top", origin)),
                );
                expect(pose.position.x).toBeCloseTo((0.7744 - 0.5) * length, 5);
                expect(pose.rotationDeg).toBe(0);
            }
        }
    });

    test("elementHeightAt produces a positive dome inside a met pad", () => {
        const el: PlacedElement = {
            id: "t",
            kind: "met_pad",
            side: "left",
            position: { x: 40, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 3,
        };
        const lengthMm = 260;
        const cx = lengthMm / 2 + el.position.x;
        const inside = elementHeightAt([el], cx, 0, lengthMm);
        const outside = elementHeightAt([el], cx + 40, 0, lengthMm);
        expect(inside).toBeGreaterThan(1);
        expect(outside).toBe(0);
    });

    test("Morton's default footprint follows the 1st-ray u/v spec on both feet", () => {
        const sizes: Array<[number, number]> = [
            [230, 85],
            [260, 95],
            [320, 117],
        ];
        for (const [length, width] of sizes) {
            for (const side of ["left", "right"] as const) {
                const metrics = mortonsExtensionMetrics(length, width, side);
                const forefoot = mortonsLocalWidthMm(0.7, width, side);
                expect(metrics.forefootPadMm / forefoot).toBeGreaterThanOrEqual(0.35);
                expect(metrics.forefootPadMm / forefoot).toBeLessThan(0.45);
                expect(metrics.minU).toBeLessThanOrEqual(MORTONS_U_CORNER + 0.005);
                expect(metrics.minU).toBeGreaterThanOrEqual(MORTONS_U_DIP - 0.01);
                expect(metrics.maxU).toBeGreaterThanOrEqual(0.999);
                expect(metrics.lengthMm / length).toBeCloseTo(1 - MORTONS_U_DIP, 2);
                const pose = defaultElementPose("mortons_extension", side, length, width);
                expect(pose.heightMm).toBe(MORTONS_HEIGHT_DEFAULT_MM);
                expect(Math.sign(pose.position.y)).toBe(meshYSign(side, "medial"));
            }
            const left = mortonsLocalOutline("left", length, width);
            const right = mortonsLocalOutline("right", length, width);
            expect(right.length).toBe(left.length);
            for (let i = 0; i < left.length; i++) {
                const l = left[i];
                const r = right[i];
                if (!l || !r) throw new Error("missing outline point");
                expect(r.x).toBeCloseTo(l.x, 4);
                expect(r.y).toBeCloseTo(-l.y, 4);
            }
        }
    });

    test("Morton's scales length by u and width by local v, with fixed fillet, taper, and thickness", () => {
        const adult = [240, 280, 320];
        const pads = adult.map((length) => {
            const width = 95 * (length / 260);
            return mortonsExtensionMetrics(length, width);
        });
        expect(pads[1]!.lengthMm / pads[0]!.lengthMm).toBeCloseTo(280 / 240, 2);
        expect(pads[2]!.forefootPadMm / pads[0]!.forefootPadMm).toBeCloseTo(320 / 240, 2);
        for (const length of adult) {
            expect(mortonsFilletRadiusMm(length, 95 * (length / 260))).toBeCloseTo(MORTONS_FILLET_MM, 0);
            const width = 95 * (length / 260);
            const span = mortonsLocalWidthMm(0.75, width);
            const vHalf = MORTONS_V_LATERAL - MORTONS_TAPER_LATERAL_MM / 2 / span;
            const half = mortonsWeightAtUV("left", length, width, 0.75, vHalf);
            expect(mortonsWeightAtUV("left", length, width, 0.75, MORTONS_V_LATERAL)).toBeLessThan(0.05);
            expect(half).toBeGreaterThan(0.4);
            expect(half).toBeLessThan(0.7);
            expect(
                mortonsWeightAtUV(
                    "left",
                    length,
                    width,
                    0.75,
                    MORTONS_V_LATERAL - (MORTONS_TAPER_LATERAL_MM + 1) / span,
                ),
            ).toBeGreaterThan(0.95);
            const uFull = mortonsProximalU(0.2, length) + (MORTONS_TAPER_PROXIMAL_MM + 2) / length;
            expect(mortonsWeightAtUV("left", length, width, uFull, 0.2)).toBeGreaterThan(0.95);
            const uFade = mortonsProximalU(0.2, length) + MORTONS_TAPER_PROXIMAL_MM / (2 * length);
            const fade = mortonsWeightAtUV("left", length, width, uFade, 0.2);
            expect(fade).toBeGreaterThan(0.3);
            expect(fade).toBeLessThan(0.8);
            expect(mortonsWeightAtUV("left", length, width, 0.85, 0.02)).toBeGreaterThan(0.95);
            expect(mortonsWeightAtUV("left", length, width, 0.995, 0.2)).toBeGreaterThan(0.95);
            expect(mortonsWeightAtUV("left", length, width, 0.2, 0.02)).toBe(0);
            expect(defaultElementPose("mortons_extension", "left", length, width).heightMm).toBe(3);
        }
        expect(ELEMENT_PROFILES.mortons_extension.defaultHeightMm).toBe(3);
        expect(ELEMENT_HEIGHT_LIMITS.mortons_extension?.max).toBe(MORTONS_HEIGHT_MAX_MM);
        const tall = mortonsExtensionWarnings({
            heightMm: MORTONS_HEIGHT_WARN_MM + 0.5,
            lengthMm: 260,
            padWidthMm: 40,
        });
        expect(tall.some((w) => w.includes("above 5"))).toBe(true);
        expect(mortonsExtensionWarnings({ heightMm: 3, lengthMm: 260, padWidthMm: 40 })).toEqual([]);
        // Thickness above the max is clamped in the solid.
        const pose = defaultElementPose("mortons_extension", "left", 260, 95);
        const el: PlacedElement = {
            id: "m",
            kind: "mortons_extension",
            side: "left",
            ...pose,
            heightMm: 8,
        };
        const x = 260 / 2 + pose.position.x;
        const raised = elementHeightAt([el], x, heightFieldYFromMeshY(pose.position.y), 260, 95);
        expect(raised).toBeLessThanOrEqual(MORTONS_HEIGHT_MAX_MM + 1e-6);
        expect(raised).toBeGreaterThan(MORTONS_HEIGHT_WARN_MM);
    });

    test("US M11.5 forefoot pad is about 40 mm, and a 300 mm insole is about 40×113 mm", () => {
        const live = insoleLayoutForUsMenSize(11.5);
        const livePad = mortonsExtensionMetrics(live.lengthMm, live.widthMm);
        expect(livePad.forefootPadMm).toBeGreaterThanOrEqual(38);
        expect(livePad.forefootPadMm).toBeLessThanOrEqual(42);
        expect(livePad.minU).toBeLessThanOrEqual(0.63);
        expect(livePad.maxU).toBeGreaterThanOrEqual(0.999);
        expect(livePad.forefootPadMm / livePad.forefootLocalWidthMm).toBeGreaterThanOrEqual(0.35);

        const length = 300;
        const spanAtUnit = mortonsLocalWidthMm(0.7, 100);
        const width = 100 * (100 / spanAtUnit);
        const pad = mortonsExtensionMetrics(length, width);
        expect(pad.proximalMm).toBeGreaterThanOrEqual(186);
        expect(pad.proximalMm).toBeLessThanOrEqual(189);
        expect(pad.lengthMm).toBeGreaterThanOrEqual(112);
        expect(pad.lengthMm).toBeLessThanOrEqual(114);
        expect(pad.forefootPadMm).toBeGreaterThanOrEqual(38);
        expect(pad.forefootPadMm).toBeLessThanOrEqual(42);
        expect(pad.forefootLocalWidthMm).toBeGreaterThanOrEqual(95);
        expect(pad.forefootLocalWidthMm).toBeLessThanOrEqual(105);
    });

    test("Morton's lateral border stays off the MPJ2 center and mirrors by the medial edge", () => {
        const length = 300;
        const width = 100 * (100 / mortonsLocalWidthMm(0.7, 100));
        const forefoot = mortonsLocalWidthMm(SINK_PROFILES.mpj2.u, width);
        const rimV = SINK_PROFILES.mpj2.v + SINK_PROFILES.mpj2.widthMm / 2 / forefoot;
        expect(MORTONS_V_LATERAL).toBeLessThan(rimV);
        expect(Math.abs(MORTONS_V_LATERAL - SINK_PROFILES.mpj2.v)).toBeGreaterThan(0.02);
        expect(MORTONS_V_LATERAL).toBeGreaterThan(SINK_PROFILES.mpj1.v);
        expect(MORTONS_V_LATERAL).toBeLessThan(0.5);
        const left = defaultElementPose("mortons_extension", "left", length, width);
        const right = defaultElementPose("mortons_extension", "right", length, width);
        expect(right.position.y).toBeCloseTo(-left.position.y, 5);
        expect(right.position.x).toBeCloseTo(left.position.x, 5);
        expect(left.position.y).toBeLessThan(0);
        expect(right.position.y).toBeGreaterThan(0);
    });

    test("a sparse insole outline does not pull the Morton's edge off the border", () => {
        const outline: { x: number; y: number }[] = [];
        for (let i = 0; i <= 16; i++) {
            const x = (i / 16) * 272;
            const half = 28 + 14 * Math.sin((i / 16) * Math.PI);
            outline.push({ x, y: -half });
        }
        for (let i = 16; i >= 0; i--) {
            const x = (i / 16) * 272;
            const half = 28 + 14 * Math.sin((i / 16) * Math.PI);
            outline.push({ x, y: half });
        }
        const pts = mortonsLocalOutline("left", 281, 103, 1, 1, outline);
        for (let i = 1; i < 12; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            if (!a || !b) throw new Error("missing outline point");
            expect(Math.abs(b.y - a.y)).toBeLessThan(6);
        }
        const metrics = mortonsExtensionMetrics(281, 103, "left", outline);
        expect(metrics.maxU).toBeGreaterThan(0.98);
        expect(metrics.forefootPadMm / metrics.forefootLocalWidthMm).toBeGreaterThan(0.35);
    });

    test("pediatric Morton's plan scale floors at 0.65 and a narrow pad warns under 200 mm", () => {
        expect(mortonsPlanScale(260)).toBeCloseTo(1, 6);
        expect(mortonsPlanScale(300)).toBeCloseTo(300 / 260, 6);
        expect(mortonsPlanScale(100)).toBe(MORTONS_SCALE_MIN);
        expect(mortonsPlanScale(0.65 * 260)).toBeCloseTo(MORTONS_SCALE_MIN, 6);
        const floorLen = (1 - MORTONS_U_DIP) * MORTONS_SCALE_MIN * 260;
        const tiny = mortonsExtensionMetrics(140, 95 * (140 / 260));
        const natural = (1 - MORTONS_U_DIP) * 140;
        expect(tiny.lengthMm).toBeGreaterThan(natural + 4);
        expect(tiny.lengthMm).toBeCloseTo(floorLen, 0);
        const short = mortonsExtensionMetrics(170, 95 * (170 / 260));
        expect(short.lengthMm).toBeLessThan(MORTONS_NARROW_LENGTH_MM);
        const narrow = mortonsExtensionWarnings({
            heightMm: 3,
            lengthMm: 170,
            padWidthMm: short.forefootPadMm,
        });
        expect(short.forefootPadMm).toBeLessThan(MORTONS_NARROW_WARN_MM);
        expect(narrow.some((w) => w.includes("under 25"))).toBe(true);
        const adult = mortonsExtensionWarnings({ heightMm: 3, lengthMm: 220, padWidthMm: 22 });
        expect(adult).toEqual([]);
    });

    test("kinetic wedge and sinks are subtractive", () => {
        expect(ELEMENT_PROFILES.kinetic_wedge.sign).toBe(-1);
        expect(ELEMENT_PROFILES.heel_sink.sign).toBe(-1);
        expect(ELEMENT_PROFILES.navicular_sink.sign).toBe(-1);
        expect(ELEMENT_PROFILES.reverse_mortons.sign).toBe(-1);
        expect(ELEMENT_PROFILES.met_pad.sign).toBe(1);
    });

    test("kinetic wedge is an elongated medial oval and a second one does not stack", () => {
        const length = 300;
        const width = 100;
        const edge = mortonsEdgeMm(0.665, width, "left");
        const span = Math.abs(edge.lateral - edge.medial);
        const plan = rkwPlanMm(length, span);
        expect(plan.lengthMm).toBeCloseTo(45, 3);
        expect(plan.widthMm).toBeCloseTo(Math.max(20, 0.32 * span), 3);
        const pose = defaultElementPose("kinetic_wedge", "left", length, width);
        const right = defaultElementPose("kinetic_wedge", "right", length, width);
        expect(pose.position.x).toBeCloseTo((0.665 - 0.5) * length, 4);
        expect(right.position.y).toBeCloseTo(-pose.position.y, 4);
        expect(pose.heightMm).toBe(2);
        const off = edge.medial - (pose.position.y - plan.widthMm / 2);
        expect(off).toBeGreaterThanOrEqual(-0.05);
        expect(off).toBeLessThanOrEqual(2.05);
        const one: PlacedElement = {
            id: "a",
            kind: "kinetic_wedge",
            side: "left",
            ...pose,
            heightMm: 4,
        };
        const x = length / 2 + pose.position.x;
        const y = heightFieldYFromMeshY(pose.position.y);
        const single = elementHeightAt([one], x, y, length, width);
        const stacked = elementHeightAt([one, { ...one, id: "b" }], x, y, length, width);
        expect(single).toBeLessThan(-1);
        expect(stacked).toBeCloseTo(single, 5);
        expect(Math.max(REMAINING_MATERIAL_MM, 3 + stacked)).toBeGreaterThanOrEqual(REMAINING_MATERIAL_MM);
        expect(elementPlacementRefusal("kinetic_wedge", "left", [one])).toMatch(/already/);
        expect(elementPlacementRefusal("mortons_extension", "left", [one])).toMatch(/cannot/);
        expect(elementPlacementRefusal("reverse_mortons", "left", [], ["rkw"])).toMatch(/override/);
        expect(
            elementPlacementRefusal("reverse_mortons", "left", [], ["rkw"], {
                allowReverseMortonsWithRkw: true,
            }),
        ).toBeNull();
        expect(loweringMaterialWarning(3, 4)).toMatch(/1.5/);
    });

    test("M11.5 Morton's and Reverse Morton's raise or lower the same medial first ray", () => {
        const layout = insoleLayoutForUsMenSize(11.5);
        const { lengthMm: length, widthMm: width } = layout;
        const kinds = ["mortons_extension", "reverse_mortons"] as const;
        for (const side of ["left", "right"] as const) {
            const poses = kinds.map((kind) => defaultElementPose(kind, side, length, width));
            const pose = poses[0];
            const other = poses[1];
            if (!pose || !other) throw new Error("missing pose");
            expect(other.position).toEqual(pose.position);
            expect(pose.heightMm).toBe(3);
            expect(other.heightMm).toBe(3);
            expect(Math.sign(pose.position.y)).toBe(meshYSign(side, "medial"));
            const el = (kind: (typeof kinds)[number]): PlacedElement => ({
                id: kind,
                kind,
                side,
                ...pose,
            });
            const x = length / 2 + pose.position.x;
            const onRay = heightFieldYFromMeshY(pose.position.y);
            const lateral = heightFieldYFromMeshY(meshYForAnatomicalSide(side, "lateral", width * 0.35));
            expect(elementHeightAt([el("mortons_extension")], x, onRay, length, width)).toBeCloseTo(3, 1);
            expect(elementHeightAt([el("reverse_mortons")], x, onRay, length, width)).toBeCloseTo(-3, 1);
            expect(elementHeightAt([el("mortons_extension")], x, lateral, length, width)).toBe(0);
            expect(elementHeightAt([el("reverse_mortons")], x, lateral, length, width)).toBe(0);
            const toe = length * 0.99;
            expect(elementHeightAt([el("mortons_extension")], toe, onRay, length, width)).toBeGreaterThan(2);
            expect(elementHeightAt([el("reverse_mortons")], toe, onRay, length, width)).toBeLessThan(-2);
            expect(elementHeightAt([el("mortons_extension")], length + 4, onRay, length, width)).toBe(0);
        }
        const left = defaultElementPose("reverse_mortons", "left", length, width);
        const right = defaultElementPose("reverse_mortons", "right", length, width);
        expect(right.position.x).toBeCloseTo(left.position.x, 5);
        expect(right.position.y).toBeCloseTo(-left.position.y, 5);
    });

    test("an untouched pre-#300 first-ray pose moves onto the medial ray and a moved pad stays", () => {
        const layout = insoleLayoutForUsMenSize(11.5);
        const { lengthMm: length, widthMm: width } = layout;
        const half = width / 2;
        const pad = (
            kind: "mortons_extension" | "reverse_mortons" | "met_pad",
            side: "left" | "right",
            x: number,
            y: number,
            heightMm: number,
            id = `${kind}-${side}`,
            extra: Partial<PlacedElement> = {},
        ): PlacedElement => ({
            id,
            kind,
            side,
            position: { x, y },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm,
            ...extra,
        });
        const current = defaultElementPose("mortons_extension", "left", length, width);
        const moved = pad("reverse_mortons", "right", 12, 4, 4, "moved");
        const rotated = pad(
            "mortons_extension",
            "left",
            0.78 * length - length / 2,
            0.5 * half,
            3,
            "rotated",
            { rotationDeg: 15 },
        );
        const scaled = pad(
            "reverse_mortons",
            "right",
            0.7 * length - length / 2,
            meshYForAnatomicalSide("right", "lateral", 0.1 * half),
            2.5,
            "scaled",
            { scale: { x: 1.2, y: 1 } },
        );
        const met = pad("met_pad", "left", 4, -8, 5, "met");
        const legacy = [
            pad("mortons_extension", "left", 0.78 * length - length / 2, 0.5 * half, 2, "hf-l"),
            pad("mortons_extension", "right", 0.78 * length - length / 2, -0.5 * half, 2, "hf-r"),
            pad("reverse_mortons", "left", 0.7 * length - length / 2, -0.1 * half, 2.5, "hf-rev-l"),
            pad("reverse_mortons", "right", 0.7 * length - length / 2, 0.1 * half, 2.5, "hf-rev-r"),
            pad(
                "mortons_extension",
                "left",
                0.78 * length - length / 2,
                meshYForAnatomicalSide("left", "medial", 0.5 * half),
                3,
                "mesh-l",
            ),
            pad(
                "reverse_mortons",
                "right",
                0.7 * length - length / 2,
                meshYForAnatomicalSide("right", "lateral", 0.1 * half),
                2.5,
                "mesh-rev-r",
            ),
            pad("mortons_extension", "left", current.position.x, current.position.y, 3, "current"),
            moved,
            rotated,
            scaled,
            met,
        ];
        const design = repositionLegacyFirstRayDesign({
            sizeSystem: "us",
            usMenSize: 11.5,
            elements: legacy,
        });
        const byId = new Map(design.elements.map((el) => [el.id, el]));
        const placedAt = (id: string) => {
            const el = byId.get(id);
            if (!el) throw new Error(`missing ${id}`);
            return el;
        };
        for (const id of ["hf-l", "hf-r", "mesh-l", "current"]) {
            const el = placedAt(id);
            const pose = defaultElementPose("mortons_extension", el.side, length, width);
            expect(el.position).toEqual(pose.position);
            expect(Math.sign(el.position.y)).toBe(meshYSign(el.side, "medial"));
        }
        for (const id of ["hf-rev-l", "hf-rev-r", "mesh-rev-r"]) {
            const el = placedAt(id);
            const pose = defaultElementPose("reverse_mortons", el.side, length, width);
            expect(el.position).toEqual(pose.position);
            expect(Math.sign(el.position.y)).toBe(meshYSign(el.side, "medial"));
        }
        expect(byId.get("hf-l")?.heightMm).toBe(2);
        expect(byId.get("hf-rev-l")?.heightMm).toBe(2.5);
        expect(byId.get("moved")?.position).toEqual(moved.position);
        expect(byId.get("rotated")?.position.y).toBeCloseTo(0.5 * half, 5);
        expect(byId.get("scaled")?.position.y).toBeCloseTo(
            meshYForAnatomicalSide("right", "lateral", 0.1 * half),
            5,
        );
        expect(byId.get("met")?.position).toEqual(met.position);
        const again = repositionLegacyFirstRayDesign(design);
        expect(again.elements.map((el) => el.position)).toEqual(design.elements.map((el) => el.position));
    });

    test("kinetic wedge long sides stay on the 6 mm taper and both ends use the 32 mm quintic", () => {
        const smooth = (t: number) => {
            const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
            return x * x * (3 - 2 * x);
        };
        for (const men of [9, 15] as const) {
            const layout = insoleLayoutForUsMenSize(men);
            for (const side of ["left", "right"] as const) {
                const edge = mortonsEdgeMm(0.665, layout.widthMm, side);
                const span = Math.abs(edge.lateral - edge.medial);
                const plan = rkwPlanMm(layout.lengthMm, span);
                const halfL = plan.lengthMm / 2;
                const halfW = plan.widthMm / 2;
                const pose = defaultElementPose("kinetic_wedge", side, layout.lengthMm, layout.widthMm);
                const el: PlacedElement = {
                    id: `kw-${men}-${side}`,
                    kind: "kinetic_wedge",
                    side,
                    ...pose,
                    heightMm: 4,
                };
                const anchorX = layout.lengthMm / 2 + pose.position.x;
                const y0 = heightFieldYFromMeshY(pose.position.y);
                const depthAt = (dx: number, dy = 0) =>
                    -elementHeightAt([el], anchorX + dx, y0 + dy, layout.lengthMm, layout.widthMm);
                expect(depthAt(0)).toBeCloseTo(4, 1);
                expect(depthAt(halfL - 1)).toBeGreaterThan(3.6);
                expect(depthAt(-(halfL - 1))).toBeGreaterThan(3.6);
                expect(depthAt(halfL + 6)).toBeGreaterThan(3.2);
                expect(depthAt(-(halfL + 6))).toBeGreaterThan(3.2);
                expect(depthAt(halfL + RKW_END_FEATHER_MM)).toBeLessThan(0.1);
                expect(depthAt(-(halfL + RKW_END_FEATHER_MM))).toBeLessThan(0.1);
                const h = 0.5;
                for (const dir of [1, -1]) {
                    const edgeX = dir * halfL;
                    const at = (d: number) => depthAt(edgeX + dir * d);
                    let maxSlope = 0;
                    let maxSecond = 0;
                    for (let d = 0; d <= RKW_END_FEATHER_MM; d += 1) {
                        const slope = (at(d + h) - at(d - h)) / (2 * h);
                        const second = (at(d + h) - 2 * at(d) + at(d - h)) / (h * h);
                        maxSlope = Math.max(maxSlope, Math.abs(slope));
                        maxSecond = Math.max(maxSecond, Math.abs(second));
                    }
                    expect(Math.abs((at(h) - at(-h)) / (2 * h))).toBeLessThan(0.08);
                    expect(maxSlope).toBeLessThan(0.3);
                    expect(maxSecond).toBeLessThan(0.12);
                }
                const legacySide = (pastMm: number) => {
                    const ly = halfW + pastMm;
                    const r = ly / halfW;
                    const excess = (r - 1) * Math.max(halfL, halfW);
                    if (excess >= RKW_TAPER_MM) return 0;
                    return 4 * (1 - smooth(excess / RKW_TAPER_MM));
                };
                const lateralDy = -meshYSign(side, "lateral") * (halfW + 2);
                expect(depthAt(0, lateralDy)).toBeCloseTo(legacySide(2), 2);
                const pastSide = -meshYSign(side, "lateral") * (halfW + RKW_TAPER_MM + 1);
                expect(depthAt(0, pastSide)).toBeLessThan(0.08);
            }
        }
    });
});

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function zeroCluffyCorrections(): SideCorrections {
    return {
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
}

async function loadStockTop(side: Side): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "left") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    return raw;
}

describe("solid Cluffy footprint", () => {
    test("stays flush with the preview on M9 and M15, both feet", async () => {
        const native = await loadStockTop("right");
        const nativeFrame = getBaseFootprintFrame(native, "right");
        const m9 = insoleLayoutForUsMenSize(9);
        const m15 = insoleLayoutForUsMenSize(15);
        const ratio = m15.lengthMm / m9.lengthMm;
        const sized = new Map<number, { lengthMm: number; widthMm: number }>([
            [9, { lengthMm: nativeFrame.lenSize, widthMm: nativeFrame.widSize }],
            [
                15,
                {
                    lengthMm: nativeFrame.lenSize * ratio,
                    widthMm: nativeFrame.widSize * ratio,
                },
            ],
        ]);
        native.dispose();
        for (const men of [9, 15] as const) {
            const target = sized.get(men)!;
            for (const side of ["left", "right"] as const) {
                const stock = await loadStockTop(side);
                const mesh =
                    men === 9 ? stock : scaleGeometryToInsoleSize(stock, target.lengthMm, target.widthMm);
                if (mesh !== stock) stock.dispose();
                const frame = getBaseFootprintFrame(mesh, side);
                const pose = defaultElementPose(
                    "cluffy_wedge",
                    side,
                    m9.lengthMm * (men === 15 ? ratio : 1),
                    m9.widthMm * (men === 15 ? ratio : 1),
                );
                const placed: PlacedElement = {
                    id: `cluffy-${men}-${side}`,
                    kind: "cluffy_wedge",
                    side,
                    ...pose,
                };
                const field: HeightFieldParams = {
                    side,
                    lengthMm: frame.lenSize,
                    widthMm: frame.widSize,
                    thicknessMm: BASE_REFERENCE_THICKNESS_MM,
                    corrections: zeroCluffyCorrections(),
                    elements: [placed],
                    includeSkives: false,
                    includeElements: true,
                    trimline: null,
                };
                const plain = mesh.clone();
                const solid = mesh.clone();
                await applyElementsToTopMeshLast(solid, mesh, field, { subdivide: false });
                const ctx = await resolvePlacedAssetContexts(
                    [placed],
                    side,
                    field.lengthMm,
                    field.widthMm,
                    mesh,
                );
                expect(ctx.length).toBe(1);
                const { grid } = await loadTransformedAssetPositions(ctx[0]!.assetId, ctx[0]!.transform);
                const anchor = anchorMmFromPlacement(mesh, side, placed.position.x, placed.position.y);
                const sign = meshYSign(side, "medial");
                const medial = (y: number) => (y - frame.widCenter) * sign;
                const pa = plain.getAttribute("position")!.array as Float32Array;
                const pb = solid.getAttribute("position")!.array as Float32Array;
                const ta = frame.thickAxis;
                const threshold = 0.08;
                let preview = -Infinity;
                let solidM = -Infinity;
                let faded = -Infinity;
                let previewX = frame.lenMin + frame.lenSize * 0.77;
                for (let i = 0; i < pa.length / 3; i++) {
                    const x = pa[i * 3]!;
                    const y = pa[i * 3 + 1]!;
                    const h = sampleGridBilinear(grid, x - anchor.x, y - anchor.y);
                    const lift = pb[i * 3 + ta]! - pa[i * 3 + ta]!;
                    const m = medial(y);
                    const { u, vSigned } = vertexFootprintAt(frame, pa, i);
                    const fadedH = h * rimBandFadeFactor(u, vSigned, field);
                    if (h > threshold && m > preview) {
                        preview = m;
                        previewX = x;
                    }
                    if (lift > threshold && m > solidM) solidM = m;
                    if (fadedH > threshold && m > faded) faded = m;
                }
                let rim = -Infinity;
                for (let i = 0; i < pa.length / 3; i++) {
                    if (Math.abs(pa[i * 3]! - previewX) > 4) continue;
                    rim = Math.max(rim, medial(pa[i * 3 + 1]!));
                }
                expect(preview).toBeGreaterThan(0);
                expect(solidM).toBeGreaterThan(0);
                expect(Math.abs(preview - solidM)).toBeLessThan(2);
                expect(rim - solidM).toBeLessThan(3.5);
                expect(rim - solidM).toBeGreaterThan(-0.5);
                expect(preview - faded).toBeGreaterThan(2);
                expect(Math.sign(placed.position.y)).toBe(sign);
                plain.dispose();
                solid.dispose();
                mesh.dispose();
            }
        }
    }, 180_000);
});
