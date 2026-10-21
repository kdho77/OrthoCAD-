// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { buildContourPass } from "@/lib/cnc/contour";
import { dropCutterZ } from "@/lib/cnc/drop-cutter";
import { generateCncJob } from "@/lib/cnc/export";
import { type ParsedMove, parseGcode } from "@/lib/cnc/parse";
import { localPoint } from "@/lib/cnc/placement";
import { bboxOf, distToPoly, perimeter, signedArea } from "@/lib/cnc/polygon";
import { cloneProfile, IDAHO_PROFILE, toolRadiusMm } from "@/lib/cnc/profile";
import { acrossWidthGapMm, measureSpiral, planCenterSpiral, type XyPoint } from "@/lib/cnc/spiral";
import type { MillingProfile, PlacedPart, Point } from "@/lib/cnc/types";
import { syntheticWorkpiece } from "./helpers";

function distOpen(p: XyPoint, poly: XyPoint[]): number {
    if (poly.length === 0) return Infinity;
    if (poly.length === 1) return Math.hypot(p.x - poly[0]!.x, p.y - poly[0]!.y);
    let best = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i]!;
        const b = poly[i + 1]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
        best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t)));
    }
    return best;
}

function peanut(): Point[] {
    return [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 12 },
        { x: 42, y: 12 },
        { x: 42, y: 0 },
        { x: 72, y: 0 },
        { x: 72, y: 30 },
        { x: 42, y: 30 },
        { x: 42, y: 18 },
        { x: 30, y: 18 },
        { x: 30, y: 30 },
        { x: 0, y: 30 },
    ];
}

function cuttingPasses(moves: ParsedMove[]): ParsedMove[][] {
    const passes: ParsedMove[][] = [];
    let cur: ParsedMove[] = [];
    for (const m of moves) {
        if (m.motion === "G0") {
            if (cur.length) passes.push(cur);
            cur = [];
        } else {
            cur.push(m);
        }
    }
    if (cur.length) passes.push(cur);
    return passes;
}

function machineToLocal(x: number, y: number, part: PlacedPart, profile: MillingProfile): Point {
    const world = {
        x: profile.zeroX === "right" ? profile.tableWidthMm - x : x,
        y: profile.zeroY === "back" ? profile.tableLengthMm - y : y,
        z: 0,
    };
    return localPoint(world, part);
}

