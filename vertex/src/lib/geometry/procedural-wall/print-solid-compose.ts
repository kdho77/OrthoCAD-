// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { BufferAttribute, BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    getBaseFootprintFrame,
} from "@/lib/geometry/base-modifier";
import {
    applyElementsToTopMeshLast,
    fieldWithoutElementsForModifiers,
} from "@/lib/geometry/element-assets/apply-elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    DEFAULT_SHELL_THICKNESS_BLEND_MM,
    DEFAULT_SHELL_THICKNESS_FF_MM,
    DEFAULT_SHELL_THICKNESS_MF_MM,
    DEFAULT_SHELL_THICKNESS_RF_MM,
} from "@/lib/geometry/shell-thickness-zonal";
import {
    applyShoeWidthToGeometry,
    type ShoeWidthId,
    shoeWidthAffineActive,
    shoeWidthReferenceOfGeometry,
} from "@/lib/geometry/shoe-width";
import {
    applySinkCutToGeometry,
    applySinkThicknessToGeometry,
    effectiveInsoleThicknessMm,
    sinksActive,
} from "@/lib/geometry/sink";
import {
    ANTERIOR_EDGE_TAPER_MM,
    ANTERIOR_EDGE_TIP_MM,
    anteriorCutSegments,
} from "@/lib/geometry/trim-presets";
import { clipGeometryToOutline, type TrimlineCurve } from "@/lib/geometry/trimline";

/**
 * Viewer shoe-width affine forwarded onto the Print top sheet.
 * Same s(u) as {@link applyShoeWidthToPoints} / the Base pattern.
 */
export interface PrintSolidShoeWidth {
    width: ShoeWidthId;
    ballWidthMm: number;
    heelWidthMm: number;
    heelOverrideMm?: number;
}

export interface ComposePrintSolidInput {
    /** Full viewer field: elements + rim feather, shapeFinish, Kirby after F. */
    sourceField: HeightFieldParams;
    shoeWidth?: PrintSolidShoeWidth | null;
    /** Clip before rim extraction. Falls back to sourceField.trimline. */
    trimline?: TrimlineCurve | null;
    /**
     * Sulcus and 3/4 only. Lowers the top over the last 10 mm into a thin
     * front edge. Full-length leaves this unset.
     */
    anteriorEdgeTaper?: boolean;
}

/**
 * CAD-approved Print top: one composed mesh, then loft.
 *
 * 1. width affine — this mesh's own Medium chords, full at the forefoot and
 *    tapering to the heel. A mirrored sheet measures the same chords and the
 *    negated vertex-mean Y, so the right foot is the mirror of the left.
 * 2. applyBaseModifiers (wedge/posting/arch — elements stripped from F)
 * 3. applyElementsToTopMeshLast (GLB height-field flow / noFlow + procedural fallback)
 * 4. sink thickness T then cut S, height-only (no-op when the field has no sinks)
 * 5. trimline clip — before rim extraction
 */
export async function composeViewerPrintSolidTop(input: {
    raw: BufferGeometry;
    sourceField: HeightFieldParams;
    shoeWidth?: PrintSolidShoeWidth | null;
    trimline?: TrimlineCurve | null;
    anteriorEdgeTaper?: boolean;
}): Promise<BufferGeometry> {
    return composePrintSolidTop(input.raw, {
        sourceField: input.sourceField,
        shoeWidth: input.shoeWidth,
        trimline: input.trimline,
        anteriorEdgeTaper: input.anteriorEdgeTaper,
    });
}

/**
 * Reference-thickness print solids with no explicit shell mode use the product
 * zonal shell (rear 3 / mid 2.5 / fore 2). An explicit `uniform` mode, or any
 * other thickness, stays on the legacy uniform term.
 */
export function withDefaultPrintShell(field: HeightFieldParams): HeightFieldParams {
    if (field.shellThicknessMode != null) return field;
    if (Math.abs(field.thicknessMm - BASE_REFERENCE_THICKNESS_MM) > 1e-9) return field;
    // An apex slide is compared with the unshelled analytic loft. Leaving this
    // correction on the legacy uniform term keeps that crest within 0.05 mm.
    // A design that sets shellThicknessMode (the product default) is unchanged.
    if (Math.abs(field.corrections?.apexMoveMm ?? 0) > 1e-9) return field;
    return {
        ...field,
        shellThicknessMode: "zonal",
        shellThicknessRfMm: field.shellThicknessRfMm ?? DEFAULT_SHELL_THICKNESS_RF_MM,
        shellThicknessMfMm: field.shellThicknessMfMm ?? DEFAULT_SHELL_THICKNESS_MF_MM,
        shellThicknessFfMm: field.shellThicknessFfMm ?? DEFAULT_SHELL_THICKNESS_FF_MM,
        shellThicknessBlendMm: field.shellThicknessBlendMm ?? DEFAULT_SHELL_THICKNESS_BLEND_MM,
    };
}

