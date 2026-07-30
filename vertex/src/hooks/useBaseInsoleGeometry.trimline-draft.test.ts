// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Vector3 } from "three";
import { resolveActiveTrimlineForClip, type TrimlineCurve } from "@/lib/geometry/trimline";
import type { DesignState } from "@/types";

function squareCurve(half = 10): TrimlineCurve {
    return {
        points: [
            new Vector3(-half, -half, 0),
            new Vector3(half, -half, 0),
            new Vector3(half, half, 0),
            new Vector3(-half, half, 0),
        ],
    };
}

function designWithTrimline(side: "left" | "right", half: number): DesignState {
    return {
        pattern: "neutral",
        method: "milled",
        thicknessMm: 3,
        corrections: {
            linked: false,
            left: {} as DesignState["corrections"]["left"],
            right: {} as DesignState["corrections"]["right"],
        },
        elements: [],
        trimlines: {
            [side]: squareCurve(half).points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        },
    } as DesignState;
}

describe("resolveActiveTrimlineForClip (Bug A)", () => {
    test("returns live draft when trimlineEdit matches side (base/GLB clip must follow drag)", () => {
        const design = designWithTrimline("left", 20);
        const draft = squareCurve(8);
        const session = { side: "left" as const, draft };

        const active = resolveActiveTrimlineForClip("left", session, design);
        expect(active).toBe(draft);
        expect(active!.points[0]!.x).toBe(-8);
    });

    test("ignores draft for the other side and falls back to committed trimline", () => {
        const design = designWithTrimline("left", 20);
        const draft = squareCurve(8);
        const session = { side: "right" as const, draft };

        const active = resolveActiveTrimlineForClip("left", session, design);
        expect(active).not.toBeNull();
        expect(active!.points[0]!.x).toBe(-20);
    });

    test("returns committed trimline when no edit session is active", () => {
        const design = designWithTrimline("right", 15);
        const active = resolveActiveTrimlineForClip("right", null, design);
        expect(active).not.toBeNull();
        expect(active!.points[0]!.x).toBe(-15);
    });

    test("returns null when neither draft nor committed trimline exists", () => {
        const design = designWithTrimline("left", 10);
        const active = resolveActiveTrimlineForClip("right", null, design);
        expect(active).toBeNull();
    });
});

describe("Bug C call-site contract (userData preservation expectation)", () => {
    test("clipGeometryToOutline still drops userData — call site must reattach", async () => {
        const { BufferAttribute, BufferGeometry } = await import("three");
        const { clipGeometryToOutline } = await import("@/lib/geometry/trimline");

        const g = new BufferGeometry();
        g.setAttribute(
            "position",
            new BufferAttribute(
                new Float32Array([-5, -5, 0, 5, -5, 0, 5, 5, 0, -5, -5, 0, 5, 5, 0, -5, 5, 0]),
                3,
            ),
        );
        g.userData = { isMultiMeshBase: true, topVertexCount: 42 };

        const clipped = clipGeometryToOutline(g, squareCurve(20), 0);
        // Documented Bug C: helper alone does not preserve markers.
        expect(clipped.userData.topVertexCount).toBeUndefined();
        expect(clipped.userData.isMultiMeshBase).toBeUndefined();

        // Call-site guard used by useBaseInsoleGeometry:
        clipped.userData = { ...g.userData, ...clipped.userData };
        expect(clipped.userData.topVertexCount).toBe(42);
        expect(clipped.userData.isMultiMeshBase).toBe(true);
    });
});
