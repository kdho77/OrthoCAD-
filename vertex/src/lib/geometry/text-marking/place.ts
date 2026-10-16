// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { minDistToLoopXY, pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import type { PolyPoint } from "@/lib/geometry/procedural-wall/curves";
import type { Side } from "@/types";
import {
    TEXT_BOOLEAN_EPS_MM,
    TEXT_BOTTOM_INSET_MM,
    TEXT_CAP,
    TEXT_TRIMLINE_RIM_BAND_MM,
    TEXT_U,
    TEXT_WALL_EDGE_CLEARANCE_MM,
    TEXT_WALL_MIN_THICK_MM,
} from "./constants";
import { TextMarkingError, textDoesNotFit, textForbiddenZone, textTooThinRemaining } from "./errors";
import { type MapTextPoint, planarBottomMap } from "./solid";
import type { FlattenedText, TextApplyMeta, TextMarking, TextXy } from "./types";

export interface WallStation {
    u: number;
    s: number;
    R: { x: number; y: number; z: number };
    B: { x: number; y: number; z: number };
    heightMm: number;
    sideSign: number;
    nOut: { x: number; y: number; z: number };
    thickMm: number;
}

export interface HostTextContext {
    outline: PolyPoint[];
    stations: WallStation[];
    minX: number;
    maxX: number;
    midY: number;
}

function loopOf(pts: Array<{ x: number; y: number; z?: number }>): PolyPoint[] {
    return pts.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
}

function centroid(pts: Array<{ x: number; y: number }>): TextXy {
    let x = 0;
    let y = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, pts.length);
    return { x: x / n, y: y / n };
}

