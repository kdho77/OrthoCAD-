// G3 upload half. The headless loft throws the belt refusal; the uploader is not called.

import { describe, expect, test } from "@rstest/core";
import { DEFAULT_PRINT_RECIPE_V1 } from "../../vertex/shared/print-recipe/print-recipe";

rs.mock("../../vertex/server/src/lib/finalized-mesh-runner", () => ({
    buildHeadlessFinalizedFoot: async () => {
        throw new Error(
            "Manufacturing mesh is missing the plantar name ([TEXT] bottom z=0.400 outside the recess). Refusing to upload.",
        );
    },
    buildHeadlessRegional3mf: async () => null,
}));

describe("G3 production uploads nothing", () => {
    test("materializeCadOperatorStl does not upload when the belt loft refuses the name", async () => {
        const { materializeCadOperatorStl } = await import(
            "../../vertex/server/src/routers/manufacturing-cad"
        );
        const uploads: string[] = [];
        await expect(
            materializeCadOperatorStl({
                plan: {
                    stlStorageKey: null,
                    presetId: "apex-belt-v2",
                    printRecipe: DEFAULT_PRINT_RECIPE_V1,
                    material: "apex_core",
                    beltAngleDeg: 45,
                    ownerId: "grader",
                    useSavedDesignMesh: true,
                    settingsJson: { settings: {} },
                    clientFirstName: "",
                    clientLastName: "",
                },
                credentialId: "grader",
                side: "right",
                uploadStl: async (key) => {
                    uploads.push(key);
                },
            }),
        ).rejects.toThrow(/Refusing to upload/);
        expect(uploads).toEqual([]);
    });
});
