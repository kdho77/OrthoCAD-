// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Minimal software rasterizer + PNG writer for geometry verification tests.
 * Orthographic camera, z-buffer, flat Lambert shading. No external deps
 * (PNG encoded with node:zlib deflate).
 */
import { deflateSync } from "node:zlib";

function crc32(buf: Uint8Array): number {
    let c: number;
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    const crcBuf = out.subarray(4, 8 + data.length);
    dv.setUint32(8 + data.length, crc32(crcBuf));
    return out;
}

export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
    const raw = new Uint8Array(height * (1 + width * 3));
    for (let y = 0; y < height; y++) {
        raw[y * (1 + width * 3)] = 0;
        raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (1 + width * 3) + 1);
    }
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width);
    dv.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // color type RGB
    const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const idat = deflateSync(raw);
    const chunks = [
        sig,
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", new Uint8Array(idat)),
        pngChunk("IEND", new Uint8Array(0)),
    ];
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

export interface RenderView {
    /** Unit right vector (screen +x) in mesh space. */
    right: [number, number, number];
    /** Unit up vector (screen +y) in mesh space. */
    up: [number, number, number];
    /** Light direction (towards surface), unit. */
    light: [number, number, number];
}

/**
 * Render triangles orthographically. Positions packed xyz. Returns RGB buffer.
 */
export interface ViewFocus {
    center: { x: number; y: number; z: number };
    radius: number;
}

export function projectViewPoint(
    p: { x: number; y: number; z: number },
    view: RenderView,
    width: number,
    height: number,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
): { x: number; y: number } {
    const { right, up } = view;
    const px = p.x * right[0] + p.y * right[1] + p.z * right[2];
    const py = p.x * up[0] + p.y * up[1] + p.z * up[2];
    const margin = 8;
    const scale = Math.min(
        (width - 2 * margin) / Math.max(1e-6, bounds.maxX - bounds.minX),
        (height - 2 * margin) / Math.max(1e-6, bounds.maxY - bounds.minY),
    );
    const ox = (width - scale * (bounds.maxX - bounds.minX)) / 2;
    const oy = (height - scale * (bounds.maxY - bounds.minY)) / 2;
    return {
        x: ox + (px - bounds.minX) * scale,
        y: height - (oy + (py - bounds.minY) * scale),
    };
}

export function viewBounds(
    pos: Float32Array,
    view: RenderView,
    focus?: ViewFocus,
): { minX: number; maxX: number; minY: number; maxY: number } {
    const { right, up } = view;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        const z = pos[i * 3 + 2]!;
        if (focus) {
            const d = Math.hypot(x - focus.center.x, y - focus.center.y, z - focus.center.z);
            if (d > focus.radius) continue;
        }
        const px = x * right[0] + y * right[1] + z * right[2];
        const py = x * up[0] + y * up[1] + z * up[2];
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
    }
    if (!Number.isFinite(minX)) {
        return viewBounds(pos, view);
    }
    return { minX, maxX, minY, maxY };
}

export function drawRampMarks(
    rgb: Uint8Array,
    width: number,
    height: number,
    marks: Array<{ x: number; y: number }>,
    color: [number, number, number] = [255, 230, 40],
): void {
    for (const m of marks) {
        drawLine(rgb, width, height, m.x, 8, m.x, height - 8, color);
        drawLine(rgb, width, height, m.x - 6, 12, m.x + 6, 12, color);
        drawLine(rgb, width, height, m.x - 6, height - 12, m.x + 6, height - 12, color);
    }
}

/** Residual-station marks: X at the projected R; optional full-height tick. */
export function drawStationMarks(
    rgb: Uint8Array,
    width: number,
    height: number,
    marks: Array<{ x: number; y: number }>,
    color: [number, number, number] = [255, 56, 56],
    fullTick = false,
): void {
    for (const m of marks) {
        if (fullTick) {
            drawLine(rgb, width, height, m.x, 6, m.x, height - 6, color);
            drawLine(rgb, width, height, m.x - 7, 10, m.x + 7, 10, color);
            drawLine(rgb, width, height, m.x - 7, height - 10, m.x + 7, height - 10, color);
        }
        drawLine(rgb, width, height, m.x - 8, m.y - 8, m.x + 8, m.y + 8, color);
        drawLine(rgb, width, height, m.x - 8, m.y + 8, m.x + 8, m.y - 8, color);
    }
}

