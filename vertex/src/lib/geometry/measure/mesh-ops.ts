// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { BufferAttribute, BufferGeometry } from "three";
import { applySacrificialLeaderBlock, binaryStlBounds } from "@/lib/geometry/leader-block";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import type {
    MeasureAabb,
    MeasureHit,
    MeasureOverall,
    MeasureProduct,
    MeasureSegment,
    MeasureTriangleMesh,
    MeasureVec3,
} from "./types";

const EPS = 1e-8;

export function formatMeasureMm(value: number): string {
    if (!Number.isFinite(value)) return "—";
    return value.toFixed(1);
}

export function meshAabb(positions: ArrayLike<number>): MeasureAabb {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i + 2 < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        const y = positions[i + 1] ?? 0;
        const z = positions[i + 2] ?? 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) {
        return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    }
    return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/**
 * Overall print size.
 * Insole: length × width × height = ΔX × ΔY × ΔZ (flat bottom is min Z).
 * AFO: footplate length × overall height × width = ΔY × ΔZ × ΔX.
 */
export function overallFromAabb(bounds: MeasureAabb, product: MeasureProduct): MeasureOverall {
    const dx = bounds.max.x - bounds.min.x;
    const dy = bounds.max.y - bounds.min.y;
    const dz = bounds.max.z - bounds.min.z;
    if (product === "afo") {
        return {
            lengthMm: dy,
            widthMm: dx,
            heightMm: dz,
            min: bounds.min,
            max: bounds.max,
            includedLeader: false,
            leaderError: null,
        };
    }
    return {
        lengthMm: dx,
        widthMm: dy,
        heightMm: dz,
        min: bounds.min,
        max: bounds.max,
        includedLeader: false,
        leaderError: null,
    };
}

export function bufferGeometryFromMesh(mesh: MeasureTriangleMesh): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(mesh.positions.slice(), 3));
    geometry.setIndex(new BufferAttribute(mesh.indices.slice(), 1));
    return geometry;
}

export function triangleMeshFromGeometry(geometry: BufferGeometry): MeasureTriangleMesh {
    const pos = geometry.getAttribute("position");
    if (!pos) return { positions: new Float32Array(), indices: new Uint32Array() };
    const positions = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        positions[i * 3] = pos.getX(i);
        positions[i * 3 + 1] = pos.getY(i);
        positions[i * 3 + 2] = pos.getZ(i);
    }
    const index = geometry.getIndex();
    const indices = new Uint32Array(index ? index.count : pos.count);
    if (index) {
        for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);
    } else {
        for (let i = 0; i < pos.count; i++) indices[i] = i;
    }
    return { positions, indices };
}

/** Axis-aligned bounds of the binary STL these triangles would write. */
export function exportedStlBounds(mesh: MeasureTriangleMesh): ReturnType<typeof binaryStlBounds> {
    const geometry = bufferGeometryFromMesh(mesh);
    try {
        return binaryStlBounds(geometryToBinarySTL(geometry));
    } finally {
        geometry.dispose();
    }
}

/**
 * Live overall size of the mesh export would write.
 * The insole leader block is off unless `includeLeader` is set. Appending it
 * uses the existing STL helper and does not touch the exporter.
 */
export function overallPrintSize(
    mesh: MeasureTriangleMesh,
    product: MeasureProduct,
    includeLeader = false,
): MeasureOverall {
    if (!(includeLeader && product === "insole")) {
        return overallFromAabb(meshAabb(mesh.positions), product);
    }
    const geometry = bufferGeometryFromMesh(mesh);
    try {
        const raw = geometryToBinarySTL(geometry);
        const withLeader = applySacrificialLeaderBlock(raw);
        const bounds = binaryStlBounds(withLeader);
        const overall = overallFromAabb(
            {
                min: { x: bounds.minX, y: bounds.minY, z: bounds.minZ },
                max: { x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ },
            },
            product,
        );
        overall.includedLeader = true;
        return overall;
    } catch (error) {
        const overall = overallFromAabb(meshAabb(mesh.positions), product);
        overall.leaderError = error instanceof Error ? error.message : "Leader block unavailable";
        return overall;
    } finally {
        geometry.dispose();
    }
}

