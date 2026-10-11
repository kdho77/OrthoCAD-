// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import {
    extractTopOnlyModel,
    fitWindowsTraceToRim,
    medialYSignFromTopRim,
} from "@/lib/geometry/procedural-wall";
import {
    buildFairedPatternFromTop,
    SAMPLE_TOP_ASSET_ID,
    SAMPLE_TOP_NAME,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { encodePng } from "./helpers/render-png";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const PRIMARY: [number, number, number] = [14, 165, 233];

function writeFilledPattern(
    rim: Array<{ x: number; y: number }>,
    pattern: Array<{ x: number; y: number }>,
    _bounds: { minX: number; maxX: number },
    overlay?: Array<{ x: number; y: number }>,
): Uint8Array {
    const width = 420;
    const height = 720;
    const pad = 24;
    // Plan view: length X → screen up (toe), width Y → screen right — match Windows.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of [...rim, ...pattern, ...(overlay ?? [])]) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }
    const scale = Math.min(
        (width - 2 * pad) / Math.max(1e-3, maxY - minY),
        (height - 2 * pad) / Math.max(1e-3, maxX - minX),
    );
    const usedW = (maxY - minY) * scale;
    const usedH = (maxX - minX) * scale;
    const ox = (width - usedW) / 2;
    const oy = (height - usedH) / 2;
    const toPx = (p: { x: number; y: number }) => ({
        x: ox + (p.y - minY) * scale,
        y: height - (oy + (p.x - minX) * scale),
    });
    const rgb = new Uint8Array(width * height * 3);
    rgb.fill(18);
    const pts = pattern.map(toPx);
    const fillTri = (
        a: { x: number; y: number },
        b: { x: number; y: number },
        c: { x: number; y: number },
    ) => {
        const minPy = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
        const maxPy = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
        const minPx = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
        const maxPx = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
        const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        if (Math.abs(denom) < 1e-9) return;
        for (let y = minPy; y <= maxPy; y++) {
            for (let x = minPx; x <= maxPx; x++) {
                const w0 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denom;
                const w1 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denom;
                const w2 = 1 - w0 - w1;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                const o = (y * width + x) * 3;
                rgb[o] = PRIMARY[0];
                rgb[o + 1] = PRIMARY[1];
                rgb[o + 2] = PRIMARY[2];
            }
        }
    };
    const cx = pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length);
    const cy = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
    const center = { x: cx, y: cy };
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a && b) fillTri(center, a, b);
    }
    const stroke = (poly: Array<{ x: number; y: number }>, color: [number, number, number]) => {
        const spts = poly.map(toPx);
        for (let i = 0; i < spts.length; i++) {
            const a = spts[i];
            const b = spts[(i + 1) % spts.length];
            if (!a || !b) continue;
            const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                const x = Math.round(a.x + (b.x - a.x) * t);
                const yy = Math.round(a.y + (b.y - a.y) * t);
                if (x < 0 || yy < 0 || x >= width || yy >= height) continue;
                const o = (yy * width + x) * 3;
                rgb[o] = color[0];
                rgb[o + 1] = color[1];
                rgb[o + 2] = color[2];
            }
        }
    };
    stroke(rim, [160, 160, 160]);
    if (overlay?.length) stroke(overlay, [132, 204, 22]);
    stroke(pattern, PRIMARY);
    return encodePng(width, height, rgb);
}

describe("bottom pattern CAD render", () => {
    test("writes SAMPLE_Top bottom-pattern preview in primary blue", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const geo = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const model = extractTopOnlyModel(geo, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
        const pattern = buildFairedPatternFromTop(model);
        const rimLocal = model.top.rimLocal ?? [];
        const pos = model.top.meshPositions ?? new Float32Array();
        const rim = rimLocal.map((i) => ({
            x: pos[i * 3] ?? 0,
            y: pos[i * 3 + 1] ?? 0,
            z: pos[i * 3 + 2] ?? 0,
        }));
        const placed = fitWindowsTraceToRim(rim, model.bounds, medialYSignFromTopRim(rim, model.bounds));
        const png = writeFilledPattern(rim, pattern, model.bounds, placed?.smoothed);
        expect(png.length).toBeGreaterThan(100);
        for (const root of ["/opt/cursor/artifacts", "/tmp/s1-stls"]) {
            mkdirSync(root, { recursive: true });
            writeFileSync(`${root}/bottom-pattern-cad.png`, png);
        }
        geo.dispose();
    }, 60_000);
});
