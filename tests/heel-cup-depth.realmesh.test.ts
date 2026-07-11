// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Real-mesh regression harness for the heelCupDepthMm correction, measured on
// the committed canonical stock base (tests/fixtures/Default.glb). No synthetic
// geometry: every metric below is computed on the actual production mesh the
// viewer deforms. See PR #105 rounds 8/9 — fold/crumple elimination.
//
// The geometric frame (axes, heel arc, wall height) is re-derived here from
// first principles instead of imported from the module under test, so the
// harness cannot inherit a bug from the implementation.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/Default.glb");

/** Depth slider values (mm) measured in addition to the delta-0 baseline. */
const DEPTH_SAMPLES_MM = [3, 8, 15];

// --- Acceptance thresholds (Phase 3) ---------------------------------------
/** Heel seat floor must be mathematically untouched by depth. */
const FLOOR_MAX_DELTA_MM = 1e-6;
/** Crease budget: wall-band max dihedral at 15 mm ≤ baseline + this. */
const CREASE_BUDGET_DEG = 8;
/** Posterior apex rim displacement magnitude truthfulness (slider mm = mm). */
const APEX_TOLERANCE_MM = 0.05;
/** Coincident (position-welded) vertices must never be torn apart. */
const MAX_COINCIDENT_SPLIT_MM = 1e-6;

// ---------------------------------------------------------------------------
// Field construction (mirrors heel-cup-depth.verify.test.ts conventions)
// ---------------------------------------------------------------------------

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

