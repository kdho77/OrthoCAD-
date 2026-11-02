// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { evaluateSinkConstraints } from "@/lib/geometry/clinical-constraints";
import { medialSign, meshYFromAnatomicalLateral } from "@/lib/geometry/handedness";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize, scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";
import {
    applySinkCutToGeometry,
    applySinkThicknessToGeometry,
    FLOOR_MIN_MM,
    footOutlineFromGeometry,
    meshYToAnatomical,
    SINK_KIND_ORDER,
    SINK_PROFILES,
    SINK_SCALE_MIN,
    type SinkSurfaceContext,
    SULCUS_ADULT_SCALE,
    SULCUS_CLEARANCE_MM,
    SULCUS_DIAMETER_MIN,
    sinkCutMm,
    sinkFrame,
    sinkPlanScale,
    sulcusClearanceFor,
} from "@/lib/geometry/sink";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedSink, Side, SinkKind } from "@/types";

/**
 * Pediatric plan-scale floor is 0.65. Sizes at or above 0.80 keep the previous
 * frame. Clearance is the minimum distance from the whole distal taper to the
 * baked SAMPLE_Top sulcus, not the centre-line ray.
 */
const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const ARTIFACT_US1 = "/opt/cursor/artifacts/sink-us1-top.png";
const ARTIFACT_US9 = "/opt/cursor/artifacts/sink-us9-top.png";
const REPORT = "/tmp/sink-pediatric-report.json";

/** 5×7 glyphs. The preview labels the medial edge so a mirrored foot is obvious. */
const LABEL_GLYPH: Record<string, string[]> = {
    M: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
};

function stampLabel(
    rgb: Uint8Array,
    width: number,
    height: number,
    text: string,
    x: number,
    y: number,
): void {
    const scale = 2;
    let cursor = x;
    for (const ch of text) {
        const rows = LABEL_GLYPH[ch];
        const advance = rows?.[0]?.length;
        if (!rows || !advance) continue;
        for (let row = 0; row < rows.length; row++) {
            const bits = rows[row] ?? "";
            for (let col = 0; col < bits.length; col++) {
                if (bits[col] !== "1") continue;
                for (let sy = 0; sy < scale; sy++) {
                    for (let sx = 0; sx < scale; sx++) {
                        const px = cursor + col * scale + sx;
                        const py = y + row * scale + sy;
                        if (px < 0 || py < 0 || px >= width || py >= height) continue;
                        const o = (py * width + px) * 3;
                        rgb[o] = 20;
                        rgb[o + 1] = 52;
                        rgb[o + 2] = 120;
                    }
                }
            }
        }
        cursor += (advance + 1) * scale;
    }
}

/** Straight Men's 9 SAMPLE_Top with every sink at max depth, captured at 96e732fb. */
const US9_SINK_SHA256: Record<string, string> = {
    "left-straight": "1850c6f5cc6fe4d976f84ba20e765e82be36b5c3c9fab9af93bf47af71f6b177",
    "left-round": "a866ee2ad0fe3f5329a4ef06da4daf0f061939cb73409efe8098579568c5f48e",
    "left-hybrid": "eee2b5b0d8c312fbc82a9d004893593754283ef28581f29698f7b05e66590cc1",
    "right-straight": "025f1633c9855c444e4fc4599518b1c7d47327af3632c3801d26520df87abe91",
    "right-round": "3ace8aad6e3c9f73353d879418975b25e927ca0b5d533d43843759513c0f834b",
    "right-hybrid": "7d78734b33935a035944a0b9fc70bf1e10c34ffe6b935c93141a853c819c0760",
};

const report: Record<string, unknown> = {};

function sha256Stl(geo: BufferGeometry): string {
    return createHash("sha256")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
}

function maxSinks(): PlacedSink[] {
    return SINK_KIND_ORDER.map((kind) => ({
        id: kind,
        kind,
        depthMm: SINK_PROFILES[kind].maxDepthMm,
    }));
}

function layoutLength(
    kind: "us" | "scale",
    value: number,
): { lengthMm: number; widthMm: number; label: string } {
    if (kind === "us") {
        const layout = insoleLayoutForUsMenSize(value);
        return { lengthMm: layout.lengthMm, widthMm: layout.widthMm, label: `US ${value}` };
    }
    return { lengthMm: value, widthMm: (95 * value) / 260, label: `L ${value}` };
}