export function renderMesh(
    pos: Float32Array,
    index: ArrayLike<number>,
    view: RenderView,
    width: number,
    height: number,
    baseColor: [number, number, number] = [150, 90, 220],
    background = 140,
    focus?: ViewFocus,
    vertexColor?: (index: number) => [number, number, number],
): Uint8Array {
    const { right, up, light } = view;
    const fwd = [
        right[1] * up[2] - right[2] * up[1],
        right[2] * up[0] - right[0] * up[2],
        right[0] * up[1] - right[1] * up[0],
    ] as const;

    const n = pos.length / 3;
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const sz = new Float32Array(n);
    const bounds = viewBounds(pos, view, focus);
    const minX = bounds.minX;
    const maxX = bounds.maxX;
    const minY = bounds.minY;
    const maxY = bounds.maxY;
    for (let i = 0; i < n; i++) {
        const x = pos[i * 3]!,
            y = pos[i * 3 + 1]!,
            z = pos[i * 3 + 2]!;
        const px = x * right[0] + y * right[1] + z * right[2];
        const py = x * up[0] + y * up[1] + z * up[2];
        const pz = x * fwd[0] + y * fwd[1] + z * fwd[2];
        sx[i] = px;
        sy[i] = py;
        sz[i] = pz;
    }
    const margin = 8;
    const scale = Math.min(
        (width - 2 * margin) / Math.max(1e-6, maxX - minX),
        (height - 2 * margin) / Math.max(1e-6, maxY - minY),
    );
    const ox = (width - scale * (maxX - minX)) / 2;
    const oy = (height - scale * (maxY - minY)) / 2;
    const toPx = (i: number): [number, number] => [
        ox + (sx[i]! - minX) * scale,
        height - (oy + (sy[i]! - minY) * scale),
    ];

    const rgb = new Uint8Array(width * height * 3);
    rgb.fill(background);
    const zbuf = new Float32Array(width * height).fill(-Infinity);

    for (let f = 0; f < index.length; f += 3) {
        const a = index[f]!,
            b = index[f + 1]!,
            c = index[f + 2]!;
        // Face normal in mesh space
        const ax = pos[a * 3]!,
            ay = pos[a * 3 + 1]!,
            az = pos[a * 3 + 2]!;
        const ux = pos[b * 3]! - ax,
            uy = pos[b * 3 + 1]! - ay,
            uz = pos[b * 3 + 2]! - az;
        const vx = pos[c * 3]! - ax,
            vy = pos[c * 3 + 1]! - ay,
            vz = pos[c * 3 + 2]! - az;
        let nx = uy * vz - uz * vy,
            ny = uz * vx - ux * vz,
            nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        let lambert = -(nx * light[0] + ny * light[1] + nz * light[2]);
        lambert = Math.abs(lambert); // double-sided
        const shade = 0.25 + 0.75 * lambert;

        const [x0, y0] = toPx(a);
        const [x1, y1] = toPx(b);
        const [x2, y2] = toPx(c);
        const z0 = sz[a]!,
            z1 = sz[b]!,
            z2 = sz[c]!;

        const minPx = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
        const maxPx = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
        const minPy = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
        const maxPy = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
        if (maxPx < minPx || maxPy < minPy) continue;

        const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(denom) < 1e-12) continue;

        for (let py = minPy; py <= maxPy; py++) {
            for (let px = minPx; px <= maxPx; px++) {
                const w0 = ((y1 - y2) * (px + 0.5 - x2) + (x2 - x1) * (py + 0.5 - y2)) / denom;
                const w1 = ((y2 - y0) * (px + 0.5 - x2) + (x0 - x2) * (py + 0.5 - y2)) / denom;
                const w2 = 1 - w0 - w1;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                const z = w0 * z0 + w1 * z1 + w2 * z2;
                const pi = py * width + px;
                if (z <= zbuf[pi]!) continue;
                zbuf[pi] = z;
                const color = vertexColor ? vertexColor(a) : baseColor;
                rgb[pi * 3] = Math.min(255, color[0] * shade);
                rgb[pi * 3 + 1] = Math.min(255, color[1] * shade);
                rgb[pi * 3 + 2] = Math.min(255, color[2] * shade);
            }
        }
    }
    return rgb;
}

