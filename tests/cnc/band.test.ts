// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    ballBandGeometry,
    ballHalfWidthMm,
    contourLegend,
    hausdorffClosed,
    UNCUT_CORNER_TOL_MM,
} from "@/lib/cnc/band";
import { buildContourPass } from "@/lib/cnc/contour";
import { ENVELOPE_CLEARANCE_MM, toolFootprintLocal } from "@/lib/cnc/envelope";
import { generateCncJob } from "@/lib/cnc/export";
import { evaluateAllPlacements, placeWorkpieces } from "@/lib/cnc/placement";
import { bboxOf, distToPoly, offsetClosed, pointInPoly } from "@/lib/cnc/polygon";
import { cloneProfile, IDAHO_PROFILE, toolRadiusMm } from "@/lib/cnc/profile";
import { CncExportError, type Point } from "@/lib/cnc/types";
import { syntheticWorkpiece } from "./helpers";

function notchOutline(): Point[] {
    return [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 62, y: 50 },
        { x: 62, y: 36 },
        { x: 58, y: 36 },
        { x: 58, y: 50 },
        { x: 0, y: 50 },
    ];
}

describe("ball contour band geometry", () => {
    test("centreline, outer edge, and inner edge share one Clipper band", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const outline = syntheticWorkpiece(profile).outline;
        const r = toolRadiusMm(profile.contourCutter.diameterMm);
        const band = ballBandGeometry(outline, r, profile.chordTolMm, profile.topOffsetMm);
        const pass = buildContourPass(outline, profile);
        expect(r).toBe(5);
        expect(hausdorffClosed(band.centreline, pass.band.centreline)).toBeLessThanOrEqual(0.01);
        expect(hausdorffClosed(band.outerEdge, pass.band.outerEdge)).toBeLessThanOrEqual(0.01);
        expect(
            hausdorffClosed(band.outerEdge, offsetClosed(outline, 2 * r, profile.chordTolMm)),
        ).toBeLessThanOrEqual(0.01);
        expect(
            hausdorffClosed(band.centreline, offsetClosed(outline, r, profile.chordTolMm)),
        ).toBeLessThanOrEqual(0.01);
        expect(
            hausdorffClosed(offsetClosed(band.centreline, r, profile.chordTolMm), band.outerEdge),
        ).toBeLessThanOrEqual(0.01);
        expect(band.maxUncutMm).toBeLessThanOrEqual(UNCUT_CORNER_TOL_MM);
        expect(band.uncutCorners).toEqual([]);
        expect(hausdorffClosed(band.innerEdge, outline)).toBeLessThanOrEqual(UNCUT_CORNER_TOL_MM);
        expect(contourLegend(profile)).toBe(
            "R5 ball: wall vertical down to Z 6, filleted in the lowest 5 mm. 1 mm skin.",
        );
        expect(ballHalfWidthMm(1, 5, 1)).toBeCloseTo(0, 6);
        expect(ballHalfWidthMm(6, 5, 1)).toBeCloseTo(5, 6);
        expect(ballHalfWidthMm(3.5, 5, 1)).toBeCloseTo(Math.sqrt(25 - 2.5 * 2.5), 6);
    });

    test("concavity tighter than R5 is an uncut corner on the export report", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const outline = notchOutline();
        const band = ballBandGeometry(outline, 5, profile.chordTolMm, profile.topOffsetMm);
        expect(band.maxUncutMm).toBeGreaterThan(UNCUT_CORNER_TOL_MM);
        expect(band.uncutCorners.length).toBeGreaterThan(0);
        const pass = buildContourPass(outline, profile);
        expect(pass.warnings.some((w) => w.toLowerCase().includes("uncut corner"))).toBe(true);
        const wp = syntheticWorkpiece(profile, "left");
        wp.outline = outline;
        const job = generateCncJob(profile, [wp]);
        expect(job.warnings.some((w) => w.toLowerCase().includes("uncut corner"))).toBe(true);
        expect(job.gcode.toLowerCase()).toContain("uncut corner");
    });

    test("auto-position margin comes from the tool envelope, not 9.5", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = syntheticWorkpiece(profile, "left");
        const env = toolFootprintLocal(wp.outline, profile);
        const partBb = bboxOf(wp.outline);
        const envBb = bboxOf(env);
        const leftOverhang = partBb.minX - envBb.minX;
        expect(leftOverhang).toBeGreaterThan(10);
        expect(leftOverhang).toBeLessThan(16);
        const placed = placeWorkpieces(profile, [wp]);
        const part = placed[0];
        if (!part) throw new Error("expected part");
        expect(part.tx).toBeCloseTo(partBb.minX * 0 + leftOverhang + ENVELOPE_CLEARANCE_MM - partBb.minX, 3);
        const lead = buildContourPass(wp.outline, profile).leadIn[0];
        if (!lead) throw new Error("expected lead");
        expect(pointInPoly(lead.x, lead.y, wp.outline)).toBe(false);
        expect(distToPoly(lead.x, lead.y, wp.outline)).toBeGreaterThan(5);

        const right = syntheticWorkpiece(profile, "right");
        const both = placeWorkpieces(profile, [wp, right]);
        const issues = evaluateAllPlacements(both, profile);
        expect(issues.left?.ok).toBe(true);
        expect(issues.right?.ok).toBe(true);

        const huge = syntheticWorkpiece(profile, "left");
        huge.outline = [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 40 },
            { x: 0, y: 40 },
        ];
        expect(() => placeWorkpieces(profile, [huge])).toThrow(CncExportError);
    });
});
