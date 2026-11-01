// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { appendFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { ProceduralWallStyle } from "@/lib/geometry/procedural-wall/modifiers";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

// Stock hybrid crease edges begin at x ≈ 71.7, just before the 72 mm mark.
const HYBRID_X0 = 70;
const HYBRID_X1 = 78;
const FOLD_MAX_DEG = 60;

function corrections(patch: Partial<SideCorrections>): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        forefootWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
        ...patch,
    };
}

function faceNormal(pos: Float32Array, idx: ArrayLike<number>, f: number): [number, number, number] {
    const a = idx[f * 3]!;
    const b = idx[f * 3 + 1]!;
    const c = idx[f * 3 + 2]!;
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
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return [0, 0, 1];
    return [nx / len, ny / len, nz / len];
}

function angleDeg(a: [number, number, number], b: [number, number, number]): number {
    const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    return (Math.acos(d) * 180) / Math.PI;
}

function solidReport(geo: BufferGeometry, style: ProceduralWallStyle) {
    const pos = geo.getAttribute("position").array as Float32Array;
    const idx = geo.getIndex()!.array as ArrayLike<number>;
    const n = pos.length / 3;
    const q = 1e-4;
    const weldId = new Map<string, number>();
    const groupOf = new Int32Array(n);
    let groups = 0;
    let minZ = Infinity;
    let bottomOff = 0;
    let bottomN = 0;
    for (let i = 0; i < n; i++) {
        const z = pos[i * 3 + 2]!;
        if (z < minZ) minZ = z;
        if (z <= 1e-3) {
            bottomN++;
            if (Math.abs(z) > 1e-4) bottomOff++;
        }
        const key = [Math.round(pos[i * 3]! / q), Math.round(pos[i * 3 + 1]! / q), Math.round(z / q)].join(
            ",",
        );
        let g = weldId.get(key);
        if (g === undefined) {
            g = groups++;
            weldId.set(key, g);
        }
        groupOf[i] = g;
    }
    const faceCount = idx.length / 3;
    const normals: Array<[number, number, number]> = new Array(faceCount);
    let zeroArea = 0;
    for (let f = 0; f < faceCount; f++) {
        const a = idx[f * 3]!;
        const b = idx[f * 3 + 1]!;
        const c = idx[f * 3 + 2]!;
        const ax = pos[a * 3]!;
        const ay = pos[a * 3 + 1]!;
        const az = pos[a * 3 + 2]!;
        const ux = pos[b * 3]! - ax;
        const uy = pos[b * 3 + 1]! - ay;
        const uz = pos[b * 3 + 2]! - az;
        const vx = pos[c * 3]! - ax;
        const vy = pos[c * 3 + 1]! - ay;
        const vz = pos[c * 3 + 2]! - az;
        const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        if (area < 1e-8) zeroArea++;
        normals[f] = faceNormal(pos, idx, f);
    }
    const edgeDir = new Map<string, number>();
    const edgeFace = new Map<string, number>();
    let flipped = 0;
    let maxFold = 0;
    let worstX = 0;
    let worstY = 0;
    let worstZ = 0;
    let worstTop = false;
    const topN = (geo.userData.topVertexCount as number) || n;
    for (let f = 0; f < faceCount; f++) {
        for (let e = 0; e < 3; e++) {
            const v0 = idx[f * 3 + e]!;
            const v1 = idx[f * 3 + ((e + 1) % 3)]!;
            const g0 = groupOf[v0]!;
            const g1 = groupOf[v1]!;
            if (g0 === g1) continue;
            const key = g0 < g1 ? `${g0},${g1}` : `${g1},${g0}`;
            const sign = g0 < g1 ? 1 : -1;
            const prev = edgeDir.get(key);
            if (prev === undefined) {
                edgeDir.set(key, sign);
                edgeFace.set(key, f);
                continue;
            }
            if (prev === sign) flipped++;
            const x = 0.5 * (pos[v0 * 3]! + pos[v1 * 3]!);
            if (style === "hybrid" && x >= HYBRID_X0 && x <= HYBRID_X1) continue;
            const other = edgeFace.get(key);
            if (other === undefined) continue;
            const fold = angleDeg(normals[f] ?? [0, 0, 1], normals[other] ?? [0, 0, 1]);
            if (fold > maxFold) {
                maxFold = fold;
                worstX = x;
                worstY = 0.5 * ((pos[v0 * 3 + 1] ?? 0) + (pos[v1 * 3 + 1] ?? 0));
                worstZ = 0.5 * ((pos[v0 * 3 + 2] ?? 0) + (pos[v1 * 3 + 2] ?? 0));
                worstTop = v0 < topN && v1 < topN;
            }
        }
    }
    return { maxFold, zeroArea, flipped, minZ, bottomOff, bottomN, worstX, worstY, worstZ, worstTop };
}

function apexInBand(pos: ArrayLike<number>): { x: number; z: number } {
    let x = 0;
    let z = -Infinity;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
        const xi = pos[i * 3]!;
        const zi = pos[i * 3 + 2]!;
        if (xi < 85 || xi > 145) continue;
        if (zi > z) {
            x = xi;
            z = zi;
        }
    }
    return { x, z };
}

