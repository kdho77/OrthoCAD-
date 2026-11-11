// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Fail-closed SAMPLE_Top parameter snapshot for MCP persist and server tooling.
// No Vite aliases and no client stores — safe to compile with the Node server bundle.

import type {
    DesignBase,
    DesignState,
    ElementKind,
    PlacedElement,
    PlacedSink,
    ShapeFinishModifiers,
    Side,
    SideCorrections,
    SinkKind,
} from "../src/types/index.js";
import { canonicalMaterialHardness } from "./dogfood-manufacturing.js";
import { type HardnessName, migratePrintRecipe } from "./print-recipe/print-recipe.js";
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
} from "./saved-design-catalog.js";
import { SINK_DEFAULT_DEPTH_MM, SINK_KIND_ORDER, SINK_PROFILES } from "./sink-profiles.js";

/** Men's 9 reference template — matches layout.ts. */
const INSOLE_LENGTH_MM = 260;
const INSOLE_WIDTH_MM = 95;

/** Bundled SAMPLE_Top (sample-top-id.ts). */
const SAMPLE_TOP_PUBLIC_PATH = "/Templates/SAMPLE_Top.glb";
const SAMPLE_TOP_GLB_PATH = "Templates/SAMPLE_Top.glb";
const SAMPLE_TOP_ASSET_ID = "sample-top";
const SAMPLE_TOP_NAME = "SAMPLE_Top";

const BASE_REFERENCE_THICKNESS_MM = 2;

/** Matches SHAPE_FINISH_DEFAULTS in shape-finish-modifiers (printing_solid default). */
function defaultShapeFinishModifiers(): ShapeFinishModifiers {
    const side = {
        topCoverAccommodateMm: 1.25,
        trimmableForefoot: false,
        trimmableForefootExtraMm: 5,
        archGrindDepthMm: 0,
        archSkiveMm: 0,
        archSkiveSide: "medial" as const,
    };
    return { left: { ...side }, right: { ...side }, linked: true };
}

function defaultSideCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        forefootWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function bareSampleTopDesign(): DesignState {
    return {
        pattern: "full_contact",
        method: "printing_solid",
        printRecipe: migratePrintRecipe(undefined),
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        shellThicknessMode: "zonal",
        shellThicknessRfMm: 3,
        shellThicknessMfMm: 2.5,
        shellThicknessFfMm: 2,
        shellThicknessBlendMm: 12,
        sizeSystem: "us",
        usMenSize: 9,
        shoeWidth: "medium",
        corrections: {
            unit: "mm",
            linked: true,
            left: defaultSideCorrections(),
            right: defaultSideCorrections(),
        },
        shapeFinish: defaultShapeFinishModifiers(),
        elements: [],
    };
}

const DEFAULT_STOCK_PRIMARY_SIDE: Side = "left";

function getSampleTopStockBase(): DesignBase {
    return {
        assetId: SAMPLE_TOP_ASSET_ID,
        name: SAMPLE_TOP_NAME,
        source: "stock",
        glbPath: SAMPLE_TOP_GLB_PATH,
        url: SAMPLE_TOP_PUBLIC_PATH,
        primarySide: DEFAULT_STOCK_PRIMARY_SIDE,
        offlinePlaceholder: true,
        resolutionFallback: true,
    };
}

