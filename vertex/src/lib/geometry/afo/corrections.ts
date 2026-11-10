// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { medialSign } from "@/lib/geometry/handedness";
import type { Side } from "@/types";
import {
    AFO_REAR_ROT_RANGE,
    AFO_SIDE_ROT_RANGE,
    AFO_TEXT_DEPTH_MM,
    isAfoIdentityCorrections,
} from "./defaults";
import { transformAfoPoint } from "./landmark-frame";
import { cloneMesh, computeVertexNormals, nearestVertex, vertexCount } from "./mesh-ops";
import { clamp01, smoothstep } from "./offset-field";
import type {
    AfoCorrections,
    AfoDesignState,
    AfoTextMark,
    AfoTriMesh,
    AfoVec3,
    AfoVolumeRegion,
} from "./types";

const DEG = Math.PI / 180;

export interface AfoRotationAxes {
    medialMal: AfoVec3;
    lateralMal: AfoVec3;
    side?: Side;
    heel?: AfoVec3;
    m1?: AfoVec3;
    m5?: AfoVec3;
    navicular?: AfoVec3 | null;
    fibularHead?: AfoVec3 | null;
    /** Windows pivot: projected transmalleolar and footplate axes through the AJC. */
    anatomical?: boolean;
    /** Vertices held during Taubin so landmarks stay within 0.5 mm. */
    pinPoints?: AfoVec3[];
}

export function clampSagittalDeg(v: number): number {
    return Math.min(AFO_SIDE_ROT_RANGE[1], Math.max(AFO_SIDE_ROT_RANGE[0], v));
}

export function clampFrontalDeg(v: number): number {
    return Math.min(AFO_REAR_ROT_RANGE[1], Math.max(AFO_REAR_ROT_RANGE[0], v));
}

export function malleolarAxes(
    medial: AfoVec3,
    lateral: AfoVec3,
): {
    origin: AfoVec3;
    sagittal: AfoVec3;
    frontal: AfoVec3;
    leg: AfoVec3;
} {
    const origin = {
        x: (medial.x + lateral.x) * 0.5,
        y: (medial.y + lateral.y) * 0.5,
        z: (medial.z + lateral.z) * 0.5,
    };
    const sx = lateral.x - medial.x;
    const sy = lateral.y - medial.y;
    const sz = lateral.z - medial.z;
    const sl = Math.hypot(sx, sy, sz) || 1;
    const sagittal = { x: sx / sl, y: sy / sl, z: sz / sl };
    const leg = { x: 0, y: 0, z: 1 };
    const fx = sagittal.y * leg.z - sagittal.z * leg.y;
    const fy = sagittal.z * leg.x - sagittal.x * leg.z;
    const fz = sagittal.x * leg.y - sagittal.y * leg.x;
    const fl = Math.hypot(fx, fy, fz) || 1;
    const frontal = { x: fx / fl, y: fy / fl, z: fz / fl };
    return { origin, sagittal, frontal, leg };
}

/** Degrees away from perpendicular (0 = orthogonal). */
export function axisOrthogonalityDeg(a: AfoVec3, b: AfoVec3): number {
    const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z);
    return (Math.asin(Math.min(1, d)) * 180) / Math.PI;
}

function rotateAround(p: AfoVec3, origin: AfoVec3, axis: AfoVec3, angle: number): AfoVec3 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const vx = p.x - origin.x;
    const vy = p.y - origin.y;
    const vz = p.z - origin.z;
    const cx = axis.y * vz - axis.z * vy;
    const cy = axis.z * vx - axis.x * vz;
    const cz = axis.x * vy - axis.y * vx;
    const dot = axis.x * vx + axis.y * vy + axis.z * vz;
    return {
        x: origin.x + vx * c + cx * s + axis.x * dot * (1 - c),
        y: origin.y + vy * c + cy * s + axis.y * dot * (1 - c),
        z: origin.z + vz * c + cz * s + axis.z * dot * (1 - c),
    };
}

/**
 * Apply AFO corrections to a working positive. All-zero corrections with
 * `smoothIterations = 0` are a true identity (cloned buffers, same positions).
 * Without `anatomical`, sagittal rotation stays on the malleolar axis and
 * frontal on the perpendicular through the midpoint (legacy warp).
 * With `anatomical`, the shank rotates about the ankle-joint centre on the
 * footplate-projected axes and the blend is only AJC ± 20 mm.
 */
