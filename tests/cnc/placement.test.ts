// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { buildContourPass } from "@/lib/cnc/contour";
import { generateCncJob } from "@/lib/cnc/export";
import { parseGcode } from "@/lib/cnc/parse";
import {
    evaluatePlacedPart,
    machineXY,
    placementMarginMm,
    placeWorkpieces,
    transformOutline,
} from "@/lib/cnc/placement";
import { bboxOf } from "@/lib/cnc/polygon";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import { CncExportError, type PlacedPart, type Point } from "@/lib/cnc/types";
import { syntheticWorkpiece } from "./helpers";

function first<T>(arr: readonly T[], label: string): T {
    const value = arr[0];
    if (value === undefined) throw new Error(`expected ${label}`);
    return value;
}

function contourFinishXy(gcode: string, contourFeed: number): Point[] {
    const parsed = parseGcode(gcode, 50);
    return parsed.moves
        .filter((m) => m.motion === "G1" && m.f === contourFeed)
        .map((m) => ({ x: m.x, y: m.y }));
}

function expectBboxClose(
    actual: { minX: number; maxX: number; minY: number; maxY: number },
    expected: { minX: number; maxX: number; minY: number; maxY: number },
    eps = 0.01,
): void {
    expect(Math.abs(actual.minX - expected.minX)).toBeLessThanOrEqual(eps);
    expect(Math.abs(actual.maxX - expected.maxX)).toBeLessThanOrEqual(eps);
    expect(Math.abs(actual.minY - expected.minY)).toBeLessThanOrEqual(eps);
    expect(Math.abs(actual.maxY - expected.maxY)).toBeLessThanOrEqual(eps);
}

function expectedContourBbox(outline: Point[], placed: PlacedPart, profile: ReturnType<typeof cloneProfile>) {
    const finish = buildContourPass(outline, profile).finish.map((p) => machineXY(p, placed, profile));
    return bboxOf(finish);
}

describe("CNC mill placement", () => {
    test("defaults heel toward X0 and left-edge auto-position", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = syntheticWorkpiece(profile, "left");
        const placed = placeWorkpieces(profile, [wp]);
        expect(placed).toHaveLength(1);
        const part = first(placed, "placed part");
        expect(part.rotationDeg).toBe(0);
        expect(part.pocketIndex).toBe(0);
        const world = transformOutline(wp.outline, part);
        const bb = bboxOf(world);
        expect(bb.minX).toBeCloseTo(placementMarginMm(profile), 6);
        const pocket = first(profile.pockets, "pocket");
        expect(bb.minY).toBeGreaterThan(pocket.y - 1e-6);
        expect(bb.maxY).toBeLessThan(pocket.y + pocket.length + 1e-6);
    });

    test.each([
        0, 90, 180, 37.5,
    ])("exported G-code contour bbox matches on-screen placement at rotation %s° within 0.01 mm", (rotationDeg) => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = syntheticWorkpiece(profile, "left");
        const placements = [{ side: wp.side, rotationDeg }];
        const placed = first(placeWorkpieces(profile, [wp], placements), "placed");
        expect(placed.rotationDeg).toBe(rotationDeg);
        const job = generateCncJob(profile, [wp], { placements });
        const jobPart = first(job.placed, "job part");
        expect(jobPart.rotationDeg).toBe(rotationDeg);
        expect(jobPart.tx).toBeCloseTo(placed.tx, 6);
        expect(jobPart.ty).toBeCloseTo(placed.ty, 6);
        const actual = bboxOf(contourFinishXy(job.gcode, profile.topFeeds.contour));
        const expected = expectedContourBbox(wp.outline, jobPart, profile);
        expectBboxClose(actual, expected, 0.01);
    });

    test("chosen x/y offset feeds G-code bbox exactly", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = syntheticWorkpiece(profile, "left");
        const base = first(placeWorkpieces(profile, [wp]), "base");
        const shifted = {
            side: wp.side,
            tx: base.tx + 12.5,
            ty: base.ty + 3.25,
            rotationDeg: 0,
        };
        const job = generateCncJob(profile, [wp], { placements: [shifted] });
        const jobPart = first(job.placed, "job part");
        expect(jobPart.tx).toBeCloseTo(base.tx + 12.5, 6);
        expect(jobPart.ty).toBeCloseTo(base.ty + 3.25, 6);
        const actual = bboxOf(contourFinishXy(job.gcode, profile.topFeeds.contour));
        const expected = expectedContourBbox(wp.outline, jobPart, profile);
        expectBboxClose(actual, expected, 0.01);
        const autoJob = generateCncJob(profile, [wp]);
        const autoBb = bboxOf(contourFinishXy(autoJob.gcode, profile.topFeeds.contour));
        expect(actual.minX - autoBb.minX).toBeCloseTo(12.5, 2);
        expect(actual.minY - autoBb.minY).toBeCloseTo(3.25, 2);
    });

    test("drag out of pocket is red in preview and export errors with no_fit", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = syntheticWorkpiece(profile, "left");
        const auto = first(placeWorkpieces(profile, [wp]), "auto");
        const bad = {
            side: wp.side,
            tx: auto.tx + 400,
            ty: auto.ty,
            rotationDeg: 0,
        };
        const preview = first(placeWorkpieces(profile, [wp], [bad], { validate: false }), "preview");
        const issue = evaluatePlacedPart(preview, profile);
        expect(issue.ok).toBe(false);
        expect(issue.reason).toMatch(/pocket|table/i);
        try {
            generateCncJob(profile, [wp], { placements: [bad] });
            expect.unreachable();
        } catch (e) {
            expect(e).toBeInstanceOf(CncExportError);
            expect((e as CncExportError).code).toBe("no_fit");
            expect((e as CncExportError).message).toMatch(/pocket|table/i);
        }
    });
});