function createDefaultStockPairedBases(sourceBase: DesignBase): { left: DesignBase; right: DesignBase } {
    const primarySide = sourceBase.primarySide?.toLowerCase() ?? DEFAULT_STOCK_PRIMARY_SIDE;
    const sourceIsLeft = primarySide === "left";
    const authoritativeName = sourceBase.name?.replace(/\s*\((Left|Right)\)?$/i, "") ?? "Stock Base";

    const shared: Pick<
        DesignBase,
        "assetId" | "source" | "glbPath" | "url" | "primarySide" | "offlinePlaceholder" | "resolutionFallback"
    > = {
        assetId: sourceBase.assetId,
        source: "stock",
        glbPath: sourceBase.glbPath,
        ...(sourceBase.url ? { url: sourceBase.url } : {}),
        ...(sourceBase.primarySide !== undefined ? { primarySide: sourceBase.primarySide } : {}),
        ...(sourceBase.offlinePlaceholder ? { offlinePlaceholder: true } : {}),
        ...(sourceBase.resolutionFallback ? { resolutionFallback: true } : {}),
    };

    const sourceBaseLr: DesignBase = {
        ...shared,
        name: `${authoritativeName} (${sourceIsLeft ? "Left" : "Right"})`,
    };

    const mirrorBase: DesignBase = {
        ...shared,
        name: `${authoritativeName} (${sourceIsLeft ? "Right" : "Left"})`,
        mirrored: true,
        mirroredFrom: sourceBase.assetId,
    };

    return sourceIsLeft
        ? { left: sourceBaseLr, right: mirrorBase }
        : { left: mirrorBase, right: sourceBaseLr };
}

function replaceBuiltinDefaultWithSampleTop(design: DesignState): DesignState {
    const { left, right } = createDefaultStockPairedBases(getSampleTopStockBase());
    return {
        ...design,
        base: left,
        customPrefabId: left.assetId,
        customPrefabName: left.name,
        paired: {
            leftBase: left,
            rightBase: right,
            leftThicknessMm:
                design.paired?.leftThicknessMm ?? design.thicknessMm ?? BASE_REFERENCE_THICKNESS_MM,
            rightThicknessMm:
                design.paired?.rightThicknessMm ?? design.thicknessMm ?? BASE_REFERENCE_THICKNESS_MM,
            leftMethod: design.paired?.leftMethod ?? design.method,
            rightMethod: design.paired?.rightMethod ?? design.method,
            linked: design.paired?.linked ?? false,
        },
    };
}

/** Same entries as STOCK_ELEMENTS in library/manifest (labels for alias resolution only). */
const STOCK_ELEMENT_IDS: { id: ElementKind; label: string }[] = [
    { id: "met_pad", label: "Met Pad" },
    { id: "met_bar", label: "Met Bar" },
    { id: "toe_crest", label: "Toe Crest" },
    { id: "cuboid_pad", label: "Cuboid Pad" },
    { id: "cluffy_wedge", label: "Cluffy wedge 1" },
    { id: "mortons_extension", label: "Morton's Ext." },
    { id: "reverse_mortons", label: "Rev. Morton's" },
    { id: "kinetic_wedge", label: "Kinetic Wedge" },
    { id: "heel_sink", label: "Heel Sink" },
    { id: "navicular_sink", label: "Navicular Sink" },
    { id: "scaphoid_pad", label: "Scaphoid Pad" },
    { id: "heel_cushion", label: "Heel Cushion" },
    { id: "dancers_pad", label: "Dancer's pad (1st MPJ relief)" },
];

/** Subset of ELEMENT_PROFILES needed for default placement and height checks. */
const ELEMENT_PROFILES: Record<
    ElementKind,
    {
        defaultHeightMm: number;
        defaultU: number;
        defaultMedial: number;
        anatomicalSide: "medial" | "lateral" | "midline";
    }