function rotateAbout(p: TextXy, c: TextXy, deg: number): TextXy {
    const r = (deg * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

function transformGroups(flat: FlattenedText, fn: (p: TextXy) => TextXy): FlattenedText {
    const mapLoop = (loop: TextXy[]) => loop.map(fn);
    return {
        ...flat,
        groups: flat.groups.map((g) => ({
            outer: mapLoop(g.outer),
            holes: g.holes.map(mapLoop),
        })),
        centroids: flat.centroids.map(fn),
    };
}

export function extractHostTextContext(geo: BufferGeometry): HostTextContext {
    const ud = geo.userData as {
        outlineRing?: Array<{ x: number; y: number; z?: number }>;
        bottomOutlineB?: Array<{ x: number; y: number; z?: number }>;
        wallFrames?: Array<{
            u: number;
            R: { x: number; y: number; z: number };
            heightMm?: number;
            Bz?: number;
            sideSign?: number;
        }>;
    };
    const outline = loopOf(ud.outlineRing ?? ud.bottomOutlineB ?? []);
    const frames = ud.wallFrames ?? [];
    const c = centroid(outline.length ? outline : [{ x: 0, y: 0 }]);
    const stations: WallStation[] = [];
    let s = 0;
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const B = outline[i] ?? { x: fr.R.x, y: fr.R.y, z: fr.Bz ?? 0 };
        const prev = frames[(i + frames.length - 1) % frames.length]!.R;
        const next = frames[(i + 1) % frames.length]!.R;
        const tx = next.x - prev.x;
        const ty = next.y - prev.y;
        const tz = next.z - prev.z;
        const wx = fr.R.x - B.x;
        const wy = fr.R.y - B.y;
        const wz = fr.R.z - (B.z ?? 0);
        let nx = ty * wz - tz * wy;
        let ny = tz * wx - tx * wz;
        let nz = tx * wy - ty * wx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const awayX = fr.R.x - c.x;
        const awayY = fr.R.y - c.y;
        if (nx * awayX + ny * awayY < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
        }
        const thickMm = Math.hypot(wx, wy);
        if (i > 0) {
            const p = frames[i - 1]!.R;
            s += Math.hypot(fr.R.x - p.x, fr.R.y - p.y, fr.R.z - p.z);
        }
        stations.push({
            u: fr.u,
            s,
            R: fr.R,
            B: { x: B.x, y: B.y, z: B.z ?? fr.Bz ?? 0 },
            heightMm: fr.heightMm ?? Math.abs(fr.R.z - (B.z ?? 0)),
            sideSign: fr.sideSign ?? 1,
            nOut: { x: nx, y: ny, z: nz },
            thickMm,
        });
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let midY = 0;
    for (const p of outline) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        midY += p.y;
    }
    midY /= Math.max(1, outline.length);
    return { outline, stations, minX, maxX, midY };
}

function xAtU(ctx: HostTextContext, u: number): number {
    return ctx.minX + u * Math.max(1e-3, ctx.maxX - ctx.minX);
}

/** Mid-line Y of the outline at a given X (medial-lateral centreline). */
function centrelineYAtX(outline: PolyPoint[], x: number, fallback: number): number {
    const hits: number[] = [];
    const n = outline.length;
    for (let i = 0; i < n; i++) {
        const a = outline[i]!;
        const b = outline[(i + 1) % n]!;
        const dx = b.x - a.x;
        if (Math.abs(dx) < 1e-9) {
            if (Math.abs(a.x - x) < 0.2) {
                hits.push(a.y, b.y);
            }
            continue;
        }
        const t = (x - a.x) / dx;
        if (t >= -1e-6 && t <= 1 + 1e-6) hits.push(a.y + (b.y - a.y) * t);
    }
    if (hits.length < 2) return fallback;
    hits.sort((a, b) => a - b);
    return 0.5 * (hits[0]! + hits[hits.length - 1]!);
}

function sampleAlong(stations: WallStation[], s: number): WallStation {
    if (stations.length === 1) return stations[0]!;
    if (s <= stations[0]!.s) return stations[0]!;
    const last = stations[stations.length - 1]!;
    if (s >= last.s) return last;
    for (let i = 1; i < stations.length; i++) {
        const a = stations[i - 1]!;
        const b = stations[i]!;
        if (s <= b.s) {
            const t = (s - a.s) / Math.max(1e-9, b.s - a.s);
            return {
                u: a.u + (b.u - a.u) * t,
                s,
                R: {
                    x: a.R.x + (b.R.x - a.R.x) * t,
                    y: a.R.y + (b.R.y - a.R.y) * t,
                    z: a.R.z + (b.R.z - a.R.z) * t,
                },
                B: {
                    x: a.B.x + (b.B.x - a.B.x) * t,
                    y: a.B.y + (b.B.y - a.B.y) * t,
                    z: a.B.z + (b.B.z - a.B.z) * t,
                },
                heightMm: a.heightMm + (b.heightMm - a.heightMm) * t,
                sideSign: a.sideSign,
                nOut: {
                    x: a.nOut.x + (b.nOut.x - a.nOut.x) * t,
                    y: a.nOut.y + (b.nOut.y - a.nOut.y) * t,
                    z: a.nOut.z + (b.nOut.z - a.nOut.z) * t,
                },
                thickMm: a.thickMm + (b.thickMm - a.thickMm) * t,
            };
        }
    }
    return last;
}

export function lateralStations(ctx: HostTextContext): WallStation[] {
    return ctx.stations.filter((st) => st.sideSign < 0 && st.u >= TEXT_U.wall.min && st.u <= TEXT_U.wall.max);
}

function fitsInside(flat: FlattenedText, outline: PolyPoint[], insetMm: number): boolean {
    for (const g of flat.groups) {
        for (const p of g.outer) {
            if (!pointInPoly(p.x, p.y, outline)) return false;
            if (minDistToLoopXY(p.x, p.y, outline) < insetMm) return false;
        }
    }
    return true;
}

/** Top-sheet Z at each XY (ignore the plantar z=0 vertices that share the same XY). */
function minLocalHeight(geo: BufferGeometry, pts: TextXy[]): number {
    const pos = geo.getAttribute("position").array as Float32Array;
    let min = Infinity;
    for (const p of pts) {
        let zTop = -Infinity;
        for (let i = 0; i < pos.length; i += 3) {
            const d = Math.hypot(pos[i]! - p.x, pos[i + 1]! - p.y);
            if (d < 2.5) zTop = Math.max(zTop, pos[i + 2]!);
        }
        min = Math.min(min, zTop);
    }
    return Number.isFinite(min) && min > -1e3 ? min : 0;
}

export function placeBottomText(
    geo: BufferGeometry,
    ctx: HostTextContext,
    marking: TextMarking,
    flat: FlattenedText,
    side: Side,
): { flat: FlattenedText; map: MapTextPoint; meta: Pick<TextApplyMeta, "centroids" | "mappedWidthMm"> } {
    const u = Math.max(TEXT_U.bottom.min, Math.min(TEXT_U.bottom.max, marking.placementU));
    const cx = xAtU(ctx, u);
    // Left-foot placement is already mirrored with the host mesh; do not glyph-mirror again.
    void side;
    const cy = centrelineYAtX(ctx.outline, cx, ctx.midY);
    const local = { x: flat.advanceMm / 2, y: flat.capHeightMm / 2 };
    const applyAt = (src: FlattenedText, scale: number): FlattenedText => {
        const s = scale;
        const pivoted = transformGroups(src, (p) => ({
            x: (p.x - local.x) * s,
            y: (p.y - local.y) * s,
        }));
        const rotated = transformGroups(pivoted, (p) => rotateAbout(p, { x: 0, y: 0 }, marking.rotationDeg));
        // Mirror so the recess reads correctly when the insole is flipped (pancake about X).
        const mirrored = transformGroups(rotated, (p) => ({ x: p.x, y: -p.y }));
        return transformGroups(mirrored, (p) => ({ x: p.x + cx, y: p.y + cy }));
    };

    let placed = applyAt(flat, 1);
    let scale = 1;
    const minScale = TEXT_CAP.bottom.min / Math.max(flat.capHeightMm, 1e-3);
    while (!fitsInside(placed, ctx.outline, TEXT_BOTTOM_INSET_MM) && scale > minScale + 1e-4) {
        scale = Math.max(minScale, scale * 0.92);
        placed = applyAt(flat, scale);
    }
    if (!fitsInside(placed, ctx.outline, TEXT_BOTTOM_INSET_MM)) throw textDoesNotFit();

    for (const p of placed.centroids) {
        const uPt = (p.x - ctx.minX) / Math.max(1e-3, ctx.maxX - ctx.minX);
        if (uPt < TEXT_U.bottom.min - 0.02 || uPt > TEXT_U.bottom.max + 0.02) {
            throw textForbiddenZone("outside midfoot-heel centreline band");
        }
    }
    const zTop = minLocalHeight(geo, placed.centroids);
    if (zTop - marking.depthMm + 1e-6 < 1.2) throw textTooThinRemaining();

    const mappedWidthMm = placed.advanceMm * scale;
    const centroids = placed.centroids.map((p) => ({ x: p.x, y: p.y, z: marking.depthMm }));
    return {
        flat: placed,
        map: planarBottomMap(-TEXT_BOOLEAN_EPS_MM, marking.depthMm),
        meta: { centroids, mappedWidthMm },
    };
}

function contiguousStationRuns(stations: WallStation[]): WallStation[][] {
    const sorted = stations.slice().sort((a, b) => a.s - b.s);
    const runs: WallStation[][] = [];
    let cur: WallStation[] = [];
    for (const st of sorted) {
        const prev = cur[cur.length - 1];
        // Only split on wrap-around (half a perimeter), not on sparse samples.
        if (prev && st.s - prev.s > 40) {
            if (cur.length >= 2) runs.push(cur);
            cur = [st];
        } else {
            cur.push(st);
        }
    }
    if (cur.length >= 2) runs.push(cur);
    return runs.length ? runs : [sorted];
}

export function placeWallText(
    ctx: HostTextContext,
    marking: TextMarking,
    flat: FlattenedText,
): { flat: FlattenedText; map: MapTextPoint; meta: Pick<TextApplyMeta, "centroids" | "mappedWidthMm"> } {
    const lateral = lateralStations(ctx);
    if (lateral.length < 2) throw textForbiddenZone("no lateral wall stations in the allowed u band");
    const u = Math.max(TEXT_U.wall.min, Math.min(TEXT_U.wall.max, marking.placementU));
    const runs = contiguousStationRuns(lateral);
    const spanOf = (r: WallStation[]) => r[r.length - 1]!.s - r[0]!.s;
    const hNeed = flat.capHeightMm + 2 * TEXT_WALL_EDGE_CLEARANCE_MM;
    const tallEnough = (st: WallStation) =>
        st.heightMm + 1e-6 >= hNeed + TEXT_TRIMLINE_RIM_BAND_MM - TEXT_WALL_EDGE_CLEARANCE_MM;
    const score = (r: WallStation[]) => {
        const ok = r.filter((st) => tallEnough(st) && st.thickMm + 1e-6 >= TEXT_WALL_MIN_THICK_MM);
        return ok.length ? spanOf(ok) : -1;
    };
    const nearU = runs.filter((r) => r.some((st) => Math.abs(st.u - u) < 0.12));
    const pool = nearU.length ? nearU : runs;
    const run = pool.reduce((best, r) => (score(r) > score(best) ? r : best), pool[0] ?? lateral);
    const atU = run.reduce((best, st) => (Math.abs(st.u - u) < Math.abs(best.u - u) ? st : best));
    const half = flat.advanceMm / 2;
    const sMin = run[0]!.s;
    const sMax = run[run.length - 1]!.s;
    const lo = sMin + half;
    const hi = sMax - half;
    let sMid = atU.s;
    if (sMid < lo) sMid = lo;
    if (sMid > hi) sMid = hi;
    if (lo > hi + 1e-3) {
        throw new TextMarkingError(
            "too-long",
            `text does not fit the placement zone (${flat.advanceMm.toFixed(1)} mm in ${(sMax - sMin).toFixed(1)} mm)`,
        );
    }
    const candidates = run.filter((st) => st.s + 1e-6 >= lo && st.s - 1e-6 <= hi && tallEnough(st));
    if (candidates.length) {
        sMid = candidates.reduce((best, st) =>
            Math.abs(st.s - atU.s) < Math.abs(best.s - atU.s) ? st : best,
        ).s;
    }
    const s0 = sMid - half;
    const s1 = sMid + half;
    const atMid = sampleAlong(run, sMid);
    if (!tallEnough(atMid)) {
        if (atMid.heightMm - 3 < TEXT_CAP.wall.min) {
            throw textForbiddenZone("wall height too short for cap plus 1.5 mm edge clearance");
        }
        throw textDoesNotFit();
    }
    const zMid = (atMid.B.z + atMid.R.z) / 2;
    const offset0 = marking.mode === "engrave" ? TEXT_BOOLEAN_EPS_MM : -TEXT_BOOLEAN_EPS_MM;
    const offset1 = marking.mode === "engrave" ? -marking.depthMm : marking.heightMm;
    const map: MapTextPoint = (p, t) => {
        const st = sampleAlong(run, s0 + p.x);
        if (st.thickMm + 1e-6 < TEXT_WALL_MIN_THICK_MM) {
            throw textForbiddenZone("wall thinner than 2 mm");
        }
        const frac = (zMid - st.B.z - flat.capHeightMm / 2 + p.y) / Math.max(1e-6, st.R.z - st.B.z);
        const clamped = Math.max(0.02, Math.min(0.98, frac));
        const x = st.B.x + (st.R.x - st.B.x) * clamped;
        const y = st.B.y + (st.R.y - st.B.y) * clamped;
        const z = st.B.z + (st.R.z - st.B.z) * clamped;
        const off = offset0 + (offset1 - offset0) * t;
        const nlen = Math.hypot(st.nOut.x, st.nOut.y, st.nOut.z) || 1;
        return {
            x: x + (st.nOut.x / nlen) * off,
            y: y + (st.nOut.y / nlen) * off,
            z: z + (st.nOut.z / nlen) * off,
        };
    };
    const centroids = flat.centroids.map((p) => map(p, 1));
    return { flat, map, meta: { centroids, mappedWidthMm: s1 - s0 } };
}

export function localWallHeightMm(ctx: HostTextContext, u: number): number {
    const lat = ctx.stations.filter((s) => s.sideSign < 0);
    if (!lat.length) return 0;
    const st = lat.reduce((best, s) => (Math.abs(s.u - u) < Math.abs(best.u - u) ? s : best));
    return st.heightMm;
}

export function localWallThicknessMm(ctx: HostTextContext, u: number): number {
    const lat = ctx.stations.filter((s) => s.sideSign < 0);
    if (!lat.length) return 99;
    const st = lat.reduce((best, s) => (Math.abs(s.u - u) < Math.abs(best.u - u) ? s : best));
    return st.thickMm;
}
