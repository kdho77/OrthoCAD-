// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ELEMENT_PROFILES } from "@/lib/geometry/elements";
import type { DesignState, PlacedElement, Side } from "@/types";
import type { NamedHardnessClass } from "../../../shared/print-recipe/hardness-class-table";
import {
    DEFAULT_ELEMENT_DEPTH,
    DEFAULT_ELEMENT_PRIORITY,
    type HardnessRegion,
} from "../../../shared/print-recipe/hardness-region";
import { migratePrintRecipe } from "../../../shared/print-recipe/print-recipe";

/** Profile hardness for an element that was never given a class. Morton's is Extra Hard. */
function profileDefaultHardness(el: PlacedElement): NamedHardnessClass | undefined {
    if (el.kind === "custom") return undefined;
    return ELEMENT_PROFILES[el.kind].defaultHardnessClass;
}

export function elementToRegion(el: PlacedElement): HardnessRegion | null {
    const hardnessClass = el.hardnessClass ?? profileDefaultHardness(el);
    if (!hardnessClass) return null;
    return {
        regionId: el.regionId ?? el.id,
        kind: "element",
        hardnessClass,
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

/**
 * Regions the hardness preview and every manufacturing 3MF actually apply.
 *
 * Element-derived rows (placed elements, and recipe rows with kind "element")
 * count only while Split elements is on. Turning the toggle off keeps the
 * hardness fields on the elements and drops those modifiers from the preview
 * and from export. Explicit zones and freehand regions are not split-element
 * modifiers, so they stay when the toggle is off.
 *
 * A Morton's extension with no hardnessClass is the exception: it prints at
 * the profile default (Extra Hard) through this same element-region path
 * whether or not the toggle is on. An explicit hardnessClass is not replaced.
 */
function regionStaysWhenSplitOff(design: DesignState, region: HardnessRegion): boolean {
    if (region.kind !== "element") return true;
    const id = region.elementId ?? region.regionId;
    const el = design.elements.find((element) => element.id === id);
    return !!el && !el.hardnessClass && profileDefaultHardness(el) !== undefined;
}

export function effectiveHardnessRegions(design: DesignState, side?: Side): HardnessRegion[] {
    const regions = collectHardnessRegions(design, side);
    if (design.splitElements === true) return regions;
    return regions.filter((region) => regionStaysWhenSplitOff(design, region));
}

export function findElement(design: DesignState, region: HardnessRegion): PlacedElement | undefined {
    if (region.kind !== "element") return undefined;
    const id = region.elementId ?? region.regionId;
    return design.elements.find((e) => e.id === id);
}
