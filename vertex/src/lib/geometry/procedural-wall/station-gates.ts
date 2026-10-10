// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ColumnQuality, columnHeading, FILLET_R_CAP_MM, MIN_ROUND_R_MM } from "./bezier-column";
import { pointInPoly } from "./cdt-band";
import { ensureCcw, type PolyPoint, startAtLowCurvature } from "./curves";
import type { WallRegionDefaults } from "./defaults";
import { fairedPattern } from "./faired-pattern";
import type { HermiteStation } from "./loft";
import { outwardNormal } from "./measure";

export const PATTERN_SOURCE_FAIRED_STOCK = "faired-stock";
export const MIN_INSET_FLOOR_MM = 1;
export const LEAN_INSET_MM = 8;
export const LEAN_MAX_DEG = 45;
export const SKEW_INSET_RATIO = 0.5;
export const PRELOFT_HEADING_MAX_DEG = 15;
export const POSTLOFT_DIHEDRAL_MAX_DEG = 150;

export interface StockFairedInput {
    stock: PolyPoint[];
    rim: PolyPoint[];
    r1: number;
    r2: number;
    bounds?: { minX: number; maxX: number };
    medialYSign?: 1 | -1;
}

export interface ColumnInsetSkew {
    insetMm: number;
    skewMm: number;
    outward: { x: number; y: number };
}

function centroidOf(pts: PolyPoint[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, pts.length);
    return { x: x / n, y: y / n };
}

function minDistToLoop(x: number, y: number, loop: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        best = Math.min(best, Math.hypot(x - (a.x + ex * t), y - (a.y + ey * t)));
    }
    return best;
}

function nearestOnLoop(origin: PolyPoint, loop: PolyPoint[]): PolyPoint {
    let best = loop[0] ?? { x: origin.x, y: origin.y, z: 0 };
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t =
            len2 > 1e-12
                ? Math.max(0, Math.min(1, ((origin.x - a.x) * ex + (origin.y - a.y) * ey) / len2))
                : 0;
        const x = a.x + ex * t;
        const y = a.y + ey * t;
        const d = (x - origin.x) ** 2 + (y - origin.y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = { x, y, z: 0 };
        }
    }
    return best;
}

function nearestIndex(loop: PolyPoint[], p: PolyPoint): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const q = loop[i]!;
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

/** Signed distance of `p` inside `rim`. Positive = inside. */
export function signedRimInsetMm(p: PolyPoint, rim: PolyPoint[]): number {
    if (rim.length < 3) return 0;
    const d = minDistToLoop(p.x, p.y, rim);
    return pointInPoly(p.x, p.y, rim) ? d : -d;
}

export function minInsetForLeanMm(r1: number, r2: number, leanRad: number): number {
    const s = Math.sin(Math.max(0, leanRad));
    return Math.max(MIN_INSET_FLOOR_MM, r1 + r2 * (1 - s));
}

export function allowedLeanRad(insetMm: number): number {
    return insetMm > LEAN_INSET_MM ? (LEAN_MAX_DEG * Math.PI) / 180 : 0;
}

export function filletRadiiFromDefaults(defaults: WallRegionDefaults): { r1: number; r2: number } {
    return {
        r1: Math.min(FILLET_R_CAP_MM, Math.max(MIN_ROUND_R_MM, defaults.wallFilletTopMm || 0.5)),
        r2: Math.min(FILLET_R_CAP_MM, Math.max(0.05, defaults.wallFilletBottomMm || 0.7)),
    };
}

export function minInsetAtStationMm(insetMm: number, r1: number, r2: number): number {
    return minInsetForLeanMm(r1, r2, allowedLeanRad(insetMm));
}

export function rimOutwardAt(rim: PolyPoint[], i: number): { x: number; y: number } {
    return outwardNormal(rim, i, centroidOf(rim));
}

export function rimOutwardNear(rim: PolyPoint[], p: PolyPoint): { x: number; y: number } {
    return rimOutwardAt(rim, nearestIndex(rim, p));
}

