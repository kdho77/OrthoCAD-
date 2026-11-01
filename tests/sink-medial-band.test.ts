// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, test } from "@rstest/core";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { BASE_REFERENCE_THICKNESS_MM, getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    composePrintSolidTop,
    composeViewerPrintSolidTop,
} from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import {
    applyFloorGuard,
    applySinkCutToGeometry,
    applySinkThicknessToGeometry,
    footOutlineFromGeometry,
    meshYToAnatomical,
    SINK_KIND_ORDER,
    SINK_PROFILES,
    type SinkOutlinePoint,
    sinkCutMm,
    sinkThicknessMm,
} from "@/lib/geometry/sink";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, PlacedSink, Side, SideCorrections, SinkKind } from "@/types";

/**
 * SHA-256 of geometryToBinarySTL(reconstructProceduralPreview) on the rebased
 * head before the medial-fade change. Straight Men's 9, left foot.
 */
const PARITY_SHA256: Record<string, string> = {
    "no-sink": "22e79065d8ddfcea62036660ef9272d33aa018f03915365ffeeb6fe395c28cae",
    wedges: "25b16994ed440fe176efda099829ec9b28d33f1f7e3ca1b4eef070c1eb50f98d",
    "regional-wedge": "cc2c14d7dced00b9c459c1d03172f65942e3e18de4ccc1b4e0366ac8623e6622",
    "met-pad": "4bfbef1bb093d56d015408b73a16f75fd0a5f1584918caf690160c5d2c15ba14",
    width: "890b39682b193a2750c521c7084cf1e1aa72b13d0fb928a0743732c35965736c",
    "full-length-wedge": "b217e3b6a099beff8c1fdec69722459a9122d6bb81a9804c478b9637ee652056",
};

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const HYBRID_X0 = 72;
const HYBRID_X1 = 78;
const EDGE_LIMIT_DEG = 60;
const U0 = 0.64;
const U1 = 0.72;
const MEDIAL_BAND_MM = 12;

type WallStyle = "straight" | "round" | "hybrid";

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

function field(
    side: Side,
    corrections: SideCorrections,
    extra: Partial<HeightFieldParams> = {},
): HeightFieldParams {
    return {
        side,
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections,
        elements: [],
        includeElements: false,
        includeSkives: false,
        trimline: null,
        ...extra,
    };
}

function sha256Stl(geo: BufferGeometry): string {
    return createHash("sha256")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
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
    writeFileSync(path, png);
}

/** Low values are blue and high values are red, matching the preview heatmap. */
function heatColor(t: number): [number, number, number] {
    const x = Math.max(0, Math.min(1, t));
    const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 3)));
    const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 2)));
    const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 1)));
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

