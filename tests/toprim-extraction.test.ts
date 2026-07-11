// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Pins the pre-existing topRim collapse that #107 made loud (warn → throw).
 *
 * Root cause chain:
 *   1. heelCupWidthMm > 0 in applyBaseModifiers (base-modifier.ts) tears the
 *      top shell into ~3784 tiny boundary loops (all length 4).
 *   2. extractOrderedBoundaryLoopWithIndices (mesh-close.ts) picks the longest
 *      perimeter loop → topRim = 4 instead of ~446.
 *   3. closeGlbInsoleToSolid then bridges a 4-vert rim → openEdges ≈ 11792.
 *
 * Custom trimline triangle-drop (preserving multi-mesh ranges) does NOT
 * collapse topRim to 4 — rim stays hundreds of verts — so the 4-vert failure
 * is width-modifier systemic, not trimline-customization systemic.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import { type BufferGeometry, Vector3 } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    closeGlbInsoleToSolid,
    extractBoundaryLoops,
    extractOrderedBoundaryLoopWithIndices,
    submeshByVertexRange,
} from "@/lib/geometry/mesh-close";
import { extractMeshOutline, type TrimlineCurve } from "@/lib/geometry/trimline";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/Default.glb");

function neutralCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function correctionField(side: Side, patch: Partial<SideCorrections> = {}): HeightFieldParams {
    return {
        side,
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections: { ...neutralCorrections(), ...patch },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

function measureTopRim(geometry: BufferGeometry): { topRimVerts: number; topLoopCount: number } {
    const topVertexCount = (geometry.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const topSub = submeshByVertexRange(geometry, 0, topVertexCount);
    try {
        const loops = extractBoundaryLoops(topSub);
        const ordered = extractOrderedBoundaryLoopWithIndices(topSub);
        return { topRimVerts: ordered.positions.length, topLoopCount: loops.length };
    } finally {
        topSub.dispose();
    }
}

function shrinkTrimline(curve: TrimlineCurve, factor: number): TrimlineCurve {
    let cx = 0;
    let cy = 0;
    for (const p of curve.points) {
        cx += p.x;
        cy += p.y;
    }
    cx /= curve.points.length;
    cy /= curve.points.length;
    return {
        points: curve.points.map((p) => new Vector3(cx + (p.x - cx) * factor, cy + (p.y - cy) * factor, p.z)),
    };
}

/** Triangle-drop clip that keeps indexed multi-mesh ranges + userData. */
function clipMultiMeshPreservingRanges(
    geometry: BufferGeometry,
    curve: TrimlineCurve,
    marginMm = 1.5,
): BufferGeometry {
    const pos = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!pos || !index || curve.points.length < 4) return geometry.clone();

    let cx = 0;
    let cy = 0;
    for (const p of curve.points) {
        cx += p.x;
        cy += p.y;
    }
    cx /= curve.points.length;
    cy /= curve.points.length;
    const poly = curve.points.map((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const k = (len + marginMm) / len;
        return new Vector3(cx + dx * k, cy + dy * k, 0);
    });

    const pointInPoly = (x: number, y: number): boolean => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i]!.x;
            const yi = poly[i]!.y;
            const xj = poly[j]!.x;
            const yj = poly[j]!.y;
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-30) + xi) {
                inside = !inside;
            }
        }
        return inside;
    };

    const kept: number[] = [];
    for (let t = 0; t < index.count; t += 3) {
        const a = index.getX(t);
        const b = index.getX(t + 1);
        const c = index.getX(t + 2);
        const mx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
        const my = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
        if (pointInPoly(mx, my)) kept.push(a, b, c);
    }

    const out = geometry.clone();
    out.setIndex(kept);
    if (geometry.userData) out.userData = { ...geometry.userData };
    return out;
}

describe("topRim extraction (pre-existing width tear)", () => {
    let baseGeo: BufferGeometry;
    let autoOutline: TrimlineCurve;

    beforeAll(async () => {
        expect(existsSync(FIXTURE_PATH)).toBe(true);
        const buf = readFileSync(FIXTURE_PATH).buffer.slice(0);
        const group = await loadGlbFromBuffer(buf);
        const merged = extractMergedGeometry(group);
        expect(merged).not.toBeNull();
        baseGeo = merged!.geometry;
        const outline = extractMeshOutline(baseGeo, 36);
        expect(outline).not.toBeNull();
        autoOutline = outline!;
    });

    test("healthy baseline: topRim ≈ 446, single loop", () => {
        const mod = applyBaseModifiers(baseGeo, correctionField("left"), 0);
        try {
            const rim = measureTopRim(mod);
            expect(rim.topLoopCount).toBe(1);
            expect(rim.topRimVerts).toBeGreaterThan(400);
            expect(rim.topRimVerts).toBeLessThan(500);
        } finally {
            mod.dispose();
        }
    });

    test("heelCupWidthMm=5 alone collapses topRim to 4 (~3784 tiny loops)", () => {
        const mod = applyBaseModifiers(baseGeo, correctionField("left", { heelCupWidthMm: 5 }), 0);
        try {
            const rim = measureTopRim(mod);
            expect(rim.topRimVerts).toBe(4);
            expect(rim.topLoopCount).toBeGreaterThan(3000);
            expect(() => closeGlbInsoleToSolid(mod)).toThrow(/openEdges=11792|not edge-manifold/);
        } finally {
            mod.dispose();
        }
    });

    test("custom trim shrink 0.80 does NOT collapse topRim to 4", () => {
        const clipped = clipMultiMeshPreservingRanges(baseGeo, shrinkTrimline(autoOutline, 0.8));
        try {
            const rim = measureTopRim(clipped);
            expect(rim.topLoopCount).toBe(1);
            expect(rim.topRimVerts).toBeGreaterThan(200);
            // Still may fail manifold for other reasons — that is separate from topRim:4.
        } finally {
            clipped.dispose();
        }
    });

    test("custom trim medial pinch does NOT collapse topRim to 4", () => {
        let cy = 0;
        for (const p of autoOutline.points) cy += p.y;
        cy /= autoOutline.points.length;
        const pinched: TrimlineCurve = {
            points: autoOutline.points.map((p) => {
                const toward = p.y > cy ? -1 : 1;
                return new Vector3(p.x, p.y + toward * 4, p.z);
            }),
        };
        const clipped = clipMultiMeshPreservingRanges(baseGeo, pinched);
        try {
            const rim = measureTopRim(clipped);
            expect(rim.topLoopCount).toBe(1);
            expect(rim.topRimVerts).toBeGreaterThan(200);
        } finally {
            clipped.dispose();
        }
    });
});
