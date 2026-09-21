// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    HARDNESS_TO_INFILL_PCT,
    type HardnessName,
    type MaterialZoneV1,
    type PrintRecipeV1,
    type SoleUvFrame,
    type SoleUvPoint,
    ZONE_MIN_AREA_MM2,
    ZONE_MIN_CORRIDOR_MM,
} from "./print-recipe";

export type ZoneValidationIssue = { code: string; message: string };

/**
 * Client-side zone checks mirror Python manufacture gates in spirit (area, erode-2w core, polygon distance).
 * Hybrid `/manufacture` re-validates with Shapely and is the source of truth if results differ.
 */
export const ZONE_VALIDATION_CLIENT_ADVISORY_NOTE =
    "These checks help you catch issues early. Final acceptance runs on the manufacturing server when you generate production G-code.";

/** Overlap resolution (matches Python `resolve_infill_fraction_at_uv`). */
export const HARDNESS_OVERLAP_RULES_COPY =
    "Where zones overlap: untagged regions use the harder (higher %) gyroid target. Soft-wins (softer %) apply only when an overlapping zone carries an accommodative or high-risk lesion tag, unless you enable override soft-wins.";

function uvToMm(p: SoleUvPoint, frame: SoleUvFrame): [number, number] {
    const x = frame.minXMm + p.u * frame.lengthMm;
    const centerY = frame.minYMm + frame.widthMm * 0.5;
    const y = centerY + p.v * (frame.widthMm * 0.5);
    return [x, y];
}

function polygonAreaMm2(pts: [number, number][]): number {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i]!;
        const [x1, y1] = pts[(i + 1) % pts.length]!;
        a += x0 * y1 - x1 * y0;
    }
    return Math.abs(a) * 0.5;
}

function pointSegmentDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function minDistanceBetweenPolygons(a: [number, number][], b: [number, number][]): number {
    let minD = Number.POSITIVE_INFINITY;
    const polyEdges = (poly: [number, number][]) => {
        const edges: [number, number, number, number][] = [];
        for (let i = 0; i < poly.length; i++) {
            const [x1, y1] = poly[i]!;
            const [x2, y2] = poly[(i + 1) % poly.length]!;
            edges.push([x1, y1, x2, y2]);
        }
        return edges;
    };
    for (const [x1, y1, x2, y2] of polyEdges(a)) {
        for (const [px, py] of b) {
            minD = Math.min(minD, pointSegmentDistance(px, py, x1, y1, x2, y2));
        }
    }
    for (const [x1, y1, x2, y2] of polyEdges(b)) {
        for (const [px, py] of a) {
            minD = Math.min(minD, pointSegmentDistance(px, py, x1, y1, x2, y2));
        }
    }
    return minD;
}

/** Centroid inset approximating Python `buffer(-2w)` core (manufacture uses exact Shapely). */
function erodePolygonCentroidMm(pts: [number, number][], insetMm: number): [number, number][] | null {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const out: [number, number][] = [];
    for (const [x, y] of pts) {
        const dx = x - cx;
        const dy = y - cy;
        const len = Math.hypot(dx, dy);
        if (len < insetMm + 1e-6) return null;
        const f = (len - insetMm) / len;
        out.push([cx + dx * f, cy + dy * f]);
    }
    return polygonAreaMm2(out) >= 1 ? out : null;
}

/** Lightweight validation for UI (manufacture Shapely gates are authoritative). */
export function validateMaterialZones(
    recipe: PrintRecipeV1,
    frame: SoleUvFrame,
    extrusionWidthMm = 0.48,
): ZoneValidationIssue[] {
    const issues: ZoneValidationIssue[] = [];
    if (!recipe.zones.length) return issues;

    const minCorridor = 4 * extrusionWidthMm;
    const coreInset = 2 * extrusionWidthMm;

    const polys = recipe.zones.map((z) => {
        const mm = z.boundarySoleUv.map((p) => uvToMm(p, frame));
        const area = polygonAreaMm2(mm);
        if (area < ZONE_MIN_AREA_MM2) {
            issues.push({
                code: "area",
                message: `${z.anatomicLabel}: this region is too small to manufacture safely. Enlarge it or use fewer zones.`,
            });
        }
        if (!erodePolygonCentroidMm(mm, coreInset)) {
            issues.push({
                code: "narrow",
                message: `${z.anatomicLabel}: this region is too narrow through the middle. Widen it or merge with a neighbor.`,
            });
        }
        return { zone: z, mm };
    });

    for (let i = 0; i < polys.length; i++) {
        for (let j = i + 1; j < polys.length; j++) {
            const dist = minDistanceBetweenPolygons(polys[i]!.mm, polys[j]!.mm);
            if (dist < minCorridor - 1e-3) {
                issues.push({
                    code: "corridor",
                    message: `${polys[i]!.zone.anatomicLabel} and ${polys[j]!.zone.anatomicLabel} are too close together. Leave more space between them or merge into one zone.`,
                });
            }
        }
    }

    return issues;
}

export function qcSummaryForRecipe(recipe: PrintRecipeV1): Array<{
    anatomicLabel: string;
    hardnessName: HardnessName;
    gyroidPct: number;
    profileId: string | undefined;
}> {
    const profileId = recipe.profileId;
    if (!recipe.zones.length) {
        return [
            {
                anatomicLabel: "Whole device",
                hardnessName: recipe.defaultHardness,
                gyroidPct: HARDNESS_TO_INFILL_PCT[recipe.defaultHardness],
                profileId,
            },
        ];
    }
    const rows = recipe.zones.map((z) => ({
        anatomicLabel: z.anatomicLabel,
        hardnessName: z.hardnessName,
        gyroidPct: HARDNESS_TO_INFILL_PCT[z.hardnessName],
        profileId,
    }));
    rows.push({
        anatomicLabel: "Remainder of device",
        hardnessName: recipe.defaultHardness,
        gyroidPct: HARDNESS_TO_INFILL_PCT[recipe.defaultHardness],
        profileId,
    });
    return rows;
}

export function samplePointInZoneCore(
    zone: MaterialZoneV1,
    frame: SoleUvFrame,
    extrusionWidthMm = 0.48,
): [number, number] | null {
    const mm = zone.boundarySoleUv.map((p) => uvToMm(p, frame));
    const cx = mm.reduce((s, p) => s + p[0], 0) / mm.length;
    const cy = mm.reduce((s, p) => s + p[1], 0) / mm.length;
    const core = erodePolygonCentroidMm(mm, 2 * extrusionWidthMm);
    if (!core) return null;
    let inside = false;
    for (let i = 0, j = core.length - 1; i < core.length; j = i++) {
        const [xi, yi] = core[i]!;
        const [xj, yj] = core[j]!;
        const intersect = yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi + 1e-12) + xi;
        if (intersect) inside = !inside;
    }
    return inside ? [cx, cy] : null;
}