function correctionField(patch: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "right",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections: { ...neutralCorrections(), ...patch },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

// ---------------------------------------------------------------------------
// Independent geometric frame
// ---------------------------------------------------------------------------

interface HeelFrame {
    lengthAxis: number;
    widthAxis: number;
    thickAxis: number;
    lenMin: number;
    lenSize: number;
    widCenter: number;
    /** Physical heel-center along the length axis (u = 0.13 convention). */
    heelCenterLen: number;
    topVertexCount: number;
    count: number;
}

/** Anterior termination of the heel-cup rim arc (symmetric fallback, radians). */
const ARC_TERMINATION_RAD = (130 / 180) * Math.PI;
/** Normalized wall height below which a vertex belongs to the heel seat floor. */
const FLOOR_H_THRESHOLD = 0.05;
/** Wall band lower bound (normalized wall height) for the crease metric. */
const WALL_BAND_H_MIN = 0.15;
const RIM_BINS_PER_SIDE = 24;

function resolveFrame(geo: BufferGeometry): HeelFrame {
    const pos = geo.getAttribute("position")!;
    const arr = pos.array as Float32Array;
    const count = pos.count;
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
    const lenMin = min[lengthAxis]!;
    const lenSize = max[lengthAxis]! - lenMin || 1;
    const widCenter = min[widthAxis]! + (max[widthAxis]! - min[widthAxis]!) / 2;
    const userData = geo.userData as { topVertexCount?: number };
    const topVertexCount =
        typeof userData.topVertexCount === "number" && userData.topVertexCount > 0
            ? userData.topVertexCount
            : count;
    return {
        lengthAxis,
        widthAxis,
        thickAxis,
        lenMin,
        lenSize,
        widCenter,
        heelCenterLen: lenMin + 0.13 * lenSize,
        topVertexCount,
        count,
    };
}

/** Polar heel-arc angle: 0 pointing posterior, π pointing anterior. */
function heelTheta(frame: HeelFrame, arr: Float32Array, i: number): number {
    const dLen = arr[i * 3 + frame.lengthAxis]! - frame.heelCenterLen;
    const dWid = Math.abs(arr[i * 3 + frame.widthAxis]! - frame.widCenter);
    return Math.atan2(dWid, -dLen);
}

interface HeelClassification {
    /** Position-weld group id per top vertex (coincident corners share a group). */
    groupOf: Int32Array;
    groupCount: number;
    /** Normalized wall height per top vertex in the heel arc (NaN outside). */
    h: Float32Array;
    /** Normalized arc position per top vertex in the heel arc (NaN outside). */
    s: Float32Array;
    /** +1 / −1 width-half sign per top vertex. */
    sideSign: Int8Array;
    floorZ: number;
    /** Per (side, bin) rim vertex index — the tallest baseline vertex in the bin. */
    rimVertexBySideBin: [number[], number[]];
    /** Index of the posterior-apex rim vertex (bin 0 across both sides). */
    apexIndex: number;
}

/**
 * Classify heel-arc top vertices of the BASELINE mesh into normalized wall
 * height h (0 = seat floor, 1 = local rim) and arc position s (0 = posterior
 * apex, 1 = anterior termination), using per-arc-bin local rim heights. Also
 * builds a position-weld group map: the GLB top mesh is only partially indexed
 * (coincident corners with distinct indices), so all coincidence-sensitive
 * metrics must operate on welded groups, not raw indices.
 */
function classifyHeel(frame: HeelFrame, arr: Float32Array): HeelClassification {
    const { topVertexCount, thickAxis, widthAxis, widCenter } = frame;

    const groupOf = new Int32Array(topVertexCount).fill(-1);
    const keyToGroup = new Map<string, number>();
    let groupCount = 0;
    for (let i = 0; i < topVertexCount; i++) {
        const key = `${arr[i * 3]},${arr[i * 3 + 1]},${arr[i * 3 + 2]}`;
        let g = keyToGroup.get(key);
        if (g === undefined) {
            g = groupCount++;
            keyToGroup.set(key, g);
        }
        groupOf[i] = g;
    }

    const h = new Float32Array(topVertexCount).fill(Number.NaN);
    const s = new Float32Array(topVertexCount).fill(Number.NaN);
    const sideSign = new Int8Array(topVertexCount);

    let floorZ = Infinity;
    const binMax: [Float64Array, Float64Array] = [
        new Float64Array(RIM_BINS_PER_SIDE).fill(-Infinity),
        new Float64Array(RIM_BINS_PER_SIDE).fill(-Infinity),
    ];
    const rimVertexBySideBin: [number[], number[]] = [
        new Array(RIM_BINS_PER_SIDE).fill(-1),
        new Array(RIM_BINS_PER_SIDE).fill(-1),
    ];

    for (let i = 0; i < topVertexCount; i++) {
        const theta = heelTheta(frame, arr, i);
        if (theta > ARC_TERMINATION_RAD) continue;
        const z = arr[i * 3 + thickAxis]!;
        if (z < floorZ) floorZ = z;
        const side = arr[i * 3 + widthAxis]! >= widCenter ? 0 : 1;
        sideSign[i] = side === 0 ? 1 : -1;
        const sv = theta / ARC_TERMINATION_RAD;
        s[i] = sv;
        const bin = Math.min(RIM_BINS_PER_SIDE - 1, Math.floor(sv * RIM_BINS_PER_SIDE));
        if (z > binMax[side]![bin]!) {
            binMax[side]![bin] = z;
            rimVertexBySideBin[side]![bin] = i;
        }
    }

    for (let i = 0; i < topVertexCount; i++) {
        if (Number.isNaN(s[i]!)) continue;
        const side = sideSign[i]! >= 0 ? 0 : 1;
        const bin = Math.min(RIM_BINS_PER_SIDE - 1, Math.floor(s[i]! * RIM_BINS_PER_SIDE));
        const rimZ = binMax[side]![bin]!;
        const denom = rimZ - floorZ;
        h[i] = denom > 1e-9 ? Math.max(0, Math.min(1, (arr[i * 3 + frame.thickAxis]! - floorZ) / denom)) : 0;
    }

    // Posterior apex: the taller of the two bin-0 rim vertices.
    const a0 = rimVertexBySideBin[0]![0]!;
    const a1 = rimVertexBySideBin[1]![0]!;
    let apexIndex = a0;
    if (a1 >= 0 && (a0 < 0 || arr[a1 * 3 + frame.thickAxis]! > arr[a0 * 3 + frame.thickAxis]!)) {
        apexIndex = a1;
    }

    return { groupOf, groupCount, h, s, sideSign, floorZ, rimVertexBySideBin, apexIndex };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function topologyFingerprint(geo: BufferGeometry): string {
    const pos = geo.getAttribute("position")!;
    const idx = geo.index ? (geo.index.array as ArrayLike<number>) : null;
    let hash = 0x811c9dc5;
    if (idx) {
        for (let i = 0; i < idx.length; i++) {
            hash ^= idx[i]!;
            hash = Math.imul(hash, 0x01000193);
        }
    }
    return `v${pos.count}/i${idx ? idx.length : 0}/h${(hash >>> 0).toString(16)}`;
}

function maxVertexDeltaMm(a: Float32Array, b: Float32Array, from: number, to: number): number {
    let maxD = 0;
    for (let i = from; i < to; i++) {
        const dx = b[i * 3]! - a[i * 3]!;
        const dy = b[i * 3 + 1]! - a[i * 3 + 1]!;
        const dz = b[i * 3 + 2]! - a[i * 3 + 2]!;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > maxD) maxD = d;
    }
    return maxD;
}

/**
 * HC-1 plantar band only (Z ≤ 1mm). Rim-conformity transfer intentionally
 * moves the bottom side wall; the ground-contact sheet must stay fixed.
 */
function plantarBottomMaxDeltaMm(
    baseArr: Float32Array,
    modArr: Float32Array,
    frame: HeelFrame,
    plantarZMaxMm = 1.0,
): number {
    let maxD = 0;
    for (let i = frame.topVertexCount; i < frame.count; i++) {
        if (baseArr[i * 3 + frame.thickAxis]! > plantarZMaxMm) continue;
        const dx = modArr[i * 3]! - baseArr[i * 3]!;
        const dy = modArr[i * 3 + 1]! - baseArr[i * 3 + 1]!;
        const dz = modArr[i * 3 + 2]! - baseArr[i * 3 + 2]!;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > maxD) maxD = d;
    }
    return maxD;
}

