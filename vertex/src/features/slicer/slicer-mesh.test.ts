// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    INCH_SCALE,
    isClosedManifold,
    makeBoxStl,
    parseSlicerMesh,
    parseStl,
    scaledMesh,
    unitsWarning,
    validateSlicerFileMeta,
} from "./slicer-mesh";

describe("slicer mesh", () => {
    test("known box STL has mm dimensions within 0.5 mm", async () => {
        const buffer = makeBoxStl(270, 90, 15);
        const mesh = await parseSlicerMesh({ name: "insole.stl", size: buffer.byteLength }, buffer);
        expect(mesh.bounds.lengthMm).toBeGreaterThan(269.5);
        expect(mesh.bounds.lengthMm).toBeLessThan(270.5);
        expect(mesh.bounds.widthMm).toBeGreaterThan(89.5);
        expect(mesh.bounds.widthMm).toBeLessThan(90.5);
        expect(mesh.bounds.heightMm).toBeGreaterThan(14.5);
        expect(mesh.bounds.heightMm).toBeLessThan(15.5);
        expect(mesh.closed).toBe(true);
    });

    test("inch-sized file warns and Treat as inches rescales", async () => {
        const buffer = makeBoxStl(10.5, 3.5, 0.6);
        const mesh = await parseSlicerMesh({ name: "inch.stl", size: buffer.byteLength }, buffer);
        expect(unitsWarning(mesh.bounds.lengthMm)).toBe("small");
        const scaled = scaledMesh(mesh, INCH_SCALE);
        expect(scaled.bounds.lengthMm).toBeGreaterThan(10.5 * INCH_SCALE - 0.5);
        expect(scaled.bounds.lengthMm).toBeLessThan(10.5 * INCH_SCALE + 0.5);
        expect(unitsWarning(scaled.bounds.lengthMm)).toBe(null);
    });

    test("corrupt bytes and a single triangle fail closed-mesh checks", () => {
        expect(validateSlicerFileMeta({ name: "nope.txt", size: 100 })?.message).toMatch(/supported/i);
        expect(() => parseStl(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow();
        const open = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
        expect(isClosedManifold(open)).toBe(false);
    });
});
