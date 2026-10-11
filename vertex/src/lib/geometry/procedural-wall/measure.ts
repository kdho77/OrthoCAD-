// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { medialYSignFromTopRim } from "./bottom-pattern";
import type { PolyPoint } from "./curves";
import {
    type FlareProfileKind,
    type FlareRegionDiagnostic,
    type FlareRegionId,
    type RegionMeasurements,
    regionWeights,
    resolveWallDefaults,
    type WallRegionDefaults,
} from "./defaults";
import type { StockWallModel } from "./types";

export interface StationSample {
    u: number;
    y: number;
    flareDeg: number;
    cupHeightMm: number;
    outwardOffsetMm: number;
    filletTopMm: number;
    filletBotMm: number;
}

function polygonCentroid(poly: PolyPoint[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const p of poly) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, poly.length);
    return { x: x / n, y: y / n };
}

/** Outward XY normal of a CCW polyline (rotate tangent 90° CW, then centroid-confirm). */
export function outwardNormal(
    poly: PolyPoint[],
    i: number,
    centroid: { x: number; y: number },
): { x: number; y: number } {
    const n = poly.length;
    const prev = poly[(i + n - 1) % n]!;
    const next = poly[(i + 1) % n]!;
    const a = poly[i]!;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    let nx = ty / len;
    let ny = -tx / len;
    if (nx * (a.x - centroid.x) + ny * (a.y - centroid.y) < 0) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}

function dominantRegion(u: number, y: number, medialYSign: 1 | -1 = 1): FlareRegionId {
    const w = regionWeights(u, y, medialYSign);
    let best: FlareRegionId = "forefoot";
    let bestW = -1;
    for (const k of Object.keys(w) as FlareRegionId[]) {
        if (w[k]! > bestW) {
            bestW = w[k]!;
            best = k;
        }
    }
    return best;
}

/**
 * Chord flare from vertical (deg). Positive = top sits outward of the plantar
 * outline along the outward normal.
 */
export function chordFlareDeg(outline: PolyPoint, trim: PolyPoint, n: { x: number; y: number }): number {
    const height = trim.z - outline.z;
    const offset = (trim.x - outline.x) * n.x + (trim.y - outline.y) * n.y;
    return (Math.atan2(offset, Math.max(height, 1e-6)) * 180) / Math.PI;
}

export function measureStations(
    trim: PolyPoint[],
    outline: PolyPoint[],
    bounds: StockWallModel["bounds"],
    wallOffsets?: { topMm: number[]; botMm: number[] },
): StationSample[] {
    const n = Math.min(trim.length, outline.length);
    const centroid = polygonCentroid(outline);
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const out: StationSample[] = [];
    for (let i = 0; i < n; i++) {
        const t = trim[i]!;
        const o = outline[i]!;
        const nxy = outwardNormal(outline, i, centroid);
        const height = t.z - o.z;
        const offset = (t.x - o.x) * nxy.x + (t.y - o.y) * nxy.y;
        const u = Math.max(0, Math.min(1, (o.x - bounds.minX) / length));
        out.push({
            u,
            y: o.y,
            flareDeg: (Math.atan2(offset, Math.max(height, 1e-6)) * 180) / Math.PI,
            cupHeightMm: height,
            outwardOffsetMm: offset,
            filletTopMm: wallOffsets?.topMm[i] ?? Number.NaN,
            filletBotMm: wallOffsets?.botMm[i] ?? Number.NaN,
        });
    }
    return out;
}

function weightedMean(
    samples: StationSample[],
    region: Exclude<FlareRegionId, "forefoot">,
    pick: (s: StationSample) => number,
    minWeight = 0.35,
    medialYSign: 1 | -1 = 1,
): number | null {
    let s = 0;
    let w = 0;
    for (const st of samples) {
        if (dominantRegion(st.u, st.y, medialYSign) === "forefoot") continue;
        const ww = regionWeights(st.u, st.y, medialYSign)[region];
        const v = pick(st);
        if (ww < minWeight || !Number.isFinite(v)) continue;
        s += v * ww;
        w += ww;
    }
    return w > 1e-6 ? s / w : null;
}

/**
 * Measure flare / fillet / cup-bowl from Default.glb (or any stock) sections.
 * Fillet radii use residual offset from the chord in the top/bottom bands when
 * provided; otherwise they are left unmeasured so resolveWallDefaults falls
 * back to the biomechanics recommended values after the bound rule.
 */
