// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AFO_C_MM,
    AFO_CREST_OUTLIER_MM,
    AFO_CREST_OUTLIER_RATIO,
    AFO_CREST_PEAK_RATIO,
    AFO_CREST_SECTION_MM,
} from "./defaults";
import { nearestVertex, vertexCount } from "./mesh-ops";
import type { AfoClinicalMarker, AfoCrestState, AfoTriMesh, AfoVec3 } from "./types";

function clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}

function dist3(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function distToSpline(p: AfoVec3, spline: AfoVec3[]): number {
    if (spline.length === 0) return Number.POSITIVE_INFINITY;
    let best = dist3(p, spline[0]!);
    for (let i = 1; i < spline.length; i++) {
        const a = spline[i - 1]!;
        const b = spline[i]!;
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abz = b.z - a.z;
        const apx = p.x - a.x;
        const apy = p.y - a.y;
        const apz = p.z - a.z;
        const ab2 = abx * abx + aby * aby + abz * abz || 1;
        const t = clamp01((apx * abx + apy * aby + apz * abz) / ab2);
        const d = Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
        if (d < best) best = d;
    }
    return best;
}

interface SectionHit {
    point: AfoVec3;
    kappa: number;
    sector: number[];
    spreadMm: number;
}

function sectionAtZ(mesh: AfoTriMesh, z0: number, halfBand = 3): { x: number; y: number; z: number }[] {
    const n = vertexCount(mesh);
    const pts: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < n; i++) {
        const z = mesh.positions[i * 3 + 2] ?? 0;
        if (Math.abs(z - z0) > halfBand) continue;
        pts.push({
            x: mesh.positions[i * 3] ?? 0,
            y: mesh.positions[i * 3 + 1] ?? 0,
            z,
        });
    }
    return pts;
}

function detectSectionPeak(pts: { x: number; y: number; z: number }[]): SectionHit | null {
    if (pts.length < 6) return null;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
        cx += p.x;
        cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    const withAng = pts.map((p) => {
        const angAnt = Math.atan2(p.x - cx, p.y - cy);
        return { ...p, ang: angAnt, r: Math.hypot(p.x - cx, p.y - cy) };
    });
    const anterior = withAng.filter((p) => Math.abs(p.ang) <= Math.PI / 4);
    if (anterior.length < 3) return null;
    anterior.sort((a, b) => a.ang - b.ang);

    // 3 mm arc-length smooth of radius.
    const sm = anterior.map((p, i) => {
        let wr = 0;
        let w = 0;
        for (let j = 0; j < anterior.length; j++) {
            const arc = Math.abs(anterior[j]!.ang - p.ang) * p.r;
            if (arc > 3) continue;
            const ww = 1 - arc / 3;
            wr += anterior[j]!.r * ww;
            w += ww;
        }
        return { ...p, r: w > 0 ? wr / w : p.r, i };
    });

    const kappa: number[] = [];
    for (let i = 0; i < sm.length; i++) {
        const a = sm[i === 0 ? 0 : i - 1]!;
        const b = sm[i]!;
        const c = sm[i === sm.length - 1 ? i : i + 1]!;
        const ux = b.x - a.x;
        const uy = b.y - a.y;
        const vx = c.x - b.x;
        const vy = c.y - b.y;
        const lu = Math.hypot(ux, uy) || 1;
        const lv = Math.hypot(vx, vy) || 1;
        const cross = ux * vy - uy * vx;
        const outward = (b.x - cx) * (b.x - cx) + (b.y - cy) * (b.y - cy);
        void outward;
        // Convex (outward) turning: positive when the chain bends away from centroid.
        const toC = { x: cx - b.x, y: cy - b.y };
        const sign = Math.sign(ux * toC.y - uy * toC.x) || 1;
        kappa.push((sign * cross) / (lu * lv * ((lu + lv) * 0.5) || 1));
    }
    let peakI = 0;
    let peakK = -Infinity;
    for (let i = 0; i < kappa.length; i++) {
        if ((kappa[i] ?? 0) > peakK) {
            peakK = kappa[i] ?? 0;
            peakI = i;
        }
    }
    // Snap the crest sample to the anterior-most (max +Y) point in the sector —
    // max convex curvature and the anterior ridge coincide on a tibial crest.
    let antI = 0;
    let antY = -Infinity;
    for (let i = 0; i < sm.length; i++) {
        if ((sm[i]?.y ?? 0) > antY) {
            antY = sm[i]!.y;
            antI = i;
        }
    }
    const sorted = kappa.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    const p = sm[antI] ?? sm[peakI]!;
    let rMin = Infinity;
    let rMax = -Infinity;
    for (const s of sm) {
        if (s.r < rMin) rMin = s.r;
        if (s.r > rMax) rMax = s.r;
    }
    return {
        point: { x: p.x, y: p.y, z: p.z },
        kappa: peakK,
        sector: kappa.concat([median]),
        spreadMm: rMax - rMin,
    };
}

