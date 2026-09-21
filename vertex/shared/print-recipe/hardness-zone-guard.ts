// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { attachSoleUvFrameToRecipe, migratePrintRecipe, type PrintRecipeV1 } from "./print-recipe";
import { validateMaterialZones, type ZoneValidationIssue } from "./zone-validation";

export type HardnessZoneExportGate = {
    recipe: PrintRecipeV1;
    issues: ZoneValidationIssue[];
    /** Plain-language reason to block hybrid / production export; null when OK. */
    blockReason: string | null;
};

export function evaluateHardnessZonesForProduction(
    recipeInput: PrintRecipeV1 | undefined | null,
    lengthMm: number,
    widthMm: number,
): HardnessZoneExportGate {
    const recipe = attachSoleUvFrameToRecipe(migratePrintRecipe(recipeInput), lengthMm, widthMm);
    if (!recipe.zones.length || !recipe.soleUvFrame) {
        return { recipe, issues: [], blockReason: null };
    }
    const issues = validateMaterialZones(recipe, recipe.soleUvFrame);
    if (!issues.length) {
        return { recipe, issues: [], blockReason: null };
    }
    const blockReason =
        issues.length === 1
            ? issues[0]!.message
            : `${issues[0]!.message} Fix all zone issues before generating production G-code.`;
    return { recipe, issues, blockReason };
}