function composePrintSolidTopCore(
    raw: BufferGeometry,
    input: ComposePrintSolidInput,
): { geometry: BufferGeometry; referenceBase: BufferGeometry; ownedWidth: boolean } {
    const shelled = withDefaultPrintShell(input.sourceField);
    // Same lift the Setup slider uses. Sinks are stripped before the modifier
    // so the raise is uniform, then the cut is applied to that top.
    const shellMm = effectiveInsoleThicknessMm(shelled.thicknessMm, shelled);
    const sourceField = shellMm === shelled.thicknessMm ? shelled : { ...shelled, thicknessMm: shellMm };
    let current = raw;
    let owned = false;
    const sw = input.shoeWidth;
    if (sw && shoeWidthAffineActive(sw.width, sw.heelOverrideMm)) {
        // Chords and the Y pivot come from this mesh, not from the shoe-size
        // layout width. Forefoot chord then changes by the full width-class
        // delta. The vertex-mean pivot mirrors with the sheet, so a right
        // foot scaled here is the mirror of the left. Heel override still
        // replaces the width-class heel cap.
        const ref = shoeWidthReferenceOfGeometry(raw);
        current = applyShoeWidthToGeometry(raw, sw.width, {
            ballWidthMm: ref.ballWidthMm,
            heelWidthMm: ref.heelWidthMm,
            minX: ref.frame.minX,
            lengthMm: ref.frame.lengthMm,
            heelOverrideMm: sw.heelOverrideMm,
        });
        owned = true;
    }
    const modifierField = fieldWithoutElementsForModifiers(sourceField);
    const modified = applyBaseModifiers(current, modifierField, 0, {
        skipBottomSync: true,
    });
    return { geometry: modified, referenceBase: current, ownedWidth: owned };
}

/**
 * Loft input must stay unsunk. The viewport applies T and S after this sheet
 * exists, as a height-only pass, so the outline and vertex count do not move.
 */
export function fieldWithoutSinks(field: HeightFieldParams): HeightFieldParams {
    if (!field.sinks && field.sinkStyloidThicken == null && !field.sinkMarkers) return field;
    return { ...field, sinks: undefined, sinkStyloidThicken: undefined, sinkMarkers: undefined };
}

/**
 * Centroid clipping drops whole triangles, so a met or sulcus cut becomes a
 * stair of original edges (turns past 130°). Stations on that stair cannot
 * meet the preloft skew cap. Cut straddling triangles on the trim itself,
 * with a short fillet at the two distal corners so adjacent columns stay
 * under the 15° heading cap.
 */
const TRIM_CLIP_MARGIN_MM = 0.25;
const TRIM_CORNER_FILLET_MM = 12;
const TRIM_CORNER_FILLET_STEP_DEG = 7;

interface PlanPoint {
    x: number;
    y: number;
}

function polygonSignedArea(poly: PlanPoint[]): number {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

function pointInPolygon(x: number, y: number, poly: PlanPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i]!.x;
        const yi = poly[i]!.y;
        const xj = poly[j]!.x;
        const yj = poly[j]!.y;
        const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0) + xi;
        if (intersects) inside = !inside;
    }
    return inside;
}

function inflateTrim(points: PlanPoint[], marginMm: number): PlanPoint[] {
    let cx = 0;
    let cy = 0;
    for (const p of points) {
        cx += p.x;
        cy += p.y;
    }
    cx /= points.length;
    cy /= points.length;
    return points.map((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const k = (len + marginMm) / len;
        return { x: cx + dx * k, y: cy + dy * k };
    });
}

function dedupeClosed(poly: PlanPoint[], eps = 1e-4): PlanPoint[] {
    const out: PlanPoint[] = [];
    for (const p of poly) {
        const prev = out[out.length - 1];
        if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < eps) continue;
        out.push(p);
    }
    if (out.length >= 2) {
        const a = out[0]!;
        const b = out[out.length - 1]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < eps) out.pop();
    }
    return out;
}