function splineFromPeaks(peaks: AfoVec3[]): AfoVec3[] {
    if (peaks.length <= 2) return peaks.slice();
    peaks.sort((a, b) => a.z - b.z);
    return peaks;
}

function outlierRatio(peaks: AfoVec3[], spline: AfoVec3[]): number {
    if (peaks.length === 0) return 1;
    let bad = 0;
    for (const p of peaks) {
        if (distToSpline(p, spline) > AFO_CREST_OUTLIER_MM) bad++;
    }
    return bad / peaks.length;
}

/**
 * Detect the tibial crest. Optional tuberosity + distal-crest markers override
 * as a two-point spline; callers may also pass a dragged `override` spline.
 */
export function detectTibialCrest(
    mesh: AfoTriMesh,
    braceHeightMm: number,
    clinical: AfoClinicalMarker[] = [],
    overridePoints?: AfoVec3[],
): AfoCrestState {
    const tub = clinical.find((m) => m.id === "tibial_tuberosity");
    const distal = clinical.find((m) => m.id === "distal_crest");
    if (overridePoints && overridePoints.length >= 2) {
        return {
            points: overridePoints.slice(),
            outlierRatio: 0,
            peakToMedian: 99,
            lowConfidence: false,
            override: true,
        };
    }
    if (tub && distal) {
        const points: AfoVec3[] = [];
        const n = 12;
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            points.push({
                x: distal.point.x + (tub.point.x - distal.point.x) * t,
                y: distal.point.y + (tub.point.y - distal.point.y) * t,
                z: distal.point.z + (tub.point.z - distal.point.z) * t,
            });
        }
        return {
            points,
            outlierRatio: 0,
            peakToMedian: 99,
            lowConfidence: false,
            override: true,
        };
    }

    const z0 = AFO_C_MM + 60;
    const z1 = braceHeightMm;
    const peaks: AfoVec3[] = [];
    const peakKs: number[] = [];
    const medians: number[] = [];
    const spreads: number[] = [];
    for (let z = z0; z <= z1 + 1e-6; z += AFO_CREST_SECTION_MM) {
        const pts = sectionAtZ(mesh, z);
        const hit = detectSectionPeak(pts);
        if (!hit) continue;
        peaks.push(hit.point);
        peakKs.push(hit.kappa);
        medians.push(hit.sector[hit.sector.length - 1] ?? 0);
        spreads.push(hit.spreadMm);
    }
    const spline = splineFromPeaks(peaks);
    const ratio = outlierRatio(peaks, spline);
    const kept = spline.filter((p) => distToSpline(p, spline) <= AFO_CREST_OUTLIER_MM * 1.01);
    let peakToMedian = 0;
    for (let i = 0; i < peakKs.length; i++) {
        const med = Math.max(1e-6, Math.abs(medians[i] ?? 0));
        peakToMedian = Math.max(peakToMedian, (peakKs[i] ?? 0) / med);
    }
    const meanSpread = spreads.length ? spreads.reduce((s, v) => s + v, 0) / spreads.length : 0;
    // Round shins have little anterior radius variation — treat as low confidence.
    const lowConfidence =
        ratio > AFO_CREST_OUTLIER_RATIO || peakToMedian < AFO_CREST_PEAK_RATIO || meanSpread < 4;
    return {
        points: kept.length >= 2 ? kept : spline,
        outlierRatio: ratio,
        peakToMedian,
        lowConfidence,
        override: false,
    };
}

export function crestHasOverrideMarkers(clinical: AfoClinicalMarker[]): boolean {
    return (
        clinical.some((m) => m.id === "tibial_tuberosity") && clinical.some((m) => m.id === "distal_crest")
    );
}

export function snapPointToMesh(mesh: AfoTriMesh, p: AfoVec3): AfoVec3 {
    const i = nearestVertex(mesh, p).index;
    return {
        x: mesh.positions[i * 3] ?? p.x,
        y: mesh.positions[i * 3 + 1] ?? p.y,
        z: mesh.positions[i * 3 + 2] ?? p.z,
    };
}
