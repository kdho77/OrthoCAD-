// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { HardnessName, LesionTag, MaterialZoneV1, PrintRecipeV1, SoleUvPoint } from "./print-recipe";

/** Stock element kinds that must enable soft-wins (Biomechanics Phase B). */
export const ACCOMMODATIVE_ELEMENT_KINDS = new Set<string>([
    "met_pad",
    "met_bar",
    "heel_sink",
    "navicular_sink", // scaphoid / navicular accommodative sink
    "cluffy_wedge",
    "kinetic_wedge",
]);

/** Discrete elements tied to high-risk lesions (soft-wins when overlapping a zone). */
export const HIGH_RISK_ELEMENT_KINDS = new Set<string>(["mortons_extension", "reverse_mortons"]);

/** Custom library rows derived from these stock ids inherit accommodative tagging. */
export const ACCOMMODATIVE_PARENT_STOCK_IDS = ACCOMMODATIVE_ELEMENT_KINDS;

export function lesionTagsForElementKind(kind: string): LesionTag[] {
    if (HIGH_RISK_ELEMENT_KINDS.has(kind)) return ["highRisk"];
    if (ACCOMMODATIVE_ELEMENT_KINDS.has(kind)) return ["accommodative"];
    return [];
}

export function lesionTagsForCustomElementMeta(
    parentStockId: string | null | undefined,
    customName: string | undefined,
): LesionTag[] {
    if (parentStockId) {
        const fromParent = lesionTagsForElementKind(parentStockId);
        if (fromParent.length) return fromParent;
    }
    const n = (customName ?? "").toLowerCase();
    if (/dancer|heel cushion|heel pad|scaphoid|met pad|accommodat|sink/.test(n)) {
        return ["accommodative"];
    }
    if (/morton|neuroma|high risk|high-risk/.test(n)) {
        return ["highRisk"];
    }
    return [];
}

/** Extra Soft hardness in an accommodative region (e.g. heel cushion) → soft-wins. */
export function lesionTagsForZoneHardness(hardnessName: HardnessName): LesionTag[] {
    if (hardnessName === "Extra Soft") return ["accommodative"];
    return [];
}

export function mergeLesionTags(...groups: Array<LesionTag[] | undefined>): LesionTag[] {
    const out = new Set<LesionTag>();
    for (const g of groups) {
        if (!g) continue;
        for (const t of g) out.add(t);
    }
    return [...out];
}

export type ElementFootprintInput = {
    kind: string;
    side?: string;
    position: { x: number; y: number };
    customName?: string;
    parentStockId?: string | null;
};

function footMmToSoleUv(
    xMm: number,
    yMm: number,
    lengthMm: number,
    widthMm: number,
): { u: number; v: number } {
    // Element positions use length centered at midfoot (x=0); sole UV heel u=0 at x=0 footprint.
    const xFoot = xMm + lengthMm / 2;
    const u = xFoot / lengthMm;
    const v = widthMm > 0 ? yMm / (widthMm / 2) : 0;
    return { u, v };
}

function pointInUvPolygon(u: number, v: number, boundary: SoleUvPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
        const pi = boundary[i]!;
        const pj = boundary[j]!;
        const intersect =
            pi.v > v !== pj.v > v && u < ((pj.u - pi.u) * (v - pi.v)) / (pj.v - pi.v + 1e-12) + pi.u;
        if (intersect) inside = !inside;
    }
    return inside;
}

export function lesionTagsForZoneFromElements(
    zone: MaterialZoneV1,
    elements: ElementFootprintInput[],
    lengthMm: number,
    widthMm: number,
): LesionTag[] {
    const tags: LesionTag[] = [];
    for (const el of elements) {
        const { u, v } = footMmToSoleUv(el.position.x, el.position.y, lengthMm, widthMm);
        if (!pointInUvPolygon(u, v, zone.boundarySoleUv)) continue;
        if (el.kind === "custom") {
            tags.push(...lesionTagsForCustomElementMeta(el.parentStockId, el.customName));
        } else {
            tags.push(...lesionTagsForElementKind(el.kind));
        }
    }
    return mergeLesionTags(tags);
}

export function applyAutoLesionTagsToRecipe(
    recipe: PrintRecipeV1,
    elements: ElementFootprintInput[],
    lengthMm: number,
    widthMm: number,
): PrintRecipeV1 {
    if (!recipe.zones.length) return recipe;
    const zones = recipe.zones.map((zone) => {
        const tags = mergeLesionTags(
            lesionTagsForZoneHardness(zone.hardnessName),
            lesionTagsForZoneFromElements(zone, elements, lengthMm, widthMm),
        );
        return { ...zone, lesionTags: tags.length ? tags : undefined };
    });
    return { ...recipe, zones };
}
