// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Letter walls from belt G-code. Engrave removes the glyph, so each letter is a
// closed wall on the belt-contact layers. Infill is not part of the outline.

import { readFileSync } from "node:fs";
import { physicalReadingView, type Xy, type Xyz } from "./reading-view";
import { BELT_CONTACT_Y_MM, ENGRAVE_Y_MM } from "./thresholds";

interface Segment {
    a: Xyz;
    b: Xyz;
    wall: boolean;
}

export interface GlyphLoop {
    /** Wall centerline in the physical reading frame. */
    points: Xy[];
    yMax: number;
}

export interface GlyphExtract {
    loops: GlyphLoop[];
    yCutMm: number;
    wallSegments: number;
    arcMoves: number;
    types: Record<string, number>;
}

const WORD = /([XYZEFIJK])(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;

function parseSegments(text: string): {
    segments: Segment[];
    arcMoves: number;
    types: Record<string, number>;
} {
    let x = 0;
    let y = 0;
    let z = 0;
    let eAbs = 0;
    let absXyz = true;
    let relE = false;
    let section = "";
    let arcMoves = 0;
    const types: Record<string, number> = {};
    const segments: Segment[] = [];

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith(";")) {
            const type = /^;TYPE:(.+)$/i.exec(line);
            if (type) section = type[1]!.trim();
            continue;
        }
        const code = line.split(";", 1)[0]!.trim();
        if (!code) continue;
        if (code.startsWith("G90")) {
            absXyz = true;
            continue;
        }
        if (code.startsWith("G91")) {
            absXyz = false;
            continue;
        }
        if (code.startsWith("M82")) {
            relE = false;
            continue;
        }
        if (code.startsWith("M83")) {
            relE = true;
            continue;
        }
        const motion = /^(G0|G1|G2|G3|G00|G01|G02|G03)\b/i.exec(code);
        if (!motion) continue;
        const kind = motion[1]!.toUpperCase();
        let nx = x;
        let ny = y;
        let nz = z;
        let e: number | null = null;
        let iOff = 0;
        let jOff = 0;
        let hasI = false;
        let hasJ = false;
        for (const match of code.matchAll(WORD)) {
            const k = match[1]!.toUpperCase();
            const v = Number(match[2]);
            if (k === "X") nx = absXyz ? v : x + v;
            else if (k === "Y") ny = absXyz ? v : y + v;
            else if (k === "Z") nz = absXyz ? v : z + v;
            else if (k === "E") e = v;
            else if (k === "I") {
                iOff = v;
                hasI = true;
            } else if (k === "J") {
                jOff = v;
                hasJ = true;
            }
        }
        const extruding = e !== null && (relE ? e > 1e-8 : e > eAbs + 1e-8);
        if (e !== null && !relE) eAbs = e;
        const isArc = kind === "G2" || kind === "G3" || kind === "G02" || kind === "G03";
        if (extruding && isArc) arcMoves += 1;
        const wall = /wall/i.test(section) && !/infill/i.test(section);
        if (extruding && (nx !== x || ny !== y || nz !== z)) {
            if (isArc && hasI && hasJ) {
                const steps = sampleArc(
                    { x, y, z },
                    { x: nx, y: ny, z: nz },
                    iOff,
                    jOff,
                    kind.startsWith("G2") || kind === "G02",
                );
                for (let s = 1; s < steps.length; s++) {
                    segments.push({ a: steps[s - 1]!, b: steps[s]!, wall });
                }
            } else {
                segments.push({ a: { x, y, z }, b: { x: nx, y: ny, z: nz }, wall });
            }
            types[section || "(none)"] = (types[section || "(none)"] ?? 0) + 1;
        }
        x = nx;
        y = ny;
        z = nz;
    }
    return { segments, arcMoves, types };
}

/** Sample a G2/G3. Belt layers lie in XZ, so I/J are X/Z offsets when Y is the height. */
function sampleArc(start: Xyz, end: Xyz, iOff: number, jOff: number, clockwise: boolean): Xyz[] {
    const yFlat = Math.abs(end.y - start.y) < 0.05;
    const sx = start.x;
    const sy = yFlat ? start.z : start.y;
    const ex = end.x;
    const ey = yFlat ? end.z : end.y;
    const cx = sx + iOff;
    const cy = sy + jOff;
    const r0 = Math.hypot(sx - cx, sy - cy);
    const r1 = Math.hypot(ex - cx, ey - cy);
    if (r0 < 1e-6 || Math.abs(r0 - r1) > 1.5) return [start, end];
    const a0 = Math.atan2(sy - cy, sx - cx);
    let a1 = Math.atan2(ey - cy, ex - cx);
    if (clockwise) {
        while (a1 > a0) a1 -= Math.PI * 2;
    } else {
        while (a1 < a0) a1 += Math.PI * 2;
    }
    const sweep = a1 - a0;
    const length = Math.abs(sweep) * r0;
    const n = Math.max(2, Math.ceil(length / 0.4));
    const out: Xyz[] = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const ang = a0 + sweep * t;
        const px = cx + r0 * Math.cos(ang);
        const py = cy + r0 * Math.sin(ang);
        const y = start.y + (end.y - start.y) * t;
        const z = yFlat ? py : start.z + (end.z - start.z) * t;
        const xx = px;
        const yy = yFlat ? y : py;
        out.push({ x: xx, y: yy, z });
    }
    out[0] = start;
    out[out.length - 1] = end;
    return out;
}

