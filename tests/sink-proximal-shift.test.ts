// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { BufferGeometry, type BufferGeometry as BufferGeometryType } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { medialSign } from "@/lib/geometry/handedness";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { heightAt } from "@/lib/geometry/height-field";
import {
    BLEND_LEN_MM,
    FLOOR_MIN_MM,
    applySinkCutToGeometry,
    applySinkThicknessToGeometry,
    footOutlineFromGeometry,
    FOREFOOT_THICKNESS_CLEARANCE_MM,
    SINK_KIND_ORDER,
    SINK_PROFILES,
    SINK_WALL_MIN_MM,
    sinkPlanScale,
    STYLOID_WALL_FADE_BELOW_FLOOR_MM,
    styloidWallReliefAt,
    type SinkOutlinePoint,
} from "@/lib/geometry/sink";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize, scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";
import { buildTrimPresetCurve } from "@/lib/geometry/trim-presets";
import { clipGeometryToOutline, extractMeshOutline } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedSink, Side, SideCorrections, SinkKind } from "@/types";

/**
 * Met heads moved 0.025 u toward the heel. The distal tip of each taper is
 * u + (scaled plateau radius + blend) / L. That tip has to stay proximal of
 * the toe sulcus measured on SAMPLE_Top at the sink's own v.
 */
const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const ARTIFACT = "/opt/cursor/artifacts/sink-proximal-us9-top.png";
const MPJ: readonly SinkKind[] = ["mpj1", "mpj2", "mpj3", "mpj4", "mpj5"];
const HYBRID_X0 = 72;
const HYBRID_X1 = 78;
const EDGE_LIMIT_DEG = 60;
const WEDGE_CREST_DEG = 66;
const SIZES = [1, 16] as const;

type WallStyle = "straight" | "round" | "hybrid";

const report: Record<string, unknown> = {};

function blank(patch: Partial<SideCorrections> = {}): SideCorrections {
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
        ...patch,
    };
}

function sourceField(
    side: Side,
    lengthMm: number,
    widthMm: number,
    patch: Partial<SideCorrections> = {},
    extra: Partial<HeightFieldParams> = {},
): HeightFieldParams {
    return {
        side,
        lengthMm,
        widthMm,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: blank(patch),
        elements: [],
        includeElements: false,
        includeSkives: extra.includeSkives ?? false,
        trimline: null,
        ...extra,
        side,
        lengthMm,
        widthMm,
        corrections: blank(patch),
    };
}

function maxSink(kind: SinkKind): PlacedSink {
    return { id: kind, kind, depthMm: SINK_PROFILES[kind].maxDepthMm };
}

function allMax(): PlacedSink[] {
    return SINK_KIND_ORDER.map((kind) => maxSink(kind));
}

function distalU(kind: SinkKind, lengthMm: number): number {
    const profile = SINK_PROFILES[kind];
    const radius = sinkPlanScale(lengthMm) * (profile.lengthMm / 2);
    return profile.u + (radius + profile.blendMm) / lengthMm;
}

function ySpanAt(points: SinkOutlinePoint[], x: number): { lo: number; hi: number } | null {
    const ys: number[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        const dx = b.x - a.x;
        if (Math.abs(dx) < 1e-8) continue;
        const t = (x - a.x) / dx;
        if (t < -1e-4 || t > 1 + 1e-4) continue;
        ys.push(a.y + Math.min(1, Math.max(0, t)) * (b.y - a.y));
    }
    if (ys.length < 2) return null;
    return { lo: Math.min(...ys), hi: Math.max(...ys) };
}

function lateralOf(span: { lo: number; hi: number }, side: Side): number {
    return medialSign(side) < 0 ? span.hi : span.lo;
}

interface TopSampler {
    pos: Float32Array;
    n: number;
    minX: number;
    maxX: number;
    length: number;
    outline: SinkOutlinePoint[];
    zAt: (u: number, v: number) => number | null;
}

function samplerFor(geo: BufferGeometry, side: Side): TopSampler {
    const pos = geo.getAttribute("position").array as Float32Array;
    const n = pos.length / 3;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = pos[i * 3]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
    }
    const outline = footOutlineFromGeometry(geo);
    if (!outline) throw new Error("SAMPLE_Top has no outline");
    const cell = 2;
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        const key = `${Math.floor(pos[i * 3]! / cell)},${Math.floor(pos[i * 3 + 1]! / cell)}`;
        const list = buckets.get(key);
        if (list) list.push(i);
        else buckets.set(key, [i]);
    }
    const zAt = (u: number, v: number): number | null => {
        const x = minX + u * (maxX - minX);
        const span = ySpanAt(outline, x);
        if (!span) return null;
        const medialY = medialSign(side) < 0 ? span.lo : span.hi;
        const y = medialY + v * (lateralOf(span, side) - medialY);
        const cx = Math.floor(x / cell);
        const cy = Math.floor(y / cell);
        let best = Infinity;
        let z = 0;
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                const list = buckets.get(`${cx + dx},${cy + dy}`);
                if (!list) continue;
                for (const i of list) {
                    const ddx = pos[i * 3]! - x;
                    const ddy = pos[i * 3 + 1]! - y;
                    const d = ddx * ddx + ddy * ddy;
                    if (d < best) {
                        best = d;
                        z = pos[i * 3 + 2]!;
                    }
                }
            }
        }
        return Math.sqrt(best) < 4 ? z : null;
    };
    return { pos, n, minX, maxX, length: maxX - minX, outline, zAt };
}

