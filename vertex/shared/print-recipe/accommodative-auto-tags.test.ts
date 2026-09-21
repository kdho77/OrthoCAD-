// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    applyAutoLesionTagsToRecipe,
    lesionTagsForElementKind,
    lesionTagsForZoneHardness,
} from "./accommodative-auto-tags";
import { HARDNESS_ZONE_PRESETS } from "./hardness-zone-presets";
import { DEFAULT_PRINT_RECIPE_V1, type MaterialZoneV1 } from "./print-recipe";

const heelPreset = HARDNESS_ZONE_PRESETS.find((p) => p.id === "heel")!;

describe("accommodative-auto-tags", () => {
    test("Extra Soft zone hardness auto-tags accommodative", () => {
        expect(lesionTagsForZoneHardness("Extra Soft")).toEqual(["accommodative"]);
        expect(lesionTagsForZoneHardness("Medium")).toEqual([]);
    });

    test("known ElementKinds map to lesion tags", () => {
        expect(lesionTagsForElementKind("met_pad")).toEqual(["accommodative"]);
        expect(lesionTagsForElementKind("heel_sink")).toEqual(["accommodative"]);
        expect(lesionTagsForElementKind("mortons_extension")).toEqual(["highRisk"]);
    });

    test("heel_sink inside heel zone picks up accommodative tag", () => {
        const zone: MaterialZoneV1 = {
            zoneId: "z1",
            anatomicLabel: heelPreset.anatomicLabel,
            hardnessName: "Medium",
            boundarySoleUv: [...heelPreset.boundarySoleUv],
        };
        const recipe = { ...DEFAULT_PRINT_RECIPE_V1, zones: [zone] };
        const lengthMm = 260;
        const widthMm = 95;
        const xMm = 0.12 * lengthMm - lengthMm / 2;
        const tagged = applyAutoLesionTagsToRecipe(
            recipe,
            [{ kind: "heel_sink", side: "left", position: { x: xMm, y: 0 } }],
            lengthMm,
            widthMm,
        );
        expect(tagged.zones[0]?.lesionTags).toContain("accommodative");
    });

    test("Extra Soft heel preset tags even without elements", () => {
        const zone: MaterialZoneV1 = {
            zoneId: "z-heel",
            anatomicLabel: heelPreset.anatomicLabel,
            hardnessName: "Extra Soft",
            boundarySoleUv: [...heelPreset.boundarySoleUv],
        };
        const tagged = applyAutoLesionTagsToRecipe(
            { ...DEFAULT_PRINT_RECIPE_V1, zones: [zone] },
            [],
            260,
            95,
        );
        expect(tagged.zones[0]?.lesionTags).toEqual(["accommodative"]);
    });
});
