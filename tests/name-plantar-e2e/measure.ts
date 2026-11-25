// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// #435 G1 measure (validation/name_mirror_fix_gates/measure.ts @ 21b9bef3),
// scored in the physical reading frame of real belt G-code instead of the
// modelled det −1 camera.

import type { Xy } from "./reading-view";
import {
    G1_AXIS_MIN,
    G1_HOOK_CLEAR_MM,
    G1_HOOK_SLACK_MM,
    G1_MIN_ADVANCE_MM,
    G1_SKEW_MAX,
} from "./thresholds";

export interface LinearMap {
    /** reading x from font x */
    a: number;
    /** reading x from font y */
    b: number;
    /** reading y from font x */
    c: number;
    /** reading y from font y */
    d: number;
    det: number;
}

function mean(xs: number[]): number {
    if (xs.length === 0) return Number.NaN;
    let s = 0;
    for (const v of xs) s += v;
    return s / xs.length;
}

/** 2×2 least squares. Centers are removed. Same fit as #435 `fitLinear`. */
export function fitLinear(src: readonly Xy[], dst: readonly Xy[]): LinearMap {
    const n = Math.min(src.length, dst.length);
    const sx = mean(src.slice(0, n).map((p) => p.x));
    const sy = mean(src.slice(0, n).map((p) => p.y));
    const dx = mean(dst.slice(0, n).map((p) => p.x));
    const dy = mean(dst.slice(0, n).map((p) => p.y));
    let xx = 0;
    let xy = 0;
    let yy = 0;
    let xu = 0;
    let yu = 0;
    let xv = 0;
    let yv = 0;
    for (let i = 0; i < n; i++) {
        const x = src[i]!.x - sx;
        const y = src[i]!.y - sy;
        const u = dst[i]!.x - dx;
        const v = dst[i]!.y - dy;
        xx += x * x;
        xy += x * y;
        yy += y * y;
        xu += x * u;
        yu += y * u;
        xv += x * v;
        yv += y * v;
    }
    const det = xx * yy - xy * xy;
    const inv = Math.abs(det) < 1e-12 ? 0 : 1 / det;
    const a = (yy * xu - xy * yu) * inv;
    const b = (xx * yu - xy * xu) * inv;
    const c = (yy * xv - xy * yv) * inv;
    const d = (xx * yv - xy * xv) * inv;
    return { a, b, c, d, det: a * d - b * c };
}

export function mapReadsUpright(map: LinearMap): boolean {
    return (
        map.a > G1_AXIS_MIN &&
        map.d > G1_AXIS_MIN &&
        Math.abs(map.b) < G1_SKEW_MAX &&
        Math.abs(map.c) < G1_SKEW_MAX
    );
}

/**
 * Capital J already in the reading frame. The hook is the lower-left.
 * Same bands and clearances as #435 `jHookExtendsLeft` / belt-print-frame.test.ts.
 */
export function jHookExtendsLeft(outer: readonly Xy[]): boolean {
    if (outer.length < 6) return false;
    const ys = outer.map((p) => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = maxY - minY;
    if (!(span > 1)) return false;
    const hook = outer.filter((p) => p.y <= minY + span * 0.28);
    const cap = outer.filter((p) => p.y >= maxY - span * 0.28);
    if (hook.length < 3 || cap.length < 3) return false;
    const hookMin = Math.min(...hook.map((p) => p.x));
    const hookMax = Math.max(...hook.map((p) => p.x));
    const capMin = Math.min(...cap.map((p) => p.x));
    const capMax = Math.max(...cap.map((p) => p.x));
    return hookMin < capMin - G1_HOOK_CLEAR_MM && hookMax <= capMax + G1_HOOK_SLACK_MM;
}

export function gradeChirality(input: { map: LinearMap; advanceMm: number; hookLeft: boolean }): {
    pass: boolean;
    failures: string[];
} {
    const failures: string[] = [];
    const { map, advanceMm, hookLeft } = input;
    if (!(map.a > G1_AXIS_MIN)) {
        failures.push(`advance maps to reading x ${map.a.toFixed(3)} (need > ${G1_AXIS_MIN})`);
    }
    if (!(map.d > G1_AXIS_MIN)) {
        failures.push(`cap maps to reading y ${map.d.toFixed(3)} (need > ${G1_AXIS_MIN})`);
    }
    if (!(Math.abs(map.b) < G1_SKEW_MAX)) failures.push(`skew b ${map.b.toFixed(3)}`);
    if (!(Math.abs(map.c) < G1_SKEW_MAX)) failures.push(`skew c ${map.c.toFixed(3)}`);
    if (!(advanceMm > G1_MIN_ADVANCE_MM)) {
        failures.push(`physical advance ${advanceMm.toFixed(2)} mm (need > ${G1_MIN_ADVANCE_MM})`);
    }
    if (!hookLeft) failures.push("J hook is not lower-left in the physical reading frame");
    return { pass: failures.length === 0, failures };
}
