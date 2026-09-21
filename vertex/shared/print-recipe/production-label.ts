// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { HARDNESS_TO_INFILL_PCT, type PrintRecipeV1 } from "./print-recipe";

export interface ProductionReleaseLabelInput {
    side: "left" | "right";
    recipe: PrintRecipeV1;
    profileDisplayName?: string;
    clientLabel?: string;
    designId?: string;
}

/**
 * Human-readable belt release label embedded in G-code comments and manufacturing metadata.
 * Not a Shore durometer claim — hardness is the named gyroid ladder only.
 */
export function buildProductionReleaseLabel(input: ProductionReleaseLabelInput): string {
    const side = input.side === "left" ? "Left" : "Right";
    const hardness = input.recipe.defaultHardness;
    const table = input.recipe.hardnessToInfillPct ?? HARDNESS_TO_INFILL_PCT;
    const pct = table[hardness] ?? HARDNESS_TO_INFILL_PCT[hardness];
    const profile = input.profileDisplayName ?? input.recipe.profileId;
    const client = input.clientLabel?.trim();
    const parts = ["OrthoCAD belt release", side, hardness, `${pct}% gyroid (experimental)`, profile];
    if (client) parts.push(client);
    if (input.designId) parts.push(`design ${input.designId.slice(0, 8)}`);
    return parts.join(" · ");
}
