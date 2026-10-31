// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { MortonsMode, MortonsSide, Side } from "@/types";

/**
 * Morton's extension / reverse Morton's — top surface only.
 *
 * u is the fraction of insole length from the heel. v is the fraction of the
 * local outline width at that u, measured from the medial edge. On the stock
 * pair the left foot is the authored mesh (medial = local Y−) and the right
 * foot is that mesh mirrored (medial = local Y+). {@link medialSign} is that
 * mesh-Y sign.
 *
 * The full-height region is the first ray: lateral border at v = 0.40 from the
 * toe back to u = 0.63, proximal border a shallow arc through (0.62, 0.20)
 * with an 8 mm fillet at the (0.63, 0.40) corner. Kendon's taper: 3 mm C1
 * smoothstep centered on the lateral border (so it sits between met 1 and met
 * 2) and 3 mm outside the proximal border. No taper on the medial or toe edges.
 *
 * Absent / inactive specs are not evaluated. Callers must skip the call so an
 * insole with Morton's off stays byte-identical.
 */

export const MORTONS_LATERAL_V = 0.4;
export const MORTONS_PROXIMAL_U = 0.63;
/** Shallow proximal arc reaches this u at v = 0.20. */
export const MORTONS_ARC_DIP_U = 0.62;
export const MORTONS_ARC_DIP_V = 0.2;
export const MORTONS_FILLET_RADIUS_MM = 8;
/** Centered on v = 0.40. Half sits on met 1, half on met 2. */
export const MORTONS_LATERAL_TAPER_MM = 3;
/** Outside the proximal border only. */
export const MORTONS_PROXIMAL_TAPER_MM = 3;
export const MORTONS_THICKNESS_BLEND_MM = 10;
export const MORTONS_MIN_MATERIAL_MM = 0.5;

export const MORTONS_EXTENSION_DEFAULT_MM = 3;
export const MORTONS_EXTENSION_WARN_MM = 5;
export const MORTONS_EXTENSION_MAX_MM = 6;
export const MORTONS_REVERSE_DEFAULT_MM = 2.5;
export const MORTONS_REVERSE_WARN_MM = 3;
export const MORTONS_REVERSE_MAX_MM = 4;

export interface MortonsSampleContext {
    side: Side;
    lengthMm: number;
    widthMm: number;
    mortons: MortonsSide;
    /** Full local outline width at u, mm. spec v = 0..1 spans this. */
    widthMmAt: (u: number) => number;
}

export interface MortonsQuery {
    /** 1 inside the full-height region, 0 outside the taper. */
    weight: number;
    /** 1 on the region plus its taper, 0 after the 10 mm thickness blend. */
    thicknessMask: number;
    /** Positive inside the filleted border. */
    signedMm: number;
}

/** Quadratic through (v=0, u=0.63), (v=0.20, u=0.62), (v=0.40, u=0.63). */
export function mortonsProximalBorderU(v: number): number {
    const vv = Math.max(0, Math.min(MORTONS_LATERAL_V, v));
    return MORTONS_PROXIMAL_U - 0.25 * vv * (MORTONS_LATERAL_V - vv);
}

export function mortonsActive(spec?: MortonsSide | null): boolean {
    if (!spec) return false;
    if (spec.mode !== "extension" && spec.mode !== "reverse") return false;
    return Number.isFinite(spec.amountMm) && spec.amountMm > 0;
}

export function mortonsMaxMm(mode: MortonsMode): number {
    return mode === "extension" ? MORTONS_EXTENSION_MAX_MM : MORTONS_REVERSE_MAX_MM;
}

export function mortonsWarnMm(mode: MortonsMode): number {
    return mode === "extension" ? MORTONS_EXTENSION_WARN_MM : MORTONS_REVERSE_WARN_MM;
}

export function mortonsDefaultMm(mode: MortonsMode): number {
    return mode === "extension" ? MORTONS_EXTENSION_DEFAULT_MM : MORTONS_REVERSE_DEFAULT_MM;
}

export function clampMortonsAmount(mode: MortonsMode, amountMm: number): number {
    if (!Number.isFinite(amountMm) || amountMm <= 0) return 0;
    return Math.min(mortonsMaxMm(mode), amountMm);
}

export function mortonsAmountWarning(mode: MortonsMode, amountMm: number): string | null {
    if (!Number.isFinite(amountMm) || amountMm <= mortonsWarnMm(mode)) return null;
    const max = mortonsMaxMm(mode);
    if (amountMm > max) {
        return `Above max ${max} mm — applied at ${max.toFixed(1)} mm.`;
    }
    return mode === "extension"
        ? "Above 5 mm — confirm before manufacture. Maximum is 6 mm."
        : "Above 3 mm — confirm before manufacture. Maximum is 4 mm.";
}

