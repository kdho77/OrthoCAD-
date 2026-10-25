// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { minDistToLoopXY, pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import type { PolyPoint } from "@/lib/geometry/procedural-wall/curves";
import type { Side } from "@/types";
import {
    TEXT_BOOLEAN_EPS_MM,
    TEXT_BOOLEAN_OUTSET_MM,
    TEXT_BOTTOM_INSET_MM,
    TEXT_CAP,
    TEXT_FILLET_DIHEDRAL_DEG,
    TEXT_NORMAL_SMOOTH_MM,
    TEXT_REMAINING_MIN_MM,
    TEXT_TRIMLINE_RIM_BAND_MM,
    TEXT_U,
    TEXT_WALL_EDGE_CLEARANCE_MM,
    TEXT_WALL_MIN_THICK_MM,
} from "./constants";
import { TextMarkingError, textDoesNotFit, textForbiddenZone, textTooThinRemaining } from "./errors";
import { type MapTextPoint, planarBottomMap } from "./solid";
import type { FlattenedText, TextApplyMeta, TextMarking, TextSurface, TextXy } from "./types";

export interface WallStation {
    u: number;
    s: number;
    R: { x: number; y: number; z: number };
    B: { x: number; y: number; z: number };
    heightMm: number;
    sideSign: number;
    nOut: { x: number; y: number; z: number };
    thickMm: number;
    /** Distance along nOut from the B–R chord to the actual outer wall. */
    outerMm: number;
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
        const bx = fr.R.x - B.x;
        const by = fr.R.y - B.y;
        const bz = fr.R.z - (B.z ?? fr.Bz ?? 0);
        // True wall normal at the hit: station tangent × B→R, signed outward.
        let nx = ty * bz - tz * by;
        let ny = tz * bx - tx * bz;
        let nz = tx * by - ty * bx;
        let nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-10) {
            nx = ty;
            ny = -tx;
            nz = 0;
            nl = Math.hypot(nx, ny) || 1;
        }
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
        const thickMm = Math.hypot(bx, by);
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
            outerMm: 0,
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

function contiguousStationRuns(stations: WallStation[], gapMm = 8): WallStation[][] {
    if (stations.length < 2) return [];
    const sorted = stations.slice().sort((a, b) => a.s - b.s);
    const runs: WallStation[][] = [];
    let cur: WallStation[] = [];
    for (const st of sorted) {
        const prev = cur[cur.length - 1];
        if (prev && st.s - prev.s > gapMm) {
            if (cur.length >= 2) runs.push(cur);
            cur = [st];
        } else {
            cur.push(st);
        }
    }
    if (cur.length >= 2) runs.push(cur);
    return runs.length ? runs : [sorted];
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

function lerpDir(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    t: number,
): { x: number; y: number; z: number } {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    const n = Math.hypot(x, y, z) || 1;
    return { x: x / n, y: y / n, z: z / n };
}

export function sampleAlong(stations: WallStation[], s: number): WallStation {
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
                nOut: lerpDir(a.nOut, b.nOut, t),
                thickMm: a.thickMm + (b.thickMm - a.thickMm) * t,
                outerMm: a.outerMm + (b.outerMm - a.outerMm) * t,
            };
        }
    }
    return last;
}

function stationsForSign(ctx: HostTextContext, sign: -1 | 1): WallStation[] {
    // Full Y-side of this anatomical face, wrap-rotated at the true 3D gap,
    // then clipped to the u 0.20–0.80 wall band. Glyph extents must never leave it.
    const onSign = (s: WallStation) => (sign < 0 ? s.sideSign < 0 : s.sideSign > 0);
    const low = ctx.stations.filter((st) => st.R.y < ctx.midY);
    const high = ctx.stations.filter((st) => st.R.y >= ctx.midY);
    const nLowLat = low.filter(onSign).length;
    const nHighLat = high.filter(onSign).length;
    const ySide = nLowLat >= nHighLat ? "low" : "high";
    const inOrder = (ySide === "low" ? low : high).filter(onSign);
    if (inOrder.length < 2) return [];
    let cut = 0;
    let maxGap = -1;
    for (let i = 0; i < inOrder.length; i++) {
        const a = inOrder[i]!;
        const b = inOrder[(i + 1) % inOrder.length]!;
        const gap = Math.hypot(b.R.x - a.R.x, b.R.y - a.R.y, b.R.z - a.R.z);
        if (gap > maxGap) {
            maxGap = gap;
            cut = (i + 1) % inOrder.length;
        }
    }
    const run = inOrder.slice(cut).concat(inOrder.slice(0, cut));
    let sRun = 0;
    const chained = run.map((st, i) => {
        if (i > 0) {
            const p = run[i - 1]!;
            sRun += Math.hypot(st.R.x - p.R.x, st.R.y - p.R.y, st.R.z - p.R.z);
        }
        return { ...st, s: sRun };
    });
    const banded = chained.filter((st) => st.u + 1e-9 >= TEXT_U.wall.min && st.u - 1e-9 <= TEXT_U.wall.max);
    const runs = contiguousStationRuns(banded);
    const chain = runs.reduce((best, r) => {
        const span = (x: WallStation[]) => x[x.length - 1]!.s - x[0]!.s;
        return !best.length || span(r) > span(best) ? r : best;
    }, [] as WallStation[]);
    if (chain.length < 2) return [];
    // Keep the mesh walk. Letter order is corrected in placeWallText so a
    // mirrored host does not reverse the string or flip the cutter.
    const ordered = chain;
    let s = 0;
    return ordered.map((st, i) => {
        if (i > 0) {
            const p = ordered[i - 1]!;
            s += Math.hypot(st.R.x - p.R.x, st.R.y - p.R.y, st.R.z - p.R.z);
        }
        return { ...st, s };
    });
}

