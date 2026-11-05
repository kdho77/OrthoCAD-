// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { AFO_TOE_BOX_PCT_RANGE } from "./defaults";
import { cloneMesh, computeVertexNormals, vertexCount } from "./mesh-ops";
import {
    applyOffsetField,
    clamp01,
    evaluateOffsetField,
    offsetInputFromDesign,
    smoothstep,
} from "./offset-field";
import type { AfoBoxParams, AfoCastState, AfoDesignState, AfoTriMesh, AfoVec3 } from "./types";

export interface CastApplyOptions {
    /** Shin box is an add for molds. Shell production passes false. */
    includeShinBox?: boolean;
    navicular?: AfoVec3 | null;
}

/**
 * Base-tab operations after Remove Cast. Boxes are opt-in.
 * Shin box is skipped when `includeShinBox` is false (3D-printed brace/shell).
 */
export function applyCastOps(
    mesh: AfoTriMesh,
    cast: AfoCastState,
    options: CastApplyOptions = {},
): AfoTriMesh {
    let out = cloneMesh(mesh);
    const before = meshQuality(out);
    let changed = false;
    if (cast.flattenBottom) {
        out = flattenPlantar(out, cast, options.navicular ?? null);
        changed = true;
    }
    if (cast.shinBox.enabled && options.includeShinBox !== false) {
        out = applyShinBox(out, cast.shinBox.heightMm);
        changed = true;
    }
    if (cast.toeBox.enabled) {
        out = applyToeBox(out, cast);
        changed = true;
    }
    if (!changed) return out;
    out = subdivideTallVertical(out, 5);
    out = retessellateFlatSole(out, before.aspect);
    return out;
}

export function toeRegionMaxZ(mesh: AfoTriMesh): number {
    const n = vertexCount(mesh);
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) maxY = Math.max(maxY, mesh.positions[i * 3 + 1] ?? 0);
    const yCut = maxY * 0.6;
    let maxZ = 0;
    for (let i = 0; i < n; i++) {
        const y = mesh.positions[i * 3 + 1] ?? 0;
        if (y < yCut) continue;
        maxZ = Math.max(maxZ, mesh.positions[i * 3 + 2] ?? 0);
    }
    return maxZ;
}

export function clampToeBoxPct(pct: number): number {
    return Math.min(AFO_TOE_BOX_PCT_RANGE[1], Math.max(AFO_TOE_BOX_PCT_RANGE[0], pct));
}

/** Scale toe-region Z so max Z equals pct × original toe height. */
export function applyToeBoxHeight(mesh: AfoTriMesh, box: AfoBoxParams): AfoTriMesh {
    const out = cloneMesh(mesh);
    const pct = clampToeBoxPct(box.heightPct ?? 100);
    const toeH = toeRegionMaxZ(mesh);
    const target = (pct / 100) * toeH;
    if (toeH < 1e-6) return out;
    const scale = target / toeH;
    const n = vertexCount(out);
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) maxY = Math.max(maxY, out.positions[i * 3 + 1] ?? 0);
    const yCut = maxY * 0.6;
    for (let i = 0; i < n; i++) {
        const y = out.positions[i * 3 + 1] ?? 0;
        if (y < yCut) continue;
        out.positions[i * 3 + 2] = (out.positions[i * 3 + 2] ?? 0) * scale;
    }
    return out;
}

export function flattenBottom(mesh: AfoTriMesh, planeZ = 0): AfoTriMesh {
    const out = cloneMesh(mesh);
    const n = vertexCount(out);
    for (let i = 0; i < n; i++) {
        const z = out.positions[i * 3 + 2] ?? 0;
        if (z < planeZ) out.positions[i * 3 + 2] = planeZ;
    }
    return out;
}

