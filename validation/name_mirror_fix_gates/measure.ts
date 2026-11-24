// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { physicalPlantarView, type Xy } from "./camera";
import {
    G1_AXIS_MIN,
    G1_HOOK_CLEAR_MM,
    G1_HOOK_SLACK_MM,
    G1_MIN_ADVANCE_MM,
    G1_SKEW_MAX,
    G2_CAP_MM,
    G2_CENTER_TOL_MM,
    G2_CENTER_X_MM,
    G2_CENTER_Y_MM,
    G2_DEPTH_MM,
    G2_MAPPED_WIDTH_MM,
    G2_NUDGE_MM,
    G2_PLACEMENT_U,
    G2_ROTATION_DEG,
    G2_WIDTH_TOL_MM,
    G3_OUTSIDE_IDENT_MM,
    G3_REGION_PAD_MM,
    SKEW_INSET_RATIO_BASE,
} from "./thresholds";

export interface GlyphPoint {
    x: number;
    y: number;
}

export interface PlacedName {
    groups: Array<{ outer: GlyphPoint[] }>;
    centroids: Array<{ x: number; y: number; z: number }>;
    mappedWidthMm: number;
}

export interface NameMarking {
    text: string;
    surface: string;
    mode: string;
    depthMm: number;
    capHeightMm: number;
    rotationDeg: number;
    placementU: number;
    nudgeAlongMm: number;
    nudgeAcrossMm: number;
    bold: boolean;
}

export interface LinearMap {
    /** screen x from glyph x */
    a: number;
    /** screen x from glyph y */
    b: number;
    /** screen y from glyph x */
    c: number;
    /** screen y from glyph y */
    d: number;
    det: number;
}

export interface GateResult {
    id: "G1" | "G2" | "G3" | "G4";
    pass: boolean;
    measured: Record<string, number | string | boolean>;
    failures: string[];
}

function mean(xs: number[]): number {
    if (xs.length === 0) return Number.NaN;
    let s = 0;
    for (const v of xs) s += v;
    return s / xs.length;
}