export function applyAfoCorrections(mesh: AfoTriMesh, c: AfoCorrections, axes?: AfoRotationAxes): AfoTriMesh {
    if (isAfoIdentityCorrections(c)) return cloneMesh(mesh);
    const out = cloneMesh(mesh);
    const n = vertexCount(out);
    const sagDeg = clampSagittalDeg(c.legSideDeg);
    const frontDeg = clampFrontalDeg(c.legRearDeg);
    const medial = axes?.medialMal ?? { x: 35, y: 40, z: 80 };
    const lateral = axes?.lateralMal ?? { x: -35, y: 40, z: 80 };
    const ySpan = spanY(out);
    const footLen = Math.max(1, ySpan.yMax - ySpan.yMin);

    // One spin for both paths. The old malleolar cross product plantarflexed a
    // right foot when +side asked for dorsiflexion (readout about −7.9° at +10°).
    if (sagDeg !== 0 || frontDeg !== 0) {
        applyAnatomicalRotation(out, sagDeg, frontDeg, {
            ...axes,
            medialMal: medial,
            lateralMal: lateral,
        });
    }

    const nav = axes?.navicular ?? null;
    // This loop's width axis is X (heel→toe is Y). Medial X follows the malleoli
    // when they span; otherwise it is the shared plantar sign mapped into X
    // (−medialSign: left medial is +X, right medial is −X).
    const medialX = medialWidthXSign(medial, lateral, axes?.side);

    for (let i = 0; i < n; i++) {
        let x = out.positions[i * 3] ?? 0;
        const y = out.positions[i * 3 + 1] ?? 0;
        let z = out.positions[i * 3 + 2] ?? 0;

        if (c.heelLiftMm) {
            const t = clamp01(1 - y / 140);
            z += c.heelLiftMm * t;
        }
        if (c.toeRiseMm) {
            const yNorm = (y - ySpan.yMin) / footLen;
            if (yNorm > 0.6) z += c.toeRiseMm * smoothstep(0.6, 0.85, yNorm);
        }
        if (c.footLiftMedMm && x * medialX > 0) {
            z += c.footLiftMedMm * clamp01(Math.abs(x) / 40) * clamp01(1 - z / 50);
        }
        if (c.footLiftLatMm && x * medialX < 0) {
            z += c.footLiftLatMm * clamp01(Math.abs(x) / 40) * clamp01(1 - z / 50);
        }
        if (c.medialArchMm) {
            if (nav) {
                const gy = Math.exp(-((y - nav.y) ** 2) / (2 * 28 * 28));
                const gx = Math.exp(-((x - nav.x) ** 2) / (2 * 18 * 18));
                z += c.medialArchMm * gy * gx;
            } else if (x * medialX > 0) {
                const gy = Math.exp(-((y - 70) ** 2) / (2 * 28 * 28));
                z += c.medialArchMm * gy * clamp01(Math.abs(x) / 30);
            }
        }
        if (c.heelWidthMm) {
            const gh = Math.exp(-(y * y) / (2 * 35 * 35)) * clamp01(1 - z / 50);
            x += Math.sign(x || 1) * c.heelWidthMm * 0.5 * gh;
        }
        if (c.braceHeightMm > 0 && z > c.braceHeightMm) {
            z = c.braceHeightMm + (z - c.braceHeightMm) * 0.05;
        }

        out.positions[i * 3] = x;
        out.positions[i * 3 + 1] = y;
        out.positions[i * 3 + 2] = z;
    }

    if (c.smoothIterations > 0)
        taubinSmooth(out, c.smoothIterations, 0.33, -0.34, pinMask(out, axes?.pinPoints));
    for (const region of c.smoothRegions ?? []) {
        if (region.iterations > 0)
            taubinSmooth(out, region.iterations, 0.33, -0.34, regionSkip(out, region.vertexIndices));
    }
    if ((c.volumeRegions?.length ?? 0) > 0) applyVolumeRegions(out, c.volumeRegions);
    if (c.text?.text) applyAfoText(out, c.text, axes?.side ?? "right");
    return out;
}

