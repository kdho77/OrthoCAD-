// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Match belt-contact letter walls to the font string and score #435 G1.

import type { TextGlyphGroup, TextXy } from "@/lib/geometry/text-marking/types";
import { extractGlyphLoopsFromFile } from "./gcode-glyphs";
import { fitLinear, gradeChirality, jHookExtendsLeft, type LinearMap } from "./measure";
import type { Xy } from "./reading-view";

export type PrintDirection = "toe_first" | "heel_first";

export interface FootGrade {
    pass: boolean;
    failures: string[];
    yCutMm: number;
    wallSegments: number;
    arcMoves: number;
    loopCount: number;
    sequence: string;
    letters: string;
    map: LinearMap;
    advanceMm: number;
    hookLeft: boolean;
    matchMm: number;
    types: Record<string, number>;
    printDirection: PrintDirection;
    heelHigh: boolean | null;
    heelDeltaMm: number;
}

const POSES: Array<readonly [number, number]> = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
];

function centroid(points: readonly Xy[]): Xy {
    let x = 0;
    let y = 0;
    for (const p of points) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, points.length);
    return { x: x / n, y: y / n };
}

function ySpan(points: readonly Xy[]): number {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const p of points) {
        if (p.y < lo) lo = p.y;
        if (p.y > hi) hi = p.y;
    }
    return hi - lo;
}

