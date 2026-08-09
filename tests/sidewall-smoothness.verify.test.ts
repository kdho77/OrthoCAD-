// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Print-quality sidewall gate (Default.glb left slot).
//
// The bottom-shell wall must stay smooth under every correction that deforms
// it through the legacy rim path (heel-cup width ± / arch raise / apex move):
// no wall edge may fold, and local crumpling (umbrella residual growth) stays
// bounded. Guards the weld+diffuse wall smoothing in applyBaseModifiers
// against regressions from future transfer/seed changes.

import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers, PLANTAR_Z_MAX_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import type { SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";

/** No wall edge may worsen its fold (|Δ dihedral|) beyond this (deg). */
const MAX_DIHEDRAL_WORSENING_DEG = 20;
/** Threshold defining a "fold" for the zero-count gate (deg). */
const FOLD_WORSENING_DEG = 20;
/** 95th-percentile umbrella-residual growth budget (mm). */
const MAX_P95_UMBRELLA_GROWTH_MM = 0.25;

function neutralCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function makeField(c: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections: { ...neutralCorrections(), ...c },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

interface WallQuality {
    p95UmbrellaGrowthMm: number;
    maxUmbrellaGrowthMm: number;
    maxDihedralWorseningDeg: number;
    foldWorseCount: number;
    wallVertCount: number;
}

/** Umbrella residual: distance from vertex to centroid of its 1-ring. */
function umbrellaResiduals(
    pos: Float32Array,
    adjacency: Map<number, Set<number>>,
    verts: number[],
): Map<number, number> {
    const out = new Map<number, number>();
    for (const i of verts) {
        const nb = adjacency.get(i);
        if (!nb || nb.size < 3) continue;
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (const j of nb) {
            cx += pos[j * 3]!;
            cy += pos[j * 3 + 1]!;
            cz += pos[j * 3 + 2]!;
        }
        const n = nb.size;
        cx /= n;
        cy /= n;
        cz /= n;
        out.set(i, Math.hypot(pos[i * 3]! - cx, pos[i * 3 + 1]! - cy, pos[i * 3 + 2]! - cz));
    }
    return out;
}

function faceNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] {
    const ax = pos[a * 3]!;
    const ay = pos[a * 3 + 1]!;
    const az = pos[a * 3 + 2]!;
    const ux = pos[b * 3]! - ax;
    const uy = pos[b * 3 + 1]! - ay;
    const uz = pos[b * 3 + 2]! - az;
    const vx = pos[c * 3]! - ax;
    const vy = pos[c * 3 + 1]! - ay;
    const vz = pos[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
}

function measureWallQuality(base: BufferGeometry, modified: BufferGeometry, thickAxis: number): WallQuality {
    const basePos = base.getAttribute("position")!.array as Float32Array;
    const modPos = modified.getAttribute("position")!.array as Float32Array;
    const topN = (base.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const index = base.index!.array as Uint32Array | Uint16Array;

    const wallVerts: number[] = [];
    const isWall = new Uint8Array(basePos.length / 3);
    for (let i = topN; i < basePos.length / 3; i++) {
        if (basePos[i * 3 + thickAxis]! > PLANTAR_Z_MAX_MM) {
            wallVerts.push(i);
            isWall[i] = 1;
        }
    }

    const adjacency = new Map<number, Set<number>>();
    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < index.length; f += 3) {
        const a = index[f]!;
        const b = index[f + 1]!;
        const c = index[f + 2]!;
        if (a < topN || b < topN || c < topN) continue;
        if (!isWall[a] && !isWall[b] && !isWall[c]) continue;
        for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            let s = adjacency.get(p);
            if (!s) {
                s = new Set();
                adjacency.set(p, s);
            }
            s.add(q);
            let s2 = adjacency.get(q);
            if (!s2) {
                s2 = new Set();
                adjacency.set(q, s2);
            }
            s2.add(p);
            const k = p < q ? `${p},${q}` : `${q},${p}`;
            let faces = edgeFaces.get(k);
            if (!faces) {
                faces = [];
                edgeFaces.set(k, faces);
            }
            faces.push(f);
        }
    }

    const baseRes = umbrellaResiduals(basePos, adjacency, wallVerts);
    const modRes = umbrellaResiduals(modPos, adjacency, wallVerts);
    const growths: number[] = [];
    for (const [i, r0] of baseRes) {
        const r1 = modRes.get(i);
        if (r1 === undefined) continue;
        growths.push(r1 - r0);
    }
    growths.sort((x, y) => x - y);
    const p95 = growths.length ? growths[Math.floor(growths.length * 0.95)]! : 0;
    const maxG = growths.length ? growths[growths.length - 1]! : 0;

    let maxWorse = 0;
    let foldWorseCount = 0;
    for (const faces of edgeFaces.values()) {
        if (faces.length !== 2) continue;
        const [f1, f2] = faces as [number, number];
        const bn1 = faceNormal(basePos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
        const bn2 = faceNormal(basePos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
        const mn1 = faceNormal(modPos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
        const mn2 = faceNormal(modPos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
        const baseAngle =
            (Math.acos(Math.max(-1, Math.min(1, bn1[0] * bn2[0] + bn1[1] * bn2[1] + bn1[2] * bn2[2]))) *
                180) /
            Math.PI;
        const modAngle =
            (Math.acos(Math.max(-1, Math.min(1, mn1[0] * mn2[0] + mn1[1] * mn2[1] + mn1[2] * mn2[2]))) *
                180) /
            Math.PI;
        const worse = modAngle - baseAngle;
        if (worse > maxWorse) maxWorse = worse;
        if (worse > FOLD_WORSENING_DEG) foldWorseCount++;
    }

    return {
        p95UmbrellaGrowthMm: p95,
        maxUmbrellaGrowthMm: maxG,
        maxDihedralWorseningDeg: maxWorse,
        foldWorseCount,
        wallVertCount: wallVerts.length,
    };
}

describe("sidewall smoothness — Default.glb print-quality gate", () => {
    const scenarios: [string, Partial<SideCorrections>][] = [
        ["narrow −3.3 (scan-match)", { heelCupWidthMm: -3.3 }],
        ["narrow −10 (max)", { heelCupWidthMm: -10 }],
        ["arch 12", { archHeightMm: 12 }],
        ["arch 8 + narrow −3.3", { archHeightMm: 8, heelCupWidthMm: -3.3 }],
        ["arch 12 + narrow −10 + apex +8", { archHeightMm: 12, heelCupWidthMm: -10, apexMoveMm: 8 }],
        ["widen +10", { heelCupWidthMm: 10 }],
    ];

    test("no wall folds, bounded crumpling across correction matrix", async () => {
        const base = await loadProductionDefaultGlb({ slot: "left" });
        base.computeBoundingBox();
        const box = base.boundingBox!;
        const sizes: [number, number][] = [
            [0, box.max.x - box.min.x],
            [1, box.max.y - box.min.y],
            [2, box.max.z - box.min.z],
        ];
        sizes.sort((a, b) => a[1] - b[1]);
        const thickAxis = sizes[0]![0]!;

        for (const [name, c] of scenarios) {
            const modified = applyBaseModifiers(base, makeField(c), 1);
            const q = measureWallQuality(base, modified, thickAxis);
            console.log(`[SIDEWALL] ${name}`, JSON.stringify(q));
            expect(q.wallVertCount).toBeGreaterThan(1000);
            expect(q.foldWorseCount).toBe(0);
            expect(q.maxDihedralWorseningDeg).toBeLessThan(MAX_DIHEDRAL_WORSENING_DEG);
            expect(q.p95UmbrellaGrowthMm).toBeLessThan(MAX_P95_UMBRELLA_GROWTH_MM);
            modified.dispose();
        }
        base.dispose();
    });
});
