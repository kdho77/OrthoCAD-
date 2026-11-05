// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { exportMachineFamily, pairExportLayout } from "@/features/exports/machine-export-layout";
import { generateCncJob } from "@/lib/cnc/export";
import { placeWorkpieces, transformOutline } from "@/lib/cnc/placement";
import { bboxOf } from "@/lib/cnc/polygon";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import { PRINTER_PRESETS } from "@/lib/kiri";
import { syntheticWorkpiece } from "./helpers";

/**
 * Idaho L+R pocket pitch. Frozen from the profile that predates the belt
 * single-file split. Belt pair spacing (shoe width + 30) must not replace this.
 */
const POCKET_PITCH_MM = 130.175;

describe("CNC side-by-side layout is unchanged", () => {
    test("milling stays side-by-side and belt stays separate files", () => {
        expect(exportMachineFamily({ method: "milling_3axis" })).toBe("cnc");
        expect(pairExportLayout("cnc")).toBe("side-by-side");
        expect(pairExportLayout(exportMachineFamily({ method: "printing_solid", beltAngleDeg: 45 }))).toBe(
            "separate-files",
        );
        expect(pairExportLayout(exportMachineFamily({ method: "printing_solid" }))).toBe("side-by-side");
        expect(PRINTER_PRESETS.some((preset) => /md400|mingda/i.test(preset.id + preset.name))).toBe(false);
    });

    test("Idaho L+R keeps pocket pitch, shared X, and world bounds a pitch apart", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const lower = profile.pockets[0];
        const upper = profile.pockets[1];
        if (!lower || !upper) throw new Error("Idaho profile is missing its two pockets");
        expect(upper.y - lower.y).toBe(POCKET_PITCH_MM);
        const left = syntheticWorkpiece(profile, "left");
        const right = syntheticWorkpiece(profile, "right");
        right.outline = left.outline.map((point) => ({ ...point }));
        const placed = placeWorkpieces(profile, [left, right]);
        const leftPart = placed.find((part) => part.side === "left");
        const rightPart = placed.find((part) => part.side === "right");
        if (!leftPart || !rightPart) throw new Error("expected both pockets");

        expect(leftPart.pocketIndex).toBe(0);
        expect(rightPart.pocketIndex).toBe(1);
        expect(leftPart.rotationDeg).toBe(0);
        expect(rightPart.rotationDeg).toBe(0);
        expect(leftPart.tx).toBeCloseTo(rightPart.tx, 6);
        expect(rightPart.ty - leftPart.ty).toBeCloseTo(POCKET_PITCH_MM, 6);
        expect(Math.abs(rightPart.ty - leftPart.ty - (90 + 30))).toBeGreaterThan(1);

        const leftWorld = bboxOf(transformOutline(leftPart.outline, leftPart));
        const rightWorld = bboxOf(transformOutline(rightPart.outline, rightPart));
        expect(rightWorld.minX).toBeCloseTo(leftWorld.minX, 6);
        expect(rightWorld.maxX).toBeCloseTo(leftWorld.maxX, 6);
        expect(rightWorld.minY - leftWorld.minY).toBeCloseTo(POCKET_PITCH_MM, 6);
        expect(rightWorld.maxY - leftWorld.maxY).toBeCloseTo(POCKET_PITCH_MM, 6);
        expect(leftWorld.maxY).toBeLessThanOrEqual(lower.y + lower.length + 1e-6);
        expect(rightWorld.minY).toBeGreaterThanOrEqual(upper.y - 1e-6);

        const job = generateCncJob(profile, [left, right]);
        expect(job.gcode).toContain("; foot: left+right");
        const jobLeft = job.placed.find((part) => part.side === "left");
        const jobRight = job.placed.find((part) => part.side === "right");
        expect(jobLeft?.tx).toBeCloseTo(leftPart.tx, 6);
        expect(jobLeft?.ty).toBeCloseTo(leftPart.ty, 6);
        expect(jobRight?.tx).toBeCloseTo(rightPart.tx, 6);
        expect(jobRight?.ty).toBeCloseTo(rightPart.ty, 6);
    });
});