/** Outer side (lateral). sideSign < 0 on both the right foot and the mirrored left foot. */
export function lateralStations(ctx: HostTextContext): WallStation[] {
    return stationsForSign(ctx, -1);
}

/** Inner side (medial). */
export function medialStations(ctx: HostTextContext): WallStation[] {
    return stationsForSign(ctx, 1);
}

export function stationsForSurface(ctx: HostTextContext, surface: TextSurface): WallStation[] {
    return surface === "medial" ? medialStations(ctx) : lateralStations(ctx);
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

/**
 * Ordered CCW boundary of the actual flat plantar (z≈0, |n·Z| high).
 * This is where the wall–plantar fillet starts. Uses |n·Z| so a mirrored
 * left foot (winding flipped then restored) still finds the same loop.
 */
export function flatBottomBoundaryLoop(geo: BufferGeometry): PolyPoint[] | null {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!pos || !index) return null;
    const src = index.array as ArrayLike<number>;
    const undirected = new Map<string, number>();
    const directed: Array<[number, number]> = [];
    const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let t = 0; t + 2 < index.count; t += 3) {
        const i0 = src[t] ?? 0;
        const i1 = src[t + 1] ?? 0;
        const i2 = src[t + 2] ?? 0;
        const ax = pos.getX(i0);
        const ay = pos.getY(i0);
        const az = pos.getZ(i0);
        const bx = pos.getX(i1);
        const by = pos.getY(i1);
        const bz = pos.getZ(i1);
        const cx = pos.getX(i2);
        const cy = pos.getY(i2);
        const cz = pos.getZ(i2);
        const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const z = (az + bz + cz) / 3;
        const nl = Math.hypot(nx, ny, nz) || 1;
        if (Math.abs(nz / nl) <= 0.85 || z >= 0.35) continue;
        // Orient the XY projection CCW so mirrored winding still traces the
        // interior on the left of each directed boundary edge.
        const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const u0 = i0;
        const u1 = area2 >= 0 ? i1 : i2;
        const u2 = area2 >= 0 ? i2 : i1;
        for (const [u, v] of [
            [u0, u1],
            [u1, u2],
            [u2, u0],
        ] as const) {
            const k = edgeKey(u, v);
            undirected.set(k, (undirected.get(k) ?? 0) + 1);
            directed.push([u, v]);
        }
    }
    const next = new Map<number, number[]>();
    for (const [u, v] of directed) {
        if ((undirected.get(edgeKey(u, v)) ?? 0) !== 1) continue;
        const list = next.get(u);
        if (list) list.push(v);
        else next.set(u, [v]);
    }
    if (next.size < 4) return null;
    const walk = (start: number): number[] => {
        const path: number[] = [start];
        const used = new Set<string>();
        let cur = start;
        for (let step = 0; step < next.size + 2; step++) {
            const cands = next.get(cur) ?? [];
            let nxt = -1;
            for (const v of cands) {
                const k = `${cur}>${v}`;
                if (used.has(k)) continue;
                nxt = v;
                break;
            }
            if (nxt < 0) break;
            used.add(`${cur}>${nxt}`);
            if (nxt === start) return path;
            path.push(nxt);
            cur = nxt;
        }
        return [];
    };
    let best: number[] = [];
    for (const start of next.keys()) {
        const path = walk(start);
        if (path.length > best.length) best = path;
        if (best.length >= next.size) break;
    }
    if (best.length < 4) return null;
    const loop: PolyPoint[] = best.map((i) => ({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) }));
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        area += a.x * b.y - b.x * a.y;
    }
    if (area < 0) loop.reverse();
    return loop;
}

/** Unsigned plane angle (0–90°). Flipped winding does not change the result. */
function planeAngleDeg(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
): number {
    const c = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    const d = (Math.acos(c) * 180) / Math.PI;
    return Math.min(d, 180 - d);
}

/**
 * Height along B→R of the top of the wall–plantar fillet: the highest sample
 * whose face still has dihedral-to-plantar below 10°.
 */