function sizedContext(
    native: BufferGeometry,
    side: Side,
    lengthMm: number,
    widthMm: number,
    sinks: PlacedSink[],
): { ctx: SinkSurfaceContext; geo: BufferGeometry } {
    const geo = scaleGeometryToInsoleSize(native, lengthMm, widthMm);
    const outline = footOutlineFromGeometry(geo);
    return {
        geo,
        ctx: {
            side,
            lengthMm,
            widthMm,
            sinks,
            footOutline: outline,
            medialYSign: medialSign(side),
        },
    };
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

function paintPair(left: BufferGeometry, right: BufferGeometry, usSize: number, path: string): void {
    const layout = insoleLayoutForUsMenSize(usSize);
    const feet = [
        { side: "left" as const, geo: scaleGeometryToInsoleSize(left, layout.lengthMm, layout.widthMm) },
        { side: "right" as const, geo: scaleGeometryToInsoleSize(right, layout.lengthMm, layout.widthMm) },
    ];
    const panelW = 440;
    const panelH = 560;
    const width = panelW * 2 + 24;
    const height = panelH + 36;
    const rgb = new Uint8Array(width * height * 3);
    rgb.fill(244);
    const ppm = (panelH - 56) / layout.lengthMm;
    const sinks = maxSinks();
    feet.forEach((foot, fi) => {
        const outline = footOutlineFromGeometry(foot.geo);
        const ctx: SinkSurfaceContext = {
            side: foot.side,
            lengthMm: layout.lengthMm,
            widthMm: layout.widthMm,
            sinks,
            footOutline: outline,
            medialYSign: medialSign(foot.side),
        };
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
        const oy = 28;
        // Screen X is mesh Y, toes up. frame.cy is anatomical +lateral, which
        // equals mesh Y only on the left. The right foot is the Y mirror.
        const toPx = (x: number, yMesh: number) => ({
            px: Math.round(ox + (maxY - yMesh) * ppm + 16),
            py: Math.round(oy + (maxX - x) * ppm),
        });
        for (let i = 0; i < pos.count; i += 2) {
            const { px, py } = toPx(pos.getX(i), pos.getY(i));
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const o = (py * width + px) * 3;
            rgb[o] = 168;
            rgb[o + 1] = 176;
            rgb[o + 2] = 186;
        }
        for (const sink of sinks) {
            const frame = sinkFrame(sink, ctx);
            if (!frame) continue;
            const yMesh = meshYFromAnatomicalLateral(frame.cy, foot.side);
            const { px: cx, py: cy } = toPx(frame.cx, yMesh);
            const reach =
                Math.ceil((Math.max(frame.aDist, frame.bLat, frame.bMed) + frame.blendMm + 2) * ppm) + 2;
            const rad = (frame.rotationDeg * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            for (let py = cy - reach; py <= cy + reach; py++) {
                for (let px = cx - reach; px <= cx + reach; px++) {
                    if (px < 0 || py < 0 || px >= width || py >= height) continue;
                    const x = maxX - (py - oy) / ppm;
                    const yAt = maxY - (px - (ox + 16)) / ppm;
                    const yLat = meshYToAnatomical(yAt, foot.side, medialSign(foot.side));
                    const mx = x - frame.cx;
                    const my = yLat - frame.cy;
                    const lx = cos * mx + sin * my;
                    const ly = -sin * mx + cos * my;
                    const a = lx >= 0 ? frame.aDist : frame.aProx;
                    const b = ly >= 0 ? frame.bLat : frame.bMed;
                    const outer = Math.hypot(lx / (a + frame.blendMm), ly / (b + frame.blendMm));
                    const inner = Math.hypot(lx / a, ly / b);
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
        const medialY = medialSign(foot.side) < 0 ? minY : maxY;
        const anchor = toPx((minX + maxX) / 2, medialY);
        const towardMedial = -medialSign(foot.side);
        const labelW = "MEDIAL".length * 12;
        const labelX = Math.round(anchor.px + towardMedial * 8 - (towardMedial < 0 ? labelW : 0));
        stampLabel(rgb, width, height, "MEDIAL", labelX, Math.max(8, anchor.py - 8));
        foot.geo.dispose();
    });
    stampLabel(rgb, width, height, `US${usSize}`, 8, 4);
    try {
        writePng(path, width, height, rgb);
    } catch {
        // The preview is an agent artifact. The assertions do not depend on the file.
    }
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

function worstNewDihedral(plain: BufferGeometry, sunk: BufferGeometry): number {
    const edgesOf = (geo: BufferGeometry) => {
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
                const faces = edgeFaces.get(k);
                if (faces) faces.push(f);
                else edgeFaces.set(k, [f]);
            }
        }
        const out = new Map<string, number>();
        for (const [key, faces] of edgeFaces) {
            if (faces.length !== 2) continue;
            const f1 = faces[0]!;
            const f2 = faces[1]!;
            const n1 = faceNormal(pos, idx[f1]!, idx[f1 + 1]!, idx[f1 + 2]!);
            const n2 = faceNormal(pos, idx[f2]!, idx[f2 + 1]!, idx[f2 + 2]!);
            if (!n1 || !n2) continue;
            const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
            out.set(key, (Math.acos(dot) * 180) / Math.PI);
        }
        return out;
    };
    const before = edgesOf(plain);
    const after = edgesOf(sunk);
    let worst = 0;
    for (const [key, deg] of after) {
        const prior = before.get(key);
        if (prior !== undefined && prior > 60) continue;
        if (deg > worst) worst = deg;
    }
    return worst;
}

describe("pediatric sink scale and sulcus clearance", () => {
    test("margin or warning on every size, with the US 1 fallback steps", async () => {
        expect(SINK_SCALE_MIN).toBe(0.65);
        expect(SULCUS_ADULT_SCALE).toBe(0.8);
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const left = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const right = mirrorGeometry(left);
        const natives = { left, right };
        const sinks = maxSinks();
        const cases: Array<{ lengthMm: number; widthMm: number; label: string; adult: boolean }> = [];
        for (let size = 1; size <= 16; size += 0.5) {
            const layout = layoutLength("us", size);
            const scale = sinkPlanScale(layout.lengthMm);
            cases.push({ ...layout, adult: scale >= SULCUS_ADULT_SCALE });
        }
        cases.push({ ...layoutLength("scale", 0.65 * 260), adult: false });
        cases.push({ ...layoutLength("scale", 0.799 * 260), adult: false });
        cases.push({ ...layoutLength("scale", 0.801 * 260), adult: true });
        const rows: Array<Record<string, number | string | boolean>> = [];
        try {
            for (const item of cases) {
                for (const side of ["left", "right"] as const) {
                    const { ctx, geo } = sizedContext(
                        natives[side],
                        side,
                        item.lengthMm,
                        item.widthMm,
                        sinks,
                    );
                    const scale = sinkPlanScale(item.lengthMm);
                    for (const sink of sinks) {
                        const hit = sulcusClearanceFor(sink, ctx);
                        const again = sulcusClearanceFor(sink, ctx);
                        expect(again).toEqual(hit);
                        const frame = sinkFrame(sink, ctx)!;
                        if (item.adult) {
                            expect(frame.fallbackStep, `${item.label} ${side} ${sink.kind}`).toBe(0);
                            expect(hit.fallbackStep, `${item.label} ${side} ${sink.kind}`).toBe(0);
                            expect(hit.warning, `${item.label} ${side} ${sink.kind}`).toBe(false);
                            expect(frame.blendMm).toBe(SINK_PROFILES[sink.kind].blendMm);
                            expect(frame.u).toBeCloseTo(SINK_PROFILES[sink.kind].u, 6);
                        } else if (hit.marginMm + 1e-6 < SULCUS_CLEARANCE_MM) {
                            expect(hit.fallbackStep, `${item.label} ${side} ${sink.kind}`).toBeGreaterThan(0);
                            expect(hit.warning, `${item.label} ${side} ${sink.kind}`).toBe(true);
                        } else {
                            expect(hit.warning, `${item.label} ${side} ${sink.kind}`).toBe(false);
                        }
                        const warnings = evaluateSinkConstraints(ctx);
                        expect(
                            warnings.some((w) => w.code === "sulcus" && w.sinkId === sink.id),
                            `${item.label} ${side} ${sink.kind}`,
                        ).toBe(hit.warning && hit.fallbackStep > 0);
                        rows.push({
                            label: item.label,
                            side,
                            kind: sink.kind,
                            scale: Number(scale.toFixed(4)),
                            marginMm: Number(hit.marginMm.toFixed(3)),
                            fallbackStep: hit.fallbackStep,
                            warning: hit.warning,
                            blendMm: Number(hit.blendMm.toFixed(3)),
                            diameterScale: Number(hit.diameterScale.toFixed(4)),
                            shiftMm: Number(hit.proximalShiftMm.toFixed(3)),
                            frameU: Number(frame.u.toFixed(5)),
                        });
                    }
                    geo.dispose();
                }
            }
            paintPair(left, right, 1, ARTIFACT_US1);
            paintPair(left, right, 9, ARTIFACT_US9);
        } finally {
            left.dispose();
            right.dispose();
        }
        const pick = (label: string, kind: SinkKind) =>
            rows.filter((row) => row.label === label && row.kind === kind && row.side === "left");
        report.clearance = rows.filter((row) =>
            ["US 1", "L 169", "US 9", "L 208.26"].includes(String(row.label)),
        );
        const us1Mpj5 = pick("US 1", "mpj5")[0]!;
        const us1Mpj1 = pick("US 1", "mpj1")[0]!;
        const smallMpj5 = pick("L 169", "mpj5")[0]!;
        const smallMpj1 = pick("L 169", "mpj1")[0]!;
        report.us1 = { mpj5: us1Mpj5, mpj1: us1Mpj1 };
        report.smallest = { mpj5: smallMpj5, mpj1: smallMpj1 };
        expect(us1Mpj5.fallbackStep).toBe(4);
        expect(us1Mpj1.fallbackStep).toBe(2);
        expect(smallMpj5.fallbackStep).toBe(4);
        expect(smallMpj1.fallbackStep).toBe(2);
        for (const row of rows) {
            if (String(row.label) === "US 9" || String(row.label) === "L 208.26") {
                expect(row.fallbackStep, `${row.label} ${row.kind}`).toBe(0);
                expect(row.warning, `${row.label} ${row.kind}`).toBe(false);
            }
        }
        writeFileSync(REPORT, JSON.stringify(report, null, 2));
    }, 180_000);

    test("a forced crease warns and does not clip the footprint", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const left = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        try {
            const layout = insoleLayoutForUsMenSize(1);
            const sink = { id: "mpj5", kind: "mpj5" as const, depthMm: SINK_PROFILES.mpj5.maxDepthMm };
            const crease = Array.from({ length: 21 }, (_, i) => ({ v: i / 20, u: SINK_PROFILES.mpj5.u }));
            const { ctx, geo } = sizedContext(left, "left", layout.lengthMm, layout.widthMm, [sink]);
            ctx.sulcusCrease = crease;
            const hit = sulcusClearanceFor(sink, ctx);
            const frame = sinkFrame(sink, ctx)!;
            const warnings = evaluateSinkConstraints(ctx);
            expect(hit.warning).toBe(true);
            expect(hit.fallbackStep).toBe(4);
            expect(warnings.some((w) => w.code === "sulcus")).toBe(true);
            const creaseX = frame.cx - (frame.u - SINK_PROFILES.mpj5.u) * layout.lengthMm;
            const tip = frame.cx + frame.halfLengthMm + frame.blendMm;
            expect(Math.abs(tip - (creaseX - SULCUS_CLEARANCE_MM))).toBeGreaterThan(0.5);
            expect(frame.halfLengthMm).toBeGreaterThan(
                (SINK_PROFILES.mpj5.lengthMm / 2) * sinkPlanScale(layout.lengthMm) * SULCUS_DIAMETER_MIN -
                    0.05,
            );
            expect(sinkCutMm(frame.dx, frame.dy, ctx).mm).toBeGreaterThan(3.5);
            geo.dispose();
        } finally {
            left.dispose();
        }
    });

    test("right MPJ1 is the medial mirror of the left, and MPJ5 and the styloid stay lateral", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const leftNative = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const rightNative = mirrorGeometry(leftNative);
        const kinds = ["mpj1", "mpj5", "styloid"] as const;
        try {
            for (const size of [1, 9]) {
                const layout = insoleLayoutForUsMenSize(size);
                const sinks = maxSinks();
                const placed: Record<string, { u: number; v: number; yMesh: number }> = {};
                for (const side of ["left", "right"] as const) {
                    const geo = scaleGeometryToInsoleSize(
                        side === "left" ? leftNative : rightNative,
                        layout.lengthMm,
                        layout.widthMm,
                    );
                    const ctx: SinkSurfaceContext = {
                        side,
                        lengthMm: layout.lengthMm,
                        widthMm: layout.widthMm,
                        sinks,
                        footOutline: footOutlineFromGeometry(geo) ?? undefined,
                        medialYSign: medialSign(side),
                    };
                    for (const kind of kinds) {
                        const frame = sinkFrame(sinks.find((sink) => sink.kind === kind)!, ctx)!;
                        const yMesh = meshYFromAnatomicalLateral(frame.cy, side);
                        const medial = kind === "mpj1";
                        expect(Math.sign(yMesh), `US ${size} ${side} ${kind}`).toBe(
                            medial ? medialSign(side) : -medialSign(side),
                        );
                        expect(frame.v, `US ${size} ${side} ${kind}`).toBeLessThan(medial ? 0.5 : 1);
                        expect(frame.v, `US ${size} ${side} ${kind}`).toBeGreaterThan(medial ? 0 : 0.5);
                        placed[`${side}-${kind}`] = { u: frame.u, v: frame.v, yMesh };
                    }
                    if (size === 9) {
                        const warnings = evaluateSinkConstraints(ctx);
                        expect(
                            warnings.some((w) => w.code === "sulcus"),
                            `US 9 ${side}`,
                        ).toBe(false);
                    }
                    geo.dispose();
                }
                for (const kind of kinds) {
                    const left = placed[`left-${kind}`]!;
                    const right = placed[`right-${kind}`]!;
                    expect(right.u, `US ${size} ${kind} u`).toBeCloseTo(left.u, 4);
                    expect(right.v, `US ${size} ${kind} v`).toBeCloseTo(left.v, 4);
                    expect(Math.abs(right.yMesh + left.yMesh), `US ${size} ${kind} mirror`).toBeLessThan(1.5);
                }
            }
        } finally {
            leftNative.dispose();
            rightNative.dispose();
        }
    });

    test("pediatric top sheet keeps the floor, the outline, and a reachable edge taper", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const left = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const right = mirrorGeometry(left);
        const dihedral: Array<Record<string, number | string>> = [];
        try {
            const sizes = [
                layoutLength("scale", 0.65 * 260),
                layoutLength("us", 1),
                layoutLength("scale", 0.799 * 260),
                layoutLength("scale", 0.801 * 260),
            ];
            for (const item of sizes) {
                for (const side of ["left", "right"] as const) {
                    const native = side === "left" ? left : right;
                    const { ctx, geo } = sizedContext(native, side, item.lengthMm, item.widthMm, maxSinks());
                    const plain = geo.clone();
                    const sunk = geo.clone();
                    applySinkThicknessToGeometry(sunk, plain, ctx);
                    applySinkCutToGeometry(sunk, plain, ctx);
                    const a = plain.getAttribute("position");
                    const b = sunk.getAttribute("position");
                    let xy = 0;
                    let floor = Infinity;
                    let minZ = Infinity;
                    for (let i = 0; i < a.count; i++) {
                        xy = Math.max(xy, Math.hypot(a.getX(i) - b.getX(i), a.getY(i) - b.getY(i)));
                        floor = Math.min(floor, b.getZ(i));
                        minZ = Math.min(minZ, a.getZ(i));
                    }
                    expect(xy, `${item.label} ${side} outline`).toBeLessThan(1e-4);
                    expect(floor, `${item.label} ${side} floor`).toBeGreaterThanOrEqual(
                        Math.min(FLOOR_MIN_MM, minZ) - 1e-3,
                    );
                    const fold = worstNewDihedral(plain, sunk);
                    dihedral.push({ label: item.label, side, worst: Number(fold.toFixed(3)) });
                    expect(fold, `${item.label} ${side} dihedral`).toBeLessThanOrEqual(60);
                    const fifth = maxSinks().find((s) => s.kind === "mpj5")!;
                    const frame = sinkFrame(fifth, ctx)!;
                    const outline = ctx.footOutline ?? [];
                    const ys: number[] = [];
                    const n = outline.length;
                    for (let i = 0; i < n; i++) {
                        const a = outline[i]!;
                        const b = outline[(i + 1) % n]!;
                        const dx = b.x - a.x;
                        if (Math.abs(dx) < 1e-8) continue;
                        const t = (frame.cx - a.x) / dx;
                        if (t < -1e-4 || t > 1 + 1e-4) continue;
                        const y = a.y + Math.min(1, Math.max(0, t)) * (b.y - a.y);
                        ys.push(meshYToAnatomical(y, side));
                    }
                    expect(ys.length, `${item.label} ${side} outline`).toBeGreaterThan(0);
                    const lateralAnat = Math.max(...ys);
                    expect(
                        sinkCutMm(frame.cx, lateralAnat, ctx).mm,
                        `${item.label} ${side} 5th taper`,
                    ).toBeGreaterThan(0);
                    const first = sinkFrame(maxSinks().find((s) => s.kind === "mpj1")!, ctx)!;
                    const medialYs: number[] = [];
                    for (let i = 0; i < n; i++) {
                        const a = outline[i]!;
                        const bpt = outline[(i + 1) % n]!;
                        const dx = bpt.x - a.x;
                        if (Math.abs(dx) < 1e-8) continue;
                        const t = (first.cx - a.x) / dx;
                        if (t < -1e-4 || t > 1 + 1e-4) continue;
                        medialYs.push(
                            meshYToAnatomical(a.y + Math.min(1, Math.max(0, t)) * (bpt.y - a.y), side),
                        );
                    }
                    expect(medialYs.length, `${item.label} ${side} 1st station`).toBeGreaterThan(0);
                    expect(
                        sinkCutMm(first.cx, Math.min(...medialYs), ctx).mm,
                        `${item.label} ${side} 1st taper`,
                    ).toBeGreaterThan(0);
                    const sty = sinkFrame(maxSinks().find((s) => s.kind === "styloid")!, ctx)!;
                    const gap = Math.hypot(frame.cx - sty.cx, frame.cy - sty.cy);
                    const reach = frame.halfLengthMm + frame.blendMm + sty.halfLengthMm + sty.blendMm;
                    expect(gap - reach, `${item.label} ${side} styloid`).toBeGreaterThan(0);
                    const again = geo.clone();
                    applySinkThicknessToGeometry(again, plain, ctx);
                    applySinkCutToGeometry(again, plain, ctx);
                    const c = again.getAttribute("position");
                    for (let i = 0; i < b.count; i++) {
                        expect(c.getX(i)).toBe(b.getX(i));
                        expect(c.getY(i)).toBe(b.getY(i));
                        expect(c.getZ(i)).toBe(b.getZ(i));
                    }
                    plain.dispose();
                    sunk.dispose();
                    again.dispose();
                    geo.dispose();
                }
            }
        } finally {
            left.dispose();
            right.dispose();
        }
        report.dihedral = dihedral;
        writeFileSync(REPORT, JSON.stringify(report, null, 2));
    }, 180_000);

    test("s >= 0.80 sink meshes match 96e732fb on both sides and all three walls", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const left = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const right = mirrorGeometry(left);
        const sinks = maxSinks();
        const hashes: Record<string, string> = {};
        try {
            for (const side of ["left", "right"] as const) {
                for (const wall of ["straight", "round", "hybrid"] as const) {
                    const src = (side === "left" ? left : right).clone();
                    const built = await reconstructProceduralPreview(src, { wallStyle: wall, side, sinks });
                    hashes[`${side}-${wall}`] = sha256Stl(built.geometry);
                    const pos = built.geometry.getAttribute("position");
                    let bottom = Infinity;
                    const n = pos.count;
                    for (let i = 0; i < n; i++) bottom = Math.min(bottom, pos.getZ(i));
                    expect(bottom, `${side} ${wall} bottom`).toBeGreaterThanOrEqual(-1e-4);
                    built.geometry.dispose();
                    src.dispose();
                }
            }
        } finally {
            left.dispose();
            right.dispose();
        }
        report.hashes = hashes;
        writeFileSync(REPORT, JSON.stringify(report, null, 2));
        expect(hashes).toEqual(US9_SINK_SHA256);
    }, 400_000);
});

afterAll(() => {
    writeFileSync(REPORT, JSON.stringify(report, null, 2));
});
