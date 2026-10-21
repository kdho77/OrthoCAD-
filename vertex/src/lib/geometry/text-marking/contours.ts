// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { booleanOpD, ClipType, EndType, FillRule, inflatePathsD, isPositiveD, JoinType } from "clipper2-ts";
import type { Font } from "opentype.js";
import { pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import { polygonSignedArea } from "@/lib/geometry/procedural-wall/curves";
import {
    TEXT_BOLD_OFFSET_MM,
    TEXT_CLIPPER_PRECISION,
    TEXT_CONTOUR_EDGE_MAX_MM,
    TEXT_CONTOUR_EDGE_MIN_MM,
    TEXT_FEATURE_CORNER_DEG,
    TEXT_FLATTEN_CHORD_MM,
    TEXT_MAX_CHARS,
    TEXT_MIN_LETTER_SPACING_MM,
    TEXT_MIN_LOOP_AREA_MM2,
    TEXT_MIN_STROKE_MM,
    TEXT_OUTLINE_SEG_MAX_MM,
    TEXT_OUTLINE_SEG_MIN_MM,
    TEXT_OUTLINE_TURN_DEG,
} from "./constants";
import { TextMarkingError, textTooLong, textTooThin } from "./errors";
import { capHeightFontSize } from "./font";
import type { FlattenedText, TextContour, TextGlyphGroup, TextXy } from "./types";

type OtCommand =
    | { type: "M"; x: number; y: number }
    | { type: "L"; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "Z" };

function dist(a: TextXy, b: TextXy): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a: TextXy, b: TextXy, t: number): TextXy {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function flattenCubic(p0: TextXy, p1: TextXy, p2: TextXy, p3: TextXy, tol: number, out: TextXy[]): void {
    const mid = lerp(lerp(p1, p2, 0.5), lerp(lerp(p0, p1, 0.5), lerp(p2, p3, 0.5), 0.5), 0.5);
    const chord = lerp(p0, p3, 0.5);
    if (dist(mid, chord) <= tol || dist(p0, p3) <= tol) {
        out.push(p3);
        return;
    }
    const p01 = lerp(p0, p1, 0.5);
    const p12 = lerp(p1, p2, 0.5);
    const p23 = lerp(p2, p3, 0.5);
    const p012 = lerp(p01, p12, 0.5);
    const p123 = lerp(p12, p23, 0.5);
    const p0123 = lerp(p012, p123, 0.5);
    flattenCubic(p0, p01, p012, p0123, tol, out);
    flattenCubic(p0123, p123, p23, p3, tol, out);
}

function flattenQuad(p0: TextXy, p1: TextXy, p2: TextXy, tol: number, out: TextXy[]): void {
    const mid = lerp(lerp(p0, p1, 0.5), lerp(p1, p2, 0.5), 0.5);
    const chord = lerp(p0, p2, 0.5);
    if (dist(mid, chord) <= tol || dist(p0, p2) <= tol) {
        out.push(p2);
        return;
    }
    const p01 = lerp(p0, p1, 0.5);
    const p12 = lerp(p1, p2, 0.5);
    const p012 = lerp(p01, p12, 0.5);
    flattenQuad(p0, p01, p012, tol, out);
    flattenQuad(p012, p12, p2, tol, out);
}

function closeContour(pts: TextXy[]): TextXy[] {
    if (pts.length < 3) return [];
    const out: TextXy[] = [];
    for (const p of pts) {
        const prev = out[out.length - 1];
        if (prev && dist(prev, p) < 1e-6) continue;
        out.push(p);
    }
    if (out.length >= 2 && dist(out[0]!, out[out.length - 1]!) < 1e-6) out.pop();
    return out.length >= 3 ? out : [];
}

function flattenPath(commands: OtCommand[], chordMm: number): TextXy[][] {
    const contours: TextXy[][] = [];
    let cur: TextXy[] = [];
    let start: TextXy = { x: 0, y: 0 };
    let last: TextXy = { x: 0, y: 0 };
    const push = (p: TextXy) => {
        last = p;
        cur.push(p);
    };
    for (const cmd of commands) {
        if (cmd.type === "M") {
            const closed = closeContour(cur);
            if (closed.length) contours.push(closed);
            cur = [];
            start = { x: cmd.x, y: -cmd.y };
            push(start);
        } else if (cmd.type === "L") {
            push({ x: cmd.x, y: -cmd.y });
        } else if (cmd.type === "C") {
            flattenCubic(
                last,
                { x: cmd.x1, y: -cmd.y1 },
                { x: cmd.x2, y: -cmd.y2 },
                { x: cmd.x, y: -cmd.y },
                chordMm,
                cur,
            );
            last = { x: cmd.x, y: -cmd.y };
        } else if (cmd.type === "Q") {
            flattenQuad(last, { x: cmd.x1, y: -cmd.y1 }, { x: cmd.x, y: -cmd.y }, chordMm, cur);
            last = { x: cmd.x, y: -cmd.y };
        } else if (cmd.type === "Z") {
            push(start);
            const closed = closeContour(cur);
            if (closed.length) contours.push(closed);
            cur = [];
        }
    }
    const tail = closeContour(cur);
    if (tail.length) contours.push(tail);
    return contours;
}

function pathArea(path: Array<{ x: number; y: number }>): number {
    let s = 0;
    for (let i = 0; i < path.length; i++) {
        const a = path[i]!;
        const b = path[(i + 1) % path.length]!;
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

function toPathD(pts: TextXy[]): Array<{ x: number; y: number }> {
    return pts.map((p) => ({ x: p.x, y: p.y }));
}

function fromPathD(path: Array<{ x: number; y: number }>): TextXy[] {
    return path.map((p) => ({ x: p.x, y: p.y }));
}

function clipperUnionOrient(contours: TextXy[][]): TextContour[] {
    if (!contours.length) return [];
    const subject = contours.map((c) => toPathD(c));
    const paths = booleanOpD(ClipType.Union, subject, null, FillRule.NonZero, TEXT_CLIPPER_PRECISION);
    const out: TextContour[] = [];
    for (const path of paths) {
        if (path.length < 3) continue;
        const area = Math.abs(pathArea(path));
        if (area < TEXT_MIN_LOOP_AREA_MM2) continue;
        const pts = fromPathD(path);
        const positive = isPositiveD(path);
        const oriented = positive ? pts : pts.slice().reverse();
        out.push({ points: oriented, hole: !positive });
    }
    return out;
}

function inflateContours(contours: TextContour[], deltaMm: number): TextContour[] {
    if (!contours.length) return [];
    const paths = inflatePathsD(
        contours.map((c) => toPathD(c.points)),
        deltaMm,
        JoinType.Round,
        EndType.Polygon,
        2,
        TEXT_CLIPPER_PRECISION,
    );
    return clipperUnionOrient(paths.map(fromPathD));
}

function distToSeg(p: TextXy, a: TextXy, b: TextXy): number {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 1e-18 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
    return Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t));
}

/**
 * Closed-loop resample: drop collinear verts (chord ≤ flatten), then keep
 * edges in [0.03, 0.15] mm. Corners with a real turning angle stay.
 */
export function resampleClosedLoop(
    pts: TextXy[],
    chordMm = TEXT_FLATTEN_CHORD_MM,
    minE = TEXT_CONTOUR_EDGE_MIN_MM,
    maxE = TEXT_CONTOUR_EDGE_MAX_MM,
): TextXy[] {
    if (pts.length < 3) return pts.slice();
    const src = pts.slice();
    if (dist(src[0]!, src[src.length - 1]!) < 1e-9) src.pop();
    if (src.length < 3) return src;
    const turningOk = (a: TextXy, b: TextXy, c: TextXy): boolean => {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const bcx = c.x - b.x;
        const bcy = c.y - b.y;
        const lab = Math.hypot(abx, aby);
        const lbc = Math.hypot(bcx, bcy);
        if (lab < 1e-12 || lbc < 1e-12) return true;
        const cross = abx * bcy - aby * bcx;
        const ang = Math.atan2(Math.abs(cross), abx * bcx + aby * bcy);
        return ang < (8 * Math.PI) / 180;
    };
    let loop = src;
    for (let pass = 0; pass < 8; pass++) {
        const next: TextXy[] = [];
        const n = loop.length;
        let dropped = 0;
        for (let i = 0; i < n; i++) {
            const a = loop[(i - 1 + n) % n]!;
            const b = loop[i]!;
            const c = loop[(i + 1) % n]!;
            const ac = dist(a, c);
            if (
                ac + 1e-9 >= minE &&
                ac - 1e-9 <= maxE &&
                distToSeg(b, a, c) <= chordMm &&
                turningOk(a, b, c)
            ) {
                dropped++;
                continue;
            }
            next.push(b);
        }
        if (next.length < 3) break;
        loop = next;
        if (!dropped) break;
    }
    const densify = (src: TextXy[]): TextXy[] => {
        const out: TextXy[] = [];
        for (let i = 0; i < src.length; i++) {
            const a = src[i]!;
            const b = src[(i + 1) % src.length]!;
            out.push(a);
            const len = dist(a, b);
            if (len <= maxE + 1e-9) continue;
            const steps = Math.max(2, Math.ceil(len / maxE));
            for (let k = 1; k < steps; k++) out.push(lerp(a, b, k / steps));
        }
        return out;
    };
    loop = densify(loop);
    for (let pass = 0; pass < 8; pass++) {
        const next: TextXy[] = [];
        const n = loop.length;
        let dropped = 0;
        for (let i = 0; i < n; i++) {
            const a = loop[(i - 1 + n) % n]!;
            const b = loop[i]!;
            const ab = dist(a, b);
            if (ab < minE) {
                dropped++;
                continue;
            }
            next.push(b);
        }
        if (next.length < 3) break;
        loop = next;
        if (!dropped) break;
    }
    return densify(loop);
}

function dedupeClosed(pts: TextXy[]): TextXy[] {
    const src = pts.slice();
    if (src.length >= 2 && dist(src[0]!, src[src.length - 1]!) < 1e-9) src.pop();
    const out: TextXy[] = [];
    for (const p of src) {
        const prev = out[out.length - 1];
        if (prev && dist(prev, p) < 1e-7) continue;
        out.push(p);
    }
    if (out.length >= 2 && dist(out[0]!, out[out.length - 1]!) < 1e-7) out.pop();
    return out;
}

function densifyToMax(pts: TextXy[], maxLen: number): TextXy[] {
    const out: TextXy[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % n]!;
        out.push(a);
        const len = dist(a, b);
        if (len <= maxLen + 1e-9) continue;
        const steps = Math.ceil(len / maxLen);
        for (let k = 1; k < steps; k++) out.push(lerp(a, b, k / steps));
    }
    return out;
}

