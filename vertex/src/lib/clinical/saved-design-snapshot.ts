// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Fail-closed SAMPLE_Top parameter snapshot. Clinical numbers come only from
// structured catalog fields or the stored integration-link shoe. rx text is ignored.

import { defaultElementPose, ELEMENT_PROFILES } from "@/lib/geometry/elements";
import { SAMPLE_TOP_ASSET_ID, SAMPLE_TOP_GLB_PATH } from "@/lib/geometry/procedural-wall/sample-top-id";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { STOCK_ELEMENTS } from "@/lib/library/manifest";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState, ElementKind, PlacedElement, SideCorrections } from "@/types";
import {
    ARCH_HEIGHT_MM,
    FLEXIBLE_FOOT_APEX_MM,
    IGNORED_CATALOG_KEYS,
    type IgnoredCatalogKey,
    LOFT_US_MEN_MAX,
    LOFT_US_MEN_MIN,
    type SavedDesignCatalog,
    type SavedDesignSlider,
    SavedDesignSnapshotError,
    SLIDER_FIELDS,
    type StoredLinkShoe,
    US_WOMEN_TO_MENS_OFFSET,
} from "../../../shared/saved-design-catalog";

export interface SavedDesignSnapshotBuild {
    design: DesignState;
    paths: string[];
    ignoredFields: IgnoredCatalogKey[];
    usMenSize: number;
}

const LINK_WIDTHS = new Set(["narrow", "medium", "wide"]);

type DesignWidth = NonNullable<DesignState["shoeWidth"]>;

function close(a: number, b: number): boolean {
    return Math.abs(a - b) <= 1e-6;
}

function finiteOrNull(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isHalfStep(value: number): boolean {
    return Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) <= 1e-6;
}

function normalizeElementName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function elementAliases(): Map<string, ElementKind> {
    const aliases = new Map<string, ElementKind>();
    for (const entry of STOCK_ELEMENTS) {
        aliases.set(entry.id, entry.id);
        aliases.set(normalizeElementName(entry.label), entry.id);
    }
    aliases.set("mortons", "mortons_extension");
    aliases.set("reverse_morton", "reverse_mortons");
    aliases.set("cluffy", "cluffy_wedge");
    return aliases;
}

const ELEMENT_ALIASES = elementAliases();

function resolveElementKind(name: string): ElementKind {
    const kind = ELEMENT_ALIASES.get(normalizeElementName(name));
    if (!kind) {
        throw new SavedDesignSnapshotError(
            `unrecognized element "${name}". Named elements need a catalog name and a side.`,
        );
    }
    return kind;
}

function canonicalLinkWidth(width: string | null): "narrow" | "medium" | "wide" | null {
    if (width == null || width.trim() === "") return null;
    const key = width.trim().toLowerCase().replace(/\s+/g, "_");
    if (LINK_WIDTHS.has(key)) return key as "narrow" | "medium" | "wide";
    throw new SavedDesignSnapshotError(`stored shoe width "${width}" cannot be mapped. Refusing to guess.`);
}

function disagreeOptional(supplied: number | null | undefined, stored: number | null): boolean {
    if (supplied === undefined) return false;
    if (supplied == null) return stored != null;
    if (stored == null) return true;
    return !close(supplied, stored);
}

interface ResolvedShoe {
    system: "US_M" | "US_W" | "EU";
    size: number;
    left: number | null;
    right: number | null;
    width: DesignWidth | null;
}

