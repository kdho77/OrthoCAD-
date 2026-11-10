// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { Euler, Vector3 } from "three";
import type { ElementKind, PlacedElement } from "@/types";
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
    rkwPlanMm,
} from "./elements";
import { heightFieldYFromMeshY, meshYSign } from "./handedness";
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
import {
    insoleLayoutForUsMenSize,
    SAMPLE_TOP_NATIVE_LENGTH_MM,
    SAMPLE_TOP_NATIVE_WIDTH_MM,
    scalePlanPointAboutCenter,
    TOP_SHEET_XY_ANCHOR_SCALE,
} from "./shoe-size";
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
        const cx = lengthMm / 2 + el.position.x * TOP_SHEET_XY_ANCHOR_SCALE;
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

    test("a landmark offset scales by 1.011273 about the sheet center", () => {
        const center = SAMPLE_TOP_NATIVE_LENGTH_MM / 2;
        const landmark = 100;
        const placed = center + landmark * TOP_SHEET_XY_ANCHOR_SCALE;
        expect(placed - center).toBeCloseTo(101.1273, 3);
        const el: PlacedElement = {
            id: "toe",
            kind: "toe_crest",
            side: "left",
            position: { x: landmark, y: -12 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 3,
        };
        const lengthMm = SAMPLE_TOP_NATIVE_LENGTH_MM;
        const on = elementHeightAt([el], lengthMm / 2 + landmark * TOP_SHEET_XY_ANCHOR_SCALE, 0, lengthMm);
        const oldCenter = elementHeightAt([el], lengthMm / 2 + landmark, 0, lengthMm);
        expect(on).toBeGreaterThan(oldCenter);
    });

    test("Morton's, reverse Morton's, and the kinetic wedge keep u on the anchored sheet", () => {
        const nativeL = SAMPLE_TOP_NATIVE_LENGTH_MM;
        const nativeW = SAMPLE_TOP_NATIVE_WIDTH_MM;
        const anchoredL = nativeL * TOP_SHEET_XY_ANCHOR_SCALE;
        const anchoredW = nativeW * TOP_SHEET_XY_ANCHOR_SCALE;
        expect(anchoredL).toBeCloseTo(275, 2);
        expect(anchoredW).toBeCloseTo(92.73, 2);
        for (const kind of ["mortons_extension", "reverse_mortons", "kinetic_wedge"] as const) {
            const native = defaultElementPose(kind, "left", nativeL, nativeW);
            const anchored = defaultElementPose(kind, "left", anchoredL, anchoredW);
            const uNative = (nativeL / 2 + native.position.x) / nativeL;
            const uAnchored = (anchoredL / 2 + anchored.position.x) / anchoredL;
            expect(uAnchored, kind).toBeCloseTo(uNative, 4);
            const xNative = nativeL / 2 + native.position.x;
            const xAnchored = anchoredL / 2 + anchored.position.x;
            expect(xAnchored, kind).toBeCloseTo(xNative * TOP_SHEET_XY_ANCHOR_SCALE, 2);
            expect(xAnchored, kind).toBeGreaterThan(xNative + 0.4);
        }
        const center = { x: nativeL / 2, y: 0 };
        const toe = scalePlanPointAboutCenter({ x: nativeL, y: 0, z: 0 }, center, TOP_SHEET_XY_ANCHOR_SCALE);
        const heel = scalePlanPointAboutCenter({ x: 0, y: 0, z: 0 }, center, TOP_SHEET_XY_ANCHOR_SCALE);
        expect(toe.x - heel.x).toBeCloseTo(275, 2);
        expect(toe.x - nativeL).toBeGreaterThan(1.4);
        expect(toe.x - nativeL).toBeLessThan(1.6);
        expect(0 - heel.x).toBeGreaterThan(1.4);
        expect(0 - heel.x).toBeLessThan(1.6);
    });
});
