// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { EndType, FillRule, inflatePathsD, intersectD, JoinType, unionD } from "clipper2-ts";
import { buildContourPass } from "./contour";
import { bboxOf, offsetClosed, signedArea } from "./polygon";
import { toolRadiusMm } from "./profile";
import type { MillingProfile, Point } from "./types";

/** Pocket and table clearance the tool footprint must keep. */
export const ENVELOPE_CLEARANCE_MM = 1;

type Xy = { x: number; y: number };

const footprintCache = new Map<string, Point[]>();
const MAX_FOOTPRINT_CACHE = 8;

function dedupe(pts: Point[]): Xy[] {
    const out: Xy[] = [];
    for (const p of pts) {
        const q = out[out.length - 1];
        if (q && Math.hypot(p.x - q.x, p.y - q.y) < 1e-6) continue;
        out.push({ x: p.x, y: p.y });
    }
    if (out.length > 2) {
        const a = out[0]!;
        const b = out[out.length - 1]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) out.pop();
    }
    return out;
}

function toPoints(path: Xy[]): Point[] {
    return path.map((p) => ({ x: p.x, y: p.y }));
}

function largest(paths: Xy[][]): Point[] {
    let best: Xy[] = [];
    let bestA = -1;
    for (const path of paths) {
        const a = Math.abs(signedArea(path));
        if (a > bestA) {
            bestA = a;
            best = path;
        }
    }
    return toPoints(best);
}

function inflateOpen(pts: Point[], delta: number, chord: number): Point[][] {
    const path = dedupe(pts);
    if (path.length < 2 || delta <= 0) return [];
    const paths = inflatePathsD([path], delta, JoinType.Round, EndType.Round, 2, 3, chord);
    return paths.filter((p) => p.length >= 3).map((p) => toPoints(p));
}

function unionOuter(polys: Point[][]): Point[] {
    const paths = polys.map((poly) => dedupe(poly)).filter((p) => p.length >= 3);
    if (paths.length === 0) return [];
    if (paths.length === 1) return toPoints(paths[0]!);
    const merged = unionD(paths, FillRule.NonZero);
    return largest(merged);
}

function footprintKey(outline: Point[], profile: MillingProfile): string {
    let h = 2166136261;
    for (const p of outline) {
        h ^= Math.round(p.x * 1000);
        h = Math.imul(h, 16777619);
        h ^= Math.round(p.y * 1000);
        h = Math.imul(h, 16777619);
    }
    return [
        outline.length,
        h >>> 0,
        profile.strategy,
        profile.topOffsetMm,
        profile.sampleMm,
        profile.chordTolMm,
        profile.contourEnabled ? 1 : 0,
        profile.contourCutter.diameterMm,
        profile.contourCutter.type,
        profile.toolpathCutter.diameterMm,
        profile.toolpathCutter.type,
    ].join("|");
}

/**
 * Union of disk(R) along cutting moves below the stock top.
 * Contour centreline, tangent lead-in, and lead-out use the contour radius.
 * The top pass stays inside the overrun ring offset by the top-tool radius,
 * so that ring's round offset is the top-pass footprint.
 */
export function toolFootprintLocal(outline: Point[], profile: MillingProfile): Point[] {
    if (outline.length < 3) return [];
    const key = footprintKey(outline, profile);
    const hit = footprintCache.get(key);
    if (hit) return hit;
    const chord = Math.max(0.02, profile.chordTolMm);
    const sweeps: Point[][] = [];
    const topR = toolRadiusMm(profile.toolpathCutter.diameterMm);
    const topRing = offsetClosed(outline, Math.max(0, profile.topOffsetMm), chord);
    if (topRing.length >= 3) {
        const topSweep = offsetClosed(topRing, topR, chord);
        if (topSweep.length >= 3) sweeps.push(topSweep);
    }
    if (profile.contourEnabled) {
        const contR = toolRadiusMm(profile.contourCutter.diameterMm);
        const pass = buildContourPass(outline, profile);
        const finish = pass.finish.length > 1 ? pass.finish.slice(0, -1) : pass.finish;
        const contourSweep = offsetClosed(finish, contR, chord);
        if (contourSweep.length >= 3) sweeps.push(contourSweep);
        sweeps.push(...inflateOpen(pass.leadIn, contR, chord));
        sweeps.push(...inflateOpen(pass.leadOut, contR, chord));
    }
    const outer = unionOuter(sweeps);
    footprintCache.set(key, outer);
    if (footprintCache.size > MAX_FOOTPRINT_CACHE) {
        const oldest = footprintCache.keys().next().value;
        if (oldest !== undefined) footprintCache.delete(oldest);
    }
    return outer;
}

export function footprintOverhangMm(
    outline: Point[],
    footprint: Point[],
    rotationDeg: number,
    cx: number,
    cy: number,
): { left: number; right: number; front: number; back: number } {
    const rot = (p: Point) => {
        const a = (rotationDeg * Math.PI) / 180;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const dx = p.x - cx;
        const dy = p.y - cy;
        return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
    };
    const o = bboxOf(outline.map(rot));
    const e = bboxOf(footprint.map(rot));
    return {
        left: o.minX - e.minX,
        right: e.maxX - o.maxX,
        front: o.minY - e.minY,
        back: e.maxY - o.maxY,
    };
}

export function polygonsOverlap(a: Point[], b: Point[]): boolean {
    if (a.length < 3 || b.length < 3) return false;
    const ba = bboxOf(a);
    const bb = bboxOf(b);
    if (ba.maxX < bb.minX - 1e-6 || bb.maxX < ba.minX - 1e-6) return false;
    if (ba.maxY < bb.minY - 1e-6 || bb.maxY < ba.minY - 1e-6) return false;
    const inter = intersectSafe(a, b);
    return inter.some((path) => Math.abs(signedArea(path)) > 0.05);
}

function intersectSafe(a: Point[], b: Point[]): Xy[][] {
    return intersectD([dedupe(a)], [dedupe(b)], FillRule.NonZero);
}