> = {
    met_pad: { defaultHeightMm: 5, defaultU: 0.5473, defaultMedial: 0.0722, anatomicalSide: "medial" },
    met_bar: { defaultHeightMm: 3.47, defaultU: 0.5162, defaultMedial: -0.0387, anatomicalSide: "lateral" },
    toe_crest: { defaultHeightMm: 2.47, defaultU: 0.7802, defaultMedial: -0.2859, anatomicalSide: "lateral" },
    cuboid_pad: {
        defaultHeightMm: 6.37,
        defaultU: 0.3448,
        defaultMedial: -0.6865,
        anatomicalSide: "lateral",
    },
    cluffy_wedge: { defaultHeightMm: 2.4, defaultU: 0.7744, defaultMedial: 0.6413, anatomicalSide: "medial" },
    mortons_extension: {
        defaultHeightMm: 3,
        defaultU: 0.81,
        defaultMedial: 0.5984,
        anatomicalSide: "medial",
    },
    reverse_mortons: { defaultHeightMm: 3, defaultU: 0.81, defaultMedial: 0.5984, anatomicalSide: "medial" },
    kinetic_wedge: { defaultHeightMm: 2.5, defaultU: 0.72, defaultMedial: 0.48, anatomicalSide: "medial" },
    heel_sink: { defaultHeightMm: 2, defaultU: 0.12, defaultMedial: 0, anatomicalSide: "midline" },
    navicular_sink: { defaultHeightMm: 2, defaultU: 0.38, defaultMedial: 0.55, anatomicalSide: "medial" },
    scaphoid_pad: { defaultHeightMm: 4, defaultU: 0.42, defaultMedial: 0.62, anatomicalSide: "medial" },
    heel_cushion: { defaultHeightMm: 3, defaultU: 0.14, defaultMedial: 0, anatomicalSide: "midline" },
    dancers_pad: {
        defaultHeightMm: 2.5,
        defaultU: 0.6496,
        defaultMedial: -0.0196,
        anatomicalSide: "midline",
    },
};

/** Same mesh-Y rule as meshYForAnatomicalSide in geometry/handedness.ts. */
function meshPlacementY(
    side: Side,
    anatomicalSide: "medial" | "lateral" | "midline",
    magnitudeMm: number,
): number {
    if (anatomicalSide === "midline" || !(magnitudeMm > 0)) return 0;
    const medial = side === "left" ? -1 : 1;
    const sign = anatomicalSide === "medial" ? medial : -medial;
    return sign * magnitudeMm;
}

function defaultElementPose(
    kind: ElementKind,
    side: Side,
    lengthMm: number,
    widthMm: number,
): Pick<PlacedElement, "position" | "rotationDeg" | "scale" | "heightMm" | "placementMode"> {
    const p = ELEMENT_PROFILES[kind];
    return {
        position: {
            x: p.defaultU * lengthMm - lengthMm / 2,
            y: meshPlacementY(side, p.anatomicalSide, Math.abs(p.defaultMedial) * (widthMm / 2)),
        },
        rotationDeg: 0,
        scale: { x: 1, y: 1 },
        heightMm: p.defaultHeightMm,
        placementMode:
            kind === "met_pad" ||
            kind === "met_bar" ||
            kind === "toe_crest" ||
            kind === "cuboid_pad" ||
            kind === "dancers_pad" ||
            kind === "cluffy_wedge"
                ? "flow"
                : undefined,
    };
}

function normalizeUsMenSize(menSize: number): number {
    if (!Number.isFinite(menSize)) return 9;
    const clamped = Math.min(LOFT_US_MEN_MAX, Math.max(LOFT_US_MEN_MIN, menSize));
    return Math.round(clamped * 2) / 2;
}

const BARLEYCORN_MM = 25.4 / 3;

function usMenFootLengthMm(menSize: number): number {
    return (normalizeUsMenSize(menSize) + 22) * BARLEYCORN_MM;
}

function referenceFootLengthMm(): number {
    return usMenFootLengthMm(9);
}

export interface InsoleLayoutLite {
    usMenSize: number;
    lengthMm: number;
    widthMm: number;
}

function insoleLayoutForFootLengthMm(footLengthMm: number): InsoleLayoutLite {
    const foot = Math.max(1, footLengthMm);
    const scale = foot / referenceFootLengthMm();
    const usMenSize = foot / BARLEYCORN_MM - 22;
    return {
        usMenSize: normalizeUsMenSize(usMenSize),
        lengthMm: INSOLE_LENGTH_MM * scale,
        widthMm: INSOLE_WIDTH_MM * scale,
    };
}