/** Keep triangles whose centroid is inside the AABB. Degenerate but test-safe. */
export function clipAabb(mesh: AfoTriMesh, aabb: { min: number[]; max: number[] }): AfoTriMesh {
    const keep: number[] = [];
    const t = (mesh.indices.length / 3) | 0;
    for (let i = 0; i < t; i++) {
        const ia = mesh.indices[i * 3] ?? 0;
        const ib = mesh.indices[i * 3 + 1] ?? 0;
        const ic = mesh.indices[i * 3 + 2] ?? 0;
        const cx =
            ((mesh.positions[ia * 3] ?? 0) + (mesh.positions[ib * 3] ?? 0) + (mesh.positions[ic * 3] ?? 0)) /
            3;
        const cy =
            ((mesh.positions[ia * 3 + 1] ?? 0) +
                (mesh.positions[ib * 3 + 1] ?? 0) +
                (mesh.positions[ic * 3 + 1] ?? 0)) /
            3;
        const cz =
            ((mesh.positions[ia * 3 + 2] ?? 0) +
                (mesh.positions[ib * 3 + 2] ?? 0) +
                (mesh.positions[ic * 3 + 2] ?? 0)) /
            3;
        if (
            cx >= (aabb.min[0] ?? 0) &&
            cx <= (aabb.max[0] ?? 0) &&
            cy >= (aabb.min[1] ?? 0) &&
            cy <= (aabb.max[1] ?? 0) &&
            cz >= (aabb.min[2] ?? 0) &&
            cz <= (aabb.max[2] ?? 0)
        ) {
            keep.push(ia, ib, ic);
        }
    }
    if (keep.length === 0) return cloneMesh(mesh);
    return compactMesh(mesh, keep);
}

function compactMesh(mesh: AfoTriMesh, indices: number[]): AfoTriMesh {
    const map = new Map<number, number>();
    const positions: number[] = [];
    const outIdx: number[] = [];
    for (const old of indices) {
        let ni = map.get(old);
        if (ni === undefined) {
            ni = map.size;
            map.set(old, ni);
            positions.push(
                mesh.positions[old * 3] ?? 0,
                mesh.positions[old * 3 + 1] ?? 0,
                mesh.positions[old * 3 + 2] ?? 0,
            );
        }
        outIdx.push(ni);
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(outIdx) };
}

interface MeshQuality {
    aspect: number;
    edge: number;
}

function meshQuality(mesh: AfoTriMesh): MeshQuality {
    let aspect = 1;
    let edge = 0;
    const t = (mesh.indices.length / 3) | 0;
    for (let i = 0; i < t; i++) {
        const a = vert(mesh, mesh.indices[i * 3] ?? 0);
        const b = vert(mesh, mesh.indices[i * 3 + 1] ?? 0);
        const c = vert(mesh, mesh.indices[i * 3 + 2] ?? 0);
        const ab = dist(a, b);
        const bc = dist(b, c);
        const ca = dist(c, a);
        const longest = Math.max(ab, bc, ca);
        const shortest = Math.min(ab, bc, ca);
        if (longest > edge) edge = longest;
        if (shortest > 1e-6) aspect = Math.max(aspect, longest / shortest);
    }
    return { aspect, edge };
}

function vert(mesh: AfoTriMesh, i: number): AfoVec3 {
    return {
        x: mesh.positions[i * 3] ?? 0,
        y: mesh.positions[i * 3 + 1] ?? 0,
        z: mesh.positions[i * 3 + 2] ?? 0,
    };
}

function dist(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function boundsY(mesh: AfoTriMesh): { yMin: number; yMax: number; zMin: number; zMax: number } {
    const n = vertexCount(mesh);
    let yMin = Infinity;
    let yMax = -Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 0; i < n; i++) {
        const y = mesh.positions[i * 3 + 1] ?? 0;
        const z = mesh.positions[i * 3 + 2] ?? 0;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
    }
    return { yMin, yMax, zMin, zMax };
}

/**
 * Plantar plane at z_lo + removeMm. Vertices below the plane clamp up.
 * Plantar vertices (n.z < −0.3, not the shin) within addMm above the plane join it.
 * The navicular moves at most 2 mm so the medial arch is not filled.
 */
