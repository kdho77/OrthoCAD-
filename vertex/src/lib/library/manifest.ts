import type { ElementKind, ScanPattern } from "@/types";

/** Stock element catalog entry — clinical procedural footprints in `lib/geometry/elements.ts`. */
export interface StockElementEntry {
    id: ElementKind;
    label: string;
    category: string;
    stock: true;
}

/** Stock prefab / pattern catalog entry. */
export interface StockPrefabEntry {
    id: ScanPattern;
    label: string;
    category: string;
    stock: true;
}

/** Unified library item shown in UI (stock or custom). */
export interface LibraryElementItem {
    id: string;
    name: string;
    category: string;
    stock: boolean;
    parentStockId?: string | null;
    url?: string | null;
    glbPath?: string;
    createdAt?: string;
}

export interface LibraryPrefabItem {
    id: string;
    name: string;
    category: string;
    stock: boolean;
    parentStockId?: string | null;
    url?: string | null;
    glbPath?: string;
    createdAt?: string;
    /** True when the prefab was imported from an external GLB upload. */
    uploaded?: boolean;
    /** Number of source meshes in the GLB (e.g. Top + Bottom ⇒ 2). */
    meshCount?: number;
}

export const STOCK_ELEMENTS: StockElementEntry[] = [
    { id: "met_pad", label: "Met Pad", category: "pad", stock: true },
    { id: "met_bar", label: "Met Bar", category: "bar", stock: true },
    { id: "cluffy_wedge", label: "Cluffy Wedge", category: "wedge", stock: true },
    { id: "mortons_extension", label: "Morton's Ext.", category: "extension", stock: true },
    { id: "reverse_mortons", label: "Rev. Morton's", category: "extension", stock: true },
    { id: "kinetic_wedge", label: "Kinetic Wedge", category: "wedge", stock: true },
    { id: "heel_sink", label: "Heel Sink", category: "sink", stock: true },
    { id: "navicular_sink", label: "Navicular Sink", category: "sink", stock: true },
];

export const STOCK_PREFABS: StockPrefabEntry[] = [
    { id: "full_contact", label: "Full Contact", category: "insole", stock: true },
    { id: "prefab_3d", label: "Prefab 3D", category: "shell", stock: true },
    { id: "flat", label: "Flat", category: "insole", stock: true },
    { id: "custom", label: "Custom", category: "other", stock: true },
];

export const STOCK_ELEMENT_LABELS: Record<ElementKind, string> = Object.fromEntries(
    STOCK_ELEMENTS.map((e) => [e.id, e.label]),
) as Record<ElementKind, string>;

export const STOCK_PREFAB_LABELS: Record<ScanPattern, string> = Object.fromEntries(
    STOCK_PREFABS.map((p) => [p.id, p.label]),
) as Record<ScanPattern, string>;

/** Merge stock + custom element rows for the library panel. */
export function mergeElementLibrary(custom: LibraryElementItem[]): LibraryElementItem[] {
    const stock: LibraryElementItem[] = STOCK_ELEMENTS.map((s) => ({
        id: s.id,
        name: s.label,
        category: s.category,
        stock: true,
    }));
    return [...stock, ...custom];
}

/** Merge stock + custom prefab rows for the pattern selector. */
export function mergePrefabLibrary(custom: LibraryPrefabItem[]): LibraryPrefabItem[] {
    const stock: LibraryPrefabItem[] = STOCK_PREFABS.map((s) => ({
        id: s.id,
        name: s.label,
        category: s.category,
        stock: true,
    }));
    return [...stock, ...custom];
}

/** Resolve display label for a placed element (stock kind or custom name). */
export function elementDisplayName(kind: ElementKind | "custom", customName?: string): string {
    if (kind === "custom") return customName ?? "Custom Element";
    return STOCK_ELEMENT_LABELS[kind] ?? kind;
}
