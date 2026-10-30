// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { PlaneGeometry } from "three";
import type { PlacedElement } from "@/types";
import { buildElementDisplayMeshes, elementsForSurface } from "./display-mesh";

function element(side: "left" | "right" = "left"): PlacedElement {
    return {
        id: "manual",
        kind: "dancers_pad",
        side,
        position: { x: 0, y: 0 },
        rotationDeg: 17,
        scale: { x: 1.1, y: 0.9 },
        heightMm: 4,
    };
}

function base() {
    const geometry = new PlaneGeometry(260, 110, 26, 11);
    geometry.translate(130, 0, 3);
    return geometry;
}

describe("GLB display meshes", () => {
    test("design defers library blending until Print without changing saved placements", () => {
        const elements = [element()];
        expect(elementsForSurface(elements, false)).toEqual([]);
        expect(elementsForSurface(elements, true)).toBe(elements);
        expect(elements).toHaveLength(1);
        expect(elementsForSurface([], false)).toEqual([]);
    });
    for (const side of ["left", "right"] as const) {
        test(`${side}: actual dancer triangles have a crisp closed boundary and preserve the base`, async () => {
            const geometry = base();
            const before = Array.from(geometry.getAttribute("position").array);
            const [mesh] = await buildElementDisplayMeshes(geometry, [element(side)], side, false);
            expect(mesh).toBeDefined();
            const surface = mesh!.surface.getAttribute("position");
            const border = mesh!.border.getAttribute("position");
            expect(surface.count).toBeGreaterThan(1000);
            expect(border.count).toBeGreaterThan(40);
            // Only contour edges, never the interior triangulation.
            expect(border.count).toBeLessThan(surface.count / 3);
            for (let i = 0; i < surface.count; i++) expect(surface.getZ(i)).toBeGreaterThanOrEqual(3);
            expect(Array.from(geometry.getAttribute("position").array)).toEqual(before);
            mesh!.surface.dispose();
            mesh!.border.dispose();
            geometry.dispose();
        });
    }
    test("Print projects the exact GLB footprint onto the composed surface", async () => {
        const geometry = base();
        const [design] = await buildElementDisplayMeshes(geometry, [element()], "left", false);
        const [print] = await buildElementDisplayMeshes(geometry, [element()], "left", true);
        const dp = design!.surface.getAttribute("position");
        const pp = print!.surface.getAttribute("position");
        expect(pp.count).toBe(dp.count);
        for (let i = 0; i < pp.count; i++) {
            expect(pp.getX(i)).toBe(dp.getX(i));
            expect(pp.getY(i)).toBe(dp.getY(i));
            expect(pp.getZ(i)).toBeCloseTo(3.025, 4);
        }
        for (const mesh of [design!, print!]) {
            mesh.surface.dispose();
            mesh.border.dispose();
        }
        geometry.dispose();
    });
    test("a fully buried no-flow element is invisible in Design and Print", async () => {
        const geometry = base();
        for (const print of [false, true]) {
            const [mesh] = await buildElementDisplayMeshes(
                geometry,
                [{ ...element(), placementMode: "noFlow", zOffsetMm: -20 }],
                "left",
                print,
                geometry,
            );
            expect(mesh!.surface.getAttribute("position").count).toBe(0);
            mesh!.surface.dispose();
            mesh!.border.dispose();
        }
        geometry.dispose();
    });
    test("empty designs do not invent an element", async () => {
        const geometry = base();
        expect(await buildElementDisplayMeshes(geometry, [], "left", false)).toEqual([]);
        geometry.dispose();
    });
});