function rdpOpen(pts: PlanPoint[], eps: number): PlanPoint[] {
    if (pts.length < 3) return pts;
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const ab = Math.hypot(abx, aby) || 1;
    let maxD = 0;
    let idx = -1;
    for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i]!;
        const d = Math.abs((p.x - a.x) * aby - (p.y - a.y) * abx) / ab;
        if (d > maxD) {
            maxD = d;
            idx = i;
        }
    }
    if (maxD <= eps || idx < 0) return [a, b];
    const left = rdpOpen(pts.slice(0, idx + 1), eps);
    const right = rdpOpen(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
}

/**
 * The met/sulcus break is sampled densely, so the corner fillet's tangent
 * clamp collapses its radius below the station inset and the offset pinches
 * shut. Drop samples that sit within `eps` of a longer edge first; the apex
 * of a real corner stays, between edges long enough to keep the radius.
 */
function simplifyAnterior(poly: PlanPoint[], eps: number): PlanPoint[] {
    const n = poly.length;
    if (n < 8) return poly;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const cut = minX + (maxX - minX) * 0.6;
    const distal = (i: number) => poly[i]!.x >= cut;
    // Rotate so the distal run, if it wraps, sits in the middle of the array.
    let start = 0;
    for (let i = 0; i < n; i++)
        if (!distal(i)) {
            start = (i + 1) % n;
            break;
        }
    const ring: PlanPoint[] = [];
    for (let k = 0; k < n; k++) ring.push(poly[(start + k) % n]!);
    const out: PlanPoint[] = [];
    let i = 0;
    const ringDistal = (k: number) => ring[k]!.x >= cut;
    while (i < n) {
        if (!ringDistal(i)) {
            out.push(ring[i]!);
            i++;
            continue;
        }
        let j = i;
        while (j < n && ringDistal(j)) j++;
        const from = Math.max(0, i - 1);
        const to = Math.min(n - 1, j);
        const simplified = rdpOpen(ring.slice(from, to + 1), eps);
        const startK = from < i ? 1 : 0;
        const endK = to > j - 1 && j < n ? simplified.length - 1 : simplified.length;
        for (let k = startK; k < endK; k++) out.push(simplified[k]!);
        i = j;
    }
    const deduped = dedupeClosed(out);
    return deduped.length >= 8 ? deduped : poly;
}

/** Round distal corners so the cut does not turn 80° between two stations. */
function filletDistalTrimCorners(poly: PlanPoint[]): PlanPoint[] {
    poly = simplifyAnterior(poly, 1.5);
    const n = poly.length;
    if (n < 8) return poly;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const span = maxX - minX;
    if (span < 20) return poly;
    const out: PlanPoint[] = [];
    for (let i = 0; i < n; i++) {
        const a = poly[(i - 1 + n) % n]!;
        const b = poly[i]!;
        const c = poly[(i + 1) % n]!;
        const ux = b.x - a.x;
        const uy = b.y - a.y;
        const vx = c.x - b.x;
        const vy = c.y - b.y;
        const ul = Math.hypot(ux, uy);
        const vl = Math.hypot(vx, vy);
        const cross = ux * vy - uy * vx;
        const dot = ux * vx + uy * vy;
        const turn = Math.atan2(Math.abs(cross), dot);
        if (turn < (8 * Math.PI) / 180 || ul < 1e-6 || vl < 1e-6) {
            out.push(b);
            continue;
        }
        const maxT = Math.min(ul, vl) * 0.45;
        let radius = TRIM_CORNER_FILLET_MM;
        let tangent = radius * Math.tan(turn / 2);
        if (tangent > maxT) {
            tangent = maxT;
            radius = tangent / Math.tan(turn / 2);
        }
        if (radius < 0.4 || tangent < 0.15) {
            out.push(b);
            continue;
        }
        const iu = { x: ux / ul, y: uy / ul };
        const iv = { x: vx / vl, y: vy / vl };
        const start = { x: b.x - iu.x * tangent, y: b.y - iu.y * tangent };
        const end = { x: b.x + iv.x * tangent, y: b.y + iv.y * tangent };
        let nx = -iu.y;
        let ny = iu.x;
        const probe = { x: (a.x + b.x) / 2 + nx * 0.5, y: (a.y + b.y) / 2 + ny * 0.5 };
        if (!pointInPolygon(probe.x, probe.y, poly)) {
            nx = -nx;
            ny = -ny;
        }
        const center = { x: start.x + nx * radius, y: start.y + ny * radius };
        const a0 = Math.atan2(start.y - center.y, start.x - center.x);
        const a1 = Math.atan2(end.y - center.y, end.x - center.x);
        let sweep = a1 - a0;
        while (sweep > Math.PI) sweep -= Math.PI * 2;
        while (sweep < -Math.PI) sweep += Math.PI * 2;
        const midAng = a0 + sweep / 2;
        const mid = { x: center.x + Math.cos(midAng) * radius, y: center.y + Math.sin(midAng) * radius };
        if (!pointInPolygon(mid.x, mid.y, poly))
            sweep = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2;
        const steps = Math.max(
            1,
            Math.ceil(Math.abs(sweep) / ((TRIM_CORNER_FILLET_STEP_DEG * Math.PI) / 180)),
        );
        out.push(start);
        for (let s = 1; s < steps; s++) {
            const ang = a0 + sweep * (s / steps);
            out.push({ x: center.x + Math.cos(ang) * radius, y: center.y + Math.sin(ang) * radius });
        }
        out.push(end);
    }
    return dedupeClosed(out);
}

