// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { buildContourPass } from "@/lib/cnc/contour";
import { polygonsOverlap } from "@/lib/cnc/envelope";
import { generateCncJob } from "@/lib/cnc/export";
import {
    autoTranslate,
    evaluatePlacedPart,
    machineXY,
    placementMarginMm,
    placeWorkpieces,
    rotatedLocalBbox,
    worldFootprint,
} from "@/lib/cnc/placement";
import { bboxOf, centroid } from "@/lib/cnc/polygon";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import {
    CncExportError,
    type CncWorkpiece,
    type MillingProfile,
    type PlacedPart,
    type Point,
} from "@/lib/cnc/types";
import type { Side } from "@/types";

/** Peavy US M 8, 2X Wide +15 mm outline size. The flat at y = 0 is the outer edge. */
const PEAVY_LENGTH_MM = 251.6;
const PEAVY_WIDTH_MM = 106.94;

function wideOutline(height = PEAVY_WIDTH_MM): Point[] {
    // Toe end of the lateral flat is the max-X point on min Y, so the contour
    // lead-in lands on that widest outer edge.
    const raw: Point[] = [
        { x: 0, y: 44 },
        { x: 16, y: 14 },
        { x: 60, y: 8 },
        { x: 120, y: 3.2 },
        { x: 190, y: 0 },
        { x: 236, y: 0 },
        { x: 248, y: 12 },
        { x: PEAVY_LENGTH_MM, y: 28 },
        { x: 240, y: 72 },
        { x: 205, y: PEAVY_WIDTH_MM },
        { x: 155, y: 100 },
        { x: 90, y: 84 },
        { x: 30, y: 66 },
        { x: 0, y: 50 },
    ];
    if (height === PEAVY_WIDTH_MM) return raw;
    const scale = height / PEAVY_WIDTH_MM;
    return raw.map((p) => ({ x: p.x, y: p.y * scale }));
}

/** Medium US M 9-ish: about 270 mm long and 96 mm wide, inside the pocket at 0°. */
function mediumOutline(): Point[] {
    const length = 270;
    const width = 96;
    const n = 64;
    const outline: Point[] = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        outline.push({
            x: (length / 2) * (1 + Math.cos(a)),
            y: (width / 2) * (1 + Math.sin(a)),
        });
    }
    return outline;
}

function blockOutline(length: number, width: number): Point[] {
    return [
        { x: 0, y: 0 },
        { x: length, y: 0 },
        { x: length, y: width },
        { x: 0, y: width },
    ];
}

function workpiece(side: Side, outline: Point[]): CncWorkpiece {
    const bb = bboxOf(outline);
    return {
        side,
        outline,
        heightmap: {
            originX: bb.minX,
            originY: bb.minY,
            cell: 20,
            nx: 2,
            ny: 2,
            z: new Float32Array([8, 8, 8, 8]),
            inside: new Uint8Array([1, 1, 1, 1]),
        },
        zMin: 8,
        zMax: 8,
    };
}

/** The pose placeWorkpieces used before the envelope fallback: outline bbox, 0°. */
function outlineCentered(profile: MillingProfile, wp: CncWorkpiece, pocketIndex: number): PlacedPart {
    const pocket = profile.pockets[pocketIndex];
    if (!pocket) throw new Error("missing pocket");
    const c = centroid(wp.outline);
    const rotationDeg = 0;
    const rotBb = rotatedLocalBbox(wp.outline, c.x, c.y, rotationDeg);
    const margin = placementMarginMm(profile, wp.outline, rotationDeg);
    const auto = autoTranslate(profile, pocket, rotBb, margin);
    return {
        side: wp.side,
        pocketIndex,
        rot180: false,
        rotationDeg,
        cx: c.x,
        cy: c.y,
        tx: auto.tx,
        ty: auto.ty,
        outline: wp.outline,
        heightmap: wp.heightmap,
        zMin: wp.zMin,
        zMax: wp.zMax,
    };
}