/** Absolute turning angle at `i` (radians). */
function turnAt(src: TextXy[], i: number): number {
    const n = src.length;
    const a = src[(i - 1 + n) % n]!;
    const b = src[i]!;
    const c = src[(i + 1) % n]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const lab = Math.hypot(abx, aby);
    const lbc = Math.hypot(bcx, bcy);
    if (lab < 1e-12 || lbc < 1e-12) return 0;
    return Math.abs(Math.atan2(abx * bcy - aby * bcx, abx * bcx + aby * bcy));
}

export interface AdaptiveLoop {
    points: TextXy[];
    /** Parallel to `points`. True on glyph corners (turning > 30°). */
    feature: boolean[];
}

/**
 * Adaptive closed-loop resample for the cutter. Each output segment turns at
 * most 8° and is at most 0.6 mm. Length aims for 0.3–0.6 mm; a tighter curve
 * keeps a shorter segment so the turn limit holds. Vertices with turning
 * above 30° are copied exactly and tagged as features.
 */
export function resampleGlyphAdaptive(pts: TextXy[]): AdaptiveLoop {
    const minLen = TEXT_OUTLINE_SEG_MIN_MM;
    const maxLen = TEXT_OUTLINE_SEG_MAX_MM;
    const dense = densifyToMax(dedupeClosed(pts), maxLen);
    const n = dense.length;
    if (n < 3) return { points: dense.slice(), feature: dense.map(() => false) };
    const feat = new Array<boolean>(n);
    const featRad = (TEXT_FEATURE_CORNER_DEG * Math.PI) / 180;
    for (let i = 0; i < n; i++) feat[i] = turnAt(dense, i) > featRad + 1e-6;
    const maxTurn = (TEXT_OUTLINE_TURN_DEG * Math.PI) / 180;
    // minLen is the target floor. The turn cap wins, so a tight curve may be shorter.
    const outP: TextXy[] = [dense[0]!];
    const outF: boolean[] = [feat[0]!];
    let i = 0;
    let prevUx = 0;
    let prevUy = 0;
    let hasPrev = false;
    for (let guard = 0; guard < n + 2; guard++) {
        let j = i;
        let headX = 0;
        let headY = 0;
        let haveHead = false;
        let best = -1;
        let finish = false;
        while (j !== i || best < 0) {
            const next = (j + 1) % n;
            const closing = next === 0;
            const a = dense[j]!;
            const b = dense[next]!;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const step = Math.hypot(dx, dy);
            if (step < 1e-9) {
                if (closing) {
                    finish = true;
                    break;
                }
                j = next;
                if (j === i) break;
                continue;
            }
            const ux = dx / step;
            const uy = dy / step;
            if (!haveHead) {
                headX = ux;
                headY = uy;
                haveHead = true;
            }
            const align = Math.max(-1, Math.min(1, headX * ux + headY * uy));
            const dang = Math.acos(align);
            const cx = b.x - dense[i]!.x;
            const cy = b.y - dense[i]!.y;
            const clen = Math.hypot(cx, cy);
            let prevAng = 0;
            if (hasPrev && !feat[i] && clen > 1e-9) {
                const cux = cx / clen;
                const cuy = cy / clen;
                const pa = Math.max(-1, Math.min(1, prevUx * cux + prevUy * cuy));
                prevAng = Math.acos(pa);
            }
            const turnBad = dang > maxTurn + 1e-4 || prevAng > maxTurn + 1e-4;
            // Turn cap wins over minLen: a step that already bends too far is still emitted
            // when nothing shorter exists. Once a legal sample exists, keep that sample.
            const turnStops = turnBad && (best < 0 || clen + 1e-9 >= minLen || best >= 0);
            const lenBad = clen > maxLen + 1e-6;
            if (closing) {
                if ((!turnStops && !lenBad) || best < 0) finish = true;
                break;
            }
            if (turnStops || lenBad) {
                if (best < 0) best = next;
                break;
            }
            j = next;
            best = j;
            if (feat[next] || j === 0) break;
        }
        if (finish || best <= 0) break;
        const end = dense[best]!;
        const dx = end.x - dense[i]!.x;
        const dy = end.y - dense[i]!.y;
        const len = Math.hypot(dx, dy) || 1;
        prevUx = dx / len;
        prevUy = dy / len;
        hasPrev = true;
        outP.push(end);
        outF.push(!!feat[best]);
        if (best === i) break;
        i = best;
    }
    return { points: outP, feature: outF };
}

