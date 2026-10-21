// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { buildContourPass } from "@/lib/cnc/contour";
import { dropCutterZ } from "@/lib/cnc/drop-cutter";
import { generateCncJob } from "@/lib/cnc/export";
import { type ParsedMove, parseGcode } from "@/lib/cnc/parse";
import { localPoint } from "@/lib/cnc/placement";
import { distToPoly, perimeter, signedArea } from "@/lib/cnc/polygon";
import { cloneProfile, IDAHO_PROFILE, toolRadiusMm } from "@/lib/cnc/profile";
import { planCenterSpiral, type XyPoint } from "@/lib/cnc/spiral";
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

/** Largest distance from an inside heightmap cell to the path. */
export function interiorGapMm(part: PlacedPart, pts: XyPoint[]): number {
    const pitch = 0.5;
    const buckets = new Map<number, XyPoint[]>();
    const key = (ix: number, iy: number) => ix * 100003 + iy;
    for (const p of pts) {
        const k = key(Math.floor(p.x / pitch), Math.floor(p.y / pitch));
        const list = buckets.get(k);
        if (list) list.push(p);
        else buckets.set(k, [p]);
    }
    const hm = part.heightmap;
    let worst = 0;
    for (let iy = 0; iy < hm.ny; iy++) {
        const y = hm.originY + iy * hm.cell;
        for (let ix = 0; ix < hm.nx; ix++) {
            if (hm.inside[iy * hm.nx + ix] !== 1) continue;
            const x = hm.originX + ix * hm.cell;
            const bx = Math.floor(x / pitch);
            const by = Math.floor(y / pitch);
            let best = Infinity;
            for (let dy = -4; dy <= 4; dy++) {
                for (let dx = -4; dx <= 4; dx++) {
                    const list = buckets.get(key(bx + dx, by + dy));
                    if (!list) continue;
                    for (const p of list) best = Math.min(best, Math.hypot(p.x - x, p.y - y));
                }
            }
            if (best > worst) worst = best;
        }
    }
    return worst;
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
        const dMed = distOpen(first, plan.medial);
        const dRing = plan.innermostRing.length ? distToPoly(first.x, first.y, plan.innermostRing) : Infinity;
        expect(Math.min(dMed, dRing)).toBeLessThanOrEqual(plan.stepoverMm + 1e-6);
        expect(signedArea(plan.innermostRing)).toBeLessThanOrEqual(1e-6);
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

    test("no rapid or lift inside a pass, entry ≤ 15°, coverage, order, perimeter Z0", () => {
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

        const parsed = parseGcode(g, profile.freeMovementHeightMm);
        for (const m of parsed.moves) {
            if (m.motion === "G0") expect(m.z).toBeCloseTo(50, 3);
        }
        const passes = cuttingPasses(parsed.moves);
        const surface = passes.filter((p) => Math.min(...p.map((m) => m.z)) > 0.5);
        const perimeterPasses = passes.filter((p) => Math.min(...p.map((m) => m.z)) <= 0.5);
        expect(surface.length).toBe(2);
        expect(perimeterPasses.length).toBe(2);
        const tan15 = Math.tan((15 * Math.PI) / 180);
        const radius = toolRadiusMm(profile.toolpathCutter.diameterMm);

        for (const pass of surface) {
            expect(pass.every((m) => m.motion === "G1")).toBe(true);
            const p0 = pass[0]!;
            let part = job.placed[0]!;
            let best = Infinity;
            for (const candidate of job.placed) {
                const local = machineToLocal(p0.x, p0.y, candidate, profile);
                const d = distToPoly(local.x, local.y, candidate.outline);
                if (d < best) {
                    best = d;
                    part = candidate;
                }
            }
            const locals: XyPoint[] = [];
            let sawReduced = false;
            let sawFinish = false;
            for (const m of pass) {
                const f = m.f;
                const local = machineToLocal(m.x, m.y, part, profile);
                const from = machineToLocal(m.from.x, m.from.y, part, profile);
                locals.push(local);
                const drop = dropCutterZ(part.heightmap, local.x, local.y, radius, "ball");
                const dropFrom = dropCutterZ(part.heightmap, from.x, from.y, radius, "ball");
                const dxy = Math.hypot(m.x - m.from.x, m.y - m.from.y);
                if (dxy < 0.01 && m.z > m.from.z + 0.01) {
                    throw new Error(`vertical lift ${m.z - m.from.z} at line ${m.line}`);
                }
                if (m.z > drop + 0.01) {
                    const fromOnSurface = m.from.z <= dropFrom + 0.01;
                    if (fromOnSurface) throw new Error(`lift above drop at line ${m.line}`);
                    if (m.z > m.from.z + 0.01) throw new Error(`ramp climbed at line ${m.line}`);
                    if (dxy > 0.05) {
                        const slope = (m.from.z - m.z) / dxy;
                        expect(slope).toBeLessThanOrEqual(tan15 + 0.02);
                    }
                    expect(f === 3500 || f === 0).toBe(true);
                    sawReduced = true;
                } else {
                    expect(m.z).toBeGreaterThanOrEqual(drop - 0.02);
                    if (f === 36000) sawFinish = true;
                }
            }
            expect(sawReduced).toBe(true);
            expect(sawFinish).toBe(true);
            expect(interiorGapMm(part, locals)).toBeLessThanOrEqual(0.75);
        }

        for (const pass of perimeterPasses) {
            let lastF = 0;
            for (const m of pass) {
                if (m.f) lastF = m.f;
                const dxy = Math.hypot(m.x - m.from.x, m.y - m.from.y);
                const dz = m.z - m.from.z;
                if (dxy < 0.01 && dz > 0.01) throw new Error(`perimeter lift at line ${m.line}`);
                expect(dz).toBeLessThanOrEqual(0.01);
                expect(lastF).toBe(2500);
            }
            expect(Math.min(...pass.map((m) => m.z))).toBeLessThan(0.01);
        }

        const pass = buildContourPass(left.outline, profile);
        expect(pass.leadIn[0]?.z).toBeGreaterThanOrEqual(profile.materialHeightMm + 2 - 1e-6);
        expect(pass.helix[0]?.z).toBeCloseTo(profile.freeMovementHeightMm, 3);
        expect(pass.helix[pass.helix.length - 1]?.z).toBeCloseTo(0, 3);
        expect(pass.finish.every((p) => Math.abs(p.z ?? 1) < 1e-6)).toBe(true);
        const per = perimeter(pass.band.centreline);
        let run = 0;
        let prev = pass.helix[0];
        let inRamp = false;
        for (const p of pass.helix) {
            if (!prev) break;
            if ((prev.z ?? 0) <= profile.materialHeightMm + 1e-3) inRamp = true;
            if (inRamp && prev) run += Math.hypot(p.x - prev.x, p.y - prev.y);
            prev = p;
        }
        expect(run).toBeGreaterThan(per * 1.8);
        expect(run).toBeLessThan(per * 2.25);
    });

    test("warns when the center entry is deeper than 25 mm", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        profile.materialHeightMm = 40;
        const job = generateCncJob(profile, [syntheticWorkpiece(profile, "left")]);
        expect(job.warnings.some((w) => w.includes("exceeds 25"))).toBe(true);
    });

    test("every inside cell of the synthetic dome is within 0.75 mm", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = syntheticWorkpiece(profile);
        const plan = planCenterSpiral(wp.outline, profile, "ball");
        const gap = interiorGapMm({ ...jobPart(wp), heightmap: wp.heightmap } as PlacedPart, plan.samples);
        expect(gap).toBeLessThanOrEqual(0.75);
    });
});

function jobPart(wp: ReturnType<typeof syntheticWorkpiece>): PlacedPart {
    return {
        side: wp.side,
        outline: wp.outline,
        heightmap: wp.heightmap,
        zMin: wp.zMin,
        zMax: wp.zMax,
        tx: 0,
        ty: 0,
        cx: 0,
        cy: 0,
        rotationDeg: 0,
    } as PlacedPart;
}