function spanY(mesh: AfoTriMesh): { yMin: number; yMax: number } {
    const n = vertexCount(mesh);
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < n; i++) {
        const y = mesh.positions[i * 3 + 1] ?? 0;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
    }
    return { yMin, yMax };
}

/**
 * Sign of X that points at the medial malleolus in the correction loop.
 * X is width here (Y is heel→toe). A real malleolar span wins. With no span,
 * medial X is −{@link medialSign}: the shared footprint rule mapped onto this axis
 * (left medial +X, right medial −X). Default landmarks also put medial at +X.
 */
export function medialWidthXSign(medial: AfoVec3, lateral: AfoVec3, side?: Side): 1 | -1 {
    const dx = medial.x - lateral.x;
    if (Math.abs(dx) > 1e-3) return dx > 0 ? 1 : -1;
    if (!side) return 1;
    return -medialSign(side) as 1 | -1;
}

/** +X is lateral on the right. The left side mirrors so +varus stays medial. */
export function lateralX(side: Side): number {
    return side === "left" ? -1 : 1;
}

export function ankleJointCentre(medial: AfoVec3, lateral: AfoVec3): AfoVec3 {
    return {
        x: (medial.x + lateral.x) * 0.5,
        y: (medial.y + lateral.y) * 0.5,
        z: (medial.z + lateral.z) * 0.5,
    };
}

export interface AfoFootAxes {
    origin: AfoVec3;
    /** Unit footplate axis, heel toward the metatarsal midpoint (sagittal). */
    anterior: AfoVec3;
    /** Unit footplate axis, medial malleolus toward the lateral malleolus. */
    lateral: AfoVec3;
    /** Unit footplate axis, toward the medial malleolus. */
    medial: AfoVec3;
    /**
     * Sign of a positive right-hand spin about `anterior` that carries +Z toward medial.
     * Clinical rear and side degrees are multiplied by this so +rear is varus and
     * +side is dorsiflexion on both feet.
     */
    chirality: 1 | -1;
}

function unitXY(x: number, y: number): AfoVec3 | null {
    const l = Math.hypot(x, y);
    if (l < 1e-6) return null;
    return { x: x / l, y: y / l, z: 0 };
}

/**
 * Footplate axes through the ankle-joint centre.
 * Rear view (varus/valgus) spins about `anterior`. Side view (dorsi/plantarflexion)
 * spins about `lateral`. Medial, when the malleoli do not span, follows
 * {@link medialSign} along geometric +Y (the plantar frame).
 */
export function afoFootAxes(axes: AfoRotationAxes): AfoFootAxes {
    const origin = ankleJointCentre(axes.medialMal, axes.lateralMal);
    const lateral =
        unitXY(axes.lateralMal.x - axes.medialMal.x, axes.lateralMal.y - axes.medialMal.y) ??
        (() => {
            const s = medialSign(axes.side ?? "right");
            return { x: 0, y: -s, z: 0 };
        })();
    const medial = { x: -lateral.x, y: -lateral.y, z: 0 };
    const heel = axes.heel ?? { x: 0, y: 0, z: 0 };
    const m1 = axes.m1 ?? { x: 0, y: 120, z: 0 };
    const m5 = axes.m5 ?? { x: 0, y: 120, z: 0 };
    let anterior = unitXY((m1.x + m5.x) * 0.5 - heel.x, (m1.y + m5.y) * 0.5 - heel.y);
    const crossZ = anterior ? anterior.x * lateral.y - anterior.y * lateral.x : 0;
    if (!anterior || Math.abs(crossZ) < 1e-3) {
        const ccw = { x: -lateral.y, y: lateral.x, z: 0 };
        const cw = { x: lateral.y, y: -lateral.x, z: 0 };
        // Toes are +X in the plantar frame and +Y in the legacy three-point frame.
        anterior = ccw.x * 2 + ccw.y >= cw.x * 2 + cw.y ? ccw : cw;
    }
    const chirality: 1 | -1 = anterior.x * lateral.y - anterior.y * lateral.x >= 0 ? 1 : -1;
    return { origin, anterior, lateral, medial, chirality };
}

