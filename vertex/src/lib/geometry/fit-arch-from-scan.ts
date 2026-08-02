// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Fit parametric archHeightMm + apexMoveMm from a registered foot scan.
 *
 * This does NOT bake the scan into the insole mesh. It measures the plantar
 * gap of the scan against a reference top surface (RAW base or parametric
 * zero-arch field) and solves for the two scalar arch operators that best
 * close that gap in the medial midfoot. Result is applied via design
 * corrections — the scan store stays off the export path.
 */

import type { BufferGeometry } from "three";
import * as THREE from "three";
import { CLINICAL_LIMITS } from "@/lib/geometry/clinical-constraints";
import { bump, type HeightFieldParams, heightAt, smoothstep } from "@/lib/geometry/height-field";
import type { Side, SideCorrections } from "@/types";

/** Longitudinal band where the medial arch dome lives (heel→toe u). */
export const ARCH_FIT_U_MIN = 0.28;
export const ARCH_FIT_U_MAX = 0.58;
/** Default apex centre before apexMoveMm (matches height-field.ts). */
export const ARCH_DEFAULT_APEX_U = 0.42;
/** Require clear medial emphasis (smoothstep medialBlend domain). */
export const ARCH_FIT_MEDIAL_MIN = 0.2;
/** Ignore samples whose XY nearest-ref distance exceeds this (mm). */
export const ARCH_FIT_MAX_XY_MM = 8;
/** Minimum plantar samples required for a fit. */
export const ARCH_FIT_MIN_SAMPLES = 24;
/**
 * Soft-tissue / NWB clearance subtracted from measured plantar gaps before the
 * LS arch solve. Full gap closure overbuilds shells from unloaded scans.
 */
export const ARCH_FIT_CLEARANCE_MM = 1.5;

export type ArchFitErrorCode =
    | "no_registration"
    | "no_reference"
    | "insufficient_samples"
    | "degenerate_weight";

export class ArchFitError extends Error {
    readonly code: ArchFitErrorCode;

    constructor(code: ArchFitErrorCode, message: string) {
        super(message);
        this.name = "ArchFitError";
        this.code = code;
    }
}

export type ArchFitResult = {
    archHeightMm: number;
    apexMoveMm: number;
    /** Peak measured plantar gap (scan above reference) before clamp. */
    peakGapMm: number;
    /** Longitudinal u of the peak gap sample. */
    apexU: number;
    sampleCount: number;
    /** RMS residual of (weight · archHeight − gap) after fit (mm). */
    residualRmsMm: number;
    clamped: boolean;
};

export type ArchFitReference =
    | {
          kind: "base";
          /** RAW L0 top positions (xyz interleaved). */
          topPositions: ArrayLike<number>;
          topVertexCount: number;
          lengthMin: number;
          lengthSize: number;
          widthCenter: number;
          widthHalf: number;
      }
    | {
          kind: "parametric";
          field: HeightFieldParams;
      };

type Bucket = { indices: number[] };

function buildXyBuckets(
    positions: ArrayLike<number>,
    topN: number,
    cellMm: number,
): { buckets: Map<string, Bucket>; minX: number; minY: number; cellMm: number } {
    let minX = Infinity;
    let minY = Infinity;
    for (let i = 0; i < topN; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
    }
    const buckets = new Map<string, Bucket>();
    for (let i = 0; i < topN; i++) {
        const ix = Math.floor((positions[i * 3]! - minX) / cellMm);
        const iy = Math.floor((positions[i * 3 + 1]! - minY) / cellMm);
        const key = `${ix},${iy}`;
        let b = buckets.get(key);
        if (!b) {
            b = { indices: [] };
            buckets.set(key, b);
        }
        b.indices.push(i);
    }
    return { buckets, minX, minY, cellMm };
}