/**
 * Shell thickness under the reverse-Morton's region.
 * Floor is depth + 0.5 mm (3.0 at 2.5, 3.5 at 3.0). A thicker surrounding
 * shell is left alone. `mask` is 1 on the region plus taper and falls to 0
 * across the 10 mm blend.
 */
export function mortonsLocalBaseThicknessMm(depthMm: number, surroundingMm: number, mask: number): number {
    const floor = depthMm + MORTONS_MIN_MATERIAL_MM;
    const target = Math.max(surroundingMm, floor);
    const m = mask <= 0 ? 0 : mask >= 1 ? 1 : mask;
    return surroundingMm + (target - surroundingMm) * m;
}

/**
 * Mesh-Y sign of the medial (first-ray) edge on the stock pair.
 * Left medial is local Y−; mirrored right medial is local Y+.
 * Same factor the height field uses to turn vSigned into a medial-positive
 * coordinate (`m = -(vSigned * medialSign)`). Name matches the helper
 * docs/HANDEDNESS.md will export so the two can be unified.
 */
export function medialSign(foot: Side): 1 | -1 {
    return foot === "left" ? -1 : 1;
}

/** spec v (0 medial → 1 lateral) from a height-field vSigned. Matches sink.ts. */
export function mortonsSpecV(vSigned: number, side: Side): number {
    const sign = medialSign(side);
    const m = -(vSigned * sign);
    return (1 - m) / 2;
}

export function mortonsVSigned(specV: number, side: Side): number {
    return medialSign(side) * (2 * specV - 1);
}

/**
 * Insole-mesh point for a spec sample. x is mm from the heel; y is centered
 * width, with {@link medialSign} pointing at the first ray.
 */
export function mortonsMeshPoint(
    u: number,
    specV: number,
    ctx: MortonsSampleContext,
): { x: number; y: number } {
    const uu = Math.max(0, Math.min(1, u));
    const vv = Math.max(0, Math.min(1, specV));
    const width = Math.max(1, ctx.widthMm);
    // spec v 0 is the medial bbox edge. vSigned on the mesh is normalized to
    // that bbox, so the overlay uses the same edge the height field raises.
    return { x: uu * ctx.lengthMm, y: medialSign(ctx.side) * (0.5 - vv) * width };
}

function smoothstep01(t: number): number {
    const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
    return x * x * (3 - 2 * x);
}

interface Pt {
    x: number;
    y: number;
}

type BorderKind = "proximal" | "fillet" | "lateral";

interface Seg {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    nx: number;
    ny: number;
    kind: BorderKind;
    t0: number;
    t1: number;
}

interface Boundary {
    segs: Seg[];
    filletRadiusMm: number;
}

const boundaryCache = new Map<string, Boundary>();

function cacheKey(ctx: MortonsSampleContext): string {
    const us = [0.63, 0.75, 0.9, 1];
    let w = "";
    for (const u of us) w += `${ctx.widthMmAt(u).toFixed(3)},`;
    return `${ctx.lengthMm.toFixed(3)}|${ctx.widthMm.toFixed(3)}|${w}`;
}

function uvToXY(u: number, v: number, ctx: MortonsSampleContext): Pt {
    const uu = Math.max(0, Math.min(1, u));
    return { x: uu * ctx.lengthMm, y: v * ctx.widthMmAt(uu) };
}

function dist(a: Pt, b: Pt): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function trimBeforeCorner(pts: Pt[], corner: Pt, tangentDist: number): Pt[] {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const da = dist(a, corner);
        const db = dist(b, corner);
        if (db >= tangentDist - 1e-4) {
            out.push(a);
            continue;
        }
        const denom = da - db;
        const t = denom > 1e-9 ? (da - tangentDist) / denom : 0;
        const tc = Math.max(0, Math.min(1, t));
        out.push(a);
        out.push({ x: a.x + (b.x - a.x) * tc, y: a.y + (b.y - a.y) * tc });
        return out;
    }
    out.push(pts[pts.length - 1]!);
    return out;
}

function trimAfterCorner(pts: Pt[], corner: Pt, tangentDist: number): Pt[] {
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const da = dist(a, corner);
        const db = dist(b, corner);
        if (db < tangentDist) continue;
        const denom = db - da;
        const t = denom > 1e-9 ? (tangentDist - da) / denom : 0;
        const tc = Math.max(0, Math.min(1, t));
        const start = { x: a.x + (b.x - a.x) * tc, y: a.y + (b.y - a.y) * tc };
        return [start, ...pts.slice(i + 1)];
    }
    return pts.slice();
}