const GLYPH: Record<string, string[]> = {
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
    I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
    H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
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

interface Shot {
    side: Side;
    name: string;
    x: Float32Array;
    y: Float32Array;
    z0: Float32Array;
    z1: Float32Array;
}

function orderedFeet(shots: Shot[], name: string): Shot[] {
    return shots
        .filter((s) => s.name === name)
        .sort((a, b) => (a.side === "left" ? 0 : 1) - (b.side === "left" ? 0 : 1));
}

/** Toes up, both feet. Each pixel keeps the nearest top vertex so the taper is solid out to the rim. */
function paintHeatmap(shots: Shot[], path: string): void {
    const feet = orderedFeet(shots, "all-max");
    if (feet.length < 2) return;
    const ppm = 4;
    const pad = 36;
    const gap = 36;
    const labelH = 22;
    const radiusPx = Math.ceil(2.2 * ppm);
    const radius2 = radiusPx * radiusPx;
    const boxes = feet.map((s) => {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < s.x.length; i++) {
            minX = Math.min(minX, s.x[i]!);
            maxX = Math.max(maxX, s.x[i]!);
            minY = Math.min(minY, s.y[i]!);
            maxY = Math.max(maxY, s.y[i]!);
        }
        return { s, minX, maxX, minY, maxY };
    });
    const fw = Math.max(...boxes.map((b) => Math.ceil((b.maxY - b.minY) * ppm)));
    const fh = Math.max(...boxes.map((b) => Math.ceil((b.maxX - b.minX) * ppm)));
    const width = pad * 2 + fw * feet.length + gap * (feet.length - 1);
    const rowH = labelH + fh + 8;
    const height = pad + rowH * 2;
    const rgb = new Uint8Array(width * height * 3);
    rgb.fill(14);
    const modes = ["z", "net"] as const;
    modes.forEach((mode, row) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const b of boxes) {
            for (let i = 0; i < b.s.x.length; i++) {
                const v = mode === "z" ? b.s.z1[i]! : b.s.z1[i]! - b.s.z0[i]!;
                lo = Math.min(lo, v);
                hi = Math.max(hi, v);
            }
        }
        const span = Math.max(1e-3, hi - lo);
        const originY = pad + row * rowH;
        drawText(
            rgb,
            width,
            height,
            mode === "z" ? "TOP Z  ALL-MAX" : "NET  ALL-MAX",
            pad,
            originY,
            [220, 220, 230],
            2,
        );
        boxes.forEach((b, fi) => {
            const ox = pad + fi * (fw + gap);
            const oy = originY + labelH;
            const nearest = new Float32Array(fw * fh);
            const dist = new Float32Array(fw * fh);
            nearest.fill(Number.NaN);
            dist.fill(1e9);
            for (let i = 0; i < b.s.x.length; i++) {
                const px = Math.round((b.s.y[i]! - b.minY) * ppm);
                const py = Math.round((b.maxX - b.s.x[i]!) * ppm);
                const v = mode === "z" ? b.s.z1[i]! : b.s.z1[i]! - b.s.z0[i]!;
                const y0 = Math.max(0, py - radiusPx);
                const y1 = Math.min(fh - 1, py + radiusPx);
                const x0 = Math.max(0, px - radiusPx);
                const x1 = Math.min(fw - 1, px + radiusPx);
                for (let y = y0; y <= y1; y++) {
                    const dy = y - py;
                    for (let x = x0; x <= x1; x++) {
                        const dx = x - px;
                        const d2 = dx * dx + dy * dy;
                        if (d2 > radius2) continue;
                        const k = y * fw + x;
                        if (d2 < dist[k]!) {
                            dist[k] = d2;
                            nearest[k] = v;
                        }
                    }
                }
            }
            for (let y = 0; y < fh; y++) {
                for (let x = 0; x < fw; x++) {
                    const v = nearest[y * fw + x]!;
                    if (Number.isNaN(v)) continue;
                    const [r, g, c] = heatColor((v - lo) / span);
                    const o = ((oy + y) * width + (ox + x)) * 3;
                    rgb[o] = r;
                    rgb[o + 1] = g;
                    rgb[o + 2] = c;
                }
            }
            drawText(rgb, width, height, b.s.side === "left" ? "L" : "R", ox + 4, oy + 4, [255, 255, 255], 2);
        });
    });
    writePng(path, width, height, rgb);
}

