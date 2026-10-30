// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import { workpiecesFromDesign } from "@/lib/cnc/compose";
import { buildContourPass } from "@/lib/cnc/contour";
import { generateCncJob } from "@/lib/cnc/export";
import { parseGcode } from "@/lib/cnc/parse";
import {
    evaluatePlacedPart,
    machineXY,
    placementMarginMm,
    placeWorkpieces,
    tableBoundsMm,
    transformOutline,
    worldPoint,
} from "@/lib/cnc/placement";
import { bboxOf, distToPoly } from "@/lib/cnc/polygon";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import { CncExportError, type PlacedPart, type Point } from "@/lib/cnc/types";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import { loadSampleTop, sampleTopWorkpiece, syntheticWorkpiece } from "./helpers";

function first<T>(arr: readonly T[], label: string): T {
    const value = arr[0];
    if (value === undefined) throw new Error(`expected ${label}`);
    return value;
}

/** Finish lap only. Leads share the contour feed; the lead-out is also at Z0, off the centreline. */
function contourFinishXy(gcode: string, contourFeed: number, finish: Point[]): Point[] {
    const parsed = parseGcode(gcode, 50);
    return parsed.moves
        .filter((m) => m.motion === "G1" && m.f === contourFeed && m.z <= 0.02)
        .filter((m) => distToPoly(m.x, m.y, finish) <= 0.002)
        .map((m) => ({ x: m.x, y: m.y }));
}

