// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EndType, FillRule, inflatePathsD, isPositiveD, JoinType, unionD } from "clipper2-ts";
import type { Font } from "opentype.js";
import { pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import { polygonSignedArea } from "@/lib/geometry/procedural-wall/curves";
import {
    TEXT_BOLD_OFFSET_MM,
    TEXT_FLATTEN_CHORD_MM,
    TEXT_MAX_CHARS,
    TEXT_MIN_LETTER_SPACING_MM,
    TEXT_MIN_LOOP_AREA_MM2,
    TEXT_MIN_STROKE_MM,
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
    const paths = unionD(subject, FillRule.NonZero);
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
        2,
    );
    return clipperUnionOrient(paths.map(fromPathD));
}

function minStrokeMm(contours: TextContour[]): number {
    if (!contours.length) return 0;
    const outers = contours.filter((c) => !c.hole);
    if (!outers.length) return 0;
    const half = TEXT_MIN_STROKE_MM / 2;
    const shrunk = inflateContours(contours, -half);
    const shrunkOuters = shrunk.filter((c) => !c.hole);
    if (shrunkOuters.length < outers.length) return 0;
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

function centroidsOf(groups: TextGlyphGroup[]): TextXy[] {
    const pts: TextXy[] = [];
    for (const g of groups) {
        let x = 0;
        let y = 0;
        for (const p of g.outer) {
            x += p.x;
            y += p.y;
        }
        const n = Math.max(1, g.outer.length);
        pts.push({ x: x / n, y: y / n });
    }
    return pts;
}

export function flattenText(
    font: Font,
    text: string,
    capHeightMm: number,
    letterSpacingMm: number,
    bold: boolean,
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
    const stroke = minStrokeMm(contours);
    if (stroke + 1e-6 < TEXT_MIN_STROKE_MM) throw textTooThin();
    const groups = groupHoles(contours);
    if (!groups.length) {
        throw new TextMarkingError("empty-glyph", "text produced no drawable outlines");
    }
    return {
        groups,
        advanceMm: x,
        capHeightMm,
        bold,
        minStrokeMm: Math.max(stroke, TEXT_MIN_STROKE_MM),
        centroids: centroidsOf(groups),
    };
}