/** Cutter / Hausdorff outline. Does not replace flatten's 0.03–0.15 mm resample. */
export function resampleGroupsAdaptive(groups: TextGlyphGroup[]): TextGlyphGroup[] {
    return groups.map((g) => ({
        outer: resampleGlyphAdaptive(g.outer).points,
        holes: g.holes.map((h) => resampleGlyphAdaptive(h).points).filter((h) => h.length >= 3),
    }));
}

function resampleGroup(g: TextGlyphGroup): TextGlyphGroup {
    return {
        outer: resampleClosedLoop(g.outer),
        holes: g.holes.map((h) => resampleClosedLoop(h)).filter((h) => h.length >= 3),
    };
}

function outerCount(contours: TextContour[]): number {
    return contours.filter((c) => !c.hole).length;
}

/** Full stroke width (mm). Binary search of the offset that collapses an outer. */
export function measureStrokeMm(contours: TextContour[]): number {
    const outers = outerCount(contours);
    if (!outers) return 0;
    const holds = (half: number) => outerCount(inflateContours(contours, -half)) >= outers;
    if (!holds(0.05)) return 0;
    let lo = 0.05;
    let hi = 3;
    for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (holds(mid)) lo = mid;
        else hi = mid;
    }
    return lo * 2;
}

function minStrokeMm(contours: TextContour[]): number {
    if (!contours.length) return 0;
    const outers = outerCount(contours);
    if (!outers) return 0;
    const half = TEXT_MIN_STROKE_MM / 2;
    const shrunk = inflateContours(contours, -half);
    if (outerCount(shrunk) < outers) return 0;
    return TEXT_MIN_STROKE_MM;
}

