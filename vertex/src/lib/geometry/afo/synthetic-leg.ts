// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { AfoTriMesh, AfoVec3 } from "./types";

/**
 * Small closed UV-sphere. Used for offset identity / ±10 mm tests.
 * Radius is in millimetres; origin at the centre.
 */
export function buildUnitSphereMesh(radiusMm: number, segments = 12): AfoTriMesh {
    const stacks = Math.max(4, segments);
    const slices = Math.max(6, segments * 2);
    const positions: number[] = [];
    const indices: number[] = [];

    // North pole
    positions.push(0, 0, radiusMm);
    for (let i = 1; i < stacks; i++) {
        const phi = (i / stacks) * Math.PI;
        const sp = Math.sin(phi);
        const cp = Math.cos(phi);
        for (let j = 0; j < slices; j++) {
            const theta = (j / slices) * Math.PI * 2;
            positions.push(radiusMm * sp * Math.cos(theta), radiusMm * sp * Math.sin(theta), radiusMm * cp);
        }
    }
    // South pole
    positions.push(0, 0, -radiusMm);
    const south = positions.length / 3 - 1;
    const ring = (i: number, j: number) => 1 + (i - 1) * slices + (j % slices);

    for (let j = 0; j < slices; j++) {
        indices.push(0, ring(1, j), ring(1, j + 1));
    }
    for (let i = 1; i < stacks - 1; i++) {
        for (let j = 0; j < slices; j++) {
            const a = ring(i, j);
            const b = ring(i + 1, j);
            const c = ring(i, j + 1);
            const d = ring(i + 1, j + 1);
            indices.push(a, b, c, c, b, d);
        }
    }
    for (let j = 0; j < slices; j++) {
        indices.push(south, ring(stacks - 1, j + 1), ring(stacks - 1, j));
    }

    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * Compact closed foot+leg for workflow tests. Shin capsule + foot ellipsoid
 * approximated as a UV-sphere translated and non-uniformly scaled, then a
 * second sphere for the foot, stitched by keeping a single watertight body
 * via implicit union sampled on a coarse lattice (marching tetrahedra of min
 * of two analytic SDFs).
 *
 * The result is intentionally tiny (a few hundred triangles) so it can live
 * in the repo as generated geometry — never as a patient scan fixture.
 */
export function buildSyntheticLegMesh(): AfoTriMesh {
    // Implicit union of shin capsule (along +Z) and foot ellipsoid (along +Y).
    const shinA = { x: 0, y: 35, z: 40 };
    const shinB = { x: 0, y: 35, z: 200 };
    const shinR = 28;
    const footC = { x: 0, y: 90, z: 22 };
    const footR = { x: 32, y: 90, z: 22 };

    const sdf = (x: number, y: number, z: number): number => {
        const dCap = capsuleDistance(x, y, z, shinA, shinB, shinR);
        const dFoot = ellipsoidDistance(x, y, z, footC, footR);
        return Math.min(dCap, dFoot);
    };

    return extractImplicitSolid(sdf, {
        min: { x: -50, y: -20, z: -8 },
        max: { x: 50, y: 190, z: 230 },
        cells: 18,
    });
}

function capsuleDistance(
    x: number,
    y: number,
    z: number,
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    r: number,
): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const apx = x - a.x;
    const apy = y - a.y;
    const apz = z - a.z;
    const ab2 = abx * abx + aby * aby + abz * abz || 1;
    let t = (apx * abx + apy * aby + apz * abz) / ab2;
    t = Math.min(1, Math.max(0, t));
    const dx = x - (a.x + abx * t);
    const dy = y - (a.y + aby * t);
    const dz = z - (a.z + abz * t);
    return Math.hypot(dx, dy, dz) - r;
}

function ellipsoidDistance(
    x: number,
    y: number,
    z: number,
    c: { x: number; y: number; z: number },
    r: { x: number; y: number; z: number },
): number {
    const px = (x - c.x) / r.x;
    const py = (y - c.y) / r.y;
    const pz = (z - c.z) / r.z;
    const k = Math.hypot(px, py, pz);
    if (k < 1e-9) return -Math.min(r.x, r.y, r.z);
    // First-order ellipsoid SDF approximation (sufficient for a test body).
    return (k - 1) * Math.min(r.x, r.y, r.z);
}