function insoleLayoutForUsMenSize(menSize: number): InsoleLayoutLite {
    const usMenSize = normalizeUsMenSize(menSize);
    return insoleLayoutForFootLengthMm(usMenFootLengthMm(usMenSize));
}

export interface SavedDesignSnapshotBuild {
    design: DesignState;
    paths: string[];
    ignoredFields: IgnoredCatalogKey[];
    usMenSize: number;
    shoeWidth: NonNullable<DesignState["shoeWidth"]>;
    shoeWidthSource: "prescribed" | "defaulted";
    hardness: HardnessName | null;
    hardnessSource: "prescribed" | "unspecified";
    /** Retail size written on the integration link. Not the lofted US men's number. */
    linkShoe: {
        system: "US_M" | "US_W";
        size: number;
        left: number | null;
        right: number | null;
    };
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
    for (const entry of STOCK_ELEMENT_IDS) {
        aliases.set(entry.id, entry.id);
        aliases.set(normalizeElementName(entry.label), entry.id);
    }
    aliases.set("mortons", "mortons_extension");
    aliases.set("reverse_morton", "reverse_mortons");
    aliases.set("cluffy", "cluffy_wedge");
    return aliases;
}

const ELEMENT_ALIASES = elementAliases();

function sinkAliases(): Map<string, SinkKind> {
    const aliases = new Map<string, SinkKind>();
    const add = (alias: string, kind: SinkKind) => {
        const key = normalizeElementName(alias);
        const previous = aliases.get(key);
        if (previous && previous !== kind) {
            throw new Error(`sink alias "${key}" maps to both ${previous} and ${kind}`);
        }
        aliases.set(key, kind);
    };
    for (const kind of SINK_KIND_ORDER) {
        add(kind, kind);
        add(SINK_PROFILES[kind].label, kind);
    }
    add("1st met head", "mpj1");
    add("1st metatarsal head", "mpj1");
    add("first met head", "mpj1");
    add("first mpj", "mpj1");
    add("1st met head sink", "mpj1");
    add("2nd met head", "mpj2");
    add("3rd met head", "mpj3");
    add("4th met head", "mpj4");
    add("5th met head", "mpj5");
    add("5th ipj", "styloid");
    add("5th styloid", "styloid");
    return aliases;
}

const SINK_ALIASES = sinkAliases();

type CatalogSink = NonNullable<SavedDesignCatalog["sinks"]>[number];

function lookupSinkKind(name: string): SinkKind | undefined {
    return SINK_ALIASES.get(normalizeElementName(name));
}

function resolveCatalogSinkKind(entry: CatalogSink): SinkKind {
    if (!entry.name && !entry.kind) {
        throw new SavedDesignSnapshotError("sink needs a name or kind and a side. Refusing to write.");
    }
    const fromName = entry.name ? lookupSinkKind(entry.name) : undefined;
    const fromKind = entry.kind ? lookupSinkKind(entry.kind) : undefined;
    if (entry.name && !fromName) {
        throw new SavedDesignSnapshotError(
            `unrecognized sink "${entry.name}". Named sinks need a catalog name and a side.`,
        );
    }
    if (entry.kind && !fromKind) {
        throw new SavedDesignSnapshotError(
            `unrecognized sink "${entry.kind}". Named sinks need a catalog name and a side.`,
        );
    }
    if (fromName && fromKind && fromName !== fromKind) {
        throw new SavedDesignSnapshotError(
            `sink name "${entry.name}" and kind "${entry.kind}" do not match. Refusing to write.`,
        );
    }
    const kind = fromName ?? fromKind;
    if (!kind) {
        throw new SavedDesignSnapshotError("sink needs a name or kind and a side. Refusing to write.");
    }
    return kind;
}

