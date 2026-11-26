// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

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

/** Neutral insole before a device hardness is chosen (viewer material only). */
export const INSOLE_VIEWPORT_BASE_COLOR = "#f8fafc";

/** Blend hardness preview into the base gray so lighting stays readable. */
export const INSOLE_HARDNESS_TINT_MIX = 0.42;

function mixHexColors(base: string, accent: string, mix: number): string {
    const parse = (hex: string) => {
        const h = hex.replace("#", "");
        return [
            Number.parseInt(h.slice(0, 2), 16),
            Number.parseInt(h.slice(2, 4), 16),
            Number.parseInt(h.slice(4, 6), 16),
        ] as const;
    };
    const [br, bg, bb] = parse(base);
    const [ar, ag, ab] = parse(accent);
    const t = Math.min(1, Math.max(0, mix));
    const channel = (b: number, a: number) => Math.round(b + (a - b) * t);
    const r = channel(br, ar);
    const g = channel(bg, ag);
    const b = channel(bb, ab);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Whole-insole viewport tint from PrintRecipe device hardness (not export geometry). */
export function insoleViewportMaterialColor(
    printRecipe: { defaultHardness?: RegionHardnessClass | string } | undefined | null,
): string {
    const raw = printRecipe?.defaultHardness;
    if (!raw) return INSOLE_VIEWPORT_BASE_COLOR;
    const cls = migrateRegionHardnessClass(raw);
    const preview = CLASS_PREVIEW_COLORS[cls] ?? CLASS_PREVIEW_COLORS.Medium;
    return mixHexColors(INSOLE_VIEWPORT_BASE_COLOR, preview, INSOLE_HARDNESS_TINT_MIX);
}

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
export function splitOverlayOutline(
    el: PlacedElement,
    frame?: { lengthMm: number; widthMm: number; outline?: { x: number; y: number }[] | null },
): { x: number; y: number }[] {
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
    return elementOutlineLocalMm(el.kind, el.scale.x, el.scale.y, el.side, 36, frame);
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