export function flattenPlantar(mesh: AfoTriMesh, cast: AfoCastState, navicular: AfoVec3 | null): AfoTriMesh {
    const out = cloneMesh(mesh);
    const n = vertexCount(out);
    const nrm = computeVertexNormals(out);
    const { zMin, zMax } = boundsY(out);
    const remove = cast.flattenRemoveMm ?? 7;
    const add = cast.flattenAddMm ?? 2.8;
    const zPlane = zMin + remove;
    const shinZ = zMin + Math.max(70, (zMax - zMin) * 0.45);
    const nav = navicular;
    for (let i = 0; i < n; i++) {
        const z = out.positions[i * 3 + 2] ?? 0;
        const nz = nrm[i * 3 + 2] ?? 0;
        const shin = z > shinZ && nz > -0.3;
        const plantar = nz < -0.3 && !shin;
        let target = z;
        if (z < zPlane) target = zPlane;
        else if (plantar && z <= zPlane + add) target = zPlane;
        if (nav && target !== z) {
            const dx = (out.positions[i * 3] ?? 0) - nav.x;
            const dy = (out.positions[i * 3 + 1] ?? 0) - nav.y;
            const dz = z - nav.z;
            const d = Math.hypot(dx, dy, dz);
            const influence = 1 - smoothstep(8, 28, d);
            const allowed = 2 + Math.max(0, Math.abs(target - z) - 2) * (1 - influence);
            const delta = target - z;
            if (Math.abs(delta) > allowed) target = z + Math.sign(delta) * allowed;
        }
        out.positions[i * 3 + 2] = target;
    }
    return out;
}

/**
 * Mold add: a band `heightMm` down from the cast top is pushed forward to the
 * anterior plane, feathered 6.5 mm (inside the 5–8 mm band).
 */
export function applyShinBox(mesh: AfoTriMesh, heightMm: number): AfoTriMesh {
    const out = cloneMesh(mesh);
    const n = vertexCount(out);
    const nrm = computeVertexNormals(out);
    let zTop = -Infinity;
    for (let i = 0; i < n; i++) zTop = Math.max(zTop, out.positions[i * 3 + 2] ?? 0);
    const zBand = zTop - heightMm;
    const feather = 6.5;
    let yPlane = -Infinity;
    for (let i = 0; i < n; i++) {
        const z = out.positions[i * 3 + 2] ?? 0;
        const ny = nrm[i * 3 + 1] ?? 0;
        if (z < zBand || ny < 0.3) continue;
        yPlane = Math.max(yPlane, out.positions[i * 3 + 1] ?? 0);
    }
    if (!Number.isFinite(yPlane)) return out;
    for (let i = 0; i < n; i++) {
        const z = out.positions[i * 3 + 2] ?? 0;
        const y = out.positions[i * 3 + 1] ?? 0;
        const ny = nrm[i * 3 + 1] ?? 0;
        const band = smoothstep(zBand - feather, zBand, z);
        const anterior = clamp01((ny - 0.05) / 0.4);
        if (band <= 0 || anterior <= 0 || y >= yPlane) continue;
        out.positions[i * 3 + 1] = y + (yPlane - y) * anterior * band;
    }
    return out;
}

/**
 * Extrude the forefoot (y > 0.6 of foot length) distally. The distal face is
 * flat and vertical, the sole sits on the plantar plane, and the dorsum gains
 * `thicknessMm`. The first 5 mm blends back into the foot.
 */
export function applyToeBox(mesh: AfoTriMesh, cast: AfoCastState): AfoTriMesh {
    const out = cloneMesh(mesh);
    const n = vertexCount(out);
    const box = cast.toeBox;
    const extra = box.extraLengthMm ?? 15;
    const thick = box.thicknessMm ?? 0;
    const { yMin, yMax, zMin } = boundsY(out);
    const footLen = Math.max(1, yMax - yMin);
    const yCut = yMin + 0.6 * footLen;
    const yEnd = yMax + extra;
    const nrm = computeVertexNormals(out);
    const plane = cast.flattenBottom ? zMin + (cast.flattenRemoveMm ?? 7) : zMin;
    for (let i = 0; i < n; i++) {
        const y = out.positions[i * 3 + 1] ?? 0;
        if (y <= yCut) continue;
        const blend = smoothstep(yCut, yCut + 5, y);
        const tip = smoothstep(yMax - 5, yMax, y);
        const extruded = y + extra * blend;
        out.positions[i * 3 + 1] = extruded * (1 - tip) + yEnd * tip;
        const z = out.positions[i * 3 + 2] ?? 0;
        const nz = nrm[i * 3 + 2] ?? 0;
        if (nz < -0.3 || z <= plane + 2) {
            out.positions[i * 3 + 2] = z * (1 - blend) + plane * blend;
        } else {
            out.positions[i * 3 + 2] = z + thick * blend;
        }
    }
    return out;
}