/** Max displacement magnitude over the heel seat floor region (h < threshold). */
function floorRegionMaxDeltaMm(
    cls: HeelClassification,
    frame: HeelFrame,
    baseArr: Float32Array,
    modArr: Float32Array,
): number {
    let maxD = 0;
    for (let i = 0; i < frame.topVertexCount; i++) {
        if (Number.isNaN(cls.h[i]!) || cls.h[i]! >= FLOOR_H_THRESHOLD) continue;
        const dx = modArr[i * 3]! - baseArr[i * 3]!;
        const dy = modArr[i * 3 + 1]! - baseArr[i * 3 + 1]!;
        const dz = modArr[i * 3 + 2]! - baseArr[i * 3 + 2]!;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > maxD) maxD = d;
    }
    return maxD;
}

/** Same, but along the thickness axis only (for combined width+depth runs). */
function floorRegionMaxThickDeltaMm(
    cls: HeelClassification,
    frame: HeelFrame,
    baseArr: Float32Array,
    modArr: Float32Array,
): number {
    let maxD = 0;
    for (let i = 0; i < frame.topVertexCount; i++) {
        if (Number.isNaN(cls.h[i]!) || cls.h[i]! >= FLOOR_H_THRESHOLD) continue;
        const d = Math.abs(modArr[i * 3 + frame.thickAxis]! - baseArr[i * 3 + frame.thickAxis]!);
        if (d > maxD) maxD = d;
    }
    return maxD;
}

/**
 * Minimum BASELINE triangle altitude (mm) for a face to count in the crease
 * metric. The fixture's top mesh contains degenerate slivers (measured areas
 * down to 0.013 mm², altitudes ~0.02 mm) whose normals rotate by tens of
 * degrees under ANY smooth non-rigid deformation — the baseline mesh itself
 * already carries 58° sliver dihedrals. Folds are creases across well-formed
 * faces, so the metric considers only faces whose baseline altitude clears
 * this threshold; the same face set is used at every depth for comparability.
 */
const DIHEDRAL_MIN_ALTITUDE_MM = 0.1;

/**
 * Max dihedral angle (deg) between adjacent well-formed faces whose shared
 * edge lies in the heel-cup wall band. Edges are paired by position-weld
 * groups (the fixture's top mesh is partially index-shared), and both band
 * membership and face quality are decided on the baseline mesh so identical
 * edge sets are compared across depths.
 */