function groupHoles(contours: TextContour[]): TextGlyphGroup[] {
    const outers = contours.filter((c) => !c.hole);
    const holes = contours.filter((c) => c.hole);
    const groups: TextGlyphGroup[] = outers.map((o) => ({ outer: o.points, holes: [] }));
    for (const hole of holes) {
        const test = hole.points[0]!;
        let best = -1;
        let bestArea = Infinity;
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i]!;
            const poly = g.outer.map((p) => ({ x: p.x, y: p.y, z: 0 }));
            if (!pointInPoly(test.x, test.y, poly)) continue;
            const area = Math.abs(polygonSignedArea(poly));
            if (area < bestArea) {
                bestArea = area;
                best = i;
            }
        }
        if (best >= 0) groups[best]!.holes.push(hole.points);
    }
    return groups.filter((g) => g.outer.length >= 3);
}

function inGlyphGroup(x: number, y: number, g: TextGlyphGroup): boolean {
    const outer = g.outer.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    if (!pointInPoly(x, y, outer)) return false;
    for (const hole of g.holes) {
        if (
            hole.length >= 3 &&
            pointInPoly(
                x,
                y,
                hole.map((p) => ({ x: p.x, y: p.y, z: 0 })),
            )
        ) {
            return false;
        }
    }
    return true;
}