function inflatedTrimPolygon(curve: TrimlineCurve): PlanPoint[] | null {
    if (curve.points.length < 4) return null;
    return inflateTrim(
        curve.points.map((p) => ({ x: p.x, y: p.y })),
        TRIM_CLIP_MARGIN_MM,
    );
}

function triangleBary(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
): [number, number, number] {
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-14) return [1, 0, 0];
    const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
    const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
    return [w0, w1, 1 - w0 - w1];
}

function triangulatePlan(poly: PlanPoint[]): Array<[number, number, number]> {
    const n = poly.length;
    if (n < 3) return [];
    const area = polygonSignedArea(poly);
    if (Math.abs(area) < 1e-8) return [];
    const ccw = area > 0;
    if (n === 3) return [ccw ? [0, 1, 2] : [0, 2, 1]];
    const idx = poly.map((_, i) => i);
    const tris: Array<[number, number, number]> = [];
    const cross = (i0: number, i1: number, i2: number) => {
        const a = poly[i0]!;
        const b = poly[i1]!;
        const c = poly[i2]!;
        return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    };
    const contains = (i0: number, i1: number, i2: number, p: number) => {
        const q = poly[p]!;
        const a = poly[i0]!;
        const b = poly[i1]!;
        const c = poly[i2]!;
        const c0 = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
        const c1 = (c.x - b.x) * (q.y - b.y) - (c.y - b.y) * (q.x - b.x);
        const c2 = (a.x - c.x) * (q.y - c.y) - (a.y - c.y) * (q.x - c.x);
        const neg = c0 < -1e-8 || c1 < -1e-8 || c2 < -1e-8;
        const pos = c0 > 1e-8 || c1 > 1e-8 || c2 > 1e-8;
        return !(neg && pos);
    };
    let guard = 0;
    while (idx.length > 3 && guard < n * n) {
        guard++;
        let clipped = false;
        for (let i = 0; i < idx.length; i++) {
            const i0 = idx[(i - 1 + idx.length) % idx.length]!;
            const i1 = idx[i]!;
            const i2 = idx[(i + 1) % idx.length]!;
            const turn = cross(i0, i1, i2);
            if (ccw ? turn <= 1e-8 : turn >= -1e-8) continue;
            let ear = true;
            for (const p of idx) {
                if (p === i0 || p === i1 || p === i2) continue;
                if (contains(i0, i1, i2, p)) {
                    ear = false;
                    break;
                }
            }
            if (!ear) continue;
            tris.push(ccw ? [i0, i1, i2] : [i0, i2, i1]);
            idx.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped) break;
    }
    if (idx.length === 3) {
        const [i0, i1, i2] = idx as [number, number, number];
        tris.push(ccw ? [i0, i1, i2] : [i0, i2, i1]);
    } else if (idx.length > 3) {
        const i0 = idx[0]!;
        for (let k = 1; k < idx.length - 1; k++) tris.push([i0, idx[k]!, idx[k + 1]!]);
    }
    return tris;
}

/**
 * Boundary-faithful trim. Returns null when every vertex is already inside,
 * so the caller keeps the centroid clip (and an uncut outline stays put).
 */