/** 2×2 least squares, src and dst already paired. Centers are removed. */
export function fitLinear(src: GlyphPoint[], dst: Xy[]): LinearMap {
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
 * Capital J in a view: the hook is the lower-left of the glyph.
 * A left-right mirror puts the hook on the right of the stem.
 */
export function jHookExtendsLeft(outer: GlyphPoint[], view: (p: GlyphPoint) => Xy): boolean {
    const viewed = outer.map(view);
    const ys = viewed.map((p) => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = maxY - minY;
    if (!(span > 1)) return false;
    const hook = viewed.filter((p) => p.y <= minY + span * 0.28);
    const cap = viewed.filter((p) => p.y >= maxY - span * 0.28);
    if (hook.length < 3 || cap.length < 3) return false;
    const hookMin = Math.min(...hook.map((p) => p.x));
    const hookMax = Math.max(...hook.map((p) => p.x));
    const capMin = Math.min(...cap.map((p) => p.x));
    const capMax = Math.max(...cap.map((p) => p.x));
    return hookMin < capMin - G1_HOOK_CLEAR_MM && hookMax <= capMax + G1_HOOK_SLACK_MM;
}

/** Index of the glyph whose font-frame centroid is furthest toward −X (the J in JABBOUR). */
export function leadingGlyphIndex(flatCentroids: readonly GlyphPoint[]): number {
    let best = 0;
    let bestX = Number.POSITIVE_INFINITY;
    for (let i = 0; i < flatCentroids.length; i++) {
        const x = flatCentroids[i]?.x ?? Number.POSITIVE_INFINITY;
        if (x < bestX) {
            bestX = x;
            best = i;
        }
    }
    return best;
}

export function trailingGlyphIndex(flatCentroids: readonly GlyphPoint[]): number {
    let best = 0;
    let bestX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < flatCentroids.length; i++) {
        const x = flatCentroids[i]?.x ?? Number.NEGATIVE_INFINITY;
        if (x > bestX) {
            bestX = x;
            best = i;
        }
    }
    return best;
}

/**
 * Physical-camera span from the font's first glyph to its last.
 * Positive means the string reads left to right on the plantar face.
 */
export function physicalAdvanceMm(
    flatCentroids: readonly GlyphPoint[],
    placedCentroids: readonly GlyphPoint[],
): number {
    if (flatCentroids.length < 2 || placedCentroids.length < 2) return 0;
    const first = placedCentroids[leadingGlyphIndex(flatCentroids)];
    const last = placedCentroids[trailingGlyphIndex(flatCentroids)];
    if (!first || !last) return 0;
    return physicalPlantarView({ ...last, z: 0 }).x - physicalPlantarView({ ...first, z: 0 }).x;
}

/**
 * Pivot the placer used. Mirroring X about this point does not move it.
 * `placed = slope * (flat − pivotLocal) + pivot`, so
 * pivot = mean(placed) − slope * (mean(flat) − local).
 */
export function placementPivot(
    flat: readonly GlyphPoint[],
    placed: readonly GlyphPoint[],
    local: GlyphPoint,
): { x: number; y: number } {
    const n = Math.min(flat.length, placed.length);
    const sx = fitSlope(
        flat.slice(0, n).map((p) => p.x),
        placed.slice(0, n).map((p) => p.x),
    );
    const sy = fitSlope(
        flat.slice(0, n).map((p) => p.y),
        placed.slice(0, n).map((p) => p.y),
    );
    const meanFlatX = mean(flat.slice(0, n).map((p) => p.x));
    const meanFlatY = mean(flat.slice(0, n).map((p) => p.y));
    const meanPlacedX = mean(placed.slice(0, n).map((p) => p.x));
    const meanPlacedY = mean(placed.slice(0, n).map((p) => p.y));
    return {
        x: meanPlacedX - sx * (meanFlatX - local.x),
        y: meanPlacedY - sy * (meanFlatY - local.y),
    };
}

function fitSlope(src: number[], dst: number[]): number {
    const mx = mean(src);
    const my = mean(dst);
    let xx = 0;
    let xy = 0;
    for (let i = 0; i < src.length; i++) {
        const x = (src[i] ?? 0) - mx;
        const y = (dst[i] ?? 0) - my;
        xx += x * x;
        xy += x * y;
    }
    if (xx < 1e-12) return 0;
    return xy / xx;
}

export function gradeFootChirality(
    flatOuter: GlyphPoint[],
    placedOuter: GlyphPoint[],
    flatCentroids: readonly GlyphPoint[],
    placedCentroids: readonly GlyphPoint[],
): { pass: boolean; map: LinearMap; advanceMm: number; hookLeft: boolean } {
    const dst = placedOuter.map((p) => physicalPlantarView({ x: p.x, y: p.y, z: 0 }));
    const map = fitLinear(flatOuter, dst);
    const advanceMm = physicalAdvanceMm(flatCentroids, placedCentroids);
    const hookLeft = jHookExtendsLeft(placedOuter, (p) => physicalPlantarView({ x: p.x, y: p.y, z: 0 }));
    const pass = mapReadsUpright(map) && advanceMm > G1_MIN_ADVANCE_MM && hookLeft;
    return { pass, map, advanceMm, hookLeft };
}

export function gradeG1(
    feet: Array<{
        side: "left" | "right";
        flatOuter: GlyphPoint[];
        placedOuter: GlyphPoint[];
        flatCentroids: readonly GlyphPoint[];
        placedCentroids: readonly GlyphPoint[];
    }>,
): GateResult {
    const failures: string[] = [];
    const measured: Record<string, number | string | boolean> = {};
    if (feet.length !== 2) failures.push(`expected both feet, got ${feet.length}`);
    for (const foot of feet) {
        const row = gradeFootChirality(
            foot.flatOuter,
            foot.placedOuter,
            foot.flatCentroids,
            foot.placedCentroids,
        );
        measured[`${foot.side}A`] = Number(row.map.a.toFixed(6));
        measured[`${foot.side}D`] = Number(row.map.d.toFixed(6));
        measured[`${foot.side}B`] = Number(row.map.b.toFixed(6));
        measured[`${foot.side}C`] = Number(row.map.c.toFixed(6));
        measured[`${foot.side}Det`] = Number(row.map.det.toFixed(6));
        measured[`${foot.side}AdvanceMm`] = Number(row.advanceMm.toFixed(3));
        measured[`${foot.side}HookLeft`] = row.hookLeft;
        if (!(row.map.a > G1_AXIS_MIN))
            failures.push(
                `${foot.side} advance maps to screen x ${row.map.a.toFixed(3)} (need > ${G1_AXIS_MIN})`,
            );
        if (!(row.map.d > G1_AXIS_MIN))
            failures.push(
                `${foot.side} cap maps to screen y ${row.map.d.toFixed(3)} (need > ${G1_AXIS_MIN})`,
            );
        if (!(Math.abs(row.map.b) < G1_SKEW_MAX))
            failures.push(`${foot.side} skew b ${row.map.b.toFixed(3)}`);
        if (!(Math.abs(row.map.c) < G1_SKEW_MAX))
            failures.push(`${foot.side} skew c ${row.map.c.toFixed(3)}`);
        if (!(row.advanceMm > G1_MIN_ADVANCE_MM)) {
            failures.push(
                `${foot.side} physical advance ${row.advanceMm.toFixed(2)} mm (need > ${G1_MIN_ADVANCE_MM})`,
            );
        }
        if (!row.hookLeft) failures.push(`${foot.side} J hook is not lower-left in the physical camera`);
    }
    return { id: "G1", pass: failures.length === 0, measured, failures };
}

export function gradeG2(
    marking: NameMarking,
    placed: PlacedName,
    flatCentroids: readonly GlyphPoint[],
    local: GlyphPoint,
): GateResult {
    const failures: string[] = [];
    const zs = placed.centroids.map((c) => c.z);
    const pivot = placementPivot(flatCentroids, placed.centroids, local);
    const zMax = zs.length ? Math.max(...zs.map((z) => Math.abs(z - G2_DEPTH_MM))) : Number.POSITIVE_INFINITY;
    const measured: Record<string, number | string | boolean> = {
        surface: marking.surface,
        mode: marking.mode,
        depthMm: marking.depthMm,
        capMm: marking.capHeightMm,
        placementU: marking.placementU,
        rotationDeg: marking.rotationDeg,
        pivotXmm: Number(pivot.x.toFixed(4)),
        pivotYmm: Number(pivot.y.toFixed(4)),
        mappedWidthMm: Number(placed.mappedWidthMm.toFixed(4)),
        centroidZAbsErrMm: Number(zMax.toFixed(6)),
        bold: marking.bold,
    };
    if (marking.surface !== "bottom") failures.push(`surface ${marking.surface} (need bottom textMarking)`);
    if (marking.mode !== "engrave")
        failures.push(`mode ${marking.mode} (need engrave so the sole stays flat)`);
    if (marking.depthMm !== G2_DEPTH_MM) failures.push(`depth ${marking.depthMm} mm (need ${G2_DEPTH_MM})`);
    if (marking.capHeightMm !== G2_CAP_MM) failures.push(`cap ${marking.capHeightMm} mm (need ${G2_CAP_MM})`);
    if (marking.placementU !== G2_PLACEMENT_U)
        failures.push(`placementU ${marking.placementU} (need ${G2_PLACEMENT_U})`);
    if (marking.rotationDeg !== G2_ROTATION_DEG) failures.push(`rotation ${marking.rotationDeg} deg`);
    if (marking.nudgeAlongMm !== G2_NUDGE_MM || marking.nudgeAcrossMm !== G2_NUDGE_MM) {
        failures.push(`nudge ${marking.nudgeAlongMm}, ${marking.nudgeAcrossMm}`);
    }
    if (!marking.bold) failures.push("bold is off");
    if (!(zMax < 1e-6)) failures.push(`centroid z leaves ${G2_DEPTH_MM} mm by ${zMax}`);
    if (Math.abs(pivot.x - G2_CENTER_X_MM) > G2_CENTER_TOL_MM) {
        failures.push(`pivot x ${pivot.x.toFixed(3)} mm (need ${G2_CENTER_X_MM} ± ${G2_CENTER_TOL_MM})`);
    }
    if (Math.abs(pivot.y - G2_CENTER_Y_MM) > G2_CENTER_TOL_MM) {
        failures.push(`pivot y ${pivot.y.toFixed(3)} mm (need ${G2_CENTER_Y_MM} ± ${G2_CENTER_TOL_MM})`);
    }
    if (Math.abs(placed.mappedWidthMm - G2_MAPPED_WIDTH_MM) > G2_WIDTH_TOL_MM) {
        failures.push(
            `mapped width ${placed.mappedWidthMm.toFixed(3)} mm (need ${G2_MAPPED_WIDTH_MM} ± ${G2_WIDTH_TOL_MM})`,
        );
    }
    return { id: "G2", pass: failures.length === 0, measured, failures };
}

export interface Aabb {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export function textRegion(points: GlyphPoint[], padMm = G3_REGION_PAD_MM): Aabb {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX: minX - padMm, minY: minY - padMm, maxX: maxX + padMm, maxY: maxY + padMm };
}

export function pointInAabb(x: number, y: number, box: Aabb): boolean {
    return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

/** Vertices outside `inside` must match within G3_OUTSIDE_IDENT_MM. xyz triples. */
export function gradeOutsideGeometry(
    base: ArrayLike<number>,
    candidate: ArrayLike<number>,
    insideVertex: (index: number) => boolean,
): { pass: boolean; differing: number; maxMm: number } {
    const n = Math.min(base.length, candidate.length) / 3;
    if (base.length !== candidate.length) {
        return {
            pass: false,
            differing: Math.abs(base.length - candidate.length),
            maxMm: Number.POSITIVE_INFINITY,
        };
    }
    let differing = 0;
    let maxMm = 0;
    for (let i = 0; i < n; i++) {
        if (insideVertex(i)) continue;
        const dx = (candidate[i * 3] ?? 0) - (base[i * 3] ?? 0);
        const dy = (candidate[i * 3 + 1] ?? 0) - (base[i * 3 + 1] ?? 0);
        const dz = (candidate[i * 3 + 2] ?? 0) - (base[i * 3 + 2] ?? 0);
        const dist = Math.hypot(dx, dy, dz);
        if (dist > G3_OUTSIDE_IDENT_MM) {
            differing += 1;
            if (dist > maxMm) maxMm = dist;
        }
    }
    return { pass: differing === 0, differing, maxMm };
}

/** Motion lines whose mesh XY is outside the text region must be byte-identical. */
export function gradeOutsideGcode(
    baseLines: readonly string[],
    candidateLines: readonly string[],
    meshOf: (line: string) => { x: number; y: number } | null,
    region: Aabb,
): { pass: boolean; outsideBase: number; outsideCandidate: number } {
    const keep = (line: string) => {
        const mesh = meshOf(line);
        if (!mesh) return true;
        return !pointInAabb(mesh.x, mesh.y, region);
    };
    const base = baseLines.filter(keep).join("\n");
    const candidate = candidateLines.filter(keep).join("\n");
    return {
        pass: base === candidate,
        outsideBase: baseLines.filter(keep).length,
        outsideCandidate: candidateLines.filter(keep).length,
    };
}

const SCOPE_DENY = [
    /\/kiri\//,
    /slicer/i,
    /seam/i,
    /layer[-_]change/i,
    /surface[-_]quality/i,
    /vertexslice/i,
];

export function scopeHits(files: readonly string[]): string[] {
    return files.filter((file) => SCOPE_DENY.some((rule) => rule.test(file)));
}

/** A diff that moves `SKEW_INSET_RATIO` off 0.5 fails. An untouched file passes. */
export function skewInsetChanged(diffText: string): boolean {
    const added = [...diffText.matchAll(/^\+.*SKEW_INSET_RATIO\s*=\s*([0-9.]+)/gm)].map((m) => m[1]);
    const removed = [...diffText.matchAll(/^[-].*SKEW_INSET_RATIO\s*=\s*([0-9.]+)/gm)].map((m) => m[1]);
    if (added.length === 0 && removed.length === 0) return false;
    return added.some((value) => Number(value) !== SKEW_INSET_RATIO_BASE) || removed.length !== added.length;
}

export function gradeG3(input: {
    geometry: { pass: boolean; differing: number; maxMm: number };
    gcode: { pass: boolean; outsideBase: number; outsideCandidate: number };
    files: readonly string[];
    diffText: string;
    soleBottomMaxAbsZmm: number;
}): GateResult {
    const failures: string[] = [];
    const hits = scopeHits(input.files);
    const capMoved = skewInsetChanged(input.diffText);
    if (!input.geometry.pass) {
        failures.push(
            `${input.geometry.differing} vertices outside the text region moved, max ${input.geometry.maxMm} mm (limit ${G3_OUTSIDE_IDENT_MM})`,
        );
    }
    if (!input.gcode.pass) {
        failures.push(
            `gcode outside the text region changed (${input.gcode.outsideBase} base lines, ${input.gcode.outsideCandidate} candidate lines)`,
        );
    }
    if (hits.length > 0) failures.push(`scope touched ${hits.join(", ")}`);
    if (capMoved) failures.push(`SKEW_INSET_RATIO moved off ${SKEW_INSET_RATIO_BASE}`);
    if (input.soleBottomMaxAbsZmm > G3_OUTSIDE_IDENT_MM) {
        failures.push(`sole bottom |z| ${input.soleBottomMaxAbsZmm} mm (need flat at 0)`);
    }
    return {
        id: "G3",
        pass: failures.length === 0,
        measured: {
            outsideVertices: input.geometry.differing,
            outsideMaxMm: input.geometry.maxMm,
            gcodeOutsideBase: input.gcode.outsideBase,
            gcodeOutsideCandidate: input.gcode.outsideCandidate,
            scopeHits: hits.length,
            skewInsetChanged: capMoved,
            soleBottomMaxAbsZmm: input.soleBottomMaxAbsZmm,
        },
        failures,
    };
}

export function gradeG4(input: { sameBytes: boolean; baseHash: string; candidateHash: string }): GateResult {
    const failures: string[] = [];
    if (!input.sameBytes || input.baseHash !== input.candidateHash) {
        failures.push(
            `no-text bytes differ (base ${input.baseHash.slice(0, 12)} candidate ${input.candidateHash.slice(0, 12)})`,
        );
    }
    return {
        id: "G4",
        pass: failures.length === 0,
        measured: {
            sameBytes: input.sameBytes,
            baseHash: input.baseHash,
            candidateHash: input.candidateHash,
        },
        failures,
    };
}
