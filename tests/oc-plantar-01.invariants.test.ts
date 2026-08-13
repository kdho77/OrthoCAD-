// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * OC-PLANTAR-01 — plantar / arch / heel geometric invariants.
 *
 * Every assertion is computed from FINAL EXPORT GEOMETRY:
 *   applyBaseModifiers → closeGlbInsoleToSolid  (same path as buildExportStl)
 * Viewer state is never used.
 *
 * Phase 1: these specs MUST fail against unfixed main (section-0 numbers).
 */

import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers, PLANTAR_Z_MAX_MM } from "@/lib/geometry/base-modifier";
import { CLINICAL_LIMITS, constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    closeGlbInsoleToSolid,
    extractOrderedBoundaryLoopWithIndices,
    submeshByVertexRange,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { referenceFootLengthMm } from "@/lib/geometry/shoe-size";
import type { Side, SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";

/** Clinical mid-range stack that reproduces section-0 defects on current main. */
const MID_RANGE: Partial<SideCorrections> = {
    archHeightMm: 15,
    apexMoveMm: 0,
    heelCupDepthMm: 10,
    heelCupWidthMm: 4,
    heelCupHeightMm: 0,
    medialFlangeMm: 0,
    lateralFlangeMm: 0,
};

const NATIVE_CLEARANCE_MM = 1.961;
const THICKNESS_MM = 3;
const LENGTH_MM = 260;
const WIDTH_MM = 95;

function neu(): SideCorrections {
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

function field(side: Side, patch: Partial<SideCorrections>, thicknessMm = THICKNESS_MM): HeightFieldParams {
    return {
        side,
        lengthMm: LENGTH_MM,
        widthMm: WIDTH_MM,
        thicknessMm,
        corrections: { ...neu(), ...patch },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
        footLengthMm: referenceFootLengthMm(),
    };
}

interface Frame {
    lengthAxis: number;
    widthAxis: number;
    thickAxis: number;
    lenMin: number;
    lenSize: number;
    widMin: number;
    widSize: number;
    widCenter: number;
    topN: number;
    count: number;
}

function resolveFrame(geo: BufferGeometry): Frame {
    const arr = geo.getAttribute("position")!.array as Float32Array;
    const count = arr.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let a = 0; a < 3; a++) {
            const c = arr[i * 3 + a]!;
            if (c < min[a]!) min[a] = c;
            if (c > max[a]!) max[a] = c;
        }
    }
    const sizes: [number, number][] = [
        [0, max[0]! - min[0]!],
        [1, max[1]! - min[1]!],
        [2, max[2]! - min[2]!],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    const thickAxis = sizes[0]![0];
    const widthAxis = sizes[1]![0];
    const lengthAxis = sizes[2]![0];
    const topN = (geo.userData as { topVertexCount?: number }).topVertexCount ?? count;
    const widMin = min[widthAxis]!;
    const widSize = max[widthAxis]! - widMin || 1;
    return {
        thickAxis,
        widthAxis,
        lengthAxis,
        lenMin: min[lengthAxis]!,
        lenSize: max[lengthAxis]! - min[lengthAxis]! || 1,
        widMin,
        widSize,
        widCenter: widMin + widSize / 2,
        topN,
        count,
    };
}

/**
 * Plantar contact stats on FINAL export geometry (R1/R2).
 * Only cells that contain a BASE plantar ground-contact vertex are scored —
 * that is the ground datum. Perimeter wall shelves are excluded via the
 * bevel margin. Elevation = exportZ − baseZ for the plantar-band vert
 * (must stay ≤ 0.05 mm under R2).
 */
function plantarFootprintStats(
    baseArr: Float32Array,
    exportArr: Float32Array,
    f: Frame,
): { pctFlat: number; maxElev: number; cellCount: number } {
    const cell = 2.0;
    const cells = new Map<string, number>();
    for (let i = f.topN; i < f.count; i++) {
        if (baseArr[i * 3 + f.thickAxis]! > PLANTAR_Z_MAX_MM) continue;
        const lx = baseArr[i * 3 + f.lengthAxis]!;
        const wy = baseArr[i * 3 + f.widthAxis]!;
        const elev = Math.abs(exportArr[i * 3 + f.thickAxis]! - baseArr[i * 3 + f.thickAxis]!);
        const k = `${Math.floor(lx / cell)},${Math.floor(wy / cell)}`;
        const prev = cells.get(k);
        if (prev === undefined || elev > prev) cells.set(k, elev);
    }

    const margin = 4;
    const len0 = f.lenMin + margin;
    const len1 = f.lenMin + f.lenSize - margin;
    const wid0 = f.widMin + margin;
    const wid1 = f.widMin + f.widSize - margin;

    let flat = 0;
    let maxElev = 0;
    let cellCount = 0;
    for (const [k, elev] of cells) {
        const [cx, cy] = k.split(",").map(Number) as [number, number];
        const lx = cx * cell + cell / 2;
        const wy = cy * cell + cell / 2;
        if (lx < len0 || lx > len1 || wy < wid0 || wy > wid1) continue;
        cellCount++;
        if (elev <= 0.05) flat++;
        maxElev = Math.max(maxElev, elev);
    }
    return { pctFlat: cellCount === 0 ? 1 : flat / cellCount, maxElev, cellCount };
}

function topRimIndices(geo: BufferGeometry, topN: number): number[] {
    const sub = submeshByVertexRange(geo, 0, topN);
    try {
        return extractOrderedBoundaryLoopWithIndices(sub).indices;
    } finally {
        sub.dispose();
    }
}

function medialWidthSign(side: Side): number {
    // LEFT: medial = −Y in measured export frame; RIGHT: opposite after mirror.
    return side === "left" ? -1 : 1;
}

interface ArchMetrics {
    maxZ: number;
    maxLen: number;
    maxWid: number;
    onBoundary: boolean;
    inboardMm: number;
    apexHeightAboveGround: number;
    distalSlopeDeg: number;
}

function archMetrics(
    exportArr: Float32Array,
    f: Frame,
    rim: number[],
    side: Side,
    groundZ: number,
): ArchMetrics {
    let maxZ = -Infinity;
    let maxI = 0;
    for (let i = 0; i < f.topN; i++) {
        const z = exportArr[i * 3 + f.thickAxis]!;
        if (z > maxZ) {
            maxZ = z;
            maxI = i;
        }
    }
    const maxLen = exportArr[maxI * 3 + f.lengthAxis]!;
    const maxWid = exportArr[maxI * 3 + f.widthAxis]!;
    const onBoundary = rim.includes(maxI);

    // Medial rim at same length station (width relative to footprint centre).
    const mSign = medialWidthSign(side);
    let rimWid: number | null = null;
    let bestDu = Infinity;
    for (const j of rim) {
        const du = Math.abs(exportArr[j * 3 + f.lengthAxis]! - maxLen);
        if (du > 3) continue;
        const w = exportArr[j * 3 + f.widthAxis]!;
        const wRel = w - f.widCenter;
        if (rimWid === null || wRel * mSign > (rimWid - f.widCenter) * mSign) {
            if (du < bestDu + 0.5) {
                rimWid = w;
                bestDu = du;
            }
        }
    }
    const inboardMm = rimWid === null ? 0 : Math.abs(rimWid - maxWid);

    // Distal sagittal slope: apex → station ~60 mm anterior (section-0: ~26° today).
    const foreX = Math.min(f.lenMin + f.lenSize * 0.75, maxLen + 60);
    let foreZ = NaN;
    let foreN = 0;
    let foreSum = 0;
    for (let i = 0; i < f.topN; i++) {
        const lx = exportArr[i * 3 + f.lengthAxis]!;
        if (Math.abs(lx - foreX) > 4) continue;
        const wRel = exportArr[i * 3 + f.widthAxis]! - f.widCenter;
        if (wRel * mSign < 0) continue; // medial half about centreline
        foreSum += exportArr[i * 3 + f.thickAxis]!;
        foreN++;
    }
    if (foreN > 0) foreZ = foreSum / foreN;
    const run = Math.abs(foreX - maxLen);
    const rise = Number.isFinite(foreZ) ? Math.abs(maxZ - foreZ) : NaN;
    const distalSlopeDeg =
        !Number.isFinite(rise) || run < 1e-6
            ? Number.POSITIVE_INFINITY
            : (Math.atan2(rise, run) * 180) / Math.PI;

    return {
        maxZ,
        maxLen,
        maxWid,
        onBoundary,
        inboardMm,
        apexHeightAboveGround: maxZ - groundZ,
        distalSlopeDeg,
    };
}

function heelTroughDriftMm(exportArr: Float32Array, f: Frame): number {
    // Per length station in [0, 0.25L], find trough (min Z) Y; report max |Δy| from x≈0 station.
    const stations: { u: number; wid: number }[] = [];
    const bins = 10;
    const uMax = 0.25;
    for (let b = 0; b < bins; b++) {
        const u0 = (b / bins) * uMax;
        const u1 = ((b + 1) / bins) * uMax;
        let minZ = Infinity;
        let widAt = 0;
        for (let i = 0; i < f.topN; i++) {
            const u = (exportArr[i * 3 + f.lengthAxis]! - f.lenMin) / f.lenSize;
            if (u < u0 || u >= u1) continue;
            const z = exportArr[i * 3 + f.thickAxis]!;
            if (z < minZ) {
                minZ = z;
                widAt = exportArr[i * 3 + f.widthAxis]!;
            }
        }
        if (Number.isFinite(minZ)) stations.push({ u: (u0 + u1) / 2, wid: widAt });
    }
    if (stations.length < 2) return 0;
    const origin = stations[0]!.wid;
    let maxDrift = 0;
    for (const s of stations) maxDrift = Math.max(maxDrift, Math.abs(s.wid - origin));
    return maxDrift;
}

function heelRimAsymmetryMm(exportArr: Float32Array, f: Frame, side: Side, atU = 0.23): number {
    const mSign = medialWidthSign(side);
    const targetX = f.lenMin + atU * f.lenSize;
    let medZ = -Infinity;
    let latZ = -Infinity;
    let troughZ = Infinity;
    for (let i = 0; i < f.topN; i++) {
        const lx = exportArr[i * 3 + f.lengthAxis]!;
        if (Math.abs(lx - targetX) > 2.5) continue;
        const z = exportArr[i * 3 + f.thickAxis]!;
        const w = exportArr[i * 3 + f.widthAxis]!;
        if (z < troughZ) troughZ = z;
        const wRel = w - f.widCenter;
        // Outer ~55% of half-width = rim band.
        if (wRel * mSign > 0.55 * (f.widSize / 2)) medZ = Math.max(medZ, z);
        if (wRel * mSign < -0.55 * (f.widSize / 2)) latZ = Math.max(latZ, z);
    }
    if (!Number.isFinite(medZ) || !Number.isFinite(latZ) || !Number.isFinite(troughZ)) {
        return Number.POSITIVE_INFINITY; // missing rim sample ⇒ fail closed
    }
    const medDepth = medZ - troughZ;
    const latDepth = latZ - troughZ;
    return Math.abs(medDepth - latDepth);
}

function thicknessStats(
    baseArr: Float32Array,
    exportArr: Float32Array,
    f: Frame,
): { minT: number; maxT: number; shellH: number } {
    // Pair top verts to nearest PLANTAR-band bottom vert; thickness = Δthick (R5/R17).
    const cell = 1.5;
    const hash = new Map<string, number[]>();
    for (let i = f.topN; i < f.count; i++) {
        if (baseArr[i * 3 + f.thickAxis]! > PLANTAR_Z_MAX_MM) continue;
        const k = `${Math.floor(baseArr[i * 3 + f.lengthAxis]! / cell)},${Math.floor(baseArr[i * 3 + f.widthAxis]! / cell)}`;
        let list = hash.get(k);
        if (!list) {
            list = [];
            hash.set(k, list);
        }
        list.push(i);
    }
    let minT = Infinity;
    let maxT = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < f.topN; i++) {
        const lx = exportArr[i * 3 + f.lengthAxis]!;
        const wy = exportArr[i * 3 + f.widthAxis]!;
        const z = exportArr[i * 3 + f.thickAxis]!;
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
        const cx = Math.floor(lx / cell);
        const cy = Math.floor(wy / cell);
        let best = -1;
        let bestD = Infinity;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const list = hash.get(`${cx + dx},${cy + dy}`);
                if (!list) continue;
                for (const bi of list) {
                    const d = Math.hypot(
                        exportArr[bi * 3 + f.lengthAxis]! - lx,
                        exportArr[bi * 3 + f.widthAxis]! - wy,
                    );
                    if (d < bestD) {
                        bestD = d;
                        best = bi;
                    }
                }
            }
        }
        if (best < 0 || bestD > 2.5) continue;
        const t = z - exportArr[best * 3 + f.thickAxis]!;
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
    }
    return {
        minT: Number.isFinite(minT) ? minT : 0,
        maxT: Number.isFinite(maxT) ? maxT : 0,
        shellH: maxZ - minZ,
    };
}

