// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { PressureMapE2EApi, PressureMapFootMeasure } from "@/lib/pressure-map/e2e-bootstrap";
import { loadPressureMapFixturePng } from "@/lib/pressure-map/fixture-loader";
import { autoPressureMapPlacement, footprintRectForDesign } from "@/lib/pressure-map/placement";
import { defaultDesign } from "@/stores/design-store";
import type { Side } from "@/types";

const ARTIFACT_DIRS = [
    resolve("/opt/cursor/artifacts/screenshots"),
    resolve(process.cwd(), "vertex/tests/pressure-map/previews"),
];

/** Hallux centroids measured on the committed asymmetric fixtures (toes up, medial on the big-toe side). */
const HALLUX_UV: Record<Side, { u: number; v: number }> = {
    left: { u: 0.611, v: 0.255 },
    right: { u: 0.388, v: 0.255 },
};

describe("pressure map WebGL overlay (Playwright + SwiftShader)", () => {
    test("realistic L/R fixtures auto-fit near full footprint", () => {
        const design = defaultDesign();
        for (const [side, file] of [
            ["left", "left_foot_pressure.png"],
            ["right", "right_foot_pressure.png"],
        ] as const) {
            const foot = loadPressureMapFixturePng(side, file);
            const trimmed = footprintRectForDesign(design, side);
            const fp = {
                ...trimmed,
                minX: 0,
                maxX: 271.93,
                minY: -45.85,
                maxY: 45.85,
                centerX: 135.965,
                centerY: 0,
                lengthMm: 271.93,
                widthMm: 91.7,
            };
            const placement = autoPressureMapPlacement(side, fp, foot);
            expect(placement.sizeFootprint.x).toBeGreaterThan(fp.lengthMm * 0.9);
            expect(placement.sizeFootprint.y).toBeGreaterThan(fp.widthMm * 0.9);
            expect(placement.sizeFootprint.x).toBeLessThan(fp.lengthMm * 1.1);
            expect(placement.sizeFootprint.y).toBeLessThan(fp.widthMm * 1.1);
            expect(placement.planeScale.y).toBeGreaterThan(placement.planeScale.x);
        }
    });

    test("headless Chromium waits for insoles, then checks plane bounds and medial hallux", async () => {
        const { chromium } = await import("playwright");
        let devProc: ChildProcess | null = null;
        const baseUrl = "http://127.0.0.1:5180/?pressureMapE2E=1&dev=1";
        try {
            devProc = spawn(
                "npm",
                ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5180", "--strictPort"],
                {
                    cwd: resolve(process.cwd(), "vertex"),
                    stdio: "pipe",
                    env: { ...process.env, BROWSER: "none" },
                },
            );
            await waitForDevServer(devProc, 90_000);

            const browser = await chromium.launch({
                headless: true,
                args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--hide-scrollbars"],
            });
            const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
            page.on("pageerror", (err) => {
                console.error("pageerror", err.message);
            });
            await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 90_000 });
            await page.waitForFunction(
                () => (window as unknown as { __orthocadPressureMapE2E?: unknown }).__orthocadPressureMapE2E,
                { timeout: 30_000 },
            );
            await page.waitForSelector("canvas", { timeout: 30_000 });

            await page.evaluate(async () => {
                const api = (window as unknown as { __orthocadPressureMapE2E: PressureMapE2EApi })
                    .__orthocadPressureMapE2E;
                api.prepareScene();
                await api.importFixture("left", "left_foot_pressure.png");
                await api.importFixture("right", "right_foot_pressure.png");
            });

            await page.waitForFunction(
                () => {
                    const api = (window as unknown as { __orthocadPressureMapE2E?: PressureMapE2EApi })
                        .__orthocadPressureMapE2E;
                    return api?.meshesReady?.() === true;
                },
                { timeout: 120_000 },
            );

            const applyView = async (view: string) => {
                await page.evaluate((v) => {
                    (
                        window as unknown as { __orthocadApplyCameraView?: (n: string) => void }
                    ).__orthocadApplyCameraView?.(v);
                }, view);
                await page.evaluate(
                    () =>
                        new Promise<void>((resolve) => {
                            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                        }),
                );
            };

            await applyView("top");
            await page.waitForFunction(
                (hallux) => {
                    const api = (window as unknown as { __orthocadPressureMapE2E?: PressureMapE2EApi })
                        .__orthocadPressureMapE2E;
                    const measured = api?.measure?.(hallux as Record<Side, { u: number; v: number }>);
                    if (!measured) return false;
                    return (["left", "right"] as const).every((side) => {
                        const foot = measured.feet[side];
                        const ilen = foot.insole.maxX - foot.insole.minX;
                        const plen = foot.plane.maxX - foot.plane.minX;
                        return ilen > 50 && Math.abs(plen - ilen) / ilen < 0.03;
                    });
                },
                HALLUX_UV,
                { timeout: 30_000 },
            );

            const measured = await page.evaluate((hallux) => {
                const api = (window as unknown as { __orthocadPressureMapE2E: PressureMapE2EApi })
                    .__orthocadPressureMapE2E;
                return api.measure?.(hallux as Record<Side, { u: number; v: number }>) ?? null;
            }, HALLUX_UV);
            if (!measured) throw new Error("pressure map measure() returned null");
            for (const dir of ARTIFACT_DIRS) mkdirSync(dir, { recursive: true });
            for (const dir of ARTIFACT_DIRS) {
                writeFileSync(resolve(dir, "pressure-map-measure.json"), JSON.stringify(measured, null, 2));
            }

            for (const side of ["left", "right"] as const) {
                const foot = measured.feet[side];
                assertFootprintWithin10Percent(side, foot);
                expect(foot.plane.maxY).toBeLessThan(foot.insole.minY);
                expect(Math.sign(foot.halluxWorld.z - foot.insoleCenter.z)).toBe(-foot.medialSign);
                expect(foot.halluxWorld.x).toBeGreaterThan(foot.insoleCenter.x);
            }

            const pairTopOn = await page.screenshot({ type: "png" });
            writeArtifact("pressure-map-pair-top-transparent-on.png", pairTopOn);
            expect(pairTopOn.byteLength).toBeGreaterThan(10_000);

            await page.evaluate(() => {
                (
                    window as unknown as { __orthocadPressureMapE2E: PressureMapE2EApi }
                ).__orthocadPressureMapE2E.setTransparent(false);
            });
            await page.waitForTimeout(500);
            const pairTopOff = await page.screenshot({ type: "png" });
            writeArtifact("pressure-map-pair-top-transparent-off.png", pairTopOff);

            await page.evaluate(() => {
                (
                    window as unknown as { __orthocadPressureMapE2E: PressureMapE2EApi }
                ).__orthocadPressureMapE2E.setTransparent(true);
            });
            await applyView("iso");
            await page.waitForTimeout(600);
            const rotated = await page.screenshot({ type: "png" });
            writeArtifact("pressure-map-pair-rotated-transparent-on.png", rotated);

            const splash = await page.locator('[data-testid="initial-load-splash"]').count();
            expect(splash).toBe(0);

            await browser.close();
        } finally {
            devProc?.kill("SIGTERM");
        }
    }, 240_000);
});

