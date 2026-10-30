// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { elementOutlineLocalMm } from "@/lib/geometry/elements";
import type { PlacedElement } from "@/types";
import {
    CLASS_PREVIEW_COLORS,
    migrateRegionHardnessClass,
    NAMED_HARDNESS_CLASSES,
    type NamedHardnessClass,
    type RegionHardnessClass,
} from "../../../shared/print-recipe/hardness-class-table";
import {
    DEFAULT_ELEMENT_DEPTH,
    DEFAULT_ELEMENT_PRIORITY,
} from "../../../shared/print-recipe/hardness-region";

export const DEFAULT_SPLIT_HARDNESS: NamedHardnessClass = "Medium";

/** High-contrast colors used to locate additions while designing an insole. */
export const DESIGN_ELEMENT_COLORS = ["#a855f7"] as const;

export function isNamedHardnessClass(cls: RegionHardnessClass | undefined): cls is NamedHardnessClass {
    return !!cls && (NAMED_HARDNESS_CLASSES as readonly string[]).includes(cls);
}

export function resolvedSplitHardness(el: PlacedElement): NamedHardnessClass {
    if (!el.hardnessClass) return DEFAULT_SPLIT_HARDNESS;
    const migrated = migrateRegionHardnessClass(el.hardnessClass);
    return isNamedHardnessClass(migrated) ? migrated : DEFAULT_SPLIT_HARDNESS;
}

export function splitColorForElement(el: PlacedElement): string {
    return CLASS_PREVIEW_COLORS[resolvedSplitHardness(el)];
}

/** Stable purple design-view color; selected additions use the green selection highlight. */
export function designColorForElementIndex(index: number): string {
    return DESIGN_ELEMENT_COLORS[index % DESIGN_ELEMENT_COLORS.length] ?? DESIGN_ELEMENT_COLORS[0];
}

export function defaultSplitHardnessPatch(
    id: string,
): Pick<PlacedElement, "regionId" | "hardnessClass" | "priority" | "depth"> {
    return {
        regionId: id,
        hardnessClass: DEFAULT_SPLIT_HARDNESS,
        priority: DEFAULT_ELEMENT_PRIORITY,
        depth: { ...DEFAULT_ELEMENT_DEPTH },
    };
}

/** Closed XY outline in element-local mm (scale already applied). */
export function splitOverlayOutline(el: PlacedElement): { x: number; y: number }[] {
    if (el.kind === "custom") {
        const rx = Math.max(4, 12 * el.scale.x);
        const ry = Math.max(4, 12 * el.scale.y);
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < 28; i++) {
            const t = (i / 28) * Math.PI * 2;
            pts.push({ x: Math.cos(t) * rx, y: Math.sin(t) * ry });
        }
        return pts;
    }
    return elementOutlineLocalMm(el.kind, el.scale.x, el.scale.y, el.side, 36);
}

export function applyDefaultSplitHardness(elements: PlacedElement[]): PlacedElement[] {
    return elements.map((el) => (el.hardnessClass ? el : { ...el, ...defaultSplitHardnessPatch(el.id) }));
}

/** Selection changes only the outline in Print, so material color remains legible. */
export function elementPreviewColor(
    el: PlacedElement,
    print: boolean,
    selected: boolean,
    split = true,
): string {
    if (print) return split && el.hardnessClass ? splitColorForElement(el) : "#f8fafc";
    return selected ? "#22c55e" : DESIGN_ELEMENT_COLORS[0];
}
