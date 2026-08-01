// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Fit parametric archHeightMm + apexMoveMm from a registered foot scan.
 *
 * Pipeline: sample plantar gaps → rigid-body residual decomposition →
 * medial-arch band filter → pure kernel solve (+ iterative refine) →
 * soft-tissue compliance → clinical clamp.
 *
 * Does NOT bake the scan into the insole mesh. Export stays scan-isolated.
 */

import type { BufferGeometry } from "three";
import * as THREE from "three";
import { CLINICAL_LIMITS } from "@/lib/geometry/clinical-constraints";
import { bump, type HeightFieldParams, heightAt, smoothstep } from "@/lib/geometry/height-field";
import { SCAN_FIT_ARCH_COMPLIANCE, SCAN_FIT_MIN_SAMPLES } from "@/lib/geometry/scan-fit-constants";
import { iterativeRefineScalar } from "@/lib/geometry/scan-fit-kernel";
import { buildProfileStations, solveArchProfile } from "@/lib/geometry/scan-fit-profile";
import {
    type BandedGapSample,
    type ConfidenceTier,
    confidenceFromRms,
    decomposeRigidGapBanded,
    type FitConfidence,
    type GapSample,
    gapsEntirelyNegative,
    type RegistrationFitFlags,
    registrationFlagsFromRigid,
    subtractRigidGap,
} from "@/lib/geometry/scan-fit-residual";
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
/** @deprecated use SCAN_FIT_MIN_SAMPLES — kept for callers/tests. */
export const ARCH_FIT_MIN_SAMPLES = SCAN_FIT_MIN_SAMPLES;

export type ArchFitErrorCode =
    | "no_registration"
    | "no_reference"
    | "insufficient_samples"
    | "degenerate_weight"
    | "registration_residual"
    | "negative_gap_field";

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
    archFillMm: number;
    apexMoveMm: number;
    /** Peak measured plantar gap (scan above reference) before compliance. */
    peakGapMm: number;
    /** Longitudinal u of the peak gap sample. */
    apexU: number;
    sampleCount: number;
    /** Post-fit residual RMS (mm). */
    residualRmsMm: number;
    clamped: boolean;
    confidence: FitConfidence;
    /** Iterative refine did not meet convergence criteria within max iters. */
    nonConverged: boolean;
    /** Amplitude before compliance — hard clinical gate uses this. */
    amplitudePreComplianceMm: number;
    solveMode: "profile" | "scalar_fallback";
    stationResidualsMm: number[];
    stationUs: number[];
    basisCosine: number;
    forefootToRearfootDeg: number;
    heelRollDeg: number;
    forefootRollDeg: number;
    rigidWarnings: string[];
};