/**
 * Proximal edge of the toe shelf at this v. The shelf is the median z of the
 * actual toe (u 0.86–0.93). The crease is the first station past u 0.62 whose
 * next 0.035 of length stays within 0.06 mm of that shelf. It is read off
 * SAMPLE_Top, not off a fixed landmark.
 */
function toeCreaseU(sample: TopSampler, v: number): { u: number; shelfZ: number } {
    const samples: Array<{ u: number; z: number }> = [];
    for (let k = 0; k <= 100; k++) {
        const u = 0.55 + (0.42 * k) / 100;
        const z = sample.zAt(u, v);
        if (z != null) samples.push({ u, z });
    }
    if (samples.length < 8) return { u: 1, shelfZ: 2 };
    const toe = samples.filter((s) => s.u >= 0.86 && s.u <= 0.93).map((s) => s.z);
    toe.sort((a, b) => a - b);
    const shelfZ = toe.length ? toe[Math.floor(toe.length / 2)]! : samples[samples.length - 1]!.z;
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i]!;
        if (s.u < 0.62) continue;
        const win = samples.filter((p) => p.u >= s.u && p.u <= s.u + 0.035);
        if (win.length < 4) continue;
        if (win.every((p) => Math.abs(p.z - shelfZ) <= 0.06)) return { u: s.u, shelfZ };
    }
    return { u: samples[samples.length - 1]!.u, shelfZ };
}

function crc32(buf: Buffer): number {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i]!;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}