function dot3(a: AfoVec3, b: AfoVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

export interface ShankAngles {
    sagittalDeg: number;
    frontalDeg: number;
    axis: AfoVec3;
}

/**
 * Shank tilt from the plantar normal, in the same footplate axes the rotation uses.
 * Positive sagittal is dorsiflexion (proximal shank toward the toes).
 * Positive frontal is varus (proximal shank toward the medial malleolus).
 * Zero is a shank square to the footplate.
 */
export function measureShankAngles(mesh: AfoTriMesh, axes: AfoRotationAxes): ShankAngles {
    const frame = afoFootAxes(axes);
    const origin = frame.origin;
    const headZ = axes.fibularHead?.z ?? origin.z + 110;
    const centroid = shankSection(mesh, headZ, origin.z) ?? { x: origin.x, y: origin.y, z: headZ };
    const sx = centroid.x - origin.x;
    const sy = centroid.y - origin.y;
    const sz = centroid.z - origin.z;
    const sl = Math.hypot(sx, sy, sz) || 1;
    const axis = { x: sx / sl, y: sy / sl, z: sz / sl };
    return {
        sagittalDeg: (Math.atan2(dot3(axis, frame.anterior), axis.z) * 180) / Math.PI,
        frontalDeg: (Math.atan2(dot3(axis, frame.medial), axis.z) * 180) / Math.PI,
        axis,
    };
}

/** Prefer the fibular band. If a brace clamp emptied it, use the highest band that is still there. */
function shankSection(mesh: AfoTriMesh, headZ: number, originZ: number): AfoVec3 | null {
    const direct = sectionCentroid(mesh, headZ);
    if (direct) return direct;
    let top = -Infinity;
    const n = vertexCount(mesh);
    for (let i = 0; i < n; i++) top = Math.max(top, mesh.positions[i * 3 + 2] ?? 0);
    for (let z = top - 6; z > originZ + 25; z -= 12) {
        const found = sectionCentroid(mesh, z);
        if (found) return found;
    }
    return null;
}

function sectionCentroid(mesh: AfoTriMesh, z: number): AfoVec3 | null {
    const n = vertexCount(mesh);
    let band = 12;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let count = 0;
    const acc = () => {
        cx = 0;
        cy = 0;
        cz = 0;
        count = 0;
        for (let i = 0; i < n; i++) {
            const pz = mesh.positions[i * 3 + 2] ?? 0;
            if (Math.abs(pz - z) > band) continue;
            cx += mesh.positions[i * 3] ?? 0;
            cy += mesh.positions[i * 3 + 1] ?? 0;
            cz += pz;
            count++;
        }
    };
    acc();
    if (count < 6) {
        band = 28;
        acc();
    }
    if (count === 0) return null;
    return { x: cx / count, y: cy / count, z: cz / count };
}

function applyAnatomicalRotation(
    mesh: AfoTriMesh,
    sideDeg: number,
    rearDeg: number,
    axes: AfoRotationAxes,
): void {
    const frame = afoFootAxes(axes);
    const origin = frame.origin;
    const baseline = measureShankAngles(mesh, axes);
    spinShank(mesh, frame, origin, axes, sideDeg, rearDeg);
    // A skewed malleolar axis overshoots the footplate angle. One correction pass
    // brings the measured change back onto the slider.
    const once = measureShankAngles(mesh, axes);
    const sideErr = sideDeg === 0 ? 0 : sideDeg - (once.sagittalDeg - baseline.sagittalDeg);
    const rearErr = rearDeg === 0 ? 0 : rearDeg - (once.frontalDeg - baseline.frontalDeg);
    if (Math.abs(sideErr) > 0.35 || Math.abs(rearErr) > 0.35) {
        spinShank(mesh, frame, origin, axes, sideErr, rearErr);
    }
}

function spinShank(
    mesh: AfoTriMesh,
    frame: AfoFootAxes,
    origin: AfoVec3,
    axes: AfoRotationAxes,
    sideDeg: number,
    rearDeg: number,
): void {
    const measured = measureShankAngles(mesh, axes);
    const sideTotal = clampSagittalDeg(measured.sagittalDeg + sideDeg);
    const rearTotal = clampFrontalDeg(measured.frontalDeg + rearDeg);
    const dSide = Math.abs(sideDeg) < 1e-6 ? 0 : sideTotal - measured.sagittalDeg;
    const dRear = Math.abs(rearDeg) < 1e-6 ? 0 : rearTotal - measured.frontalDeg;
    if (Math.abs(dSide) < 1e-6 && Math.abs(dRear) < 1e-6) return;

    // chirality makes +side dorsiflexion and +rear varus on both feet.
    // Do not scale by the malleolar X component — in the plantar frame that
    // axis lies along Y, and the old scale cancelled the spin.
    const rearAngle = frame.chirality * dRear * DEG;
    const sideAngle = frame.chirality * dSide * DEG;
    const n = vertexCount(mesh);
    const pins = [
        axes.heel ?? { x: 0, y: 0, z: 0 },
        axes.m1 ?? { x: 0, y: 120, z: 0 },
        axes.m5 ?? { x: 0, y: 120, z: 0 },
        axes.medialMal,
        axes.lateralMal,
    ];
    for (let i = 0; i < n; i++) {
        const p = {
            x: mesh.positions[i * 3] ?? 0,
            y: mesh.positions[i * 3 + 1] ?? 0,
            z: mesh.positions[i * 3 + 2] ?? 0,
        };
        let w = smoothstep(origin.z - 20, origin.z + 20, p.z);
        if (p.z < 12 && p.y < origin.y + 20) w = 0;
        for (const pin of pins) {
            if (Math.hypot(p.x - pin.x, p.y - pin.y, p.z - pin.z) < 8) w = 0;
        }
        if (w <= 0) continue;
        let q = p;
        if (dRear !== 0) q = rotateAround(q, origin, frame.anterior, rearAngle * w);
        if (dSide !== 0) q = rotateAround(q, origin, frame.lateral, sideAngle * w);
        mesh.positions[i * 3] = q.x;
        mesh.positions[i * 3 + 1] = q.y;
        mesh.positions[i * 3 + 2] = q.z;
    }
}

function pinMask(mesh: AfoTriMesh, points: AfoVec3[] | undefined): Uint8Array | null {
    if (!points || points.length === 0) return null;
    const n = vertexCount(mesh);
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const x = mesh.positions[i * 3] ?? 0;
        const y = mesh.positions[i * 3 + 1] ?? 0;
        const z = mesh.positions[i * 3 + 2] ?? 0;
        for (const p of points) {
            if (Math.hypot(x - p.x, y - p.y, z - p.z) <= 2) {
                mask[i] = 1;
                break;
            }
        }
    }
    return mask;
}

