// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Matrix4 } from "three";
import { medialSign } from "@/lib/pressure-map/placement";
import type { Side } from "@/types";
import { meshCentroid } from "./mesh-ops";
import { applyMatrix } from "./orient";
import type {
    AfoAnatomicalLandmarkId,
    AfoPlantarPointId,
    AfoScanDerived,
    AfoScanWorkflow,
    AfoTriMesh,
    AfoVec3,
} from "./types";

export const AFO_PLANTAR_MIN_SPAN_MM = 40;
export const AFO_FOREFOOT_WARN_DEG = 5;
export const AFO_SHANK_WARN_DEG = 5;
/** Planned proximal trim sits this far distal to the fibular head (approved 20–25 mm). */
export const AFO_PROXIMAL_TRIM_OFFSET_MM = 22;
export const AFO_PROXIMAL_TRIM_CLOSE_MM = 20;
/** Lateral malleolus is expected about this far below the medial. Warn when it is not clearly lower. */
export const AFO_LATERAL_MALLEOLUS_DROP_MM = 10;

export const AFO_PLANTAR_STEPS: readonly { id: AfoPlantarPointId; label: string }[] = [
    { id: "heel", label: "Plantar heel center" },
    { id: "m1p", label: "Plantar 1st met head" },
    { id: "m5p", label: "Plantar 5th met head" },
];

export const AFO_LANDMARK_STEPS: readonly { id: AfoAnatomicalLandmarkId; label: string }[] = [
    { id: "posterior_calcaneus", label: "Posterior calcaneus center" },
    { id: "m1_mpj", label: "M1 medial 1st MPJ prominence" },
    { id: "m5_mpj", label: "M5 lateral 5th MPJ prominence" },
    { id: "navicular", label: "Navicular tuberosity" },
    { id: "fifth_met_base", label: "5th met base (styloid)" },
    { id: "medial_malleolus", label: "Medial malleolus" },
    { id: "lateral_malleolus", label: "Lateral malleolus" },
    { id: "fibular_head", label: "Fibular head" },
];

export const AFO_PLANNED_RELIEFS_MM = { malleoli: -3, navicular: -2, styloid: -2 } as const;

export class PlantarFrameError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PlantarFrameError";
    }
}

/**
 * Scan frame after Stage 1.
 * `yAxis` is medial for both feet (`medialSign`). `geometricY` is Z × X and stays
 * right-handed with `xAxis` and `zAxis`, so the mesh orient is a proper rotation.
 */
export interface PlantarFrame {
    origin: AfoVec3;
    xAxis: AfoVec3;
    yAxis: AfoVec3;
    zAxis: AfoVec3;
    geometricY: AfoVec3;
    medialSign: 1 | -1;
}

export interface PlantarAlignment {
    frame: PlantarFrame;
    /** Forefoot met line vs the heel–met long axis, degrees. Independent of Level to rearfoot. */
    forefootToRearfootDeg: number;
    matrixElements: number[];
    mesh: AfoTriMesh;
}