function setPixel(
    rgb: Uint8Array,
    width: number,
    height: number,
    x: number,
    y: number,
    color: [number, number, number],
): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const i = (py * width + px) * 3;
    rgb[i] = color[0];
    rgb[i + 1] = color[1];
    rgb[i + 2] = color[2];
}

function drawLine(
    rgb: Uint8Array,
    width: number,
    height: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: [number, number, number],
): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        setPixel(rgb, width, height, x0 + dx * t, y0 + dy * t, color);
    }
}

function drawPolyline(
    rgb: Uint8Array,
    width: number,
    height: number,
    pts: Array<{ x: number; y: number }>,
    color: [number, number, number],
    closed = false,
): void {
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        drawLine(rgb, width, height, a.x, a.y, b.x, b.y, color);
    }
    if (closed && pts.length > 2) {
        const a = pts[pts.length - 1]!;
        const b = pts[0]!;
        drawLine(rgb, width, height, a.x, a.y, b.x, b.y, color);
    }
}

function projectPlan(
    pts: Array<{ x: number; y: number }>,
    left: number,
    top: number,
    boxW: number,
    boxH: number,
    pad = 16,
): Array<{ x: number; y: number }> {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const scale = Math.min(
        (boxW - 2 * pad) / Math.max(1e-6, maxX - minX),
        (boxH - 2 * pad) / Math.max(1e-6, maxY - minY),
    );
    const ox = left + (boxW - scale * (maxX - minX)) / 2;
    const oy = top + (boxH - scale * (maxY - minY)) / 2;
    return pts.map((p) => ({
        x: ox + (p.x - minX) * scale,
        y: oy + boxH - pad - (p.y - minY) * scale,
    }));
}

/**
 * Plan view of the pattern (lime) over the rim (gray) plus k(s) along the
 * closed curve. Inflections marked in red. Overlay for Kendon's fair-curve gate.
 */
export function renderPatternCurvature(
    pattern: Array<{ x: number; y: number }>,
    k: number[],
    s: number[],
    width: number,
    height: number,
    rim?: Array<{ x: number; y: number }>,
    inflections = 0,
): Uint8Array {
    const rgb = new Uint8Array(width * height * 3);
    rgb.fill(36);
    const planW = Math.floor(width * 0.48);
    const plotLeft = planW + 12;
    const plotW = width - plotLeft - 16;
    const plotTop = 24;
    const plotH = height - 48;
    if (rim?.length) {
        drawPolyline(rgb, width, height, projectPlan(rim, 8, 8, planW - 8, height - 16), [90, 90, 90], true);
    }
    drawPolyline(
        rgb,
        width,
        height,
        projectPlan(pattern, 8, 8, planW - 8, height - 16),
        [180, 255, 40],
        true,
    );

    let kMin = 0;
    let kMax = 0;
    for (const ki of k) {
        if (ki < kMin) kMin = ki;
        if (ki > kMax) kMax = ki;
    }
    const pad = Math.max(0.01, 0.1 * (kMax - kMin));
    kMin -= pad;
    kMax += pad;
    const sMax = s.length ? Math.max(s[s.length - 1] ?? 1, 1e-6) : 1;
    const xAt = (sv: number) => plotLeft + (sv / sMax) * plotW;
    const yAt = (kv: number) => plotTop + plotH - ((kv - kMin) / Math.max(1e-9, kMax - kMin)) * plotH;
    drawLine(rgb, width, height, plotLeft, yAt(0), plotLeft + plotW, yAt(0), [80, 80, 80]);
    drawLine(rgb, width, height, plotLeft, plotTop, plotLeft, plotTop + plotH, [80, 80, 80]);
    const kPts = k.map((ki, i) => ({ x: xAt(s[i] ?? 0), y: yAt(ki) }));
    drawPolyline(rgb, width, height, kPts, [80, 220, 255], false);
    if (kPts.length > 1) {
        drawLine(
            rgb,
            width,
            height,
            kPts[kPts.length - 1]!.x,
            kPts[kPts.length - 1]!.y,
            kPts[0]!.x,
            kPts[0]!.y,
            [80, 220, 255],
        );
    }
    let prev = 0;
    for (let i = 0; i < k.length; i++) {
        const ki = k[i]!;
        if (Math.abs(ki) < 5e-4) continue;
        const sg = Math.sign(ki);
        if (prev && sg !== prev) {
            const p = kPts[i]!;
            drawLine(rgb, width, height, p.x - 4, p.y - 4, p.x + 4, p.y + 4, [255, 70, 70]);
            drawLine(rgb, width, height, p.x - 4, p.y + 4, p.x + 4, p.y - 4, [255, 70, 70]);
        }
        prev = sg;
    }
    void inflections;
    return rgb;
}

