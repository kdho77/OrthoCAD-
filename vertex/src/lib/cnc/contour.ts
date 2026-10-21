// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type BallBandGeometry, ballBandGeometry, UNCUT_CORNER_TOL_MM } from "./band";
import { densifyArc, perimeter, signedArea, tangentAt, unit } from "./polygon";
import { skinZ, toolRadiusMm } from "./profile";
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

function tangentCw(pts: Point[], i: number): Point {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    return unit(b.x - a.x, b.y - a.y);
}

/**
 * Outward normal of a CW loop (negative signed area).
 * Walking CW, the interior is on the right, so outward is to the left of travel.
 */
function outwardCw(t: Point): Point {
    return { x: -t.y, y: t.x };
}

/** Keep every vertex (no corner cutting) and split edges longer than maxSegMm. */
function densifyKeepVertices(pts: Point[], maxSegMm: number): Point[] {
    if (pts.length < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
    const maxSeg = Math.max(0.05, maxSegMm);
    const out: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        out.push({ x: a.x, y: a.y });
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.ceil(len / maxSeg);
        for (let k = 1; k < n; k++) {
            const t = k / n;
            out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
    }
    return out;
}

/** CW, but the first vertex stays the heel so the lead-in does not jump. */
function ensureCwKeepStart(pts: Point[]): Point[] {
    if (pts.length < 3 || signedArea(pts) <= 0) return pts.map((p) => ({ x: p.x, y: p.y }));
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
    const path = ensureCwKeepStart(densifyKeepVertices(source, Math.max(0.35, profile.sampleMm)));
    const zEnd = skinZ(profile);
    const zStart = profile.materialHeightMm;
    const maxStep = profile.layeredEnabled ? profile.layeredMm : 15;
    const zs = helicalLevels(zStart, zEnd, maxStep);
    const nLaps = zs.length - 1;
    const per = perimeter(path);
    const t0 = tangentCw(path, 0);
    const n0 = outwardCw(t0);
    const p0 = path[0]!;
    const leadIn = leadArc(p0, t0, n0, LEAD_RADIUS_MM, profile.chordTolMm, true).map((p) => ({
        ...p,
        z: zStart,
    }));
    const tEnd = tangentAt(path, 0);
    const nEnd = outwardCw(tEnd);
    const leadOut = leadArc(p0, tEnd, nEnd, LEAD_RADIUS_MM, profile.chordTolMm, false).map((p) => ({
        ...p,
        z: zEnd,
    }));

    const helix: Point[] = [];
    const totalXy = nLaps * per;
    let travelled = 0;
    for (let lap = 0; lap < nLaps; lap++) {
        for (let i = 0; i < path.length; i++) {
            const p = path[i]!;
            const z = zStart + ((zEnd - zStart) * travelled) / totalXy;
            helix.push({ x: p.x, y: p.y, z });
            const q = path[(i + 1) % path.length]!;
            travelled += Math.hypot(q.x - p.x, q.y - p.y);
        }
    }
    helix.push({ x: path[0]!.x, y: path[0]!.y, z: zEnd });

    const finish: Point[] = path.map((p) => ({ x: p.x, y: p.y, z: zEnd }));
    finish.push({ x: path[0]!.x, y: path[0]!.y, z: zEnd });

    return { leadIn, helix, finish, leadOut, warnings, band };
}