function extractImplicitSolid(
    sdf: (x: number, y: number, z: number) => number,
    bounds: {
        min: { x: number; y: number; z: number };
        max: { x: number; y: number; z: number };
        cells: number;
    },
): AfoTriMesh {
    const nx = bounds.cells;
    const ny = bounds.cells;
    const nz = bounds.cells;
    const dx = (bounds.max.x - bounds.min.x) / nx;
    const dy = (bounds.max.y - bounds.min.y) / ny;
    const dz = (bounds.max.z - bounds.min.z) / nz;
    const grid = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
    const idx = (i: number, j: number, k: number) => i + (nx + 1) * (j + (ny + 1) * k);
    for (let k = 0; k <= nz; k++) {
        const z = bounds.min.z + k * dz;
        for (let j = 0; j <= ny; j++) {
            const y = bounds.min.y + j * dy;
            for (let i = 0; i <= nx; i++) {
                const x = bounds.min.x + i * dx;
                grid[idx(i, j, k)] = sdf(x, y, z);
            }
        }
    }

    const positions: number[] = [];
    const indices: number[] = [];
    const vertKey = new Map<string, number>();
    const snap = (x: number, y: number, z: number): number => {
        const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
        const existing = vertKey.get(key);
        if (existing !== undefined) return existing;
        const id = vertKey.size;
        vertKey.set(key, id);
        positions.push(x, y, z);
        return id;
    };

    const lerp = (a: number, b: number, va: number, vb: number): number => {
        const d = vb - va;
        if (Math.abs(d) < 1e-12) return 0.5;
        return (0 - va) / d;
    };

    const corner = (i: number, j: number, k: number) => ({
        x: bounds.min.x + i * dx,
        y: bounds.min.y + j * dy,
        z: bounds.min.z + k * dz,
        v: grid[idx(i, j, k)] ?? 1,
    });

    // 6 tetrahedra per cube, consistent diagonal (0,0,0)-(1,1,1).
    const tets: [number, number, number, number][] = [
        [0, 1, 3, 7],
        [0, 1, 5, 7],
        [0, 4, 5, 7],
        [0, 2, 3, 7],
        [0, 2, 6, 7],
        [0, 4, 6, 7],
    ];

    for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const c = [
                    corner(i, j, k),
                    corner(i + 1, j, k),
                    corner(i, j + 1, k),
                    corner(i + 1, j + 1, k),
                    corner(i, j, k + 1),
                    corner(i + 1, j, k + 1),
                    corner(i, j + 1, k + 1),
                    corner(i + 1, j + 1, k + 1),
                ];
                for (const tet of tets) {
                    emitTet(c, tet, lerp, snap, indices);
                }
            }
        }
    }

    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function emitTet(
    corners: { x: number; y: number; z: number; v: number }[],
    tet: [number, number, number, number],
    lerp: (a: number, b: number, va: number, vb: number) => number,
    snap: (x: number, y: number, z: number) => number,
    indices: number[],
): void {
    const p = tet.map((t) => corners[t]!);
    let mask = 0;
    for (let i = 0; i < 4; i++) if ((p[i]?.v ?? 1) < 0) mask |= 1 << i;
    if (mask === 0 || mask === 15) return;

    const edge = (a: number, b: number) => {
        const pa = p[a]!;
        const pb = p[b]!;
        const t = lerp(0, 1, pa.v, pb.v);
        return snap(pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t, pa.z + (pb.z - pa.z) * t);
    };

    // 16-case tet table (inside = sdf < 0). Winding: outward.
    const edges: [number, number][] = [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
        [2, 3],
    ];
    const cases: number[][] = [
        [],
        [0, 1, 2],
        [0, 3, 4],
        [1, 2, 4, 1, 4, 3],
        [1, 5, 3],
        [0, 5, 2, 0, 3, 5],
        [0, 1, 5, 0, 5, 4],
        [2, 4, 5],
        [2, 5, 4],
        [0, 4, 5, 0, 5, 1],
        [0, 2, 5, 0, 5, 3],
        [1, 3, 5],
        [1, 3, 4, 1, 4, 2],
        [0, 4, 3],
        [0, 2, 1],
        [],
    ];
    const tri = cases[mask] ?? [];
    for (let t = 0; t + 2 < tri.length; t += 3) {
        const e0 = edges[tri[t] ?? 0]!;
        const e1 = edges[tri[t + 1] ?? 0]!;
        const e2 = edges[tri[t + 2] ?? 0]!;
        const ia = edge(e0[0], e0[1]);
        const ib = edge(e1[0], e1[1]);
        const ic = edge(e2[0], e2[1]);
        if (ia !== ib && ib !== ic && ic !== ia) indices.push(ia, ib, ic);
    }
}

export interface ClinicalFixture {
    mesh: AfoTriMesh;
    markers: {
        heel: AfoVec3;
        medialMal: AfoVec3;
        lateralMal: AfoVec3;
        navicular: AfoVec3;
        fifthMetBase: AfoVec3;
        postCalcaneus: AfoVec3;
        fibularHead: AfoVec3;
        tibialTuberosity: AfoVec3;
        distalCrest: AfoVec3;
    };
    handCrest: AfoVec3[];
}