function placedSinkFromCatalog(entry: CatalogSink, kind: SinkKind): PlacedSink {
    const profile = SINK_PROFILES[kind];
    const label = entry.name ?? entry.kind ?? profile.label;
    if (entry.depth_mm === undefined && profile.defaultDepthMm !== SINK_DEFAULT_DEPTH_MM) {
        throw new SavedDesignSnapshotError(
            "sink default depth is not the built-in profile. Refusing to write.",
        );
    }
    const depthMm = entry.depth_mm ?? SINK_DEFAULT_DEPTH_MM;
    if (!(depthMm > 0) || depthMm > profile.maxDepthMm) {
        throw new SavedDesignSnapshotError(
            `sink "${label}" depth ${depthMm} mm must be greater than 0 and at most ${profile.maxDepthMm} mm (${profile.label}). Refusing to write.`,
        );
    }
    return {
        id: `snapshot-sink-${kind}-${entry.side}`,
        kind,
        depthMm,
        ...(entry.u !== undefined ? { u: entry.u } : {}),
        ...(entry.v !== undefined ? { v: entry.v } : {}),
    };
}

function assertSameFootSinkRules(
    elements: PlacedElement[],
    sinks: { left: PlacedSink[]; right: PlacedSink[] },
) {
    for (const side of ["left", "right"] as const) {
        if (!sinks[side].some((sink) => sink.kind === "rkw")) continue;
        const sameSide = elements.filter((element) => element.side === side);
        const has = (kind: ElementKind) => sameSide.some((element) => element.kind === kind);
        if (has("mortons_extension")) {
            throw new SavedDesignSnapshotError(
                "Morton's and the reverse kinetic wedge cannot be on the same foot. Refusing to write.",
            );
        }
        if (has("reverse_mortons")) {
            throw new SavedDesignSnapshotError(
                "Reverse Morton's with a reverse kinetic wedge needs an explicit override. Refusing to write.",
            );
        }
        if (has("kinetic_wedge")) {
            throw new SavedDesignSnapshotError(
                "A kinetic wedge is already on this foot. A second one is not added. Refusing to write.",
            );
        }
    }
}

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

/**
 * Absolute Arch height and Apex shift slider values. Pair-wide numbers write
 * both feet. arch_by_side writes one foot and unlinks. A number that disagrees
 * with arch or flexible_foot is refused. Arch fill is left at 0.
 */
function applyArchSliderNumbers(design: DesignState, catalog: SavedDesignCatalog, paths: string[]) {
    const bySide = catalog.arch_by_side;
    const bySideActive = Boolean(bySide?.left || bySide?.right);
    if (bySideActive && (catalog.arch_raise_mm !== undefined || catalog.arch_apex_shift_mm !== undefined)) {
        throw new SavedDesignSnapshotError(
            "provide arch_raise_mm and arch_apex_shift_mm or arch_by_side, not both.",
        );
    }
    const presetRaise = catalog.arch ? ARCH_HEIGHT_MM[catalog.arch] : undefined;
    const writeSide = (sideName: "left" | "right", raise: number | undefined, shift: number | undefined) => {
        const side = design.corrections[sideName];
        if (raise !== undefined) {
            if (presetRaise !== undefined && raise !== presetRaise) {
                throw new SavedDesignSnapshotError(
                    `arch_raise_mm ${raise} disagrees with arch ${catalog.arch} (${presetRaise} mm). Refusing to guess.`,
                );
            }
            if (side.archHeightMm !== raise) {
                side.archHeightMm = raise;
                paths.push(`settings.corrections.${sideName}.archHeightMm`);
            }
        }
        if (shift !== undefined) {
            if (catalog.flexible_foot === true && shift !== FLEXIBLE_FOOT_APEX_MM) {
                throw new SavedDesignSnapshotError(
                    `arch_apex_shift_mm ${shift} disagrees with flexible_foot apex +${FLEXIBLE_FOOT_APEX_MM} mm forward. Refusing to guess.`,
                );
            }
            if (side.apexMoveMm !== shift) {
                side.apexMoveMm = shift;
                paths.push(`settings.corrections.${sideName}.apexMoveMm`);
            }
        }
    };
    if (bySideActive && bySide) {
        if (design.corrections.linked) {
            design.corrections.linked = false;
            paths.push("settings.corrections.linked");
        }
        if (bySide.left) writeSide("left", bySide.left.arch_raise_mm, bySide.left.arch_apex_shift_mm);
        if (bySide.right) writeSide("right", bySide.right.arch_raise_mm, bySide.right.arch_apex_shift_mm);
        return;
    }
    writeSide("left", catalog.arch_raise_mm, catalog.arch_apex_shift_mm);
    writeSide("right", catalog.arch_raise_mm, catalog.arch_apex_shift_mm);
}