export function measureWallFilletTopMm(geo: BufferGeometry, st: WallStation): number {
    const h = Math.max(0, st.heightMm);
    const cap = h * 0.45;
    const ud = geo.userData as { filletRing?: Array<{ x: number; y: number; z: number }> };
    if (ud.filletRing?.length) {
        let best = Infinity;
        let rise = 0;
        for (const f of ud.filletRing) {
            const d = (f.x - st.B.x) ** 2 + (f.y - st.B.y) ** 2;
            if (d < best) {
                best = d;
                rise = f.z - st.B.z;
            }
        }
        // Nearest F is the end of the plantar fillet. Ignore a neighbour that
        // landed far from this station, and never let F climb into the top round.
        if (best <= 64) return Math.max(0, Math.min(cap, rise));
    }
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!pos || !index) return 0;
    const plantar = { x: 0, y: 0, z: 1 };
    const bx = st.B.x;
    const by = st.B.y;
    const bz = st.B.z;
    const rx = st.R.x - bx;
    const ry = st.R.y - by;
    const rz = st.R.z - bz;
    const hLen = Math.hypot(rx, ry, rz) || 1;
    let measured = 0;
    const src = index.array as ArrayLike<number>;
    for (let t = 0; t + 2 < index.count; t += 3) {
        const i0 = src[t] ?? 0;
        const i1 = src[t + 1] ?? 0;
        const i2 = src[t + 2] ?? 0;
        const ax = pos.getX(i0);
        const ay = pos.getY(i0);
        const az = pos.getZ(i0);
        const px = pos.getX(i1);
        const py = pos.getY(i1);
        const pz = pos.getZ(i1);
        const qx = pos.getX(i2);
        const qy = pos.getY(i2);
        const qz = pos.getZ(i2);
        const mx = (ax + px + qx) / 3;
        const my = (ay + py + qy) / 3;
        const mz = (az + pz + qz) / 3;
        const dx = mx - bx;
        const dy = my - by;
        const dz = mz - bz;
        const along = (dx * rx + dy * ry + dz * rz) / hLen;
        // Lower band only. The top round is also 10–80° from +Z and used to
        // be reported as the fillet, which made every station look too short.
        if (along < -1 || along > Math.min(hLen, cap) + 0.5) continue;
        const sideways = Math.hypot(
            dx - (rx / hLen) * along,
            dy - (ry / hLen) * along,
            dz - (rz / hLen) * along,
        );
        if (sideways > 4) continue;
        const nx = (py - ay) * (qz - az) - (pz - az) * (qy - ay);
        const ny = (pz - az) * (qx - ax) - (px - ax) * (qz - az);
        const nz = (px - ax) * (qy - ay) - (py - ay) * (qx - ax);
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-12) continue;
        const n = { x: nx / nl, y: ny / nl, z: nz / nl };
        const deg = planeAngleDeg(n, plantar);
        if (deg < TEXT_FILLET_DIHEDRAL_DEG || deg > 80) continue;
        if (along > measured) measured = along;
    }
    return Math.max(0, Math.min(cap, measured));
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
): {
    flat: FlattenedText;
    map: MapTextPoint;
    rebind?: (geo: BufferGeometry) => MapTextPoint;
    meta: Pick<TextApplyMeta, "centroids" | "mappedWidthMm" | "wallUMin" | "wallUMax">;
} {
    const u = Math.max(TEXT_U.bottom.min, Math.min(TEXT_U.bottom.max, marking.placementU));
    const cx = xAtU(ctx, u) + (marking.nudgeAlongMm ?? 0);
    // glyph placement is the same for both sides; text reads from below in the STL frame after any side mirroring.
    void side;
    const cy = centrelineYAtX(ctx.outline, cx, ctx.midY) + (marking.nudgeAcrossMm ?? 0);
    const local = { x: flat.advanceMm / 2, y: flat.capHeightMm / 2 };
    const applyAt = (src: FlattenedText, scale: number): FlattenedText => {
        const s = scale;
        const pivoted = transformGroups(src, (p) => ({
            x: (p.x - local.x) * s,
            y: (p.y - local.y) * s,
        }));
        const rotated = transformGroups(pivoted, (p) => rotateAbout(p, { x: 0, y: 0 }, marking.rotationDeg));
        const glyphPlaced = transformGroups(rotated, (p) => ({ x: -p.x, y: p.y }));
        return transformGroups(glyphPlaced, (p) => ({ x: p.x + cx, y: p.y + cy }));
    };

    let placed = applyAt(flat, 1);
    let scale = 1;
    // glyph placement is the same for both sides; text reads from below in the STL frame after any side mirroring.
    const minScale = TEXT_CAP.bottom.min / Math.max(flat.capHeightMm, 1e-3);
    const flatBound = flatBottomBoundaryLoop(geo);
    const fitsBoth = (src: FlattenedText) =>
        fitsInside(src, ctx.outline, TEXT_BOTTOM_INSET_MM) &&
        (!flatBound || fitsInside(src, flatBound, TEXT_BOTTOM_INSET_MM));
    while (!fitsBoth(placed) && scale > minScale + 1e-4) {
        scale = Math.max(minScale, scale * 0.92);
        placed = applyAt(flat, scale);
    }
    if (!fitsBoth(placed)) throw textDoesNotFit();

    for (const p of placed.centroids) {
        const uPt = (p.x - ctx.minX) / Math.max(1e-3, ctx.maxX - ctx.minX);
        if (uPt < TEXT_U.bottom.min - 0.02 || uPt > TEXT_U.bottom.max + 0.02) {
            throw textForbiddenZone("outside midfoot-heel centreline band");
        }
    }
    const mappedWidthMm = placed.advanceMm * scale;
    if (marking.mode === "emboss") {
        const proud = marking.heightMm;
        const centroids = placed.centroids.map((p) => ({ x: p.x, y: p.y, z: -proud }));
        return {
            flat: placed,
            map: planarBottomMap(TEXT_BOOLEAN_EPS_MM, -proud),
            meta: { centroids, mappedWidthMm },
        };
    }
    const zTop = minLocalHeight(geo, placed.centroids);
    if (zTop - marking.depthMm + 1e-6 < TEXT_REMAINING_MIN_MM) throw textTooThinRemaining();
    const centroids = placed.centroids.map((p) => ({ x: p.x, y: p.y, z: marking.depthMm }));
    return {
        flat: placed,
        map: planarBottomMap(-TEXT_BOOLEAN_EPS_MM, marking.depthMm),
        meta: { centroids, mappedWidthMm },
    };
}

