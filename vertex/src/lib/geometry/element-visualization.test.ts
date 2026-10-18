import { BufferAttribute, BufferGeometry, Color } from "three";
import { describe, expect, test } from "@rstest/core";
import type { PlacedElement } from "@/types";
import { applyDesignElementColors, DESIGN_ELEMENT_COLOR } from "./element-visualization";

describe("design element visualization", () => {
    test("colors only raised top vertices inside an additive element", () => {
        const geometry = new BufferGeometry();
        // Dancer's pad default center is around x=0.65*260, y=0.
        geometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array([169, 0, 4, 169, 0, 0, 20, 0, 4, 169, 40, 4]), 3),
        );
        const element = {
            id: "dancer-left",
            kind: "dancers_pad",
            side: "left",
            position: { x: 169 - 130, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 2.5,
        } satisfies PlacedElement;

        applyDesignElementColors(geometry, [element], "left", 260);

        const color = geometry.getAttribute("color");
        const expected = new Color(DESIGN_ELEMENT_COLOR);
        expect(color.getX(0)).toBeCloseTo(expected.r, 5);
        expect(color.getY(0)).toBeCloseTo(expected.g, 5);
        expect(color.getZ(0)).toBeCloseTo(expected.b, 5);
        expect(color.getX(1)).toBeCloseTo(1, 5);
        expect(color.getY(1)).toBeCloseTo(1, 5);
        expect(color.getZ(1)).toBeCloseTo(1, 5);
        expect(color.getX(2)).toBeCloseTo(1, 5);
        expect(color.getX(3)).toBeCloseTo(1, 5);

        geometry.dispose();
    });
});