/** Medial top-sheet rim nearest u = 0.40, and the wall vertex meeting that point. */
function medialColumn(geo: BufferGeometry, side: Side): { rimIndex: number; rimZ: number; wallTopZ: number } {
    const pos = geo.getAttribute("position").array as Float32Array;
    const topN = geo.userData.topVertexCount as number;
    const sign = side === "left" ? -1 : 1;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < topN; i++) {
        const x = pos[i * 3] ?? 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
    }
    const span = Math.max(1e-6, maxX - minX);
    let rim = 0;
    let best = Infinity;
    for (let i = 0; i < topN; i++) {
        const x = pos[i * 3] ?? 0;
        const y = pos[i * 3 + 1] ?? 0;
        const u = (x - minX) / span;
        if (u < 0.36 || u > 0.44) continue;
        const medial = y * sign;
        const score = Math.abs(u - 0.4) * 100 - medial;
        if (score < best) {
            best = score;
            rim = i;
        }
    }
    const rx = pos[rim * 3] ?? 0;
    const ry = pos[rim * 3 + 1] ?? 0;
    const rimZ = pos[rim * 3 + 2] ?? 0;
    let wallTopZ = Number.NEGATIVE_INFINITY;
    const n = pos.length / 3;
    for (let i = topN; i < n; i++) {
        const dx = (pos[i * 3] ?? 0) - rx;
        const dy = (pos[i * 3 + 1] ?? 0) - ry;
        if (dx * dx + dy * dy > 2.25) continue;
        const z = pos[i * 3 + 2] ?? 0;
        if (z > wallTopZ) wallTopZ = z;
    }
    if (!Number.isFinite(wallTopZ)) wallTopZ = rimZ;
    return { rimIndex: rim, rimZ, wallTopZ };
}

describe("Standard flexible solid gates", () => {
    test("wall fold, outline, and medial column across styles, bands, and both feet", async () => {
        const right = await loadSampleTopGlb();
        const left = mirrorGeometry(right);
        const styles: ProceduralWallStyle[] = ["straight", "round", "hybrid"];
        const bands = [
            { name: "standard", archHeightMm: 0 },
            { name: "low", archHeightMm: -3.5 },
            { name: "high", archHeightMm: 3 },
        ] as const;
        const parked = new Map<string, { x: number; z: number; rimZ: number; wallTopZ: number }>();
        const rows: unknown[] = [];
        const problems: string[] = [];
        try {
            for (const style of styles) {
                for (const band of bands) {
                    for (const flex of [false, true]) {
                        for (const side of ["left", "right"] as const) {
                            const built = await reconstructProceduralPreview(side === "left" ? left : right, {
                                corrections: corrections({
                                    archHeightMm: band.archHeightMm,
                                    apexMoveMm: flex ? 4 : 0,
                                }),
                                thicknessMm: BASE_REFERENCE_THICKNESS_MM,
                                stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
                                wallStyle: style,
                                side,
                            });
                            const label = `${style} ${band.name} flex=${flex} ${side}`;
                            const report = solidReport(built.geometry, style);
                            const apex = apexInBand(built.geometry.getAttribute("position").array);
                            const column = medialColumn(built.geometry, side);
                            const key = `${style}|${band.name}|${side}`;
                            if (!flex) parked.set(key, { ...apex, ...column });
                            const base = parked.get(key);
                            let peakDx = 0;
                            let peakDz = 0;
                            let wallExcess = 0;
                            if (flex && base) {
                                peakDx = apex.x - base.x;
                                peakDz = apex.z - base.z;
                                const wallDz = column.wallTopZ - base.wallTopZ;
                                const surfaceDz = column.rimZ - base.rimZ;
                                wallExcess = Math.abs(wallDz - surfaceDz);
                                if (band.name === "standard") {
                                    if (!(peakDx > 3.8 && peakDx < 4.2 && Math.abs(peakDz) < 0.05)) {
                                        problems.push(`${label} peak dx ${peakDx} dz ${peakDz}`);
                                    }
                                } else if (Math.abs(peakDx) >= 0.2) {
                                    problems.push(`${label} second slide ${peakDx}`);
                                }
                                if (wallExcess > 0.1) problems.push(`${label} wall excess ${wallExcess}`);
                            }
                            if (report.maxFold > FOLD_MAX_DEG) {
                                problems.push(
                                    `${label} fold ${report.maxFold.toFixed(2)} at x=${report.worstX.toFixed(2)} y=${report.worstY.toFixed(2)} z=${report.worstZ.toFixed(2)} top=${report.worstTop}`,
                                );
                            }
                            if (report.zeroArea !== 0) problems.push(`${label} zero area ${report.zeroArea}`);
                            if (report.flipped !== 0) problems.push(`${label} flipped ${report.flipped}`);
                            if (report.minZ < -1e-6) problems.push(`${label} minZ ${report.minZ}`);
                            if (report.bottomOff !== 0)
                                problems.push(`${label} bottom off ${report.bottomOff}`);
                            if (report.bottomN <= 10)
                                problems.push(`${label} bottom count ${report.bottomN}`);
                            rows.push({
                                label,
                                maxFold: Number(report.maxFold.toFixed(3)),
                                zeroArea: report.zeroArea,
                                flipped: report.flipped,
                                minZ: report.minZ,
                                peakDx: Number(peakDx.toFixed(4)),
                                peakDz: Number(peakDz.toFixed(4)),
                                wallExcessMm: Number(wallExcess.toFixed(4)),
                                rimZ: Number(column.rimZ.toFixed(4)),
                                wallTopZ: Number(column.wallTopZ.toFixed(4)),
                            });
                            built.geometry.dispose();
                        }
                    }
                }
            }
            expect(problems, problems.join("\n")).toEqual([]);
        } finally {
            appendFileSync("/tmp/apex-gate-rows.json", `${JSON.stringify(rows, null, 2)}\n`);
            console.log(JSON.stringify(rows));
            right.dispose();
            left.dispose();
        }
    }, 1_200_000);
});
