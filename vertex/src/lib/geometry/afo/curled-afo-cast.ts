// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { medialSign } from "@/lib/geometry/handedness";
import type { Side } from "@/types";
import { orientMeshOutward } from "./mesh-ops";
import type { AfoTriMesh, AfoVec3 } from "./types";

/**
 * Synthetic curled AFO positive in the live plantar frame.
 * +X heel→toe, +Z up, medial = medialSign along Y.
 * The sole is a height field: flat tripod, arch behind the angled met line,
 * toe curl forward of that line. No patient scan is committed in this repo.
 */
export interface CurledAfoCast {
    mesh: AfoTriMesh;
    side: Side;
    heel: AfoVec3;
    m1: AfoVec3;
    m5: AfoVec3;
    /** Posterior heel wall, used to check the cup is not flattened. */
    heelCup: AfoVec3;
    medialMalleolus: AfoVec3;
    lateralMalleolus: AfoVec3;
}

export function curledSoleZ(x: number, y: number, side: Side): number {
    const medY = medialSign(side) * 28;
    const latY = -medialSign(side) * 28;
    const t = (y - medY) / (latY - medY || 1);
    const metX = 152 + (128 - 152) * t;
    const ahead = x - metX;
    let z = 0;
    if (ahead > 0) {
        const u = Math.min(1, ahead / 42);
        const s = u * u * (3 - 2 * u);
        z += 16 * s;
    } else {
        const behind = -ahead;
        const medial = medialSign(side) * y;
        const arch =
            Math.exp(-((behind - 32) ** 2) / (2 * 18 * 18)) * Math.exp(-((medial - 14) ** 2) / (2 * 14 * 14));
        z += 7.5 * arch;
    }
    if (x < 30) {
        const u = (30 - x) / 30;
        z += u * u * 14;
    }
    return z;
}

export function buildCurledAfoCast(side: Side, nx = 40, ny = 18): CurledAfoCast {
    const x0 = 0;
    const x1 = 200;
    const y0 = -40;
    const y1 = 40;
    const positions: number[] = [];
    const bottomAt = (i: number, j: number) => j * nx + i;
    const topAt = (i: number, j: number) => nx * ny + j * nx + i;
    const xyz: AfoVec3[] = [];
    for (let j = 0; j < ny; j++) {
        const y = y0 + ((y1 - y0) * j) / (ny - 1);
        for (let i = 0; i < nx; i++) {
            const x = x0 + ((x1 - x0) * i) / (nx - 1);
            const sole = curledSoleZ(x, y, side);
            xyz.push({ x, y, z: sole });
        }
    }
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const base = xyz[bottomAt(i, j)]!;
            let top = base.z + 26;
            const dx = (base.x - 36) / 34;
            const dy = base.y / 32;
            const r = Math.hypot(dx, dy);
            if (r < 1.05 && base.x < 95) {
                const k = r >= 1 ? 0 : (1 - r) ** 0.7;
                top = Math.max(top, top + (168 - top) * k);
            }
            const sign = medialSign(side);
            const malleolar =
                Math.exp(-((base.x - 40) ** 2) / (2 * 12 * 12)) *
                Math.exp(-((base.z + 26 - 78) ** 2) / (2 * 16 * 16));
            let yOut = base.y;
            if (j === 0 || j === ny - 1) {
                const med = sign * base.y;
                if (med > 20) yOut += sign * 6 * malleolar;
                if (med < -20) yOut += -sign * 5 * Math.exp(-((base.x - 32) ** 2) / 200);
            }
            xyz.push({ x: base.x, y: yOut, z: top });
        }
    }
    for (const p of xyz) positions.push(p.x, p.y, p.z);

    const indices: number[] = [];
    const push = (a: number, b: number, c: number) => indices.push(a, b, c);
    for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
            const a = bottomAt(i, j);
            const b = bottomAt(i + 1, j);
            const c = bottomAt(i, j + 1);
            const d = bottomAt(i + 1, j + 1);
            push(a, c, b);
            push(c, d, b);
            const ta = topAt(i, j);
            const tb = topAt(i + 1, j);
            const tc = topAt(i, j + 1);
            const td = topAt(i + 1, j + 1);
            push(ta, tb, tc);
            push(tb, td, tc);
        }
    }
    const sideQuad = (a: number, b: number, c: number, d: number) => {
        push(a, b, c);
        push(b, d, c);
    };
    for (let i = 0; i < nx - 1; i++) {
        sideQuad(bottomAt(i, 0), bottomAt(i + 1, 0), topAt(i, 0), topAt(i + 1, 0));
        sideQuad(bottomAt(i + 1, ny - 1), bottomAt(i, ny - 1), topAt(i + 1, ny - 1), topAt(i, ny - 1));
    }
    for (let j = 0; j < ny - 1; j++) {
        sideQuad(bottomAt(0, j + 1), bottomAt(0, j), topAt(0, j + 1), topAt(0, j));
        sideQuad(bottomAt(nx - 1, j), bottomAt(nx - 1, j + 1), topAt(nx - 1, j), topAt(nx - 1, j + 1));
    }

    const mesh = orientMeshOutward({
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
    });
    const medY = medialSign(side) * 28;
    const latY = -medialSign(side) * 28;
    return {
        mesh,
        side,
        heel: nearest(mesh, { x: 42, y: 0, z: curledSoleZ(42, 0, side) }),
        m1: nearest(mesh, { x: 152, y: medY, z: curledSoleZ(152, medY, side) }),
        m5: nearest(mesh, { x: 128, y: latY, z: curledSoleZ(128, latY, side) }),
        heelCup: nearest(mesh, { x: 2, y: 0, z: 36 }),
        medialMalleolus: nearest(mesh, { x: 40, y: medialSign(side) * 40, z: 80 }),
        lateralMalleolus: nearest(mesh, { x: 32, y: -medialSign(side) * 40, z: 70 }),
    };
}