function subdivideTallVertical(mesh: AfoTriMesh, maxLen: number): AfoTriMesh {
    return splitEdges(mesh, (a, b) => {
        const len = dist(a, b);
        if (len <= maxLen) return false;
        return Math.abs(a.z - b.z) / len > 0.85;
    });
}

function retessellateFlatSole(mesh: AfoTriMesh, limit: number): AfoTriMesh {
    const { zMin } = boundsY(mesh);
    return splitEdges(mesh, (a, b, c) => {
        if (!c) return false;
        if (Math.abs(a.z - zMin) > 1.5 || Math.abs(b.z - zMin) > 1.5 || Math.abs(c.z - zMin) > 1.5) {
            return false;
        }
        const ab = dist(a, b);
        const bc = dist(b, c);
        const ca = dist(c, a);
        const longest = Math.max(ab, bc, ca);
        const shortest = Math.min(ab, bc, ca);
        return shortest > 1e-6 && longest / shortest > limit + 0.25 && longest === ab;
    });
}

function splitEdges(
    mesh: AfoTriMesh,
    shouldSplit: (a: AfoVec3, b: AfoVec3, c?: AfoVec3) => boolean,
): AfoTriMesh {
    const t = (mesh.indices.length / 3) | 0;
    const mid = new Map<string, number>();
    const positions = Array.from(mesh.positions);
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const midpoint = (a: number, b: number): number => {
        const k = key(a, b);
        const hit = mid.get(k);
        if (hit != null) return hit;
        const ia = positions.length / 3;
        positions.push(
            ((mesh.positions[a * 3] ?? 0) + (mesh.positions[b * 3] ?? 0)) * 0.5,
            ((mesh.positions[a * 3 + 1] ?? 0) + (mesh.positions[b * 3 + 1] ?? 0)) * 0.5,
            ((mesh.positions[a * 3 + 2] ?? 0) + (mesh.positions[b * 3 + 2] ?? 0)) * 0.5,
        );
        mid.set(k, ia);
        return ia;
    };
    const indices: number[] = [];
    for (let i = 0; i < t; i++) {
        const a = mesh.indices[i * 3] ?? 0;
        const b = mesh.indices[i * 3 + 1] ?? 0;
        const c = mesh.indices[i * 3 + 2] ?? 0;
        const pa = vert(mesh, a);
        const pb = vert(mesh, b);
        const pc = vert(mesh, c);
        const sab = shouldSplit(pa, pb, pc);
        const sbc = shouldSplit(pb, pc, pa);
        const sca = shouldSplit(pc, pa, pb);
        if (!sab && !sbc && !sca) {
            indices.push(a, b, c);
            continue;
        }
        const ab = sab ? midpoint(a, b) : -1;
        const bc = sbc ? midpoint(b, c) : -1;
        const ca = sca ? midpoint(c, a) : -1;
        if (sab && sbc && sca) indices.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
        else if (sab && !sbc && !sca) indices.push(a, ab, c, ab, b, c);
        else if (!sab && sbc && !sca) indices.push(b, bc, a, bc, c, a);
        else if (!sab && !sbc && sca) indices.push(c, ca, b, ca, a, b);
        else if (sab && sbc) indices.push(a, ab, c, ab, bc, c, ab, b, bc);
        else if (sbc && sca) indices.push(b, bc, a, bc, ca, a, bc, c, ca);
        else indices.push(c, ca, b, ca, ab, b, ca, a, ab);
    }
    if (mid.size === 0) return mesh;
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

export function applyClinicalCast(
    mesh: AfoTriMesh,
    afo: AfoDesignState,
    extras?: { medialMal?: AfoVec3; lateralMal?: AfoVec3; navicular?: AfoVec3 | null },
    options?: { includeShinBox?: boolean },
): { mesh: AfoTriMesh; featherMm: number; meshable: boolean } {
    const field = evaluateOffsetField(offsetInputFromDesign(mesh, afo, extras));
    const removed = applyOffsetField(mesh, field);
    const includeShinBox = options?.includeShinBox ?? afo.method !== "printing_shell";
    const nav =
        extras?.navicular ??
        afo.clinicalMarkers.find((m) => m.id === "navicular")?.point ??
        afo.scanWorkflow.landmarks.navicular ??
        null;
    const boxed = applyCastOps(removed, afo.cast, { includeShinBox, navicular: nav });
    return { mesh: boxed, featherMm: field.featherMm, meshable: field.meshable };
}