function wallBandMaxDihedralDeg(
    geo: BufferGeometry,
    cls: HeelClassification,
    frame: HeelFrame,
    baselineArr: Float32Array,
): number {
    const idx = geo.index!.array as ArrayLike<number>;
    const arr = geo.getAttribute("position")!.array as Float32Array;
    const inBand = (v: number) =>
        v < frame.topVertexCount && !Number.isNaN(cls.h[v]!) && cls.h[v]! >= WALL_BAND_H_MIN;

    const faceNormal = (a2: Float32Array, f: number): [number, number, number] => {
        const a = idx[f * 3]!;
        const b = idx[f * 3 + 1]!;
        const c = idx[f * 3 + 2]!;
        const abx = a2[b * 3]! - a2[a * 3]!;
        const aby = a2[b * 3 + 1]! - a2[a * 3 + 1]!;
        const abz = a2[b * 3 + 2]! - a2[a * 3 + 2]!;
        const acx = a2[c * 3]! - a2[a * 3]!;
        const acy = a2[c * 3 + 1]! - a2[a * 3 + 1]!;
        const acz = a2[c * 3 + 2]! - a2[a * 3 + 2]!;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        return [nx / len, ny / len, nz / len];
    };

    /** Baseline min altitude = 2·area / longest edge. */
    const wellFormed = (f: number): boolean => {
        const a = idx[f * 3]!;
        const b = idx[f * 3 + 1]!;
        const c = idx[f * 3 + 2]!;
        const e2 = (p: number, q: number) => {
            const dx = baselineArr[q * 3]! - baselineArr[p * 3]!;
            const dy = baselineArr[q * 3 + 1]! - baselineArr[p * 3 + 1]!;
            const dz = baselineArr[q * 3 + 2]! - baselineArr[p * 3 + 2]!;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        };
        const abx = baselineArr[b * 3]! - baselineArr[a * 3]!;
        const aby = baselineArr[b * 3 + 1]! - baselineArr[a * 3 + 1]!;
        const abz = baselineArr[b * 3 + 2]! - baselineArr[a * 3 + 2]!;
        const acx = baselineArr[c * 3]! - baselineArr[a * 3]!;
        const acy = baselineArr[c * 3 + 1]! - baselineArr[a * 3 + 1]!;
        const acz = baselineArr[c * 3 + 2]! - baselineArr[a * 3 + 2]!;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const area2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const longest = Math.max(e2(a, b), e2(b, c), e2(c, a));
        return longest > 0 && area2 / longest >= DIHEDRAL_MIN_ALTITUDE_MM;
    };

    const faceCount = idx.length / 3;
    const edgeToFace = new Map<number, number>();
    let maxAngle = 0;
    for (let f = 0; f < faceCount; f++) {
        for (let e = 0; e < 3; e++) {
            const v0 = idx[f * 3 + e]!;
            const v1 = idx[f * 3 + ((e + 1) % 3)]!;
            if (!inBand(v0) || !inBand(v1)) continue;
            const g0 = cls.groupOf[v0]!;
            const g1 = cls.groupOf[v1]!;
            if (g0 === g1) continue;
            const key = g0 < g1 ? g0 * cls.groupCount + g1 : g1 * cls.groupCount + g0;
            const other = edgeToFace.get(key);
            if (other === undefined) {
                edgeToFace.set(key, f);
                continue;
            }
            if (!wellFormed(f) || !wellFormed(other)) continue;
            const n0 = faceNormal(arr, other);
            const n1 = faceNormal(arr, f);
            const dot = Math.max(-1, Math.min(1, n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]));
            const angle = (Math.acos(dot) * 180) / Math.PI;
            if (angle > maxAngle) maxAngle = angle;
        }
    }
    return maxAngle;
}

/**
 * Max distance any two position-coincident (welded) top vertices were pulled
 * apart by the deformation — a tear/crack detector for the soup-indexed mesh.
 */
function maxCoincidentSplitMm(cls: HeelClassification, frame: HeelFrame, modArr: Float32Array): number {
    const first = new Int32Array(cls.groupCount).fill(-1);
    let maxD = 0;
    for (let i = 0; i < frame.topVertexCount; i++) {
        const g = cls.groupOf[i]!;
        const f = first[g]!;
        if (f < 0) {
            first[g] = i;
            continue;
        }
        const dx = modArr[i * 3]! - modArr[f * 3]!;
        const dy = modArr[i * 3 + 1]! - modArr[f * 3 + 1]!;
        const dz = modArr[i * 3 + 2]! - modArr[f * 3 + 2]!;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > maxD) maxD = d;
    }
    return maxD;
}