describe("center-out spiral", () => {
    test("first point, monotonic offset, clockwise rings, split warning", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = syntheticWorkpiece(profile, "left");
        const plan = planCenterSpiral(wp.outline, profile, "ball");
        expect(plan.samples.length).toBeGreaterThan(100);
        expect(plan.stepoverMm).toBeCloseTo(1.4, 6);
        const first = plan.samples[0];
        if (!first) throw new Error("empty spiral");
        const bb = bboxOf(wp.outline);
        const measured = measureSpiral(plan.samples, wp.outline);
        expect(Math.abs(first.x - (bb.minX + bb.maxX) / 2)).toBeLessThan(0.05);
        expect(Math.abs(first.y - (bb.minY + bb.maxY) / 2)).toBeLessThan(0.05);
        expect(distOpen(first, plan.medial)).toBeLessThan(1e-6);
        expect(signedArea(plan.innermostRing)).toBeLessThanOrEqual(1e-6);
        expect(measured.clockwise).toBe(true);
        expect(measured.laps).toBeGreaterThan(10);
        expect(measured.laps).toBeLessThan(40);
        expect(measured.widthPitchMm).toBeGreaterThan(0.6);
        expect(measured.acrossWidthGapMm).toBeLessThanOrEqual(0.75);
        let maxIndex = 0;
        let comp = -1;
        let last = -Infinity;
        for (const s of plan.samples) {
            if (s.offsetIndex > maxIndex) maxIndex = s.offsetIndex;
            if (s.component !== comp || s.componentStart) {
                comp = s.component;
                last = s.offsetIndex;
                continue;
            }
            expect(s.offsetIndex).toBeGreaterThanOrEqual(last - 1e-6);
            last = s.offsetIndex;
        }
        expect(maxIndex).toBeGreaterThan(8);

        const split = planCenterSpiral(peanut(), profile, "ball");
        expect(split.warnings.some((w) => w.includes("offset split into") && w.includes("center-out"))).toBe(
            true,
        );
        const ids = new Set(split.samples.map((s) => s.component));
        expect(ids.size).toBeGreaterThan(1);
    });

    test("straight plunge, across-width coverage, order, perimeter Z30 to Z0", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const left = syntheticWorkpiece(profile, "left");
        const right = syntheticWorkpiece(profile, "right");
        const job = generateCncJob(profile, [right, left]);
        const g = job.gcode;
        const iLs = g.indexOf("; surface left");
        const iRs = g.indexOf("; surface right");
        const iLp = g.indexOf("; perimeter left");
        const iRp = g.indexOf("; perimeter right");
        expect(iLs).toBeGreaterThan(-1);
        expect(iLs).toBeLessThan(iRs);
        expect(iRs).toBeLessThan(iLp);
        expect(iLp).toBeLessThan(iRp);
        expect(g.slice(iRs, iLp)).toContain("M3 S24000");

        const parsed = parseGcode(g, profile.freeMovementHeightMm);
        for (const m of parsed.moves) {
            if (m.motion === "G0") expect(m.z).toBeCloseTo(50, 3);
        }
        const passes = cuttingPasses(parsed.moves);
        const surface = passes.filter((p) => Math.min(...p.map((m) => m.z)) > 0.5);
        const perimeterPasses = passes.filter((p) => Math.min(...p.map((m) => m.z)) <= 0.5);
        expect(surface.length).toBe(2);
        expect(perimeterPasses.length).toBe(2);
        const radius = toolRadiusMm(profile.toolpathCutter.diameterMm);

        for (const pass of surface) {
            expect(pass.every((m) => m.motion === "G1")).toBe(true);
            const plunge = pass[0]!;
            expect(Math.hypot(plunge.x - plunge.from.x, plunge.y - plunge.from.y)).toBeLessThan(0.05);
            expect(plunge.from.z).toBeCloseTo(50, 3);
            expect(plunge.f).toBe(3500);
            expect(plunge.z).toBeLessThan(plunge.from.z - 1);
            let part = job.placed[0]!;
            let best = Infinity;
            for (const candidate of job.placed) {
                const local = machineToLocal(plunge.x, plunge.y, candidate, profile);
                const d = distToPoly(local.x, local.y, candidate.outline);
                if (d < best) {
                    best = d;
                    part = candidate;
                }
            }
            const locals: XyPoint[] = [];
            let sawFinish = false;
            for (const m of pass) {
                const local = machineToLocal(m.x, m.y, part, profile);
                locals.push(local);
                const drop = dropCutterZ(part.heightmap, local.x, local.y, radius, "ball");
                const dxy = Math.hypot(m.x - m.from.x, m.y - m.from.y);
                if (dxy < 0.01 && m.z > m.from.z + 0.01) {
                    throw new Error(`vertical lift ${m.z - m.from.z} at line ${m.line}`);
                }
                if (m === plunge) continue;
                expect(m.z).toBeGreaterThanOrEqual(drop - 0.02);
                expect(m.z).toBeLessThanOrEqual(drop + 0.02);
                // The plunge is the only F3500. Steep climbs stay at the surface feed.
                if (m.f) expect(m.f).toBe(36000);
                if (m.f === 36000) sawFinish = true;
            }
            expect(sawFinish).toBe(true);
            expect(acrossWidthGapMm(locals, part.outline)).toBeLessThanOrEqual(0.75);
        }

        for (const pass of perimeterPasses) {
            let lastF = 0;
            let plunged = false;
            for (const m of pass) {
                if (m.f) lastF = m.f;
                const dxy = Math.hypot(m.x - m.from.x, m.y - m.from.y);
                const dz = m.z - m.from.z;
                if (dxy < 0.01 && dz > 0.01) throw new Error(`perimeter lift at line ${m.line}`);
                if (!plunged && dxy < 0.05 && dz < -1) {
                    expect(lastF).toBe(3500);
                    expect(m.from.z).toBeCloseTo(50, 3);
                    expect(m.z).toBeCloseTo(profile.materialHeightMm, 3);
                    plunged = true;
                    continue;
                }
                expect(dz).toBeLessThanOrEqual(0.01);
                expect(lastF).toBe(2500);
            }
            expect(plunged).toBe(true);
            expect(Math.min(...pass.map((m) => m.z))).toBeLessThan(0.01);
        }

        const pass = buildContourPass(left.outline, profile);
        expect(pass.leadIn[0]?.z).toBeCloseTo(profile.materialHeightMm, 3);
        expect(pass.helix[0]?.z).toBeCloseTo(profile.materialHeightMm, 3);
        expect(pass.helix[pass.helix.length - 1]?.z).toBeCloseTo(0, 3);
        expect(pass.finish.every((p) => Math.abs(p.z ?? 1) < 1e-6)).toBe(true);
        expect(signedArea(pass.finish)).toBeGreaterThan(0);
        const bandBb = bboxOf(pass.band.centreline);
        const helixStart = pass.helix[0];
        if (!helixStart) throw new Error("empty helix");
        expect(helixStart.x).toBeGreaterThan(bandBb.minX + 0.55 * (bandBb.maxX - bandBb.minX));
        expect(helixStart.y).toBeLessThan(bandBb.minY + 0.2 * (bandBb.maxY - bandBb.minY));
        const per = perimeter(pass.band.centreline);
        let run = 0;
        let prev = pass.helix[0];
        for (const p of pass.helix) {
            if (!prev) break;
            run += Math.hypot(p.x - prev.x, p.y - prev.y);
            prev = p;
        }
        expect(run).toBeGreaterThan(per * 1.95);
        expect(run).toBeLessThan(per * 2.08);
    });

    test("warns when the center entry is deeper than 25 mm", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        profile.materialHeightMm = 40;
        const job = generateCncJob(profile, [syntheticWorkpiece(profile, "left")]);
        expect(job.warnings.some((w) => w.includes("exceeds 25"))).toBe(true);
    });

    test("across-width gap of the synthetic dome is within 0.75 mm", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = syntheticWorkpiece(profile);
        const plan = planCenterSpiral(wp.outline, profile, "ball");
        const gap = acrossWidthGapMm(plan.samples, wp.outline);
        expect(gap).toBeLessThanOrEqual(0.75);
    });
});
