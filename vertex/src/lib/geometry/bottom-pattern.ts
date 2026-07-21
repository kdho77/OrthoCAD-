// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";
import {
    lockZoneURange,
    SULCUS_OFFSET_MM,
} from "@/lib/geometry/heel-lift";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import {
    cloneTrimline,
    deserializeTrimlineCurve,
    extractMeshOutline,
    serializeTrimlineCurve,
} from "@/lib/geometry/trimline";
import type {
    BottomPattern,
    BottomPatternTransform,
    BuildLength,
    DesignBottomPatterns,
    DesignState,
    Side,
    TrimlinePoint,
} from "@/types";

export const DEFAULT_BOTTOM_PATTERN_DEPTH_MM = 6;
/** Legacy seed scale when no Bottom mesh is available (single-mesh / parametric). */
export const BOTTOM_PATTERN_FALLBACK_SCALE = 0.65;

export function defaultBottomPatternTransform(): BottomPatternTransform {
    return { x: 0, y: 0, rotationDeg: 0 };
}

/** Deep-clone a bottom pattern (outline points + transform). */
export function cloneBottomPattern(pattern: BottomPattern): BottomPattern {
    return {
        outline: pattern.outline.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        depthMm: pattern.depthMm,
        transform: { ...pattern.transform },
    };
}

/** Build a bottom pattern from a closed outline curve (local space, identity transform). */
export function createBottomPatternFromOutline(
    outline: TrimlineCurve,
    depthMm = DEFAULT_BOTTOM_PATTERN_DEPTH_MM,
    transform: BottomPatternTransform = defaultBottomPatternTransform(),
): BottomPattern {
    return {
        outline: serializeTrimlineCurve(outline),
        depthMm,
        transform: { ...transform },
    };
}

/** Outline as a TrimlineCurve (local pattern space, pre-transform). */
export function bottomPatternOutlineCurve(pattern: BottomPattern): TrimlineCurve {
    return deserializeTrimlineCurve(pattern.outline);
}

/**
 * Apply in-plane transform to outline points for display / world footprint placement.
 * Rotation is about local origin (0,0), then translation. Z is forced to 0 (flat).
 */