function nearestOn(mesh: AfoTriMesh, p: AfoVec3): AfoVec3 {
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

function addAnteriorRidge(mesh: AfoTriMesh, bulgeMm: number): AfoTriMesh {
    const n = (mesh.positions.length / 3) | 0;
    const positions = new Float32Array(mesh.positions);
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3] ?? 0;
        const y = positions[i * 3 + 1] ?? 0;
        const z = positions[i * 3 + 2] ?? 0;
        if (z < 70 || z > 215) continue;
        const ang = Math.atan2(x, y - 35);
        if (Math.abs(ang) > (18 * Math.PI) / 180) continue;
        const w = Math.cos((ang / ((18 * Math.PI) / 180)) * (Math.PI / 2));
        const nx = x;
        const ny = y - 35;
        const nl = Math.hypot(nx, ny) || 1;
        positions[i * 3] = x + (nx / nl) * bulgeMm * w;
        positions[i * 3 + 1] = y + (ny / nl) * bulgeMm * w;
    }
    return { positions, indices: mesh.indices };
}

function handCrestFromMesh(mesh: AfoTriMesh): AfoVec3[] {
    const n = (mesh.positions.length / 3) | 0;
    const pts: AfoVec3[] = [];
    for (let z = 60; z <= 220; z += 5) {
        let best: AfoVec3 | null = null;
        let bestY = -Infinity;
        for (let i = 0; i < n; i++) {
            const pz = mesh.positions[i * 3 + 2] ?? 0;
            if (Math.abs(pz - z) > 3) continue;
            const y = mesh.positions[i * 3 + 1] ?? 0;
            const x = mesh.positions[i * 3] ?? 0;
            if (Math.abs(x) > 18) continue;
            if (y > bestY) {
                bestY = y;
                best = { x, y, z: pz };
            }
        }
        if (best) pts.push(best);
    }
    return pts;
}

function fixtureMarkers(mesh: AfoTriMesh) {
    return {
        heel: nearestOn(mesh, { x: 0, y: 0, z: 0 }),
        medialMal: nearestOn(mesh, { x: 28, y: 40, z: 80 }),
        lateralMal: nearestOn(mesh, { x: -28, y: 40, z: 80 }),
        navicular: nearestOn(mesh, { x: 28, y: 70, z: 35 }),
        fifthMetBase: nearestOn(mesh, { x: -28, y: 90, z: 28 }),
        postCalcaneus: nearestOn(mesh, { x: 0, y: 8, z: 22 }),
        fibularHead: nearestOn(mesh, { x: -22, y: 38, z: 210 }),
        tibialTuberosity: nearestOn(mesh, { x: 0, y: 58, z: 160 }),
        distalCrest: nearestOn(mesh, { x: 0, y: 58, z: 80 }),
    };
}

/** Ridged shin with a clear anterior crest (fixture A). */
export function buildClinicalFixtureA(): ClinicalFixture {
    const base = extractImplicitSolid(
        (x, y, z) => {
            const dCap = capsuleDistance(x, y, z, { x: 0, y: 35, z: 40 }, { x: 0, y: 35, z: 210 }, 28);
            const dFoot = ellipsoidDistance(x, y, z, { x: 0, y: 90, z: 22 }, { x: 32, y: 90, z: 22 });
            return Math.min(dCap, dFoot);
        },
        { min: { x: -50, y: -20, z: -8 }, max: { x: 50, y: 190, z: 230 }, cells: 20 },
    );
    const mesh = addAnteriorRidge(base, 9);
    return { mesh, markers: fixtureMarkers(mesh), handCrest: handCrestFromMesh(mesh) };
}

/** Round shin, low crest confidence (fixture B). */
export function buildClinicalFixtureB(): ClinicalFixture {
    const mesh = extractImplicitSolid(
        (x, y, z) => {
            const dCap = capsuleDistance(x, y, z, { x: 0, y: 35, z: 40 }, { x: 0, y: 35, z: 210 }, 28);
            const dFoot = ellipsoidDistance(x, y, z, { x: 0, y: 90, z: 22 }, { x: 32, y: 90, z: 22 });
            return Math.min(dCap, dFoot);
        },
        { min: { x: -50, y: -20, z: -8 }, max: { x: 50, y: 190, z: 230 }, cells: 16 },
    );
    return { mesh, markers: fixtureMarkers(mesh), handCrest: handCrestFromMesh(mesh) };
}
