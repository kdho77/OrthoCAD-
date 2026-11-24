// Measures the product Morton's height function and the top-mesh export add.
// Imports resolve through the rstest "@" alias so the same file grades any SHA.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BufferAttribute, BufferGeometry } from "three";
import { getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import { applyElementsToTopMeshLast } from "@/lib/geometry/element-assets/apply-elements";
import { defaultElementPose, elementHeightAt } from "@/lib/geometry/elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, SideCorrections } from "@/types";
import {
    type ClinicalFrame,
    clinicalFrame,
    type FootSide,
    LENGTH_MM,
    lateralOffset,
    lineAtX,
    pointAtUV,
    vAtPoint,
    WIDTH_MM,
} from "./anatomy";
import {
    type BlendEndMetrics,
    blendEndMetrics,
    distanceToFitMm,
    fitLine,
    maxSmoothedSlope,
    minFraction,
    peakAbsSlope,
    riseAfterLocalMinMm,
    widthSpreadMm,
} from "./measure";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function zeroCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function placed(
    side: FootSide,
    kind: "mortons_extension" | "reverse_mortons",
    heightMm: number,
): PlacedElement {
    const pose = defaultElementPose(kind, side, LENGTH_MM, WIDTH_MM);
    return {
        id: `${kind}-${side}-${heightMm}`,
        kind,
        side,
        position: { x: pose.position.x, y: pose.position.y },
        rotationDeg: pose.rotationDeg,
        scale: { x: pose.scale.x, y: pose.scale.y },
        heightMm,
    };
}

export type AddedFn = (x: number, meshY: number) => number;

export function addedHeight(side: FootSide, heightMm: number): AddedFn {
    const el = placed(side, "mortons_extension", heightMm);
    return (x, meshY) => elementHeightAt([el], x, -meshY, LENGTH_MM, WIDTH_MM);
}

interface TopSampler {
    geometry: BufferGeometry;
    frame: ReturnType<typeof getBaseFootprintFrame>;
    heightAt: (len: number, wid: number) => number | null;
}

function buildTopSampler(geometry: BufferGeometry, side: FootSide): TopSampler {
    const frame = getBaseFootprintFrame(geometry, side);
    const pos = geometry.getAttribute("position");
    if (!pos) throw new Error("SAMPLE_Top has no position");
    const index = geometry.getIndex();
    const la = frame.lengthAxis;
    const wa = frame.widthAxis;
    const ta = frame.thickAxis;
    const tris: number[] = [];
    const push = (i: number, j: number, k: number) => {
        const coords = [i, j, k];
        for (const v of coords) {
            tris.push(pos.getComponent(v, la), pos.getComponent(v, wa), pos.getComponent(v, ta));
        }
    };
    if (index) {
        for (let f = 0; f < index.count; f += 3) push(index.getX(f), index.getX(f + 1), index.getX(f + 2));
    } else {
        for (let v = 0; v + 2 < pos.count; v += 3) push(v, v + 1, v + 2);
    }
    const cell = 8;
    const buckets = new Map<string, number[]>();
    const triCount = tris.length / 9;
    let minL = Infinity;
    let minW = Infinity;
    for (let t = 0; t < triCount; t++) {
        const o = t * 9;
        let cl = 0;
        let cw = 0;
        for (let k = 0; k < 3; k++) {
            cl += tris[o + k * 3]!;
            cw += tris[o + k * 3 + 1]!;
        }
        cl /= 3;
        cw /= 3;
        if (cl < minL) minL = cl;
        if (cw < minW) minW = cw;
        const key = `${Math.floor(cl / cell)},${Math.floor(cw / cell)}`;
        const list = buckets.get(key);
        if (list) list.push(t);
        else buckets.set(key, [t]);
    }
    const heightAt = (len: number, wid: number): number | null => {
        const cx = Math.floor(len / cell);
        const cy = Math.floor(wid / cell);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const list = buckets.get(`${cx + dx},${cy + dy}`);
                if (!list) continue;
                for (const t of list) {
                    const o = t * 9;
                    const z = barycentricZ(tris, o, len, wid);
                    if (z !== null) return z;
                }
            }
        }
        return null;
    };
    return { geometry, frame, heightAt };
}