export function transformedBottomPatternPoints(pattern: BottomPattern): THREE.Vector3[] {
    const rad = (pattern.transform.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const { x: tx, y: ty } = pattern.transform;
    return pattern.outline.map((p) => {
        const rx = p.x * cos - p.y * sin;
        const ry = p.x * sin + p.y * cos;
        return new THREE.Vector3(rx + tx, ry + ty, 0);
    });
}

export function transformedBottomPatternCurve(pattern: BottomPattern): TrimlineCurve {
    return { points: transformedBottomPatternPoints(pattern) };
}

/** Translate the whole pattern (updates transform, not outline points). */
export function translateBottomPattern(pattern: BottomPattern, dx: number, dy: number): BottomPattern {
    return {
        ...cloneBottomPattern(pattern),
        transform: {
            ...pattern.transform,
            x: pattern.transform.x + dx,
            y: pattern.transform.y + dy,
        },
    };
}

/** Rotate the whole pattern in-plane (degrees, additive). */
export function rotateBottomPattern(pattern: BottomPattern, deltaDeg: number): BottomPattern {
    return {
        ...cloneBottomPattern(pattern),
        transform: {
            ...pattern.transform,
            rotationDeg: pattern.transform.rotationDeg + deltaDeg,
        },
    };
}

/** Replace local outline points (reshape); transform unchanged. */
export function setBottomPatternOutline(pattern: BottomPattern, outline: TrimlineCurve): BottomPattern {
    return {
        ...cloneBottomPattern(pattern),
        outline: serializeTrimlineCurve(outline),
    };
}

export function setBottomPatternDepth(pattern: BottomPattern, depthMm: number): BottomPattern {
    const safe = Number.isFinite(depthMm) ? Math.max(0, depthMm) : pattern.depthMm;
    return { ...cloneBottomPattern(pattern), depthMm: safe };
}

/** Soft validation — never throws; returns issues for UI/debug. Does not block oversized/offset patterns. */
export function validateBottomPattern(pattern: BottomPattern | null | undefined): string[] {
    const issues: string[] = [];
    if (!pattern) return issues;
    if (!pattern.outline || pattern.outline.length < 4) {
        issues.push("outline requires at least 4 points");
    }
    if (!Number.isFinite(pattern.depthMm) || pattern.depthMm < 0) {
        issues.push("depthMm must be a non-negative finite number");
    }
    const t = pattern.transform;
    if (!t || ![t.x, t.y, t.rotationDeg].every(Number.isFinite)) {
        issues.push("transform x/y/rotationDeg must be finite");
    }
    return issues;
}

/** Read a side's committed bottom pattern from design state, if any. */
export function getDesignBottomPattern(design: DesignState, side: Side): BottomPattern | null {
    const raw = design.bottomPatterns?.[side];
    if (!raw || !raw.outline || raw.outline.length < 4) return null;
    // Normalize legacy/partial payloads without corrupting missing fields.
    return {
        outline: raw.outline.map((p: TrimlinePoint) => ({ x: p.x, y: p.y, z: p.z ?? 0 })),
        depthMm: Number.isFinite(raw.depthMm) ? raw.depthMm : DEFAULT_BOTTOM_PATTERN_DEPTH_MM,
        transform: {
            x: Number.isFinite(raw.transform?.x) ? raw.transform.x : 0,
            y: Number.isFinite(raw.transform?.y) ? raw.transform.y : 0,
            rotationDeg: Number.isFinite(raw.transform?.rotationDeg) ? raw.transform.rotationDeg : 0,
        },
    };
}

/** Merge serialized bottom patterns into a design patch. */
export function bottomPatternsToDesignPatch(
    patterns: Partial<Record<Side, BottomPattern | null>>,
): DesignBottomPatterns {
    const out: DesignBottomPatterns = {};
    for (const side of ["left", "right"] as Side[]) {
        const p = patterns[side];
        if (p && p.outline.length >= 4) out[side] = cloneBottomPattern(p);
    }
    return out;
}

/** Scale a source outline about its centroid (legacy single-mesh bottom-pattern seed). */
export function scaleOutlineAboutCentroid(curve: TrimlineCurve, scale: number): TrimlineCurve {
    const pts = curve.points;
    if (pts.length === 0) return cloneTrimline(curve);
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
        cx += p.x;
        cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    return {
        points: pts.map(
            (p) => new THREE.Vector3(cx + (p.x - cx) * scale, cy + (p.y - cy) * scale, 0),
        ),
    };
}

/**
 * XY silhouette of the multi-mesh base's Bottom vertex range (projected, Z ignored
 * for the perimeter; output points forced flat at z=0 for bottomPattern editing).
 * Returns null when the geometry is not a multi-mesh base or the Bottom range is
 * degenerate — callers should fall back to scaled-top seeding.
 */
export function extractBottomMeshOutline(
    geometry: THREE.BufferGeometry,
    stations = 32,
): TrimlineCurve | null {
    const ud = geometry.userData as { isMultiMeshBase?: boolean; topVertexCount?: number };
    const pos = geometry.getAttribute("position");
    if (!pos || !ud.isMultiMeshBase || typeof ud.topVertexCount !== "number") return null;
    const topN = ud.topVertexCount;
    if (topN <= 0 || topN >= pos.count) return null;

    const outline = extractMeshOutline(geometry, stations, {
        vertexStart: topN,
        vertexEnd: pos.count,
    });
    if (!outline || outline.points.length < 4) return null;

    // Flat manufacturing pattern — discard residual Bottom Z (mold relief / noise).
    return {
        points: outline.points.map((p) => new THREE.Vector3(p.x, p.y, 0)),
    };
}

/**
 * Seed outline for a NEW bottomPattern: prefer real Bottom-mesh footprint when
 * present; otherwise legacy 0.65× scaled top/base outline. Does not mutate
 * existing committed bottomPatterns.
 */
export function seedBottomPatternOutline(
    baseGeometry: THREE.BufferGeometry | null | undefined,
    topFallback: TrimlineCurve,
): TrimlineCurve {
    if (baseGeometry) {
        const fromBottom = extractBottomMeshOutline(baseGeometry);
        if (fromBottom) return fromBottom;
    }
    return scaleOutlineAboutCentroid(topFallback, BOTTOM_PATTERN_FALLBACK_SCALE);
}

/** Bounding box of an outline's XY footprint (for tests / diagnostics). */
export function outlineBoundsXY(curve: TrimlineCurve): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    area: number;
} {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of curve.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const w = Math.max(0, maxX - minX);
    const h = Math.max(0, maxY - minY);
    return { minX, maxX, minY, maxY, area: w * h };
}