function paintSection(shots: Shot[], path: string): void {
    const want = ["mpj1-4", "mpj5-4", "all-max"].flatMap((name) => orderedFeet(shots, name));
    if (!want.length) return;
    const width = 980;
    const rowH = 200;
    const height = rowH * want.length;
    const rgb = new Uint8Array(width * height * 3);
    rgb.fill(248);
    want.forEach((s, row) => {
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < s.x.length; i++) {
            minX = Math.min(minX, s.x[i]!);
            maxX = Math.max(maxX, s.x[i]!);
        }
        const targetU = s.name === "mpj5-4" ? 0.66 : 0.69;
        const xTarget = minX + targetU * (maxX - minX);
        let station = xTarget;
        let best = Infinity;
        for (let i = 0; i < s.x.length; i++) {
            const d = Math.abs(s.x[i]! - xTarget);
            if (d < best) {
                best = d;
                station = s.x[i]!;
            }
        }
        const bins = new Map<number, { y: number; net: number; dx: number }>();
        for (let i = 0; i < s.x.length; i++) {
            const dx = Math.abs(s.x[i]! - station);
            if (dx > 1.6) continue;
            const y = s.y[i]!;
            const key = Math.round(y / 0.8);
            const prev = bins.get(key);
            if (prev && prev.dx <= dx) continue;
            bins.set(key, { y, net: s.z1[i]! - s.z0[i]!, dx });
        }
        const pts = [...bins.values()].sort((p, q) => p.y - q.y);
        const top = row * rowH;
        const label =
            s.name === "all-max"
                ? `${s.side === "left" ? "L" : "R"} ALL-MAX`
                : `${s.side === "left" ? "L" : "R"} ${s.name.toUpperCase()}`;
        drawText(rgb, width, height, label, 16, top + 8, [30, 40, 60], 2);
        if (pts.length < 2) return;
        const y0 = pts[0]!.y;
        const y1 = pts[pts.length - 1]!.y;
        let nMin = 0;
        let nMax = 0.5;
        for (const p of pts) {
            nMin = Math.min(nMin, p.net);
            nMax = Math.max(nMax, p.net);
        }
        const plotL = 28;
        const plotR = width - 20;
        const plotT = top + 36;
        const plotB = top + rowH - 16;
        const yOf = (y: number) => plotL + ((y - y0) / Math.max(1e-3, y1 - y0)) * (plotR - plotL);
        const zOf = (z: number) => plotB - ((z - nMin) / Math.max(1e-3, nMax - nMin)) * (plotB - plotT);
        const zeroY = Math.round(zOf(0));
        for (let x = plotL; x < plotR; x++) {
            const o = (zeroY * width + x) * 3;
            rgb[o] = 190;
            rgb[o + 1] = 190;
            rgb[o + 2] = 190;
        }
        const stamp = (x: number, y: number) => {
            for (let dy = -1; dy <= 1; dy++) {
                const py = y + dy;
                if (x < 0 || py < 0 || x >= width || py >= height) continue;
                const o = (py * width + x) * 3;
                rgb[o] = 20;
                rgb[o + 1] = 80;
                rgb[o + 2] = 170;
            }
        };
        for (let k = 1; k < pts.length; k++) {
            if (pts[k]!.y - pts[k - 1]!.y > 2.4) continue;
            const xA = Math.round(yOf(pts[k - 1]!.y));
            const yA = Math.round(zOf(pts[k - 1]!.net));
            const xB = Math.round(yOf(pts[k]!.y));
            const yB = Math.round(zOf(pts[k]!.net));
            const steps = Math.max(1, Math.abs(xB - xA), Math.abs(yB - yA));
            for (let t = 0; t <= steps; t++) {
                stamp(Math.round(xA + ((xB - xA) * t) / steps), Math.round(yA + ((yB - yA) * t) / steps));
            }
        }
    });
    writePng(path, width, height, rgb);
}

async function loadPair(): Promise<{ left: BufferGeometry; right: BufferGeometry }> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    const left = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    return { left, right: mirrorGeometry(left) };
}