export interface OuterWallHit {
    p: { x: number; y: number; z: number };
    n: { x: number; y: number; z: number };
    /** Unsmoothed triangle normal at the closest point. */
    nFace?: { x: number; y: number; z: number };
}

function cellKey(x: number, y: number, z: number): string {
    return `${Math.floor(x)}|${Math.floor(y)}|${Math.floor(z)}`;
}

/**
 * Closest point on the host outer wall, with normals smoothed over 1 mm.
 * Built from triangles whose face normal agrees with the local station nOut.
 */
export function createOuterWallSampler(
    geo: BufferGeometry,
    run: WallStation[],
): {
    at: (s: number, h: number) => OuterWallHit;
    closest: (probe: { x: number; y: number; z: number }) => OuterWallHit | null;
} {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    const idxOf = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    const wallPos: number[] = [];
    const faceN: Array<{ x: number; y: number; z: number }> = [];
    const faceC: Array<{ x: number; y: number; z: number }> = [];
    const grid = new Map<string, number[]>();
    const nearStation = (cx: number, cy: number, cz: number): WallStation | null => {
        let best: WallStation | null = null;
        let bestD = 36;
        for (const st of run) {
            const d =
                (st.R.x - cx) ** 2 +
                (st.R.y - cy) ** 2 +
                (st.R.z - cz) ** 2 +
                (st.B.x - cx) ** 2 +
                (st.B.y - cy) ** 2 +
                (st.B.z - cz) ** 2;
            if (d < bestD) {
                bestD = d;
                best = st;
            }
        }
        return best;
    };
    for (let t = 0; t < triCount; t++) {
        const i0 = idxOf(t, 0);
        const i1 = idxOf(t, 1);
        const i2 = idxOf(t, 2);
        const ax = pos.getX(i0);
        const ay = pos.getY(i0);
        const az = pos.getZ(i0);
        const bx = pos.getX(i1);
        const by = pos.getY(i1);
        const bz = pos.getZ(i1);
        const cx = pos.getX(i2);
        const cy = pos.getY(i2);
        const cz = pos.getZ(i2);
        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        let nx = aby * acz - abz * acy;
        let ny = abz * acx - abx * acz;
        let nz = abx * acy - aby * acx;
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-12) continue;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const mx = (ax + bx + cx) / 3;
        const my = (ay + by + cy) / 3;
        const mz = (az + bz + cz) / 3;
        const st = nearStation(mx, my, mz);
        if (!st) continue;
        if (nx * st.nOut.x + ny * st.nOut.y + nz * st.nOut.z < 0.35) continue;
        const h = Math.max(1e-6, st.R.z - st.B.z);
        const frac = Math.max(0, Math.min(1, (mz - st.B.z) / h));
        const qx = st.B.x + (st.R.x - st.B.x) * frac;
        const qy = st.B.y + (st.R.y - st.B.y) * frac;
        const qz = st.B.z + (st.R.z - st.B.z) * frac;
        const ox = mx - qx;
        const oy = my - qy;
        const oz = mz - qz;
        if (ox * st.nOut.x + oy * st.nOut.y + oz * st.nOut.z < -0.4) continue;
        const fi = faceN.length;
        faceN.push({ x: nx, y: ny, z: nz });
        faceC.push({ x: mx, y: my, z: mz });
        wallPos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
        const key = cellKey(mx, my, mz);
        const list = grid.get(key);
        if (list) list.push(fi);
        else grid.set(key, [fi]);
    }
    let bvh: MeshBVH | null = null;
    if (wallPos.length >= 9) {
        const wallGeo = new BufferGeometry();
        wallGeo.setAttribute("position", new BufferAttribute(new Float32Array(wallPos), 3));
        wallGeo.computeBoundingBox();
        bvh = new MeshBVH(wallGeo);
    }
    // The filtered wall BVH drops the outer flare (its normal leans off the
    // station normal), so a ray there hits an inner face and the cutter never
    // breaks the skin. Raycast the whole solid and keep the first hit from outside.
    const fullGeo = geo.clone();
    if (!fullGeo.getIndex()) {
        const n = fullGeo.getAttribute("position").count;
        const tri: number[] = [];
        for (let i = 0; i < n; i++) tri.push(i);
        fullGeo.setIndex(tri);
    }
    const fullBvh = new MeshBVH(fullGeo);
    const probe = new Vector3();
    const hitInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };
    const radius = TEXT_NORMAL_SMOOTH_MM;
    const sigma = radius * 0.45;
    const twoS2 = 2 * sigma * sigma;
    const smoothN = (px: number, py: number, pz: number, fallback: { x: number; y: number; z: number }) => {
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let wSum = 0;
        const ix0 = Math.floor(px - radius);
        const iy0 = Math.floor(py - radius);
        const iz0 = Math.floor(pz - radius);
        const ix1 = Math.floor(px + radius);
        const iy1 = Math.floor(py + radius);
        const iz1 = Math.floor(pz + radius);
        for (let ix = ix0; ix <= ix1; ix++) {
            for (let iy = iy0; iy <= iy1; iy++) {
                for (let iz = iz0; iz <= iz1; iz++) {
                    const list = grid.get(`${ix}|${iy}|${iz}`);
                    if (!list) continue;
                    for (const fi of list) {
                        const c = faceC[fi]!;
                        const d2 = (c.x - px) ** 2 + (c.y - py) ** 2 + (c.z - pz) ** 2;
                        if (d2 > radius * radius) continue;
                        const w = Math.exp(-d2 / twoS2);
                        const n = faceN[fi]!;
                        sx += n.x * w;
                        sy += n.y * w;
                        sz += n.z * w;
                        wSum += w;
                    }
                }
            }
        }
        if (wSum < 1e-9) return fallback;
        const nlen = Math.hypot(sx, sy, sz) || 1;
        return { x: sx / nlen, y: sy / nlen, z: sz / nlen };
    };
    const closest = (p: { x: number; y: number; z: number }): OuterWallHit | null => {
        if (!bvh) return null;
        probe.set(p.x, p.y, p.z);
        const hit = bvh.closestPointToPoint(probe, hitInfo, 0, 8);
        if (!hit) return null;
        const pt = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
        const fi = hit.faceIndex;
        const fb = faceN[fi] ?? { x: 0, y: 0, z: 1 };
        return { p: pt, n: smoothN(pt.x, pt.y, pt.z, fb), nFace: fb };
    };
    const ray = new Ray();
    const rayOrigin = new Vector3();
    const rayDir = new Vector3();
    const at = (s: number, h: number): OuterWallHit => {
        const st = sampleAlong(run, s);
        const hh = Math.max(1e-6, st.heightMm);
        const frac = Math.max(0, Math.min(1, h / hh));
        const nlen = Math.hypot(st.nOut.x, st.nOut.y, st.nOut.z) || 1;
        const nx = st.nOut.x / nlen;
        const ny = st.nOut.y / nlen;
        const nz = st.nOut.z / nlen;
        const cx = st.B.x + (st.R.x - st.B.x) * frac;
        const cy = st.B.y + (st.R.y - st.B.y) * frac;
        const cz = st.B.z + (st.R.z - st.B.z) * frac;
        const flipOut = (hit: OuterWallHit): OuterWallHit => {
            if (hit.n.x * nx + hit.n.y * ny + hit.n.z * nz < 0) {
                hit.n = { x: -hit.n.x, y: -hit.n.y, z: -hit.n.z };
            }
            if (hit.nFace && hit.nFace.x * nx + hit.nFace.y * ny + hit.nFace.z * nz < 0) {
                hit.nFace = { x: -hit.nFace.x, y: -hit.nFace.y, z: -hit.nFace.z };
            }
            return hit;
        };
        // Ray from well outside so the first hit is the outer wall, not a
        // closest-point inside the wall thickness (that left closed voids).
        if (fullBvh) {
            rayOrigin.set(cx + nx * 20, cy + ny * 20, cz + nz * 20);
            rayDir.set(-nx, -ny, -nz);
            ray.set(rayOrigin, rayDir);
            const hit = fullBvh.raycastFirst(ray, DoubleSide, 0, 40);
            if (hit?.point) {
                const fb = { x: nx, y: ny, z: nz };
                const pt = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
                return flipOut({
                    p: pt,
                    n: smoothN(pt.x, pt.y, pt.z, fb),
                    nFace: fb,
                });
            }
        }
        if (bvh) {
            rayOrigin.set(cx + nx * 12, cy + ny * 12, cz + nz * 12);
            rayDir.set(-nx, -ny, -nz);
            ray.set(rayOrigin, rayDir);
            const hit = bvh.raycastFirst(ray, DoubleSide, 0, 24);
            if (hit?.point) {
                const fb = faceN[hit.faceIndex] ?? { x: nx, y: ny, z: nz };
                const pt = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
                return flipOut({
                    p: pt,
                    n: smoothN(pt.x, pt.y, pt.z, fb),
                    nFace: fb,
                });
            }
        }
        const fallback =
            closest({ x: cx + nx * 3, y: cy + ny * 3, z: cz + nz * 3 }) ?? closest({ x: cx, y: cy, z: cz });
        if (fallback) return flipOut(fallback);
        return {
            p: {
                x: cx + nx * (st.outerMm ?? 0),
                y: cy + ny * (st.outerMm ?? 0),
                z: cz + nz * (st.outerMm ?? 0),
            },
            n: { x: nx, y: ny, z: nz },
        };
    };
    const alongOut = (
        p: { x: number; y: number; z: number },
        n: { x: number; y: number; z: number },
    ): number | null => {
        const nlen = Math.hypot(n.x, n.y, n.z) || 1;
        const nx = n.x / nlen;
        const ny = n.y / nlen;
        const nz = n.z / nlen;
        // Start 0.05 mm deeper so a point already on the skin does not self-hit.
        const inset = 0.05;
        rayOrigin.set(p.x - nx * inset, p.y - ny * inset, p.z - nz * inset);
        rayDir.set(nx, ny, nz);
        ray.set(rayOrigin, rayDir);
        const hit = fullBvh?.raycastFirst(ray, DoubleSide, 0, 8);
        if (!hit) return null;
        return hit.distance - inset;
    };
    return { at, closest, alongOut };
}