/** Stack a mesh render over the pattern+k(s) overlay. */
export function compositeBottomAndCurvature(
    meshRgb: Uint8Array,
    meshW: number,
    meshH: number,
    curveRgb: Uint8Array,
    curveW: number,
    curveH: number,
): { rgb: Uint8Array; width: number; height: number } {
    const width = Math.max(meshW, curveW);
    const height = meshH + curveH;
    const rgb = new Uint8Array(width * height * 3);
    rgb.fill(18);
    const blit = (src: Uint8Array, sw: number, sh: number, dy: number) => {
        const ox = Math.floor((width - sw) / 2);
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const si = (y * sw + x) * 3;
                const di = ((y + dy) * width + (x + ox)) * 3;
                rgb[di] = src[si]!;
                rgb[di + 1] = src[si + 1]!;
                rgb[di + 2] = src[si + 2]!;
            }
        }
    };
    blit(meshRgb, meshW, meshH, 0);
    blit(curveRgb, curveW, curveH, meshH);
    return { rgb, width, height };
}

/**
 * Looking up at the sole from below. Toe (+X) is screen-right; screen-up is −Y,
 * so the left-foot medial arch is at the top of the image and the right-foot
 * arch is at the bottom. right × up = −Z only as a screen basis — the pixels
 * are the first +Z hits, i.e. the Z-min face.
 */
export const PLANTAR_BELOW_VIEW: RenderView = {
    right: [1, 0, 0],
    up: [0, -1, 0],
    light: [0, 0, -1],
};

type PlantarOutlineLoop = Array<{ x: number; y: number; z: number }>;

/**
 * Full plantar footprint from below: depth shading on the exterior bottom shell plus
 * optional engrave outline overlays for legibility.
 */