/**
 * Column inset / skew in the rim frame. Inset is (R−B)·outward (B inside ⇒ +).
 * Skew is the tangential leftover. Column heading B→R should sit within 90° of
 * the outward rim normal.
 */
export function columnInsetSkew(
    R: PolyPoint,
    B: PolyPoint,
    outward: { x: number; y: number },
): ColumnInsetSkew {
    const dx = B.x - R.x;
    const dy = B.y - R.y;
    const ol = Math.hypot(outward.x, outward.y) || 1;
    const ox = outward.x / ol;
    const oy = outward.y / ol;
    return {
        insetMm: -(dx * ox + dy * oy),
        skewMm: Math.abs(dx * oy - dy * ox),
        outward: { x: ox, y: oy },
    };
}

function unitInwardAtRim(rim: PolyPoint[], x: number, y: number): { x: number; y: number } {
    const n = rimOutwardNear(rim, { x, y, z: 0 });
    return { x: -n.x, y: -n.y };
}

function placeAtInset(rim: PolyPoint[], p: PolyPoint, insetMm: number): PolyPoint {
    const near = nearestOnLoop(p, rim);
    const inn = unitInwardAtRim(rim, near.x, near.y);
    return { x: near.x + inn.x * insetMm, y: near.y + inn.y * insetMm, z: 0 };
}

/**
 * Stock plantar → QP targets. Inset > 8 mm keeps the deep cut-in (lean ≤ 45°).
 * Otherwise the target inset is reduced to the vertical-wall minimum.
 */
export function stockTargetsForFairedPattern(
    stock: PolyPoint[],
    rim: PolyPoint[],
    r1: number,
    r2: number,
): PolyPoint[] {
    if (stock.length < 3 || rim.length < 3) return stock.map((p) => ({ ...p, z: 0 }));
    const verticalMin = minInsetForLeanMm(r1, r2, 0);
    const leanMin = minInsetForLeanMm(r1, r2, allowedLeanRad(LEAN_INSET_MM + 1));
    return stock.map((p) => {
        const inset = signedRimInsetMm(p, rim);
        if (inset > LEAN_INSET_MM) {
            return inset < leanMin ? placeAtInset(rim, p, leanMin) : { x: p.x, y: p.y, z: 0 };
        }
        const want = Math.max(verticalMin, Math.min(Math.max(inset, 0), LEAN_INSET_MM));
        if (Math.abs(inset - want) < 1e-4 && inset >= verticalMin - 1e-4) {
            return { x: p.x, y: p.y, z: 0 };
        }
        return placeAtInset(rim, p, want);
    });
}

/** Default / legacy B: fairedPattern QP on the stock plantar, flat z=0. */
export function fairedPlantarFromStock(input: StockFairedInput): PolyPoint[] {
    const rim = startAtLowCurvature(ensureCcw(input.rim.map((p) => ({ ...p, z: 0 }))));
    const stock = startAtLowCurvature(ensureCcw(input.stock.map((p) => ({ ...p, z: 0 }))));
    const targets = stockTargetsForFairedPattern(stock, rim, input.r1, input.r2);
    const minInsetMm = minInsetForLeanMm(input.r1, input.r2, allowedLeanRad(LEAN_INSET_MM + 1));
    const fit = fairedPattern({
        targets,
        controlCount: 20,
        wFit: 1,
        wFair: 0.35,
        sampleCount: Math.max(160, targets.length, rim.length),
        constraints: {
            rim,
            minInsetMm,
            medialYSign: input.medialYSign,
            bounds: input.bounds,
            lateralMinK: 0,
            maxIters: 10,
        },
    });
    return fit.samples.map((p) => ({ x: p.x, y: p.y, z: 0 }));
}

