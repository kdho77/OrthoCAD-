// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { DesignState, PlacedElement, Side } from "@/types";
import {
    DEFAULT_ELEMENT_DEPTH,
    DEFAULT_ELEMENT_PRIORITY,
    type HardnessRegion,
} from "../../../shared/print-recipe/hardness-region";
import { migratePrintRecipe } from "../../../shared/print-recipe/print-recipe";

export function elementToRegion(el: PlacedElement): HardnessRegion | null {
    if (!el.hardnessClass) return null;
    return {
        regionId: el.regionId ?? el.id,
        kind: "element",
        hardnessClass: el.hardnessClass,
        priority: el.priority ?? DEFAULT_ELEMENT_PRIORITY,
        depth: el.depth ?? { ...DEFAULT_ELEMENT_DEPTH },
        overrides: el.overrides,
        side: el.side,
        elementId: el.id,
        label: el.customName ?? el.kind,
    };
}

/**
 * Unified region list: printRecipe.zones (kind zone/freehand/legacy) plus
 * placed elements that carry hardness fields. Element fields win over a zone
 * row with the same elementId so settings stay keyed by element id.
 */
export function collectHardnessRegions(design: DesignState, side?: Side): HardnessRegion[] {
    const recipe = migratePrintRecipe(design.printRecipe);
    const fromElements: HardnessRegion[] = [];
    const elementIds = new Set<string>();
    for (const el of design.elements) {
        if (side && el.side !== side) continue;
        const region = elementToRegion(el);
        if (!region) continue;
        fromElements.push(region);
        elementIds.add(el.id);
    }
    const fromZones = recipe.zones.filter((z) => {
        if (side && z.side !== side) return false;
        if (z.kind === "element" && z.elementId && elementIds.has(z.elementId)) return false;
        return true;
    });
    return [...fromZones, ...fromElements];
}

export function findElement(design: DesignState, region: HardnessRegion): PlacedElement | undefined {
    if (region.kind !== "element") return undefined;
    const id = region.elementId ?? region.regionId;
    return design.elements.find((e) => e.id === id);
}
