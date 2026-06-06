import type { BufferGeometry } from "three";

// Self-contained planar FDM slicer. Intersects the mesh with horizontal planes,
// stitches the resulting segments into closed loops, then emits perimeter and
// rectilinear-infill toolpaths. This is the in-house engine behind the
// Kiri:Moto integration seam (the hosted engine can replace `sliceFdm` without
// changing call sites).

export interface Move {
    type: "travel" | "extrude" | "cut";
    x: number;
    y: number;
    z: number;
}

export interface SliceOptions {
    layerHeightMm: number;
    perimeters: number;
    infillDensity: number; // 0..1
    extrusionWidthMm: number;
}

interface Tri {
    ax: number; ay: number; az: number;
    bx: number; by: number; bz: number;
    cx: number; cy: number; cz: number;
}

const EPS = 1e-4;

function extractTriangles(geometry: BufferGeometry): Tri[] {
    const pos = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const count = index ? index.count : pos.count;
    const tris: Tri[] = [];
    const at = (i: number) => (index ? index.getX(i) : i);
    for (let i = 0; i < count; i += 3) {
        const a = at(i), b = at(i + 1), c = at(i + 2);
        tris.push({
            ax: pos.getX(a), ay: pos.getY(a), az: pos.getZ(a),
            bx: pos.getX(b), by: pos.getY(b), bz: pos.getZ(b),
            cx: pos.getX(c), cy: pos.getY(c), cz: pos.getZ(c),
        });
    }
    return tris;
}

type Pt = [number, number];

function sliceLayerSegments(tris: Tri[], z: number): [Pt, Pt][] {
    const segs: [Pt, Pt][] = [];
    for (const t of tris) {
        const pts: Pt[] = [];
        const edges: [number, number, number, number, number, number][] = [
            [t.ax, t.ay, t.az, t.bx, t.by, t.bz],
            [t.bx, t.by, t.bz, t.cx, t.cy, t.cz],
            [t.cx, t.cy, t.cz, t.ax, t.ay, t.az],
        ];
        for (const [x0, y0, z0, x1, y1, z1] of edges) {
            const d0 = z0 - z;
            const d1 = z1 - z;
            if ((d0 < 0 && d1 >= 0) || (d1 < 0 && d0 >= 0)) {
                const s = d0 / (d0 - d1);
                pts.push([x0 + (x1 - x0) * s, y0 + (y1 - y0) * s]);
            }
        }
        if (pts.length === 2) segs.push([pts[0], pts[1]]);
    }
    return segs;
}

function stitchLoops(segs: [Pt, Pt][]): Pt[][] {
    const loops: Pt[][] = [];
    const used = new Array(segs.length).fill(false);
    const near = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

    for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        const loop: Pt[] = [segs[i][0], segs[i][1]];
        let extended = true;
        while (extended) {
            extended = false;
            const tail = loop[loop.length - 1];
            for (let j = 0; j < segs.length; j++) {
                if (used[j]) continue;
                if (near(segs[j][0], tail)) {
                    loop.push(segs[j][1]);
                    used[j] = true;
                    extended = true;
                    break;
                }
                if (near(segs[j][1], tail)) {
                    loop.push(segs[j][0]);
                    used[j] = true;
                    extended = true;
                    break;
                }
            }
        }
        if (loop.length >= 3) loops.push(loop);
    }
    return loops;
}

/** Offset a closed loop inward by `d` (mm) using per-vertex normal averaging. */
function offsetLoop(loop: Pt[], d: number): Pt[] {
    const n = loop.length;
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
        const prev = loop[(i - 1 + n) % n];
        const cur = loop[i];
        const next = loop[(i + 1) % n];
        const n1 = edgeNormal(prev, cur);
        const n2 = edgeNormal(cur, next);
        let nx = n1[0] + n2[0];
        let ny = n1[1] + n2[1];
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        out.push([cur[0] + nx * d, cur[1] + ny * d]);
    }
    return out;
}

function edgeNormal(a: Pt, b: Pt): Pt {
    // Inward normal assuming CCW; sign handled by averaging.
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len];
}

function infillSegments(loops: Pt[][], z: number, spacing: number, vertical: boolean): [Pt, Pt][] {
    let min = Infinity;
    let max = -Infinity;
    for (const loop of loops)
        for (const p of loop) {
            const v = vertical ? p[0] : p[1];
            min = Math.min(min, v);
            max = Math.max(max, v);
        }
    if (!Number.isFinite(min)) return [];

    const out: [Pt, Pt][] = [];
    for (let line = min + spacing; line < max; line += spacing) {
        const xs: number[] = [];
        for (const loop of loops) {
            for (let i = 0; i < loop.length; i++) {
                const a = loop[i];
                const b = loop[(i + 1) % loop.length];
                const av = vertical ? a[0] : a[1];
                const bv = vertical ? b[0] : b[1];
                if ((av <= line && bv > line) || (bv <= line && av > line)) {
                    const s = (line - av) / (bv - av);
                    const cross = vertical ? a[1] + (b[1] - a[1]) * s : a[0] + (b[0] - a[0]) * s;
                    xs.push(cross);
                }
            }
        }
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) {
            const s: Pt = vertical ? [line, xs[i]] : [xs[i], line];
            const e: Pt = vertical ? [line, xs[i + 1]] : [xs[i + 1], line];
            out.push([s, e]);
        }
    }
    void z;
    return out;
}

export function sliceFdm(geometry: BufferGeometry, opts: SliceOptions): Move[] {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return [];
    const tris = extractTriangles(geometry);
    const moves: Move[] = [];
    const spacing = opts.extrusionWidthMm / Math.max(0.05, Math.min(1, opts.infillDensity));

    let layerIndex = 0;
    for (let z = opts.layerHeightMm; z <= bb.max.z; z += opts.layerHeightMm) {
        const segs = sliceLayerSegments(tris, z);
        if (segs.length === 0) {
            layerIndex++;
            continue;
        }
        const loops = stitchLoops(segs);

        // Perimeters, outer → inner.
        for (let p = 0; p < opts.perimeters; p++) {
            for (const loop of loops) {
                const ring = p === 0 ? loop : offsetLoop(loop, -p * opts.extrusionWidthMm);
                moves.push({ type: "travel", x: ring[0][0], y: ring[0][1], z });
                for (let i = 1; i < ring.length; i++) moves.push({ type: "extrude", x: ring[i][0], y: ring[i][1], z });
                moves.push({ type: "extrude", x: ring[0][0], y: ring[0][1], z });
            }
        }

        // Infill (alternate direction per layer).
        const infillLoops = loops.map((l) => offsetLoop(l, -opts.perimeters * opts.extrusionWidthMm));
        const fill = infillSegments(infillLoops, z, spacing, layerIndex % 2 === 0);
        for (const [a, b] of fill) {
            moves.push({ type: "travel", x: a[0], y: a[1], z });
            moves.push({ type: "extrude", x: b[0], y: b[1], z });
        }
        layerIndex++;
    }
    return moves;
}