function arcPoints(center: Pt, from: Pt, to: Pt, radius: number, n: number): Pt[] {
    const a0 = Math.atan2(from.y - center.y, from.x - center.x);
    const a1 = Math.atan2(to.y - center.y, to.x - center.x);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
        const a = a0 + (sweep * i) / n;
        pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
    }
    return pts;
}

function buildBoundary(ctx: MortonsSampleContext): Boundary {
    const key = cacheKey(ctx);
    const hit = boundaryCache.get(key);
    if (hit) return hit;

    const prox: Pt[] = [];
    const proxN = 36;
    for (let i = 0; i <= proxN; i++) {
        const v = (MORTONS_LATERAL_V * i) / proxN;
        prox.push(uvToXY(mortonsProximalBorderU(v), v, ctx));
    }
    const lat: Pt[] = [];
    const latN = 48;
    for (let i = 0; i <= latN; i++) {
        const u = MORTONS_PROXIMAL_U + ((1 - MORTONS_PROXIMAL_U) * i) / latN;
        lat.push(uvToXY(u, MORTONS_LATERAL_V, ctx));
    }
    const corner = lat[0]!;
    const dProxRaw = { x: prox[prox.length - 2]!.x - corner.x, y: prox[prox.length - 2]!.y - corner.y };
    const dLatRaw = { x: lat[1]!.x - corner.x, y: lat[1]!.y - corner.y };
    const lp = Math.hypot(dProxRaw.x, dProxRaw.y) || 1;
    const ll = Math.hypot(dLatRaw.x, dLatRaw.y) || 1;
    const dProx = { x: dProxRaw.x / lp, y: dProxRaw.y / lp };
    const dLat = { x: dLatRaw.x / ll, y: dLatRaw.y / ll };
    const cos = Math.max(-1, Math.min(1, dProx.x * dLat.x + dProx.y * dLat.y));
    const theta = Math.acos(cos);
    const radius = MORTONS_FILLET_RADIUS_MM;
    const tangentDist = radius / Math.tan(theta / 2);
    const bisLen = Math.hypot(dProx.x + dLat.x, dProx.y + dLat.y) || 1;
    const bis = { x: (dProx.x + dLat.x) / bisLen, y: (dProx.y + dLat.y) / bisLen };
    const centerDist = radius / Math.sin(theta / 2);
    const center = { x: corner.x + bis.x * centerDist, y: corner.y + bis.y * centerDist };
    const tanProx = { x: corner.x + dProx.x * tangentDist, y: corner.y + dProx.y * tangentDist };
    const tanLat = { x: corner.x + dLat.x * tangentDist, y: corner.y + dLat.y * tangentDist };

    const proxTrim = trimBeforeCorner(prox, corner, tangentDist);
    if (proxTrim.length) proxTrim[proxTrim.length - 1] = tanProx;
    const latTrim = trimAfterCorner(lat, corner, tangentDist);
    if (latTrim.length) latTrim[0] = tanLat;
    const arc = arcPoints(center, tanProx, tanLat, radius, 10);

    interface Tagged extends Pt {
        kind: BorderKind;
        filletT: number;
        nx: number;
        ny: number;
    }
    const tagged: Tagged[] = [];
    const push = (p: Pt, kind: BorderKind, filletT: number, nx = 0, ny = 0) => {
        const prev = tagged[tagged.length - 1];
        if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 0.05) return;
        tagged.push({ ...p, kind, filletT, nx, ny });
    };
    for (const p of proxTrim) push(p, "proximal", 0);
    for (let i = 1; i < arc.length - 1; i++) {
        const p = arc[i]!;
        const inward = { x: center.x - p.x, y: center.y - p.y };
        const il = Math.hypot(inward.x, inward.y) || 1;
        push(p, "fillet", i / (arc.length - 1), inward.x / il, inward.y / il);
    }
    for (const p of latTrim) push(p, "lateral", 1);

    const segs: Seg[] = [];
    for (let i = 0; i < tagged.length - 1; i++) {
        const a = tagged[i]!;
        const b = tagged[i + 1]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.05) continue;
        let nx = dy / len;
        let ny = -dx / len;
        if (a.kind === "fillet" && b.kind === "fillet") {
            nx = a.nx + b.nx;
            ny = a.ny + b.ny;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl;
            ny /= nl;
        }
        segs.push({
            ax: a.x,
            ay: a.y,
            bx: b.x,
            by: b.y,
            nx,
            ny,
            kind: a.kind === b.kind ? a.kind : "fillet",
            t0: a.filletT,
            t1: b.filletT,
        });
    }

    const inside = uvToXY(0.85, 0.15, ctx);
    if (closest(inside, segs).signed < 0) {
        for (const s of segs) {
            s.nx = -s.nx;
            s.ny = -s.ny;
        }
    }

    const boundary: Boundary = { segs, filletRadiusMm: radius };
    if (boundaryCache.size > 24) boundaryCache.clear();
    boundaryCache.set(key, boundary);
    return boundary;
}