function regionSkip(mesh: AfoTriMesh, indices: number[]): Uint8Array {
    const skip = new Uint8Array(vertexCount(mesh));
    skip.fill(1);
    for (const i of indices) if (i >= 0 && i < skip.length) skip[i] = 0;
    return skip;
}

function applyVolumeRegions(mesh: AfoTriMesh, regions: AfoVolumeRegion[]): void {
    const n = vertexCount(mesh);
    const nrm = computeVertexNormals(mesh);
    for (const region of regions) {
        const feather = Math.min(12, Math.max(8, region.featherMm || 10));
        const seeds = region.vertexIndices.filter((i) => i >= 0 && i < n);
        if (seeds.length === 0) continue;
        for (let i = 0; i < n; i++) {
            const x = mesh.positions[i * 3] ?? 0;
            const y = mesh.positions[i * 3 + 1] ?? 0;
            const z = mesh.positions[i * 3 + 2] ?? 0;
            let d = Infinity;
            for (const s of seeds) {
                const dx = x - (mesh.positions[s * 3] ?? 0);
                const dy = y - (mesh.positions[s * 3 + 1] ?? 0);
                const dz = z - (mesh.positions[s * 3 + 2] ?? 0);
                d = Math.min(d, Math.hypot(dx, dy, dz));
            }
            if (d > feather) continue;
            const w = 1 - smoothstep(feather * 0.35, feather, d);
            const k = region.offsetMm * w;
            mesh.positions[i * 3] = x + (nrm[i * 3] ?? 0) * k;
            mesh.positions[i * 3 + 1] = y + (nrm[i * 3 + 1] ?? 0) * k;
            mesh.positions[i * 3 + 2] = z + (nrm[i * 3 + 2] ?? 0) * k;
        }
    }
}

