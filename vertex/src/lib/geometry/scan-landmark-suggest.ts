// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Heuristic suggested landmarks on a cleaned, oriented scan (Phase 3D).
 *
 * Algorithm mirrors deriveBaseLandmarks (marker-frame.ts) but does NOT import
 * or modify that module. Failures return null — never throw, never block manual.
 */

import type { BufferGeometry } from "three";
import * as THREE from "three";
import type { Side } from "@/types";

const FOREFOOT_U_MIN = 0.55;
const FOREFOOT_U_MAX = 0.95;
const HEEL_U_MAX = 1 / 3;
const HEEL_PLANTAR_Z_FRAC = 0.15;
const CREST_BAND_MM = 0.5;
const CREST_BAND_WIDE_MM = 1.0;
const CREST_BAND_MIN_COUNT = 15;

export type SuggestedScanLandmarks = {
    M1: THREE.Vector3;
    M2: THREE.Vector3;
    M3: THREE.Vector3;
    footLengthMm: number;
    /** Signed (u_M1 − u_M2) × 100; positive when M2 proximal to M1. */
    m1m2SeparationPct: number;
    medialWidthSign: number;
};

function collectPositions(geometry: BufferGeometry): Float32Array | null {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count === 0) return null;
    return pos.array as Float32Array;
}

function bounds(arr: Float32Array): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    lengthMm: number;
    n: number;
} {
    const n = Math.floor(arr.length / 3);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = arr[i * 3]!;
        const y = arr[i * 3 + 1]!;
        const z = arr[i * 3 + 2]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    return { minX, maxX, minY, maxY, minZ, maxZ, lengthMm: maxX - minX || 1, n };
}

/**
 * Medial width-axis sign from assigned clinical side.
 * Convention matches marker-frame / viewer: left arch on +Y → medialWidthSign = +1;
 * right foot mirrors → medialWidthSign = −1.
 */
export function medialWidthSignForSide(side: Side): number {
    return side === "left" ? 1 : -1;
}

function crestCentroid(
    arr: Float32Array,
    n: number,
    minX: number,
    lengthMm: number,
    scoreOf: (y: number) => number,
    bandMm: number,
): { centroid: THREE.Vector3; count: number } | null {
    let maxScore = -Infinity;
    for (let i = 0; i < n; i++) {
        const u = (arr[i * 3]! - minX) / lengthMm;
        if (u < FOREFOOT_U_MIN || u > FOREFOOT_U_MAX) continue;
        const s = scoreOf(arr[i * 3 + 1]!);
        if (s > maxScore) maxScore = s;
    }
    if (!Number.isFinite(maxScore)) return null;

    const collect = (band: number) => {
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let c = 0;
        for (let i = 0; i < n; i++) {
            const u = (arr[i * 3]! - minX) / lengthMm;
            if (u < FOREFOOT_U_MIN || u > FOREFOOT_U_MAX) continue;
            const y = arr[i * 3 + 1]!;
            if (scoreOf(y) < maxScore - band) continue;
            sx += arr[i * 3]!;
            sy += y;
            sz += arr[i * 3 + 2]!;
            c++;
        }
        return { sx, sy, sz, c };
    };

    let hit = collect(bandMm);
    if (hit.c < CREST_BAND_MIN_COUNT) hit = collect(CREST_BAND_WIDE_MM);
    if (hit.c === 0) return null;
    return {
        centroid: new THREE.Vector3(hit.sx / hit.c, hit.sy / hit.c, hit.sz / hit.c),
        count: hit.c,
    };
}

/**
 * Suggest M1/M2/M3 on cleaned scan-local geometry.
 * Geometry is assumed already in a length-along-X display-ish frame OR raw
 * selected-component local coords with a clear longest axis along X after
 * provisional framing — callers should pass geometry whose bbox longest axis
 * is X (apply provisional orientation to a clone if needed), OR pass raw kept
 * geometry that is already roughly foot-aligned.
 *
 * For Phase D we operate in scan-local coords of the kept mesh. The algorithm
 * uses the AABB X extent as length (same as deriveBaseLandmarks after reorient).
 * If the kept mesh is still Y-dominant in local space, we temporarily remap
 * coordinates so length runs along +X for the suggestion math, then map back.
 */