function signedVolumeMm3(geo: BufferGeometry): number {
    const pos = geo.getAttribute("position")!.array as Float32Array;
    const idx = geo.index?.array;
    let vol = 0;
    const tri = (a: number, b: number, c: number) => {
        const ax = pos[a * 3]!,
            ay = pos[a * 3 + 1]!,
            az = pos[a * 3 + 2]!;
        const bx = pos[b * 3]!,
            by = pos[b * 3 + 1]!,
            bz = pos[b * 3 + 2]!;
        const cx = pos[c * 3]!,
            cy = pos[c * 3 + 1]!,
            cz = pos[c * 3 + 2]!;
        vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    };
    if (idx) {
        for (let i = 0; i < idx.length; i += 3) tri(idx[i]!, idx[i + 1]!, idx[i + 2]!);
    } else {
        const n = pos.length / 3;
        for (let i = 0; i < n; i += 3) tri(i, i + 1, i + 2);
    }
    return vol / 6;
}

function exportSolid(base: BufferGeometry, f: HeightFieldParams): BufferGeometry {
    const modified = applyBaseModifiers(base, f);
    try {
        return closeGlbInsoleToSolid(modified);
    } finally {
        modified.dispose();
    }
}

describe("OC-PLANTAR-01 invariants (export geometry)", () => {
    let baseLeft: BufferGeometry;
    let baseRight: BufferGeometry;
    let baseArrLeft: Float32Array;

    beforeAll(async () => {
        baseLeft = await loadProductionDefaultGlb({ primarySide: "left", slot: "left" });
        baseRight = await loadProductionDefaultGlb({ primarySide: "left", slot: "right" });
        expect(baseLeft.getAttribute("position")!.count).toBeGreaterThan(1000);
        baseArrLeft = new Float32Array(baseLeft.getAttribute("position")!.array as Float32Array);
    });

    function runSide(side: Side, base: BufferGeometry, baseArr: Float32Array) {
        const f = resolveFrame(base);
        const solid = exportSolid(base, field(side, MID_RANGE));
        const arr = solid.getAttribute("position")!.array as Float32Array;
        const rim = topRimIndices(base, f.topN); // rim topology from base indices
        const groundZ = (() => {
            let z = Infinity;
            for (let i = f.topN; i < f.count; i++) {
                if (baseArr[i * 3 + f.thickAxis]! > PLANTAR_Z_MAX_MM) continue;
                z = Math.min(z, arr[i * 3 + f.thickAxis]!);
            }
            return Number.isFinite(z) ? z : 0;
        })();
        return { f, solid, arr, rim, groundZ, baseArr };
    }

    test("T-P1 plantar planarity ≥ 95% at clinical mid-range", () => {
        const { f, solid, arr, baseArr } = runSide("left", baseLeft, baseArrLeft);
        const stats = plantarFootprintStats(baseArr, arr, f);
        console.log("[OC-PLANTAR] T-P1", stats);
        expect(stats.cellCount).toBeGreaterThan(50);
        expect(stats.pctFlat).toBeGreaterThanOrEqual(0.95);
        solid.dispose();
    });

    test("T-P2 plantar max elevation ≤ 0.5 mm (no posting)", () => {
        const { f, solid, arr, baseArr } = runSide("left", baseLeft, baseArrLeft);
        const stats = plantarFootprintStats(baseArr, arr, f);
        console.log("[OC-PLANTAR] T-P2", stats);
        expect(stats.maxElev).toBeLessThanOrEqual(0.5);
        solid.dispose();
    });

    /** Arch-only stack — isolates MLA geometry from heel-cup rim competition. */
    const ARCH_ONLY: Partial<SideCorrections> = {
        archHeightMm: 15,
        apexMoveMm: 0,
        heelCupDepthMm: 0,
        heelCupWidthMm: 0,
    };

    test("T-A1 top max not on boundary; ≥ 6 mm inboard of medial rim", () => {
        const f = resolveFrame(baseLeft);
        const solid = exportSolid(baseLeft, field("left", ARCH_ONLY));
        const arr = solid.getAttribute("position")!.array as Float32Array;
        const rim = topRimIndices(baseLeft, f.topN);
        const groundZ = 0;
        const m = archMetrics(arr, f, rim, "left", groundZ);
        console.log("[OC-PLANTAR] T-A1", m);
        expect(m.onBoundary).toBe(false);
        expect(m.inboardMm).toBeGreaterThanOrEqual(6);
        solid.dispose();
    });

    test("T-A2 arch apex X within 50–55% of foot length", () => {
        const foot = referenceFootLengthMm();
        const f = resolveFrame(baseLeft);
        const solid = exportSolid(baseLeft, field("left", ARCH_ONLY));
        const arr = solid.getAttribute("position")!.array as Float32Array;
        const rim = topRimIndices(baseLeft, f.topN);
        const m = archMetrics(arr, f, rim, "left", 0);
        const apexFromHeel = m.maxLen - f.lenMin;
        const frac = apexFromHeel / foot;
        console.log("[OC-PLANTAR] T-A2", { foot, apexFromHeel, frac, shellFrac: apexFromHeel / f.lenSize });
        expect(frac).toBeGreaterThanOrEqual(0.5);
        expect(frac).toBeLessThanOrEqual(0.55);
        solid.dispose();
    });

    test("T-A3 arch apex height = archHeightMm ± 1.0", () => {
        const f = resolveFrame(baseLeft);
        const solid = exportSolid(baseLeft, field("left", ARCH_ONLY));
        const arr = solid.getAttribute("position")!.array as Float32Array;
        const rim = topRimIndices(baseLeft, f.topN);
        const m = archMetrics(arr, f, rim, "left", 0);
        console.log("[OC-PLANTAR] T-A3", {
            apexHeightAboveGround: m.apexHeightAboveGround,
            commanded: ARCH_ONLY.archHeightMm,
        });
        expect(Math.abs(m.apexHeightAboveGround - (ARCH_ONLY.archHeightMm ?? 0))).toBeLessThanOrEqual(1.0);
        solid.dispose();
    });

    test("T-A4 distal sagittal slope ≤ 12°", () => {
        const f = resolveFrame(baseLeft);
        const solid = exportSolid(baseLeft, field("left", ARCH_ONLY));
        const arr = solid.getAttribute("position")!.array as Float32Array;
        const rim = topRimIndices(baseLeft, f.topN);
        const m = archMetrics(arr, f, rim, "left", 0);
        console.log("[OC-PLANTAR] T-A4", { distalSlopeDeg: m.distalSlopeDeg });
        expect(m.distalSlopeDeg).toBeLessThanOrEqual(12);
        solid.dispose();
    });

    test("T-H1 heel seat trough centreline drift ≤ 2.0 mm", () => {
        const { f, solid, arr } = runSide("left", baseLeft, baseArrLeft);
        const drift = heelTroughDriftMm(arr, f);
        console.log("[OC-PLANTAR] T-H1", { drift });
        expect(drift).toBeLessThanOrEqual(2.0);
        solid.dispose();
    });

    test("T-H2 heelCupWidthMm=+6 symmetric wall translation, seat unmoved", () => {
        const f = resolveFrame(baseLeft);
        const zero = exportSolid(baseLeft, field("left", { heelCupWidthMm: 0 }));
        const wide = exportSolid(baseLeft, field("left", { heelCupWidthMm: 6 }));
        const zArr = zero.getAttribute("position")!.array as Float32Array;
        const wArr = wide.getAttribute("position")!.array as Float32Array;

        // Sample wall-base verts near heel (u<0.2, z just above plantar)
        let medSum = 0,
            latSum = 0,
            medN = 0,
            latN = 0;
        let seatDrift = 0;
        const mSign = medialWidthSign("left");
        for (let i = f.topN; i < f.count; i++) {
            const u = (baseArrLeft[i * 3 + f.lengthAxis]! - f.lenMin) / f.lenSize;
            if (u > 0.2) continue;
            const baseZ = baseArrLeft[i * 3 + f.thickAxis]!;
            const dWid = wArr[i * 3 + f.widthAxis]! - zArr[i * 3 + f.widthAxis]!;
            if (baseZ <= PLANTAR_Z_MAX_MM) {
                seatDrift = Math.max(seatDrift, Math.abs(dWid));
                continue;
            }
            if (baseZ > 3) continue; // wall base band
            const widRel = baseArrLeft[i * 3 + f.widthAxis]! - f.widCenter;
            if (widRel * mSign > 5) {
                medSum += dWid * mSign; // medial outward positive when widening
                medN++;
            } else if (widRel * mSign < -5) {
                latSum += -dWid * mSign;
                latN++;
            }
        }
        const medMean = medN ? medSum / medN : 0;
        const latMean = latN ? latSum / latN : 0;
        console.log("[OC-PLANTAR] T-H2", { medMean, latMean, seatDrift, medN, latN });
        expect(medN).toBeGreaterThan(10);
        expect(latN).toBeGreaterThan(10);
        expect(Math.abs(medMean - latMean)).toBeLessThanOrEqual(0.25);
        expect(seatDrift).toBeLessThanOrEqual(0.25);
        zero.dispose();
        wide.dispose();
    });

    test("T-H3 medial/lateral rim asymmetry ≤ 3.0 mm", () => {
        const { f, solid, arr } = runSide("left", baseLeft, baseArrLeft);
        const asym = heelRimAsymmetryMm(arr, f, "left", 0.23);
        console.log("[OC-PLANTAR] T-H3", { asym });
        expect(asym).toBeLessThanOrEqual(3.0);
        solid.dispose();
    });

    test("T-H4 heel cup depth clamps at 20 mm and sets warning flag", () => {
        const raw = { ...neu(), heelCupDepthMm: 25 };
        const result = constrainSideCorrections(raw, THICKNESS_MM);
        // After Phase 4: hard cap 20 with warning. Today max is 10 — must still fail this assertion.
        console.log("[OC-PLANTAR] T-H4", {
            applied: result.constrained.heelCupDepthMm,
            violations: result.violations,
            lim: CLINICAL_LIMITS.heelCupDepthMm,
        });
        expect(result.constrained.heelCupDepthMm).toBe(20);
        expect(result.violations.some((v) => v.field === "heelCupDepthMm" && v.applied === 20)).toBe(true);
    });

    test("T-T1 min thickness ≥ max(thicknessMm, 1.961)", () => {
        const { f, solid, arr, baseArr } = runSide("left", baseLeft, baseArrLeft);
        const t = thicknessStats(baseArr, arr, f);
        const floor = Math.max(THICKNESS_MM, NATIVE_CLEARANCE_MM);
        console.log("[OC-PLANTAR] T-T1", t, { floor });
        expect(t.minT).toBeGreaterThanOrEqual(floor - 1e-3);
        solid.dispose();
    });

    test("T-T2 max thickness ≤ thicknessMm + archHeightMm + 2.0", () => {
        const { f, solid, arr, baseArr } = runSide("left", baseLeft, baseArrLeft);
        const t = thicknessStats(baseArr, arr, f);
        const ceiling = THICKNESS_MM + (MID_RANGE.archHeightMm ?? 0) + 2.0;
        console.log("[OC-PLANTAR] T-T2", t, { ceiling });
        expect(t.maxT).toBeLessThanOrEqual(ceiling);
        solid.dispose();
    });

    test("T-T3 total shell height ≤ 30 mm", () => {
        const { f, solid, arr, baseArr } = runSide("left", baseLeft, baseArrLeft);
        const t = thicknessStats(baseArr, arr, f);
        console.log("[OC-PLANTAR] T-T3", { shellH: t.shellH });
        expect(t.shellH).toBeLessThanOrEqual(30);
        solid.dispose();
    });

    test("T-M1 export watertight / manifold / positive volume", () => {
        const solid = exportSolid(baseLeft, field("left", MID_RANGE));
        const report = validateManifold(solid);
        const vol = signedVolumeMm3(solid);
        console.log("[OC-PLANTAR] T-M1", { ...report, vol });
        expect(report.openEdges).toBe(0);
        expect(report.nonManifoldEdges).toBe(0);
        expect(vol).toBeGreaterThan(0);
        solid.dispose();
    });

    test("T-Z1 all-zero corrections → geometry within 1e-4 mm of base", () => {
        const f = resolveFrame(baseLeft);
        // E1: pure field path (pre-close). Thickness floor to native clearance may
        // still lift the top when thicknessMm < native — use thickness = native.
        const modified = applyBaseModifiers(baseLeft, field("left", {}, NATIVE_CLEARANCE_MM));
        const mArr = modified.getAttribute("position")!.array as Float32Array;
        let maxD = 0;
        for (let i = 0; i < f.count; i++) {
            for (let c = 0; c < 3; c++) {
                maxD = Math.max(maxD, Math.abs(mArr[i * 3 + c]! - baseArrLeft[i * 3 + c]!));
            }
        }
        console.log("[OC-PLANTAR] T-Z1", { maxD });
        expect(maxD).toBeLessThanOrEqual(1e-4);
        modified.dispose();
    });

    test("T-R1 RIGHT/mirrored path re-runs plantar + arch + heel gates", () => {
        const baseArrR = new Float32Array(baseRight.getAttribute("position")!.array as Float32Array);
        const { f, solid, arr, rim, groundZ, baseArr } = runSide("right", baseRight, baseArrR);
        const plantar = plantarFootprintStats(baseArr, arr, f);
        const arch = archMetrics(arr, f, rim, "right", groundZ);
        const drift = heelTroughDriftMm(arr, f);
        const asym = heelRimAsymmetryMm(arr, f, "right", 0.23);
        const t = thicknessStats(baseArr, arr, f);
        const foot = referenceFootLengthMm();
        const frac = (arch.maxLen - f.lenMin) / foot;
        console.log("[OC-PLANTAR] T-R1", { plantar, arch, drift, asym, t, frac });
        expect(plantar.pctFlat).toBeGreaterThanOrEqual(0.95);
        expect(plantar.maxElev).toBeLessThanOrEqual(0.5);
        expect(arch.onBoundary).toBe(false);
        expect(arch.inboardMm).toBeGreaterThanOrEqual(6);
        expect(frac).toBeGreaterThanOrEqual(0.5);
        expect(frac).toBeLessThanOrEqual(0.55);
        expect(arch.distalSlopeDeg).toBeLessThanOrEqual(12);
        expect(drift).toBeLessThanOrEqual(2.0);
        expect(asym).toBeLessThanOrEqual(3.0);
        expect(t.minT).toBeGreaterThanOrEqual(Math.max(THICKNESS_MM, NATIVE_CLEARANCE_MM) - 1e-3);
        expect(t.maxT).toBeLessThanOrEqual(THICKNESS_MM + (MID_RANGE.archHeightMm ?? 0) + 2.0);
        expect(t.shellH).toBeLessThanOrEqual(30);
        solid.dispose();
    });
});