function add(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: AfoVec3, s: number): AfoVec3 {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: AfoVec3, b: AfoVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function len(a: AfoVec3): number {
    return Math.hypot(a.x, a.y, a.z);
}

function norm(a: AfoVec3): AfoVec3 {
    const l = len(a);
    if (l < 1e-8) return { x: 0, y: 0, z: 0 };
    return scale(a, 1 / l);
}

function mid(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return scale(add(a, b), 0.5);
}

export function transformAfoPoint(p: AfoVec3, e: number[]): AfoVec3 {
    const w = (e[3] ?? 0) * p.x + (e[7] ?? 0) * p.y + (e[11] ?? 0) * p.z + (e[15] ?? 1);
    const inv = Math.abs(w) > 1e-12 ? 1 / w : 1;
    return {
        x: ((e[0] ?? 0) * p.x + (e[4] ?? 0) * p.y + (e[8] ?? 0) * p.z + (e[12] ?? 0)) * inv,
        y: ((e[1] ?? 0) * p.x + (e[5] ?? 0) * p.y + (e[9] ?? 0) * p.z + (e[13] ?? 0)) * inv,
        z: ((e[2] ?? 0) * p.x + (e[6] ?? 0) * p.y + (e[10] ?? 0) * p.z + (e[14] ?? 0)) * inv,
    };
}

export function invertMatrixElements(elements: number[]): number[] {
    return new Matrix4().fromArray(elements).invert().elements.slice();
}

/** Proper rigid map: heel → origin, anterior → +X, up → +Z. Geometric Y → +Y. */
export function frameMatrixElements(frame: PlantarFrame): number[] {
    const o = frame.origin;
    const x = frame.xAxis;
    const y = frame.geometricY;
    const z = frame.zAxis;
    return [x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, -dot(x, o), -dot(y, o), -dot(z, o), 1];
}

function projectOnPlane(v: AfoVec3, normal: AfoVec3): AfoVec3 {
    return sub(v, scale(normal, dot(v, normal)));
}

/**
 * Plantar tripod frame.
 * Origin = heel. Z = plane normal, pointing with `upHint`. X = heel toward the met
 * midpoint (or `longitudinalTarget`), projected onto the plane. Y = medialSign × (Z × X).
 */
export function buildPlantarFrame(
    heel: AfoVec3,
    m1p: AfoVec3,
    m5p: AfoVec3,
    side: Side,
    upHint: AfoVec3,
    longitudinalTarget?: AfoVec3,
): PlantarFrame {
    const heelToM1 = len(sub(m1p, heel));
    const heelToM5 = len(sub(m5p, heel));
    const metSpan = len(sub(m1p, m5p));
    if (
        heelToM1 < AFO_PLANTAR_MIN_SPAN_MM ||
        heelToM5 < AFO_PLANTAR_MIN_SPAN_MM ||
        metSpan < AFO_PLANTAR_MIN_SPAN_MM
    ) {
        throw new PlantarFrameError(
            `Plantar triangle must span at least ${AFO_PLANTAR_MIN_SPAN_MM} mm (heel–M1p ${heelToM1.toFixed(0)} mm, heel–M5p ${heelToM5.toFixed(0)} mm, M1p–M5p ${metSpan.toFixed(0)} mm).`,
        );
    }

    const rawNormal = cross(sub(m1p, heel), sub(m5p, heel));
    if (len(rawNormal) < 1e-4) {
        throw new PlantarFrameError("Plantar points are collinear.");
    }
    let zAxis = norm(rawNormal);
    const hint = len(upHint) > 1e-6 ? upHint : { x: 0, y: 0, z: 1 };
    if (dot(zAxis, hint) < 0) zAxis = scale(zAxis, -1);

    const metMid = mid(m1p, m5p);
    const foreX = projectOnPlane(sub(metMid, heel), zAxis);
    if (len(foreX) < 1e-4) {
        throw new PlantarFrameError("Plantar points do not define a heel-to-forefoot direction.");
    }
    const sign = medialSign(side);
    const foreAxis = norm(foreX);
    const foreGeometricY = norm(cross(zAxis, foreAxis));
    const foreMedial = scale(foreGeometricY, sign);
    if (dot(foreMedial, sub(m1p, m5p)) <= 0) {
        throw new PlantarFrameError(
            `M1p is not medial of M5p for the ${side} foot. Check the side and the two metatarsal heads.`,
        );
    }

    let xAxis = foreAxis;
    if (longitudinalTarget) {
        const aimed = projectOnPlane(sub(longitudinalTarget, heel), zAxis);
        if (len(aimed) < 5) {
            throw new PlantarFrameError(
                "The malleolar midpoint is too close to the heel to level the rearfoot.",
            );
        }
        const aimedN = norm(aimed);
        if (dot(aimedN, foreAxis) <= 0) {
            throw new PlantarFrameError(
                "The malleolar midpoint is behind the heel, so the rearfoot cannot be leveled.",
            );
        }
        xAxis = aimedN;
    }
    const geometricY = norm(cross(zAxis, xAxis));
    return {
        origin: { ...heel },
        xAxis,
        yAxis: scale(geometricY, sign),
        zAxis,
        geometricY,
        medialSign: sign,
    };
}

/** Absolute angle of the M1p–M5p line away from the medial-lateral axis. 0° is square to the long axis. */
export function forefootToRearfootDeg(m1p: AfoVec3, m5p: AfoVec3, frame: PlantarFrame): number {
    const met = sub(m1p, m5p);
    const along = dot(met, frame.xAxis);
    const across = dot(met, frame.yAxis);
    return Math.abs((Math.atan2(along, across) * 180) / Math.PI);
}

export function meshUpHint(mesh: AfoTriMesh, heel: AfoVec3): AfoVec3 {
    return sub(meshCentroid(mesh), heel);
}

export function alignScanToPlantarFrame(
    meshMm: AfoTriMesh,
    plantar: { heel: AfoVec3; m1p: AfoVec3; m5p: AfoVec3 },
    side: Side,
    longitudinalTarget?: AfoVec3,
): PlantarAlignment {
    const up = meshUpHint(meshMm, plantar.heel);
    const fore = buildPlantarFrame(plantar.heel, plantar.m1p, plantar.m5p, side, up);
    const angle = forefootToRearfootDeg(plantar.m1p, plantar.m5p, fore);
    const frame = longitudinalTarget
        ? buildPlantarFrame(plantar.heel, plantar.m1p, plantar.m5p, side, up, longitudinalTarget)
        : fore;
    const matrixElements = frameMatrixElements(frame);
    const mesh = {
        positions: new Float32Array(meshMm.positions),
        indices: meshMm.indices,
    };
    applyMatrix(mesh, new Matrix4().fromArray(matrixElements));
    return { frame, forefootToRearfootDeg: angle, matrixElements, mesh };
}

export function proximalTrimWarning(offsetMm: number): string | null {
    if (offsetMm < AFO_PROXIMAL_TRIM_CLOSE_MM) {
        return `Proximal trim cap is ${offsetMm.toFixed(0)} mm from the fibular head, closer than ${AFO_PROXIMAL_TRIM_CLOSE_MM} mm.`;
    }
    return null;
}

export function firstMissingStep<T extends string>(
    steps: readonly { id: T; label: string }[],
    have: Partial<Record<T, unknown>>,
): { id: T; label: string } | null {
    return steps.find((step) => !have[step.id]) ?? null;
}

export function anatomicalPlacementAllowed(
    id: AfoAnatomicalLandmarkId,
    have: Partial<Record<AfoAnatomicalLandmarkId, unknown>>,
): { ok: true } | { ok: false; message: string } {
    const idx = AFO_LANDMARK_STEPS.findIndex((step) => step.id === id);
    const current = AFO_LANDMARK_STEPS[idx];
    if (!current) return { ok: false, message: "Unknown landmark." };
    if (have[id]) return { ok: true };
    for (let i = 0; i < idx; i++) {
        const prev = AFO_LANDMARK_STEPS[i];
        if (prev && !have[prev.id]) {
            return { ok: false, message: `Place ${prev.label} before ${current.label}.` };
        }
    }
    return { ok: true };
}

export function evaluateAfoScanProgress(wf: AfoScanWorkflow): { ok: true } | { ok: false; reason: string } {
    if (!wf.alignmentApplied) {
        return {
            ok: false,
            reason: "Step 1 of 2: place the plantar heel, 1st met head, and 5th met head, then apply alignment.",
        };
    }
    const missing = firstMissingStep(AFO_LANDMARK_STEPS, wf.landmarks);
    if (missing) {
        const placed = AFO_LANDMARK_STEPS.filter((step) => wf.landmarks[step.id]).length;
        return { ok: false, reason: `Step 2 of 2: place ${missing.label} (${placed}/8).` };
    }
    return { ok: true };
}

function legCenterAtZ(mesh: AfoTriMesh, z: number): AfoVec3 | null {
    let band = 12;
    const nVerts = (mesh.positions.length / 3) | 0;
    for (let attempt = 0; attempt < 3; attempt++) {
        let count = 0;
        const c = { x: 0, y: 0, z: 0 };
        for (let i = 0; i < nVerts; i++) {
            const vz = mesh.positions[i * 3 + 2] ?? 0;
            if (Math.abs(vz - z) > band) continue;
            c.x += mesh.positions[i * 3] ?? 0;
            c.y += mesh.positions[i * 3 + 1] ?? 0;
            c.z += vz;
            count++;
        }
        if (count >= 8) return scale(c, 1 / count);
        band *= 2;
    }
    return null;
}

export interface OrientedLandmarks {
    posterior_calcaneus?: AfoVec3;
    m1_mpj?: AfoVec3;
    m5_mpj?: AfoVec3;
    navicular?: AfoVec3;
    fifth_met_base?: AfoVec3;
    medial_malleolus?: AfoVec3;
    lateral_malleolus?: AfoVec3;
    fibular_head?: AfoVec3;
}

/**
 * Sanity checks warn only. They never move the mesh or the landmarks.
 * Coordinates are oriented millimetres: +X anterior, +Z up, geometric +Y = Z × X.
 * Medial is `medialSign(side) * Y`.
 */
export function deriveAfoMeasurements(
    oriented: OrientedLandmarks,
    side: Side,
    mesh: AfoTriMesh | null,
    forefootToRearfootDeg: number | null,
): AfoScanDerived {
    const warnings: { id: string; message: string }[] = [];
    const sign = medialSign(side);
    if (forefootToRearfootDeg != null && forefootToRearfootDeg > AFO_FOREFOOT_WARN_DEG) {
        warnings.push({
            id: "forefoot-rearfoot",
            message: `Forefoot-to-rearfoot angle is ${forefootToRearfootDeg.toFixed(1)}° (over ${AFO_FOREFOOT_WARN_DEG}°). Level to rearfoot uses the heel and the malleolar line after both malleoli are placed.`,
        });
    }

    const med = oriented.medial_malleolus;
    const lat = oriented.lateral_malleolus;
    let ankleAxis: AfoScanDerived["ankleAxis"] = null;
    if (med && lat) {
        ankleAxis = { medial: { ...med }, lateral: { ...lat } };
        const drop = med.z - lat.z;
        if (drop < AFO_LATERAL_MALLEOLUS_DROP_MM * 0.5) {
            warnings.push({
                id: "lat-mal-height",
                message: `Lateral malleolus should sit about ${AFO_LATERAL_MALLEOLUS_DROP_MM} mm lower than the medial (now ${drop.toFixed(1)} mm).`,
            });
        }
        if (lat.x >= med.x) {
            warnings.push({
                id: "lat-mal-posterior",
                message: "Lateral malleolus should be more posterior than the medial.",
            });
        }
    }

    const nav = oriented.navicular;
    const m1 = oriented.m1_mpj;
    if (nav && m1 && nav.x >= m1.x) {
        warnings.push({
            id: "navicular-proximal",
            message: "Navicular should be proximal to the 1st MPJ.",
        });
    }

    const fh = oriented.fibular_head;
    let proximalTrimCap: AfoScanDerived["proximalTrimCap"] = null;
    if (fh) {
        proximalTrimCap = {
            offsetMm: AFO_PROXIMAL_TRIM_OFFSET_MM,
            point: { x: fh.x, y: fh.y, z: fh.z - AFO_PROXIMAL_TRIM_OFFSET_MM },
        };
        const trimWarn = proximalTrimWarning(AFO_PROXIMAL_TRIM_OFFSET_MM);
        if (trimWarn) warnings.push({ id: "proximal-trim", message: trimWarn });
    }
    if (fh && lat) {
        const fhMedial = sign * fh.y;
        const latMedial = sign * lat.y;
        if (fhMedial >= latMedial) {
            warnings.push({
                id: "fibular-lateral",
                message: "Fibular head should be lateral to the lateral malleolus.",
            });
        }
        if (fh.z <= lat.z) {
            warnings.push({
                id: "fibular-above",
                message: "Fibular head should be above the lateral malleolus.",
            });
        }
    }

    let shankTiltDeg: AfoScanDerived["shankTiltDeg"] = null;
    if (mesh && med && lat && fh) {
        const malMid = mid(med, lat);
        const center = legCenterAtZ(mesh, fh.z);
        if (center) {
            const axis = norm(sub(center, malMid));
            const sagittal = (Math.atan2(axis.x, axis.z) * 180) / Math.PI;
            const frontal = (Math.atan2(sign * axis.y, axis.z) * 180) / Math.PI;
            shankTiltDeg = { sagittal, frontal };
            if (Math.abs(sagittal) > AFO_SHANK_WARN_DEG) {
                warnings.push({
                    id: "shank-sagittal",
                    message: `Shank sagittal tilt is ${sagittal.toFixed(1)}° (over ${AFO_SHANK_WARN_DEG}°). The leg is not re-posed.`,
                });
            }
            if (Math.abs(frontal) > AFO_SHANK_WARN_DEG) {
                warnings.push({
                    id: "shank-frontal",
                    message: `Shank frontal tilt is ${frontal.toFixed(1)}° (over ${AFO_SHANK_WARN_DEG}°). The leg is not re-posed.`,
                });
            }
        }
    }

    return {
        forefootToRearfootDeg,
        ankleAxis,
        plannedReliefsMm: { ...AFO_PLANNED_RELIEFS_MM },
        proximalTrimCap,
        heelCupCenter: oriented.posterior_calcaneus ? { ...oriented.posterior_calcaneus } : null,
        mpjBreak: m1 && oriented.m5_mpj ? { m1: { ...m1 }, m5: { ...oriented.m5_mpj } } : null,
        shankTiltDeg,
        warnings,
    };
}