const GLYPH: Record<string, string[]> = {
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    B: ["11110", "10001", "11110", "10001", "10001", "10001", "11110"],
    C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
    F: ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
    G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    H: ["10001", "10001", "11111", "10001", "10001", "10001", "10001"],
    I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
    K: ["10001", "10010", "11100", "10010", "10001", "10001", "10001"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    M: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
    N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    R: ["11110", "10001", "10001", "11110", "10010", "10001", "10001"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

/** Normal displacement of 0.4–0.6 mm on a lateral, non-plantar patch. */
export function applyAfoText(mesh: AfoTriMesh, mark: AfoTextMark, side: Side): void {
    const depth = Math.min(AFO_TEXT_DEPTH_MM[1], Math.max(AFO_TEXT_DEPTH_MM[0], mark.depthMm || 0.5));
    const text = mark.text.toUpperCase();
    const n = vertexCount(mesh);
    const nrm = computeVertexNormals(mesh);
    const lateral = lateralX(side);
    let anchor = mark.anchor;
    if (!anchor) {
        let best = -Infinity;
        for (let i = 0; i < n; i++) {
            const z = mesh.positions[i * 3 + 2] ?? 0;
            const nz = nrm[i * 3 + 2] ?? 0;
            const nx = nrm[i * 3] ?? 0;
            if (z < 50 || nz < -0.2) continue;
            const score = nx * lateral;
            if (score > best) {
                best = score;
                anchor = {
                    x: mesh.positions[i * 3] ?? 0,
                    y: mesh.positions[i * 3 + 1] ?? 0,
                    z,
                };
            }
        }
    }
    if (!anchor) return;
    const cols = text.length * 6;
    const originU = -cols * 0.45;
    for (let i = 0; i < n; i++) {
        const x = mesh.positions[i * 3] ?? 0;
        const y = mesh.positions[i * 3 + 1] ?? 0;
        const z = mesh.positions[i * 3 + 2] ?? 0;
        const nz = nrm[i * 3 + 2] ?? 0;
        if (nz < -0.35 || z < 40) continue;
        const u = (y - anchor.y) * 1.4;
        const v = (z - anchor.z) * 1.4;
        if (glyphAt(text, u - originU, v)) {
            mesh.positions[i * 3] = x + (nrm[i * 3] ?? 0) * depth;
            mesh.positions[i * 3 + 1] = y + (nrm[i * 3 + 1] ?? 0) * depth;
            mesh.positions[i * 3 + 2] = z + (nrm[i * 3 + 2] ?? 0) * depth;
        }
    }
}

function glyphAt(text: string, u: number, v: number): boolean {
    if (v < 0 || v >= 7) return false;
    const cell = Math.floor(u / 6);
    if (cell < 0 || cell >= text.length) return false;
    const glyph = GLYPH[text[cell]!] ?? GLYPH[" "];
    const col = Math.floor(u - cell * 6);
    if (!glyph || col < 0 || col >= 5) return false;
    const row = glyph[6 - Math.floor(v)];
    return row?.[col] === "1";
}

export function textMatchesSide(text: string, side: Side): boolean {
    const token = text.trim().split(/\s+/).pop()?.toUpperCase() ?? "";
    const want = side === "left" ? "L" : "R";
    return token === want || token.endsWith(want);
}

export function defaultAfoText(patientName: string, side: Side): string {
    const name = (patientName || "PATIENT").trim().toUpperCase();
    return `${name} ${side === "left" ? "L" : "R"}`;
}

export function correctionContextFromAfo(
    afo: AfoDesignState,
    extras?: { medialMal?: AfoVec3; lateralMal?: AfoVec3 },
): AfoRotationAxes {
    const matrix = afo.scanWorkflow.matrixElements;
    const mapPoint = (p: AfoVec3 | undefined): AfoVec3 | undefined =>
        p ? (matrix ? transformAfoPoint(p, matrix) : p) : undefined;
    // Design clicks are already on the oriented mesh. Scan-workflow points are
    // stored unoriented and have to ride the alignment matrix.
    const medial = extras?.medialMal ??
        afo.landmarks.find((l) => l.id === "malleolus_medial")?.point ??
        afo.scanWorkflow.derived?.ankleAxis?.medial ??
        mapPoint(afo.scanWorkflow.landmarks.medial_malleolus) ?? { x: 35, y: 40, z: 80 };
    const lateral = extras?.lateralMal ??
        afo.landmarks.find((l) => l.id === "malleolus_lateral")?.point ??
        afo.scanWorkflow.derived?.ankleAxis?.lateral ??
        mapPoint(afo.scanWorkflow.landmarks.lateral_malleolus) ?? { x: -35, y: 40, z: 80 };
    const fib =
        afo.clinicalMarkers.find((m) => m.id === "fibular_head")?.point ??
        mapPoint(afo.scanWorkflow.landmarks.fibular_head) ??
        null;
    const nav =
        afo.clinicalMarkers.find((m) => m.id === "navicular")?.point ??
        mapPoint(afo.scanWorkflow.landmarks.navicular) ??
        null;
    const pins = [...afo.clinicalMarkers.map((m) => m.point), ...afo.landmarks.map((l) => l.point)];
    return {
        medialMal: medial,
        lateralMal: lateral,
        side: afo.side,
        navicular: nav,
        fibularHead: fib,
        anatomical: true,
        pinPoints: pins,
        heel: mapPoint(afo.scanWorkflow.plantar.heel),
        m1: mapPoint(afo.scanWorkflow.plantar.m1p),
        m5: mapPoint(afo.scanWorkflow.plantar.m5p),
    };
}

export function landmarkDriftMm(before: AfoTriMesh, after: AfoTriMesh, point: AfoVec3): number {
    const i = nearestVertex(before, point).index;
    return Math.hypot(
        (after.positions[i * 3] ?? 0) - (before.positions[i * 3] ?? 0),
        (after.positions[i * 3 + 1] ?? 0) - (before.positions[i * 3 + 1] ?? 0),
        (after.positions[i * 3 + 2] ?? 0) - (before.positions[i * 3 + 2] ?? 0),
    );
}

function taubinSmooth(
    mesh: AfoTriMesh,
    iterations: number,
    lambda = 0.33,
    mu = -0.34,
    mask: Uint8Array | null = null,
): void {
    const n = vertexCount(mesh);
    const nrm = computeVertexNormals(mesh);
    void nrm;
    const adj = buildAdj(mesh, n);
    const tmp = new Float32Array(mesh.positions.length);
    const step = (factor: number) => {
        tmp.set(mesh.positions);
        for (let i = 0; i < n; i++) {
            if (mask?.[i]) continue;
            const nbrs = adj[i] ?? [];
            if (nbrs.length === 0) continue;
            let sx = 0;
            let sy = 0;
            let sz = 0;
            for (const j of nbrs) {
                sx += tmp[j * 3] ?? 0;
                sy += tmp[j * 3 + 1] ?? 0;
                sz += tmp[j * 3 + 2] ?? 0;
            }
            const inv = 1 / nbrs.length;
            const lx = sx * inv - (tmp[i * 3] ?? 0);
            const ly = sy * inv - (tmp[i * 3 + 1] ?? 0);
            const lz = sz * inv - (tmp[i * 3 + 2] ?? 0);
            mesh.positions[i * 3] = (tmp[i * 3] ?? 0) + factor * lx;
            mesh.positions[i * 3 + 1] = (tmp[i * 3 + 1] ?? 0) + factor * ly;
            mesh.positions[i * 3 + 2] = (tmp[i * 3 + 2] ?? 0) + factor * lz;
        }
    };
    for (let k = 0; k < iterations; k++) {
        step(lambda);
        step(mu);
    }
}

function buildAdj(mesh: AfoTriMesh, n: number): number[][] {
    const adj: number[][] = Array.from({ length: n }, () => []);
    const seen = new Set<string>();
    const add = (a: number, b: number) => {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) return;
        seen.add(key);
        adj[a]!.push(b);
        adj[b]!.push(a);
    };
    const t = (mesh.indices.length / 3) | 0;
    for (let i = 0; i < t; i++) {
        const a = mesh.indices[i * 3] ?? 0;
        const b = mesh.indices[i * 3 + 1] ?? 0;
        const c = mesh.indices[i * 3 + 2] ?? 0;
        add(a, b);
        add(b, c);
        add(c, a);
    }
    return adj;
}
