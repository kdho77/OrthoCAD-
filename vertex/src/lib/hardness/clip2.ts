// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { differenceD, EndType, FillRule, inflatePathsD, intersectD, JoinType, unionD } from "clipper2-ts";
import { CLIPPER_CLOSE_MM, GRID_MM, SNAP_XY_MM } from "./mesh";

export interface Xy {
    x: number;
    y: number;
}

type PathD = Xy[];

function area(path: PathD): number {
    let s = 0;
    for (let i = 0; i < path.length; i++) {
        const a = path[i]!;
        const b = path[(i + 1) % path.length]!;
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

function ensureCcw(path: PathD): PathD {
    return area(path) >= 0 ? path : path.slice().reverse();
}

function largest(paths: PathD[]): PathD | null {
    let best: PathD | null = null;
    let bestA = -1;
    for (const p of paths) {
        const a = Math.abs(area(p));
        if (a > bestA && p.length >= 3) {
            bestA = a;
            best = p;
        }
    }
    return best;
}

export function unionPolygons(polys: PathD[]): PathD[] {
    if (polys.length === 0) return [];
    const subject = polys.filter((p) => p.length >= 3).map(ensureCcw);
    if (subject.length === 0) return [];
    const out = unionD(subject, FillRule.NonZero) as PathD[];
    return (out ?? []).filter((p) => p.length >= 3).map(ensureCcw);
}

export function offsetPolygon(poly: PathD, deltaMm: number): PathD | null {
    if (poly.length < 3) return null;
    const src = ensureCcw(poly);
    const signed = area(src) >= 0 ? deltaMm : -deltaMm;
    const paths = inflatePathsD([src], signed, JoinType.Round, EndType.Polygon, 2, 2) as PathD[];
    const best = largest(paths ?? []);
    return best ? ensureCcw(best) : null;
}

/** Clipper open/close +0.5 / −0.5 to close gaps and smooth the footprint. */
export function openClose(poly: PathD): PathD | null {
    const opened = offsetPolygon(poly, CLIPPER_CLOSE_MM);
    if (!opened) return null;
    return offsetPolygon(opened, -CLIPPER_CLOSE_MM);
}

export function intersectPolygons(a: PathD, b: PathD): PathD | null {
    if (a.length < 3 || b.length < 3) return null;
    const out = intersectD([ensureCcw(a)], [ensureCcw(b)], FillRule.NonZero) as PathD[];
    const best = largest(out ?? []);
    return best ? ensureCcw(best) : null;
}

export function differencePolygons(a: PathD, b: PathD): PathD[] {
    if (a.length < 3) return [];
    if (b.length < 3) return [ensureCcw(a)];
    const out = differenceD([ensureCcw(a)], [ensureCcw(b)], FillRule.NonZero) as PathD[];
    return (out ?? []).filter((p) => p.length >= 3).map(ensureCcw);
}

export function snapVertices(poly: PathD, step = SNAP_XY_MM): PathD {
    const out: PathD = [];
    for (const p of poly) {
        const x = Math.round(p.x / step) * step;
        const y = Math.round(p.y / step) * step;
        const prev = out[out.length - 1];
        if (!prev || Math.hypot(prev.x - x, prev.y - y) > 1e-6) out.push({ x, y });
    }
    if (out.length >= 2) {
        const a = out[0]!;
        const b = out[out.length - 1]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) out.pop();
    }
    return out;
}

export function pointInPoly(x: number, y: number, poly: PathD): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i]!.y;
        const yj = poly[j]!.y;
        const xi = poly[i]!.x;
        const xj = poly[j]!.x;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi) inside = !inside;
    }
    return inside;
}

export function polyBBox(poly: PathD): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of poly) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
}

export function occupancyToPolygon(
    occ: boolean[][],
    originX: number,
    originY: number,
    step = GRID_MM,
): PathD | null {
    const rects: PathD[] = [];
    for (let iy = 0; iy < occ.length; iy++) {
        const row = occ[iy]!;
        let ix = 0;
        while (ix < row.length) {
            if (!row[ix]) {
                ix += 1;
                continue;
            }
            const start = ix;
            while (ix < row.length && row[ix]) ix += 1;
            const x0 = originX + start * step;
            const y0 = originY + iy * step;
            const x1 = originX + ix * step;
            const y1 = y0 + step;
            rects.push([
                { x: x0, y: y0 },
                { x: x1, y: y0 },
                { x: x1, y: y1 },
                { x: x0, y: y1 },
            ]);
        }
    }
    if (rects.length === 0) return null;
    if (rects.length === 1) return ensureCcw(rects[0]!);
    const unioned = unionPolygons(rects);
    return largest(unioned);
}

export { GRID_MM };
