// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";
import {
    isSlicerPersistenceEnabled,
    SLICER_SESSION_FORBIDDEN_APIS,
    SLICER_SESSION_POLICY,
} from "./slicer-session";

const DIR = dirname(fileURLToPath(import.meta.url));

describe("slicer session policy", () => {
    test("persistence is hard-disabled", () => {
        expect(SLICER_SESSION_POLICY.persistDesigns).toBe(false);
        expect(SLICER_SESSION_POLICY.persistClients).toBe(false);
        expect(SLICER_SESSION_POLICY.persistOrders).toBe(false);
        expect(isSlicerPersistenceEnabled()).toBe(false);
    });

    test("slicer feature source does not call CAD persistence APIs", () => {
        const files = readdirSync(DIR).filter(
            (name) =>
                (name.endsWith(".ts") || name.endsWith(".tsx")) &&
                !name.endsWith(".test.ts") &&
                name !== "slicer-session.ts",
        );
        for (const name of files) {
            const source = readFileSync(join(DIR, name), "utf8");
            for (const api of SLICER_SESSION_FORBIDDEN_APIS) {
                expect(source.includes(api)).toBe(false);
            }
        }
    });
});

describe("CAD default asset after slicer rebase", () => {
    test("fresh load still uses SAMPLE_Top, not a two-part Default.glb", () => {
        const sampleTopId = readFileSync(
            join(process.cwd(), "vertex/src/lib/geometry/procedural-wall/sample-top-id.ts"),
            "utf8",
        );
        const baseAsset = readFileSync(join(process.cwd(), "vertex/src/lib/geometry/base-asset.ts"), "utf8");
        expect(sampleTopId).toContain('SAMPLE_TOP_GLB_PATH = "Templates/SAMPLE_Top.glb"');
        expect(sampleTopId).toContain('SAMPLE_TOP_PUBLIC_PATH = "/Templates/SAMPLE_Top.glb"');
        expect(baseAsset).toContain("glbPath: SAMPLE_TOP_GLB_PATH");
        expect(existsSync(join(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb"))).toBe(true);
        expect(existsSync(join(process.cwd(), "vertex/public/Templates/Default.glb"))).toBe(false);
        expect(existsSync(join(process.cwd(), "public/Templates/Default.glb"))).toBe(false);
    });
});