function barycentricZ(tris: number[], o: number, x: number, y: number): number | null {
    const x0 = tris[o]!;
    const y0 = tris[o + 1]!;
    const z0 = tris[o + 2]!;
    const x1 = tris[o + 3]!;
    const y1 = tris[o + 4]!;
    const z1 = tris[o + 5]!;
    const x2 = tris[o + 6]!;
    const y2 = tris[o + 7]!;
    const z2 = tris[o + 8]!;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-12) return null;
    const a = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den;
    const b = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den;
    const c = 1 - a - b;
    if (a < -1e-3 || b < -1e-3 || c < -1e-3) return null;
    return a * z0 + b * z1 + c * z2;
}

let leftTop: TopSampler | null = null;
let rightTop: TopSampler | null = null;

export async function topSampler(side: FootSide): Promise<TopSampler> {
    if (side === "left" && leftTop) return leftTop;
    if (side === "right" && rightTop) return rightTop;
    const file = readFileSync(SAMPLE_TOP_PATH);
    const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    let geometry = await sampleTopFromArrayBuffer(bytes);
    if (side === "right") {
        const mirrored = mirrorGeometry(geometry);
        geometry.dispose();
        geometry = mirrored;
    }
    const built = buildTopSampler(geometry, side);
    if (side === "left") leftTop = built;
    else rightTop = built;
    return built;
}

export function stockZ(top: TopSampler, x: number, meshY: number): number | null {
    const len = top.frame.lenMin + (x / LENGTH_MM) * top.frame.lenSize;
    const wid = top.frame.widCenter + meshY;
    return top.heightAt(len, wid);
}

function scanOffset(frame: ClinicalFrame, added: AddedFn, x: number, level: number): number | null {
    const origin = lineAtX(frame, x);
    let prevT = -40;
    let prevH = added(origin.x + frame.lateral.x * prevT, origin.y + frame.lateral.y * prevT);
    let last: number | null = null;
    for (let step = 1; step <= 280; step++) {
        const t = -40 + step * 0.25;
        const h = added(origin.x + frame.lateral.x * t, origin.y + frame.lateral.y * t);
        if ((prevH - level) * (h - level) <= 0 && prevH !== h) {
            const u = (level - prevH) / (h - prevH);
            last = prevT + u * (t - prevT);
        }
        prevT = t;
        prevH = h;
    }
    return last;
}

function pointFromOffset(frame: ClinicalFrame, x: number, t: number): { x: number; y: number } {
    const origin = lineAtX(frame, x);
    return { x: origin.x + frame.lateral.x * t, y: origin.y + frame.lateral.y * t };
}

export interface ShapeMetrics {
    side: FootSide;
    heightMm: number;
    maxAdded: number;
    g1_95: number;
    g1_05: number;
    g1_95_n: number;
    g1_05_n: number;
    g2_spread: number;
    g2_median: number;
    g2_min: number;
    g2_max: number;
    g2_n: number;
    g3_fraction: number;
    g3_n: number;
    g4: { v: number; fraction: number; n: number }[];
    g5_rise: number;
    g6_slope: number;
    g6_n: number;
    g7_start: BlendEndMetrics;
    g7_end: BlendEndMetrics;
    g8_peak: number;
    s1_angle_deg: number;
    s1_mid_dist_mm: number;
    s2_bevel_over_8: boolean;
    /** Added height at the spec plateau line and at the end of the 25 mm blend, v = 0.1. */
    s4_at_line: number;
    s4_at_blend_end: number;
    arch_hits: number;
    arch_queries: number;
}

/** Straightness of one added-height contour. Used by the bad-change proof. */
export function contourDeviation(
    side: FootSide,
    added: AddedFn,
    fractionOfNominal: number,
    nominal: number,
): number {
    const frame = clinicalFrame(side);
    const points: { x: number; y: number }[] = [];
    for (let x = frame.xCorner; x <= frame.xToe + 1e-6; x += 1) {
        const t = scanOffset(frame, added, x, fractionOfNominal * nominal);
        if (t !== null) points.push(pointFromOffset(frame, x, t));
    }
    return fitLine(points).maxDev;
}