export function pointToPoint(a: MeasureVec3, b: MeasureVec3): MeasureSegment {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    return {
        distanceMm: Math.hypot(dx, dy, dz),
        dx: Math.abs(dx),
        dy: Math.abs(dy),
        dz: Math.abs(dz),
    };
}

function sub(a: MeasureVec3, b: MeasureVec3): MeasureVec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: MeasureVec3, b: MeasureVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: MeasureVec3, b: MeasureVec3): MeasureVec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function addScaled(origin: MeasureVec3, dir: MeasureVec3, t: number): MeasureVec3 {
    return { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
}

function lengthOf(v: MeasureVec3): number {
    return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: MeasureVec3): MeasureVec3 | null {
    const len = lengthOf(v);
    if (len < EPS) return null;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function vertex(mesh: MeasureTriangleMesh, index: number): MeasureVec3 {
    return {
        x: mesh.positions[index * 3] ?? 0,
        y: mesh.positions[index * 3 + 1] ?? 0,
        z: mesh.positions[index * 3 + 2] ?? 0,
    };
}

interface RayHit {
    t: number;
    point: MeasureVec3;
    normal: MeasureVec3;
    triangle: number;
    front: boolean;
}

/** Möller–Trumbore. `front` means the geometric normal faces against the ray. */
function rayTriangle(
    origin: MeasureVec3,
    dir: MeasureVec3,
    v0: MeasureVec3,
    v1: MeasureVec3,
    v2: MeasureVec3,
): { t: number; u: number; v: number; normal: MeasureVec3 } | null {
    const e1 = sub(v1, v0);
    const e2 = sub(v2, v0);
    const pvec = cross(dir, e2);
    const det = dot(e1, pvec);
    if (Math.abs(det) < EPS) return null;
    const invDet = 1 / det;
    const tvec = sub(origin, v0);
    const u = dot(tvec, pvec) * invDet;
    if (u < -1e-6 || u > 1 + 1e-6) return null;
    const qvec = cross(tvec, e1);
    const v = dot(dir, qvec) * invDet;
    if (v < -1e-6 || u + v > 1 + 1e-6) return null;
    const t = dot(e2, qvec) * invDet;
    if (t < EPS) return null;
    const normal = normalize(cross(e1, e2));
    if (!normal) return null;
    return { t, u, v, normal };
}

function forEachTriangle(
    mesh: MeasureTriangleMesh,
    visit: (triangle: number, v0: MeasureVec3, v1: MeasureVec3, v2: MeasureVec3) => void,
): void {
    const count = (mesh.indices.length / 3) | 0;
    for (let t = 0; t < count; t++) {
        const i0 = mesh.indices[t * 3] ?? 0;
        const i1 = mesh.indices[t * 3 + 1] ?? 0;
        const i2 = mesh.indices[t * 3 + 2] ?? 0;
        visit(t, vertex(mesh, i0), vertex(mesh, i1), vertex(mesh, i2));
    }
}

function closestOnTriangle(p: MeasureVec3, a: MeasureVec3, b: MeasureVec3, c: MeasureVec3): MeasureVec3 {
    const ab = sub(b, a);
    const ac = sub(c, a);
    const ap = sub(p, a);
    const d1 = dot(ab, ap);
    const d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return a;
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return addScaled(a, ab, v);
    }
    const cp = sub(p, c);
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return addScaled(a, ac, w);
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const bc = sub(c, b);
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        return addScaled(b, bc, w);
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    return {
        x: a.x + ab.x * v + ac.x * w,
        y: a.y + ab.y * v + ac.y * w,
        z: a.z + ab.z * v + ac.z * w,
    };
}

function collectHits(mesh: MeasureTriangleMesh, origin: MeasureVec3, dir: MeasureVec3): RayHit[] {
    const hits: RayHit[] = [];
    forEachTriangle(mesh, (triangle, v0, v1, v2) => {
        const hit = rayTriangle(origin, dir, v0, v1, v2);
        if (!hit) return;
        const front = dot(hit.normal, dir) < 0;
        hits.push({
            t: hit.t,
            point: addScaled(origin, dir, hit.t),
            normal: front ? hit.normal : { x: -hit.normal.x, y: -hit.normal.y, z: -hit.normal.z },
            triangle,
            front,
        });
    });
    hits.sort((a, b) => a.t - b.t);
    return hits;
}

export interface PickOptions {
    /** Snap to a mesh vertex when one lies within this radius. 0 disables. */
    snapMm?: number;
}

/**
 * Solid-triangle front-face pick. Back faces, empty meshes, and non-triangle
 * input (no indices) return null — point clouds and wire overlays are not targets.
 */
export function pickFrontFace(
    mesh: MeasureTriangleMesh,
    origin: MeasureVec3,
    direction: MeasureVec3,
    options: PickOptions = {},
): MeasureHit | null {
    const dir = normalize(direction);
    if (!dir || mesh.indices.length < 3) return null;
    const hit = collectHits(mesh, origin, dir).find((item) => item.front);
    if (!hit) return null;
    const snapMm = options.snapMm ?? 0;
    if (snapMm > 0) {
        const snapped = nearestVertex(mesh, hit.point, snapMm);
        if (snapped) {
            return { point: snapped, normal: hit.normal, triangle: hit.triangle, snapped: true };
        }
    }
    return { point: hit.point, normal: hit.normal, triangle: hit.triangle, snapped: false };
}

function nearestVertex(mesh: MeasureTriangleMesh, point: MeasureVec3, maxMm: number): MeasureVec3 | null {
    let best = Infinity;
    let found: MeasureVec3 | null = null;
    const count = (mesh.positions.length / 3) | 0;
    for (let i = 0; i < count; i++) {
        const v = vertex(mesh, i);
        const d = lengthOf(sub(v, point));
        if (d < best && d <= maxMm) {
            best = d;
            found = v;
        }
    }
    return found;
}

/**
 * Thickness along the inward normal until the opposite surface.
 * The click itself is front-face only; the probe accepts the next surface
 * the inward ray meets (the inner wall is the back of that triangle).
 */
export function probeThickness(
    mesh: MeasureTriangleMesh,
    origin: MeasureVec3,
    inward: MeasureVec3,
): number | null {
    const dir = normalize(inward);
    if (!dir) return null;
    const hits = collectHits(mesh, origin, dir);
    const next = hits.find((hit) => hit.t > 0.05);
    return next ? next.t : null;
}

/** Closest point on the triangle surface, for reproject-after-rebuild. */
export function nearestSurfacePoint(
    mesh: MeasureTriangleMesh,
    point: MeasureVec3,
): { point: MeasureVec3; distance: number; normal: MeasureVec3 } | null {
    if (mesh.indices.length < 3) return null;
    let best = Infinity;
    let found: MeasureVec3 | null = null;
    let normal: MeasureVec3 = { x: 0, y: 0, z: 1 };
    forEachTriangle(mesh, (_triangle, v0, v1, v2) => {
        const q = closestOnTriangle(point, v0, v1, v2);
        const d = lengthOf(sub(q, point));
        if (d < best) {
            best = d;
            found = q;
            normal = normalize(cross(sub(v1, v0), sub(v2, v0))) ?? normal;
        }
    });
    if (!found) return null;
    return { point: found, distance: best, normal };
}

/** Closed box with outward faces. `min` is one corner, `size` is L×W×H along XYZ. */
export function boxMesh(min: MeasureVec3, size: MeasureVec3): MeasureTriangleMesh {
    const x0 = min.x;
    const y0 = min.y;
    const z0 = min.z;
    const x1 = min.x + size.x;
    const y1 = min.y + size.y;
    const z1 = min.z + size.z;
    const positions = new Float32Array([
        x0,
        y0,
        z0,
        x1,
        y0,
        z0,
        x1,
        y1,
        z0,
        x0,
        y1,
        z0,
        x0,
        y0,
        z1,
        x1,
        y0,
        z1,
        x1,
        y1,
        z1,
        x0,
        y1,
        z1,
    ]);
    const indices = new Uint32Array([
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3,
        4, 7,
    ]);
    return { positions, indices };
}

/** Two parallel quads, `thicknessMm` apart along +Z. Outer face at z = thickness. */
export function parallelWall(thicknessMm: number, span = 20): MeasureTriangleMesh {
    const h = span / 2;
    const positions = new Float32Array([
        -h,
        -h,
        thicknessMm,
        h,
        -h,
        thicknessMm,
        h,
        h,
        thicknessMm,
        -h,
        h,
        thicknessMm,
        -h,
        -h,
        0,
        h,
        -h,
        0,
        h,
        h,
        0,
        -h,
        h,
        0,
    ]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    return { positions, indices };
}
