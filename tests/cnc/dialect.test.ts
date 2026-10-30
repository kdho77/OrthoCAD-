// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { createHash } from "node:crypto";
import { describe, expect, test } from "@rstest/core";
import { generateCncJob } from "@/lib/cnc/export";
import { parseGcode } from "@/lib/cnc/parse";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import { syntheticWorkpiece } from "./helpers";

describe("CNC dialect / envelope / feeds", () => {
    test("header, envelope, spindle, G0 at clearance, feeds, stepdown", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const left = syntheticWorkpiece(profile, "left");
        const right = syntheticWorkpiece(profile, "right");
        const job = generateCncJob(profile, [left, right]);
        const g = job.gcode;
        expect(g).toContain("; Vertex Lab (Idaho) - ONE SIDE");
        expect(g).toMatch(/; design-hash: [0-9a-f]{64}/);
        expect(g).toContain("; foot: left+right");
        expect(g).toContain("; pass1-tool: 10mm ball");
        expect(g).toContain("; pass2-tool: 10mm ball");
        expect(g).toContain("; lowest 5 mm of the wall will be filleted (10 mm ball)");
        expect(g).toContain("; box knife follows the outline (knife line), not the slot bottom");
        expect(g).toContain("; tool-change: none (same 10mm ball both passes)");
        expect(g).toMatch(/G21/);
        expect(g).toMatch(/G90/);
        expect(g).toMatch(/G17/);
        expect(g).toMatch(/G94/);
        expect(g).toMatch(/M3 S24000/);
        expect(g).toMatch(/G4 P3/);
        expect(g).toMatch(/M30/);
        expect(g).not.toMatch(/\bM0\b/);
        expect(g).not.toContain("CHANGE TO");

        const parsed = parseGcode(g, profile.freeMovementHeightMm);
        expect(parsed.unknownWords).toEqual([]);
        expect(parsed.g0BelowClearance).toBe(false);
        expect(parsed.spindleOnBeforeFirstCut).toBe(true);
        expect(parsed.minZ).toBeGreaterThanOrEqual(-1e-4);
        expect(parsed.minZ).toBeLessThan(0.05);
        expect(parsed.maxZ).toBeLessThanOrEqual(50.0001);
        expect(parsed.minX).toBeGreaterThanOrEqual(-1e-4);
        expect(parsed.maxX).toBeLessThanOrEqual(profile.tableWidthMm + 1e-4);
        expect(parsed.minY).toBeGreaterThanOrEqual(-1e-4);
        expect(parsed.maxY).toBeLessThanOrEqual(profile.tableLengthMm + 1e-4);

        let lastF = 0;
        for (const m of parsed.moves) {
            if (m.motion === "G0") expect(m.z).toBeCloseTo(50, 3);
            if (m.motion !== "G1") continue;
            const dxy = Math.hypot(m.x - m.from.x, m.y - m.from.y);
            const dz = m.z - m.from.z;
            // A straight Windows plunge (no XY) may drop the full entry. Sloped moves stay ≤ 15 mm.
            if (dz < -15.001 && dxy > 0.05) {
                throw new Error(`step-down ${dz.toFixed(3)} mm exceeds 15 at line ${m.line}`);
            }
            if (m.f) lastF = m.f;
            const f = m.f || lastF;
            const allowed = new Set([3500, 36000, 2500]);
            expect(allowed.has(f)).toBe(true);
            void dxy;
        }

        const a = generateCncJob(profile, [left, right]).gcode;
        const b = generateCncJob(profile, [left, right]).gcode;
        expect(a).toBe(b);
        expect(createHash("sha256").update(a).digest("hex")).toHaveLength(64);
    });

    test("flat contour remains selectable and emits M0 tool change", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        profile.contourCutter = { ...profile.contourCutter, type: "flat" };
        const job = generateCncJob(profile, [syntheticWorkpiece(profile, "left")]);
        expect(job.gcode).toContain("; pass1-tool: 10mm ball");
        expect(job.gcode).toContain("; pass2-tool: 10mm flat");
        expect(job.gcode).toContain("(CHANGE TO 10MM FLAT END MILL - RE-ZERO Z)");
        expect(job.gcode).toMatch(/\bM0\b/);
        expect(job.gcode).not.toContain("lowest 5 mm of the wall will be filleted");
        expect(job.warnings.some((w) => w.includes("ball mill"))).toBe(false);
    });
});
