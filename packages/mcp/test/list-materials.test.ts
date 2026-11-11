import { describe, expect, test } from "@rstest/core";
import { CANONICAL_INSOLE_PRINT_MATERIALS } from "../../../vertex/server/src/lib/vertexslice-client.js";
import type { OrthocadMcpConfig } from "../src/config.js";
import { handleOrthocadTool } from "../src/tools/handlers.js";
import { canonicalInsolePrintMaterialCatalog } from "../src/tools/print-materials.js";

const config = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    apiKey: "ocad_test",
} as OrthocadMcpConfig;

describe("list_materials", () => {
    test("returns the canonical insole catalog with no write client", async () => {
        const result = await handleOrthocadTool("list_materials", {}, { config });
        expect(result.isError).toBeUndefined();
        const payload = JSON.parse(
            result.content[0]?.text ?? "{}",
        ) as typeof CANONICAL_INSOLE_PRINT_MATERIALS;
        expect(payload).toEqual(canonicalInsolePrintMaterialCatalog());
        expect(payload).toEqual(CANONICAL_INSOLE_PRINT_MATERIALS);
        expect(payload.locked_preset_id).toBe("apex-v2-insole-95a");
        expect(payload.default_material).toBe("apex_core");
        const light = payload.materials.find((material) => material.id === "ApexLight");
        const forge = payload.materials.find((material) => material.id === "ApexForge");
        expect(light).toMatchObject({
            label: "Apex Light",
            vertex_slice_material: "apex_light",
            enabled: true,
            locked_preset_id: "apex-v2-insole-95a",
        });
        expect(light?.aliases).toEqual(["ApexLight", "Apex Light", "apex_light", "ApexLight Foam"]);
        expect(forge).toMatchObject({
            vertex_slice_material: "apex_forge",
            enabled: false,
        });
        expect(payload.materials.map((material) => material.vertex_slice_material)).toEqual([
            "apex_light",
            "apex_core",
            "apex_bounce",
            "apex_forge",
        ]);
        expect(result.content[0]?.text).not.toMatch(/ApexVylon|secret|token/i);
    });

    test("rejects unexpected arguments", async () => {
        const result = await handleOrthocadTool("list_materials", { material: "apex_light" }, { config });
        expect(result.isError).toBe(true);
    });
});
