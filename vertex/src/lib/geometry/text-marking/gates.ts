// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { minDistToLoopXY, pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import type { PolyPoint } from "@/lib/geometry/procedural-wall/curves";
import { reconstructionManifold, windingReport } from "@/lib/geometry/procedural-wall/metrics";
import { binaryStlToGeometry, geometryToBinarySTL } from "@/lib/geometry/stl";
import { TEXT_BOOLEAN_EPS_MM, TEXT_HOST_SI_PAD_MM, TEXT_REMAINING_MIN_MM, TEXT_WELD_MM } from "./constants";
import { TextMarkingError, textTooThinRemaining } from "./errors";
import { countSoupSelfIntersections, type SoupHitPair } from "./soup-intersect";
import type { TextApplyMeta, TextSurface } from "./types";

const Z0_TOL = 0.08;

/** Opposite-edge winding on the index graph (not a 1e-4 position weld). */
/** Vertex indices stay below this so a*STRIDE+b does not collide. */
const INDEX_EDGE_STRIDE = 2_097_152;

function indexOppositeMismatch(geo: BufferGeometry): number {
    const index = geo.getIndex();
    if (!index) return 1;
    const src = index.array as ArrayLike<number>;
    let maxIndex = 0;
    for (let i = 0; i < src.length; i++) {
        const v = src[i] ?? 0;
        if (v > maxIndex) maxIndex = v;
    }
    if (maxIndex >= INDEX_EDGE_STRIDE) return indexOppositeMismatchStrings(geo);
    const dir = new Map<number, number>();
    const add = (a: number, b: number) => {
        const k = a * INDEX_EDGE_STRIDE + b;
        dir.set(k, (dir.get(k) ?? 0) + 1);
    };
    for (let t = 0; t + 2 < index.count; t += 3) {
        const a = src[t] ?? 0;
        const b = src[t + 1] ?? 0;
        const c = src[t + 2] ?? 0;
        add(a, b);
        add(b, c);
        add(c, a);
    }
    let mismatch = 0;
    const seen = new Set<number>();
    for (const key of dir.keys()) {
        const a = Math.floor(key / INDEX_EDGE_STRIDE);
        const b = key - a * INDEX_EDGE_STRIDE;
        const lo = a < b ? a : b;
        const hi = a < b ? b : a;
        const undirected = lo * INDEX_EDGE_STRIDE + hi;
        if (seen.has(undirected)) continue;
        seen.add(undirected);
        const fwd = dir.get(a * INDEX_EDGE_STRIDE + b) ?? 0;
        const rev = dir.get(b * INDEX_EDGE_STRIDE + a) ?? 0;
        if (fwd !== 1 || rev !== 1) mismatch++;
    }
    return mismatch;
}

function indexOppositeMismatchStrings(geo: BufferGeometry): number {
    const index = geo.getIndex();
    if (!index) return 1;
    const src = index.array as ArrayLike<number>;
    const dir = new Map<string, number>();
    const add = (a: number, b: number) => {
        const k = `${a}>${b}`;
        dir.set(k, (dir.get(k) ?? 0) + 1);
    };
    for (let t = 0; t + 2 < index.count; t += 3) {
        const a = src[t] ?? 0;
        const b = src[t + 1] ?? 0;
        const c = src[t + 2] ?? 0;
        add(a, b);
        add(b, c);
        add(c, a);
    }
    let mismatch = 0;
    const seen = new Set<string>();
    for (const key of dir.keys()) {
        const sep = key.indexOf(">");
        const a = key.slice(0, sep);
        const b = key.slice(sep + 1);
        const undirected = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(undirected)) continue;
        seen.add(undirected);
        const fwd = dir.get(`${a}>${b}`) ?? 0;
        const rev = dir.get(`${b}>${a}`) ?? 0;
        if (fwd !== 1 || rev !== 1) mismatch++;
    }
    return mismatch;
}

