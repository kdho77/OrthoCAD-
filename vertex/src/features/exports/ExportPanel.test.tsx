// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { ExportPanel } from "./ExportPanel";
import { GCODE_EXPORT_STEPS } from "./export-service";

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

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
    hybridSpy.mockReset();
    hybridSpy.mockImplementation(async (side: string) => ({
        ok: true as const,
        filename: `hybrid-${side}.gcode`,
        blob: new Blob(["gcode"]),
    }));
    useDesignStore.setState({
        design: { ...useDesignStore.getState().design, method: "printing_solid" },
        exportSide: "left",
    });
    useAuthStore.setState({
        user: {
            id: "u1",
            email: "tech@example.com",
            role: "clinician",
            tokenBalance: 20,
            tenantId: "t1",
        },
        license: { status: "active", expiresAt: null, tenantId: "t1" },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

describe("ExportPanel clinical step", () => {
    test("shows and enables G-code export for 3D printer designs", async () => {
        await act(async () => root.render(createElement(ExportPanel, { clinicalExportStep: true })));
        const gcodeTab = container.querySelector('[data-export-kind="gcode"]');
        expect(gcodeTab).toBeTruthy();
        expect(gcodeTab?.textContent).toMatch(/G-code/i);

        await act(async () => (gcodeTab as HTMLButtonElement).click());
        const download = container.querySelector('[data-testid="clinical-export-download"]');
        expect(download?.textContent).toMatch(/Download G-code/i);
        expect((download as HTMLButtonElement).disabled).toBe(false);

        const both = container.querySelector('[data-testid="gcode-output-both"]');
        expect(both?.getAttribute("data-selected")).toBe("true");
        await act(async () => (download as HTMLButtonElement).click());
        expect(hybridSpy).toHaveBeenCalledTimes(2);
        expect(hybridSpy.mock.calls.map((call) => call[0])).toEqual(["left", "right"]);
        const filenames = hybridSpy.mock.calls.map((call) => call[0]);
        expect(new Set(filenames).size).toBe(2);
        for (const call of hybridSpy.mock.calls) {
            const options = call[4] as
                | { apexMaterialId?: string; includeLeaderBlock?: boolean; material?: string }
                | undefined;
            expect(options?.apexMaterialId).toBe("ApexCore");
            expect(options?.includeLeaderBlock).toBe(true);
            expect(options?.material).toBeUndefined();
        }
        expect(container.textContent).not.toMatch(/TPU 9[058]A/);
        const leader = container.querySelector('[data-testid="gcode-leader-block"]') as HTMLInputElement;
        expect(leader.checked).toBe(true);
    });

    test("G-code export shows the real step and disables the button while running", async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        hybridSpy.mockImplementation(async (side: string) => {
            await gate;
            return { ok: true as const, filename: `hybrid-${side}.gcode`, blob: new Blob(["gcode"]) };
        });

        await act(async () => root.render(createElement(ExportPanel, { clinicalExportStep: true })));
        const gcodeTab = container.querySelector('[data-export-kind="gcode"]') as HTMLButtonElement;
        await act(async () => gcodeTab.click());
        const material = container.querySelector('[data-testid="gcode-material"]') as HTMLSelectElement;
        expect(material.value).toBe("ApexCore");
        const bounce = container.querySelector(
            '[data-testid="apex-material-ApexBounce"]',
        ) as HTMLOptionElement;
        const forge = container.querySelector('[data-testid="apex-material-ApexForge"]') as HTMLOptionElement;
        expect(bounce.disabled).toBe(false);
        expect(forge.disabled).toBe(true);
        await act(async () => {
            material.value = "ApexLight";
            material.dispatchEvent(new Event("change", { bubbles: true }));
        });

        const download = container.querySelector(
            '[data-testid="clinical-export-download"]',
        ) as HTMLButtonElement;
        await act(async () => {
            download.click();
        });

        const progress = container.querySelector('[data-testid="gcode-export-progress"]');
        expect(progress?.textContent).toBe(GCODE_EXPORT_STEPS.prepare);
        expect(download.disabled).toBe(true);
        expect(download.textContent).toContain(GCODE_EXPORT_STEPS.prepare);
        expect(hybridSpy).toHaveBeenCalledTimes(1);
        expect((hybridSpy.mock.calls[0]?.[4] as { apexMaterialId?: string }).apexMaterialId).toBe(
            "ApexLight",
        );

        await act(async () => {
            release();
            await gate;
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(hybridSpy).toHaveBeenCalledTimes(2);
        expect(hybridSpy.mock.calls.map((call) => call[0])).toEqual(["left", "right"]);
        expect(download.disabled).toBe(false);
    });

    test("Right-only downloads one foot, and cancel stops the pair", async () => {
        await act(async () => root.render(createElement(ExportPanel, { clinicalExportStep: true })));
        const gcodeTab = container.querySelector('[data-export-kind="gcode"]') as HTMLButtonElement;
        await act(async () => gcodeTab.click());
        const right = container.querySelector('[data-testid="gcode-output-right"]') as HTMLButtonElement;
        await act(async () => right.click());
        expect(right.getAttribute("data-selected")).toBe("true");
        const download = container.querySelector(
            '[data-testid="clinical-export-download"]',
        ) as HTMLButtonElement;
        await act(async () => download.click());
        expect(hybridSpy).toHaveBeenCalledTimes(1);
        expect(hybridSpy.mock.calls[0]?.[0]).toBe("right");
        expect(container.textContent).toMatch(/Exported hybrid-right\.gcode/);

        hybridSpy.mockReset();
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        hybridSpy.mockImplementation(async () => {
            await gate;
            return { ok: true as const, filename: "hybrid-left.gcode", blob: new Blob(["L"]) };
        });
        const both = container.querySelector('[data-testid="gcode-output-both"]') as HTMLButtonElement;
        await act(async () => both.click());
        await act(async () => download.click());
        const cancel = container.querySelector('[data-testid="gcode-export-cancel"]') as HTMLButtonElement;
        expect(cancel).toBeTruthy();
        await act(async () => cancel.click());
        await act(async () => {
            release();
            await gate;
        });
        expect(hybridSpy).toHaveBeenCalledTimes(1);
        expect(container.textContent).toMatch(/Export cancelled/);
        expect(container.textContent).not.toMatch(/Exported hybrid-left/);
    });

    test("a failed second foot is not reported as a successful export", async () => {
        hybridSpy
            .mockResolvedValueOnce({
                ok: true as const,
                filename: "hybrid-left.gcode",
                blob: new Blob(["L"]),
            })
            .mockResolvedValueOnce({ ok: false as const, reason: "slice failed" });
        await act(async () => root.render(createElement(ExportPanel, { clinicalExportStep: true })));
        const gcodeTab = container.querySelector('[data-export-kind="gcode"]') as HTMLButtonElement;
        await act(async () => gcodeTab.click());
        const download = container.querySelector(
            '[data-testid="clinical-export-download"]',
        ) as HTMLButtonElement;
        await act(async () => download.click());
        expect(hybridSpy).toHaveBeenCalledTimes(2);
        expect(container.textContent).not.toMatch(/Exported hybrid-/);
        expect(container.textContent).toMatch(/Right G-code failed/);
        expect(download.disabled).toBe(false);
    });
});
