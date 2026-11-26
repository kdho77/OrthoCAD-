// Independent grader for PR #474 (CNC single-foot whole-block placement).
// Do not merge; evidence only.

import { describe, expect, test } from "@rstest/core";
import { ENVELOPE_CLEARANCE_MM } from "@/lib/cnc/envelope";
import { generateCncJob } from "@/lib/cnc/export";
import {
    autoTranslate,
    evaluatePlacedPart,
    placementMarginMm,
    placeWorkpieces,
    rotatedLocalBbox,
    tableBoundsMm,
    worldFootprint,
} from "@/lib/cnc/placement";
import { bboxOf, centroid } from "@/lib/cnc/polygon";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import type { CncWorkpiece, MillingProfile, PlacedPart, Point, Side } from "@/lib/cnc/types";
import { CncExportError } from "@/lib/cnc/types";
import { syntheticWorkpiece } from "../cnc/helpers";

const IDAHO_PAIR_PITCH_MM = 130.175;
const PEAVY_LENGTH_MM = 251.6;

/** Captured from `main` @ 228c72f2 — synthetic Idaho pair in half-pockets. */
/** Frozen from `main` @ 228c72f2 via independent capture (grader, not worker test). */
const MAIN_SYNTHETIC_PAIR_PLACEMENT = [
    { side: "left", tx: 10.990000000000002, ty: 65.0875, rotationDeg: 0, pocketIndex: 0 },
    { side: "right", tx: 10.990000000000002, ty: 195.26250000000002, rotationDeg: 0, pocketIndex: 1 },
] as const;

function blockOutline(lengthMm: number, widthMm: number): Point[] {
    return [
        { x: 0, y: 0 },
        { x: lengthMm, y: 0 },
        { x: lengthMm, y: widthMm },
        { x: 0, y: widthMm },
    ];
}

function workpiece(side: Side, outline: Point[]): CncWorkpiece {
    const bb = bboxOf(outline);
    return {
        side,
        outline: outline.map((p) => ({ ...p })),
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
    };
}

/** Min cutter-disk inset on G1 feeds (same scan shape as worker placement.test, reimplemented here). */
function minG1ToolClearanceMm(gcode: string, profile: MillingProfile): number {
    const radius = profile.toolpathCutter.diameterMm / 2;
    let x = 0;
    let y = 0;
    let toolClear = Infinity;
    for (const line of gcode.split("\n")) {
        if (!line.startsWith("G1")) continue;
        const xm = line.match(/X(-?\d+(?:\.\d+)?)/);
        const ym = line.match(/Y(-?\d+(?:\.\d+)?)/);
        if (!xm && !ym) continue;
        if (xm) x = Number(xm[1]);
        if (ym) y = Number(ym[1]);
        toolClear = Math.min(
            toolClear,
            x - radius,
            y - radius,
            profile.tableWidthMm - (x + radius),
            profile.tableLengthMm - (y + radius),
        );
    }
    return toolClear;
}

function envelopeWorldInsetMm(part: CncWorkpiece, profile: MillingProfile): number {
    const placed = placeWorkpieces(profile, [part])[0];
    if (!placed) throw new Error("missing placement");
    const bb = bboxOf(worldFootprint(placed, profile));
    const table = tableBoundsMm(profile);
    return Math.min(bb.minX, bb.minY, table.width - bb.maxX, table.length - bb.maxY);
}

describe("PR #474 independent grader — CNC envelope / placement", () => {
    test("Idaho pocket pitch and clearance constant are unchanged", () => {
        expect(ENVELOPE_CLEARANCE_MM).toBe(1);
        const profile = cloneProfile(IDAHO_PROFILE);
        const lower = profile.pockets[0];
        const upper = profile.pockets[1];
        if (!lower || !upper) throw new Error("missing pockets");
        expect(upper.y - lower.y).toBe(IDAHO_PAIR_PITCH_MM);
        expect(profile.tableWidthMm).toBe(368.3);
        expect(profile.tableLengthMm).toBe(260.35);
    });

    test("synthetic L+R pair placement matches main byte-for-byte on tx/ty/rot/pocket", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const left = syntheticWorkpiece(profile, "left");
        const right = syntheticWorkpiece(profile, "right");
        right.outline = left.outline.map((p) => ({ ...p }));
        const placed = placeWorkpieces(profile, [left, right]);
        for (const expected of MAIN_SYNTHETIC_PAIR_PLACEMENT) {
            const part = placed.find((p) => p.side === expected.side);
            if (!part) throw new Error(`missing ${expected.side}`);
            expect(part.tx).toBe(expected.tx);
            expect(part.ty).toBe(expected.ty);
            expect(part.rotationDeg).toBe(expected.rotationDeg);
            expect(part.pocketIndex).toBe(expected.pocketIndex);
        }
        expect(placed[1]!.ty - placed[0]!.ty).toBe(IDAHO_PAIR_PITCH_MM);
    });

    test("single foot wider than half-pocket but inside block mills with ≥1 mm tool disk inset", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = workpiece("right", blockOutline(PEAVY_LENGTH_MM, 120));
        const legacy = outlineCentered(profile, wp, 0);
        const pocketGuard = evaluatePlacedPart(legacy, profile);
        expect(pocketGuard.ok).toBe(false);
        expect(pocketGuard.reason).toMatch(/Tool envelope does not fit pocket/);

        const placed = placeWorkpieces(profile, [wp]);
        expect(placed).toHaveLength(1);
        expect(placed[0]?.rotationDeg).toBe(0);
        expect(envelopeWorldInsetMm(wp, profile)).toBeGreaterThanOrEqual(1 - 1e-4);

        const job = generateCncJob(profile, [wp]);
        expect(minG1ToolClearanceMm(job.gcode, profile)).toBeGreaterThanOrEqual(1 - 1e-4);
    });

    test("single foot longer than the block still hits the pocket guard (no loosened table check)", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const wp = workpiece("left", blockOutline(PEAVY_LENGTH_MM, 250));
        const legacy = outlineCentered(profile, wp, 0);
        const legacyFit = evaluatePlacedPart(legacy, profile);
        expect(legacyFit.ok).toBe(false);
        expect(legacyFit.reason).toMatch(/Tool envelope does not fit pocket/);
        try {
            placeWorkpieces(profile, [wp]);
            expect.unreachable("must refuse");
        } catch (error) {
            expect(error).toBeInstanceOf(CncExportError);
            expect((error as CncExportError).code).toBe("no_fit");
            expect((error as CncExportError).message).toBe(legacyFit.reason);
        }
    });
});