function writePng(path: string, width: number, height: number, rgb: Uint8Array): void {
    const raw = Buffer.alloc(height * (1 + width * 3));
    for (let y = 0; y < height; y++) {
        const row = y * (1 + width * 3);
        raw[row] = 0;
        const src = y * width * 3;
        for (let x = 0; x < width * 3; x++) raw[row + 1 + x] = rgb[src + x]!;
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", deflateSync(raw)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, png);
}

const GLYPH: Record<string, string[]> = {
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
    "2": ["11110", "00001", "00001", "01110", "10000", "10000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00110", "01010", "10010", "11111", "00010", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
    H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    M: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
    N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
};

function drawText(
    rgb: Uint8Array,
    width: number,
    height: number,
    text: string,
    x: number,
    y: number,
    color: [number, number, number],
    scale = 2,
): void {
    let cx = x;
    for (const ch of text) {
        const rows = GLYPH[ch] ?? GLYPH[" "]!;
        for (let row = 0; row < rows.length; row++) {
            const bits = rows[row]!;
            for (let col = 0; col < bits.length; col++) {
                if (bits[col] !== "1") continue;
                for (let sy = 0; sy < scale; sy++) {
                    for (let sx = 0; sx < scale; sx++) {
                        const px = cx + col * scale + sx;
                        const py = y + row * scale + sy;
                        if (px < 0 || py < 0 || px >= width || py >= height) continue;
                        const o = (py * width + px) * 3;
                        rgb[o] = color[0];
                        rgb[o + 1] = color[1];
                        rgb[o + 2] = color[2];
                    }
                }
            }
        }
        cx += 6 * scale;
    }
}

function paintUs9(left: BufferGeometry, right: BufferGeometry): void {
    const layout = insoleLayoutForUsMenSize(9);
    const feet = [
        { side: "left" as const, geo: scaleGeometryToInsoleSize(left, layout.lengthMm, layout.widthMm), label: "LEFT" },
        { side: "right" as const, geo: scaleGeometryToInsoleSize(right, layout.lengthMm, layout.widthMm), label: "RIGHT" },
    ];
    const panelW = 440;
    const panelH = 560;
    const width = panelW * 2 + 24;
    const height = panelH + 28;
    const rgb = new Uint8Array(width * height * 3);
    rgb.fill(244);
    const ppm = (panelH - 56) / layout.lengthMm;
    feet.forEach((foot, fi) => {
        const pos = foot.geo.getAttribute("position");
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < pos.count; i++) {
            minX = Math.min(minX, pos.getX(i));
            maxX = Math.max(maxX, pos.getX(i));
            minY = Math.min(minY, pos.getY(i));
            maxY = Math.max(maxY, pos.getY(i));
        }
        const ox = 8 + fi * (panelW + 8);
        const oy = 24;
        const toPx = (x: number, y: number) => {
            const px = Math.round(ox + (maxY - y) * ppm + 16);
            const py = Math.round(oy + (maxX - x) * ppm);
            return { px, py };
        };
        for (let i = 0; i < pos.count; i += 2) {
            const { px, py } = toPx(pos.getX(i), pos.getY(i));
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const o = (py * width + px) * 3;
            rgb[o] = 168;
            rgb[o + 1] = 176;
            rgb[o + 2] = 186;
        }
        const outline = footOutlineFromGeometry(foot.geo);
        const L = maxX - minX;
        const s = sinkPlanScale(layout.lengthMm);
        if (outline) {
            for (const kind of [...MPJ, "styloid"] as const) {
                const profile = SINK_PROFILES[kind];
                const x = minX + profile.u * L;
                const span = ySpanAt(outline, x);
                if (!span) continue;
                const medialY = medialSign(foot.side) < 0 ? span.lo : span.hi;
                const lateralY = lateralOf(span, foot.side);
                const y = medialY + profile.v * (lateralY - medialY);
                const rot = kind === "styloid" ? (foot.side === "left" ? 15 : -15) : 0;
                const a0 = s * (profile.lengthMm / 2);
                const b0 = s * (profile.widthMm / 2);
                const pad = profile.blendMm + 2;
                const { px: cx, py: cy } = toPx(x, y);
                const reach = Math.ceil((Math.max(a0, b0) + pad) * ppm) + 2;
                const rad = (rot * Math.PI) / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                for (let py = cy - reach; py <= cy + reach; py++) {
                    for (let px = cx - reach; px <= cx + reach; px++) {
                        if (px < 0 || py < 0 || px >= width || py >= height) continue;
                        const dx = (px - cx) / ppm;
                        const dy = -(py - cy) / ppm;
                        // Screen +x is -meshY (toPx). Undo that for the ellipse.
                        const mx = dy;
                        const my = -dx;
                        const lx = cos * mx + sin * my;
                        const ly = -sin * mx + cos * my;
                        const outer = Math.hypot(lx / (a0 + profile.blendMm), ly / (b0 + profile.blendMm));
                        const inner = Math.hypot(lx / a0, ly / b0);
                        if (outer > 1) continue;
                        const o = (py * width + px) * 3;
                        if (inner <= 1) {
                            rgb[o] = 196;
                            rgb[o + 1] = 24;
                            rgb[o + 2] = 112;
                        } else {
                            rgb[o] = 232;
                            rgb[o + 1] = 150;
                            rgb[o + 2] = 186;
                        }
                    }
                }
            }
        }
        drawText(rgb, width, height, foot.label, ox + 8, 4, [20, 24, 32], 2);
        foot.geo.dispose();
    });
    drawText(rgb, width, height, "US 9", width - 70, 4, [20, 24, 32], 2);
    writePng(ARTIFACT, width, height, rgb);
}

function faceNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] | null {
    const ax = pos[a * 3]!;
    const ay = pos[a * 3 + 1]!;
    const az = pos[a * 3 + 2]!;
    const ux = pos[b * 3]! - ax;
    const uy = pos[b * 3 + 1]! - ay;
    const uz = pos[b * 3 + 2]! - az;
    const vx = pos[c * 3]! - ax;
    const vy = pos[c * 3 + 1]! - ay;
    const vz = pos[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return null;
    return [nx / len, ny / len, nz / len];
}

interface EdgeHit {
    deg: number;
    x: number;
    y: number;
}

function twoFaceEdges(geo: BufferGeometry): Map<string, EdgeHit> {
    const pos = geo.getAttribute("position").array as Float32Array;
    const idx = geo.getIndex()!.array as Uint32Array | Uint16Array;
    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        const abx = pos[b * 3]! - pos[a * 3]!;
        const aby = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
        const abz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
        const acx = pos[c * 3]! - pos[a * 3]!;
        const acy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
        const acz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
        if (Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx) * 0.5 < 1e-8) continue;
        for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = p < q ? `${p},${q}` : `${q},${p}`;
            const faces = edgeFaces.get(k);
            if (faces) faces.push(f);
            else edgeFaces.set(k, [f]);
        }
    }
    const out = new Map<string, EdgeHit>();
    for (const [key, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const [sa, sb] = key.split(",").map(Number) as [number, number];
        if (
            Math.hypot(
                pos[sa * 3]! - pos[sb * 3]!,
                pos[sa * 3 + 1]! - pos[sb * 3 + 1]!,
                pos[sa * 3 + 2]! - pos[sb * 3 + 2]!,
            ) < 0.12
        ) {
            continue;
        }
        const f1 = faces[0]!;
        const f2 = faces[1]!;
        const n1 = faceNormal(pos, idx[f1]!, idx[f1 + 1]!, idx[f1 + 2]!);
        const n2 = faceNormal(pos, idx[f2]!, idx[f2 + 1]!, idx[f2 + 2]!);
        if (!n1 || !n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        out.set(key, {
            deg: (Math.acos(dot) * 180) / Math.PI,
            x: 0.5 * (pos[sa * 3]! + pos[sb * 3]!),
            y: 0.5 * (pos[sa * 3 + 1]! + pos[sb * 3 + 1]!),
        });
    }
    return out;
}

function foldAgainstPlain(
    plain: BufferGeometry,
    sunk: BufferGeometry,
    wall: WallStyle,
    allowCrest: { side: Side; outline: SinkOutlinePoint[]; minX: number; length: number } | null,
): { worst: number; crest: number; sharpened: number; over: number; at: string } {
    const before = twoFaceEdges(plain);
    const after = twoFaceEdges(sunk);
    let worst = 0;
    let crest = 0;
    let sharpened = 0;
    let over = 0;
    let at = "";
    for (const [key, edge] of after) {
        if (wall === "hybrid" && edge.x >= HYBRID_X0 && edge.x <= HYBRID_X1) continue;
        const prior = before.get(key);
        let crestEdge = false;
        if (allowCrest) {
            const span = ySpanAt(allowCrest.outline, edge.x);
            if (span) {
                const dist = Math.abs(edge.y - lateralOf(span, allowCrest.side));
                const u = (edge.x - allowCrest.minX) / allowCrest.length;
                crestEdge = dist <= 3 && u >= 0.02 && u <= 0.98;
            }
        }
        const note = () => {
            over++;
            const text = `${edge.deg.toFixed(2)} prior ${prior ? prior.deg.toFixed(2) : "new"} @${edge.x.toFixed(1)},${edge.y.toFixed(1)}`;
            if (!at || edge.deg > worst) at = text;
        };
        if (prior && prior.deg > EDGE_LIMIT_DEG) {
            const cap = crestEdge ? WEDGE_CREST_DEG : prior.deg + 0.5;
            if (edge.deg > cap) {
                sharpened++;
                note();
            }
            if (crestEdge && edge.deg > crest) crest = edge.deg;
            continue;
        }
        if (crestEdge && edge.deg > EDGE_LIMIT_DEG) {
            if (edge.deg > crest) crest = edge.deg;
            if (edge.deg > WEDGE_CREST_DEG) note();
            continue;
        }
        if (edge.deg > worst) worst = edge.deg;
        if (edge.deg > EDGE_LIMIT_DEG) note();
    }
    return { worst, crest, sharpened, over, at };
}

function boundsOf(geo: BufferGeometry, count: number): { minX: number; maxX: number; minY: number; maxY: number } {
    const pos = geo.getAttribute("position");
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const n = Math.min(count, pos.count);
    for (let i = 0; i < n; i++) {
        minX = Math.min(minX, pos.getX(i));
        maxX = Math.max(maxX, pos.getX(i));
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
    }
    return { minX, maxX, minY, maxY };
}

let pair: { left: BufferGeometry; right: BufferGeometry };

beforeAll(async () => {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    const left = await sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    pair = { left, right: mirrorGeometry(left) };
});

afterAll(() => {
    pair?.left.dispose();
    pair?.right.dispose();
    writeFileSync("/tmp/sink-proximal-report.json", JSON.stringify(report, null, 2));
});

describe("proximal metatarsal shift", () => {
    test("each sink's distal taper stays proximal of the SAMPLE_Top sulcus", () => {
        expect(SINK_PROFILES.mpj1.u).toBeCloseTo(0.665, 5);
        expect(SINK_PROFILES.mpj2.u).toBeCloseTo(0.685, 5);
        expect(SINK_PROFILES.mpj3.u).toBeCloseTo(0.68, 5);
        expect(SINK_PROFILES.mpj4.u).toBeCloseTo(0.665, 5);
        expect(SINK_PROFILES.mpj5.u).toBeCloseTo(0.64, 5);
        expect(SINK_PROFILES.styloid.u).toBeCloseTo(0.42, 5);
        expect(FOREFOOT_THICKNESS_CLEARANCE_MM).toBe(0.5);
        expect(BLEND_LEN_MM).toBe(25);

        const rows: Array<Record<string, number | string>> = [];
        for (const side of ["left", "right"] as const) {
            const sample = samplerFor(pair[side], side);
            const crease = new Map<SinkKind, { u: number; shelfZ: number }>();
            for (const kind of MPJ) crease.set(kind, toeCreaseU(sample, SINK_PROFILES[kind].v));
            for (const size of [...SIZES, 9] as const) {
                const lengthMm = insoleLayoutForUsMenSize(size).lengthMm;
                for (const kind of MPJ) {
                    const end = distalU(kind, lengthMm);
                    const line = crease.get(kind)!;
                    const marginMm = (line.u - end) * lengthMm;
                    rows.push({
                        side,
                        size,
                        kind,
                        distalU: Number(end.toFixed(4)),
                        creaseU: Number(line.u.toFixed(4)),
                        shelfZ: Number(line.shelfZ.toFixed(3)),
                        marginMm: Number(marginMm.toFixed(2)),
                    });
                    if (size === 1 || size === 16) {
                        expect(marginMm, `${side} US ${size} ${kind}`).toBeGreaterThan(0);
                    }
                }
            }
        }
        report.margins = rows;
        console.log("[SINK-SULCUS]", JSON.stringify(rows));
        paintUs9(pair.left, pair.right);
        const tight = rows
            .filter((r) => r.size === 1)
            .sort((a, b) => Number(a.marginMm) - Number(b.marginMm));
        report.tightestSize1 = tight.map((r) => `${r.side} ${r.kind} ${r.marginMm}`);
    });

    test("rim and crest match, the floor holds, and the lateral wall stays at 3 mm", async () => {
        const rows: Array<Record<string, number | string>> = [];
        const worstByWall: Record<string, number> = { straight: 0, round: 0, hybrid: 0 };
        for (const side of ["left", "right"] as const) {
            const raw = pair[side];
            for (const wall of ["straight", "round", "hybrid"] as const) {
                const srcPlain = raw.clone();
                const plain = await reconstructProceduralPreview(srcPlain, { wallStyle: wall, side });
                srcPlain.dispose();
                const srcSunk = raw.clone();
                const sunk = await reconstructProceduralPreview(srcSunk, {
                    wallStyle: wall,
                    side,
                    sinks: allMax(),
                });
                srcSunk.dispose();
                const ud = sunk.geometry.userData as { topVertexCount?: number };
                const topN = ud.topVertexCount ?? 0;
                expect(topN, `${side} ${wall} top`).toBeGreaterThan(1000);
                const outline = footOutlineFromGeometry(plain.geometry, 0, 1, topN);
                expect(outline).toBeTruthy();
                const box = boundsOf(sunk.geometry, topN);
                const length = box.maxX - box.minX;
                const fold = foldAgainstPlain(plain.geometry, sunk.geometry, wall, null);
                const a = plain.geometry.getAttribute("position");
                const b = sunk.geometry.getAttribute("position");
                let xy = 0;
                const nCmp = Math.min(a.count, b.count);
                for (let i = 0; i < nCmp; i++) {
                    xy = Math.max(xy, Math.hypot(a.getX(i) - b.getX(i), a.getY(i) - b.getY(i)));
                }
                let floor = Infinity;
                let insideDz = 0;
                let insideGrow = 0;
                let insideN = 0;
                let lateralMin = Infinity;
                let lateralN = 0;
                let lateralDeficit = 0;
                const cell = 2;
                const topBuckets = new Map<string, number[]>();
                for (let i = 0; i < topN; i++) {
                    const key = `${Math.floor(b.getX(i) / cell)},${Math.floor(b.getY(i) / cell)}`;
                    const list = topBuckets.get(key);
                    if (list) list.push(i);
                    else topBuckets.set(key, [i]);
                }
                const styloid = SINK_PROFILES.styloid;
                for (let i = 0; i < topN; i++) {
                    const x = b.getX(i);
                    const y = b.getY(i);
                    const z = b.getZ(i);
                    if (z < floor) floor = z;
                    const span = ySpanAt(outline!, x);
                    if (!span) continue;
                    const medialY = medialSign(side) < 0 ? span.lo : span.hi;
                    const lateralY = lateralOf(span, side);
                    const edgeDist = Math.min(Math.abs(y - medialY), Math.abs(y - lateralY));
                    const u = (x - box.minX) / length;
                    if (edgeDist <= 1.2 && u >= styloid.u && u <= SINK_PROFILES.mpj5.u && Math.abs(y - lateralY) <= 1.5) {
                        const allowed = a.getZ(i) >= SINK_WALL_MIN_MM ? SINK_WALL_MIN_MM : a.getZ(i);
                        const deficit = allowed - z;
                        if (deficit > lateralDeficit) lateralDeficit = deficit;
                        lateralN++;
                        if (z < lateralMin) lateralMin = z;
                    }
                    if (edgeDist > 1.2) continue;
                    const cx = Math.floor(x / cell);
                    const cy = Math.floor(y / cell);
                    let nearest = Infinity;
                    let nz = z;
                    let neighbor = -1;
                    for (let dx = -2; dx <= 2; dx++) {
                        for (let dy = -2; dy <= 2; dy++) {
                            const list = topBuckets.get(`${cx + dx},${cy + dy}`);
                            if (!list) continue;
                            for (const j of list) {
                                if (j === i) continue;
                                const d = Math.hypot(b.getX(j) - x, b.getY(j) - y);
                                if (d < 0.4 || d > 3) continue;
                                const jSpan = ySpanAt(outline!, b.getX(j));
                                if (!jSpan) continue;
                                const jMed = medialSign(side) < 0 ? jSpan.lo : jSpan.hi;
                                const jLat = lateralOf(jSpan, side);
                                const jDist = Math.min(Math.abs(b.getY(j) - jMed), Math.abs(b.getY(j) - jLat));
                                if (jDist < edgeDist + 0.4) continue;
                                if (d < nearest) {
                                    nearest = d;
                                    nz = b.getZ(j);
                                    neighbor = j;
                                }
                            }
                        }
                    }
                    if (nearest <= 3 && neighbor >= 0) {
                        insideN++;
                        const step = Math.abs(nz - z);
                        const grew = step - Math.abs(a.getZ(neighbor) - a.getZ(i));
                        insideDz = Math.max(insideDz, step);
                        if (grew > insideGrow) insideGrow = grew;
                    }
                }
                rows.push({
                    side,
                    wall,
                    outsideDeg: Number(fold.worst.toFixed(2)),
                    sharpened: fold.sharpened,
                    over: fold.over,
                    xy: Number(xy.toFixed(4)),
                    floor: Number(floor.toFixed(3)),
                    insideDz: Number(insideDz.toFixed(3)),
                    insideGrow: Number(insideGrow.toFixed(3)),
                    insideN,
                    lateralMin: Number(lateralMin.toFixed(3)),
                    lateralDeficit: Number(lateralDeficit.toFixed(3)),
                    lateralN,
                    foldAt: fold.at,
                });
                console.log("[SINK-RIM]", JSON.stringify(rows[rows.length - 1]));
                if (fold.worst > worstByWall[wall]!) worstByWall[wall] = fold.worst;
                plain.geometry.dispose();
                sunk.geometry.dispose();
            }
        }
        report.rim = rows;
        report.worstDihedral = worstByWall;
        for (const row of rows) {
            const label = `${row.side} ${row.wall}`;
            expect(row.over, `${label} edges over 60 ${row.foldAt}`).toBe(0);
            expect(row.sharpened, `${label} stock`).toBe(0);
            expect(row.outsideDeg, label).toBeLessThanOrEqual(EDGE_LIMIT_DEG);
            expect(row.xy, `${label} outline`).toBeLessThan(1e-3);
            expect(row.floor, `${label} floor`).toBeGreaterThanOrEqual(FLOOR_MIN_MM - 1e-3);
            expect(row.insideN, `${label} inside samples`).toBeGreaterThan(20);
            expect(row.insideGrow, `${label} rim vs inside top`).toBeLessThanOrEqual(0.35);
            expect(row.lateralN, `${label} lateral samples`).toBeGreaterThan(0);
            expect(row.lateralDeficit, `${label} lateral crest`).toBeLessThanOrEqual(0.05);
        }
    }, 1_200_000);

    test("thickening, full-length wedge, accommodative arch, and an apex move stay uncreased", async () => {
        const sinks = allMax();
        const patch: Partial<SideCorrections> = {
            archHeightMm: 4,
            apexMoveMm: 8,
            fullLengthWedge: { side: "lateral", value: 5, unit: "deg" },
        };
        const rows: Array<Record<string, number | string>> = [];
        for (const wall of ["straight", "round", "hybrid"] as const) {
            const raw = pair.left;
            const box0 = boundsOf(raw, raw.getAttribute("position").count);
            const field = sourceField("left", box0.maxX - box0.minX, box0.maxY - box0.minY, patch);
            const plainSrc = raw.clone();
            const plain = await reconstructProceduralPreview(plainSrc, {
                wallStyle: wall,
                side: "left",
                deviceType: "accommodative",
                sourceField: field,
                composedTop: true,
            });
            plainSrc.dispose();
            const sunkSrc = raw.clone();
            const sunk = await reconstructProceduralPreview(sunkSrc, {
                wallStyle: wall,
                side: "left",
                deviceType: "accommodative",
                sourceField: { ...field, sinks },
                sinks,
                composedTop: true,
            });
            sunkSrc.dispose();
            const topN = (sunk.geometry.userData as { topVertexCount?: number }).topVertexCount ?? 0;
            const outline = footOutlineFromGeometry(plain.geometry, 0, 1, topN)!;
            const box = boundsOf(sunk.geometry, topN);
            const fold = foldAgainstPlain(plain.geometry, sunk.geometry, wall, {
                side: "left",
                outline,
                minX: box.minX,
                length: box.maxX - box.minX,
            });
            rows.push({
                wall,
                outsideDeg: Number(fold.worst.toFixed(2)),
                crestDeg: Number(fold.crest.toFixed(2)),
                sharpened: fold.sharpened,
                over: fold.over,
            });
            rows[rows.length - 1]!.at = fold.at;
            console.log("[SINK-COMBO]", JSON.stringify(rows[rows.length - 1]));
            plain.geometry.dispose();
            sunk.geometry.dispose();
        }
        report.combo = rows;
        for (const row of rows) {
            expect(row.over, `${row.wall} ${row.at}`).toBe(0);
            expect(row.sharpened, `${row.wall} ${row.at}`).toBe(0);
            expect(row.outsideDeg, String(row.wall)).toBeLessThanOrEqual(EDGE_LIMIT_DEG);
            expect(row.crestDeg, `${row.wall} wedge crest`).toBeLessThanOrEqual(WEDGE_CREST_DEG);
        }
    }, 900_000);

    test("3/4 and sulcus lengths keep a 5 mm skive and the 4 mm wall fade", async () => {
        expect(STYLOID_WALL_FADE_BELOW_FLOOR_MM).toBe(4);
        const depth = SINK_PROFILES.styloid.maxDepthMm;
        const crest = 12;
        const lowering = 2;
        expect(styloidWallReliefAt(crest - depth - STYLOID_WALL_FADE_BELOW_FLOOR_MM, crest, depth, lowering)).toBeCloseTo(
            0,
            5,
        );
        expect(styloidWallReliefAt(crest, crest, depth, lowering)).toBeCloseTo(-lowering, 5);

        const sinks = allMax();
        const skiveRows: Array<Record<string, number | string>> = [];
        for (const preset of ["met_head", "sulcus"] as const) {
            for (const side of ["left", "right"] as const) {
                const trim = buildTrimPresetCurve(preset, { lengthMm: 260, widthMm: 95 });
                const vMed = side === "right" ? -0.7 : 0.7;
                const raised = heightAt(
                    0.08,
                    vMed,
                    sourceField(side, 260, 95, { medialSkiveMm: 5 }, { includeSkives: true, trimline: trim, sinks }),
                );
                const flat = heightAt(
                    0.08,
                    vMed,
                    sourceField(side, 260, 95, { medialSkiveMm: 0 }, { includeSkives: true, trimline: trim, sinks }),
                );
                const bare = heightAt(
                    0.08,
                    vMed,
                    sourceField(side, 260, 95, { medialSkiveMm: 5 }, { includeSkives: true, trimline: trim }),
                );
                const bareFlat = heightAt(
                    0.08,
                    vMed,
                    sourceField(side, 260, 95, {}, { includeSkives: true, trimline: trim }),
                );
                const delta = raised - flat;
                skiveRows.push({
                    preset,
                    side,
                    deltaMm: Number(delta.toFixed(3)),
                    sinkShiftMm: Number((delta - (bare - bareFlat)).toFixed(3)),
                });
                expect(delta, `${preset} ${side} 5 mm skive`).toBeGreaterThan(0.2);
                expect(Math.abs(delta - (bare - bareFlat)), `${preset} ${side} skive vs sinks`).toBeLessThan(0.05);
            }
        }

        const loftRows: Array<Record<string, number | string>> = [];
        for (const preset of ["met_head", "sulcus"] as const) {
            for (const side of ["left", "right"] as const) {
                const raw = pair[side];
                const meshTrim = extractMeshOutline(raw, 64);
                expect(meshTrim, side).toBeTruthy();
                const box0 = boundsOf(raw, raw.getAttribute("position").count);
                const lengthMm = box0.maxX - box0.minX;
                const trim = buildTrimPresetCurve(preset, {
                    lengthMm,
                    widthMm: box0.maxY - box0.minY,
                    baseCurve: meshTrim!,
                });
                const clipped = clipGeometryToOutline(raw, trim);
                const cb = boundsOf(clipped, clipped.getAttribute("position").count);
                const clipN = clipped.getAttribute("position").count;
                const landmarkU = preset === "sulcus" ? 0.72 : 0.66;
                const clipMsg = `${preset} ${side} clip n=${clipN} x ${cb.minX.toFixed(1)}-${cb.maxX.toFixed(1)} y ${cb.minY.toFixed(1)}-${cb.maxY.toFixed(1)}`;
                expect(clipN, clipMsg).toBeGreaterThan(1000);
                expect(cb.minX, clipMsg).toBeLessThan(box0.minX + 5);
                expect(Math.abs(cb.maxX - (box0.minX + landmarkU * lengthMm)), clipMsg).toBeLessThan(8);
                const sunk = clipped.clone();
                const ctx = {
                    side,
                    lengthMm,
                    widthMm: box0.maxY - box0.minY,
                    sinks,
                    medialYSign: medialSign(side),
                };
                applySinkThicknessToGeometry(sunk, clipped, ctx);
                applySinkCutToGeometry(sunk, clipped, ctx);
                const pos = sunk.getAttribute("position");
                const ref = clipped.getAttribute("position");
                let floor = Infinity;
                let bandFloor = Infinity;
                let bandN = 0;
                let xy = 0;
                for (let i = 0; i < pos.count; i++) {
                    const z = pos.getZ(i);
                    if (z < floor) floor = z;
                    xy = Math.max(xy, Math.hypot(pos.getX(i) - ref.getX(i), pos.getY(i) - ref.getY(i)));
                    if (pos.getX(i) < cb.maxX - 5) continue;
                    bandN++;
                    if (z < bandFloor) bandFloor = z;
                }
                loftRows.push({
                    preset,
                    side,
                    floor: Number(floor.toFixed(3)),
                    bandFloor: Number(bandFloor.toFixed(3)),
                    bandN,
                    xy: Number(xy.toFixed(4)),
                    cutErrMm: Number((cb.maxX - (box0.minX + landmarkU * lengthMm)).toFixed(2)),
                });
                console.log("[SINK-TRIM]", JSON.stringify(loftRows[loftRows.length - 1]));
                expect(floor, `${preset} ${side} floor`).toBeGreaterThanOrEqual(FLOOR_MIN_MM - 1e-3);
                expect(bandN, `${preset} ${side} 5 mm band`).toBeGreaterThan(10);
                expect(bandFloor, `${preset} ${side} 5 mm band floor`).toBeGreaterThanOrEqual(FLOOR_MIN_MM - 1e-3);
                expect(xy, `${preset} ${side} outline`).toBeLessThan(1e-3);
                clipped.dispose();
                sunk.dispose();
            }
        }
        report.skive = skiveRows;
        report.trim = loftRows;
    }, 900_000);

    test("width ±5 mm and the toe-fairing wedge stay uncreased", async () => {
        const sinks = allMax();
        const raw = pair.left;
        const box0 = boundsOf(raw, raw.getAttribute("position").count);
        const lengthMm = box0.maxX - box0.minX;
        const widthMm = box0.maxY - box0.minY;
        const rows: Array<Record<string, number | string>> = [];

        const loft = async (wall: WallStyle, patch: Partial<SideCorrections>, withSinks: boolean) => {
            const src = raw.clone();
            const built = await reconstructProceduralPreview(src, {
                wallStyle: wall,
                side: "left",
                ...(withSinks ? { sinks } : {}),
                sourceField: sourceField("left", lengthMm, widthMm, patch, withSinks ? { sinks } : {}),
                composedTop: true,
            });
            src.dispose();
            return built.geometry;
        };

        const spanAtU = (geo: BufferGeometryType, u: number) => {
            const topN = (geo.userData as { topVertexCount?: number }).topVertexCount ?? 0;
            const pos = geo.getAttribute("position");
            let minX = Infinity;
            let maxX = -Infinity;
            for (let i = 0; i < topN; i++) {
                minX = Math.min(minX, pos.getX(i));
                maxX = Math.max(maxX, pos.getX(i));
            }
            const x = minX + u * (maxX - minX);
            let lo = Infinity;
            let hi = -Infinity;
            let n = 0;
            for (let i = 0; i < topN; i++) {
                if (Math.abs(pos.getX(i) - x) > 1.5) continue;
                lo = Math.min(lo, pos.getY(i));
                hi = Math.max(hi, pos.getY(i));
                n++;
            }
            return { width: n ? hi - lo : 0, n };
        };

        const base = await loft("straight", {}, true);
        const widePlain = await loft("straight", { forefootWidthMm: 5 }, false);
        const wide = await loft("straight", { forefootWidthMm: 5 }, true);
        const narrowPlain = await loft("straight", { forefootWidthMm: -5 }, false);
        const narrow = await loft("straight", { forefootWidthMm: -5 }, true);
        const fairPlain = await loft(
            "straight",
            { forefootWidthMm: 5, fullLengthWedge: { side: "lateral", value: 5, unit: "deg" } },
            false,
        );
        const faired = await loft(
            "straight",
            { forefootWidthMm: 5, fullLengthWedge: { side: "lateral", value: 5, unit: "deg" } },
            true,
        );
        const roundPlain = await loft("round", { forefootWidthMm: 5 }, false);
        const roundWide = await loft("round", { forefootWidthMm: 5 }, true);

        const baseMid = spanAtU(base, 0.7);
        const wideMid = spanAtU(wide, 0.7);
        const fairMid = spanAtU(faired, 0.7);
        const baseToe = spanAtU(base, 0.99);
        const fairToe = spanAtU(faired, 0.99);
        const cases = [
            ["straight-width-5", widePlain, wide, false],
            ["straight-width-m5", narrowPlain, narrow, false],
            ["straight-width-5-wedge", fairPlain, faired, true],
            ["round-width-5", roundPlain, roundWide, false],
        ] as const;
        for (const [name, plain, geo, crest] of cases) {
            const topN = (geo.userData as { topVertexCount?: number }).topVertexCount ?? 0;
            const outline = footOutlineFromGeometry(plain, 0, 1, topN);
            const box = boundsOf(geo, topN);
            const fold = foldAgainstPlain(
                plain,
                geo,
                name.startsWith("round") ? "round" : "straight",
                crest && outline
                    ? { side: "left", outline, minX: box.minX, length: box.maxX - box.minX }
                    : null,
            );
            rows.push({
                name,
                worstDeg: Number(fold.worst.toFixed(2)),
                crestDeg: Number(fold.crest.toFixed(2)),
                over: fold.over,
                at: fold.at,
            });
            plain.dispose();
            geo.dispose();
        }
        const midGain = wideMid.width - baseMid.width;
        const toeGain = fairToe.width - baseToe.width;
        const midFairGain = fairMid.width - baseMid.width;
        rows.push({
            name: "fairing",
            midGain: Number(midGain.toFixed(2)),
            midFairGain: Number(midFairGain.toFixed(2)),
            toeGain: Number(toeGain.toFixed(2)),
        });
        console.log("[SINK-WIDTH]", JSON.stringify(rows));
        report.width = rows;
        for (const row of rows) {
            if (row.name === "fairing") continue;
            expect(row.over, `${row.name} ${row.at}`).toBe(0);
            expect(row.worstDeg, String(row.name)).toBeLessThanOrEqual(EDGE_LIMIT_DEG);
            if (row.name === "straight-width-5-wedge") {
                expect(row.crestDeg, String(row.name)).toBeLessThanOrEqual(WEDGE_CREST_DEG);
            }
        }
        expect(baseMid.n).toBeGreaterThan(5);
        expect(midGain, "width +5 at u 0.70").toBeGreaterThan(6);
        expect(midFairGain, "wedge still widens the forefoot").toBeGreaterThan(6);
        // The wedge eases the plan shift onto the toe hold, so the tip moves less than the met row.
        expect(toeGain, "toe hold").toBeLessThan(midGain - 3);
        base.dispose();
    }, 900_000);
});
