// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { pointInPoly } from "./cdt-band";
import {
    ensureCcw,
    fitClosedC2Spline,
    type PolyPoint,
    resampleClosedC2,
    startAtPosteriorHeel,
} from "./curves";

export const PATTERN_INSET_MM = 6;
export const PATTERN_ARCH_INSET_MM = 12;
export const PATTERN_ARCH_U0 = 0.22;
export const PATTERN_ARCH_U1 = 0.55;

function edgeInward(a: PolyPoint, b: PolyPoint, outline: PolyPoint[]): { x: number; y: number } {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    let nx = -ey / len;
    let ny = ex / len;
    const probe = { x: (a.x + b.x) * 0.5 + nx * 0.5, y: (a.y + b.y) * 0.5 + ny * 0.5 };
    if (!pointInPoly(probe.x, probe.y, outline)) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}

function miterInward(i: number, outline: PolyPoint[]): { x: number; y: number } {
    const n = outline.length;
    const a = outline[(i + n - 1) % n]!;
    const b = outline[i]!;
    const c = outline[(i + 1) % n]!;
    const n1 = edgeInward(a, b, outline);
    const n2 = edgeInward(b, c, outline);
    const denom = 1 + n1.x * n2.x + n1.y * n2.y;
    if (Math.abs(denom) < 1e-4) {
        const mx = n1.x + n2.x;
        const my = n1.y + n2.y;
        const len = Math.hypot(mx, my) || 1;
        return { x: mx / len, y: my / len };
    }
    return { x: (n1.x + n2.x) / denom, y: (n1.y + n2.y) / denom };
}

function archWindow(u: number): number {
    const t = (u - PATTERN_ARCH_U0) / (PATTERN_ARCH_U1 - PATTERN_ARCH_U0);
    if (t <= 0 || t >= 1) return 0;
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
}

/**
 * Synthetic bottom-pattern until Kendon's file arrives: C2 offset of the
 * Default outline, ~6 mm inward, ~12 mm at the medial arch cut-in.
 */
export function syntheticBottomPattern(
    outline: PolyPoint[],
    bounds: { minX: number; maxX: number },
): PolyPoint[] {
    const loop = startAtPosteriorHeel(ensureCcw(outline.map((p) => ({ ...p, z: 0 }))));
    const n = loop.length;
    if (n < 3) return loop;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const insets = loop.map((p) => {
        const u = Math.max(0, Math.min(1, (p.x - bounds.minX) / length));
        const extra = p.y > 0 ? (PATTERN_ARCH_INSET_MM - PATTERN_INSET_MM) * archWindow(u) : 0;
        return PATTERN_INSET_MM + extra;
    });
    for (let pass = 0; pass < 6; pass++) {
        const next = insets.slice();
        for (let i = 0; i < n; i++) {
            const a = insets[(i + n - 1) % n]!;
            const b = insets[i]!;
            const c = insets[(i + 1) % n]!;
            next[i] = 0.5 * b + 0.25 * a + 0.25 * c;
        }
        for (let i = 0; i < n; i++) insets[i] = next[i]!;
    }
    const offset: PolyPoint[] = [];
    for (let i = 0; i < n; i++) {
        const p = loop[i]!;
        const m = miterInward(i, loop);
        const d = insets[i]!;
        const q = { x: p.x + m.x * d, y: p.y + m.y * d, z: 0 };
        if (!pointInPoly(q.x, q.y, loop)) {
            offset.push({ x: p.x - m.x * d, y: p.y - m.y * d, z: 0 });
        } else {
            offset.push(q);
        }
    }
    const spline = fitClosedC2Spline(offset);
    return resampleClosedC2(spline, Math.max(160, n));
}