function clipMeshAlongTrimBoundary(geometry: BufferGeometry, curve: TrimlineCurve): BufferGeometry | null {
    const inflated = inflatedTrimPolygon(curve);
    const pos = geometry.getAttribute("position");
    if (!inflated || inflated.length < 4 || !pos) return null;
    // An outline that already contains the mesh must not be filleted: the
    // uncut manufacturing solid has to stay byte-identical.
    let anyOutside = false;
    for (let i = 0; i < pos.count; i++) {
        if (!pointInPolygon(pos.getX(i), pos.getY(i), inflated)) {
            anyOutside = true;
            break;
        }
    }
    if (!anyOutside) return null;
    const poly = filletDistalTrimCorners(inflated);
    if (poly.length < 4) return null;
    const index = geometry.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    const triIndex = (t: number, c: number): number => (index ? index.getX(t * 3 + c) : t * 3 + c);
    const inside = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) inside[i] = pointInPolygon(pos.getX(i), pos.getY(i), poly) ? 1 : 0;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }

    const attrNames = Object.keys(geometry.attributes).filter(
        (name) => name !== "position" && name !== "normal",
    );
    const positions: number[] = [];
    const attrs = new Map<string, number[]>();
    for (const name of attrNames) attrs.set(name, []);

    const pushVertex = (x: number, y: number, z: number, components: Map<string, number[]>) => {
        positions.push(x, y, z);
        for (const name of attrNames) {
            const dst = attrs.get(name)!;
            const src = components.get(name);
            const itemSize = geometry.getAttribute(name).itemSize;
            if (!src) {
                for (let c = 0; c < itemSize; c++) dst.push(0);
            } else {
                for (let c = 0; c < itemSize; c++) dst.push(src[c] ?? 0);
            }
        }
    };

    const componentsOf = (vert: number): Map<string, number[]> => {
        const out = new Map<string, number[]>();
        for (const name of attrNames) {
            const attribute = geometry.getAttribute(name);
            const row: number[] = [];
            for (let c = 0; c < attribute.itemSize; c++) row.push(attribute.getComponent(vert, c));
            out.set(name, row);
        }
        return out;
    };

    const lerpComponents = (a: Map<string, number[]>, b: Map<string, number[]>, t: number) => {
        const out = new Map<string, number[]>();
        for (const name of attrNames) {
            const av = a.get(name) ?? [];
            const bv = b.get(name) ?? [];
            out.set(
                name,
                av.map((v, i) => v + ((bv[i] ?? v) - v) * t),
            );
        }
        return out;
    };

    const mix3 = (
        a: Map<string, number[]>,
        b: Map<string, number[]>,
        c: Map<string, number[]>,
        w0: number,
        w1: number,
        w2: number,
    ) => {
        const out = new Map<string, number[]>();
        for (const name of attrNames) {
            const av = a.get(name) ?? [];
            const bv = b.get(name) ?? [];
            const cv = c.get(name) ?? [];
            out.set(
                name,
                av.map((v, i) => w0 * v + w1 * (bv[i] ?? 0) + w2 * (cv[i] ?? 0)),
            );
        }
        return out;
    };

    const edgeBoxes = poly.map((a, i) => {
        const b = poly[(i + 1) % poly.length]!;
        return {
            minX: Math.min(a.x, b.x) - 1e-4,
            maxX: Math.max(a.x, b.x) + 1e-4,
            minY: Math.min(a.y, b.y) - 1e-4,
            maxY: Math.max(a.y, b.y) + 1e-4,
        };
    });
    const mightCross = (x0: number, x1: number, y0: number, y1: number) => {
        for (const e of edgeBoxes) {
            if (x1 < e.minX || x0 > e.maxX || y1 < e.minY || y0 > e.maxY) continue;
            return true;
        }
        return false;
    };

    interface Surf {
        x: number;
        y: number;
        z: number;
        comp: Map<string, number[]>;
    }

    const clipHalfPlane = (
        subject: PlanPoint[],
        ax: number,
        ay: number,
        bx: number,
        by: number,
    ): PlanPoint[] => {
        const n = subject.length;
        if (n < 3) return [];
        const inside = (x: number, y: number) => (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= -1e-8;
        const out: PlanPoint[] = [];
        const hit = (p: PlanPoint, q: PlanPoint): PlanPoint => {
            const rx = q.x - p.x;
            const ry = q.y - p.y;
            const sx = bx - ax;
            const sy = by - ay;
            const den = rx * sy - ry * sx;
            if (Math.abs(den) < 1e-14) return { x: p.x, y: p.y };
            const t = ((ax - p.x) * sy - (ay - p.y) * sx) / den;
            const tc = t < 0 ? 0 : t > 1 ? 1 : t;
            return { x: p.x + rx * tc, y: p.y + ry * tc };
        };
        for (let i = 0; i < n; i++) {
            const p = subject[i]!;
            const q = subject[(i + 1) % n]!;
            const pin = inside(p.x, p.y);
            const qin = inside(q.x, q.y);
            if (qin) {
                if (!pin) out.push(hit(p, q));
                out.push(q);
            } else if (pin) {
                out.push(hit(p, q));
            }
        }
        const deduped: PlanPoint[] = [];
        for (const p of out) {
            const prev = deduped[deduped.length - 1];
            if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-6) continue;
            deduped.push(p);
        }
        if (deduped.length >= 2) {
            const a = deduped[0]!;
            const b = deduped[deduped.length - 1]!;
            if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) deduped.pop();
        }
        return deduped;
    };

    for (let t = 0; t < triCount; t++) {
        const ia = triIndex(t, 0);
        const ib = triIndex(t, 1);
        const ic = triIndex(t, 2);
        const ax = pos.getX(ia);
        const ay = pos.getY(ia);
        const az = pos.getZ(ia);
        const bx = pos.getX(ib);
        const by = pos.getY(ib);
        const bz = pos.getZ(ib);
        const cx = pos.getX(ic);
        const cy = pos.getY(ic);
        const cz = pos.getZ(ic);
        const src = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(src) < 1e-12) continue;
        const tMinX = Math.min(ax, bx, cx);
        const tMaxX = Math.max(ax, bx, cx);
        const tMinY = Math.min(ay, by, cy);
        const tMaxY = Math.max(ay, by, cy);
        if (tMaxX < minX || tMinX > maxX || tMaxY < minY || tMinY > maxY) continue;
        const nIn = (inside[ia] ? 1 : 0) + (inside[ib] ? 1 : 0) + (inside[ic] ? 1 : 0);
        if (nIn === 0 && !mightCross(tMinX, tMaxX, tMinY, tMaxY)) continue;
        if (nIn === 3 && !mightCross(tMinX, tMaxX, tMinY, tMaxY)) {
            pushVertex(ax, ay, az, componentsOf(ia));
            pushVertex(bx, by, bz, componentsOf(ib));
            pushVertex(cx, cy, cz, componentsOf(ic));
            continue;
        }

        const corners = [
            { x: ax, y: ay, z: az, comp: componentsOf(ia) },
            { x: bx, y: by, z: bz, comp: componentsOf(ib) },
            { x: cx, y: cy, z: cz, comp: componentsOf(ic) },
        ];
        const order = src > 0 ? [0, 1, 2] : [0, 2, 1];
        let subject: PlanPoint[] = poly;
        for (let e = 0; e < 3; e++) {
            const k0 = order[e]!;
            const k1 = order[(e + 1) % 3]!;
            const p0 = corners[k0]!;
            const p1 = corners[k1]!;
            subject = clipHalfPlane(subject, p0.x, p0.y, p1.x, p1.y);
            if (subject.length < 3) break;
        }
        if (subject.length < 3) continue;

        const sample = (x: number, y: number): Surf => {
            for (const c of corners) {
                if (Math.hypot(x - c.x, y - c.y) <= 1e-4) return c;
            }
            let bestD = 1e-4;
            let best: Surf | null = null;
            for (let e = 0; e < 3; e++) {
                const p0 = corners[e]!;
                const p1 = corners[(e + 1) % 3]!;
                const ex = p1.x - p0.x;
                const ey = p1.y - p0.y;
                const len2 = ex * ex + ey * ey;
                if (len2 < 1e-18) continue;
                let tt = ((x - p0.x) * ex + (y - p0.y) * ey) / len2;
                if (tt < 0) tt = 0;
                else if (tt > 1) tt = 1;
                const qx = p0.x + ex * tt;
                const qy = p0.y + ey * tt;
                const d = Math.hypot(x - qx, y - qy);
                if (d <= bestD) {
                    bestD = d;
                    best = {
                        x: qx,
                        y: qy,
                        z: p0.z + (p1.z - p0.z) * tt,
                        comp: lerpComponents(p0.comp, p1.comp, tt),
                    };
                }
            }
            if (best) return best;
            const [w0, w1, w2] = triangleBary(x, y, ax, ay, bx, by, cx, cy);
            return {
                x,
                y,
                z: w0 * az + w1 * bz + w2 * cz,
                comp: mix3(corners[0]!.comp, corners[1]!.comp, corners[2]!.comp, w0, w1, w2),
            };
        };

        const ring = subject.map((p) => sample(p.x, p.y));
        const unique: Surf[] = [];
        for (const p of ring) {
            const prev = unique[unique.length - 1];
            if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-5) continue;
            unique.push(p);
        }
        if (
            unique.length >= 2 &&
            Math.hypot(
                unique[0]!.x - unique[unique.length - 1]!.x,
                unique[0]!.y - unique[unique.length - 1]!.y,
            ) < 1e-5
        ) {
            unique.pop();
        }
        if (unique.length < 3) continue;
        if (
            unique.length === 3 &&
            corners.every((c) => unique.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 1e-5))
        ) {
            pushVertex(ax, ay, az, corners[0]!.comp);
            pushVertex(bx, by, bz, corners[1]!.comp);
            pushVertex(cx, cy, cz, corners[2]!.comp);
            continue;
        }
        const tris = triangulatePlan(unique.map((p) => ({ x: p.x, y: p.y })));
        for (const [i, j, k] of tris) {
            const va = unique[i]!;
            const vb = unique[j]!;
            const vc = unique[k]!;
            const area = (vb.x - va.x) * (vc.y - va.y) - (vb.y - va.y) * (vc.x - va.x);
            if (Math.abs(area) < 1e-8) continue;
            const flip = area * src < 0;
            const pb = flip ? vc : vb;
            const pc = flip ? vb : vc;
            pushVertex(va.x, va.y, va.z, va.comp);
            pushVertex(pb.x, pb.y, pb.z, pb.comp);
            pushVertex(pc.x, pc.y, pc.z, pc.comp);
        }
    }
    if (positions.length < 9) {
        throw new Error("[S1-TRIM] boundary clip produced no triangles");
    }
    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    // Position-only weld. Per-triangle attributes (uv, color) would keep
    // coincident clip vertices apart, so the rim walk and the triangles
    // would name different indices and the wall would not seal the boundary.
    const welded = mergeVertices(out, 1e-4);
    if (welded !== out) out.dispose();
    welded.userData = { ...geometry.userData };
    welded.computeVertexNormals();
    welded.computeBoundingBox();
    welded.computeBoundingSphere();
    return welded;
}

