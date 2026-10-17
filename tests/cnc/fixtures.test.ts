// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { ballScallopMm, toolRadiusMm } from "@/lib/cnc";
import { generateCncJob } from "@/lib/cnc/export";
import { parseGcode } from "@/lib/cnc/parse";
import { renderToolpathPreview } from "@/lib/cnc/preview";
import { cloneProfile, IDAHO_PROFILE, wallClearZ } from "@/lib/cnc/profile";
import { evaluateStock, simulateMoves } from "@/lib/cnc/simulate";
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
    test("0.2 mm band cleared at Z >= 6; skin 1.000 ± 0.01 under the tip", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const job = generateCncJob(profile, [
            syntheticWorkpiece(profile, "left"),
            syntheticWorkpiece(profile, "right"),
        ]);
        expect(job.gcode).toContain("; lowest 5 mm of the wall will be filleted (10 mm ball)");
        expect(job.gcode).not.toMatch(/\bM0\b/);
        expect(job.warnings.some((w) => w.includes("lowest 5 mm"))).toBe(true);

        const parsed = assertJob(job.gcode, profile);
        const grid = simulateMoves(parsed.moves, profile, 0.1);
        const report = evaluateStock(grid, job.placed, profile);
        expect(report.minStock).toBeGreaterThanOrEqual(0.999);
        expect(report.wallMaxZ).toBeLessThanOrEqual(wallClearZ(profile) + 1e-3);
        expect(report.wallDevMm).toBeLessThanOrEqual(0.05);
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

        const scallop = ballScallopMm(
            toolRadiusMm(profile.toolpathCutter.diameterMm),
            profile.stepoverBallMm,
        );
        for (const job of [plainJob, padJob]) {
            const parsed = assertJob(job.gcode, profile);
            const grid = simulateMoves(parsed.moves, profile, 0.1);
            const report = evaluateStock(grid, job.placed, profile);
            expect(report.gougeMm).toBeLessThanOrEqual(0);
            expect(report.fidelityMm).toBeLessThanOrEqual(scallop + 0.02 + 1e-6);
            expect(report.wallDevMm).toBeLessThanOrEqual(0.05);
            expect(report.wallMaxZ).toBeLessThanOrEqual(wallClearZ(profile) + 1e-3);
            expect(report.minStock).toBeGreaterThanOrEqual(0.999);
            expect(report.skinMin).toBeGreaterThanOrEqual(0.99);
            expect(report.skinMax).toBeLessThanOrEqual(1.01);
        }

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
    }, 180_000);
});