function pocketClearance(part: PlacedPart, profile: MillingProfile): number {
    const pocket = profile.pockets[part.pocketIndex];
    if (!pocket) return Number.NEGATIVE_INFINITY;
    const bb = bboxOf(worldFootprint(part, profile));
    return Math.min(
        bb.minX - pocket.x,
        pocket.x + pocket.width - bb.maxX,
        bb.minY - pocket.y,
        pocket.y + pocket.length - bb.maxY,
    );
}

function sideMoves(gcode: string, side: Side): Point[] {
    const moves: Point[] = [];
    let active = false;
    let x = 0;
    let y = 0;
    for (const line of gcode.split(/\r?\n/)) {
        const comment = line.match(/;\s*(?:surface|perimeter)\s+(left|right)/);
        if (comment) {
            active = comment[1] === side;
            continue;
        }
        if (!active || !line.startsWith("G1")) continue;
        const xm = line.match(/X(-?\d+(?:\.\d+)?)/);
        const ym = line.match(/Y(-?\d+(?:\.\d+)?)/);
        if (!xm && !ym) continue;
        if (xm) x = Number(xm[1]);
        if (ym) y = Number(ym[1]);
        moves.push({ x, y });
    }
    return moves;
}

describe("CNC envelope placement fallback", () => {
    test("envelope re-centre fixes a width that still fits when the outline centre does not", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = workpiece("left", wideOutline(105));
        const legacy = outlineCentered(profile, wp, 0);
        const legacyFit = evaluatePlacedPart(legacy, profile);
        expect(legacyFit.ok).toBe(false);

        const placed = placeWorkpieces(profile, [wp]);
        const part = placed[0];
        if (!part) throw new Error("expected part");
        expect(part.rotationDeg).toBe(0);
        expect(part.tx).toBe(legacy.tx);
        expect(part.ty).not.toBe(legacy.ty);
        expect(pocketClearance(part, profile)).toBeGreaterThanOrEqual(1);
    });

    test("Peavy-size outline fails outline centring and fits both pockets after the fallback", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const outline = wideOutline();
        const ob = bboxOf(outline);
        expect(ob.maxX - ob.minX).toBeCloseTo(PEAVY_LENGTH_MM, 6);
        expect(ob.maxY - ob.minY).toBeCloseTo(PEAVY_WIDTH_MM, 6);

        const left = workpiece("left", outline);
        const right = workpiece(
            "right",
            outline.map((p) => ({ ...p })),
        );
        const legacyLeft = outlineCentered(profile, left, 0);
        const legacyRight = outlineCentered(profile, right, 1);
        const legacyLeftFit = evaluatePlacedPart(legacyLeft, profile);
        const legacyRightFit = evaluatePlacedPart(legacyRight, profile);
        expect(legacyLeftFit.ok).toBe(false);
        expect(legacyRightFit.ok).toBe(false);
        expect(legacyLeftFit.reason).toBe(
            "Tool envelope does not fit pocket 1 (envelope 129.060 mm, usable 128.175 mm)",
        );

        try {
            placeWorkpieces(profile, [left], [{ side: "left", rotationDeg: 0 }]);
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(CncExportError);
            expect((error as CncExportError).code).toBe("no_fit");
            expect((error as CncExportError).message).toBe(legacyLeftFit.reason);
        }

        const placed = placeWorkpieces(profile, [left, right]);
        expect(placed).toHaveLength(2);
        const placedLeft = placed.find((part) => part.side === "left");
        const placedRight = placed.find((part) => part.side === "right");
        if (!placedLeft || !placedRight) throw new Error("expected both sides");

        expect(placedLeft.rotationDeg).toBe(2.5);
        expect(placedRight.rotationDeg).toBe(2.5);
        expect(placedLeft.pocketIndex).toBe(0);
        expect(placedRight.pocketIndex).toBe(1);
        expect(pocketClearance(placedLeft, profile)).toBeGreaterThanOrEqual(1);
        expect(pocketClearance(placedRight, profile)).toBeGreaterThanOrEqual(1);

        const leftBb = bboxOf(worldFootprint(placedLeft, profile));
        const rightBb = bboxOf(worldFootprint(placedRight, profile));
        const leftPocket = profile.pockets[0];
        const rightPocket = profile.pockets[1];
        if (!leftPocket || !rightPocket) throw new Error("expected two pockets");
        const leftY = Math.min(leftBb.minY - leftPocket.y, leftPocket.y + leftPocket.length - leftBb.maxY);
        const rightY = Math.min(
            rightBb.minY - rightPocket.y,
            rightPocket.y + rightPocket.length - rightBb.maxY,
        );
        expect(leftY).toBeCloseTo(1.324, 3);
        expect(rightY).toBeCloseTo(1.324, 3);
        expect(
            polygonsOverlap(worldFootprint(placedLeft, profile), worldFootprint(placedRight, profile)),
        ).toBe(false);

        const job = generateCncJob(profile, [left, right]);
        expect(job.placed[0]?.rotationDeg).toBe(placedLeft.rotationDeg);
        expect(job.placed.find((part) => part.side === "left")?.tx).toBe(placedLeft.tx);
        expect(job.placed.find((part) => part.side === "left")?.ty).toBe(placedLeft.ty);
        const lead = buildContourPass(outline, profile).leadIn[0];
        if (!lead) throw new Error("expected lead-in");
        const leadXy = machineXY(lead, placedLeft, profile);
        expect(job.gcode).toContain(`X${leadXy.x.toFixed(profile.decimals)}`);
        expect(job.gcode).toContain(`Y${leadXy.y.toFixed(profile.decimals)}`);

        for (const part of [placedLeft, placedRight]) {
            const pocket = profile.pockets[part.pocketIndex];
            if (!pocket) throw new Error("expected pocket");
            const moves = sideMoves(job.gcode, part.side);
            expect(moves.length).toBeGreaterThan(10);
            for (const move of moves) {
                expect(move.x).toBeGreaterThanOrEqual(pocket.x + 1);
                expect(move.x).toBeLessThanOrEqual(pocket.x + pocket.width - 1);
                expect(move.y).toBeGreaterThanOrEqual(pocket.y + 1);
                expect(move.y).toBeLessThanOrEqual(pocket.y + pocket.length - 1);
            }
        }
    });

    test("a medium US 9-ish outline keeps 0° and the outline-centred translation", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const outline = mediumOutline();
        const bb = bboxOf(outline);
        expect(bb.maxX - bb.minX).toBeCloseTo(270, 6);
        expect(bb.maxY - bb.minY).toBeCloseTo(96, 6);
        const left = workpiece("left", outline);
        const right = workpiece(
            "right",
            outline.map((p) => ({ ...p })),
        );
        const legacyLeft = outlineCentered(profile, left, 0);
        const legacyRight = outlineCentered(profile, right, 1);
        expect(evaluatePlacedPart(legacyLeft, profile).ok).toBe(true);
        expect(evaluatePlacedPart(legacyRight, profile).ok).toBe(true);

        const placed = placeWorkpieces(profile, [left, right]);
        const placedLeft = placed.find((part) => part.side === "left");
        const placedRight = placed.find((part) => part.side === "right");
        if (!placedLeft || !placedRight) throw new Error("expected both sides");
        expect(placedLeft.rotationDeg).toBe(0);
        expect(placedRight.rotationDeg).toBe(0);
        expect(placedLeft.tx).toBe(legacyLeft.tx);
        expect(placedLeft.ty).toBe(legacyLeft.ty);
        expect(placedRight.tx).toBe(legacyRight.tx);
        expect(placedRight.ty).toBe(legacyRight.ty);
    });

    test("a part that cannot fit by 8° still throws the default placement error", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = workpiece("left", blockOutline(PEAVY_LENGTH_MM, 120));
        const legacy = outlineCentered(profile, wp, 0);
        const legacyFit = evaluatePlacedPart(legacy, profile);
        expect(legacyFit.ok).toBe(false);
        expect(legacyFit.reason).toMatch(/Tool envelope does not fit pocket 1/);
        try {
            placeWorkpieces(profile, [wp]);
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(CncExportError);
            expect((error as CncExportError).code).toBe("no_fit");
            expect((error as CncExportError).message).toBe(legacyFit.reason);
        }
    });
});
