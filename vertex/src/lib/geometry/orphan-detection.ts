// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";
import { getCustomElementBounds } from "@/lib/geometry/custom-element-bounds";
import type { PlacedElement, Side } from "@/types";
import type { TrimlineCurve } from "./trimline";

/**
 * Orphan detection (Phase 3A production editing).
 *
 * After a trimline change or element transform, certain features may no longer
 * contribute to the manufactured part:
 *  - Elements whose (transformed) bounds lie completely outside the current
 *    trimline polygon.
 *  - Corrections (posting, skive, heel cup) whose primary anatomical region
 *    has been excised by an aggressive trim.
 *
 * These are surfaced as advisories ("Design Issues") so the clinician can
 * clean up before export. Detection is conservative (only "fully outside").
 * We never auto-delete; the user (or a future "strip orphans on confirm" toggle)
 * decides.
 */

export type OrphanKind =
    | "element-outside-trimline"
    | "rearfoot-correction-orphaned"
    | "forefoot-correction-orphaned"
    | "base-feature-orphaned"; // when a confirmed trimline has moved far inside the original base outline

export interface Orphan {
    kind: OrphanKind;
    side: Side;
    /** Stable id for the offending object (element id, or a pseudo-id for correction classes). */
    id: string;
    label: string;
    /** Suggested quick action for the UI. */
    suggestion?: string;
}

const REAR_U_MAX = 0.32; // rearfoot region for posting/skive relevance
const FORE_U_MIN = 0.58; // forefoot region

/** Even-odd test (duplicated from trimline.ts to keep this module self-contained for tests). */
function pointInPolygonXY(x: number, y: number, poly: THREE.Vector3[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i]!.x;
        const yi = poly[i]!.y;
        const xj = poly[j]!.x;
        const yj = poly[j]!.y;
        const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersects) inside = !inside;
    }
    return inside;
}

/** Returns true if the axis-aligned box (in footprint XY) is entirely outside the poly. */
function aabbCompletelyOutside(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    poly: THREE.Vector3[],
): boolean {
    // Test all four corners; if none inside, and no edge crossing (conservative), treat as outside.
    const corners = [
        [minX, minY],
        [maxX, minY],
        [minX, maxY],
        [maxX, maxY],
    ] as const;
    const anyInside = corners.some(([x, y]) => pointInPolygonXY(x, y, poly));
    if (anyInside) return false;

    // Additional: centroid test.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    if (pointInPolygonXY(cx, cy, poly)) return false;

    return true;
}

/** Build a world-space AABB for a placed element using its registered bounds + transform. */
function getElementFootprintAABB(el: PlacedElement): { minX: number; maxX: number; minY: number; maxY: number } | null {
    const b = getCustomElementBounds(el.customElementId);
    if (!b) return null;
    // Element "position" is center in footprint (x=length, y=width). Scale/rotation around that center.
    const cx = el.position.x;
    const cy = el.position.y;
    const sx = (b.sizeX * (el.scale?.x ?? 1)) / 2;
    const sy = (b.sizeY * (el.scale?.y ?? 1)) / 2;
    const rot = ((el.rotationDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    // Four corners in local element space, rotated + translated.
    const pts = [
        [-sx, -sy],
        [sx, -sy],
        [sx, sy],
        [-sx, sy],
    ].map(([lx, ly]) => {
        const rx = lx * cos - ly * sin;
        const ry = lx * sin + ly * cos;
        return [cx + rx, cy + ry];
    });

    let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
    for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return { minX, maxX, minY, maxY };
}

/**
 * Detect orphans for one side given the current effective trimline curve
 * (draft or committed) and the placed elements for that side.
 */
export function detectOrphansForSide(
    side: Side,
    trimline: TrimlineCurve | null,
    elementsOnSide: PlacedElement[],
    /** Optional: the original base outline for the same side (to detect large base-feature loss). */
    baseOutline?: TrimlineCurve | null,
): Orphan[] {
    const out: Orphan[] = [];
    if (!trimline || trimline.points.length < 4) return out;

    const poly = trimline.points;

    // 1. Element orphans
    for (const el of elementsOnSide) {
        const aabb = getElementFootprintAABB(el);
        if (!aabb) continue;
        if (aabbCompletelyOutside(aabb.minX, aabb.maxX, aabb.minY, aabb.maxY, poly)) {
            const name = el.customName ?? el.kind;
            out.push({
                kind: "element-outside-trimline",
                side,
                id: el.id,
                label: `${name} (completely outside trimline)`,
                suggestion: "Remove or move element inside the current footprint",
            });
        }
    }

    // 2. Region correction orphans (heuristic on u-extent of the trimline)
    // Compute the u-span that the trimline actually covers.
    let minU = 1,
        maxU = 0;
    const len = 260; // nominal; the test is relative so constant is fine
    for (const p of poly) {
        const u = Math.max(0, Math.min(1, p.x / len));
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
    }
    // If the trimline has effectively removed the rearfoot band, flag rear corrections.
    if (maxU < REAR_U_MAX + 0.05) {
        out.push({
            kind: "rearfoot-correction-orphaned",
            side,
            id: `${side}:rear`,
            label: "Rearfoot posting / skive / heel cup have no effect (trimline excludes rearfoot)",
            suggestion: "Increase trimline coverage or zero the rear corrections",
        });
    }
    if (minU > FORE_U_MIN - 0.05) {
        out.push({
            kind: "forefoot-correction-orphaned",
            side,
            id: `${side}:fore`,
            label: "Forefoot posting / elements may have reduced effect (trimline starts late)",
            suggestion: "Extend trimline or review forefoot corrections",
        });
    }

    // 3. Base feature orphaned (large inward deviation from original base silhouette)
    if (baseOutline && baseOutline.points.length >= 4) {
        // Sample a few points on the base outline and see how many fall outside current trimline.
        let lost = 0;
        for (const p of baseOutline.points) {
            if (!pointInPolygonXY(p.x, p.y, poly)) lost++;
        }
        const lostRatio = lost / baseOutline.points.length;
        if (lostRatio > 0.25) {
            out.push({
                kind: "base-feature-orphaned",
                side,
                id: `${side}:base-silhouette`,
                label: `Trimline has removed >${Math.round(lostRatio * 100)}% of the original base outline`,
                suggestion: "Review whether the base template still matches the intended footprint",
            });
        }
    }

    return out;
}

/** Aggregate across both sides. */
export function detectAllOrphans(
    designElements: PlacedElement[],
    trimlines: Partial<Record<Side, TrimlineCurve>>,
    baseOutlines?: Partial<Record<Side, TrimlineCurve>>,
): Orphan[] {
    const all: Orphan[] = [];
    for (const side of ["left", "right"] as Side[]) {
        const t = trimlines[side] ?? null;
        const els = designElements.filter((e) => e.side === side);
        const baseO = baseOutlines?.[side] ?? null;
        all.push(...detectOrphansForSide(side, t, els, baseO));
    }
    return all;
}