function finishPolyline(
    outline: Point[],
    placed: PlacedPart,
    profile: ReturnType<typeof cloneProfile>,
): Point[] {
    return buildContourPass(outline, profile).finish.map((p) => machineXY(p, placed, profile));
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
        expect(bb.minX).toBeCloseTo(placementMarginMm(profile, wp.outline, 0), 4);
        expect(placementMarginMm(profile, wp.outline, 0)).toBeGreaterThan(9.5);
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
        const finish = finishPolyline(wp.outline, jobPart, profile);
        const actual = bboxOf(contourFinishXy(job.gcode, profile.topFeeds.contour, finish));
        expectBboxClose(actual, bboxOf(finish), 0.01);
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
        const finish = finishPolyline(wp.outline, jobPart, profile);
        const actual = bboxOf(contourFinishXy(job.gcode, profile.topFeeds.contour, finish));
        expectBboxClose(actual, bboxOf(finish), 0.01);
        const autoJob = generateCncJob(profile, [wp]);
        const autoPart = first(autoJob.placed, "auto part");
        const autoFinish = finishPolyline(wp.outline, autoPart, profile);
        const autoBb = bboxOf(contourFinishXy(autoJob.gcode, profile.topFeeds.contour, autoFinish));
        expect(actual.minX - autoBb.minX).toBeCloseTo(12.5, 2);
        expect(actual.minY - autoBb.minY).toBeCloseTo(3.25, 2);
    });

    test("US M9 pair stays green in the second pocket when table length is a stale 130 mm", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        profile.tableLengthMm = 130.175;
        expect(tableBoundsMm(profile).length).toBeCloseTo(260.35, 6);
        const left = syntheticWorkpiece(profile, "left");
        left.outline = [
            { x: 3.8, y: 0 },
            { x: 3.8 + 276.9, y: 0 },
            { x: 3.8 + 276.9, y: 91.7 },
            { x: 3.8, y: 91.7 },
        ];
        const right = syntheticWorkpiece(profile, "right");
        right.outline = left.outline.map((p) => ({ ...p }));
        const placed = placeWorkpieces(profile, [left, right], [], { validate: false });
        expect(placed).toHaveLength(2);
        const rightPart = placed.find((p) => p.side === "right");
        if (!rightPart) throw new Error("expected right part");
        expect(rightPart.pocketIndex).toBe(1);
        expect(rightPart.tx).toBeCloseTo(placementMarginMm(profile, right.outline, 0) - 3.8, 2);
        const issue = evaluatePlacedPart(rightPart, profile);
        expect(issue.ok).toBe(true);
        for (const part of placed) {
            expect(evaluatePlacedPart(part, profile).ok).toBe(true);
        }
    });

    test("SAMPLE_Top L+R default left-edge placement is green in both pockets", async () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const left = await sampleTopWorkpiece("left", profile, false);
        const right = await sampleTopWorkpiece("right", profile, false);
        const placed = placeWorkpieces(profile, [left, right], [], { validate: false });
        expect(placed).toHaveLength(2);
        for (const part of placed) {
            const world = bboxOf(transformOutline(part.outline, part));
            const local = bboxOf(part.outline);
            const issue = evaluatePlacedPart(part, profile);
            if (!issue.ok) {
                throw new Error(
                    `${part.side} ${issue.reason} tx=${part.tx.toFixed(2)} ty=${part.ty.toFixed(2)} pocket=${part.pocketIndex} local=${(local.maxX - local.minX).toFixed(1)}x${(local.maxY - local.minY).toFixed(1)} world=${(world.maxX - world.minX).toFixed(1)}x${(world.maxY - world.minY).toFixed(1)} [${world.minX.toFixed(2)},${world.maxX.toFixed(2)}]x[${world.minY.toFixed(2)},${world.maxY.toFixed(2)}] margin=${placementMarginMm(profile).toFixed(1)}`,
                );
            }
            expect(issue.ok).toBe(true);
            expect(part.pocketIndex).toBe(part.side === "left" ? 0 : 1);
        }
    }, 60_000);

    test("workpiecesFromDesign US M9 SAMPLE_Top L+R default is green in both pockets", async () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const design = createDesignWithStockPlaceholder();
        design.method = "milling_3axis";
        const raw = await loadSampleTop();
        const parts = await workpiecesFromDesign(design, ["left", "right"], profile, async (side) => {
            const geo = raw.clone();
            return side === "right" ? mirrorGeometry(geo) : geo;
        });
        expect(parts).toHaveLength(2);
        const placed = placeWorkpieces(profile, parts, [], { validate: false });
        expect(placed).toHaveLength(2);
        for (const part of placed) {
            const issue = evaluatePlacedPart(part, profile);
            if (!issue.ok) {
                throw new Error(
                    `${part.side} ${issue.reason} tx=${part.tx.toFixed(2)} ty=${part.ty.toFixed(2)}`,
                );
            }
            expect(issue.ok).toBe(true);
        }
        raw.dispose();
    }, 60_000);

    test("evaluatePlacedPart is red when max height exceeds the block depth", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        profile.materialHeightMm = 5;
        const wp = syntheticWorkpiece(profile, "left");
        expect(wp.zMax).toBeGreaterThan(profile.materialHeightMm);
        const placed = first(placeWorkpieces(profile, [wp], [], { validate: false }), "placed");
        expect(placed.zMax).toBe(wp.zMax);
        const issue = evaluatePlacedPart(placed, profile);
        expect(issue.ok).toBe(false);
        expect(issue.reason).toMatch(/block depth/i);
        expect(issue.reason).toMatch(/5/);
    });

    test("placeWorkpieces validate:false still returns too-tall parts for mill preview", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        profile.materialHeightMm = 5;
        const wp = syntheticWorkpiece(profile, "left");
        const placed = placeWorkpieces(profile, [wp], [], { validate: false });
        expect(placed).toHaveLength(1);
        expect(first(placed, "placed").zMax).toBeGreaterThan(5);
        expect(() => placeWorkpieces(profile, [wp])).toThrow(CncExportError);
        try {
            placeWorkpieces(profile, [wp]);
        } catch (e) {
            expect((e as CncExportError).code).toBe("too_tall");
        }
    });

    test("orbit mesh XY matches 2D worldPoint at the same tx/ty/rotation", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = syntheticWorkpiece(profile, "left");
        const placed = first(
            placeWorkpieces(profile, [wp], [{ side: wp.side, rotationDeg: 37.5 }]),
            "placed",
        );
        const rad = (placed.rotationDeg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        for (const p of placed.outline) {
            const dx = p.x - placed.cx;
            const dy = p.y - placed.cy;
            const orbitX = placed.cx + dx * cos - dy * sin + placed.tx;
            const orbitY = placed.cy + dx * sin + dy * cos + placed.ty;
            const world = worldPoint(p, placed);
            expect(orbitX).toBeCloseTo(world.x, 10);
            expect(orbitY).toBeCloseTo(world.y, 10);
        }
    });

    test("workpiecesFromDesign keeps SAMPLE_Top composed mesh with contour for mill orbit", async () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const design = createDesignWithStockPlaceholder();
        design.method = "milling_3axis";
        const raw = await loadSampleTop();
        const parts = await workpiecesFromDesign(design, ["left", "right"], profile, async (side) => {
            const geo = raw.clone();
            return side === "right" ? mirrorGeometry(geo) : geo;
        });
        expect(parts).toHaveLength(2);
        for (const part of parts) {
            const mesh = part.mesh;
            if (!mesh) throw new Error(`${part.side} missing orbit mesh`);
            const pos = mesh.getAttribute("position");
            if (!pos) throw new Error(`${part.side} mesh has no position`);
            expect(pos.count).toBeGreaterThan(100);
            let minZ = Infinity;
            let maxZ = -Infinity;
            for (let i = 0; i < pos.count; i++) {
                const z = pos.getZ(i);
                minZ = Math.min(minZ, z);
                maxZ = Math.max(maxZ, z);
            }
            expect(maxZ - minZ).toBeGreaterThan(2);
            expect(maxZ).toBeLessThanOrEqual(profile.materialHeightMm);
            expect(Math.abs(maxZ - part.zMax)).toBeLessThan(1.5);
        }
        const placed = placeWorkpieces(profile, parts, [], { validate: false });
        expect(placed).toHaveLength(2);
        for (const part of placed) {
            expect(part.mesh).toBe(parts.find((p) => p.side === part.side)?.mesh);
            expect(evaluatePlacedPart(part, profile).ok).toBe(true);
        }
        for (const part of parts) part.mesh?.dispose();
        raw.dispose();
    }, 60_000);

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
