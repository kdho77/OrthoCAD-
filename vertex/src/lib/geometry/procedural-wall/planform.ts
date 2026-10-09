// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ensureCcw,
    type PolyPoint,
    polylineArcLengths,
    resampleClosedC2,
    startAtPosteriorHeel,
} from "./curves";
import { type PlanformColumn, type PlanformFrame, S1_COLUMN_COUNT, S1_WAIST_RHO_MM } from "./types";

function radiusAt(pts: PolyPoint[], i: number): number {
    const n = pts.length;
    const prev = pts[(i + n - 1) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const d1x = next.x - prev.x;
    const d1y = next.y - prev.y;
    const d2x = next.x - 2 * cur.x + prev.x;
    const d2y = next.y - 2 * cur.y + prev.y;
    const d1 = Math.hypot(d1x, d1y);
    const cross = d1x * d2y - d1y * d2x;
    const k = Math.abs(cross) / Math.max(d1 ** 3, 1e-12);
    return k < 1e-8 ? 1e6 : 1 / k;
}

function isWaist(p: PolyPoint, minX: number, length: number): boolean {
    const u = (p.x - minX) / Math.max(length, 1e-3);
    return u > 0.28 && u < 0.62;
}

function pointInPoly(x: number, y: number, poly: PolyPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i]!.x;
        const yi = poly[i]!.y;
        const xj = poly[j]!.x;
        const yj = poly[j]!.y;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

/** Curvature-filter the outline so waist radius of curvature is at least `minRho` mm. */
export function curvatureFilterOutline(src: PolyPoint[], minRho = S1_WAIST_RHO_MM): PolyPoint[] {
    let cur = startAtPosteriorHeel(ensureCcw(src.map((p) => ({ ...p }))));
    if (cur.length < 8) return cur;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of cur) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const length = maxX - minX;
    for (let pass = 0; pass < 32; pass++) {
        let worst = Infinity;
        for (let i = 0; i < cur.length; i++) {
            if (!isWaist(cur[i]!, minX, length)) continue;
            worst = Math.min(worst, radiusAt(cur, i));
        }
        if (worst >= minRho) break;
        const next: PolyPoint[] = [];
        for (let i = 0; i < cur.length; i++) {
            const a = cur[(i + cur.length - 1) % cur.length]!;
            const b = cur[i]!;
            const c = cur[(i + 1) % cur.length]!;
            const mix = isWaist(b, minX, length) ? 0.5 : 0.1;
            next.push({
                x: b.x * (1 - mix) + (a.x + c.x) * 0.5 * mix,
                y: b.y * (1 - mix) + (a.y + c.y) * 0.5 * mix,
                z: b.z,
            });
        }
        cur = next;
    }
    return resampleClosedC2({ controls: cur, c2: true }, Math.max(256, cur.length));
}

function densityWeight(s01: number, rho: number, minRho: number): number {
    const heel = Math.exp(-((s01 / 0.14) ** 2)) + Math.exp(-(((1 - s01) / 0.14) ** 2));
    const waist = Math.exp(-(((s01 - 0.28) / 0.08) ** 2)) + Math.exp(-(((s01 - 0.72) / 0.08) ** 2));
    const kappa = minRho / Math.max(rho, 1);
    return 1 + 2.4 * heel + 2.1 * waist + 1.4 * kappa;
}

/**
 * Hit of a closed curve with the vertical column plane through `origin`
 * whose normal is `tangent`. Prefers the nearest intersection to `origin`
 * so the far-side wall/rim is never chosen.
 */
export function projectCurveOntoPlane(
    origin: PolyPoint,
    tangent: { x: number; y: number },
    curve: PolyPoint[],
): PolyPoint {
    let best: PolyPoint | null = null;
    let bestDist = Infinity;
    const n = curve.length;
    for (let i = 0; i < n; i++) {
        const a = curve[i]!;
        const b = curve[(i + 1) % n]!;
        const da = (a.x - origin.x) * tangent.x + (a.y - origin.y) * tangent.y;
        const db = (b.x - origin.x) * tangent.x + (b.y - origin.y) * tangent.y;
        if (da * db > 0 && Math.abs(da) > 1e-6 && Math.abs(db) > 1e-6) continue;
        const denom = db - da;
        const f = Math.abs(denom) < 1e-12 ? 0 : -da / denom;
        if (f < -0.05 || f > 1.05) continue;
        const ff = Math.max(0, Math.min(1, f));
        const hit = {
            x: a.x + (b.x - a.x) * ff,
            y: a.y + (b.y - a.y) * ff,
            z: a.z + (b.z - a.z) * ff,
        };
        const dist = Math.hypot(hit.x - origin.x, hit.y - origin.y);
        if (dist < bestDist) {
            bestDist = dist;
            best = hit;
        }
    }
    if (best) return best;
    let nearest = curve[0]!;
    let nd = Infinity;
    for (const r of curve) {
        const side = Math.abs((r.x - origin.x) * tangent.x + (r.y - origin.y) * tangent.y);
        const dist = Math.hypot(r.x - origin.x, r.y - origin.y) + side * 4;
        if (dist < nd) {
            nd = dist;
            nearest = r;
        }
    }
    return { ...nearest };
}