export function limitStationSkew(stations: HermiteStation[], loop: PolyPoint[]): void {
    if (stations.length < 3 || loop.length < 3) return;
    const rim = stations.map((s) => s.rim);
    const c = centroidOf(rim);
    for (let i = 0; i < stations.length; i++) {
        const st = stations[i]!;
        const out = outwardNormal(rim, i, c);
        const { insetMm, skewMm } = columnInsetSkew(st.rim, st.outline, out);
        const cap = SKEW_INSET_RATIO * Math.max(insetMm, MIN_INSET_FLOOR_MM);
        if (skewMm <= cap + 1e-3) continue;
        const inn = { x: -out.x, y: -out.y };
        const keep = Math.max(insetMm, MIN_INSET_FLOOR_MM);
        const target = {
            x: st.rim.x + inn.x * keep,
            y: st.rim.y + inn.y * keep,
            z: 0,
        };
        const snapped = nearestOnLoop(target, loop);
        st.outline = { x: snapped.x, y: snapped.y, z: 0 };
    }
}

export function assertPreLoftStations(stations: HermiteStation[], r1: number, r2: number): void {
    if (stations.length < 3) {
        throw new Error("[S1-PRELOFT] station ring < 3");
    }
    const rim = stations.map((s) => s.rim);
    const c = centroidOf(rim);
    const bad: string[] = [];
    for (let i = 0; i < stations.length; i++) {
        const st = stations[i]!;
        const nxt = stations[(i + 1) % stations.length]!;
        const out = outwardNormal(rim, i, c);
        const { insetMm, skewMm } = columnInsetSkew(st.rim, st.outline, out);
        const need = minInsetAtStationMm(insetMm, r1, r2);
        if (insetMm + 1e-3 < need) {
            bad.push(`inset[${i}]=${insetMm.toFixed(3)}<${need.toFixed(3)}`);
        }
        const skewCap = SKEW_INSET_RATIO * Math.max(insetMm, 0);
        if (skewMm > skewCap + 1e-3) {
            bad.push(`skew[${i}]=${skewMm.toFixed(3)}>${skewCap.toFixed(3)}`);
        }
        const col = columnHeading(st);
        // B→R should sit in the outward half-plane of the rim.
        const bx = st.rim.x - st.outline.x;
        const by = st.rim.y - st.outline.y;
        const bl = Math.hypot(bx, by);
        const hx = bl > 1e-8 ? bx / bl : -col.h.x;
        const hy = bl > 1e-8 ? by / bl : -col.h.y;
        if (hx * out.x + hy * out.y < -1e-6) {
            const deg = (Math.acos(Math.max(-1, Math.min(1, hx * out.x + hy * out.y))) * 180) / Math.PI;
            bad.push(`column-vs-outward-rim[${i}]=${deg.toFixed(1)}>90`);
        }
        const h1 = columnHeading(nxt).h;
        const d = Math.max(-1, Math.min(1, col.h.x * h1.x + col.h.y * h1.y));
        const head = (Math.acos(d) * 180) / Math.PI;
        if (head > PRELOFT_HEADING_MAX_DEG + 1e-3) {
            bad.push(`heading[${i}-${(i + 1) % stations.length}]=${head.toFixed(2)}>15`);
        }
    }
    if (bad.length) {
        throw new Error(`[S1-PRELOFT] ${bad.length} station(s): ${bad.slice(0, 24).join("; ")}`);
    }
}

export function assertPostLoftGates(quality: ColumnQuality): void {
    const bad: string[] = [];
    if ((quality.maxSignedFoldDeg ?? 0) > POSTLOFT_DIHEDRAL_MAX_DEG + 1e-6) {
        bad.push(`signed-dihedral ${quality.maxSignedFoldDeg.toFixed(2)}>${POSTLOFT_DIHEDRAL_MAX_DEG}`);
    }
    if ((quality.columnCrossings ?? 0) !== 0) {
        bad.push(`crossings=${quality.columnCrossings}`);
    }
    if ((quality.inwardWallFaces ?? 0) !== 0) {
        bad.push(`inward-faces=${quality.inwardWallFaces}`);
    }
    if (bad.length) {
        throw new Error(`[S1-POSTLOFT] ${bad.join("; ")}`);
    }
}
