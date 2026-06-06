// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { ISolid } from "@chili3d/core";
import { shapesToStl } from "@chili3d/core";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { describe, expect, test } from "@rstest/core";
import type { InsoleParams } from "../../../vertex/src/lib/geometry/insole";
import { shapeToBufferGeometry } from "../../../vertex/src/lib/geometry/mesh-bridge";
import { buildBaseShell, buildOcctInsoleSolid } from "../../../vertex/src/lib/geometry/occt-insole";
import { validateSolid } from "../../../vertex/src/lib/geometry/repair";

const WASM_BINARY = readFileSync(path.join(process.cwd(), "packages/wasm/lib/chili-wasm.wasm"));

const BASE_PARAMS: InsoleParams = {
    side: "left",
    lengthMm: 260,
    widthMm: 95,
    thicknessMm: 4,
    corrections: {
        forefootPostingDeg: 2,
        rearfootPostingDeg: -3,
        medialSkiveMm: 1.5,
        lateralSkiveMm: 0.5,
        archFillMm: 2,
        archHeightMm: 6,
        heelCupDepthMm: 3,
        heelCupHeightMm: 4,
        apexMoveMm: 5,
        medialFlangeMm: 2,
        lateralFlangeMm: 1,
    },
    elements: [
        {
            id: "met-1",
            kind: "met_pad",
            side: "left",
            position: { x: 20, y: -8 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 3,
        },
    ],
};

describe("Vertex OCCT insole kernel", () => {
    test("builds a base correction shell", async () => {
        await initWasm({ wasmBinary: WASM_BINARY });
        const factory = new ShapeFactory();
        const solid = buildBaseShell(factory, { ...BASE_PARAMS, elements: [] });
        expect(solid.isClosed()).toBe(true);
    });

    test("builds a closed solid with elements and skives", async () => {
        await initWasm({ wasmBinary: WASM_BINARY });
        const factory = new ShapeFactory();

        let solid: ISolid;
        try {
            solid = buildOcctInsoleSolid(factory, BASE_PARAMS);
        } catch (error) {
            throw new Error(
                `buildOcctInsoleSolid failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        const geometry = shapeToBufferGeometry(solid);
        const report = validateSolid(solid, geometry);
        expect(report.triangleCount).toBeGreaterThan(100);

        const stl = shapesToStl([solid], { binary: true });
        expect(stl.byteLength).toBeGreaterThan(500);
    });

    test("shell mode keeps a closed solid (hollow when OCCT offset succeeds)", async () => {
        await initWasm({ wasmBinary: WASM_BINARY });
        const factory = new ShapeFactory();

        const shellParams: InsoleParams = {
            ...BASE_PARAMS,
            elements: [],
            corrections: { ...BASE_PARAMS.corrections, medialSkiveMm: 0, lateralSkiveMm: 0 },
            method: "printing_shell",
        };

        const solid = buildOcctInsoleSolid(factory, shellParams);
        expect(solid.isClosed()).toBe(true);
        const geometry = shapeToBufferGeometry(solid);
        const report = validateSolid(solid, geometry);
        expect(report.triangleCount).toBeGreaterThan(100);
        expect(report.occtClosed).toBe(true);
    });
});
