// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, describe, expect, rs, test } from "@rstest/core";
import { loadManifoldApi, meshToManifold } from "./manifold-runtime";
import { boxMesh, meshIsWatertight, meshVolume, type TriangleMesh } from "./mesh";
import type { RawModifier } from "./prism";
import { resolveModifiers } from "./resolve";

function modifier(id: string, priority: number, mesh: TriangleMesh): RawModifier {
    return {
        region: {
            regionId: id,
            kind: "freehand",
            side: "left",
            hardnessClass: "Medium",
            priority,
            depth: { type: "full" },
        },
        mesh,
        footprint: [],
        volumeMm3: meshVolume(mesh),
    };
}

afterEach(() => rs.restoreAllMocks());

describe("hardness resolver bounds", () => {
    test("disjoint solids bypass subtraction without losing volume or watertightness", async () => {
        const api = await loadManifoldApi();
        const probe = meshToManifold(api, boxMesh(0, 0, 0, 1, 1, 1));
        const subtract = rs.spyOn(Object.getPrototypeOf(probe), "subtract");
        probe.delete?.();
        const raw = [
            modifier("a", 2, boxMesh(0, 0, 0, 10, 10, 2)),
            modifier("b", 1, boxMesh(20, 0, 0, 30, 10, 2)),
        ];
        const resolved = await resolveModifiers(raw);
        expect(subtract).not.toHaveBeenCalled();
        for (const item of resolved) {
            expect(item.status).toBe("present");
            expect(item.volumeMm3).toBeCloseTo(200, 5);
            expect(meshIsWatertight(item.mesh)).toBe(true);
        }
    });

    test("touching and overlapping bounds still run the exact boolean", async () => {
        const api = await loadManifoldApi();
        const probe = meshToManifold(api, boxMesh(0, 0, 0, 1, 1, 1));
        const subtract = rs.spyOn(Object.getPrototypeOf(probe), "subtract");
        probe.delete?.();
        for (const x of [10, 5]) {
            subtract.mockClear();
            const resolved = await resolveModifiers([
                modifier("a", 2, boxMesh(0, 0, 0, 10, 10, 2)),
                modifier("b", 1, boxMesh(x, 0, 0, x + 10, 10, 2)),
            ]);
            expect(subtract).toHaveBeenCalledTimes(1);
            expect(resolved[1]?.volumeMm3).toBeCloseTo(x === 10 ? 200 : 100, 5);
        }
    });

    test("sliver reassignment expands the winner's bounds before later regions are clipped", async () => {
        const resolved = await resolveModifiers([
            modifier("winner", 3, boxMesh(0, 0, 0, 10, 10, 2)),
            modifier("sliver", 2, boxMesh(20, 0, 0, 20.5, 0.5, 0.5)),
            modifier("later", 1, boxMesh(20, 0, 0, 22, 2, 1)),
        ]);
        expect(resolved[0]?.volumeMm3).toBeCloseTo(200.125, 5);
        expect(resolved[1]?.status).toBe("reassigned");
        expect(resolved[2]?.volumeMm3).toBeCloseTo(3.875, 5);
        expect(resolved[2]?.status).toBe("present");
    });
});