interface RimProfiles {
    /** Absolute rim height (thick axis) per bin, posterior apex → anterior. */
    absolute: [number[], number[]];
    /** Rim displacement magnitude ‖Δv‖ vs baseline per bin. */
    rise: [number[], number[]];
}

function rimProfiles(
    cls: HeelClassification,
    frame: HeelFrame,
    baseArr: Float32Array,
    modArr: Float32Array,
): RimProfiles {
    const absolute: [number[], number[]] = [[], []];
    const rise: [number[], number[]] = [[], []];
    for (let side = 0; side <= 1; side++) {
        for (let bin = 0; bin < RIM_BINS_PER_SIDE; bin++) {
            const v = cls.rimVertexBySideBin[side as 0 | 1]![bin]!;
            if (v < 0) continue;
            absolute[side as 0 | 1]!.push(modArr[v * 3 + frame.thickAxis]!);
            rise[side as 0 | 1]!.push(maxVertexDeltaMm(baseArr, modArr, v, v + 1));
        }
    }
    return { absolute, rise };
}

/**
 * Monotone-decreasing check on the rim displacement profile (posterior apex →
 * anterior termination). NOTE: the *absolute* rim of the real Default.glb base
 * rises anteriorly by ~6–10 mm (see baseline profile logs), so "rim height
 * profile strictly monotone decreasing" is asserted on the depth-induced rim
 * displacement — a rise anywhere along the arc is exactly a fold lobe.
 * `riseTolMm` permits sub-visible numeric noise only (old formula rose 0.5–2 mm).
 */