function analyzeManifoldByIndex(geo: BufferGeometry): {
    openEdges: number;
    nonManifoldEdges: number;
    isWatertight: boolean;
} {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    const idxOf = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    const edgeCount = new Map<string, number>();
    const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let t = 0; t < triCount; t++) {
        const a = idxOf(t, 0);
        const b = idxOf(t, 1);
        const c = idxOf(t, 2);
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const e = edgeKey(u, v);
            edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
        }
    }
    let openEdges = 0;
    let nonManifoldEdges = 0;
    for (const count of edgeCount.values()) {
        if (count === 1) openEdges++;
        else if (count > 2) nonManifoldEdges++;
    }
    return { openEdges, nonManifoldEdges, isWatertight: openEdges === 0 && nonManifoldEdges === 0 };
}

export interface TextGateReport {
    watertight: boolean;
    selfIntersections: number;
    gWind: boolean;
    gFace: boolean;
    gCol: boolean;
    gVol: boolean;
    remainingMinMm: number;
}

function columnQuality(geo: BufferGeometry): {
    nFaceFlips?: number;
    nColZFail?: number;
    nColQuadFail?: number;
} {
    return (
        (
            geo.userData as {
                columnQuality?: { nFaceFlips?: number; nColZFail?: number; nColQuadFail?: number };
            }
        ).columnQuality ?? {}
    );
}

function remainingAtCentroids(geo: BufferGeometry, meta: TextApplyMeta): number {
    const pos = geo.getAttribute("position").array as Float32Array;
    let min = Infinity;
    for (const c of meta.centroids) {
        let zTop = -Infinity;
        for (let i = 0; i < pos.length; i += 3) {
            const d = Math.hypot(pos[i]! - c.x, pos[i + 1]! - c.y);
            if (d < 3) zTop = Math.max(zTop, pos[i + 2]!);
        }
        if (meta.surface === "bottom") {
            min = Math.min(min, zTop - meta.depthMm);
        } else {
            min = Math.min(min, Number.isFinite(zTop) ? zTop : TEXT_REMAINING_MIN_MM + 0.01);
        }
    }
    return Number.isFinite(min) ? min : 0;
}

function assertBottomZ0OutsideRecess(
    geo: BufferGeometry,
    outline: PolyPoint[],
    centroids: TextApplyMeta["centroids"],
): void {
    const pos = geo.getAttribute("position").array as Float32Array;
    const cx = centroids.reduce((s, p) => s + p.x, 0) / Math.max(1, centroids.length);
    const cy = centroids.reduce((s, p) => s + p.y, 0) / Math.max(1, centroids.length);
    let recR = 8;
    for (const c of centroids) recR = Math.max(recR, Math.hypot(c.x - cx, c.y - cy) + 6);
    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!;
        const y = pos[i + 1]!;
        const z = pos[i + 2]!;
        if (z > 0.4) continue;
        if (!pointInPoly(x, y, outline)) continue;
        if (minDistToLoopXY(x, y, outline) < 0.4) continue;
        if (Math.hypot(x - cx, y - cy) < recR) continue;
        if (z < -TEXT_BOOLEAN_EPS_MM - 0.05 || Math.abs(z) > Z0_TOL) {
            throw new TextMarkingError(
                "z0",
                `bottom z=${z.toFixed(3)} outside the recess (must stay at z=0)`,
            );
        }
    }
}

/**
 * Bottom letters only cut the sole pocket. Count a hit when it is low enough
 * to meet that floor and it sits in the glyph footprint. Intersections above
 * the pocket are already on the host (a Morton's extension can cross itself
 * on the top) and must not drop the name. Wall text still checks the whole soup.
 */
