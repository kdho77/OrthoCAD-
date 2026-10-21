// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { generateCncJob } from "@/lib/cnc/export";
import { parseGcode } from "@/lib/cnc/parse";
import { renderToolpathPreview } from "@/lib/cnc/preview";
import { cloneProfile, IDAHO_PROFILE, wallClearZ } from "@/lib/cnc/profile";
import { evaluateStock, simulateLocal, simulateMoves } from "@/lib/cnc/simulate";
import { encodePng } from "../helpers/render-png";
import { sampleTopWorkpiece, syntheticWorkpiece } from "./helpers";

const GOLDEN_PATH = resolve(process.cwd(), "tests/cnc/golden/sha.json");

function loadGolden(): { plain: string; dancer: string } {
    try {
        return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as { plain: string; dancer: string };
    } catch {
        return { plain: "", dancer: "" };
    }
}

function saveGolden(plain: string, dancer: string): void {
    mkdirSync(resolve(process.cwd(), "tests/cnc/golden"), { recursive: true });
    writeFileSync(GOLDEN_PATH, `${JSON.stringify({ plain, dancer }, null, 4)}\n`);
}

function writePreview(name: string, gcode: string, profile: typeof IDAHO_PROFILE): void {
    const preview = renderToolpathPreview(gcode, profile, 900, 640);
    const png = encodePng(preview.width, preview.height, preview.rgb);
    for (const dir of ["/opt/cursor/artifacts/screenshots", resolve(process.cwd(), "tests/cnc/previews")]) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, name), png);
    }
}

function assertJob(gcode: string, profile: typeof IDAHO_PROFILE) {
    const parsed = parseGcode(gcode, profile.freeMovementHeightMm);
    expect(parsed.unknownWords).toEqual([]);
    expect(parsed.g0BelowClearance).toBe(false);
    expect(parsed.spindleOnBeforeFirstCut).toBe(true);
    expect(parsed.minZ).toBeGreaterThanOrEqual(0.999);
    expect(parsed.maxZ).toBeLessThanOrEqual(50.0001);
    return parsed;
}

describe("CNC ball wall / skin gates (synthetic)", () => {
    test("full R5 band cleared at Z >= 6; fillet ±0.05; skin 1.000 ± 0.01", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const job = generateCncJob(profile, [
            syntheticWorkpiece(profile, "left"),
            syntheticWorkpiece(profile, "right"),
        ]);
        expect(job.gcode).toContain("; lowest 5 mm of the wall will be filleted (10 mm ball)");
        expect(job.gcode).toContain("; box knife follows the outline (knife line), not the slot bottom");
        expect(job.gcode).not.toMatch(/\bM0\b/);
        expect(job.warnings.some((w) => w.includes("lowest 5 mm"))).toBe(true);
        expect(job.warnings.some((w) => w.toLowerCase().includes("uncut corner"))).toBe(false);

        const parsed = assertJob(job.gcode, profile);
        const grid = simulateMoves(parsed.moves, profile, 0.1);
        const localGrids = job.placed.map((part) => simulateLocal(parsed.moves, profile, part));
        const report = evaluateStock(grid, job.placed, profile, localGrids);
        expect(report.minStock).toBeGreaterThanOrEqual(0.999);
        // Raw design−stock on the eroded interior. The previous 0.001 ceiling
        // was applied after subtracting 0.01 mm, so it allowed ~0.011 mm.
        expect(report.gougeMm).toBeLessThanOrEqual(0.01);
        expect(report.wallMaxZ).toBeLessThanOrEqual(wallClearZ(profile) + 0.01);
        expect(report.wallDevMm).toBeLessThanOrEqual(0.05);
        expect(report.profileDevMm).toBeLessThanOrEqual(0.05);
        expect(report.ringHausdorffMm).toBeLessThanOrEqual(0.05);
        expect(report.skinMin).toBeGreaterThanOrEqual(0.99);
        expect(report.skinMax).toBeLessThanOrEqual(1.01);
    });
});

describe("CNC SAMPLE_Top fixtures (Idaho two-pocket)", () => {
    test("plain and dancer-pad L+R: sim gates, golden sha, timing", async () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const plainL = await sampleTopWorkpiece("left", profile, false);
        const plainR = await sampleTopWorkpiece("right", profile, false);
        const t0 = Date.now();
        const plainJob = generateCncJob(profile, [plainL, plainR]);
        expect(Date.now() - t0).toBeLessThan(10_000);

        const padL = await sampleTopWorkpiece("left", profile, true);
        const padR = await sampleTopWorkpiece("right", profile, true);
        const t1 = Date.now();
        const padJob = generateCncJob(profile, [padL, padR]);
        expect(Date.now() - t1).toBeLessThan(10_000);

        expect(plainJob.gcode).toContain(profile.name);
        expect(plainJob.placed).toHaveLength(2);
        expect(padJob.placed).toHaveLength(2);

        for (const job of [plainJob, padJob]) {
            const parsed = assertJob(job.gcode, profile);
            expect(parsed.minX).toBeGreaterThanOrEqual(-1e-4);
            expect(parsed.maxX).toBeLessThanOrEqual(profile.tableWidthMm + 1e-4);
            expect(parsed.minY).toBeGreaterThanOrEqual(-1e-4);
            expect(parsed.maxY).toBeLessThanOrEqual(profile.tableLengthMm + 1e-4);
        }

        // Dexels sit on the design-sample lattice (same origin, pitch, and cell
        // centres). A machine grid whose origin is the toolpath bbox mixes the
        // rim fillet into the first interior sample.
        // Before this fix the inverted cusp left the finish pass ≥ 5 mm high
        // (median excess 5.57, P95 9.0, sim excess 9.02 on 6cd477de).
        const surfaceCell = Math.min(plainL.heightmap.cell, plainR.heightmap.cell);
        expect(surfaceCell).toBeLessThanOrEqual(0.2);
        const surfaceParsed = parseGcode(plainJob.gcode, profile.freeMovementHeightMm);
        const surfaceLocals = plainJob.placed.map((part) =>
            simulateLocal(surfaceParsed.moves, profile, part),
        );
        const surface = evaluateStock(
            {
                originX: 0,
                originY: 0,
                cell: 1,
                nx: 1,
                ny: 1,
                z: Float32Array.of(profile.materialHeightMm),
            },
            plainJob.placed,
            profile,
            surfaceLocals,
        );
        if (surface.excessOverCount > 0) console.info("[cnc] cells over 0.25 mm excess", surface.excessOver);
        expect(surface.gougeMm).toBeLessThanOrEqual(0.01);
        expect(surface.excessP95Mm).toBeLessThanOrEqual(0.086);
        expect(surface.excessMaxMm).toBeLessThanOrEqual(0.25);
        expect(surface.excessOverCount).toBe(0);

        writePreview("cnc-sample-top-plain.png", plainJob.gcode, profile);
        writePreview("cnc-sample-top-dancer.png", padJob.gcode, profile);

        const shaPlain = createHash("sha256").update(plainJob.gcode).digest("hex");
        const shaPad = createHash("sha256").update(padJob.gcode).digest("hex");
        expect(generateCncJob(profile, [plainL, plainR]).gcode).toBe(plainJob.gcode);
        const golden = loadGolden();
        if (!golden.plain || process.env.UPDATE_CNC_GOLDEN === "1") {
            saveGolden(shaPlain, shaPad);
        }
        const latest = loadGolden();
        expect(latest.plain).toBe(shaPlain);
        expect(latest.dancer).toBe(shaPad);
    }, 300_000);
});