export type ArchFitReference =
    | {
          kind: "base";
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

export type { ConfidenceTier, FitConfidence, RegistrationFitFlags };

type Bucket = { indices: number[] };

type PlantarPoint = GapSample & { u: number; vSigned: number };

function buildXyBuckets(
    positions: ArrayLike<number>,
    topN: number,
    cellMm: number,
): { buckets: Map<string, Bucket>; minX: number; minY: number; cellMm: number } {
    let minX = Infinity;
    let minY = Infinity;
    for (let i = 0; i < topN; i++) {
        const x = positions[i * 3] ?? 0;
        const y = positions[i * 3 + 1] ?? 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
    }
    const buckets = new Map<string, Bucket>();
    for (let i = 0; i < topN; i++) {
        const ix = Math.floor(((positions[i * 3] ?? 0) - minX) / cellMm);
        const iy = Math.floor(((positions[i * 3 + 1] ?? 0) - minY) / cellMm);
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
                    const px = positions[i * 3] ?? 0;
                    const py = positions[i * 3 + 1] ?? 0;
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

function clampArch(
    height: number,
    fill: number,
    apex: number,
): {
    archHeightMm: number;
    archFillMm: number;
    apexMoveMm: number;
    clamped: boolean;
} {
    const hLim = CLINICAL_LIMITS.archHeightMm;
    const fLim = CLINICAL_LIMITS.archFillMm;
    const aLim = CLINICAL_LIMITS.apexMoveMm;
    const heightRounded = Math.round(height * 10) / 10;
    const fillRounded = Math.round(fill * 10) / 10;
    const apexRounded = Math.round(apex * 10) / 10;
    const archHeightMm = Math.max(hLim.min, Math.min(hLim.max, heightRounded));
    const archFillMm = Math.max(fLim.min, Math.min(fLim.max, fillRounded));
    const apexMoveMm = Math.max(aLim.min, Math.min(aLim.max, apexRounded));
    const clamped =
        archHeightMm !== heightRounded || archFillMm !== fillRounded || apexMoveMm !== apexRounded;
    return { archHeightMm, archFillMm, apexMoveMm, clamped };
}

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
        const x = arr[i * 3] ?? 0;
        const y = arr[i * 3 + 1] ?? 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return {
        kind: "base",
        topPositions: arr,
        topVertexCount: topN,
        lengthMin: minX,
        lengthSize: Math.max(1e-6, maxX - minX),
        widthCenter: (minY + maxY) / 2,
        widthHalf: Math.max(1e-6, (maxY - minY) / 2),
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
    const bx = ref.topPositions[index * 3] ?? 0;
    const by = ref.topPositions[index * 3 + 1] ?? 0;
    const bz = ref.topPositions[index * 3 + 2] ?? 0;
    const u = Math.max(0, Math.min(1, (bx - ref.lengthMin) / ref.lengthSize));
    const vSigned = Math.max(-1, Math.min(1, (by - ref.widthCenter) / ref.widthHalf));
    return { z: bz, u, vSigned, ok: true };
}

/** Collect full-footprint plantar gap samples (all bands) for rigid-body solve. */
export function collectPlantarGapSamples(args: {
    scanPositions: ArrayLike<number>;
    scanVertexCount: number;
    scanToBase: THREE.Matrix4;
    reference: ArchFitReference;
}): PlantarPoint[] {
    const { scanPositions, scanVertexCount, scanToBase, reference } = args;
    const buckets =
        reference.kind === "base"
            ? buildXyBuckets(reference.topPositions, reference.topVertexCount, 4)
            : null;

    const plantarBins = new Map<string, { x: number; y: number; z: number }>();
    const cell = 4;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < scanVertexCount; i++) {
        tmp.set(
            scanPositions[i * 3] ?? 0,
            scanPositions[i * 3 + 1] ?? 0,
            scanPositions[i * 3 + 2] ?? 0,
        ).applyMatrix4(scanToBase);
        const key = `${Math.floor(tmp.x / cell)},${Math.floor(tmp.y / cell)}`;
        const prev = plantarBins.get(key);
        if (!prev || tmp.z < prev.z) {
            plantarBins.set(key, { x: tmp.x, y: tmp.y, z: tmp.z });
        }
    }

    const out: PlantarPoint[] = [];
    for (const p of plantarBins.values()) {
        const hit = referenceZAt(p.x, p.y, reference, buckets);
        if (!hit.ok) continue;
        out.push({
            x: p.x,
            y: p.y,
            gapMm: p.z - hit.z,
            u: hit.u,
            vSigned: hit.vSigned,
        });
    }
    return out;
}

/**
 * Fit archHeightMm + apexMoveMm (+ archFillMm) from scan geometry already
 * pose-aligned to the reference (scan verts × scanToBase → reference local).
 *
 * Pipeline: plantar gaps → anatomically-banded rigid residual → multi-station
 * profile solve (fallback: scalar) → compliance once on composite → clamp.
 */
export function fitArchParamsFromScan(args: {
    scanPositions: ArrayLike<number>;
    scanVertexCount: number;
    scanToBase: THREE.Matrix4;
    reference: ArchFitReference;
    side: Side;
    lengthMm: number;
}): ArchFitResult {
    const { scanPositions, scanVertexCount, scanToBase, reference, side, lengthMm } = args;
    if (scanVertexCount < 3) {
        throw new ArchFitError("insufficient_samples", "Scan has too few vertices");
    }

    const allPlantar = collectPlantarGapSamples({
        scanPositions,
        scanVertexCount,
        scanToBase,
        reference,
    });
    if (allPlantar.length < SCAN_FIT_MIN_SAMPLES) {
        throw new ArchFitError(
            "insufficient_samples",
            `Need ≥${SCAN_FIT_MIN_SAMPLES} plantar samples (got ${allPlantar.length})`,
        );
    }
    if (gapsEntirelyNegative(allPlantar)) {
        throw new ArchFitError(
            "negative_gap_field",
            "Scan sits entirely below the base — re-run alignment or check Left/Right",
        );
    }

    const banded: BandedGapSample[] = allPlantar.map((p) => ({
        x: p.x,
        y: p.y,
        gapMm: p.gapMm,
        u: p.u,
        vSigned: p.vSigned,
    }));

    const rigid = decomposeRigidGapBanded(banded, side);
    if (!rigid) {
        throw new ArchFitError("degenerate_weight", "Could not decompose registration residual");
    }
    const regFlags = registrationFlagsFromRigid(rigid);
    const corrected = subtractRigidGap(allPlantar, rigid);
    const correctedPlantar: PlantarPoint[] = corrected.map((c, i) => ({
        ...c,
        u: allPlantar[i]!.u,
        vSigned: allPlantar[i]!.vSigned,
    }));

    const medialSign = side === "left" ? -1 : 1;
    // Profile stations use all medial arch-band samples (including small/negative
    // residuals) so the joint solve sees the true contour; scalar fallback still
    // prefers positive gaps.
    const archSamples = correctedPlantar.filter((p) => {
        if (p.u < ARCH_FIT_U_MIN || p.u > ARCH_FIT_U_MAX) return false;
        const m = -(p.vSigned * medialSign);
        return m >= ARCH_FIT_MEDIAL_MIN;
    });

    const stations = buildProfileStations(archSamples, side);
    const profile = solveArchProfile({
        stations,
        samples: archSamples,
        side,
        lengthMm,
        applyCompliance: true,
    });

    let peakGapMm = 0;
    for (const p of archSamples) {
        if (p.gapMm > peakGapMm) peakGapMm = p.gapMm;
    }

    if (profile) {
        const confidence = confidenceFromRms(profile.residualRmsMm, regFlags, false, rigid.pitchFallbackUsed);
        return {
            archHeightMm: profile.archHeightMm,
            archFillMm: profile.archFillMm,
            apexMoveMm: profile.apexMoveMm,
            peakGapMm,
            apexU: ARCH_DEFAULT_APEX_U + profile.apexMoveMm / lengthMm,
            sampleCount: profile.sampleCount,
            residualRmsMm: profile.residualRmsMm,
            clamped: profile.clamped,
            confidence,
            nonConverged: false,
            amplitudePreComplianceMm: profile.amplitudePreComplianceMm,
            solveMode: "profile",
            stationResidualsMm: profile.stationResidualsMm,
            stationUs: profile.stationUs,
            basisCosine: profile.basisCosine,
            forefootToRearfootDeg: rigid.forefootToRearfootDeg,
            heelRollDeg: rigid.heelRollDeg,
            forefootRollDeg: rigid.forefootRollDeg,
            rigidWarnings: rigid.warnings,
        };
    }

    // Scalar fallback (#139 path) when stations are insufficient.
    const band = archSamples.filter((p) => p.gapMm >= 0.25);
    if (band.length < SCAN_FIT_MIN_SAMPLES) {
        throw new ArchFitError(
            "insufficient_samples",
            `insufficient scan coverage in arch (need ≥${SCAN_FIT_MIN_SAMPLES}, got ${band.length}); profile stations also insufficient`,
        );
    }

    const byGap = [...band].sort((a, b) => b.gapMm - a.gapMm);
    const topN = Math.max(1, Math.floor(byGap.length * 0.1));
    let apexU = 0;
    for (let i = 0; i < topN; i++) {
        const g = byGap[i];
        if (!g) continue;
        apexU += g.u;
        peakGapMm = Math.max(peakGapMm, g.gapMm);
    }
    apexU /= topN;
    const apexMoveRaw = (apexU - ARCH_DEFAULT_APEX_U) * lengthMm;
    const apexClamped = clampArch(0, 0, apexMoveRaw).apexMoveMm;

    // Pre-compliance amplitude for the hard gate / reporting.
    const refineRaw = iterativeRefineScalar({
        gaps: band.map((p) => ({ gapMm: p.gapMm })),
        weightAt: (index) =>
            unitArchWeight(band[index]!.u, band[index]!.vSigned, side, lengthMm, apexClamped),
        initialValue: 0,
        compliance: 1,
        minSamples: SCAN_FIT_MIN_SAMPLES,
    });
    if (!refineRaw) {
        throw new ArchFitError("degenerate_weight", "Arch dome weight vanished in the sample band");
    }
    const amplitudePreComplianceMm = refineRaw.value;
    const heightPost = amplitudePreComplianceMm * SCAN_FIT_ARCH_COMPLIANCE;
    const { archHeightMm, archFillMm, apexMoveMm, clamped } = clampArch(heightPost, 0, apexMoveRaw);
    const confidence = confidenceFromRms(
        refineRaw.residualRmsMm,
        regFlags,
        !refineRaw.converged,
        rigid.pitchFallbackUsed,
    );

    return {
        archHeightMm,
        archFillMm,
        apexMoveMm,
        peakGapMm,
        apexU,
        sampleCount: refineRaw.sampleCount,
        residualRmsMm: refineRaw.residualRmsMm,
        clamped,
        confidence,
        nonConverged: !refineRaw.converged,
        amplitudePreComplianceMm,
        solveMode: "scalar_fallback",
        stationResidualsMm: [],
        stationUs: [],
        basisCosine: 1,
        forefootToRearfootDeg: rigid.forefootToRearfootDeg,
        heelRollDeg: rigid.heelRollDeg,
        forefootRollDeg: rigid.forefootRollDeg,
        rigidWarnings: [...rigid.warnings, "Profile stations insufficient — fell back to scalar arch fit"],
    };
}

/**
 * Patch for SideCorrections. archFillMm is a fitted profile parameter
 * (multi-station joint solve), not a compliance stand-in — compliance is
 * applied once to the composite amplitude inside the fit.
 */
export function archFitToCorrectionPatch(fit: ArchFitResult): Partial<SideCorrections> {
    return {
        archHeightMm: fit.archHeightMm,
        apexMoveMm: fit.apexMoveMm,
        archFillMm: fit.archFillMm,
    };
}

/** Whether the UI may auto-apply this arch fit into design corrections. */
export function canAutoApplyArchFit(fit: ArchFitResult): boolean {
    return fit.confidence.tier === "good" && !fit.confidence.registration.blockAutoApply;
}
