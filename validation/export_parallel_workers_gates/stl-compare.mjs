// Frozen before grading candidate f059edf74b9bed33071a4deb8ad3c9674d289dfd.
// Dependency-free binary STL compare. Weld matches manifold.ts QUANT = 1e4.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MANIFOLD_QUANT, SOLE_BAND_MM, TOP_BAND_MM } from "./thresholds.mjs";

export function sha256(buffer) {
    return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

export function parseBinaryStl(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (buf.length < 84) {
        throw new Error(`STL shorter than header (${buf.length})`);
    }
    const count = buf.readUInt32LE(80);
    const expected = 84 + count * 50;
    if (buf.length < expected) {
        throw new Error(`STL truncated: ${buf.length} < ${expected}`);
    }
    const triangles = new Array(count);
    let offset = 84;
    for (let i = 0; i < count; i++) {
        offset += 12;
        const verts = new Array(3);
        for (let v = 0; v < 3; v++) {
            verts[v] = [buf.readFloatLE(offset), buf.readFloatLE(offset + 4), buf.readFloatLE(offset + 8)];
            offset += 12;
        }
        offset += 2;
        triangles[i] = verts;
    }
    return triangles;
}

function quantKey(x, y, z) {
    return `${Math.round(x * MANIFOLD_QUANT)},${Math.round(y * MANIFOLD_QUANT)},${Math.round(z * MANIFOLD_QUANT)}`;
}

function edgeKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function manifoldOf(triangles) {
    const edgeCount = new Map();
    const verts = new Set();
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const tri of triangles) {
        const keys = tri.map(([x, y, z]) => {
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
            const key = quantKey(x, y, z);
            verts.add(key);
            return key;
        });
        for (let i = 0; i < 3; i++) {
            const ek = edgeKey(keys[i], keys[(i + 1) % 3]);
            edgeCount.set(ek, (edgeCount.get(ek) ?? 0) + 1);
        }
    }
    let openEdges = 0;
    let nonManifoldEdges = 0;
    for (const count of edgeCount.values()) {
        if (count === 1) openEdges += 1;
        else if (count > 2) nonManifoldEdges += 1;
    }
    const v = verts.size;
    const e = edgeCount.size;
    const f = triangles.length;
    return {
        triangleCount: f,
        vertexCount: v,
        openEdges,
        nonManifoldEdges,
        isWatertight: openEdges === 0 && nonManifoldEdges === 0 && f > 0,
        eulerCharacteristic: v - e + f,
        minZ: Number.isFinite(minZ) ? minZ : null,
        maxZ: Number.isFinite(maxZ) ? maxZ : null,
    };
}

export function writeBinaryStl(triangles) {
    const count = triangles.length;
    const buf = Buffer.alloc(84 + count * 50);
    buf.writeUInt32LE(count, 80);
    let offset = 84;
    for (const tri of triangles) {
        offset += 12;
        for (const [x, y, z] of tri) {
            buf.writeFloatLE(x, offset);
            buf.writeFloatLE(y, offset + 4);
            buf.writeFloatLE(z, offset + 8);
            offset += 12;
        }
        offset += 2;
    }
    return buf;
}

export function compareStlBuffers(a, b) {
    const left = parseBinaryStl(a);
    const right = parseBinaryStl(b);
    const manA = manifoldOf(left);
    const manB = manifoldOf(right);
    const bytesEqual = Buffer.from(a).equals(Buffer.from(b));
    const base = {
        bytesEqual,
        trianglesA: left.length,
        trianglesB: right.length,
        trianglesEqual: left.length === right.length,
        shaA: sha256(a),
        shaB: sha256(b),
        manA,
        manB,
    };
    if (left.length !== right.length) {
        return {
            ...base,
            maxDeltaMm: Number.POSITIVE_INFINITY,
            topBandDeltaMm: Number.POSITIVE_INFINITY,
            soleBandDeltaMm: Number.POSITIVE_INFINITY,
            topBandVerts: 0,
            soleBandVerts: 0,
        };
    }
    let max = 0;
    let top = 0;
    let sole = 0;
    let topN = 0;
    let soleN = 0;
    const maxZ = manA.maxZ ?? 0;
    const minZ = manA.minZ ?? 0;
    for (let i = 0; i < left.length; i++) {
        for (let v = 0; v < 3; v++) {
            const [x, y, z] = left[i][v];
            const [x2, y2, z2] = right[i][v];
            const dist = Math.hypot(x - x2, y - y2, z - z2);
            if (dist > max) max = dist;
            if (z >= maxZ - TOP_BAND_MM) {
                top = Math.max(top, dist);
                topN += 1;
            }
            if (z <= minZ + SOLE_BAND_MM) {
                sole = Math.max(sole, dist);
                soleN += 1;
            }
        }
    }
    return {
        ...base,
        maxDeltaMm: max,
        topBandDeltaMm: topN > 0 ? top : 0,
        soleBandDeltaMm: soleN > 0 ? sole : 0,
        topBandVerts: topN,
        soleBandVerts: soleN,
    };
}

export function compareStlFiles(pathA, pathB) {
    return compareStlBuffers(readFileSync(pathA), readFileSync(pathB));
}

/** Closed tetrahedron. Euler 2, every edge shared by two triangles. */
export function tetrahedronTriangles() {
    const s = Math.sqrt(3) / 2;
    const h = Math.sqrt(6) / 3;
    const v = [
        [0, 0, 0],
        [1, 0, 0],
        [0.5, s, 0],
        [0.5, s / 3, h],
    ];
    return [
        [v[0], v[1], v[2]],
        [v[0], v[2], v[3]],
        [v[0], v[3], v[1]],
        [v[1], v[3], v[2]],
    ];
}