function resolveShoe(stored: StoredLinkShoe | null, catalog: SavedDesignCatalog): ResolvedShoe {
    const storedSize = finiteOrNull(stored?.size);
    const storedSystem = stored?.system ?? null;
    const storedLeft = finiteOrNull(stored?.left);
    const storedRight = finiteOrNull(stored?.right);
    const storedWidth = stored ? canonicalLinkWidth(stored.width) : null;
    const supplied = catalog.shoe_size;

    if (supplied && storedSystem && supplied.system !== storedSystem) {
        throw new SavedDesignSnapshotError("supplied shoe size disagrees with the stored design link");
    }
    if (supplied && storedSize != null && !close(supplied.size, storedSize)) {
        throw new SavedDesignSnapshotError("supplied shoe size disagrees with the stored design link");
    }
    if (supplied && disagreeOptional(supplied.left, storedLeft)) {
        throw new SavedDesignSnapshotError("supplied shoe_size.left disagrees with the stored design link");
    }
    if (supplied && disagreeOptional(supplied.right, storedRight)) {
        throw new SavedDesignSnapshotError("supplied shoe_size.right disagrees with the stored design link");
    }
    if (catalog.width && storedWidth && catalog.width !== storedWidth) {
        throw new SavedDesignSnapshotError("supplied width disagrees with the stored design link");
    }

    const system = supplied?.system ?? storedSystem;
    const size = supplied?.size ?? storedSize;
    const left = supplied && supplied.left !== undefined ? supplied.left : storedLeft;
    const right = supplied && supplied.right !== undefined ? supplied.right : storedRight;
    const width = (catalog.width ?? storedWidth) as DesignWidth | null;

    if (!system || size == null) {
        throw new SavedDesignSnapshotError(
            "shoe size is required to loft a saved design. Refusing to invent one.",
        );
    }
    if ((left == null) !== (right == null)) {
        throw new SavedDesignSnapshotError(
            "shoe_size_left and shoe_size_right must both be set. Refusing to invent the missing side.",
        );
    }
    if (left != null && right != null && !close(left, right)) {
        throw new SavedDesignSnapshotError(
            "left and right shoe sizes differ. Refusing to invent a single loft size.",
        );
    }
    if (left != null && right != null && !close(left, size)) {
        throw new SavedDesignSnapshotError(
            "split shoe size disagrees with shoe_size.size. Refusing to pick one.",
        );
    }
    if (!isHalfStep(size) || size <= 0) {
        throw new SavedDesignSnapshotError("shoe size is not a positive half-step. Refusing to round it.");
    }
    return { system, size, left, right, width };
}

function usMenSizeFromShoe(shoe: ResolvedShoe): number {
    if (shoe.system === "EU") {
        throw new SavedDesignSnapshotError(
            "shoe size system EU cannot be lofted. Refusing to invent a US men's size.",
        );
    }
    const men = shoe.system === "US_W" ? shoe.size - US_WOMEN_TO_MENS_OFFSET : shoe.size;
    if (!isHalfStep(men) || men < LOFT_US_MEN_MIN || men > LOFT_US_MEN_MAX) {
        throw new SavedDesignSnapshotError("shoe size is outside US men's 1–16. Refusing to clamp it.");
    }
    const layout = insoleLayoutForUsMenSize(men);
    if (!close(layout.usMenSize, men)) {
        throw new SavedDesignSnapshotError("loft sizing would change the shoe size. Refusing to write.");
    }
    return men;
}

function applySliders(side: SideCorrections, sliders: SavedDesignSlider, paths: string[], sideName: string) {
    for (const [key, field] of Object.entries(SLIDER_FIELDS) as [keyof typeof SLIDER_FIELDS, string][]) {
        const value = sliders[key];
        if (typeof value !== "number") continue;
        (side as unknown as Record<string, number>)[field] = value;
        paths.push(`settings.corrections.${sideName}.${field}`);
    }
}

function sliderHasNumber(sliders: SavedDesignSlider | undefined): boolean {
    if (!sliders) return false;
    return Object.values(sliders).some((value) => typeof value === "number");
}

function ignoredFields(catalog: SavedDesignCatalog): IgnoredCatalogKey[] {
    return IGNORED_CATALOG_KEYS.filter((key) => catalog[key] !== undefined);
}

/**
 * SAMPLE_Top template plus stored/provided catalog fields.
 * Omitted clinical inputs stay at the unmodified template (zeros, no elements).
 */