function closest(p: Pt, segs: Seg[]): { signed: number; kind: BorderKind; filletT: number } {
    let best = Number.POSITIVE_INFINITY;
    let signed = 0;
    let kind: BorderKind = "lateral";
    let filletT = 1;
    for (const s of segs) {
        const abx = s.bx - s.ax;
        const aby = s.by - s.ay;
        const len2 = abx * abx + aby * aby || 1;
        let t = ((p.x - s.ax) * abx + (p.y - s.ay) * aby) / len2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const cx = s.ax + abx * t;
        const cy = s.ay + aby * t;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.hypot(dx, dy);
        if (d < best) {
            best = d;
            const sideDot = dx * s.nx + dy * s.ny;
            signed = sideDot >= 0 ? d : -d;
            kind = s.kind;
            filletT = s.t0 + (s.t1 - s.t0) * t;
        }
    }
    return { signed, kind, filletT };
}

function outerEdgeMm(kind: BorderKind, filletT: number): number {
    const lat = MORTONS_LATERAL_TAPER_MM / 2;
    const prox = MORTONS_PROXIMAL_TAPER_MM;
    if (kind === "lateral") return lat;
    if (kind === "proximal") return prox;
    const t = smoothstep01(filletT);
    return prox * (1 - t) + lat * t;
}

function borderWeight(signed: number, kind: BorderKind, filletT: number): number {
    const lat = smoothstep01((signed + MORTONS_LATERAL_TAPER_MM / 2) / MORTONS_LATERAL_TAPER_MM);
    const prox =
        signed >= 0 ? 1 : smoothstep01((signed + MORTONS_PROXIMAL_TAPER_MM) / MORTONS_PROXIMAL_TAPER_MM);
    if (kind === "lateral") return lat;
    if (kind === "proximal") return prox;
    const t = smoothstep01(filletT);
    return prox * (1 - t) + lat * t;
}

function thicknessMaskAt(signed: number, kind: BorderKind, filletT: number): number {
    const outer = outerEdgeMm(kind, filletT);
    if (signed >= -outer) return 1;
    const beyond = -signed - outer;
    if (beyond >= MORTONS_THICKNESS_BLEND_MM) return 0;
    return 1 - smoothstep01(beyond / MORTONS_THICKNESS_BLEND_MM);
}

/** Weight, thickness mask, and signed distance at a height-field sample. */
export function mortonsQuery(u: number, vSigned: number, ctx: MortonsSampleContext): MortonsQuery {
    if (!mortonsActive(ctx.mortons)) return { weight: 0, thicknessMask: 0, signedMm: 0 };
    const specV = mortonsSpecV(vSigned, ctx.side);
    const reach = MORTONS_PROXIMAL_TAPER_MM + MORTONS_THICKNESS_BLEND_MM + MORTONS_FILLET_RADIUS_MM + 4;
    if (u * ctx.lengthMm < MORTONS_ARC_DIP_U * ctx.lengthMm - reach) {
        return { weight: 0, thicknessMask: 0, signedMm: -reach };
    }
    const wAt = Math.max(1, ctx.widthMmAt(Math.min(1, Math.max(0, u))));
    if (specV > MORTONS_LATERAL_V + reach / wAt) {
        return { weight: 0, thicknessMask: 0, signedMm: -reach };
    }
    const boundary = buildBoundary(ctx);
    const p = uvToXY(u, specV, ctx);
    const hit = closest(p, boundary.segs);
    return {
        weight: borderWeight(hit.signed, hit.kind, hit.filletT),
        thicknessMask: thicknessMaskAt(hit.signed, hit.kind, hit.filletT),
        signedMm: hit.signed,
    };
}

/** Distance from the fillet center to a tangent point. 8 mm when the fillet is built. */
export function mortonsFilletRadiusMm(ctx: MortonsSampleContext): number {
    return buildBoundary(ctx).filletRadiusMm;
}

