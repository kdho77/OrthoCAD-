import type { HardnessName } from "../../../shared/print-recipe/print-recipe";
import { gyroidInfillPctForHardness } from "../../../shared/print-recipe/print-recipe";
import type { PrintRecipeV1 } from "../../../shared/print-recipe/print-recipe";

/** VertexSlice `profile_id` values (see kdho77/VertexSlice server/profile_registry.py). */
const HARDNESS_TO_VERTEX_PROFILE: Record<HardnessName, string> = {
    "Extra Soft": "apex-v2-insole-extra-soft",
    Soft: "apex-v2-insole-soft",
    Medium: "apex-v2-insole-medium",
    Hard: "apex-v2-insole-hard",
    "Extra Hard": "apex-v2-insole-extra-hard",
};

export type BeltPrintDirection = "toe_first" | "heel_first";

export function vertexSliceProfileIdForRecipe(recipe: PrintRecipeV1): string {
    return HARDNESS_TO_VERTEX_PROFILE[recipe.defaultHardness] ?? "apex-v2-insole-medium";
}

export function defaultInfillPctForRecipe(recipe: PrintRecipeV1): number {
    return gyroidInfillPctForHardness(recipe.defaultHardness, recipe.hardnessToInfillPct);
}

export const BELT_PRINT_DIRECTIONS: { id: BeltPrintDirection; label: string }[] = [
    { id: "toe_first", label: "Toe first (default)" },
    { id: "heel_first", label: "Heel first" },
];