function pairEntersBottomPocket(pair: SoupHitPair, meta: TextApplyMeta): boolean {
    const zHi = meta.depthMm + 0.35;
    let low = false;
    for (const v of pair.a) {
        if (v.z <= zHi) low = true;
    }
    for (const v of pair.b) {
        if (v.z <= zHi) low = true;
    }
    if (!low) return false;
    const glyphs = meta.outlineWorld ?? [];
    if (glyphs.length === 0) return true;
    const c = pair.centroid;
    for (const g of glyphs) {
        const outer = g.outer as PolyPoint[];
        if (outer.length < 3) continue;
        if (pointInPoly(c.x, c.y, outer) || minDistToLoopXY(c.x, c.y, outer) <= TEXT_HOST_SI_PAD_MM) {
            return true;
        }
    }
    return false;
}

/** Hard STL gates after the text boolean. Failures throw — no broken STL. */
export function assertTextPrintGates(
    geo: BufferGeometry,
    meta: TextApplyMeta,
    outline: PolyPoint[],
): TextGateReport {
    const man = reconstructionManifold(geo);
    const indexed = analyzeManifoldByIndex(geo);
    const watertight = indexed.isWatertight || man.watertight;
    if (!watertight) {
        throw new TextMarkingError(
            "stl-gate",
            `text boolean is not watertight (open=${man.openEdges} nm=${man.nonManifoldEdges} idxOpen=${indexed.openEdges} idxNm=${indexed.nonManifoldEdges})`,
        );
    }
    const stl = geometryToBinarySTL(geo);
    const soup = binaryStlToGeometry(stl);
    const si = countSoupSelfIntersections(soup, TEXT_WELD_MM);
    soup.dispose();
    const blamed =
        meta.surface === "bottom" ? si.pairs.filter((p) => pairEntersBottomPocket(p, meta)) : si.pairs;
    if (blamed.length > 0) {
        const sample = blamed.slice(0, 8).map((p) => ({
            triA: p.triA,
            triB: p.triB,
            c: p.centroid,
            a: p.a,
            b: p.b,
        }));
        throw new TextMarkingError(
            "stl-gate",
            `text boolean has ${blamed.length} self-intersections on the exported STL ` +
                `(pairs=${JSON.stringify(sample)})`,
        );
    }
    const wind = windingReport(geo);
    const indexMismatch = indexOppositeMismatch(geo);
    const gWind = indexMismatch === 0 && wind.signedVolume > 0;
    if (!gWind) {
        throw new TextMarkingError(
            "G-WIND",
            `G-WIND failed (mismatch=${indexMismatch} vol=${wind.signedVolume})`,
        );
    }
    const q = columnQuality(geo);
    const style = (geo.userData as { wallStyle?: string }).wallStyle ?? "straight";
    const nFace = q.nFaceFlips ?? 0;
    const colFail = (q.nColZFail ?? 0) + (q.nColQuadFail ?? 0);
    const gFace = nFace === 0 || style === "straight";
    const gCol = colFail === 0 || style === "straight";
    if (!gFace) throw new TextMarkingError("G-FACE", `G-FACE flips=${q.nFaceFlips}`);
    if (!gCol) throw new TextMarkingError("G-COL", `G-COL zFail=${q.nColZFail} quadFail=${q.nColQuadFail}`);
    const gVol = wind.signedVolume > 0;
    if (!gVol) throw new TextMarkingError("G-VOL", "G-VOL signed volume is not positive");

    if (meta.surface === "bottom") {
        assertBottomZ0OutsideRecess(geo, outline, meta.centroids);
    }
    const remaining = meta.mode === "engrave" ? remainingAtCentroids(geo, meta) : TEXT_REMAINING_MIN_MM + 1;
    if (meta.mode === "engrave" && remaining + 1e-6 < TEXT_REMAINING_MIN_MM) {
        throw textTooThinRemaining();
    }
    geo.userData = {
        ...geo.userData,
        winding: wind,
        textMarking: meta,
        textGates: {
            watertight: true,
            selfIntersections: blamed.length,
            gWind,
            gFace,
            gCol,
            gVol,
            remainingMinMm: remaining,
        },
    };
    return {
        watertight: true,
        selfIntersections: blamed.length,
        gWind,
        gFace,
        gCol,
        gVol,
        remainingMinMm: remaining,
    };
}

export type { TextSurface };