/** Resolve design buildLength; legacy designs without the field ⇒ "full". */
export function resolveDesignBuildLength(design: DesignState): BuildLength {
    return design.buildLength ?? "full";
}

/** Footprint length-axis frame from a reference outline (longer XY extent = length). */
export function footprintLengthFrame(points: THREE.Vector3[]): {
    lengthIsX: boolean;
    lenMin: number;
    lenSize: number;
    widCenter: number;
} {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const lengthIsX = extentX >= extentY;
    const lenMin = lengthIsX ? minX : minY;
    const lenSize = Math.max(1e-6, lengthIsX ? extentX : extentY);
    const widCenter = lengthIsX ? (minY + maxY) / 2 : (minX + maxX) / 2;
    return { lengthIsX, lenMin, lenSize, widCenter };
}

/** Normalized u along length (heel≈0 → toe≈1) for a footprint point. */
export function pointNormalizedU(
    p: THREE.Vector3,
    frame: { lengthIsX: boolean; lenMin: number; lenSize: number },
): number {
    const len = frame.lengthIsX ? p.x : p.y;
    return Math.max(0, Math.min(1, (len - frame.lenMin) / frame.lenSize));
}

/** True when u is inside the active lock zone [archEnd, anterior]. */
export function isUInLockZone(u: number, archEnd: number, anterior: number, active: boolean): boolean {
    if (!active) return false;
    return u >= archEnd - 1e-9 && u <= anterior + 1e-9;
}

/**
 * Indices of bottom outline points that fall in the distal lock zone.
 * Uses the top outline's length frame so u matches clinical heel→toe.
 * `sulcusOffsetMm` only affects the sulcus build-length class (default 15).
 */
export function lockedBottomOutlineIndices(
    bottomLocalPoints: THREE.Vector3[],
    topOutline: TrimlineCurve,
    buildLength: BuildLength,
    insoleLengthMm: number,
    sulcusOffsetMm: number = SULCUS_OFFSET_MM,
): Set<number> {
    const zone = lockZoneURange(buildLength, insoleLengthMm, sulcusOffsetMm);
    const locked = new Set<number>();
    if (!zone.active || topOutline.points.length < 4 || bottomLocalPoints.length === 0) return locked;
    const frame = footprintLengthFrame(topOutline.points);
    for (let i = 0; i < bottomLocalPoints.length; i++) {
        const u = pointNormalizedU(bottomLocalPoints[i]!, frame);
        if (isUInLockZone(u, zone.archEnd, zone.anterior, zone.active)) locked.add(i);
    }
    return locked;
}

/**
 * Snap locked bottom outline points to the matching top outline (same u + width side).
 * Unlocked points unchanged. Returns a new point array.
 */
export function applyTopOutlineLockZone(
    bottomLocalPoints: THREE.Vector3[],
    topOutline: TrimlineCurve,
    lockedIndices: ReadonlySet<number>,
): THREE.Vector3[] {
    if (lockedIndices.size === 0 || topOutline.points.length < 4) {
        return bottomLocalPoints.map((p) => p.clone());
    }
    const frame = footprintLengthFrame(topOutline.points);
    const top = topOutline.points;

    const matchTop = (p: THREE.Vector3): THREE.Vector3 => {
        const u = pointNormalizedU(p, frame);
        const wid = frame.lengthIsX ? p.y : p.x;
        const side = Math.sign(wid - frame.widCenter) || 1;
        let best = top[0]!;
        let bestScore = Infinity;
        for (const t of top) {
            const tu = pointNormalizedU(t, frame);
            const tw = frame.lengthIsX ? t.y : t.x;
            const tSide = Math.sign(tw - frame.widCenter) || 1;
            const sidePenalty = tSide === side ? 0 : 1000;
            const score = Math.abs(tu - u) * 100 + Math.abs(tw - wid) * 0.01 + sidePenalty;
            if (score < bestScore) {
                bestScore = score;
                best = t;
            }
        }
        return new THREE.Vector3(best.x, best.y, 0);
    };

    return bottomLocalPoints.map((p, i) => (lockedIndices.has(i) ? matchTop(p) : p.clone()));
}