function assertFootprintWithin10Percent(side: string, foot: PressureMapFootMeasure) {
    const axes = [
        ["X", foot.plane.minX, foot.plane.maxX, foot.insole.minX, foot.insole.maxX],
        ["Z", foot.plane.minZ, foot.plane.maxZ, foot.insole.minZ, foot.insole.maxZ],
    ] as const;
    for (const [axis, p0, p1, i0, i1] of axes) {
        const size = Math.max(1e-6, i1 - i0);
        const d0 = Math.abs(p0 - i0) / size;
        const d1 = Math.abs(p1 - i1) / size;
        expect(d0, `${side} ${axis} min ${(d0 * 100).toFixed(1)}%`).toBeLessThan(0.1);
        expect(d1, `${side} ${axis} max ${(d1 * 100).toFixed(1)}%`).toBeLessThan(0.1);
    }
}

function writeArtifact(name: string, buf: Buffer) {
    for (const dir of ARTIFACT_DIRS) {
        writeFileSync(resolve(dir, name), buf);
    }
}

function waitForDevServer(proc: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Vite dev server timeout")), timeoutMs);
        const onData = (chunk: Buffer | string) => {
            const text = String(chunk);
            if (text.includes("Local:") || text.includes("ready in") || text.includes("5180")) {
                clearTimeout(timer);
                proc.stdout?.off("data", onData);
                proc.stderr?.off("data", onData);
                setTimeout(resolve, 800);
            }
        };
        proc.stdout?.on("data", onData);
        proc.stderr?.on("data", onData);
        proc.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
        proc.on("exit", (code) => {
            if (code && code !== 0) {
                clearTimeout(timer);
                reject(new Error(`Vite exited early (${code})`));
            }
        });
    });
}
