// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { designStateFromDocument } from "@/features/clients/design-document";
import { workpiecesFromDesign } from "@/lib/cnc/compose";
import { ENVELOPE_CLEARANCE_MM } from "@/lib/cnc/envelope";
import { generateCncJob } from "@/lib/cnc/export";
import { placeWorkpieces, tableBoundsMm, worldFootprint } from "@/lib/cnc/placement";
import { bboxOf } from "@/lib/cnc/polygon";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import type { CncWorkpiece, MillingProfile } from "@/lib/cnc/types";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { DesignState, Side } from "@/types";
import { loadSampleTop } from "./helpers";

/** Idaho pair pitch. Single-foot placement must not move this. */
const POCKET_PITCH_MM = 130.175;

function toolBodyClearanceMm(gcode: string, profile: MillingProfile): number {
    const radius = profile.toolpathCutter.diameterMm / 2;
    const table = tableBoundsMm(profile);
    let x = 0;
    let y = 0;
    let clear = Infinity;
    for (const line of gcode.split("\n")) {
        if (!line.startsWith("G1")) continue;
        const xm = line.match(/X(-?\d+(?:\.\d+)?)/);
        const ym = line.match(/Y(-?\d+(?:\.\d+)?)/);
        if (!xm && !ym) continue;
        if (xm) x = Number(xm[1]);
        if (ym) y = Number(ym[1]);
        clear = Math.min(
            clear,
            x - radius,
            y - radius,
            table.width - (x + radius),
            table.length - (y + radius),
        );
    }
    return clear;
}

function footprintClearanceMm(part: CncWorkpiece, profile: MillingProfile): number {
    const placed = placeWorkpieces(profile, [part])[0];
    if (!placed) throw new Error("expected a placement");
    const bb = bboxOf(worldFootprint(placed, profile));
    const table = tableBoundsMm(profile);
    return Math.min(bb.minX, bb.minY, table.width - bb.maxX, table.length - bb.maxY);
}

describe("single-foot CNC stays inside the milling table", () => {
    test("Peavy pair stays on the half pockets and a 4 mm single right foot is milled inside the table", async () => {
        expect(ENVELOPE_CLEARANCE_MM).toBe(1);
        const profile = cloneProfile(IDAHO_PROFILE);
        const lower = profile.pockets[0];
        const upper = profile.pockets[1];
        if (!lower || !upper) throw new Error("Idaho profile is missing its two pockets");
        expect(upper.y - lower.y).toBe(POCKET_PITCH_MM);
        const raw = await loadSampleTop();
        const doc = JSON.parse(
            readFileSync(
                resolve(process.cwd(), "tests/cnc/frozen-thickness/peavy-6236d861.settings.json"),
                "utf8",
            ),
        ) as { settingsJson: unknown };
        const design = designStateFromDocument({
            id: "00000000-0000-4000-8000-000000006236",
            pattern: "full_contact",
            method: "milling_3axis",
            thicknessMm: 4,
            linked: true,
            unit: "mm",
            createdAt: "2026-11-20T00:00:00.000Z",
            updatedAt: "2026-11-20T00:00:00.000Z",
            settingsJson: doc.settingsJson,
        });
        const loader = async (side: Side) => {
            const geo = raw.clone();
            if (side !== "right") return geo;
            const mirrored = mirrorGeometry(geo);
            geo.dispose();
            return mirrored;
        };
        const pair = await workpiecesFromDesign(design, ["left", "right"], profile, loader);
        const placed = placeWorkpieces(profile, pair);
        const left = placed.find((part) => part.side === "left");
        const right = placed.find((part) => part.side === "right");
        if (!left || !right) throw new Error("expected both Peavy feet");
        expect(left.rotationDeg).toBe(6);
        expect(right.rotationDeg).toBe(-6);
        // Remeasured after main's non-medium planform change. The half-pocket
        // placer is the same function as main; these lock that pose.
        expect(left.tx).toBeCloseTo(10.4683402, 4);
        expect(left.ty).toBeCloseTo(60.8828287, 4);
        expect(right.tx).toBeCloseTo(10.4688779, 4);
        expect(right.ty).toBeCloseTo(200.47258, 4);
        expect(left.pocketIndex).toBe(0);
        expect(right.pocketIndex).toBe(1);

        const peavyRight = await workpiecesFromDesign(design, ["right"], profile, loader);
        const one = placeWorkpieces(profile, peavyRight);
        expect(one).toHaveLength(1);
        expect(one[0]?.rotationDeg).toBe(-6);
        expect(one[0]?.ty).toBeCloseTo(70.29758, 4);
        const peavyOne = peavyRight[0];
        if (!peavyOne) throw new Error("expected the Peavy right foot");
        expect(footprintClearanceMm(peavyOne, profile)).toBeGreaterThanOrEqual(1 - 1e-4);

        const size15: DesignState = { ...design, usMenSize: 15, shoeWidth: "medium" };
        const size15Pair = await workpiecesFromDesign(size15, ["left", "right"], profile, loader);
        const size15Placed = placeWorkpieces(profile, size15Pair);
        const sizeLeft = size15Placed.find((part) => part.side === "left");
        const sizeRight = size15Placed.find((part) => part.side === "right");
        if (!sizeLeft || !sizeRight) throw new Error("expected the size 15 pair");
        expect(sizeLeft.rotationDeg).toBe(0);
        expect(sizeRight.rotationDeg).toBe(0);
        expect(sizeLeft.tx).toBeCloseTo(11.01, 2);
        expect(sizeLeft.ty).toBeCloseTo(69.12, 2);
        expect(sizeRight.tx).toBeCloseTo(34.81, 2);
        expect(sizeRight.ty).toBeCloseTo(192.65, 2);

        const lloyd = await workpiecesFromDesign(size15, ["right"], profile, loader);
        const lloydPart = placeWorkpieces(profile, lloyd)[0];
        if (!lloydPart) throw new Error("expected the single right foot");
        expect(lloydPart.side).toBe("right");
        expect(lloydPart.rotationDeg).toBe(0);
        const lloydWp = lloyd[0];
        if (!lloydWp) throw new Error("expected the single right workpiece");
        expect(footprintClearanceMm(lloydWp, profile)).toBeGreaterThanOrEqual(1 - 1e-4);
        const job = generateCncJob(profile, lloyd);
        expect(job.gcode).toContain("; foot: right");
        expect(toolBodyClearanceMm(job.gcode, profile)).toBeGreaterThanOrEqual(1 - 1e-4);

        for (const part of [...pair, ...peavyRight, ...size15Pair, ...lloyd]) part.mesh?.dispose();
        raw.dispose();
    }, 180_000);
});