export function suggestScanLandmarks(geometry: BufferGeometry, side: Side): SuggestedScanLandmarks | null {
    try {
        const arr0 = collectPositions(geometry);
        if (!arr0) return null;
        const b0 = bounds(arr0);
        if (b0.n < 30) return null;

        // Remap so longest bbox axis → X for the same windows as deriveBaseLandmarks.
        const sizeX = b0.maxX - b0.minX;
        const sizeY = b0.maxY - b0.minY;
        const sizeZ = b0.maxZ - b0.minZ;
        let remap: (x: number, y: number, z: number) => [number, number, number];
        let unmap: (x: number, y: number, z: number) => [number, number, number];
        if (sizeX >= sizeY && sizeX >= sizeZ) {
            remap = (x, y, z) => [x, y, z];
            unmap = (x, y, z) => [x, y, z];
        } else if (sizeY >= sizeX && sizeY >= sizeZ) {
            // Y → X, X → −Y (matches provisional orientLongestToX for Y-dominant)
            remap = (x, y, z) => [y, -x, z];
            unmap = (x, y, z) => [-y, x, z];
        } else {
            // Z → X, X → −Z
            remap = (x, y, z) => [z, y, -x];
            unmap = (x, y, z) => [-z, y, x];
        }

        const arr = new Float32Array(arr0.length);
        for (let i = 0; i < b0.n; i++) {
            const [x, y, z] = remap(arr0[i * 3]!, arr0[i * 3 + 1]!, arr0[i * 3 + 2]!);
            arr[i * 3] = x;
            arr[i * 3 + 1] = y;
            arr[i * 3 + 2] = z;
        }
        const { minX, lengthMm, n } = bounds(arr);
        const medialWidthSign = medialWidthSignForSide(side);

        // M3 — heel-third plantar centroid
        let heelMinZ = Infinity;
        let heelMaxZ = -Infinity;
        for (let i = 0; i < n; i++) {
            const u = (arr[i * 3]! - minX) / lengthMm;
            if (u > HEEL_U_MAX) continue;
            const z = arr[i * 3 + 2]!;
            if (z < heelMinZ) heelMinZ = z;
            if (z > heelMaxZ) heelMaxZ = z;
        }
        if (!Number.isFinite(heelMinZ)) return null;
        const heelZCut = heelMinZ + HEEL_PLANTAR_Z_FRAC * (heelMaxZ - heelMinZ || 1);
        let hSx = 0;
        let hSy = 0;
        let hSz = 0;
        let hN = 0;
        for (let i = 0; i < n; i++) {
            const u = (arr[i * 3]! - minX) / lengthMm;
            if (u > HEEL_U_MAX) continue;
            const z = arr[i * 3 + 2]!;
            if (z > heelZCut) continue;
            hSx += arr[i * 3]!;
            hSy += arr[i * 3 + 1]!;
            hSz += z;
            hN++;
        }
        if (hN === 0) return null;
        const M3r = new THREE.Vector3(hSx / hN, hSy / hN, hSz / hN);

        const medial = crestCentroid(arr, n, minX, lengthMm, (y) => y * medialWidthSign, CREST_BAND_MM);
        const lateral = crestCentroid(arr, n, minX, lengthMm, (y) => -y * medialWidthSign, CREST_BAND_MM);
        if (!medial || !lateral) return null;

        const M1r = medial.centroid;
        const M2r = lateral.centroid;

        const d12 = M1r.distanceTo(M2r);
        const d13 = M1r.distanceTo(M3r);
        const d23 = M2r.distanceTo(M3r);
        if (d12 < 1e-3 || d13 < 1e-3 || d23 < 1e-3) return null;
        const area2 = new THREE.Vector3()
            .subVectors(M2r, M3r)
            .cross(new THREE.Vector3().subVectors(M1r, M3r));
        if (area2.length() < 1e-3) return null;

        const uM1 = (M1r.x - minX) / lengthMm;
        const uM2 = (M2r.x - minX) / lengthMm;
        const m1m2SeparationPct = (uM1 - uM2) * 100;

        const toLocal = (p: THREE.Vector3) => {
            const [x, y, z] = unmap(p.x, p.y, p.z);
            return new THREE.Vector3(x, y, z);
        };

        return {
            M1: toLocal(M1r),
            M2: toLocal(M2r),
            M3: toLocal(M3r),
            footLengthMm: lengthMm,
            m1m2SeparationPct,
            medialWidthSign,
        };
    } catch {
        return null;
    }
}