function resample(loop: readonly Xy[], n: number): Xy[] {
    if (loop.length === 0) return [];
    const pts = loop.slice();
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-6) pts.push(first);
    const seg: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
        seg.push(seg[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
    }
    const total = seg[seg.length - 1] ?? 0;
    if (total < 1e-6) return Array.from({ length: n }, () => ({ ...first }));
    const out: Xy[] = [];
    let cursor = 1;
    for (let i = 0; i < n; i++) {
        const target = (i / n) * total;
        while (cursor < seg.length - 1 && seg[cursor]! < target) cursor += 1;
        const prev = cursor - 1;
        const span = (seg[cursor] ?? 0) - (seg[prev] ?? 0);
        const t = span < 1e-9 ? 0 : (target - (seg[prev] ?? 0)) / span;
        const a = pts[prev]!;
        const b = pts[cursor]!;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return out;
}

function chamfer(src: readonly Xy[], dst: readonly Xy[]): number {
    if (src.length === 0 || dst.length === 0) return Number.POSITIVE_INFINITY;
    let sum = 0;
    for (const p of src) {
        let best = Number.POSITIVE_INFINITY;
        for (const q of dst) {
            const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
            if (d < best) best = d;
        }
        sum += Math.sqrt(best);
    }
    return sum / src.length;
}

function poseCost(font: readonly Xy[], observed: readonly Xy[], sx: number, sy: number): number {
    const fc = centroid(font);
    const oc = centroid(observed);
    const scale = ySpan(observed) / Math.max(1e-6, ySpan(font));
    const moved = font.map((p) => ({
        x: oc.x + sx * scale * (p.x - fc.x),
        y: oc.y + sy * scale * (p.y - fc.y),
    }));
    return chamfer(moved, observed);
}

interface PoseMatch {
    cost: number;
    sx: number;
    sy: number;
    scale: number;
}

function bestPose(font: readonly Xy[], observed: readonly Xy[]): PoseMatch {
    const scale = ySpan(observed) / Math.max(1e-6, ySpan(font));
    let best: PoseMatch = { cost: Number.POSITIVE_INFINITY, sx: 1, sy: 1, scale };
    for (const [sx, sy] of POSES) {
        const cost = poseCost(font, observed, sx, sy);
        if (cost < best.cost) best = { cost, sx, sy, scale };
    }
    return best;
}

/**
 * Assign each font glyph to one wall loop. Extra loops (leader, noise) stay unused.
 * 7 letters, so the search is the assignment of letters onto the letter-sized loops.
 */
function assignLoops(
    fontLoops: readonly (readonly Xy[])[],
    observed: readonly (readonly Xy[])[],
): { index: number[]; cost: number } | null {
    const n = fontLoops.length;
    if (observed.length < n) return null;
    const cost: number[][] = fontLoops.map((font) => observed.map((loop) => bestPose(font, loop).cost));
    if (process.env.NAME_PLANTAR_DEBUG) {
        const box = (pts: readonly Xy[]) => {
            const xs = pts.map((p) => p.x);
            const ys = pts.map((p) => p.y);
            return `${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)} x ${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)}`;
        };
        console.log(fontLoops.map((loop, i) => `font ${i} ${box(loop)}`).join("\n"));
        console.log(observed.map((loop, i) => `hole ${i} ${box(loop)}`).join("\n"));
        console.log(cost.map((row) => row.map((v) => v.toFixed(2)).join(" ")).join("\n"));
    }
    const order = observed
        .map((_, index) => index)
        .sort((a, b) => {
            const ba = Math.min(...cost.map((row) => row[a]!));
            const bb = Math.min(...cost.map((row) => row[b]!));
            return ba - bb;
        })
        .slice(0, Math.min(observed.length, n + 4));
    let best = Number.POSITIVE_INFINITY;
    let bestPick: number[] | null = null;
    const used = new Uint8Array(observed.length);
    const pick: number[] = [];
    const walk = (letter: number, acc: number) => {
        if (acc >= best) return;
        if (letter === n) {
            best = acc;
            bestPick = pick.slice();
            return;
        }
        for (const index of order) {
            if (used[index]) continue;
            used[index] = 1;
            pick.push(index);
            walk(letter + 1, acc + cost[letter]![index]!);
            pick.pop();
            used[index] = 0;
        }
    };
    walk(0, 0);
    if (!bestPick) return null;
    return { index: bestPick, cost: best };
}

function pairPoints(font: readonly Xy[], observed: readonly Xy[], pose: PoseMatch): { src: Xy[]; dst: Xy[] } {
    const fc = centroid(font);
    const oc = centroid(observed);
    const samples = resample(font, 36);
    const cloud = resample(observed, 72);
    const src: Xy[] = [];
    const dst: Xy[] = [];
    const used = new Uint8Array(cloud.length);
    for (const p of samples) {
        const pred = {
            x: oc.x + pose.sx * pose.scale * (p.x - fc.x),
            y: oc.y + pose.sy * pose.scale * (p.y - fc.y),
        };
        let best = -1;
        let bestD = Number.POSITIVE_INFINITY;
        for (let i = 0; i < cloud.length; i++) {
            if (used[i]) continue;
            const q = cloud[i]!;
            const d = (q.x - pred.x) ** 2 + (q.y - pred.y) ** 2;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        if (best < 0) continue;
        used[best] = 1;
        src.push(p);
        dst.push(cloud[best]!);
    }
    return { src, dst };
}

/**
 * Score letter loops already in the #442 physical reading frame.
 * Same assignment, linear map, hook, and 2.5 mm match as the G-code grader.
 * Thresholds are not loosened.
 */
export function gradeObservedLoops(input: {
    observed: readonly (readonly Xy[])[];
    groups: readonly TextGlyphGroup[];
    letters: string;
    printDirection: PrintDirection;
    heelHigh: boolean | null;
    heelDeltaMm: number;
    preambleFailures?: readonly string[];
    yCutMm?: number;
    wallSegments?: number;
    arcMoves?: number;
    types?: Record<string, number>;
}): FootGrade {
    const failures = [...(input.preambleFailures ?? [])];
    const empty: LinearMap = { a: 0, b: 0, c: 0, d: 0, det: 0 };
    const base = {
        yCutMm: input.yCutMm ?? 0,
        wallSegments: input.wallSegments ?? 0,
        arcMoves: input.arcMoves ?? 0,
        loopCount: input.observed.length,
        sequence: "",
        letters: input.letters,
        map: empty,
        advanceMm: 0,
        hookLeft: false,
        matchMm: Number.POSITIVE_INFINITY,
        types: input.types ?? {},
        printDirection: input.printDirection,
        heelHigh: input.heelHigh,
        heelDeltaMm: input.heelDeltaMm,
    };
    if (input.groups.length !== input.letters.length) {
        failures.push(`font groups ${input.groups.length} (need ${input.letters.length})`);
        return { pass: false, failures, ...base };
    }
    const fontLoops = input.groups
        .map((group) => group.outer.map((p) => ({ x: p.x, y: p.y })))
        .sort((a, b) => centroid(a).x - centroid(b).x);
    const observed = input.observed;
    const assigned = assignLoops(fontLoops, observed);
    if (!assigned) {
        failures.push(`letter walls ${observed.length} (need ${input.letters.length} for ${input.letters})`);
        return { pass: false, failures, ...base };
    }
    const matchMm = assigned.cost / input.letters.length;
    const src: Xy[] = [];
    const dst: Xy[] = [];
    const sequence: string[] = assigned.index.map((loopIndex, letterIndex) => ({
        letter: input.letters[letterIndex]!,
        x: centroid(observed[loopIndex]!).x,
        loopIndex,
    }));
    sequence.sort((a, b) => a.x - b.x);
    const sequenceText = sequence.map((row) => row.letter).join("");
    for (let i = 0; i < input.letters.length; i++) {
        const loop = observed[assigned.index[i]!]!;
        const pose = bestPose(fontLoops[i]!, loop);
        const paired = pairPoints(fontLoops[i]!, loop, pose);
        src.push(...paired.src);
        dst.push(...paired.dst);
    }
    const map = fitLinear(src, dst);
    const jay = centroid(observed[assigned.index[0]!]!);
    const last = centroid(observed[assigned.index[input.letters.length - 1]!]!);
    const advanceMm = last.x - jay.x;
    const hookLeft = jHookExtendsLeft(observed[assigned.index[0]!]!);
    const graded = gradeChirality({ map, advanceMm, hookLeft });
    if (sequenceText !== input.letters) {
        graded.failures.push(`glyph sequence ${sequenceText} (need ${input.letters} toward +reading-x)`);
    }
    if (!(matchMm < 2.5)) {
        graded.failures.push(`glyph match ${matchMm.toFixed(2)} mm (wall is not the font outline)`);
    }
    return {
        pass: graded.failures.length === 0 && failures.length === 0,
        failures: [...failures, ...graded.failures],
        ...base,
        sequence: sequenceText,
        map,
        advanceMm,
        hookLeft,
        matchMm,
    };
}

export function gradeFootGcode(
    gcodePath: string,
    groups: readonly TextGlyphGroup[],
    letters: string,
    printDirection: PrintDirection,
): FootGrade {
    const extracted = extractGlyphLoopsFromFile(gcodePath);
    const failures: string[] = [];
    const heelHigh = extracted.heel.heelHigh;
    if (heelHigh === null) {
        failures.push("heel end inconclusive (hand_classify end-fifth rule)");
    } else if (printDirection === "heel_first" && heelHigh) {
        failures.push("file is not heel-first (heel cup is not at the low zt end)");
    } else if (printDirection === "toe_first" && !heelHigh) {
        failures.push("file is not toe-first (heel cup is at the low zt end)");
    }
    if (extracted.wallSegments < 50) {
        failures.push(`wall extrusions ${extracted.wallSegments} (G-code has no ;TYPE:Wall sections)`);
    }
    // Glyph groups are not emitted in string order. JABBOUR is drawn toward +x,
    // so reading order is increasing font-x.
    return gradeObservedLoops({
        observed: extracted.loops.map((loop) => loop.points),
        groups,
        letters,
        printDirection,
        heelHigh,
        heelDeltaMm: extracted.heel.deltaMm,
        preambleFailures: failures,
        yCutMm: extracted.yCutMm,
        wallSegments: extracted.wallSegments,
        arcMoves: extracted.arcMoves,
        types: extracted.types,
    });
}

export function gradeReport(grade: FootGrade): Record<string, number | string | boolean> {
    return {
        pass: grade.pass,
        a: Number(grade.map.a.toFixed(6)),
        b: Number(grade.map.b.toFixed(6)),
        c: Number(grade.map.c.toFixed(6)),
        d: Number(grade.map.d.toFixed(6)),
        det: Number(grade.map.det.toFixed(6)),
        advanceMm: Number(grade.advanceMm.toFixed(3)),
        hookLeft: grade.hookLeft,
        sequence: grade.sequence,
        yCutMm: grade.yCutMm,
        loops: grade.loopCount,
        matchMm: Number(grade.matchMm.toFixed(3)),
        wallSegments: grade.wallSegments,
        printDirection: grade.printDirection,
        heelHigh: grade.heelHigh === null ? "inconclusive" : grade.heelHigh,
        heelDeltaMm: Number(grade.heelDeltaMm.toFixed(2)),
        failures: grade.failures.join("; "),
    };
}

export type { TextXy };