export async function measureShape(side: FootSide, heightMm: number): Promise<ShapeMetrics> {
    const frame = clinicalFrame(side);
    const added = addedHeight(side, heightMm);
    const top = await topSampler(side);
    const xs: number[] = [];
    for (let x = frame.xCorner; x <= frame.xToe + 1e-6; x += 1) xs.push(x);

    const c95: { x: number; y: number }[] = [];
    const c05: { x: number; y: number }[] = [];
    const c99: { x: number; y: number }[] = [];
    const widths: number[] = [];
    for (const x of xs) {
        const t95 = scanOffset(frame, added, x, 0.95 * heightMm);
        const t05 = scanOffset(frame, added, x, 0.05 * heightMm);
        const t99 = scanOffset(frame, added, x, 0.99 * heightMm);
        if (t95 !== null) c95.push(pointFromOffset(frame, x, t95));
        if (t05 !== null) c05.push(pointFromOffset(frame, x, t05));
        if (t99 !== null) c99.push(pointFromOffset(frame, x, t99));
        if (t95 !== null && t05 !== null) widths.push(t05 - t95);
    }
    const fit95 = fitLine(c95);
    const fit05 = fitLine(c05);
    const fit99 = fitLine(c99);
    const width = widthSpreadMm(widths);

    const g3samples: number[] = [];
    for (let x = frame.xFullMin; x <= frame.xToe + 1e-6; x += 1) {
        const onLine = lineAtX(frame, x);
        const vLine = vAtPoint(onLine.x, onLine.y, side);
        for (let v = 0.02; v <= vLine - 0.01; v += 0.02) {
            const p = pointAtUV(x / LENGTH_MM, v, side);
            g3samples.push(added(p.x, p.y));
        }
    }

    const g4 = [0.1, 0.2, 0.3].map((v) => {
        const samples: number[] = [];
        for (let x = frame.xFullMin; x <= frame.xToe + 1e-6; x += 1) {
            const p = pointAtUV(x / LENGTH_MM, v, side);
            samples.push(added(p.x, p.y));
        }
        return { v, fraction: minFraction(samples, heightMm), n: samples.length };
    });

    const rayXs: number[] = [];
    const rayH: number[] = [];
    const rayAdded: number[] = [];
    let hits = 0;
    let queries = 0;
    const xStart = frame.xLine - 60;
    const xEnd = frame.xLine + 40;
    for (let x = xStart; x <= xEnd + 1e-6; x += 0.5) {
        const s = (x - frame.mpj1.x) / frame.dir.x;
        const p = {
            x: frame.mpj1.x + frame.dir.x * s,
            y: frame.mpj1.y + frame.dir.y * s,
        };
        queries++;
        const z = stockZ(top, p.x, p.y);
        if (z === null) continue;
        hits++;
        const add = added(p.x, p.y);
        rayXs.push(x);
        rayH.push(z + add);
        rayAdded.push(add);
    }

    const alongV = (x: number) => {
        const p = pointAtUV(x / LENGTH_MM, 0.1, side);
        return added(p.x, p.y);
    };

    let g8 = 0;
    for (let x = frame.xCorner; x <= frame.xToe + 1e-6; x += 5) {
        const origin = lineAtX(frame, x);
        const samples: { t: number; h: number }[] = [];
        for (let t = -2; t <= 24; t += 0.25) {
            samples.push({
                t,
                h: added(origin.x + frame.lateral.x * t, origin.y + frame.lateral.y * t),
            });
        }
        g8 = Math.max(g8, peakAbsSlope(samples));
    }

    let maxAdded = 0;
    for (let x = frame.xLine; x <= frame.xToe; x += 2) {
        for (let v = 0.02; v <= 0.5; v += 0.02) {
            const p = pointAtUV(x / LENGTH_MM, v, side);
            maxAdded = Math.max(maxAdded, added(p.x, p.y));
        }
    }

    const ang =
        (Math.acos(
            Math.max(-1, Math.min(1, Math.abs(fit99.dir.x * frame.dir.x + fit99.dir.y * frame.dir.y))),
        ) *
            180) /
        Math.PI;

    return {
        side,
        heightMm,
        maxAdded,
        g1_95: fit95.maxDev,
        g1_05: fit05.maxDev,
        g1_95_n: c95.length,
        g1_05_n: c05.length,
        g2_spread: width.spread,
        g2_median: width.median,
        g2_min: width.min,
        g2_max: width.max,
        g2_n: widths.length,
        g3_fraction: minFraction(g3samples, heightMm),
        g3_n: g3samples.length,
        g4,
        g5_rise: riseAfterLocalMinMm(rayH),
        g6_slope: maxSmoothedSlope(rayXs, rayH, 4),
        g6_n: rayH.length,
        g7_start: blendEndMetrics(alongV, frame.xLine),
        g7_end: blendEndMetrics(alongV, frame.xBlendEnd),
        g8_peak: g8,
        s1_angle_deg: Number.isFinite(ang) ? ang : 180,
        s1_mid_dist_mm: distanceToFitMm(fit99, frame.mid),
        s2_bevel_over_8: width.max > 8,
        s4_at_line: alongV(frame.xLine),
        s4_at_blend_end: alongV(frame.xBlendEnd),
        arch_hits: hits,
        arch_queries: queries,
    };
}