function clipPrintTopToTrim(geometry: BufferGeometry, curve: TrimlineCurve): BufferGeometry {
    const cut = clipMeshAlongTrimBoundary(geometry, curve);
    return cut ?? clipGeometryToOutline(geometry, curve);
}

function smoothstep01(t: number): number {
    const x = t < 0 ? 0 : t > 1 ? 1 : t;
    return x * x * (3 - 2 * x);
}

/**
 * Drop the top surface over the last 10 mm approaching the front cut.
 * Full thickness is unchanged at 10 mm and behind. The rim lands on the
 * printable tip. XY stays put, so the clip and the loft pairing do not move.
 */
export function taperAnteriorEdge(geometry: BufferGeometry, curve: TrimlineCurve): void {
    const segments = anteriorCutSegments(curve);
    if (segments.length === 0) return;
    const pos = geometry.getAttribute("position");
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        let best = Infinity;
        for (const [a, b] of segments) {
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const lenSq = abx * abx + aby * aby;
            const t =
                lenSq < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / lenSq));
            const d = Math.hypot(x - (a.x + abx * t), y - (a.y + aby * t));
            if (d < best) best = d;
        }
        if (best >= ANTERIOR_EDGE_TAPER_MM) continue;
        const height = pos.getZ(i);
        if (!(height > ANTERIOR_EDGE_TIP_MM)) continue;
        const blend = smoothstep01(best / ANTERIOR_EDGE_TAPER_MM);
        pos.setZ(i, ANTERIOR_EDGE_TIP_MM + (height - ANTERIOR_EDGE_TIP_MM) * blend);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
}