function nearestXyIndex(
    x: number,
    y: number,
    positions: ArrayLike<number>,
    buckets: Map<string, Bucket>,
    minX: number,
    minY: number,
    cellMm: number,
): { index: number; d2: number } {
    const ix = Math.floor((x - minX) / cellMm);
    const iy = Math.floor((y - minY) / cellMm);
    let best = -1;
    let bestD2 = Infinity;
    for (let ring = 0; ring <= 4; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
            for (let dy = -ring; dy <= ring; dy++) {
                if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                const b = buckets.get(`${ix + dx},${iy + dy}`);
                if (!b) continue;
                for (const i of b.indices) {
                    const px = positions[i * 3]!;
                    const py = positions[i * 3 + 1]!;
                    const d2 = (px - x) ** 2 + (py - y) ** 2;
                    if (d2 < bestD2) {
                        bestD2 = d2;
                        best = i;
                    }
                }
            }
        }
        if (best >= 0 && ring >= 1) break;
    }
    return { index: best, d2: bestD2 };
}

/** Unit arch-dome contribution at (u, vSigned) — matches height-field arch term × feather. */
export function unitArchWeight(
    u: number,
    vSigned: number,
    side: Side,
    lengthMm: number,
    apexMoveMm: number,
): number {
    const medialSign = side === "left" ? -1 : 1;
    const av = Math.abs(vSigned);
    const m = -(vSigned * medialSign);
    const medialBlend = smoothstep(-0.2, 0.45, m);
    const apexCenter = ARCH_DEFAULT_APEX_U + apexMoveMm / lengthMm;
    const arch = bump(u, apexCenter, 0.36);
    const archAcross = medialBlend * (0.45 + 0.55 * smoothstep(0.05, 0.9, av));
    const edgeFeather = smoothstep(1.0, 0.86, av);
    const featherScale = 0.35 + 0.65 * edgeFeather;
    return arch * archAcross * featherScale;
}

type Sample = { u: number; vSigned: number; gapMm: number; weight: number };

function clampArch(
    height: number,
    apex: number,
): {
    archHeightMm: number;
    apexMoveMm: number;
    clamped: boolean;
} {
    const hLim = CLINICAL_LIMITS.archHeightMm;
    const aLim = CLINICAL_LIMITS.apexMoveMm;
    const heightRounded = Math.round(height * 10) / 10;
    const apexRounded = Math.round(apex * 10) / 10;
    const archHeightMm = Math.max(hLim.min, Math.min(hLim.max, heightRounded));
    const apexMoveMm = Math.max(aLim.min, Math.min(aLim.max, apexRounded));
    const clamped = archHeightMm !== heightRounded || apexMoveMm !== apexRounded;
    return { archHeightMm, apexMoveMm, clamped };
}

/**
 * Build RAW-base reference extents from a multi-mesh (or single) base geometry.
 * Uses X as length and Y as width — same convention as registration / viewer local.
 */