function ignoredFields(catalog: SavedDesignCatalog): IgnoredCatalogKey[] {
    return IGNORED_CATALOG_KEYS.filter((key) => {
        if (key === "hardness") return false;
        return catalog[key] !== undefined;
    });
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
    const design = replaceBuiltinDefaultWithSampleTop(bareSampleTopDesign());
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
    const shoeWidth = shoe.width ?? "medium";
    const shoeWidthSource = shoe.width ? "prescribed" : "defaulted";
    design.shoeWidth = shoeWidth;
    paths.push("settings.shoeWidth", "settings.dogfoodManufacturing.shoeWidthSource");

    let hardness: HardnessName | null = null;
    let hardnessSource: "prescribed" | "unspecified" = "unspecified";
    if (input.catalog.hardness !== undefined) {
        const named = canonicalMaterialHardness(input.catalog.hardness);
        if (!named) {
            throw new SavedDesignSnapshotError(
                `hardness "${input.catalog.hardness}" is not a known material hardness. Refusing to guess.`,
            );
        }
        hardness = named;
        hardnessSource = "prescribed";
        if (!design.printRecipe) {
            throw new SavedDesignSnapshotError("print recipe is missing. Refusing to invent one.");
        }
        design.printRecipe = { ...design.printRecipe, defaultHardness: named };
        paths.push("settings.printRecipe.defaultHardness");
    }
    design.dogfoodManufacturing = {
        template: "SAMPLE_Top",
        scansUsed: false,
        shoeWidth,
        shoeWidthSource,
        hardness,
        hardnessSource,
    };

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

    applyArchSliderNumbers(design, catalog, paths);

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

    const sideSinks: { left: PlacedSink[]; right: PlacedSink[] } = { left: [], right: [] };
    const seenSinks = new Set<string>();
    for (const entry of catalog.sinks ?? []) {
        const kind = resolveCatalogSinkKind(entry);
        const key = `${kind}:${entry.side}`;
        if (seenSinks.has(key)) {
            throw new SavedDesignSnapshotError(
                `sink "${kind}" is already on the ${entry.side} foot. One of each kind per side. Refusing to write.`,
            );
        }
        seenSinks.add(key);
        sideSinks[entry.side].push(placedSinkFromCatalog(entry, kind));
    }
    assertSameFootSinkRules(elements, sideSinks);
    if (sideSinks.left.length > 0 || sideSinks.right.length > 0) {
        design.sinks = {
            ...(sideSinks.left.length > 0 ? { left: sideSinks.left } : {}),
            ...(sideSinks.right.length > 0 ? { right: sideSinks.right } : {}),
        };
        paths.push("settings.sinks");
    }

    return {
        design,
        paths,
        ignoredFields: ignoredFields(catalog),
        usMenSize,
        shoeWidth,
        shoeWidthSource,
        hardness,
        hardnessSource,
        linkShoe: {
            system: shoe.system === "US_W" ? "US_W" : "US_M",
            size: shoe.size,
            left: shoe.left,
            right: shoe.right,
        },
    };
}