/**
 * Closed outline of the full raised/lowered region, including the fillet and
 * the 3 mm taper, in insole mesh millimetres (same frame as {@link mortonsMeshPoint}).
 * The ring runs the outer taper, crosses the toe, and returns along the medial edge.
 */
export function mortonsRegionOutlineMm(ctx: MortonsSampleContext): { x: number; y: number }[] {
    const boundary = buildBoundary(ctx);
    const outer: { u: number; specV: number }[] = [];
    const push = (u: number, specV: number) => {
        const prev = outer[outer.length - 1];
        if (prev && Math.abs(prev.u - u) < 1e-4 && Math.abs(prev.specV - specV) < 1e-4) return;
        outer.push({ u, specV });
    };
    for (const s of boundary.segs) {
        const steps = s.kind === "fillet" ? 4 : 3;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = s.ax + (s.bx - s.ax) * t;
            const y = s.ay + (s.by - s.ay) * t;
            const reach = outerEdgeMm(s.kind, s.t0 + (s.t1 - s.t0) * t);
            const ox = x - s.nx * reach;
            const oy = y - s.ny * reach;
            const u = ox / Math.max(1, ctx.lengthMm);
            const w = Math.max(1, ctx.widthMmAt(Math.min(1, Math.max(0, u))));
            push(u, oy / w);
        }
    }
    if (outer.length < 3) return [];
    const start = outer[0]!;
    const end = outer[outer.length - 1]!;
    const medialSpec = (_u: number) => 0;
    for (let i = 1; i <= 8; i++) {
        const specV = end.specV + (medialSpec(end.u) - end.specV) * (i / 8);
        push(end.u, specV);
    }
    const back = 18;
    for (let i = 1; i <= back; i++) {
        const u = end.u + (start.u - end.u) * (i / back);
        push(u, medialSpec(u));
    }
    return outer.map((p) => mortonsMeshPoint(p.u, p.specV, ctx));
}

/**
 * Pull an outline ring inside the foot. `spanAt(u)` is the local width range
 * (mesh Y) at that station. Points outside the silhouette clamp onto it.
 */
export function clipMortonsOutline(
    pts: { x: number; y: number }[],
    lengthMm: number,
    spanAt: (u: number) => { lo: number; hi: number } | null,
): { x: number; y: number }[] {
    const length = Math.max(1, lengthMm);
    return pts.map((p) => {
        const span = spanAt(Math.max(0, Math.min(1, p.x / length)));
        if (!span || !(span.hi > span.lo)) return p;
        const y = p.y < span.lo ? span.lo : p.y > span.hi ? span.hi : p.y;
        return { x: p.x, y };
    });
}

/**
 * Top-surface delta (mm). Extension is positive. Reverse is the thickness
 * floor minus the cut, so the shell under the region is at least depth + 0.5 mm
 * and the first ray is lowered by `depth` where the weight is 1.
 * Returns 0 when Morton's is inactive — callers should skip the call entirely.
 */
export function mortonsTopDeltaAt(
    u: number,
    vSigned: number,
    ctx: MortonsSampleContext,
    baseThicknessMm: number,
): number {
    if (!mortonsActive(ctx.mortons)) return 0;
    const amount = clampMortonsAmount(ctx.mortons.mode, ctx.mortons.amountMm);
    if (!(amount > 0)) return 0;
    const q = mortonsQuery(u, vSigned, ctx);
    if (ctx.mortons.mode === "extension") return amount * q.weight;
    const local = mortonsLocalBaseThicknessMm(amount, baseThicknessMm, q.thicknessMask);
    const boost = local - baseThicknessMm;
    return boost - amount * q.weight;
}

/** Reverse-Morton's cut depth at a sample (0 for extension or off). */
export function mortonsCutMm(u: number, vSigned: number, ctx: MortonsSampleContext): number {
    if (!mortonsActive(ctx.mortons) || ctx.mortons.mode !== "reverse") return 0;
    const amount = clampMortonsAmount("reverse", ctx.mortons.amountMm);
    if (!(amount > 0)) return 0;
    return amount * mortonsQuery(u, vSigned, ctx).weight;
}

/**
 * Extra sink cut after reverse Morton's is already on the top.
 * The deeper of the two wins. Passing 0 overlap returns `sinkCutMm` unchanged.
 */
export function sinkCutAfterMortons(sinkCutMm: number, mortonsCutMmValue: number): number {
    if (!(mortonsCutMmValue > 0)) return sinkCutMm;
    return Math.max(0, sinkCutMm - mortonsCutMmValue);
}