function ySpanAt(points: SinkOutlinePoint[], x: number): { lo: number; hi: number } | null {
    const ys: number[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        const dx = b.x - a.x;
        if (Math.abs(dx) < 1e-8) {
            if (Math.abs(a.x - x) <= 1e-3) ys.push(a.y, b.y);
            continue;
        }
        const t = (x - a.x) / dx;
        if (t < -1e-4 || t > 1 + 1e-4) continue;
        const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
        ys.push(a.y + clamped * (b.y - a.y));
    }
    if (ys.length === 0) return null;
    let lo = ys[0]!;
    let hi = ys[0]!;
    for (const y of ys) {
        if (y < lo) lo = y;
        if (y > hi) hi = y;
    }
    return { lo, hi };
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

function triArea(pos: Float32Array, idx: ArrayLike<number>, f: number): number {
    const a = idx[f]!;
    const b = idx[f + 1]!;
    const c = idx[f + 2]!;
    const ux = pos[b * 3]! - pos[a * 3]!;
    const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!;
    const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
    const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
}

interface EdgeHit {
    deg: number;
    x: number;
    y: number;
}

/** Every two-face edge longer than 0.12 mm. Shorter edges are degenerate. */
function twoFaceEdges(geo: BufferGeometry): Map<string, EdgeHit> {
    const pos = geo.getAttribute("position").array as Float32Array;
    const idx = geo.getIndex()!.array as Uint32Array | Uint16Array;
    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = p < q ? `${p},${q}` : `${q},${p}`;
            let faces = edgeFaces.get(k);
            if (!faces) {
                faces = [];
                edgeFaces.set(k, faces);
            }
            faces.push(f);
        }
    }
    const out = new Map<string, EdgeHit>();
    for (const [key, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const f1 = faces[0]!;
        const f2 = faces[1]!;
        if (triArea(pos, idx, f1) < 1e-8 || triArea(pos, idx, f2) < 1e-8) continue;
        const [sa, sb] = key.split(",").map(Number) as [number, number];
        const elen = Math.hypot(
            pos[sa * 3]! - pos[sb * 3]!,
            pos[sa * 3 + 1]! - pos[sb * 3 + 1]!,
            pos[sa * 3 + 2]! - pos[sb * 3 + 2]!,
        );
        if (elen < 0.12) continue;
        const n1 = faceNormal(pos, idx[f1]!, idx[f1 + 1]!, idx[f1 + 2]!);
        const n2 = faceNormal(pos, idx[f2]!, idx[f2 + 1]!, idx[f2 + 2]!);
        if (!n1 || !n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        const deg = (Math.acos(dot) * 180) / Math.PI;
        out.set(key, {
            deg,
            x: 0.5 * (pos[sa * 3]! + pos[sb * 3]!),
            y: 0.5 * (pos[sa * 3 + 1]! + pos[sb * 3 + 1]!),
        });
    }
    return out;
}

/**
 * Dihedral of every two-face edge outside Hybrid's x 72–78 crease.
 * An edge that is already steeper than 60° on the unsunk solid is the stock
 * crease (the mirrored right hybrid crease sits at x 71.74). It must not get
 * sharper. Every other edge stays at or under 60°.
 */
function foldAgainstPlain(
    plain: BufferGeometry,
    sunk: BufferGeometry,
    wall: WallStyle,
): { worst: number; checked: number; stock: number; sharpened: number; worstX: number } {
    const before = twoFaceEdges(plain);
    const after = twoFaceEdges(sunk);
    let worst = 0;
    let worstX = 0;
    let checked = 0;
    let stock = 0;
    let sharpened = 0;
    for (const [key, edge] of after) {
        if (wall === "hybrid" && edge.x >= HYBRID_X0 && edge.x <= HYBRID_X1) continue;
        const prior = before.get(key);
        if (prior && prior.deg > EDGE_LIMIT_DEG) {
            stock++;
            if (edge.deg > prior.deg + 0.5) sharpened++;
            continue;
        }
        checked++;
        if (edge.deg > worst) {
            worst = edge.deg;
            worstX = edge.x;
        }
    }
    return { worst, checked, stock, sharpened, worstX };
}

function maxSink(kind: SinkKind): PlacedSink {
    return { id: kind, kind, depthMm: SINK_PROFILES[kind].maxDepthMm };
}

describe("sink taper reaches the medial and lateral outline", () => {
    test("top stays above plain inside 12 mm, the floor guard stays idle, and every edge is at most 60", async () => {
        const pair = await loadPair();
        const sections: Array<Record<string, unknown>> = [];
        const shots: Shot[] = [];
        try {
            for (const side of ["left", "right"] as const) {
                const raw = pair[side];
                for (const wall of ["straight", "round", "hybrid"] as const) {
                    const plain = await reconstructProceduralPreview(raw, { wallStyle: wall, side });
                    const plainUd = plain.geometry.userData as {
                        topVertexCount?: number;
                        loftN?: number;
                        medialYSign?: 1 | -1;
                    };
                    const topN = plainUd.topVertexCount ?? 0;
                    const loftBefore = plainUd.loftN ?? 0;
                    const medialYSign = (plainUd.medialYSign ?? 1) as 1 | -1;
                    const outline = footOutlineFromGeometry(plain.geometry, 0, 1, topN);
                    expect(outline, `${side} ${wall} outline`).toBeTruthy();
                    const a = plain.geometry.getAttribute("position");
                    let minX = Infinity;
                    let maxX = -Infinity;
                    let minY = Infinity;
                    let maxY = -Infinity;
                    for (let i = 0; i < topN; i++) {
                        minX = Math.min(minX, a.getX(i));
                        maxX = Math.max(maxX, a.getX(i));
                        minY = Math.min(minY, a.getY(i));
                        maxY = Math.max(maxY, a.getY(i));
                    }
                    const lengthMm = Math.max(1e-3, maxX - minX);
                    const cases: Array<{ name: string; sinks: PlacedSink[] }> = [
                        { name: "mpj1-2", sinks: [{ id: "mpj1", kind: "mpj1", depthMm: 2 }] },
                        { name: "mpj1-4", sinks: [{ id: "mpj1", kind: "mpj1", depthMm: 4 }] },
                        { name: "mpj5-4", sinks: [{ id: "mpj5", kind: "mpj5", depthMm: 4 }] },
                        {
                            name: "all-max",
                            sinks: SINK_KIND_ORDER.map((kind) => maxSink(kind)),
                        },
                    ];
                    for (const c of cases) {
                        const sunk = await reconstructProceduralPreview(raw, {
                            wallStyle: wall,
                            side,
                            sinks: c.sinks,
                        });
                        const sunkUd = sunk.geometry.userData as { loftN?: number; topVertexCount?: number };
                        const loftAfter = sunkUd.loftN ?? 0;
                        const fold = foldAgainstPlain(plain.geometry, sunk.geometry, wall);
                        sections.push({
                            side,
                            wall,
                            sink: c.name,
                            loftNBefore: loftBefore,
                            loftNAfter: loftAfter,
                            topN,
                            edges: fold.checked,
                            stockCrease: fold.stock,
                            outsideDeg: Number(fold.worst.toFixed(2)),
                            worstX: Number(fold.worstX.toFixed(2)),
                        });
                        console.log("[SINK-FOLD]", JSON.stringify(sections[sections.length - 1]));
                        expect(loftAfter, `${side} ${wall} ${c.name} sections`).toBe(loftBefore);
                        expect(fold.checked, `${side} ${wall} ${c.name} edges`).toBeGreaterThan(1000);
                        expect(fold.sharpened, `${side} ${wall} ${c.name} stock crease`).toBe(0);
                        expect(fold.worst, `${side} ${wall} ${c.name}`).toBeLessThanOrEqual(EDGE_LIMIT_DEG);

                        {
                            const b = sunk.geometry.getAttribute("position");
                            const ctx = {
                                side,
                                lengthMm,
                                widthMm: Math.max(1e-3, maxY - minY),
                                sinks: c.sinks,
                                medialYSign,
                                footOutline: outline,
                            };
                            let band = 0;
                            let below = 0;
                            let worstBelow = 0;
                            let floorHits = 0;
                            let xy = 0;
                            let bottomMoved = 0;
                            let outlineCut = 0;
                            const idx = plain.geometry.getIndex()!.array as Uint32Array | Uint16Array;
                            const limit = Math.min(
                                topN,
                                a.count,
                                b.count,
                                plain.geometry.getAttribute("position").count,
                            );
                            for (let i = 0; i < a.count; i++) {
                                xy = Math.max(xy, Math.hypot(a.getX(i) - b.getX(i), a.getY(i) - b.getY(i)));
                                if (a.getZ(i) <= 1e-3 && Math.abs(b.getZ(i) - a.getZ(i)) > 1e-3)
                                    bottomMoved++;
                            }
                            for (let i = 0; i < limit; i++) {
                                const x = a.getX(i);
                                const y = a.getY(i);
                                const span = ySpanAt(outline!, x);
                                if (!span) continue;
                                const medialY = medialYSign > 0 ? span.hi : span.lo;
                                const lateralY = medialYSign > 0 ? span.lo : span.hi;
                                const dist = Math.min(Math.abs(y - medialY), Math.abs(y - lateralY));
                                if (dist > MEDIAL_BAND_MM + 1e-6) continue;
                                band++;
                                const z0 = a.getZ(i);
                                const z1 = b.getZ(i);
                                const drop = z0 - z1;
                                if (drop > worstBelow) worstBelow = drop;
                                if (z1 < z0 - 1e-3) below++;
                                const yAnat = meshYToAnatomical(y, side, medialYSign);
                                const cut = sinkCutMm(x, yAnat, ctx);
                                const thick = sinkThicknessMm(x, yAnat, ctx);
                                const guarded = applyFloorGuard(z0 + thick, cut.mm, cut.sinkId);
                                if (cut.mm > 1e-6 && guarded.cutMm < cut.mm - 1e-6) floorHits++;
                                const u = (x - minX) / lengthMm;
                                if (u >= U0 && u <= U1 && dist <= 1.5 && cut.mm > 0.05) outlineCut++;
                            }
                            let boundary = 0;
                            let zeroArea = 0;
                            let bottomFaces = 0;
                            let bottomUp = 0;
                            const edgeCount = new Map<string, number>();
                            const pos = b.array as Float32Array;
                            for (let f = 0; f < idx.length; f += 3) {
                                const tri = [idx[f]!, idx[f + 1]!, idx[f + 2]!];
                                const area = triArea(pos, idx, f);
                                if (area < 1e-8) zeroArea++;
                                const zA = pos[tri[0]! * 3 + 2]!;
                                const zB = pos[tri[1]! * 3 + 2]!;
                                const zC = pos[tri[2]! * 3 + 2]!;
                                if (zA <= 1e-3 && zB <= 1e-3 && zC <= 1e-3) {
                                    bottomFaces++;
                                    const n = faceNormal(pos, tri[0]!, tri[1]!, tri[2]!);
                                    if (n && n[2] >= 0) bottomUp++;
                                }
                                for (const [p, q] of [
                                    [tri[0]!, tri[1]!],
                                    [tri[1]!, tri[2]!],
                                    [tri[2]!, tri[0]!],
                                ] as const) {
                                    const k = p < q ? `${p},${q}` : `${q},${p}`;
                                    edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
                                }
                            }
                            for (const n of edgeCount.values()) if (n !== 2) boundary++;
                            let rimWorst = 0;
                            let rimEdges = 0;
                            const edges = twoFaceEdges(sunk.geometry);
                            for (const edge of edges.values()) {
                                if (wall === "hybrid" && edge.x >= HYBRID_X0 && edge.x <= HYBRID_X1) continue;
                                const u = (edge.x - minX) / lengthMm;
                                if (u < 0.55 || u > 0.8) continue;
                                const span = ySpanAt(outline!, edge.x);
                                if (!span) continue;
                                const medialY = medialYSign > 0 ? span.hi : span.lo;
                                const lateralY = medialYSign > 0 ? span.lo : span.hi;
                                const dist = Math.min(
                                    Math.abs(edge.y - medialY),
                                    Math.abs(edge.y - lateralY),
                                );
                                if (dist > 2) continue;
                                if (edge.deg > rimWorst) rimWorst = edge.deg;
                                rimEdges++;
                            }
                            console.log(
                                "[SINK-EDGE]",
                                JSON.stringify({
                                    side,
                                    wall,
                                    sink: c.name,
                                    band,
                                    below,
                                    worstBelowMm: Number(worstBelow.toFixed(3)),
                                    floorHits,
                                    outlineCut,
                                    xyMm: Number(xy.toFixed(4)),
                                    bottomMoved,
                                    boundary,
                                    zeroArea,
                                    bottomFaces,
                                    bottomUp,
                                    rimEdges,
                                    rimWorst: Number(rimWorst.toFixed(2)),
                                    loftNBefore: loftBefore,
                                    loftNAfter: loftAfter,
                                }),
                            );
                            expect(band, `${side} ${wall} ${c.name} band`).toBeGreaterThan(10);
                            expect(below, `${side} ${wall} ${c.name} below plain`).toBe(0);
                            expect(floorHits, `${side} ${wall} ${c.name} floor`).toBe(0);
                            expect(xy, `${side} ${wall} ${c.name} outline xy`).toBeLessThanOrEqual(1e-4);
                            expect(bottomMoved, `${side} ${wall} ${c.name} bottom`).toBe(0);
                            expect(boundary, `${side} ${wall} ${c.name} watertight`).toBe(0);
                            expect(zeroArea, `${side} ${wall} ${c.name} zero area`).toBe(0);
                            expect(bottomFaces, `${side} ${wall} ${c.name} bottom faces`).toBeGreaterThan(0);
                            expect(bottomUp, `${side} ${wall} ${c.name} bottom normal`).toBe(0);
                            expect(rimWorst, `${side} ${wall} ${c.name} rim`).toBeLessThanOrEqual(
                                EDGE_LIMIT_DEG,
                            );
                            expect(rimEdges, `${side} ${wall} ${c.name} rim edges`).toBeGreaterThan(0);
                            if (
                                c.name === "mpj1-2" ||
                                c.name === "mpj1-4" ||
                                c.name === "mpj5-4" ||
                                c.name === "all-max"
                            ) {
                                expect(
                                    outlineCut,
                                    `${side} ${wall} ${c.name} taper at outline`,
                                ).toBeGreaterThan(0);
                            }

                            if (
                                wall === "straight" &&
                                (c.name === "all-max" || c.name === "mpj1-4" || c.name === "mpj5-4")
                            ) {
                                const n = limit;
                                const x = new Float32Array(n);
                                const y = new Float32Array(n);
                                const z0 = new Float32Array(n);
                                const z1 = new Float32Array(n);
                                for (let i = 0; i < n; i++) {
                                    x[i] = a.getX(i);
                                    y[i] = a.getY(i);
                                    z0[i] = a.getZ(i);
                                    z1[i] = b.getZ(i);
                                }
                                shots.push({ side, name: c.name, x, y, z0, z1 });
                            }

                            if (wall === "straight") {
                                const sourceField = field(side, blank(), { sinks: c.sinks });
                                const viewer = await composeViewerPrintSolidTop({ raw, sourceField });
                                const printed = await composePrintSolidTop(raw, { sourceField });
                                expect(sha256Stl(viewer), `${side} ${c.name} entry`).toBe(sha256Stl(printed));
                                const exported = await reconstructProceduralPreview(raw, {
                                    wallStyle: "straight",
                                    side,
                                    sourceField,
                                    composedTop: true,
                                });
                                const src = exported.model.top.meshPositions;
                                expect(src, `${side} ${c.name} loft input`).toBeTruthy();
                                const sheet = new BufferGeometry();
                                sheet.setAttribute(
                                    "position",
                                    new Float32BufferAttribute(Float32Array.from(src!), 3),
                                );
                                const reference = sheet.clone();
                                const foot = getBaseFootprintFrame(reference, side);
                                applySinkThicknessToGeometry(sheet, reference, sourceField, foot);
                                applySinkCutToGeometry(sheet, reference, sourceField, foot);
                                const exp = exported.geometry.getAttribute("position");
                                const view = sheet.getAttribute("position");
                                const expTop =
                                    (exported.geometry.userData as { topVertexCount?: number })
                                        .topVertexCount ?? exp.count;
                                const n = Math.min(expTop, (src!.length / 3) | 0, exp.count, view.count);
                                let delta = 0;
                                for (let i = 0; i < n; i++) {
                                    delta = Math.max(
                                        delta,
                                        Math.hypot(
                                            exp.getX(i) - view.getX(i),
                                            exp.getY(i) - view.getY(i),
                                            exp.getZ(i) - view.getZ(i),
                                        ),
                                    );
                                }
                                console.log(
                                    "[SINK-VIEWPORT]",
                                    JSON.stringify({
                                        side,
                                        sink: c.name,
                                        deltaMm: Number(delta.toFixed(4)),
                                        n,
                                        loftN: (exported.geometry.userData as { loftN?: number }).loftN ?? 0,
                                    }),
                                );
                                expect(delta, `${side} ${c.name} viewport`).toBeLessThanOrEqual(0.05);
                                viewer.dispose();
                                printed.dispose();
                                sheet.dispose();
                                reference.dispose();
                                exported.geometry.dispose();
                            }
                        }
                        sunk.geometry.dispose();
                    }
                    plain.geometry.dispose();
                }
            }
            const artifactDir = "/opt/cursor/artifacts";
            mkdirSync(artifactDir, { recursive: true });
            const heat = resolve(artifactDir, "sink-taper-heatmap.png");
            const section = resolve(artifactDir, "sink-taper-section.png");
            paintHeatmap(shots, heat);
            paintSection(shots, section);
            console.log("[SINK-RENDER]", JSON.stringify({ heat, section, shots: shots.length }));
        } finally {
            pair.left.dispose();
            pair.right.dispose();
        }
        console.log("[SINK-SECTION]", JSON.stringify(sections));
    }, 2_400_000);
});

describe("sink-free export hash parity", () => {
    test("no-sink, wedges, regional wedge, met pad, width, and full-length wedge match the pre-change head", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const pad: PlacedElement = {
            id: "met-1",
            kind: "met_pad",
            side: "left",
            position: { x: 40, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 5,
        };
        const cases: Array<{
            name: string;
            corrections: SideCorrections;
            extra?: Partial<HeightFieldParams>;
        }> = [
            { name: "no-sink", corrections: blank() },
            {
                name: "wedges",
                corrections: blank({
                    rearfootWedge: { side: "medial", value: 3, unit: "mm" },
                    forefootWedge: { side: "lateral", value: 4, unit: "mm" },
                }),
            },
            {
                name: "regional-wedge",
                corrections: blank({ forefootWedge: { side: "lateral", value: 4, unit: "deg" } }),
            },
            {
                name: "met-pad",
                corrections: blank(),
                extra: { elements: [pad], includeElements: true },
            },
            { name: "width", corrections: blank({ forefootWidthMm: 5 }) },
            {
                name: "full-length-wedge",
                corrections: blank({ fullLengthWedge: { side: "lateral", value: 5, unit: "deg" } }),
            },
        ];
        const hashes: Record<string, string> = {};
        try {
            for (const c of cases) {
                const sourceField = field("left", c.corrections, c.extra);
                const built = await reconstructProceduralPreview(raw, {
                    wallStyle: "straight",
                    side: "left",
                    corrections: c.corrections,
                    sourceField,
                    composedTop: true,
                });
                hashes[c.name] = sha256Stl(built.geometry);
                built.geometry.dispose();
            }
        } finally {
            raw.dispose();
        }
        console.log("[SINK-PARITY]", JSON.stringify(hashes));
        expect(hashes).toEqual(PARITY_SHA256);
    }, 900_000);
});