/**
 * Shorten a finished solid over the last 10 mm. The loft is built at full
 * thickness first — a 0.8 mm rim is too short for the wall fillet and the
 * column folds. Scaling Z about the plantar plane keeps the wall profile
 * and leaves everything 10 mm behind the cut untouched.
 */
export function taperAnteriorSolid(geometry: BufferGeometry, curve: TrimlineCurve): void {
    const segments = anteriorCutSegments(curve);
    if (segments.length === 0) return;
    const pos = geometry.getAttribute("position");
    if (!pos) return;
    geometry.computeVertexNormals();
    const normals = geometry.getAttribute("normal");
    if (!normals) return;
    const cell = 2;
    const reach = 12;
    const keyOf = (ix: number, iy: number) => `${ix},${iy}`;
    const distAt = (x: number, y: number) => {
        let best = Infinity;
        for (const [a, b] of segments) {
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const lenSq = abx * abx + aby * aby;
            const t =
                lenSq < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / lenSq));
            const d = Math.hypot(x - (a.x + abx * t), y - (a.y + aby * t));
            if (d < best) best = d;
        }
        return best;
    };
    type TopCell = { x: number; y: number; z: number; d: number };
    const tops = new Map<string, TopCell>();
    for (let i = 0; i < pos.count; i++) {
        if (!(normals.getZ(i) > 0.45)) continue;
        const z = pos.getZ(i);
        if (!(z > ANTERIOR_EDGE_TIP_MM)) continue;
        const x = pos.getX(i);
        const y = pos.getY(i);
        const d = distAt(x, y);
        if (d > ANTERIOR_EDGE_TAPER_MM + 2) continue;
        const key = keyOf(Math.round(x / cell), Math.round(y / cell));
        const prev = tops.get(key);
        if (!prev || z > prev.z) tops.set(key, { x, y, z, d });
    }
    const drivers = [...tops.values()];
    if (drivers.length === 0) return;
    const driverFactor = drivers.map((top) => {
        if (top.d >= ANTERIOR_EDGE_TAPER_MM) return 1;
        const blend = smoothstep01(top.d / ANTERIOR_EDGE_TAPER_MM);
        return (ANTERIOR_EDGE_TIP_MM + (top.z - ANTERIOR_EDGE_TIP_MM) * blend) / top.z;
    });
    const buckets = new Map<string, number[]>();
    for (let k = 0; k < drivers.length; k++) {
        const top = drivers[k]!;
        const key = keyOf(Math.round(top.x / cell), Math.round(top.y / cell));
        const list = buckets.get(key);
        if (list) list.push(k);
        else buckets.set(key, [k]);
    }
    const ring = Math.ceil(reach / cell);
    for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        if (!(z > 1e-4)) continue;
        const x = pos.getX(i);
        const y = pos.getY(i);
        const ix = Math.round(x / cell);
        const iy = Math.round(y / cell);
        let best = Infinity;
        let factor = 1;
        for (let dx = -ring; dx <= ring; dx++) {
            for (let dy = -ring; dy <= ring; dy++) {
                const list = buckets.get(keyOf(ix + dx, iy + dy));
                if (!list) continue;
                for (const k of list) {
                    const top = drivers[k]!;
                    const dd = Math.hypot(x - top.x, y - top.y);
                    if (dd < best) {
                        best = dd;
                        factor = driverFactor[k] ?? 1;
                    }
                }
            }
        }
        if (!(best <= reach) || !(factor < 1)) continue;
        pos.setZ(i, z * factor);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
}

