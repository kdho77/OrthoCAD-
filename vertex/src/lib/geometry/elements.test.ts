// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import type { ElementKind, PlacedElement } from "@/types";
import {
    defaultElementPose,
    ELEMENT_PROFILES,
    elementFootprintT,
    elementHeightAt,
    elementOutlineLocalMm,
} from "./elements";

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

    test("reverse Morton's keeps lateral platform and notches the medial 1st ray", () => {
        const { rxMm: rx, ryMm: ry } = ELEMENT_PROFILES.reverse_mortons;
        // Lateral column present on left foot (−y).
        expect(elementFootprintT("reverse_mortons", 0, -ry * 0.55, rx, ry, "left")).toBeLessThan(1);
        // Medial 1st-ray notch empty on left foot (+y).
        expect(elementFootprintT("reverse_mortons", rx * 0.15, ry * 0.75, rx, ry, "left")).toBeGreaterThan(1);
        // Notch flips for right foot.
        expect(elementFootprintT("reverse_mortons", rx * 0.15, -ry * 0.75, rx, ry, "right")).toBeGreaterThan(
            1,
        );
        expect(elementFootprintT("reverse_mortons", 0, ry * 0.55, rx, ry, "right")).toBeLessThan(1);
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
        expect(met.position.x).toBeGreaterThan(20); // distal of centre
        expect(met.heightMm).toBe(ELEMENT_PROFILES.met_pad.defaultHeightMm);

        const heel = defaultElementPose("heel_sink", "left");
        expect(heel.position.x).toBeLessThan(-50);

        const cluffyL = defaultElementPose("cluffy_wedge", "left");
        const cluffyR = defaultElementPose("cluffy_wedge", "right");
        expect(cluffyL.position.y).toBeGreaterThan(0); // medial left
        expect(cluffyR.position.y).toBeLessThan(0); // medial right
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
