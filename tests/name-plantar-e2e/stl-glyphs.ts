// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Letter walls on the manufacturing STL. The leader suffix is not part of the foot.

import { createHash } from "node:crypto";
import { LEADER_SUFFIX_TRIANGLE_COUNT } from "@/lib/geometry/leader-block";
import type { Xy } from "./reading-view";

export interface StlTri {
    v: [XyZ, XyZ, XyZ];
}

interface XyZ {
    x: number;
    y: number;
    z: number;
}

export function readStlTriangles(stl: ArrayBuffer): StlTri[] {
    const buf = Buffer.from(stl);
    const n = buf.readUInt32LE(80);
    const tris: StlTri[] = [];
    for (let i = 0; i < n; i++) {
        const o = 84 + i * 50;
        const v = [0, 1, 2].map((k) => {
            const p = o + 12 + k * 12;
            return { x: buf.readFloatLE(p), y: buf.readFloatLE(p + 4), z: buf.readFloatLE(p + 8) };
        }) as [XyZ, XyZ, XyZ];
        tris.push({ v });
    }
    return tris;
}

export function footTriangles(tris: readonly StlTri[]): StlTri[] {
    if (tris.length <= LEADER_SUFFIX_TRIANGLE_COUNT) return [...tris];
    return tris.slice(0, tris.length - LEADER_SUFFIX_TRIANGLE_COUNT);
}

function quantKey(p: Xy, step: number): string {
    return `${Math.round(p.x / step)}|${Math.round(p.y / step)}`;
}

function quantize(points: readonly Xy[], step: number): Xy[] {
    const seen = new Set<string>();
    const out: Xy[] = [];
    for (const p of points) {
        const key = quantKey(p, step);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step });
    }
    return out;
}

/** Connected components. linkMm is the neighbor distance. */
export function clusterPoints(points: readonly Xy[], linkMm: number): Xy[][] {
    const cell = linkMm;
    const buckets = new Map<string, number[]>();
    const key = (x: number, y: number) => `${Math.floor(x / cell)}|${Math.floor(y / cell)}`;
    points.forEach((p, i) => {
        const k = key(p.x, p.y);
        const arr = buckets.get(k);
        if (arr) arr.push(i);
        else buckets.set(k, [i]);
    });
    const parent = points.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
    };
    for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        const cx = Math.floor(p.x / cell);
        const cy = Math.floor(p.y / cell);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const arr = buckets.get(`${cx + dx}|${cy + dy}`);
                if (!arr) continue;
                for (const j of arr) {
                    if (j <= i) continue;
                    const q = points[j]!;
                    if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= linkMm * linkMm) union(i, j);
                }
            }
        }
    }
    const groups = new Map<number, Xy[]>();
    for (let i = 0; i < points.length; i++) {
        const r = find(i);
        const arr = groups.get(r);
        if (arr) arr.push(points[i]!);
        else groups.set(r, [points[i]!]);
    }
    return [...groups.values()];
}

function span(points: readonly Xy[]): { x: number; y: number } {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of points) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
    }
    return { x: x1 - x0, y: y1 - y0 };
}

/**
 * Engrave walls and the 0.6 mm floor, clustered into letter-sized blobs.
 * The outer wall of the foot is larger than a letter and is dropped.
 */
export function extractEngraveBlobs(tris: readonly StlTri[]): Xy[][] {
    const foot = footTriangles(tris);
    const raw: Xy[] = [];
    for (const tri of foot) {
        let z0 = Infinity;
        let z1 = -Infinity;
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const p of tri.v) {
            if (p.z < z0) z0 = p.z;
            if (p.z > z1) z1 = p.z;
            if (p.x < x0) x0 = p.x;
            if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y;
            if (p.y > y1) y1 = p.y;
        }
        if (x1 - x0 > 4 || y1 - y0 > 4) continue;
        const wall = z0 < 0.3 && z1 > 0.4 && z1 - z0 > 0.15;
        const floor = z0 > 0.5 && z1 < 0.75;
        if (!wall && !floor) continue;
        for (const p of tri.v) {
            if (p.z > 0.12 && p.z < 0.72) raw.push({ x: p.x, y: p.y });
        }
    }
    const points = quantize(raw, 0.35);
    const blobs = clusterPoints(points, 1.4);
    return blobs.filter((blob) => {
        const s = span(blob);
        return s.y > 6 && s.y < 18 && s.x > 1.5 && s.x < 20 && blob.length > 12;
    });
}

export function blobBox(blobs: readonly (readonly Xy[])[]): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const blob of blobs) {
        for (const p of blob) {
            if (p.x < x0) x0 = p.x;
            if (p.y < y0) y0 = p.y;
            if (p.x > x1) x1 = p.x;
            if (p.y > y1) y1 = p.y;
        }
    }
    if (!Number.isFinite(x0)) return null;
    return { x0, y0, x1, y1 };
}

export interface SoleFacts {
    minZ: number;
    nearZeroFraction: number;
    floorMedianZ: number;
    placementU: number | null;
}

export function soleFacts(tris: readonly StlTri[], glyphs: readonly (readonly Xy[])[]): SoleFacts {
    const foot = footTriangles(tris);
    let minZ = Infinity;
    let near = 0;
    let verts = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    const floors: number[] = [];
    for (const tri of foot) {
        for (const p of tri.v) {
            verts += 1;
            if (p.z < minZ) minZ = p.z;
            if (p.z < 0.2) near += 1;
            if (p.x < x0) x0 = p.x;
            if (p.x > x1) x1 = p.x;
            if (p.z > 0.5 && p.z < 0.75) floors.push(p.z);
        }
    }
    floors.sort((a, b) => a - b);
    const floorMedianZ = floors.length ? floors[Math.floor(floors.length / 2)]! : Number.NaN;
    const box = blobBox(glyphs);
    let placementU: number | null = null;
    if (box && x1 > x0) {
        placementU = ((box.x0 + box.x1) / 2 - x0) / (x1 - x0);
    }
    return {
        minZ,
        nearZeroFraction: verts ? near / verts : 0,
        floorMedianZ,
        placementU,
    };
}

function quantTriangle(tri: StlTri): string {
    const nums: number[] = [];
    for (const p of tri.v) {
        nums.push(Math.round(p.x * 100), Math.round(p.y * 100), Math.round(p.z * 100));
    }
    nums.sort((a, b) => a - b);
    return nums.join(",");
}

/** Stable hash of triangles outside the engraved letter volume. */
export function nonTextHash(tris: readonly StlTri[], glyphs: readonly (readonly Xy[])[]): string {
    const box = blobBox(glyphs);
    const hash = createHash("sha256");
    for (const tri of tris) {
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (const p of tri.v) {
            cx += p.x;
            cy += p.y;
            cz += p.z;
        }
        cx /= 3;
        cy /= 3;
        cz /= 3;
        const inText =
            box !== null &&
            cx >= box.x0 - 3 &&
            cx <= box.x1 + 3 &&
            cy >= box.y0 - 3 &&
            cy <= box.y1 + 3 &&
            cz <= 1.2;
        if (inText) continue;
        hash.update(quantTriangle(tri));
        hash.update("\n");
    }
    return hash.digest("hex");
}

export function triangleHash(tris: readonly StlTri[]): string {
    const hash = createHash("sha256");
    for (const tri of tris) {
        hash.update(quantTriangle(tri));
        hash.update("\n");
    }
    return hash.digest("hex");
}
