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
import { acrossWidthGapMm, measureSpiral, planCenterSpiral, type XyPoint } from "@/lib/cnc/spiral";
import type { Heightmap } from "@/lib/cnc/types";
import { encodePng } from "../helpers/render-png";
import { sampleTopWorkpiece, syntheticWorkpiece } from "./helpers";

function interiorGapMm(hm: Heightmap, pts: XyPoint[]): number {
    const pitch = 0.5;
    const buckets = new Map<number, XyPoint[]>();
    const key = (ix: number, iy: number) => ix * 100003 + iy;
    for (const p of pts) {
        const k = key(Math.floor(p.x / pitch), Math.floor(p.y / pitch));
        const list = buckets.get(k);
        if (list) list.push(p);
        else buckets.set(k, [p]);
    }
    let worst = 0;
    for (let iy = 0; iy < hm.ny; iy++) {
        const y = hm.originY + iy * hm.cell;
        for (let ix = 0; ix < hm.nx; ix++) {
            if (hm.inside[iy * hm.nx + ix] !== 1) continue;
            const x = hm.originX + ix * hm.cell;
            const bx = Math.floor(x / pitch);
            const by = Math.floor(y / pitch);
            let best = Infinity;
            for (let dy = -3; dy <= 3; dy++) {
                for (let dx = -3; dx <= 3; dx++) {
                    const list = buckets.get(key(bx + dx, by + dy));
                    if (!list) continue;
                    for (const p of list) best = Math.min(best, Math.hypot(p.x - x, p.y - y));
                }
            }
            if (best > worst) worst = best;
        }
    }
    return worst;
}

const GOLDEN_PATH = resolve(process.cwd(), "tests/cnc/golden/sha.json");

function rapidAfter(gcode: string, marker: string): { x: number; y: number } {
    const slice = gcode.slice(gcode.indexOf(marker), gcode.indexOf(marker) + 800);
    // The first G0 is the retract at the previous XY. The second is the lead.
    const matches = [...slice.matchAll(/G0 X([-\d.]+) Y([-\d.]+)/g)];
    const match = matches[1];
    if (!match?.[1] || !match[2]) throw new Error(`no lead rapid after ${marker}`);
    return { x: Number(match[1]), y: Number(match[2]) };
}

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
    expect(parsed.minZ).toBeGreaterThanOrEqual(-1e-4);
    expect(parsed.maxZ).toBeLessThanOrEqual(50.0001);
    return parsed;
}

describe("CNC ball wall / skin gates (synthetic)", () => {
    test("perimeter through-cuts at Z0; fillet ±0.05; no interior gouge", () => {
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
        expect(report.minStock).toBeGreaterThanOrEqual(-1e-3);
        expect(report.minStock).toBeLessThan(0.05);
        // Raw design−stock on the eroded interior. The previous 0.001 ceiling
        // was applied after subtracting 0.01 mm, so it allowed ~0.011 mm.
        expect(report.gougeMm).toBeLessThanOrEqual(0.01);
        expect(report.wallMaxZ).toBeLessThanOrEqual(wallClearZ(profile) + 0.01);
        expect(report.wallDevMm).toBeLessThanOrEqual(0.05);
        expect(report.profileDevMm).toBeLessThanOrEqual(0.05);
        expect(report.ringHausdorffMm).toBeLessThanOrEqual(0.05);
        expect(report.skinMin).toBeGreaterThanOrEqual(-1e-3);
        expect(report.skinMax).toBeLessThanOrEqual(0.05);
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
        // One F3500 plunge per surface. The rest of the spiral stays at F36000.
        const surfaceGcode = plainJob.gcode.slice(
            plainJob.gcode.indexOf("; surface left"),
            plainJob.gcode.indexOf("; perimeter left"),
        );
        const f3500 = surfaceGcode.split("\n").filter((line) => line.includes("F3500"));
        expect(f3500).toHaveLength(2);
        // Toe end of the flat lateral edge. Y stays ~2.4 mm above the Windows
        // lead: outline min is Y19.2 / Y149.4, and a 2 mm lead cannot reach Y10.4.
        const leftStart = rapidAfter(plainJob.gcode, "; perimeter left");
        const rightStart = rapidAfter(plainJob.gcode, "; perimeter right");
        console.info(
            `[cnc] perimeter L X${leftStart.x.toFixed(2)} Y${leftStart.y.toFixed(2)} ` +
                `R X${rightStart.x.toFixed(2)} Y${rightStart.y.toFixed(2)}`,
        );
        expect(leftStart.x).toBeGreaterThan(214);
        expect(leftStart.x).toBeLessThan(220);
        expect(leftStart.y).toBeGreaterThan(12);
        expect(leftStart.y).toBeLessThan(14);
        expect(rightStart.x).toBeGreaterThan(192);
        expect(rightStart.x).toBeLessThan(198);
        expect(rightStart.y).toBeGreaterThan(142);
        expect(rightStart.y).toBeLessThan(145);
        for (const wp of [plainL, plainR]) {
            const plan = planCenterSpiral(wp.outline, profile, profile.toolpathCutter.type);
            const measured = measureSpiral(plan.samples, wp.outline);
            const euclidean = interiorGapMm(wp.heightmap, plan.samples);
            console.info(
                `[cnc] ${wp.side} laps ${measured.laps.toFixed(1)} length ${(measured.lengthMm / 1000).toFixed(2)} m ` +
                    `widthPitch ${measured.widthPitchMm.toFixed(3)} endPitch ${measured.endPitchMm.toFixed(3)} ` +
                    `heelPitch ${measured.heelPitchMm.toFixed(3)} ` +
                    `acrossWidthGap ${measured.acrossWidthGapMm.toFixed(3)} euclideanGap ${euclidean.toFixed(3)}`,
            );
            expect(measured.clockwise).toBe(true);
            // SAMPLE_Top is ~272×92 mm against Windows' ~295×100 mm, so the
            // homothety is ~56 laps. The toe stays at the stretched pitch. The
            // heel tip is capped near 1.98 mm: the natural ~2.47 mm leaves the
            // 10 mm ball ~0.40 mm high in the cup.
            expect(measured.laps).toBeGreaterThan(52);
            expect(measured.laps).toBeLessThan(60);
            expect(measured.lengthMm / 1000).toBeGreaterThan(16);
            expect(measured.lengthMm / 1000).toBeLessThan(23);
            expect(measured.heelPitchMm).toBeGreaterThan(1.9);
            expect(measured.heelPitchMm).toBeLessThan(2.05);
            expect(measured.widthPitchMm).toBeGreaterThan(0.65);
            expect(measured.widthPitchMm).toBeLessThan(0.85);
            expect(measured.endPitchMm).toBeGreaterThan(2.3);
            expect(measured.endPitchMm).toBeLessThan(2.6);
            expect(acrossWidthGapMm(plan.samples, wp.outline)).toBeLessThanOrEqual(0.75);
        }
        expect(surface.gougeMm).toBeLessThanOrEqual(0.01);
        expect(surface.excessP95Mm).toBeLessThanOrEqual(0.099);
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