function windowStats(run: WallStation[], sMid: number, half: number): { minH: number; minT: number } {
    let minH = Infinity;
    let minT = Infinity;
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
        const st = sampleAlong(run, sMid - half + (i / steps) * 2 * half);
        minH = Math.min(minH, st.heightMm);
        minT = Math.min(minT, st.thickMm);
    }
    return { minH, minT };
}

/** Shift each glyph so the string runs toward higher u, without mirroring strokes. */
function glyphsTowardHigherU(flat: FlattenedText, run: WallStation[]): FlattenedText {
    if (run.length < 2 || run[0]!.u + 1e-6 >= run[run.length - 1]!.u) return flat;
    const adv = flat.advanceMm;
    const shiftOf = (outer: TextXy[]): number => {
        let a = Infinity;
        let b = -Infinity;
        for (const p of outer) {
            if (p.x < a) a = p.x;
            if (p.x > b) b = p.x;
        }
        return adv - a - b;
    };
    const groups = flat.groups.map((g) => {
        const shift = shiftOf(g.outer);
        const map = (p: TextXy) => ({ x: p.x + shift, y: p.y });
        return { outer: g.outer.map(map), holes: g.holes.map((h) => h.map(map)) };
    });
    const centroids = flat.centroids.map((p, i) => {
        const g = flat.groups[i];
        return g ? { x: p.x + shiftOf(g.outer), y: p.y } : p;
    });
    return { ...flat, groups, centroids };
}

