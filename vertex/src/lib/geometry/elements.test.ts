// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import { Euler, Vector3 } from "three";
import type { ElementKind, PlacedElement } from "@/types";
import {
    defaultElementPose,
    ELEMENT_PROFILES,
    elementFootprintT,
    elementHeightAt,
    elementOutlineLocalMm,
} from "./elements";
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

    test("Cluffy wedge tapers to a distal apex", () => {
        const { rxMm: rx, ryMm: ry } = ELEMENT_PROFILES.cluffy_wedge;
        // Broad proximal base.
        expect(elementFootprintT("cluffy_wedge", -rx * 0.7, ry * 0.55, rx, ry)).toBeLessThan(1);
        // Narrow near distal apex.
        expect(elementFootprintT("cluffy_wedge", rx * 0.7, ry * 0.55, rx, ry)).toBeGreaterThan(1);
        expect(elementFootprintT("cluffy_wedge", rx * 0.7, 0, rx, ry)).toBeLessThan(1);
    });

    test("reverse Morton's relief points inward like the approved dancer pad", () => {
        const { rxMm: rx, ryMm: ry } = ELEMENT_PROFILES.reverse_mortons;
        for (const side of ["left", "right"] as const) {
            // In the displayed pair, inward local Y is negative on the left.
            const inward = side === "left" ? -1 : 1;
            expect(
                elementFootprintT("reverse_mortons", rx * 0.15, inward * ry * 0.75, rx, ry, side),
            ).toBeGreaterThan(1);
            expect(elementFootprintT("reverse_mortons", 0, -inward * ry * 0.55, rx, ry, side)).toBeLessThan(
                1,
            );
        }
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

    test("kinetic wedge and sinks are subtractive", () => {
        expect(ELEMENT_PROFILES.kinetic_wedge.sign).toBe(-1);
        expect(ELEMENT_PROFILES.heel_sink.sign).toBe(-1);
        expect(ELEMENT_PROFILES.navicular_sink.sign).toBe(-1);
        expect(ELEMENT_PROFILES.reverse_mortons.sign).toBe(1);
        expect(ELEMENT_PROFILES.met_pad.sign).toBe(1);
    });
});