export function buildPlanformFrame(
    outlineControls: PolyPoint[],
    rimControls: PolyPoint[],
    columnCount = S1_COLUMN_COUNT,
): PlanformFrame {
    const raw = startAtPosteriorHeel(ensureCcw(outlineControls.map((p) => ({ ...p }))));
    const filtered = curvatureFilterOutline(outlineControls);
    const { cum, total } = polylineArcLengths(filtered);
    const rhos = filtered.map((_, i) => radiusAt(filtered, i));
    const minRho = rhos.reduce((m, r) => Math.min(m, r), Infinity);

    const wcum = [0];
    for (let i = 0; i < filtered.length; i++) {
        const s01 = (cum[i]! / Math.max(total, 1e-9)) % 1;
        wcum.push(wcum[i]! + densityWeight(s01, rhos[i]!, minRho));
    }
    const wsum = wcum[filtered.length]!;

    const smoothed: PolyPoint[] = [];
    const smoothedS: number[] = [];
    const smoothedRho: number[] = [];
    let iSeek = 0;
    for (let k = 0; k < columnCount; k++) {
        const goal = ((k + 0.5) / columnCount) * wsum;
        while (iSeek < filtered.length - 1 && wcum[iSeek + 1]! < goal) iSeek++;
        const w0 = wcum[iSeek]!;
        const w1 = wcum[iSeek + 1]!;
        const f = w1 > w0 + 1e-12 ? (goal - w0) / (w1 - w0) : 0;
        const a = filtered[iSeek]!;
        const b = filtered[(iSeek + 1) % filtered.length]!;
        smoothed.push({
            x: a.x + (b.x - a.x) * f,
            y: a.y + (b.y - a.y) * f,
            z: a.z + (b.z - a.z) * f,
        });
        const s0 = cum[iSeek]!;
        const s1 = cum[iSeek + 1] ?? s0;
        smoothedS.push(s0 + (s1 - s0) * f);
        smoothedRho.push(rhos[iSeek]! * (1 - f) + rhos[(iSeek + 1) % rhos.length]! * f);
    }

    const ns: Array<{ x: number; y: number }> = [];
    const ts: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < columnCount; k++) {
        const prev = smoothed[(k + columnCount - 1) % columnCount]!;
        const next = smoothed[(k + 1) % columnCount]!;
        const tx = next.x - prev.x;
        const ty = next.y - prev.y;
        const len = Math.hypot(tx, ty) || 1;
        const t = { x: tx / len, y: ty / len };
        // CCW outline → inward = rotate tangent 90° CCW.
        let n = { x: -t.y, y: t.x };
        const o = smoothed[k]!;
        if (!pointInPoly(o.x + n.x * 0.8, o.y + n.y * 0.8, filtered)) {
            n = { x: -n.x, y: -n.y };
        }
        ns.push(n);
        ts.push({ x: n.y, y: -n.x });
    }
    // Periodic Laplacian on n so a leftover kink cannot flip the frame.
    for (let pass = 0; pass < 3; pass++) {
        const next = ns.map((n, i) => {
            const a = ns[(i + columnCount - 1) % columnCount]!;
            const c = ns[(i + 1) % columnCount]!;
            const x = n.x * 0.6 + (a.x + c.x) * 0.2;
            const y = n.y * 0.6 + (a.y + c.y) * 0.2;
            const len = Math.hypot(x, y) || 1;
            return { x: x / len, y: y / len };
        });
        for (let i = 0; i < columnCount; i++) ns[i] = next[i]!;
    }
    for (let k = 0; k < columnCount; k++) {
        const n = ns[k]!;
        const o = smoothed[k]!;
        if (!pointInPoly(o.x + n.x * 0.8, o.y + n.y * 0.8, filtered)) {
            ns[k] = { x: -n.x, y: -n.y };
        }
        const nn = ns[k]!;
        ts[k] = { x: nn.y, y: -nn.x };
    }

    const columns: PlanformColumn[] = [];
    for (let k = 0; k < columnCount; k++) {
        const o = smoothed[k]!;
        const n = ns[k]!;
        const tangent = ts[k]!;
        // Wall attaches at the RAW outline hit — n comes from the smoothed frame.
        const outline = projectCurveOntoPlane(o, tangent, raw);
        const rim = projectCurveOntoPlane(o, tangent, rimControls);
        columns.push({
            s: smoothedS[k]!,
            s01: (smoothedS[k]! / Math.max(total, 1e-9)) % 1,
            outline,
            n,
            tangent,
            rim,
            rho: smoothedRho[k]!,
        });
    }

    let spacingOk = true;
    let detSignStable = true;
    for (let i = 0; i < columns.length; i++) {
        const a = columns[i]!;
        const b = columns[(i + 1) % columns.length]!;
        const sa = smoothed[i]!;
        const sb = smoothed[(i + 1) % smoothed.length]!;
        const spacing = Math.hypot(sb.x - sa.x, sb.y - sa.y);
        const lim = Math.min(a.rho, b.rho);
        if (spacing > lim + 1e-6) spacingOk = false;
        // Frame handedness (n, t) must not flip, and n must not reverse.
        const det = a.n.x * a.tangent.y - a.n.y * a.tangent.x;
        const det2 = b.n.x * b.tangent.y - b.n.y * b.tangent.x;
        if (det * det2 < 0) detSignStable = false;
        if (a.n.x * b.n.x + a.n.y * b.n.y < -0.15) detSignStable = false;
    }

    return {
        columns,
        totalS: total,
        minRho,
        spacingOk,
        detSignStable,
        maxFitResidualMm: 0,
    };
}

export function assertNonCrossing(frame: PlanformFrame): boolean {
    return frame.spacingOk && frame.detSignStable;
}