export function measureRegionFeatures(
    trim: PolyPoint[],
    outline: PolyPoint[],
    bounds: StockWallModel["bounds"],
    wallOffsets?: { topMm: number[]; botMm: number[] },
    medialYSign: 1 | -1 = 1,
): RegionMeasurements {
    const stations = measureStations(trim, outline, bounds, wallOffsets);
    const heelH = stations.filter((s) => s.u < 0.22 && s.cupHeightMm > 2).map((s) => s.cupHeightMm);
    const meanH = heelH.length ? heelH.reduce((a, b) => a + b, 0) / heelH.length : 0;
    // Bowl factor from posterior outward offset vs cup height (clamped later).
    const post = stations.filter((s) => s.u < 0.12 && s.cupHeightMm > 2);
    const meanOff = post.length ? post.reduce((a, s) => a + Math.abs(s.outwardOffsetMm), 0) / post.length : 0;
    const cupBowlFactor = meanH > 1 ? Math.max(0.35, Math.min(1.1, meanOff / meanH + 0.45)) : undefined;

    return {
        flareDeg: {
            heelPosterior:
                weightedMean(stations, "heelPosterior", (s) => s.flareDeg, 0.35, medialYSign) ?? undefined,
            heelMedial:
                weightedMean(stations, "heelMedial", (s) => s.flareDeg, 0.35, medialYSign) ?? undefined,
            heelLateral:
                weightedMean(stations, "heelLateral", (s) => s.flareDeg, 0.35, medialYSign) ?? undefined,
            medialArch:
                weightedMean(stations, "medialArch", (s) => s.flareDeg, 0.35, medialYSign) ?? undefined,
            lateralMidfoot:
                weightedMean(stations, "lateralMidfoot", (s) => s.flareDeg, 0.35, medialYSign) ?? undefined,
        },
        filletTopMm:
            weightedMean(stations, "heelPosterior", (s) => s.filletTopMm, 0.15, medialYSign) ?? undefined,
        filletBottomMm:
            weightedMean(stations, "heelPosterior", (s) => s.filletBotMm, 0.15, medialYSign) ?? undefined,
        cupBowlFactor,
    };
}

export interface StationBandFlare {
    lowerThirdDeg: number;
    upperThirdDeg: number;
}

const PROFILE_REGIONS: Array<Exclude<FlareRegionId, "forefoot">> = [
    "heelPosterior",
    "heelMedial",
    "heelLateral",
    "medialArch",
    "lateralMidfoot",
];

/**
 * Per-region lower-vs-upper-third flare of the stock wall.
 * Curved = flare rises smoothly (bowl). Kink = lip / sculpted flange.
 */
export function diagnoseFlareProfiles(
    stations: StationSample[],
    bands: StationBandFlare[],
    medialYSign: 1 | -1 = 1,
): FlareRegionDiagnostic[] {
    const n = Math.min(stations.length, bands.length);
    const out: FlareRegionDiagnostic[] = [];
    for (const region of PROFILE_REGIONS) {
        let lower = 0;
        let upper = 0;
        let w = 0;
        for (let i = 0; i < n; i++) {
            const st = stations[i]!;
            if (dominantRegion(st.u, st.y, medialYSign) === "forefoot") continue;
            const ww = regionWeights(st.u, st.y, medialYSign)[region];
            if (ww < 0.35) continue;
            const b = bands[i]!;
            if (!Number.isFinite(b.lowerThirdDeg) || !Number.isFinite(b.upperThirdDeg)) continue;
            lower += b.lowerThirdDeg * ww;
            upper += b.upperThirdDeg * ww;
            w += ww;
        }
        const lowerThirdDeg = w > 1e-6 ? lower / w : null;
        const upperThirdDeg = w > 1e-6 ? upper / w : null;
        let kind: FlareProfileKind = "linear";
        let curvature = 0;
        if (lowerThirdDeg != null && upperThirdDeg != null) {
            const delta = lowerThirdDeg - upperThirdDeg;
            if (delta > 8) {
                kind = "curved";
                curvature = Math.max(0, Math.min(1.5, delta / 45));
            } else if (delta < -8) {
                kind = "kink";
                curvature = 0;
            }
        }
        out.push({ region, lowerThirdDeg, upperThirdDeg, kind, curvature });
    }
    return out;
}

export function defaultsFromStockCurves(
    trim: PolyPoint[],
    outline: PolyPoint[],
    bounds: StockWallModel["bounds"],
    wallOffsets?: { topMm: number[]; botMm: number[] },
    bandFlares?: StationBandFlare[],
): WallRegionDefaults {
    const sign = medialYSignFromTopRim(trim, bounds);
    const measured = measureRegionFeatures(trim, outline, bounds, wallOffsets, sign);
    if (bandFlares && bandFlares.length) {
        measured.flareDiagnostics = diagnoseFlareProfiles(
            measureStations(trim, outline, bounds, wallOffsets),
            bandFlares,
            sign,
        );
    }
    const defaults = resolveWallDefaults(measured, "functional");
    defaults.medialYSign = sign;
    return defaults;
}