export function renderPlantarFromBelow(
    pos: Float32Array,
    index: ArrayLike<number>,
    width: number,
    height: number,
    outlineLoops?: PlantarOutlineLoop[],
): Uint8Array {
    const view = PLANTAR_BELOW_VIEW;
    const { right, up } = view;
    const n = pos.length / 3;
    const projX = new Float32Array(n);
    const projY = new Float32Array(n);
    const worldZ = new Float32Array(n);
    const bounds = viewBounds(pos, view);
    const margin = 14;
    const scale = Math.min(
        (width - 2 * margin) / Math.max(1e-6, bounds.maxX - bounds.minX),
        (height - 2 * margin) / Math.max(1e-6, bounds.maxY - bounds.minY),
    );
    const ox = (width - scale * (bounds.maxX - bounds.minX)) / 2;
    const oy = (height - scale * (bounds.maxY - bounds.minY)) / 2;

    for (let i = 0; i < n; i++) {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        const z = pos[i * 3 + 2]!;
        worldZ[i] = z;
        projX[i] = x * right[0] + y * right[1] + z * right[2];
        projY[i] = x * up[0] + y * up[1] + z * up[2];
    }

    const toPx = (vi: number): [number, number] => [
        ox + (projX[vi]! - bounds.minX) * scale,
        height - (oy + (projY[vi]! - bounds.minY) * scale),
    ];

    const rgb = new Uint8Array(width * height * 3);
    rgb.fill(22);
    const zbuf = new Float32Array(width * height).fill(Number.POSITIVE_INFINITY);
    let zMin = Number.POSITIVE_INFINITY;
    let zMax = Number.NEGATIVE_INFINITY;

    for (let f = 0; f + 2 < index.length; f += 3) {
        const a = index[f]!;
        const b = index[f + 1]!;
        const c = index[f + 2]!;
        const az = worldZ[a]!;
        const bz = worldZ[b]!;
        const cz = worldZ[c]!;
        if (Math.max(az, bz, cz) > 20) continue;

        const ax = pos[a * 3]!;
        const ay = pos[a * 3 + 1]!;
        const bx = pos[b * 3]!;
        const by = pos[b * 3 + 1]!;
        const cx = pos[c * 3]!;
        const cy = pos[c * 3 + 1]!;
        const ux = bx - ax;
        const uy = by - ay;
        const uz = bz - az;
        const vx = cx - ax;
        const vy = cy - ay;
        const vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        if (nz > -0.08) continue;

        const [x0, y0] = toPx(a);
        const [x1, y1] = toPx(b);
        const [x2, y2] = toPx(c);
        const minPx = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
        const maxPx = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
        const minPy = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
        const maxPy = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
        if (maxPx < minPx || maxPy < minPy) continue;

        const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(denom) < 1e-12) continue;

        for (let py = minPy; py <= maxPy; py++) {
            for (let px = minPx; px <= maxPx; px++) {
                const w0 = ((y1 - y2) * (px + 0.5 - x2) + (x2 - x1) * (py + 0.5 - y2)) / denom;
                const w1 = ((y2 - y0) * (px + 0.5 - x2) + (x0 - x2) * (py + 0.5 - y2)) / denom;
                const w2 = 1 - w0 - w1;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                const z = w0 * az + w1 * bz + w2 * cz;
                const pi = py * width + px;
                if (z >= zbuf[pi]!) continue;
                zbuf[pi] = z;
                if (z < zMin) zMin = z;
                if (z > zMax) zMax = z;
            }
        }
    }

    const zSpan = Math.max(0.15, zMax - zMin);
    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const pi = py * width + px;
            const z = zbuf[pi]!;
            if (!Number.isFinite(z)) continue;
            const t = Math.max(0, Math.min(1, (z - zMin) / zSpan));
            const base = Math.round(248 - t * 205);
            const o = pi * 3;
            rgb[o] = base;
            rgb[o + 1] = Math.round(base * 0.94);
            rgb[o + 2] = Math.round(base * 0.88);
        }
    }

    const outlineColor: [number, number, number] = [18, 42, 88];
    const projectWorld = (p: { x: number; y: number; z: number }) => {
        const sx = p.x * right[0] + p.y * right[1] + p.z * right[2];
        const sy = p.x * up[0] + p.y * up[1] + p.z * up[2];
        return {
            x: ox + (sx - bounds.minX) * scale,
            y: height - (oy + (sy - bounds.minY) * scale),
        };
    };

    for (const loop of outlineLoops ?? []) {
        const pts = loop.map(projectWorld);
        drawPolyline(rgb, width, height, pts, outlineColor, true);
        for (const p of pts) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    setPixel(rgb, width, height, p.x + dx, p.y + dy, outlineColor);
                }
            }
        }
    }

    return rgb;
}

/** Contrast / ink pixels in the central frame (legibility guard for diagnostic PNGs). */
export function diagnosticPngLegibility(
    rgb: Uint8Array,
    width: number,
    height: number,
): {
    toneRange: number;
    inkPixels: number;
} {
    let min = 255;
    let max = 0;
    let inkPixels = 0;
    const y0 = Math.floor(height * 0.12);
    const y1 = Math.floor(height * 0.92);
    const x0 = Math.floor(width * 0.1);
    const x1 = Math.floor(width * 0.9);
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const g = rgb[(y * width + x) * 3]!;
            min = Math.min(min, g);
            max = Math.max(max, g);
            if (g < 100) inkPixels++;
        }
    }
    return { toneRange: max - min, inkPixels };
}