export function archFitReferenceFromBase(geometry: BufferGeometry): ArchFitReference {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 3) {
        throw new ArchFitError("no_reference", "Base geometry has no positions");
    }
    const ud = geometry.userData as { topVertexCount?: number };
    const topN =
        typeof ud.topVertexCount === "number" && ud.topVertexCount > 0 ? ud.topVertexCount : pos.count;
    const arr = pos.array as ArrayLike<number>;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < topN; i++) {
        const x = arr[i * 3]!;
        const y = arr[i * 3 + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const lengthSize = Math.max(1e-6, maxX - minX);
    const widthHalf = Math.max(1e-6, (maxY - minY) / 2);
    return {
        kind: "base",
        topPositions: arr,
        topVertexCount: topN,
        lengthMin: minX,
        lengthSize,
        widthCenter: (minY + maxY) / 2,
        widthHalf,
    };
}

function referenceZAt(
    x: number,
    y: number,
    ref: ArchFitReference,
    buckets: { buckets: Map<string, Bucket>; minX: number; minY: number; cellMm: number } | null,
): { z: number; u: number; vSigned: number; ok: boolean } {
    if (ref.kind === "parametric") {
        const { lengthMm, widthMm } = ref.field;
        const u = Math.max(0, Math.min(1, x / lengthMm));
        const halfW = widthMm / 2;
        const vSigned = halfW > 1e-9 ? Math.max(-1, Math.min(1, y / halfW)) : 0;
        // Zero-arch reference so the fit attributes raise entirely to archHeightMm.
        const zeroArch: HeightFieldParams = {
            ...ref.field,
            corrections: {
                ...ref.field.corrections,
                archHeightMm: 0,
                archFillMm: 0,
                apexMoveMm: 0,
            },
        };
        return { z: heightAt(u, vSigned, zeroArch), u, vSigned, ok: true };
    }
    if (!buckets) return { z: 0, u: 0, vSigned: 0, ok: false };
    const { index, d2 } = nearestXyIndex(
        x,
        y,
        ref.topPositions,
        buckets.buckets,
        buckets.minX,
        buckets.minY,
        buckets.cellMm,
    );
    if (index < 0 || d2 > ARCH_FIT_MAX_XY_MM * ARCH_FIT_MAX_XY_MM) {
        return { z: 0, u: 0, vSigned: 0, ok: false };
    }
    const bx = ref.topPositions[index * 3]!;
    const by = ref.topPositions[index * 3 + 1]!;
    const bz = ref.topPositions[index * 3 + 2]!;
    const u = Math.max(0, Math.min(1, (bx - ref.lengthMin) / ref.lengthSize));
    const vSigned = Math.max(-1, Math.min(1, (by - ref.widthCenter) / ref.widthHalf));
    return { z: bz, u, vSigned, ok: true };
}

/**
 * Fit archHeightMm + apexMoveMm from scan geometry already pose-aligned to the
 * reference (scan verts × scanToBase → reference local).
 */
export function fitArchParamsFromScan(args: {
    scanPositions: ArrayLike<number>;
    scanVertexCount: number;
    scanToBase: THREE.Matrix4;
    reference: ArchFitReference;
    side: Side;
    /** Sized insole length — must match height-field / design layout lengthMm. */
    lengthMm: number;
    /**
     * Tissue clearance (mm) removed from each positive gap before the solve.
     * Defaults to {@link ARCH_FIT_CLEARANCE_MM}. Pass 0 for tests that recover
     * a synthetic gap exactly.
     */
    clearanceMm?: number;
}): ArchFitResult {
    const { scanPositions, scanVertexCount, scanToBase, reference, side, lengthMm } = args;
    const clearanceMm =
        args.clearanceMm !== undefined ? Math.max(0, args.clearanceMm) : ARCH_FIT_CLEARANCE_MM;
    if (scanVertexCount < 3) {
        throw new ArchFitError("insufficient_samples", "Scan has too few vertices");
    }

    const buckets =
        reference.kind === "base"
            ? buildXyBuckets(reference.topPositions, reference.topVertexCount, 4)
            : null;

    // Per-XY plantar: keep lowest Z in each ~4 mm cell (avoids dorsal verts).
    const plantarBins = new Map<string, { x: number; y: number; z: number }>();
    const cell = 4;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < scanVertexCount; i++) {
        tmp.set(scanPositions[i * 3]!, scanPositions[i * 3 + 1]!, scanPositions[i * 3 + 2]!).applyMatrix4(
            scanToBase,
        );
        const key = `${Math.floor(tmp.x / cell)},${Math.floor(tmp.y / cell)}`;
        const prev = plantarBins.get(key);
        if (!prev || tmp.z < prev.z) {
            plantarBins.set(key, { x: tmp.x, y: tmp.y, z: tmp.z });
        }
    }

    const medialSign = side === "left" ? -1 : 1;
    const gaps: { u: number; vSigned: number; gapMm: number }[] = [];
    for (const p of plantarBins.values()) {
        const hit = referenceZAt(p.x, p.y, reference, buckets);
        if (!hit.ok) continue;
        if (hit.u < ARCH_FIT_U_MIN || hit.u > ARCH_FIT_U_MAX) continue;
        const m = -(hit.vSigned * medialSign);
        if (m < ARCH_FIT_MEDIAL_MIN) continue;
        const gapMm = p.z - hit.z;
        // Only positive gaps (scan above reference) drive arch raise.
        if (gapMm < 0.25) continue;
        gaps.push({ u: hit.u, vSigned: hit.vSigned, gapMm });
    }

    if (gaps.length < ARCH_FIT_MIN_SAMPLES) {
        throw new ArchFitError(
            "insufficient_samples",
            gaps.length === 0
                ? "No positive medial arch gap — scan plantar surface is at or below the base in the midfoot (check registration / markers)"
                : `Need ≥${ARCH_FIT_MIN_SAMPLES} medial midfoot plantar samples with positive gap (got ${gaps.length})`,
        );
    }

    // Apex = mean u of the top 10% raw gaps (robust to single outliers).
    const byGap = [...gaps].sort((a, b) => b.gapMm - a.gapMm);
    const topN = Math.max(1, Math.floor(byGap.length * 0.1));
    let apexU = 0;
    let peakGapMm = 0;
    for (let i = 0; i < topN; i++) {
        const g = byGap[i];
        if (!g) continue;
        apexU += g.u;
        peakGapMm = Math.max(peakGapMm, g.gapMm);
    }
    apexU /= topN;
    const apexMoveRaw = (apexU - ARCH_DEFAULT_APEX_U) * lengthMm;

    // Fit against clearance-adjusted gaps so NWB scans do not overbuild.
    const fitGaps = gaps.map((g) => ({ ...g, gapMm: g.gapMm - clearanceMm })).filter((g) => g.gapMm >= 0.25);
    if (fitGaps.length < ARCH_FIT_MIN_SAMPLES) {
        throw new ArchFitError(
            "insufficient_samples",
            `Need ≥${ARCH_FIT_MIN_SAMPLES} medial midfoot samples after ${clearanceMm.toFixed(1)} mm clearance (got ${fitGaps.length})`,
        );
    }

    // Least-squares arch height against unit dome weights at fitted apex.
    let swg = 0;
    let sww = 0;
    const samples: Sample[] = [];
    for (const g of fitGaps) {
        const w = unitArchWeight(g.u, g.vSigned, side, lengthMm, apexMoveRaw);
        if (w < 0.05) continue;
        samples.push({ ...g, weight: w });
        swg += w * g.gapMm;
        sww += w * w;
    }
    if (samples.length < ARCH_FIT_MIN_SAMPLES || sww < 1e-6) {
        throw new ArchFitError("degenerate_weight", "Arch dome weight vanished in the sample band");
    }
    const heightRaw = swg / sww;

    const { archHeightMm, apexMoveMm, clamped } = clampArch(heightRaw, apexMoveRaw);

    let err2 = 0;
    for (const s of samples) {
        const w = unitArchWeight(s.u, s.vSigned, side, lengthMm, apexMoveMm);
        const r = w * archHeightMm - s.gapMm;
        err2 += r * r;
    }
    const residualRmsMm = Math.sqrt(err2 / samples.length);

    return {
        archHeightMm,
        apexMoveMm,
        peakGapMm,
        apexU,
        sampleCount: samples.length,
        residualRmsMm,
        clamped,
    };
}

/** Patch to apply on SideCorrections — parks total raise in archHeightMm. */
export function archFitToCorrectionPatch(fit: ArchFitResult): Partial<SideCorrections> {
    return {
        archHeightMm: fit.archHeightMm,
        apexMoveMm: fit.apexMoveMm,
        // Avoid double-counting fill vs the fitted dome height.
        archFillMm: 0,
    };
}
