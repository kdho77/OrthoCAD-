// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { Plane } from "@chili3d/core";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { describe, expect, test } from "@rstest/core";
import { sewGlbGeometryToSolid } from "@/lib/geometry/base-occt";
import { shapeToBufferGeometry } from "@/lib/geometry/mesh-bridge";
import { repairOcctSolid, validateSolid } from "@/lib/geometry/repair";

const WASM_BINARY = readFileSync(path.join(process.cwd(), "packages/wasm/lib/chili-wasm.wasm"));

describe("OCCT sew of a closed mesh", () => {
    test("sews a tessellated box into a single closed solid", async () => {
        await initWasm({ wasmBinary: WASM_BINARY });
        const factory = new ShapeFactory();
        const box = factory.box(Plane.XY, 10, 8, 4);
        expect(box.isOk).toBe(true);
        expect(box.value.isClosed()).toBe(true);

        const mesh = shapeToBufferGeometry(box.value);
        const sewn = sewGlbGeometryToSolid(factory, mesh);
        expect(sewn).not.toBeNull();
        const repaired = repairOcctSolid(factory, sewn!);
        expect(repaired.isClosed()).toBe(true);

        const tess = shapeToBufferGeometry(repaired);
        const manifold = validateSolid(repaired, tess);
        expect(manifold.isWatertight).toBe(true);
        expect(manifold.occtClosed).toBe(true);
        tess.dispose();
        mesh.dispose();
    });
});