export function projectPlantarBelow(
    p: { x: number; y: number; z: number },
    pos: Float32Array,
    width: number,
    height: number,
): { x: number; y: number } {
    const view = PLANTAR_BELOW_VIEW;
    const bounds = viewBounds(pos, view);
    const margin = 14;
    const scale = Math.min(
        (width - 2 * margin) / Math.max(1e-6, bounds.maxX - bounds.minX),
        (height - 2 * margin) / Math.max(1e-6, bounds.maxY - bounds.minY),
    );
    const ox = (width - scale * (bounds.maxX - bounds.minX)) / 2;
    const oy = (height - scale * (bounds.maxY - bounds.minY)) / 2;
    const { right, up } = view;
    const px = p.x * right[0] + p.y * right[1] + p.z * right[2];
    const py = p.x * up[0] + p.y * up[1] + p.z * up[2];
    return {
        x: ox + (px - bounds.minX) * scale,
        y: height - (oy + (py - bounds.minY) * scale),
    };
}

export interface SoleHeightmap {
    /** Min hit Z of a +Z ray from minZ − 5 mm. Infinity on a miss. Row iy increases with +Y. */
    z: Float32Array;
    nx: number;
    ny: number;
    minX: number;
    minY: number;
    step: number;
}

/**
 * PM from-below heightmap: rays along +Z from below the sole, one sample per
 * `step` mm in XY, keeping the first hit. Display with screen-right = +X and
 * screen-up = −Y (row 0 is the −Y side).
 */
export function soleHeightmapFromBelow(
    pos: Float32Array,
    index: ArrayLike<number> | null,
    step = 0.4,
): SoleHeightmap {
    const triCount = index ? Math.floor(index.length / 3) : Math.floor(pos.length / 9);
    const vert = (t: number, k: number, c: number) => {
        const vi = index ? index[t * 3 + k]! : t * 3 + k;
        return pos[vi * 3 + c]!;
    };
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!;
        const y = pos[i + 1]!;
        const z = pos[i + 2]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
    }
    const cell = 4;
    const grid = new Map<string, number[]>();
    for (let t = 0; t < triCount; t++) {
        const ax = vert(t, 0, 0);
        const ay = vert(t, 0, 1);
        const bx = vert(t, 1, 0);
        const by = vert(t, 1, 1);
        const cx = vert(t, 2, 0);
        const cy = vert(t, 2, 1);
        const x0 = Math.floor(Math.min(ax, bx, cx) / cell);
        const x1 = Math.floor(Math.max(ax, bx, cx) / cell);
        const y0 = Math.floor(Math.min(ay, by, cy) / cell);
        const y1 = Math.floor(Math.max(ay, by, cy) / cell);
        for (let ix = x0; ix <= x1; ix++) {
            for (let iy = y0; iy <= y1; iy++) {
                const key = `${ix},${iy}`;
                let bucket = grid.get(key);
                if (!bucket) {
                    bucket = [];
                    grid.set(key, bucket);
                }
                bucket.push(t);
            }
        }
    }
    const nx = Math.max(1, Math.ceil((maxX - minX) / step));
    const ny = Math.max(1, Math.ceil((maxY - minY) / step));
    const z = new Float32Array(nx * ny);
    z.fill(Number.POSITIVE_INFINITY);
    const z0 = minZ - 5;
    for (let iy = 0; iy < ny; iy++) {
        const y = minY + (iy + 0.5) * step;
        const gy = Math.floor(y / cell);
        for (let ix = 0; ix < nx; ix++) {
            const x = minX + (ix + 0.5) * step;
            const bucket = grid.get(`${Math.floor(x / cell)},${gy}`);
            if (!bucket) continue;
            let best = Number.POSITIVE_INFINITY;
            for (const t of bucket) {
                const ax = vert(t, 0, 0);
                const ay = vert(t, 0, 1);
                const az = vert(t, 0, 2);
                const bx = vert(t, 1, 0);
                const by = vert(t, 1, 1);
                const bz = vert(t, 1, 2);
                const cx = vert(t, 2, 0);
                const cy = vert(t, 2, 1);
                const cz = vert(t, 2, 2);
                const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
                if (Math.abs(denom) < 1e-12) continue;
                const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom;
                const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom;
                const w2 = 1 - w0 - w1;
                if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
                const hz = w0 * az + w1 * bz + w2 * cz;
                if (hz >= z0 && hz < best) best = hz;
            }
            if (best < Number.POSITIVE_INFINITY) z[iy * nx + ix] = best;
        }
    }
    return { z, nx, ny, minX, minY, step };
}
