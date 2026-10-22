// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FillRule, intersectD } from "clipper2-ts";
import { ensureCcw, type PolyPoint, resamplePolyline } from "./curves";
import type { DistalSkiveField } from "./distal-skive";
import { type CutSample, closestOnCut } from "./trim-curve";

type Xy = { x: number; y: number };

function toPath(loop: PolyPoint[]): Xy[] {
    const out: Xy[] = [];
    for (const p of loop) {
        const prev = out[out.length - 1];
        if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 1e-4) continue;
        out.push({ x: p.x, y: p.y });
    }
    if (
        out.length > 2 &&
        Math.hypot(out[0]!.x - out[out.length - 1]!.x, out[0]!.y - out[out.length - 1]!.y) < 1e-4
    ) {
        out.pop();
    }
    return out;
}

/** Polygon covering everything proximal of the cut, including the cut itself. */
export function keepSideOfCut(cut: readonly CutSample[], marginMm = 500): PolyPoint[] {
    const a = cut[0];
    const b = cut[cut.length - 1];
    if (!a || !b) return [];
    const pts: PolyPoint[] = cut.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    pts.push({ x: b.x + b.nx * marginMm, y: b.y + b.ny * marginMm, z: 0 });
    pts.push({ x: a.x + a.nx * marginMm, y: a.y + a.ny * marginMm, z: 0 });
    return pts;
}

function largestPath(paths: Xy[][]): Xy[] | null {
    let best: Xy[] | null = null;
    let bestA = -1;
    for (const path of paths) {
        if (path.length < 3) continue;
        let a = 0;
        for (let i = 0; i < path.length; i++) {
            const p = path[i]!;
            const q = path[(i + 1) % path.length]!;
            a += p.x * q.y - q.x * p.y;
        }
        const area = Math.abs(a) * 0.5;
        if (area > bestA) {
            bestA = area;
            best = path;
        }
    }
    return best;
}

/**
 * Cut the pattern on the same curve. The distal edge is replaced by the cut
 * so the green pattern is flush there; the side walls are left as they were.
 */
export function clipPatternFlushToCut(pattern: PolyPoint[], field: DistalSkiveField): PolyPoint[] {
    const keep = keepSideOfCut(field.cut);
    if (pattern.length < 3 || keep.length < 3) return pattern;
    const subject = toPath(ensureCcw(pattern.map((p) => ({ ...p, z: 0 }))));
    const clip = toPath(ensureCcw(keep));
    let clipped: Xy[] = subject;
    try {
        const hit = intersectD([subject], [clip], FillRule.NonZero) as Xy[][];
        const best = largestPath(hit ?? []);
        if (best && best.length >= 3) clipped = best;
    } catch {
        clipped = subject;
    }
    const loop = clipped.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    const flushed = flushDistalEdge(loop, field.cut);
    const n = Math.max(160, pattern.length, flushed.length);
    return ensureCcw(resamplePolyline(flushed, n).map((p) => ({ ...p, z: 0 })));
}

function flushDistalEdge(loop: PolyPoint[], cut: readonly CutSample[]): PolyPoint[] {
    if (loop.length < 4 || cut.length < 2) return loop;
    const hits = loop.map((p) => closestOnCut(p.x, p.y, cut));
    let tip = 0;
    for (let i = 1; i < hits.length; i++) {
        if (hits[i]!.signed < hits[tip]!.signed) tip = i;
    }
    const n = loop.length;
    const near = (i: number) => hits[i]!.dist < 2.5 || hits[i]!.signed < 1.25;
    if (!near(tip) && hits[tip]!.signed > 3) return loop;
    let lo = tip;
    let hi = tip;
    for (let step = 0; step < n - 2; step++) {
        const prev = (lo - 1 + n) % n;
        if (prev === hi || !near(prev)) break;
        lo = prev;
    }
    for (let step = 0; step < n - 2; step++) {
        const next = (hi + 1) % n;
        if (next === lo || !near(next)) break;
        hi = next;
    }
    const ia = hits[lo]!.index;
    const ib = hits[hi]!.index;
    const from = Math.min(ia, ib);
    const to = Math.max(ia, ib);
    const span: PolyPoint[] = [];
    if (ia <= ib) {
        for (let i = from; i <= to; i++) span.push({ x: cut[i]!.x, y: cut[i]!.y, z: 0 });
    } else {
        for (let i = to; i >= from; i--) span.push({ x: cut[i]!.x, y: cut[i]!.y, z: 0 });
    }
    const out: PolyPoint[] = [];
    let i = (hi + 1) % n;
    let guard = 0;
    while (i !== lo && guard < n + 2) {
        out.push(loop[i]!);
        i = (i + 1) % n;
        guard++;
    }
    out.push(loop[lo]!);
    for (const p of span) out.push(p);
    const dedup: PolyPoint[] = [];
    for (const p of out) {
        const prev = dedup[dedup.length - 1];
        if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 0.05) continue;
        dedup.push(p);
    }
    return dedup.length >= 4 ? dedup : loop;
}

/** Shoelace area of the pattern that sits distal of the cut. Zero means the clip held. */
export function distalPatternAreaMm2(pattern: PolyPoint[], cut: readonly CutSample[]): number {
    let area = 0;
    for (let i = 0; i < pattern.length; i++) {
        const a = pattern[i]!;
        const b = pattern[(i + 1) % pattern.length]!;
        const da = closestOnCut(a.x, a.y, cut).signed;
        const db = closestOnCut(b.x, b.y, cut).signed;
        if (da >= -0.05 && db >= -0.05) continue;
        area += Math.abs(a.x * b.y - b.x * a.y) * 0.5;
    }
    return area;
}

/** True when this pattern point is on the cut and may sit flush with the rim. */
export function patternPointOnCut(point: PolyPoint, cut: readonly CutSample[], tolMm = 0.35): boolean {
    return closestOnCut(point.x, point.y, cut).dist <= tolMm;
}
