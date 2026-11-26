// Independent grader for PR #461 gate G5. Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test } from "@rstest/core";

const PR461_HEAD = "4d2239239125082f8d90de81e1410681b7f33597";
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

function pr461Source(rel: string): string {
    return execSync(`git show ${PR461_HEAD}:${rel}`, { cwd: REPO_ROOT, encoding: "utf8" });
}

function pr461FixPresent(): boolean {
    return readFileSync(
        resolve(REPO_ROOT, "vertex/src/lib/geometry/text-marking/bottom-engrave.ts"),
        "utf8",
    ).includes("stitchOpenEngraveSeam");
}

import { exportClinicalPrinterGcode } from "@/features/exports/export-panel-clinical";
import { useDesignStore } from "@/stores/design-store";

const hybridSpy = rs.fn(async () => ({
    ok: true as const,
    filename: "hybrid-left.gcode",
    blob: new Blob(["gcode"]),
}));

rs.mock("@/features/exports/export-service", () => ({
    exportDesign: rs.fn(async () => ({ ok: true as const, filename: "x.stl" })),
    generateHybridGcode: (...args: unknown[]) => hybridSpy(...args),
    exportGcode: rs.fn(async () => ({ ok: false as const, reason: "unexpected client path" })),
    GCODE_EXPORT_STEPS: {
        prepare: "Preparing the insole solid…",
        upload: "Uploading the solid…",
        slice: "Slicing G-code…",
        download: "Downloading G-code…",
    },
}));

const runtimePairExport = pr461FixPresent();

describe("PR #461 grader G5 — pair export does not drop a foot", () => {
    beforeEach(() => {
        hybridSpy.mockReset();
        hybridSpy.mockImplementation(async (side: string) => ({
            ok: true as const,
            filename: `hybrid-${side}.gcode`,
            blob: new Blob([side === "left" ? "L" : "R"]),
        }));
        useDesignStore.setState({
            design: { ...useDesignStore.getState().design, method: "printing_solid" },
        });
    });

    (runtimePairExport ? test : test.skip)(
        "pair belt export waits for both feet before any download",
        async () => {
            const design = useDesignStore.getState().design;
            let releaseLeft!: () => void;
            const leftGate = new Promise<void>((resolve) => {
                releaseLeft = resolve;
            });
            let releaseRight!: () => void;
            const rightGate = new Promise<void>((resolve) => {
                releaseRight = resolve;
            });
            hybridSpy.mockImplementation(async (side: string) => {
                if (side === "left") await leftGate;
                else await rightGate;
                return {
                    ok: true as const,
                    filename: `hybrid-${side}.gcode`,
                    blob: new Blob([side === "left" ? "L" : "R"]),
                };
            });
            const created: string[] = [];
            const original = URL.createObjectURL;
            URL.createObjectURL = ((blob: Blob) => {
                created.push(String(blob.size));
                return "blob:test";
            }) as typeof URL.createObjectURL;

            const exportPromise = exportClinicalPrinterGcode({ side: "left", feet: "both", design });
            await new Promise((r) => setTimeout(r, 0));
            expect(created).toEqual([]);
            releaseLeft();
            await new Promise((r) => setTimeout(r, 0));
            expect(created).toEqual([]);
            releaseRight();
            const done = await exportPromise;
            expect(done.ok).toBe(true);
            expect(created).toEqual(["1", "1"]);
            URL.createObjectURL = original;
        },
    );

    (runtimePairExport ? test : test.skip)(
        "a failed right foot names the side and downloads nothing",
        async () => {
            const design = useDesignStore.getState().design;
            hybridSpy
                .mockResolvedValueOnce({
                    ok: true as const,
                    filename: "hybrid-left.gcode",
                    blob: new Blob(["L"]),
                })
                .mockResolvedValueOnce({ ok: false as const, reason: "slice failed" });
            const created: string[] = [];
            const original = URL.createObjectURL;
            URL.createObjectURL = ((blob: Blob) => {
                created.push(String(blob.size));
                return "blob:test";
            }) as typeof URL.createObjectURL;
            const failed = await exportClinicalPrinterGcode({ side: "left", feet: "both", design });
            expect(failed.ok).toBe(false);
            if (!failed.ok) {
                expect(failed.reason).toMatch(/Right G-code failed/);
                expect(failed.reason).toMatch(/slice failed/);
                expect(failed.reason).toMatch(/No files were downloaded/);
            }
            expect(created).toEqual([]);
            URL.createObjectURL = original;
        },
    );

    test("STL pair path throws with foot label before writing files", () => {
        const src = pr461Source("vertex/src/lib/geometry/export-geometry.ts");
        expect(src).toMatch(/foot failed\./);
        expect(src).toMatch(/label = side === "right" \? "Right" : "Left"/);
    });
});

describe("PR #461 grader G5 — export source includes defer-download pair contract", () => {
    test("clinical export batches downloads after all feet succeed", () => {
        const src = pr461Source("vertex/src/features/exports/export-panel-clinical.ts");
        expect(src).toContain("deferDownload: true");
        expect(src).toMatch(/No files were downloaded/);
        expect(src).toMatch(/Both feet are known good before any file is saved/);
        const mapBlock = src.split("feet.map")[1]?.split("}),")[0] ?? "";
        expect(mapBlock).not.toContain("downloadNamedBlobs");
    });
});
