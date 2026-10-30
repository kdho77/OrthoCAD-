// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { type BallBandGeometry, ballBandGeometry, UNCUT_CORNER_TOL_MM } from "./band";
import { densifyArc, resampleToSpacing, signedArea, TOOLPATH_SPACING_MM, tangentAt, unit } from "./polygon";
import { toolRadiusMm } from "./profile";
import type { MillingProfile, Point } from "./types";

/** Tangent lead arc radius. The tool disk around it is part of the footprint. */
export const LEAD_RADIUS_MM = 2;

export interface ContourPass {
    leadIn: Point[];
    helix: Point[];
    finish: Point[];
    leadOut: Point[];
    warnings: string[];
    /** Same band the visualizer draws. */
    band: BallBandGeometry;
}

function tangentTravel(pts: Point[], i: number): Point {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    return unit(b.x - a.x, b.y - a.y);
}

/**
 * Outward normal of a CCW loop (positive signed area).
 * Walking CCW, the interior is on the left, so outward is to the right of travel.
 */
function outwardCcw(t: Point): Point {
    return { x: t.y, y: -t.x };
}

/** CCW, like the Windows perimeter. The first vertex stays the toe/lateral start. */
function ensureCcwKeepStart(pts: Point[]): Point[] {
    if (pts.length < 3 || signedArea(pts) >= 0) return pts.map((p) => ({ x: p.x, y: p.y }));
    const rev = pts.map((p) => ({ x: p.x, y: p.y })).reverse();
    const first = rev.pop();
    if (first) rev.unshift(first);
    return rev;
}

function leadArc(
    startOnPath: Point,
    t: Point,
    nOut: Point,
    radius: number,
    chord: number,
    leadIn: boolean,
): Point[] {
    const cx = startOnPath.x + nOut.x * radius;
    const cy = startOnPath.y + nOut.y * radius;
    const aP = Math.atan2(startOnPath.y - cy, startOnPath.x - cx);
    const aS = Math.atan2(
        t.y * (leadIn ? 1 : -1) * radius + nOut.y * 0 - 0,
        t.x * (leadIn ? 1 : -1) * radius,
    );
    // Quarter-circle from outside onto the path (lead-in) or off the path (lead-out).
    const start = leadIn
        ? {
              x: startOnPath.x - t.x * radius + nOut.x * radius,
              y: startOnPath.y - t.y * radius + nOut.y * radius,
          }
        : {
              x: startOnPath.x + t.x * radius + nOut.x * radius,
              y: startOnPath.y + t.y * radius + nOut.y * radius,
          };
    const a0 = Math.atan2(start.y - cy, start.x - cx);
    const a1 = aP;
    let span = a1 - a0;
    while (span > Math.PI) span -= Math.PI * 2;
    while (span < -Math.PI) span += Math.PI * 2;
    const pts = densifyArc(cx, cy, radius, a0, a0 + span, chord);
    if (leadIn) {
        pts[pts.length - 1] = { x: startOnPath.x, y: startOnPath.y };
    } else {
        pts[0] = { x: startOnPath.x, y: startOnPath.y };
    }
    void aS;
    return pts;
}

export function helicalLevels(zStart: number, zEnd: number, maxStep: number): number[] {
    const span = zStart - zEnd;
    const n = Math.max(1, Math.ceil(span / Math.max(1e-6, maxStep)));
    const step = span / n;
    const zs = [zStart];
    for (let i = 1; i <= n; i++) zs.push(zStart - step * i);
    return zs;
}

/** Perimeter tip finishes on the table. The on-screen band legend still reads the 1 mm skin. */
export const PERIMETER_FLOOR_MM = 0;

/** Windows ramps the perimeter in two laps, then one flat lap. */
export const PERIMETER_RAMP_LAPS = 2;

function traceLaps(path: Point[], laps: number, z0: number, z1: number): Point[] {
    if (laps <= 0 || path.length < 3) return [];
    const n = path.length;
    let per = 0;
    for (let i = 0; i < n; i++) {
        const a = path[i]!;
        const b = path[(i + 1) % n]!;
        per += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const total = Math.max(1e-9, laps * per);
    const out: Point[] = [{ x: path[0]!.x, y: path[0]!.y, z: z0 }];
    let travelled = 0;
    for (let lap = 0; lap < laps; lap++) {
        for (let i = 0; i < n; i++) {
            const a = path[i]!;
            const b = path[(i + 1) % n]!;
            travelled += Math.hypot(b.x - a.x, b.y - a.y);
            const u = Math.min(1, travelled / total);
            out.push({ x: b.x, y: b.y, z: z0 + (z1 - z0) * u });
        }
    }
    return out;
}

export function buildContourPass(outline: Point[], profile: MillingProfile): ContourPass {
    const warnings: string[] = [];
    const radius = toolRadiusMm(profile.contourCutter.diameterMm);
    const band = ballBandGeometry(outline, radius, profile.chordTolMm, profile.topOffsetMm);
    if (profile.contourCutter.type === "ball") {
        warnings.push("Contour tool is a ball mill — walls will not be vertical in the lowest 5 mm.");
    }
    if (band.maxUncutMm > UNCUT_CORNER_TOL_MM) {
        const spans = band.uncutCorners.length > 0 ? band.uncutCorners : [{ deviationMm: band.maxUncutMm }];
        for (const corner of spans) {
            warnings.push(
                `uncut corner: deviation ${corner.deviationMm.toFixed(3)} mm (concavity tighter than R${radius.toFixed(3)})`,
            );
        }
    }
    const source = band.centreline.length >= 3 ? band.centreline : outline;
    const oriented = ensureCcwKeepStart(source);
    // Leads keep the dense-centreline tangent. Laps are about 1 mm apart.
    // 0.012 mm is as far as the chord can leave the centreline before the R5
    // wall profile exceeds its 0.05 mm gate. The surface pass uses 0.05 mm.
    const path = resampleToSpacing(oriented, TOOLPATH_SPACING_MM, 0.012, true);
    // Rapid to Z clearance, then a straight plunge to the stock top. The helix itself
    // is exactly two laps from that Z down to the table, plus one flat lap.
    const zStock = profile.materialHeightMm;
    const zFloor = PERIMETER_FLOOR_MM;
    const t0 = tangentTravel(oriented, 0);
    const n0 = outwardCcw(t0);
    const p0 = path[0] ?? oriented[0]!;
    const leadIn = leadArc(p0, t0, n0, LEAD_RADIUS_MM, profile.chordTolMm, true).map((p) => ({
        ...p,
        z: zStock,
    }));
    const tEnd = tangentAt(oriented, 0);
    const nEnd = outwardCcw(tEnd);
    const leadOut = leadArc(p0, tEnd, nEnd, LEAD_RADIUS_MM, profile.chordTolMm, false).map((p) => ({
        ...p,
        z: zFloor,
    }));

    const helix = traceLaps(path, PERIMETER_RAMP_LAPS, zStock, zFloor);
    const finish = traceLaps(path, 1, zFloor, zFloor);

    return { leadIn, helix, finish, leadOut, warnings, band };
}