export function buildSavedDesignSnapshot(input: {
    stored: StoredLinkShoe | null;
    catalog: SavedDesignCatalog;
}): SavedDesignSnapshotBuild {
    const shoe = resolveShoe(input.stored, input.catalog);
    const usMenSize = usMenSizeFromShoe(shoe);
    const layout = insoleLayoutForUsMenSize(usMenSize);
    const design = createDesignWithStockPlaceholder();
    if (
        design.base?.assetId !== SAMPLE_TOP_ASSET_ID ||
        design.base.glbPath !== SAMPLE_TOP_GLB_PATH ||
        design.paired?.leftBase?.assetId !== SAMPLE_TOP_ASSET_ID ||
        design.paired.rightBase?.mirrored !== true
    ) {
        throw new SavedDesignSnapshotError(
            "SAMPLE_Top template is not available. Refusing to write a different base.",
        );
    }

    const paths = [
        "schemaVersion",
        "settings.pattern",
        "settings.method",
        "settings.thicknessMm",
        "settings.sizeSystem",
        "settings.usMenSize",
        "settings.base.assetId",
        "settings.base.glbPath",
        "settings.base.url",
        "settings.paired.leftBase.assetId",
        "settings.paired.rightBase.assetId",
        "settings.paired.rightBase.mirrored",
        "settings.printRecipe",
        "settings.corrections",
        "settings.elements",
    ];

    design.sizeSystem = "us";
    design.usMenSize = usMenSize;
    if (shoe.width) {
        design.shoeWidth = shoe.width;
        paths.push("settings.shoeWidth");
    } else {
        delete design.shoeWidth;
    }

    const catalog = input.catalog;
    if (
        sliderHasNumber(catalog.sliders) &&
        (catalog.sliders_by_side?.left || catalog.sliders_by_side?.right)
    ) {
        throw new SavedDesignSnapshotError("provide sliders or sliders_by_side, not both.");
    }
    if (catalog.sliders_by_side && (catalog.sliders_by_side.left || catalog.sliders_by_side.right)) {
        design.corrections.linked = false;
        paths.push("settings.corrections.linked");
        if (catalog.sliders_by_side.left) {
            applySliders(design.corrections.left, catalog.sliders_by_side.left, paths, "left");
        }
        if (catalog.sliders_by_side.right) {
            applySliders(design.corrections.right, catalog.sliders_by_side.right, paths, "right");
        }
    } else if (catalog.sliders) {
        applySliders(design.corrections.left, catalog.sliders, paths, "left");
        applySliders(design.corrections.right, catalog.sliders, paths, "right");
    }

    if (catalog.arch) {
        const mm = ARCH_HEIGHT_MM[catalog.arch];
        design.corrections.left.archHeightMm = mm;
        design.corrections.right.archHeightMm = mm;
        paths.push("settings.corrections.left.archHeightMm", "settings.corrections.right.archHeightMm");
    }

    if (catalog.flexible_foot === true) {
        design.corrections.left.apexMoveMm = FLEXIBLE_FOOT_APEX_MM;
        design.corrections.right.apexMoveMm = FLEXIBLE_FOOT_APEX_MM;
        paths.push("settings.corrections.left.apexMoveMm", "settings.corrections.right.apexMoveMm");
    }

    if (catalog.rearfoot_wedge) {
        const wedge = {
            side: catalog.rearfoot_wedge.side,
            value: catalog.rearfoot_wedge.value,
            unit: catalog.rearfoot_wedge.unit,
            ...(catalog.rearfoot_wedge.degree_mode ? { degreeMode: catalog.rearfoot_wedge.degree_mode } : {}),
        };
        design.corrections.left.rearfootWedge = wedge;
        design.corrections.right.rearfootWedge = { ...wedge };
        paths.push("settings.corrections.left.rearfootWedge", "settings.corrections.right.rearfootWedge");
    }
    if (catalog.forefoot_wedge) {
        const wedge = {
            side: catalog.forefoot_wedge.side,
            value: catalog.forefoot_wedge.value,
            unit: catalog.forefoot_wedge.unit,
            ...(catalog.forefoot_wedge.degree_mode ? { degreeMode: catalog.forefoot_wedge.degree_mode } : {}),
        };
        design.corrections.left.forefootWedge = wedge;
        design.corrections.right.forefootWedge = { ...wedge };
        paths.push("settings.corrections.left.forefootWedge", "settings.corrections.right.forefootWedge");
    }
    if (catalog.full_length_wedge) {
        const wedge = {
            side: catalog.full_length_wedge.side,
            value: catalog.full_length_wedge.value,
            unit: catalog.full_length_wedge.unit,
        };
        design.corrections.left.fullLengthWedge = wedge;
        design.corrections.right.fullLengthWedge = { ...wedge };
        paths.push("settings.corrections.left.fullLengthWedge", "settings.corrections.right.fullLengthWedge");
    }

    const counts = new Map<string, number>();
    const elements: PlacedElement[] = [];
    for (const entry of catalog.elements ?? []) {
        const kind = resolveElementKind(entry.name);
        const key = `${kind}:${entry.side}`;
        const index = (counts.get(key) ?? 0) + 1;
        counts.set(key, index);
        const pose = defaultElementPose(kind, entry.side, layout.lengthMm, layout.widthMm);
        const heightMm = entry.height_mm ?? pose.heightMm;
        if (entry.height_mm === undefined && heightMm !== ELEMENT_PROFILES[kind].defaultHeightMm) {
            throw new SavedDesignSnapshotError(
                "element default magnitude is not the built-in profile. Refusing to write.",
            );
        }
        elements.push({
            id: `snapshot-${kind}-${entry.side}-${index}`,
            kind,
            side: entry.side,
            position: pose.position,
            rotationDeg: pose.rotationDeg,
            scale: pose.scale,
            heightMm,
            ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
        });
    }
    design.elements = elements;

    return { design, paths, ignoredFields: ignoredFields(catalog), usMenSize };
}