/** Open plantar sheet with the same curl, for surface tests that skip the shell. */
export function buildCurledSoleSheet(side: Side, nx = 48, ny = 20): CurledAfoCast {
    const x0 = 8;
    const x1 = 198;
    const y0 = -36;
    const y1 = 36;
    const positions: number[] = [];
    const atIndex = (i: number, j: number) => j * nx + i;
    for (let j = 0; j < ny; j++) {
        const y = y0 + ((y1 - y0) * j) / (ny - 1);
        for (let i = 0; i < nx; i++) {
            const x = x0 + ((x1 - x0) * i) / (nx - 1);
            let z = curledSoleZ(x, y, side);
            const onRim = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
            if (onRim && x > 150) z += 6;
            if (i === 0) z += 18;
            positions.push(x, y, z);
        }
    }
    const indices: number[] = [];
    for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
            const a = atIndex(i, j);
            const b = atIndex(i + 1, j);
            const c = atIndex(i, j + 1);
            const d = atIndex(i + 1, j + 1);
            indices.push(a, c, b, c, d, b);
        }
    }
    const mesh: AfoTriMesh = {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
    };
    const medY = medialSign(side) * 28;
    const latY = -medialSign(side) * 28;
    return {
        mesh,
        side,
        heel: nearest(mesh, { x: 42, y: 0, z: 0 }),
        m1: nearest(mesh, { x: 152, y: medY, z: 0 }),
        m5: nearest(mesh, { x: 128, y: latY, z: 0 }),
        heelCup: nearest(mesh, { x: 8, y: 0, z: 10 }),
        medialMalleolus: nearest(mesh, { x: 40, y: medialSign(side) * 36, z: 0 }),
        lateralMalleolus: nearest(mesh, { x: 32, y: -medialSign(side) * 36, z: 0 }),
    };
}

export function soleSheetBoundary(mesh: AfoTriMesh): number[] {
    const n = (mesh.positions.length / 3) | 0;
    const count = new Map<string, { a: number; b: number; n: number }>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const t = (mesh.indices.length / 3) | 0;
    for (let f = 0; f < t; f++) {
        const vs = [mesh.indices[f * 3] ?? 0, mesh.indices[f * 3 + 1] ?? 0, mesh.indices[f * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const a = vs[e]!;
            const b = vs[(e + 1) % 3]!;
            const k = key(a, b);
            const prev = count.get(k);
            if (prev) prev.n += 1;
            else count.set(k, { a, b, n: 1 });
        }
    }
    const next = new Map<number, number[]>();
    for (const e of count.values()) {
        if (e.n !== 1) continue;
        const list = next.get(e.a) ?? [];
        list.push(e.b);
        next.set(e.a, list);
        const back = next.get(e.b) ?? [];
        back.push(e.a);
        next.set(e.b, back);
    }
    const start = next.keys().next().value as number | undefined;
    if (start == null) return [];
    const loop = [start];
    const seen = new Set<number>([start]);
    while (loop.length < n) {
        const cur = loop[loop.length - 1]!;
        const nxt = (next.get(cur) ?? []).find((v) => !seen.has(v));
        if (nxt == null) break;
        seen.add(nxt);
        loop.push(nxt);
    }
    return loop;
}

function nearest(mesh: AfoTriMesh, p: AfoVec3): AfoVec3 {
    const n = (mesh.positions.length / 3) | 0;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
        const dx = (mesh.positions[i * 3] ?? 0) - p.x;
        const dy = (mesh.positions[i * 3 + 1] ?? 0) - p.y;
        const dz = (mesh.positions[i * 3 + 2] ?? 0) - p.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return {
        x: mesh.positions[best * 3] ?? p.x,
        y: mesh.positions[best * 3 + 1] ?? p.y,
        z: mesh.positions[best * 3 + 2] ?? p.z,
    };
}
