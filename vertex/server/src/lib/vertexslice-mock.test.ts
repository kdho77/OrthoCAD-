// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { VertexSliceHttpError } from "../../../shared/vertexslice/errors";
import { parseGcodeStats } from "../../../shared/vertexslice/gcode-stats";
import { createMockVertexSliceClient } from "./vertexslice-mock";

const tinyModel = new Uint8Array([0, 1, 2, 3]);

describe("mock VertexSlice client", () => {
    test("returns sample G-code with header comments and stats", async () => {
        const client = createMockVertexSliceClient();
        const result = await client.slice({
            profileId: "apex-v2-insole-95a",
            model: tinyModel,
            filename: "insole.stl",
            material: "apex_core",
            printDirection: "toe_first",
            wallLoops: 1,
        });
        expect(result.status).toBe(200);
        expect(result.gcode).toContain("; material = ApexCore");
        expect(result.gcode).toContain("; print_direction = toe_first");
        expect(result.headers.material).toBe("apex_core");
        const stats = parseGcodeStats(result.gcode);
        expect(stats.layers).toBe(42);
        expect(stats.filamentGrams).toBe(10.5);
        expect(stats.printTimeSeconds).toBe(45 * 60 + 12);
    });

    test("timeout fault returns 504", async () => {
        const client = createMockVertexSliceClient({}, () => "timeout");
        await expect(
            client.slice({ profileId: "apex-v2-insole-95a", model: tinyModel, filename: "insole.stl" }),
        ).rejects.toBeInstanceOf(VertexSliceHttpError);
        try {
            await client.slice({ profileId: "apex-v2-insole-95a", model: tinyModel });
        } catch (err) {
            expect((err as VertexSliceHttpError).status).toBe(504);
        }
    });

    test("5xx fault and timeout filename", async () => {
        const five = createMockVertexSliceClient({}, () => "5xx");
        try {
            await five.slice({ profileId: "apex-v2-insole-95a", model: tinyModel });
            throw new Error("expected throw");
        } catch (err) {
            expect((err as VertexSliceHttpError).status).toBe(500);
        }
        const named = createMockVertexSliceClient();
        try {
            await named.slice({
                profileId: "apex-v2-insole-95a",
                model: tinyModel,
                filename: "timeout.stl",
            });
            throw new Error("expected throw");
        } catch (err) {
            expect((err as VertexSliceHttpError).status).toBe(504);
        }
    });

    test("rejects unknown material like the real API", async () => {
        const client = createMockVertexSliceClient();
        try {
            await client.slice({
                profileId: "apex-v2-insole-95a",
                model: tinyModel,
                material: "not-a-filament",
            });
            throw new Error("expected throw");
        } catch (err) {
            expect((err as VertexSliceHttpError).status).toBe(400);
            expect((err as VertexSliceHttpError).detail).toContain("Unknown material");
        }
    });

    test("lists the four Apex materials with exact display names", async () => {
        const client = createMockVertexSliceClient();
        const { materials, default: def } = await client.materials();
        expect(def).toBe("apex_core");
        expect(materials.map((m) => m.display_name)).toEqual([
            "ApexCore",
            "ApexForge",
            "ApexBounce",
            "ApexLight",
        ]);
    });
});