function finishTrimmedTop(
    geometry: BufferGeometry,
    trim: TrimlineCurve,
    anteriorEdgeTaper: boolean | undefined,
): BufferGeometry {
    if (anteriorEdgeTaper) taperAnteriorEdge(geometry, trim);
    return geometry;
}

/** T then S on the composed top. No writes when the design has no sinks. */
function applyViewerSinkHeight(
    geometry: BufferGeometry,
    reference: BufferGeometry,
    field: HeightFieldParams,
): void {
    if (!sinksActive(field.sinks)) return;
    const frame = getBaseFootprintFrame(reference, field.side);
    applySinkThicknessToGeometry(geometry, reference, field, frame);
    applySinkCutToGeometry(geometry, reference, field, frame);
}

/** Modifier path without GLB element placement (sync; used when no elements). */
export function composePrintSolidTopSync(raw: BufferGeometry, input: ComposePrintSolidInput): BufferGeometry {
    const { geometry, referenceBase, ownedWidth } = composePrintSolidTopCore(raw, input);
    applyViewerSinkHeight(geometry, referenceBase, input.sourceField);
    if (ownedWidth && referenceBase !== raw && referenceBase !== geometry) referenceBase.dispose();
    const trim = input.trimline ?? input.sourceField.trimline ?? null;
    if (trim && trim.points.length >= 4) {
        const clipped = clipPrintTopToTrim(geometry, trim);
        if (geometry !== raw) geometry.dispose();
        return finishTrimmedTop(clipped, trim, input.anteriorEdgeTaper);
    }
    return geometry;
}

export async function composePrintSolidTop(
    raw: BufferGeometry,
    input: ComposePrintSolidInput,
): Promise<BufferGeometry> {
    const { geometry, referenceBase, ownedWidth } = composePrintSolidTopCore(raw, input);
    // Elements stay on the unsunk sheet. T and S are height-only after that,
    // so the viewport shows the recess without feeding a sunk rim into the loft.
    await applyElementsToTopMeshLast(geometry, referenceBase, fieldWithoutSinks(input.sourceField));
    applyViewerSinkHeight(geometry, referenceBase, input.sourceField);
    if (ownedWidth && referenceBase !== raw && referenceBase !== geometry) referenceBase.dispose();
    const trim = input.trimline ?? input.sourceField.trimline ?? null;
    if (trim && trim.points.length >= 4) {
        const clipped = clipPrintTopToTrim(geometry, trim);
        if (geometry !== raw) geometry.dispose();
        return finishTrimmedTop(clipped, trim, input.anteriorEdgeTaper);
    }
    return geometry;
}
