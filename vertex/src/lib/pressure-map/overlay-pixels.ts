// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Camera, Mesh } from "three";
import { Vector3 } from "three";

/** Disk-dilate a binary mask. Radius is in pixels (Euclidean). */
export function dilateMask(src: Uint8Array, width: number, height: number, radiusPx: number): Uint8Array {
    const r = Math.ceil(radiusPx);
    const r2 = radiusPx * radiusPx;
    const offsets: Array<{ dx: number; dy: number }> = [];
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy <= r2) offsets.push({ dx, dy });
        }
    }
    const out = src.slice();
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!src[y * width + x]) continue;
            for (const o of offsets) {
                const nx = x + o.dx;
                const ny = y + o.dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                out[ny * width + nx] = 1;
            }
        }
    }
    return out;
}

/** Paint the mesh's screen silhouette into a top-left binary mask. */
export function rasterizeMeshSilhouette(
    mesh: Mesh,
    camera: Camera,
    width: number,
    height: number,
    mask: Uint8Array,
): void {
    const pos = mesh.geometry?.getAttribute("position");
    if (!pos) return;
    mesh.updateWorldMatrix(true, true);
    const index = mesh.geometry.getIndex();
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let t = 0; t < triCount; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        const p0 = project(mesh, pos, i0, camera, width, height, a);
        const p1 = project(mesh, pos, i1, camera, width, height, b);
        const p2 = project(mesh, pos, i2, camera, width, height, c);
        if (!p0 || !p1 || !p2) continue;
        fillTriangle(mask, width, height, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
    }
}

function project(
    mesh: Mesh,
    pos: { getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number },
    index: number,
    camera: Camera,
    width: number,
    height: number,
    out: Vector3,
): { x: number; y: number } | null {
    out.set(pos.getX(index), pos.getY(index), pos.getZ(index));
    mesh.localToWorld(out);
    out.project(camera);
    if (!Number.isFinite(out.x) || !Number.isFinite(out.y) || out.z < -1 || out.z > 1) return null;
    return {
        x: (out.x * 0.5 + 0.5) * width,
        y: (1 - (out.y * 0.5 + 0.5)) * height,
    };
}

function fillTriangle(
    mask: Uint8Array,
    width: number,
    height: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
): void {
    const pts = [
        { x: ax, y: ay },
        { x: bx, y: by },
        { x: cx, y: cy },
    ].sort((p, q) => p.y - q.y);
    const p0 = pts[0];
    const p1 = pts[1];
    const p2 = pts[2];
    if (!p0 || !p1 || !p2) return;
    if (p2.y - p0.y < 1e-6) return;
    const yStart = Math.max(0, Math.ceil(p0.y));
    const yEnd = Math.min(height - 1, Math.floor(p2.y));
    for (let y = yStart; y <= yEnd; y++) {
        const longX = interpX(p0, p2, y);
        const shortX = y < p1.y ? interpX(p0, p1, y) : interpX(p1, p2, y);
        let x0 = Math.ceil(Math.min(longX, shortX));
        let x1 = Math.floor(Math.max(longX, shortX));
        if (x0 < 0) x0 = 0;
        if (x1 >= width) x1 = width - 1;
        const row = y * width;
        for (let x = x0; x <= x1; x++) mask[row + x] = 1;
    }
}

function interpX(a: { x: number; y: number }, b: { x: number; y: number }, y: number): number {
    const dy = b.y - a.y;
    if (Math.abs(dy) < 1e-8) return a.x;
    return a.x + ((y - a.y) / dy) * (b.x - a.x);
}

export interface OutsideCount {
    /**
     * Pressure-map pixels outside the dilated silhouette: saturated jet ink, or a near-white sheet.
     * Gray shell antialiasing and the slate trimline are not counted.
     */
    outside: number;
    /** Every non-background pixel outside the mask, including shell fringe. */
    fringe: number;
    /** Pixels inside the silhouette that are not the clear color. Proves the framebuffer was read. */
    insideVarying: number;
    /** Mean color of `outside` pixels, or zeros when there are none. */
    spill: { r: number; g: number; b: number };
}

/**
 * Count framebuffer pixels that are not the clear color and sit outside the mask.
 * `rgba` is readPixels order (bottom-left). `mask` is top-left, 1 = inside.
 */
export function countPixelsOutsideMask(
    rgba: Uint8Array,
    mask: Uint8Array,
    width: number,
    height: number,
    background: { r: number; g: number; b: number },
    tolerance = 22,
): OutsideCount {
    const tol2 = tolerance * tolerance;
    let outside = 0;
    let fringe = 0;
    let insideVarying = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let y = 0; y < height; y++) {
        const ry = height - 1 - y;
        for (let x = 0; x < width; x++) {
            const gi = (ry * width + x) * 4;
            const r = rgba[gi] ?? 0;
            const g = rgba[gi + 1] ?? 0;
            const b = rgba[gi + 2] ?? 0;
            const dr = r - background.r;
            const dg = g - background.g;
            const db = b - background.b;
            const differs = dr * dr + dg * dg + db * db > tol2;
            if (!differs) continue;
            if (mask[y * width + x]) {
                insideVarying++;
                continue;
            }
            fringe++;
            if (!isPressureOverlayPixel(r, g, b)) continue;
            outside++;
            sr += r;
            sg += g;
            sb += b;
        }
    }
    const n = Math.max(1, outside);
    return {
        outside,
        fringe,
        insideVarying,
        spill: outside
            ? { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) }
            : { r: 0, g: 0, b: 0 },
    };
}

/** Jet ink is saturated. The keyed sheet is near-white. Shell gray and slate trimline are neither. */
function isPressureOverlayPixel(r: number, g: number, b: number): boolean {
    const lum = (r + g + b) / 3;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum >= 200 && chroma <= 36) return true;
    return chroma >= 48;
}