function isMonotoneDecreasing(profile: number[], riseTolMm = 1e-3): boolean {
    for (let i = 1; i < profile.length; i++) {
        if (profile[i]! > profile[i - 1]! + riseTolMm) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let baseGeometry: BufferGeometry;
let frame: HeelFrame;
let cls: HeelClassification;
let baseArr: Float32Array;
let baseFingerprint: string;
let baselineWallDihedralDeg: number;
let baselineRimAbsolute: [number[], number[]];

function runDepth(depthMm: number, extra: Partial<SideCorrections> = {}): BufferGeometry {
    return applyBaseModifiers(baseGeometry, correctionField({ heelCupDepthMm: depthMm, ...extra }), 0);
}

beforeAll(async () => {
    expect(existsSync(FIXTURE_PATH)).toBe(true);
    const buffer = readFileSync(FIXTURE_PATH).buffer.slice(0) as ArrayBuffer;
    const group = await loadGlbFromBuffer(buffer);
    const merged = extractMergedGeometry(group);
    expect(merged).not.toBeNull();
    baseGeometry = merged!.geometry;
    frame = resolveFrame(baseGeometry);
    baseArr = (baseGeometry.getAttribute("position")!.array as Float32Array).slice();
    cls = classifyHeel(frame, baseArr);
    baseFingerprint = topologyFingerprint(baseGeometry);
    baselineWallDihedralDeg = wallBandMaxDihedralDeg(baseGeometry, cls, frame, baseArr);
    baselineRimAbsolute = rimProfiles(cls, frame, baseArr, baseArr).absolute;
    console.log("[HC-REALMESH] frame", {
        ...frame,
        groupCount: cls.groupCount,
        floorZ: cls.floorZ,
        apexIndex: cls.apexIndex,
        baseFingerprint,
        baselineWallDihedralDeg,
    });
    console.log(
        "[HC-REALMESH] baseline rim absolute side+",
        baselineRimAbsolute[0]!.map((v) => Number(v.toFixed(3))),
    );
    console.log(
        "[HC-REALMESH] baseline rim absolute side-",
        baselineRimAbsolute[1]!.map((v) => Number(v.toFixed(3))),
    );
});

describe("heel cup depth — real Default.glb mesh", () => {
    test("HC-3: depthDelta=0 reproduces baseline bit-identically", () => {
        const modified = runDepth(0);
        const modArr = modified.getAttribute("position")!.array as Float32Array;
        const maxDelta = maxVertexDeltaMm(baseArr, modArr, 0, frame.count);
        console.log("[HC-REALMESH] depth=0", {
            maxDelta,
            fingerprint: topologyFingerprint(modified),
        });
        expect(maxDelta).toBe(0);
        expect(topologyFingerprint(modified)).toBe(baseFingerprint);
        modified.dispose();
    });

    test("depth 3 / 8 / 15 mm: floor untouched, crease bounded, rim monotone, apex truthful", () => {
        for (const depthMm of DEPTH_SAMPLES_MM) {
            const modified = runDepth(depthMm);
            const modArr = modified.getAttribute("position")!.array as Float32Array;

            const floorDelta = floorRegionMaxDeltaMm(cls, frame, baseArr, modArr);
            const bottomDelta = maxVertexDeltaMm(baseArr, modArr, frame.topVertexCount, frame.count);
            const plantarDelta = plantarBottomMaxDeltaMm(baseArr, modArr, frame);
            const dihedral = wallBandMaxDihedralDeg(modified, cls, frame, baseArr);
            const split = maxCoincidentSplitMm(cls, frame, modArr);
            const { rise } = rimProfiles(cls, frame, baseArr, modArr);
            const apexDisp = maxVertexDeltaMm(baseArr, modArr, cls.apexIndex, cls.apexIndex + 1);

            console.log(`[HC-REALMESH] depth=${depthMm}`, {
                fingerprint: topologyFingerprint(modified) === baseFingerprint ? "identical" : "CHANGED",
                floorDelta,
                bottomDelta,
                plantarDelta,
                wallDihedralDeg: dihedral,
                baselineWallDihedralDeg,
                coincidentSplit: split,
                apexDisp,
                rimRiseMonotone: [isMonotoneDecreasing(rise[0]!), isMonotoneDecreasing(rise[1]!)],
            });
            console.log(
                `[HC-REALMESH] rim rise side+ depth=${depthMm}`,
                rise[0]!.map((v) => Number(v.toFixed(3))),
            );
            console.log(
                `[HC-REALMESH] rim rise side- depth=${depthMm}`,
                rise[1]!.map((v) => Number(v.toFixed(3))),
            );

            expect(topologyFingerprint(modified)).toBe(baseFingerprint);
            // HC-1: plantar band fixed; side wall may receive rim-conformity transfer.
            expect(plantarDelta).toBeLessThan(0.05);
            expect(floorDelta).toBeLessThan(FLOOR_MAX_DELTA_MM);
            expect(split).toBeLessThan(MAX_COINCIDENT_SPLIT_MM);
            expect(dihedral).toBeLessThanOrEqual(baselineWallDihedralDeg + CREASE_BUDGET_DEG);
            expect(Math.abs(apexDisp - depthMm)).toBeLessThanOrEqual(APEX_TOLERANCE_MM);
            expect(isMonotoneDecreasing(rise[0]!)).toBe(true);
            expect(isMonotoneDecreasing(rise[1]!)).toBe(true);
            modified.dispose();
        }
    });

    test("combined width+depth mid-values stays fold-free", () => {
        const modified = runDepth(5, { heelCupWidthMm: 5 });
        const modArr = modified.getAttribute("position")!.array as Float32Array;
        const dihedral = wallBandMaxDihedralDeg(modified, cls, frame, baseArr);
        const floorThick = floorRegionMaxThickDeltaMm(cls, frame, baseArr, modArr);
        const bottomDelta = maxVertexDeltaMm(baseArr, modArr, frame.topVertexCount, frame.count);
        const plantarDelta = plantarBottomMaxDeltaMm(baseArr, modArr, frame);
        console.log("[HC-REALMESH] combined width=5 depth=5", {
            wallDihedralDeg: dihedral,
            baselineWallDihedralDeg,
            floorThickDelta: floorThick,
            bottomDelta,
            plantarDelta,
        });
        expect(topologyFingerprint(modified)).toBe(baseFingerprint);
        expect(plantarDelta).toBeLessThan(0.05);
        expect(floorThick).toBeLessThan(FLOOR_MAX_DELTA_MM);
        expect(dihedral).toBeLessThanOrEqual(baselineWallDihedralDeg + CREASE_BUDGET_DEG);
        modified.dispose();
    });
});