/**
 * Engrave voids in the belt skin. Contact extrusions are scanlines across the
 * belt; joining neighbors along the belt leaves the letter grooves as enclosed
 * holes about one cap tall.
 */
function letterHoles(segments: Segment[], yCut: number): Xy[][] {
    const kept = segments.filter(
        (s) => s.a.y <= yCut && s.b.y <= yCut && Math.hypot(s.a.x - s.b.x, s.a.z - s.b.z) > 0.15,
    );
    if (kept.length < 20) return [];
    const viewed = kept.map((s) => [physicalReadingView(s.a), physicalReadingView(s.b)] as const);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [a, b] of viewed) {
        minX = Math.min(minX, a.x, b.x);
        minY = Math.min(minY, a.y, b.y);
        maxX = Math.max(maxX, a.x, b.x);
        maxY = Math.max(maxY, a.y, b.y);
    }
    const res = 0.35;
    const width = Math.floor((maxX - minX) / res) + 4;
    const height = Math.floor((maxY - minY) / res) + 4;
    if (width < 8 || height < 8 || width * height > 2_000_000) return [];
    const grid = new Uint8Array(width * height);
    const pix = (p: Xy) => [Math.floor((p.x - minX) / res), Math.floor((p.y - minY) / res)] as const;
    for (const [a, b] of viewed) {
        const [c0, r0] = pix(a);
        const [c1, r1] = pix(b);
        const steps = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0), 1);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const c = Math.round(c0 + (c1 - c0) * t);
            const r = Math.round(r0 + (r1 - r0) * t);
            if (c >= 0 && r >= 0 && c < width && r < height) grid[r * width + c] = 1;
        }
    }
    // Scanlines are ~0.65 mm apart along the belt (reading x). One cell joins them.
    const dil = grid.slice();
    for (let r = 0; r < height; r++) {
        const row = r * width;
        for (let c = 0; c < width; c++) {
            if (!grid[row + c]) continue;
            if (c + 1 < width) dil[row + c + 1] = 1;
            if (c > 0) dil[row + c - 1] = 1;
        }
    }
    const seen = new Uint8Array(width * height);
    const queue: number[] = [];
    const push = (c: number, r: number) => {
        if (c < 0 || r < 0 || c >= width || r >= height) return;
        const i = r * width + c;
        if (dil[i] || seen[i]) return;
        seen[i] = 1;
        queue.push(i);
    };
    for (let c = 0; c < width; c++) {
        push(c, 0);
        push(c, height - 1);
    }
    for (let r = 0; r < height; r++) {
        push(0, r);
        push(width - 1, r);
    }
    for (let q = 0; q < queue.length; q++) {
        const i = queue[q]!;
        const c = i % width;
        const r = (i - c) / width;
        push(c + 1, r);
        push(c - 1, r);
        push(c, r + 1);
        push(c, r - 1);
    }
    const holes: Xy[][] = [];
    const vis = new Uint8Array(width * height);
    for (let i = 0; i < dil.length; i++) {
        if (dil[i] || seen[i] || vis[i]) continue;
        const cells: number[] = [i];
        vis[i] = 1;
        const local: number[] = [i];
        for (let q = 0; q < local.length; q++) {
            const id = local[q]!;
            const c = id % width;
            const r = (id - c) / width;
            const neighbors = [id + 1, id - 1, id + width, id - width];
            for (const n of neighbors) {
                if (n < 0 || n >= dil.length || dil[n] || seen[n] || vis[n]) continue;
                const nc = n % width;
                if (Math.abs(nc - c) + Math.abs((n - nc) / width - r) !== 1) continue;
                vis[n] = 1;
                local.push(n);
                cells.push(n);
            }
        }
        let loC = width;
        let hiC = 0;
        let loR = height;
        let hiR = 0;
        for (const id of cells) {
            const c = id % width;
            const r = (id - c) / width;
            if (c < loC) loC = c;
            if (c > hiC) hiC = c;
            if (r < loR) loR = r;
            if (r > hiR) hiR = r;
        }
        const w = (hiC - loC) * res;
        const h = (hiR - loR) * res;
        if (h < 6 || h > 20 || w < 2 || w > 20 || cells.length < 15) continue;
        holes.push(
            cells.map((id) => {
                const c = id % width;
                const r = (id - c) / width;
                return { x: minX + (c + 0.5) * res, y: minY + (r + 0.5) * res };
            }),
        );
    }
    return holes;
}

export function extractGlyphLoops(gcode: string): GlyphExtract {
    const parsed = parseSegments(gcode);
    const wallSegments = parsed.segments.filter((s) => s.wall).length;
    const cuts = [BELT_CONTACT_Y_MM, ENGRAVE_Y_MM];
    let chosen = cuts[0]!;
    let loops: Xy[][] = [];
    for (const cut of cuts) {
        chosen = cut;
        loops = letterHoles(parsed.segments, cut);
        if (loops.length >= 7) break;
    }
    return {
        loops: loops.map((points) => ({ points, yMax: chosen })),
        yCutMm: chosen,
        wallSegments,
        arcMoves: parsed.arcMoves,
        types: parsed.types,
    };
}

export function extractGlyphLoopsFromFile(path: string): GlyphExtract {
    return extractGlyphLoops(readFileSync(path, "utf8"));
}