/** A point on the solid, not in a counter (O / 0 / D hole). */
function interiorPoint(g: TextGlyphGroup): TextXy {
    let cx = 0;
    let cy = 0;
    for (const p of g.outer) {
        cx += p.x;
        cy += p.y;
    }
    const n = Math.max(1, g.outer.length);
    cx /= n;
    cy /= n;
    if (inGlyphGroup(cx, cy, g)) return { x: cx, y: cy };
    for (let i = 0; i < g.outer.length; i++) {
        const a = g.outer[i]!;
        const b = g.outer[(i + 1) % g.outer.length]!;
        const mx = (a.x + b.x) * 0.5;
        const my = (a.y + b.y) * 0.5;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const el = Math.hypot(ex, ey) || 1;
        const nx = -ey / el;
        const ny = ex / el;
        for (const s of [1, -1]) {
            for (const d of [0.25, 0.45, 0.7, 1.1]) {
                const x = mx + nx * s * d;
                const y = my + ny * s * d;
                if (inGlyphGroup(x, y, g)) return { x, y };
            }
        }
    }
    return { x: cx, y: cy };
}

function centroidsOf(groups: TextGlyphGroup[]): TextXy[] {
    return groups.map(interiorPoint);
}

export function flattenText(
    font: Font,
    text: string,
    capHeightMm: number,
    letterSpacingMm: number,
    bold: boolean,
    allowThin = false,
): FlattenedText {
    if (text.length > TEXT_MAX_CHARS) throw textTooLong();
    if (!text.trim()) {
        return {
            groups: [],
            advanceMm: 0,
            capHeightMm,
            bold,
            minStrokeMm: TEXT_MIN_STROKE_MM,
            centroids: [],
        };
    }
    const tracking = Math.max(TEXT_MIN_LETTER_SPACING_MM, letterSpacingMm);
    const fontSize = capHeightFontSize(font, capHeightMm);
    const scale = fontSize / font.unitsPerEm;
    let x = 0;
    const raw: TextXy[][] = [];
    // Per-character (no GSUB ligatures) so patient names engrave exactly as typed.
    for (let i = 0; i < text.length; i++) {
        const glyph = font.charToGlyph(text[i]!);
        const path = glyph.getPath(x, 0, fontSize);
        raw.push(...flattenPath(path.commands as OtCommand[], TEXT_FLATTEN_CHORD_MM));
        x += (glyph.advanceWidth ?? 0) * scale;
        if (i < text.length - 1) x += tracking;
    }
    let contours = clipperUnionOrient(raw);
    if (bold) contours = inflateContours(contours, TEXT_BOLD_OFFSET_MM);
    const stroke = allowThin ? measureStrokeMm(contours) : minStrokeMm(contours);
    if (!allowThin && stroke + 1e-6 < TEXT_MIN_STROKE_MM) throw textTooThin();
    const groups = groupHoles(contours)
        .map(resampleGroup)
        .filter((g) => g.outer.length >= 3);
    if (!groups.length) {
        throw new TextMarkingError("empty-glyph", "text produced no drawable outlines");
    }
    return {
        groups,
        advanceMm: x,
        capHeightMm,
        bold,
        minStrokeMm: allowThin ? stroke : Math.max(stroke, TEXT_MIN_STROKE_MM),
        centroids: centroidsOf(groups),
    };
}
