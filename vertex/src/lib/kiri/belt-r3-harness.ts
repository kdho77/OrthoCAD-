// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { applyXRotationToGeometry, orientMeshToBeltFrame } from "./belt-orient";
import {
    clipLoopToBelt,
    insetLoop,
    offsetOpenToward,
    RIBBON_WIDTH_BEADS,
    shellPairWidthMm,
} from "./belt-slice";
import { classifyBeltRings, stitchBeltLoops } from "./belt-stitch";
import { resolveBeltConfig, slicePitchRotatedMm } from "./belt-transform";
import type { PrinterPreset } from "./presets";
import { extractTriangles, type Pt, sliceLayerSegments } from "./slicer";

export interface WallBox {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface LayerWalls {
    outer: WallBox | null;
    inner: WallBox | null;
    maxOuterSpan: number;
    minInnerY: number | null;
    outerSections: WallBox[];
    innerSections: WallBox[];
    pairs: { outer: WallBox; inner: WallBox | null }[];
}

export function numWord(line: string, axis: string): number | undefined {
    const m = new RegExp(`(?:^|\\s)${axis}(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)`, "i").exec(line);
    return m ? Number(m[1]) : undefined;
}

export function indexWalls(gcode: string): Map<number, LayerWalls> {
    const out = new Map<number, LayerWalls>();
    let cur = -1;
    let kind: "WALL-OUTER" | "WALL-INNER" | null = null;
    let sx: number[] = [];
    let sy: number[] = [];
    const outerSections: WallBox[] = [];
    const innerSections: WallBox[] = [];
    const pairs: { outer: WallBox; inner: WallBox | null }[] = [];
    let pendingOuter: WallBox | null = null;

    const boxOf = (xs: number[], ys: number[]): WallBox | null => {
        if (!xs.length || !ys.length) return null;
        let minX = xs[0];
        let maxX = xs[0];
        let minY = ys[0];
        let maxY = ys[0];
        for (const v of xs) {
            if (v < minX) minX = v;
            if (v > maxX) maxX = v;
        }
        for (const v of ys) {
            if (v < minY) minY = v;
            if (v > maxY) maxY = v;
        }
        return { minX, maxX, minY, maxY };
    };
    const flushSection = () => {
        const b = boxOf(sx, sy);
        if (b && kind === "WALL-OUTER") {
            if (pendingOuter) pairs.push({ outer: pendingOuter, inner: null });
            pendingOuter = b;
            outerSections.push(b);
        }
        if (b && kind === "WALL-INNER") {
            if (pendingOuter) {
                pairs.push({ outer: pendingOuter, inner: b });
                pendingOuter = null;
            }
            innerSections.push(b);
        }
        sx = [];
        sy = [];
    };
    const flushLayer = () => {
        if (cur < 0) return;
        flushSection();
        let maxOuterSpan = Number.NEGATIVE_INFINITY;
        let minInnerY: number | null = null;
        const uox: number[] = [];
        const uoy: number[] = [];
        const uix: number[] = [];
        const uiy: number[] = [];
        for (const b of outerSections) {
            maxOuterSpan = Math.max(maxOuterSpan, b.maxX - b.minX);
            uox.push(b.minX, b.maxX);
            uoy.push(b.minY, b.maxY);
        }
        for (const b of innerSections) {
            minInnerY = minInnerY === null ? b.minY : Math.min(minInnerY, b.minY);
            uix.push(b.minX, b.maxX);
            uiy.push(b.minY, b.maxY);
        }
        if (pendingOuter) pairs.push({ outer: pendingOuter, inner: null });
        out.set(cur, {
            outer: boxOf(uox, uoy),
            inner: boxOf(uix, uiy),
            maxOuterSpan: Number.isFinite(maxOuterSpan) ? maxOuterSpan : Number.NaN,
            minInnerY,
            outerSections: outerSections.slice(),
            innerSections: innerSections.slice(),
            pairs: pairs.slice(),
        });
        outerSections.length = 0;
        innerSections.length = 0;
        pairs.length = 0;
        pendingOuter = null;
    };

    for (const raw of gcode.split("\n")) {
        const line = raw.trim();
        const lm = /^;LAYER:(\d+)/.exec(line);
        if (lm) {
            flushLayer();
            cur = Number(lm[1]);
            kind = null;
            continue;
        }
        if (line.startsWith(";TYPE:")) {
            flushSection();
            kind =
                line === ";TYPE:WALL-OUTER"
                    ? "WALL-OUTER"
                    : line === ";TYPE:WALL-INNER"
                      ? "WALL-INNER"
                      : null;
            continue;
        }
        if (line === ";MESH:NONMESH") {
            flushSection();
            kind = null;
            continue;
        }
        if (!kind || !/^G[01]\b/.test(line)) continue;
        const x = numWord(line, "X");
        const y = numWord(line, "Y");
        if (x !== undefined) sx.push(x);
        if (y !== undefined) sy.push(y);
    }
    flushLayer();
    return out;
}

export function measureMoveSpans(gcode: string): {
    all: { minX: number; maxX: number; minY: number; maxY: number; xSpan: number; ySpan: number };
    extrude: { minX: number; maxX: number; minY: number; maxY: number; xSpan: number; ySpan: number };
} {
    let aMinX = Infinity;
    let aMaxX = -Infinity;
    let aMinY = Infinity;
    let aMaxY = -Infinity;
    let eMinX = Infinity;
    let eMaxX = -Infinity;
    let eMinY = Infinity;
    let eMaxY = -Infinity;
    let inLayers = false;
    for (const raw of gcode.split("\n")) {
        const line = raw.trim();
        if (line.startsWith(";LAYER:")) inLayers = true;
        if (line.startsWith(";End of Gcode") || line === "PRINT_END" || line.startsWith("M204 S4000")) {
            inLayers = false;
        }
        if (!inLayers || !/^G[01]\b/.test(line)) continue;
        const x = numWord(line, "X");
        const y = numWord(line, "Y");
        const extrude = /^G1\b/.test(line) && /\sE-?\d/.test(line);
        if (x !== undefined) {
            if (x < aMinX) aMinX = x;
            if (x > aMaxX) aMaxX = x;
            if (extrude) {
                if (x < eMinX) eMinX = x;
                if (x > eMaxX) eMaxX = x;
            }
        }
        if (y !== undefined) {
            if (y < aMinY) aMinY = y;
            if (y > aMaxY) aMaxY = y;
            if (extrude) {
                if (y < eMinY) eMinY = y;
                if (y > eMaxY) eMaxY = y;
            }
        }
    }
    const span = (lo: number, hi: number) => (Number.isFinite(lo) && Number.isFinite(hi) ? hi - lo : 0);
    return {
        all: {
            minX: aMinX,
            maxX: aMaxX,
            minY: aMinY,
            maxY: aMaxY,
            xSpan: span(aMinX, aMaxX),
            ySpan: span(aMinY, aMaxY),
        },
        extrude: {
            minX: eMinX,
            maxX: eMaxX,
            minY: eMinY,
            maxY: eMaxY,
            xSpan: span(eMinX, eMaxX),
            ySpan: span(eMinY, eMaxY),
        },
    };
}

export interface SliceStation {
    layerIndex: number;
    planeZ: number;
    beltY: number;
    loops: {
        minX: number;
        maxX: number;
        span: number;
        verts: number;
        area: number;
        insetSpan: number;
        insetMinX: number;
        insetMaxX: number;
        grew: boolean;
        identity: number;
        kind: "outer" | "hole";
        ribbon: boolean;
        shellPair: boolean;
        localWidthMm: number;
    }[];
    unionMinX: number;
    unionMaxX: number;
}

export function sliceStations(
    rotated: BufferGeometry,
    pitch: number,
    angleDeg: number,
    lineWidthMm = 0.8,
): SliceStation[] {
    rotated.computeBoundingBox();
    const bb = rotated.boundingBox;
    if (!bb) return [];
    const tris = extractTriangles(rotated);
    const tan = Math.tan((angleDeg * Math.PI) / 180);
    const out: SliceStation[] = [];
    for (let z = pitch; z <= bb.max.z; z += pitch) {
        const segs = sliceLayerSegments(tris, z);
        if (segs.length === 0) continue;
        const beltY = z / tan;
        const stitched = stitchBeltLoops(segs, { beltY });
        const raw = classifyBeltRings(
            stitched.closed.map((loop) => clipLoopToBelt(loop, beltY)).filter((l) => l.length >= 3),
        );
        const emits = raw.some(
            (ring) => clipLoopToBelt(insetLoop(ring.loop, lineWidthMm / 2, beltY), beltY).length >= 3,
        );
        if (!emits && stitched.open.length === 0 && stitched.shellPairs.length === 0) continue;
        const source = raw.length
            ? raw.map((ring) => ({ ...ring, shellPair: false, localWidthMm: Number.NaN }))
            : stitched.shellPairs.length
              ? stitched.shellPairs.map((pair) => {
                    const aOn = pair.a.some((p) => Math.abs(p[1] - beltY) <= 1e-6);
                    const bOn = pair.b.some((p) => Math.abs(p[1] - beltY) <= 1e-6);
                    const outer =
                        aOn === bOn
                            ? xSpanOf(pair.a) >= xSpanOf(pair.b)
                                ? pair.a
                                : pair.b
                            : aOn
                              ? pair.a
                              : pair.b;
                    const other = outer === pair.a ? pair.b : pair.a;
                    return {
                        loop: outer,
                        kind: "outer" as const,
                        depth: 0,
                        shellPair: true,
                        localWidthMm: shellPairWidthMm(pair),
                        toward: other,
                    };
                })
              : stitched.open
                    .filter((c) => c.length >= 2)
                    .map((loop) => ({
                        loop,
                        kind: "outer" as const,
                        depth: 0,
                        shellPair: false,
                        localWidthMm: Number.NaN,
                    }));
        const loops = source.map((ring, identity) => {
            const loop = ring.loop;
            let minX = Infinity;
            let maxX = -Infinity;
            let area = 0;
            for (let i = 0; i < loop.length; i++) {
                const p = loop[i];
                const q = loop[(i + 1) % loop.length];
                if (p[0] < minX) minX = p[0];
                if (p[0] > maxX) maxX = p[0];
                area += p[0] * q[1] - q[0] * p[1];
            }
            const toward = "toward" in ring ? ring.toward : undefined;
            const inset = raw.length
                ? clipLoopToBelt(insetLoop(loop, lineWidthMm / 2, beltY), beltY)
                : toward
                  ? offsetOpenToward(loop, lineWidthMm / 2, toward, beltY)
                  : [];
            let iMin = Infinity;
            let iMax = -Infinity;
            for (const p of inset) {
                if (p[0] < iMin) iMin = p[0];
                if (p[0] > iMax) iMax = p[0];
            }
            const insetSpan = inset.length >= 2 ? iMax - iMin : Number.NaN;
            const localWidthMm = ring.localWidthMm;
            const ribbon =
                ring.shellPair ||
                (Number.isFinite(localWidthMm) && localWidthMm <= RIBBON_WIDTH_BEADS * lineWidthMm);
            return {
                minX,
                maxX,
                span: maxX - minX,
                verts: loop.length,
                area: area / 2,
                insetSpan,
                insetMinX: iMin,
                insetMaxX: iMax,
                grew: Number.isFinite(insetSpan) ? insetSpan > maxX - minX + 1e-6 : false,
                identity,
                kind: ring.kind,
                ribbon,
                shellPair: ring.shellPair,
                localWidthMm,
            };
        });
        if (loops.length === 0) continue;
        let unionMinX = Infinity;
        let unionMaxX = -Infinity;
        for (const l of loops) {
            if (l.minX < unionMinX) unionMinX = l.minX;
            if (l.maxX > unionMaxX) unionMaxX = l.maxX;
        }
        out.push({ layerIndex: out.length, planeZ: z, beltY, loops, unionMinX, unionMaxX });
    }
    return out;
}

export function prepareRotated(
    geometry: BufferGeometry,
    preset: PrinterPreset,
    side: "left" | "right",
): { rotated: BufferGeometry; pitch: number; widthMm: number; heightMm: number; lengthMm: number } {
    const cfg = resolveBeltConfig(preset);
    const framed = orientMeshToBeltFrame(geometry, side, cfg);
    const rotated = applyXRotationToGeometry(framed.geometry, cfg);
    framed.geometry.dispose();
    return {
        rotated,
        pitch: slicePitchRotatedMm(cfg),
        widthMm: framed.widthMm,
        heightMm: framed.heightMm,
        lengthMm: framed.lengthMm,
    };
}

export function widestOuterSection(walls: Map<number, LayerWalls>): { layer: number; box: WallBox } | null {
    let best: { layer: number; box: WallBox } | null = null;
    for (const [layer, w] of walls) {
        for (const b of w.outerSections) {
            const span = b.maxX - b.minX;
            if (!best || span > best.box.maxX - best.box.minX) best = { layer, box: b };
        }
    }
    return best;
}

export function contactLoopInnerGantry(
    walls: Map<number, LayerWalls>,
    startLayer: number,
): {
    layer: number;
    gantry: number;
    skippedNoInner: number;
} | null {
    const keys = [...walls.keys()].sort((a, b) => a - b);
    let skippedNoInner = 0;
    for (const layer of keys) {
        if (layer < startLayer) continue;
        const w = walls.get(layer);
        if (!w) continue;
        const contact = w.pairs.find((p) => Math.abs(p.outer.minY) <= 1e-6);
        if (!contact) continue;
        if (!contact.inner) {
            skippedNoInner++;
            continue;
        }
        // Collapsed remnant of the same emit pair is not the belt-adjacent inner (VOSS L0 < w).
        if (contact.inner.minY >= 0.8 - 1e-6) {
            skippedNoInner++;
            continue;
        }
        return { layer, gantry: contact.inner.minY, skippedNoInner };
    }
    return null;
}

export function sliverRanges(
    walls: Map<number, LayerWalls>,
    layerCount: number,
    layerBeltZ: (n: number) => number,
): {
    ranges: {
        first: number;
        last: number;
        z0: number;
        z1: number;
        region: string;
        minOuterWidth: number;
    }[];
    droppedLayers: { layer: number; z: number; minOuterWidth: number; gantryExtent: number }[];
} {
    const dropped: number[] = [];
    const widths = new Map<number, number>();
    const droppedLayers: { layer: number; z: number; minOuterWidth: number; gantryExtent: number }[] = [];
    for (let i = 0; i < layerCount; i++) {
        const w = walls.get(i);
        if (!w?.outer) continue;
        if (w.inner) continue;
        dropped.push(i);
        let minW = Infinity;
        let gantryExtent = Infinity;
        for (const b of w.outerSections) {
            minW = Math.min(minW, b.maxX - b.minX, b.maxY - b.minY);
            gantryExtent = Math.min(gantryExtent, b.maxY - b.minY);
        }
        widths.set(i, minW);
        droppedLayers.push({ layer: i, z: layerBeltZ(i), minOuterWidth: minW, gantryExtent });
    }
    const ranges: {
        first: number;
        last: number;
        z0: number;
        z1: number;
        region: string;
        minOuterWidth: number;
    }[] = [];
    let i = 0;
    while (i < dropped.length) {
        let j = i;
        while (j + 1 < dropped.length && dropped[j + 1] === dropped[j] + 1) j++;
        const first = dropped[i];
        const last = dropped[j];
        let minOuterWidth = Infinity;
        for (let k = first; k <= last; k++) {
            const ww = widths.get(k);
            if (ww !== undefined && ww < minOuterWidth) minOuterWidth = ww;
        }
        const mid = (first + last) / 2 / Math.max(1, layerCount - 1);
        let region = "mid-foot";
        if (last < layerCount * 0.15) region = "leading toe entry ramp";
        else if (first > layerCount * 0.85) region = "trailing tail";
        else if (mid > 0.7) region = "heel";
        else if (mid < 0.3) region = "forefoot";
        ranges.push({
            first,
            last,
            z0: layerBeltZ(first),
            z1: layerBeltZ(last),
            region,
            minOuterWidth,
        });
        i = j + 1;
    }
    return { ranges, droppedLayers };
}

function xSpanOf(chain: Pt[]): number {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of chain) {
        if (p[0] < lo) lo = p[0];
        if (p[0] > hi) hi = p[0];
    }
    return Number.isFinite(lo) ? hi - lo : 0;
}

export function signedArea(loop: Pt[]): number {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
        const p = loop[i];
        const q = loop[(i + 1) % loop.length];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
}
