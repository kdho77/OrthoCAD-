// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
export function renderMesh(
    pos: Float32Array,
    index: ArrayLike<number>,
    view: RenderView,
    width: number,
    height: number,
    baseColor: [number, number, number] = [150, 90, 220],
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
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
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
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
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
    rgb.fill(18);
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
                rgb[pi * 3] = Math.min(255, baseColor[0] * shade);
                rgb[pi * 3 + 1] = Math.min(255, baseColor[1] * shade);
                rgb[pi * 3 + 2] = Math.min(255, baseColor[2] * shade);
            }
        }
    }
    return rgb;
}