export function placeWallText(
    geo: BufferGeometry,
    ctx: HostTextContext,
    marking: TextMarking,
    flatIn: FlattenedText,
): {
    flat: FlattenedText;
    rebind: (geo: BufferGeometry) => MapTextPoint;
    map: MapTextPoint;
    meta: Pick<TextApplyMeta, "centroids" | "mappedWidthMm" | "wallUMin" | "wallUMax">;
} {
    const run = stationsForSurface(ctx, marking.surface);
    if (run.length < 2) throw textForbiddenZone("no lateral wall stations");
    const flat = glyphsTowardHigherU(flatIn, run);
    const u = Math.max(TEXT_U.wall.min, Math.min(TEXT_U.wall.max, marking.placementU));
    const sStart = run[0]!.s;
    const sEnd = run[run.length - 1]!.s;
    const avail = sEnd - sStart;
    const half = flat.advanceMm / 2;
    if (avail + 1e-3 < flat.advanceMm) {
        throw new TextMarkingError(
            "too-long",
            `text does not fit the placement zone (${flat.advanceMm.toFixed(1)} mm in ${avail.toFixed(1)} mm)`,
        );
    }
    const lo = sStart + half;
    const hi = sEnd - half;
    const filletCache = new Map<number, number>();
    const filletOf = (st: WallStation): number => {
        const key = Math.round(st.s * 20);
        let v = filletCache.get(key);
        if (v == null) {
            v = measureWallFilletTopMm(geo, st);
            filletCache.set(key, v);
        }
        return v;
    };
    const windowUsable = (sMid: number): number => {
        let minUsable = Infinity;
        const a = sMid - half;
        const b = sMid + half;
        for (let i = 0; i <= 8; i++) {
            const st = sampleAlong(run, a + ((b - a) * i) / 8);
            const room = st.heightMm - filletOf(st) - TEXT_WALL_EDGE_CLEARANCE_MM - TEXT_TRIMLINE_RIM_BAND_MM;
            if (room < minUsable) minUsable = room;
        }
        return minUsable;
    };
    const atU = run.reduce((best, st) => (Math.abs(st.u - u) < Math.abs(best.u - u) ? st : best));
    const requested = Math.max(lo, Math.min(hi, atU.s + (marking.nudgeAlongMm ?? 0)));
    let bestS = requested;
    let best = windowStats(run, requested, half);
    let bestUsable = windowUsable(requested);
    const scan = 48;
    for (let i = 0; i <= scan; i++) {
        const sMid = lo + ((hi - lo) * i) / Math.max(1, scan);
        const sc = windowStats(run, sMid, half);
        const usable = windowUsable(sMid);
        const thickOk = sc.minT + 1e-6 >= TEXT_WALL_MIN_THICK_MM;
        const bestThickOk = best.minT + 1e-6 >= TEXT_WALL_MIN_THICK_MM;
        const fits = thickOk && usable + 1e-6 >= flat.capHeightMm;
        const bestFits = bestThickOk && bestUsable + 1e-6 >= flat.capHeightMm;
        const closer = Math.abs(sMid - requested) < Math.abs(bestS - requested);
        const take =
            (fits && !bestFits) ||
            (fits && bestFits && closer) ||
            (!fits &&
                !bestFits &&
                thickOk &&
                (usable > bestUsable + 0.25 || (Math.abs(usable - bestUsable) <= 0.25 && closer)));
        if (take) {
            bestS = sMid;
            best = sc;
            bestUsable = usable;
        }
    }
    if (best.minT + 1e-6 < TEXT_WALL_MIN_THICK_MM) {
        throw textForbiddenZone("wall thinner than 2 mm");
    }
    if (marking.mode === "engrave" && best.minT - marking.depthMm + 1e-6 < TEXT_REMAINING_MIN_MM) {
        throw textTooThinRemaining();
    }
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const g of flat.groups) {
        for (const p of g.outer) {
            if (p.y < yMin) yMin = p.y;
            if (p.y > yMax) yMax = p.y;
        }
    }
    const ySpan = Math.max(1e-3, yMax - yMin);
    const sMid = bestS;
    const s0 = sMid - half;
    const s1 = sMid + half;
    let minUsableH = Infinity;
    for (let i = 0; i <= 16; i++) {
        const st = sampleAlong(run, s0 + ((s1 - s0) * i) / 16);
        const usable = st.heightMm - filletOf(st) - TEXT_WALL_EDGE_CLEARANCE_MM - TEXT_TRIMLINE_RIM_BAND_MM;
        if (usable < minUsableH) minUsableH = usable;
    }
    if (minUsableH + 1e-6 < flat.capHeightMm) {
        throw textForbiddenZone("wall height too short above the plantar fillet plus 1.0 mm edge clearance");
    }
    const offset0 = marking.mode === "engrave" ? -marking.depthMm : -TEXT_BOOLEAN_OUTSET_MM;
    const offset1 = marking.mode === "engrave" ? TEXT_BOOLEAN_OUTSET_MM : marking.heightMm;
    const heightOf = (p: TextXy, st: WallStation): number => {
        const h = Math.max(1e-6, st.R.z - st.B.z);
        const usableBot = filletOf(st) + TEXT_WALL_EDGE_CLEARANCE_MM;
        const usableTop = Math.max(usableBot + 0.5, h - TEXT_TRIMLINE_RIM_BAND_MM);
        const usable = Math.max(1e-3, usableTop - usableBot);
        const yScale = Math.min(1, usable / ySpan);
        const slack = Math.max(0, usable - ySpan * yScale);
        const nudge = Math.max(-slack / 2, Math.min(slack / 2, marking.nudgeAcrossMm ?? 0));
        const letter0 = usableBot + slack / 2 + nudge;
        return letter0 + (p.y - yMin) * yScale;
    };
    const makeMap = (mesh: BufferGeometry): MapTextPoint => {
        const wall = createOuterWallSampler(mesh, run);
        const surfCache = new Map<string, OuterWallHit>();
        return (p, t) => {
            const st = sampleAlong(run, s0 + p.x);
            if (st.u < TEXT_U.wall.min - 1e-6 || st.u > TEXT_U.wall.max + 1e-6) {
                throw textForbiddenZone("glyph extent left the wall u band");
            }
            if (st.thickMm + 1e-6 < TEXT_WALL_MIN_THICK_MM) {
                throw textForbiddenZone("wall thinner than 2 mm");
            }
            const key = `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
            let hit = surfCache.get(key);
            if (!hit) {
                hit = wall.at(s0 + p.x, heightOf(p, st));
                surfCache.set(key, hit);
            }
            const off = offset0 + (offset1 - offset0) * t;
            // Uniform 0.5 mm outset of the outer cap along the smoothed normal.
            const n0 = hit.n;
            const nlen = Math.hypot(n0.x, n0.y, n0.z) || 1;
            return {
                x: hit.p.x + (n0.x / nlen) * off,
                y: hit.p.y + (n0.y / nlen) * off,
                z: hit.p.z + (n0.z / nlen) * off,
            };
        };
    };
    const map = makeMap(geo);
    const uOf = (x: number) => sampleAlong(run, s0 + x).u;
    let wallUMin = Math.min(uOf(0), uOf(flat.advanceMm));
    let wallUMax = Math.max(uOf(0), uOf(flat.advanceMm));
    for (const g of flat.groups) {
        for (const p of g.outer) {
            const uu = uOf(p.x);
            if (uu < wallUMin) wallUMin = uu;
            if (uu > wallUMax) wallUMax = uu;
        }
    }
    if (wallUMin < TEXT_U.wall.min - 1e-6 || wallUMax > TEXT_U.wall.max + 1e-6) {
        throw textForbiddenZone("glyph extent left the wall u band");
    }
    const wallN = createOuterWallSampler(geo, run);
    const centroids = flat.centroids.map((p) => {
        const st = sampleAlong(run, s0 + p.x);
        const hit = wallN.at(s0 + p.x, heightOf(p, st));
        let nx = hit.n.x;
        let ny = hit.n.y;
        let nz = hit.n.z;
        const nlen = Math.hypot(nx, ny, nz) || 1;
        nx /= nlen;
        ny /= nlen;
        nz /= nlen;
        if (nx * st.nOut.x + ny * st.nOut.y + nz * st.nOut.z < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
        }
        return {
            x: hit.p.x,
            y: hit.p.y,
            z: hit.p.z,
            nOut: { x: nx, y: ny, z: nz },
            u: st.u,
        };
    });
    return {
        flat,
        map,
        rebind: makeMap,
        meta: { centroids, mappedWidthMm: s1 - s0, wallUMin, wallUMax },
    };
}

/** Tallest station on this side inside the wall band. Availability uses this, not the toe. */
export function bandWallHeightMm(ctx: HostTextContext, surface: TextSurface): number {
    if (!isSideSurface(surface)) return 0;
    const run = stationsForSurface(ctx, surface);
    let max = 0;
    for (const st of run) if (st.heightMm > max) max = st.heightMm;
    return max;
}

function isSideSurface(surface: TextSurface): boolean {
    return surface === "wall" || surface === "medial";
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

export interface TextGuideStation {
    u: number;
    s: number;
    x: number;
    y: number;
    z: number;
    bx: number;
    by: number;
    bz: number;
    h: number;
    fillet: number;
    thick: number;
}

export interface TextGuide {
    minX: number;
    maxX: number;
    midY: number;
    lateral: TextGuideStation[];
    medial: TextGuideStation[];
    outline: Array<{ x: number; y: number }>;
}

/** Compact placement frame for the viewer guide. Plain data so it survives the worker. */
export function buildTextGuide(geo: BufferGeometry): TextGuide {
    const ctx = extractHostTextContext(geo);
    const pack = (which: "lateral" | "medial"): TextGuideStation[] => {
        const run = which === "lateral" ? lateralStations(ctx) : medialStations(ctx);
        if (run.length < 2) return [];
        const step = Math.max(1, Math.floor(run.length / 32));
        const picked = run.filter((_, i) => i % step === 0 || i === run.length - 1);
        return picked.map((st) => ({
            u: st.u,
            s: st.s,
            x: st.R.x,
            y: st.R.y,
            z: st.R.z,
            bx: st.B.x,
            by: st.B.y,
            bz: st.B.z,
            h: st.heightMm,
            fillet: measureWallFilletTopMm(geo, st),
            thick: st.thickMm,
        }));
    };
    const step = Math.max(1, Math.floor(ctx.outline.length / 80));
    return {
        minX: ctx.minX,
        maxX: ctx.maxX,
        midY: ctx.midY,
        lateral: pack("lateral"),
        medial: pack("medial"),
        outline: ctx.outline.filter((_, i) => i % step === 0).map((p) => ({ x: p.x, y: p.y })),
    };
}
