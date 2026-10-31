// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { loadPressureMapFixturePng } from "@/lib/pressure-map/fixture-loader";
import { autoPressureMapPlacement, footprintRectForDesign } from "@/lib/pressure-map/placement";
import { defaultDesign } from "@/stores/design-store";
import type { Side } from "@/types";

const ARTIFACT_DIRS = [
    resolve("/opt/cursor/artifacts/screenshots"),
    resolve(process.cwd(), "vertex/tests/pressure-map/previews"),
];

describe("pressure map WebGL overlay (Playwright + SwiftShader)", () => {
    test("realistic L/R fixtures auto-fit near full footprint", () => {
        const design = defaultDesign();
        for (const [side, file] of [
            ["left", "left_foot_pressure.png"],
            ["right", "right_foot_pressure.png"],
        ] as const) {
            const foot = loadPressureMapFixturePng(side, file);
            const fp = footprintRectForDesign(design, side);
            const placement = autoPressureMapPlacement(side, fp, foot);
            expect(placement.sizeFootprint.x).toBeGreaterThan(fp.lengthMm * 0.72);
            expect(placement.sizeFootprint.y).toBeGreaterThan(fp.widthMm * 0.55);
            expect(placement.sizeFootprint.x).toBeLessThan(fp.lengthMm * 1.2);
        }
    });

    test("headless Chromium renders heatmap on SAMPLE_Top with Transparent ON", async () => {
        const { chromium } = await import("playwright");
        let devProc: ChildProcess | null = null;
        const baseUrl = "http://127.0.0.1:5180/?pressureMapE2E=1&dev=1";
        try {
            devProc = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5180"], {
                cwd: resolve(process.cwd(), "vertex"),
                stdio: "pipe",
                env: { ...process.env, BROWSER: "none" },
            });
            await waitForDevServer(devProc, 60_000);

            const browser = await chromium.launch({
                headless: true,
                args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--hide-scrollbars"],
            });
            const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
            await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
            await page.waitForFunction(
                () => (window as unknown as { __orthocadPressureMapE2E?: unknown }).__orthocadPressureMapE2E,
                {
                    timeout: 30_000,
                },
            );
            await page.waitForSelector("canvas", { timeout: 30_000 });

            await page.evaluate(async () => {
                const api = (
                    window as unknown as {
                        __orthocadPressureMapE2E: import("@/lib/pressure-map/e2e-bootstrap").PressureMapE2EApi;
                    }
                ).__orthocadPressureMapE2E;
                api.prepareScene();
                await api.importFixture("left", "left_foot_pressure.png");
                await api.importFixture("right", "right_foot_pressure.png");
            });
            await page.waitForTimeout(2500);

            const applyView = async (view: string) => {
                await page.evaluate((v) => {
                    (
                        window as unknown as { __orthocadApplyCameraView?: (n: string) => void }
                    ).__orthocadApplyCameraView?.(v);
                }, view);
                await page.waitForTimeout(800);
            };

            for (const dir of ARTIFACT_DIRS) mkdirSync(dir, { recursive: true });

            await applyView("top");
            const pairTop = await screenshotCanvas(page);
            writeArtifact("pressure-map-pair-top-webgl.png", pairTop);
            expect(heatmapPixelCount(pairTop)).toBeGreaterThan(400);

            for (const side of ["left", "right"] as Side[]) {
                await page.evaluate(
                    ({ s }) => {
                        const api = (
                            window as unknown as {
                                __orthocadPressureMapE2E: import("@/lib/pressure-map/e2e-bootstrap").PressureMapE2EApi;
                            }
                        ).__orthocadPressureMapE2E;
                        api.setFootVisibility(s === "left", s === "right");
                    },
                    { s: side },
                );
                await page.waitForTimeout(600);
                await applyView("top");
                const top = await screenshotCanvas(page);
                writeArtifact(`pressure-map-${side}-top-webgl.png`, top);
                expect(heatmapPixelCount(top)).toBeGreaterThan(120);

                await applyView("iso");
                const rotated = await screenshotCanvas(page);
                writeArtifact(`pressure-map-${side}-rotated-webgl.png`, rotated);
                expect(heatmapPixelCount(rotated)).toBeGreaterThan(80);
            }

            await browser.close();
        } finally {
            devProc?.kill("SIGTERM");
        }
    }, 180_000);
});

function writeArtifact(name: string, buf: Buffer) {
    for (const dir of ARTIFACT_DIRS) {
        writeFileSync(resolve(dir, name), buf);
    }
}

async function screenshotCanvas(page: import("playwright").Page): Promise<Buffer> {
    const canvas = page.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 10_000 });
    return canvas.screenshot({ type: "png" });
}

/** Count non-background pixels that look like jet colormap (not flat insole blue). */
function heatmapPixelCount(png: Buffer): number {
    // PNG IHDR + minimal decode: use rough scan — playwright returns PNG; parse with simple RGBA via pngjs if available
    // Fallback: count bytes in IDAT chunk heuristic won't work. Use sync decode via createRequire pngjs.
    const { PNG } = require("pngjs") as typeof import("pngjs");
    const parsed = PNG.sync.read(png);
    let count = 0;
    for (let i = 0; i < parsed.data.length; i += 4) {
        const r = parsed.data[i]!;
        const g = parsed.data[i + 1]!;
        const b = parsed.data[i + 2]!;
        const a = parsed.data[i + 3]!;
        if (a < 20) continue;
        const bg = r < 30 && g < 35 && b < 45;
        if (bg) continue;
        const insoleBlue = r < 40 && g > 140 && b > 200;
        if (insoleBlue) continue;
        if (r + g + b > 60) count++;
    }
    return count;
}

function waitForDevServer(proc: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Vite dev server timeout")), timeoutMs);
        const onData = (chunk: Buffer | string) => {
            const text = String(chunk);
            if (text.includes("Local:") || text.includes("5180")) {
                clearTimeout(timer);
                proc.stdout?.off("data", onData);
                proc.stderr?.off("data", onData);
                setTimeout(resolve, 1500);
            }
        };
        proc.stdout?.on("data", onData);
        proc.stderr?.on("data", onData);
        proc.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
