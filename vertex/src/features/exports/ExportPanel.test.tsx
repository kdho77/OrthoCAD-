// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { ExportPanel } from "./ExportPanel";

const hybridSpy = rs.fn(async () => ({ ok: true as const, filename: "hybrid-left.gcode" }));

rs.mock("@/features/exports/export-service", () => ({
    exportDesign: rs.fn(async () => ({ ok: true as const, filename: "x.stl" })),
    generateHybridGcode: (...args: unknown[]) => hybridSpy(...args),
    exportGcode: rs.fn(async () => ({ ok: false as const, reason: "unexpected client path" })),
}));

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
    hybridSpy.mockClear();
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

        await act(async () => (download as HTMLButtonElement).click());
        expect(hybridSpy).toHaveBeenCalledTimes(1);
    });
});