export interface MeshMetrics {
    side: FootSide;
    heightMm: number;
    vertices: number;
    outsideDiffer: number;
    /** Vertices whose length or width coordinate changed. The pad may only move thickness. */
    planDiffer: number;
    moved: number;
    /** Max |mesh delta − field| on vertices the mesh actually lifted. */
    g11MaxMm: number;
    g11n: number;
    /** Vertices whose field is near full height but the mesh did not lift. */
    g11Miss: number;
}

export async function measureMesh(side: FootSide, heightMm: number): Promise<MeshMetrics> {
    const top = await topSampler(side);
    const frame3 = top.frame;
    const clinical = clinicalFrame(side);
    const el = placed(side, "mortons_extension", heightMm);
    const field: HeightFieldParams = {
        side,
        lengthMm: LENGTH_MM,
        widthMm: WIDTH_MM,
        thicknessMm: 3,
        corrections: zeroCorrections(),
        elements: [el],
        includeElements: true,
        includeSkives: false,
        trimline: null,
    };
    const before = top.geometry.clone();
    const after = top.geometry.clone();
    await applyElementsToTopMeshLast(after, before, field);
    const a = before.getAttribute("position") as BufferAttribute;
    const b = after.getAttribute("position") as BufferAttribute;
    const added = addedHeight(side, heightMm);
    let outsideDiffer = 0;
    let planDiffer = 0;
    let moved = 0;
    let g11Max = 0;
    let g11n = 0;
    let g11Miss = 0;
    for (let i = 0; i < a.count; i++) {
        const len0 = a.getComponent(i, frame3.lengthAxis);
        const wid0 = a.getComponent(i, frame3.widthAxis);
        const len1 = b.getComponent(i, frame3.lengthAxis);
        const wid1 = b.getComponent(i, frame3.widthAxis);
        const z0 = a.getComponent(i, frame3.thickAxis);
        const z1 = b.getComponent(i, frame3.thickAxis);
        const x = ((len0 - frame3.lenMin) / frame3.lenSize) * LENGTH_MM;
        const meshY = wid0 - frame3.widCenter;
        if (len0 !== len1 || wid0 !== wid1) planDiffer++;
        const thickMoved = z0 !== z1;
        if (thickMoved || len0 !== len1 || wid0 !== wid1) moved++;
        const t = lateralOffset(clinical, { x, y: meshY });
        const inBand = t <= 8 && x >= clinical.xBlendEnd - 0.5 && x <= LENGTH_MM + 1 && t >= -60;
        if (!inBand && (thickMoved || len0 !== len1 || wid0 !== wid1)) outsideDiffer++;
        const pred = added(x, meshY);
        const delta = z1 - z0;
        if (Math.abs(delta) > 0.05) {
            g11n++;
            g11Max = Math.max(g11Max, Math.abs(delta - pred));
        } else if (pred > heightMm * 0.9 && x > clinical.xLine && x < clinical.xToe) {
            g11Miss++;
        }
    }
    before.dispose();
    after.dispose();
    return {
        side,
        heightMm,
        vertices: a.count,
        outsideDiffer,
        planDiffer,
        moved,
        g11MaxMm: g11Max,
        g11n,
        g11Miss,
    };
}

export function sampleTopBytes(): Buffer {
    return readFileSync(SAMPLE_TOP_PATH);
}
