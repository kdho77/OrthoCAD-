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
        let d = insets[i]!;
        let q = { x: p.x + m.x * d, y: p.y + m.y * d, z: 0 };
        while (d > PATTERN_INSET_MM * 0.8 && !pointInPoly(q.x, q.y, loop)) {
            d *= 0.85;
            q = { x: p.x + m.x * d, y: p.y + m.y * d, z: 0 };
        }
        if (!pointInPoly(q.x, q.y, loop)) {
            const u = edgeInward(loop[(i + n - 1) % n]!, p, loop);
            q = { x: p.x + u.x * PATTERN_INSET_MM, y: p.y + u.y * PATTERN_INSET_MM, z: 0 };
        }
        offset.push(q);
    }
    const spline = fitClosedC2Spline(offset);
    return resampleClosedC2(spline, Math.max(160, n));
}

function asPoint(x: number, y: number, z = 0): PolyPoint {
    return { x, y, z };
}

function parseSvgPoints(source: string): PolyPoint[] {
    const attr = source.match(/points\s*=\s*"([^"]+)"/i);
    const blob = attr?.[1] ?? source;
    const nums = blob.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const out: PolyPoint[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push(asPoint(nums[i]!, nums[i + 1]!));
    return out;
}

function parseSvgPath(source: string): PolyPoint[] {
    const d = source.match(/\bd\s*=\s*"([^"]+)"/i)?.[1] ?? source;
    const out: PolyPoint[] = [];
    const re = /([MLHVZmlhvz])|(-?\d+(?:\.\d+)?)/g;
    let cmd = "M";
    let x = 0;
    let y = 0;
    const raw = d.match(re) ?? [];
    for (let i = 0; i < raw.length; ) {
        const t = raw[i]!;
        if (/^[MLHVZmlhvz]$/.test(t)) {
            cmd = t;
            i++;
            continue;
        }
        const n = Number(t);
        if (cmd === "M" || cmd === "L") {
            x = n;
            y = Number(raw[i + 1] ?? 0);
            out.push(asPoint(x, y));
            i += 2;
            cmd = "L";
        } else if (cmd === "m" || cmd === "l") {
            x += n;
            y += Number(raw[i + 1] ?? 0);
            out.push(asPoint(x, y));
            i += 2;
            cmd = "l";
        } else if (cmd === "H") {
            x = n;
            out.push(asPoint(x, y));
            i++;
        } else if (cmd === "h") {
            x += n;
            out.push(asPoint(x, y));
            i++;
        } else if (cmd === "V") {
            y = n;
            out.push(asPoint(x, y));
            i++;
        } else if (cmd === "v") {
            y += n;
            out.push(asPoint(x, y));
            i++;
        } else if (cmd === "Z" || cmd === "z") {
            i++;
        } else {
            i++;
        }
    }
    return out;
}

function parseDxfPolyline(source: string): PolyPoint[] {
    const lines = source.split(/\r?\n/).map((s) => s.trim());
    const out: PolyPoint[] = [];
    let expecting = "";
    let x = 0;
    for (let i = 0; i < lines.length; i++) {
        const code = lines[i]!;
        const val = lines[i + 1];
        if (code === "10") {
            x = Number(val);
            expecting = "y";
            i++;
        } else if (code === "20" && expecting === "y") {
            out.push(asPoint(x, Number(val)));
            expecting = "";
            i++;
        }
    }
    return out;
}

/**
 * Read a bottom-pattern outline from a polyline, SVG, or DXF (same XY frame
 * as the TopSheet). JSON arrays of {x,y} are also accepted.
 */
export function parseBottomPattern(source: string | PolyPoint[]): PolyPoint[] {
    if (Array.isArray(source)) return source.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
    const t = source.trim();
    if (!t) return [];
    if (t.startsWith("[") || t.startsWith("{")) {
        const json = JSON.parse(t) as { points?: PolyPoint[] } | PolyPoint[];
        const pts = Array.isArray(json) ? json : (json.points ?? []);
        return pts.map((p) => ({ x: Number(p.x), y: Number(p.y), z: Number(p.z ?? 0) }));
    }
    if (/<svg|points\s*=|\bd\s*=/i.test(t)) {
        if (/points\s*=/i.test(t)) return parseSvgPoints(t);
        return parseSvgPath(t);
    }
    if (/LWPOLYLINE|AcDbPolyline|^\s*0\s+SECTION/im.test(t)) return parseDxfPolyline(t);
    if (/[MLHVZ]/i.test(t) && /[-\d]/.test(t)) return parseSvgPath(t);
    return parseSvgPoints(t);
}
