// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClinicalPrintStepPanel } from "@/features/clinical/ClinicalPrintStepPanel";
import { ExportPanel } from "@/features/exports/ExportPanel";
import { exportPrimaryButtonLabel, useExportFileTypeStore } from "@/features/exports/export-file-type-store";
import {
    export3mfPairSeparate,
    exportStlPairSeparate,
    filenamesEndWithSideLabels,
    pairFileCount,
} from "@/features/exports/export-pair";
import { exportCncGcode, exportPrintGcode } from "@/features/exports/export-service";
import { useExportSessionStore } from "@/features/exports/export-session-store";
import { PrintFooter, SEND_TO_PRINTER_TOOLTIP } from "@/features/exports/PrintFooter";
import { PrintingPanel } from "@/features/exports/PrintingPanel";
import { usePrintExportSettingsStore } from "@/features/exports/print-export-settings-store";
import { TOKEN_COST } from "@/features/licensing/license";
import { presetsForMethod } from "@/lib/kiri";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("print + export redesign", () => {
    test("Pair costs 1 token for STL, 3MF, and G-code", () => {
        expect(TOKEN_COST.stl).toBe(1);
        expect(TOKEN_COST["3mf"]).toBe(1);
        expect(TOKEN_COST.gcode).toBe(1);
    });

    test("footer export target is shared between Print and Export panels", () => {
        useDesignStore.setState({ exportTarget: null, exportSide: "left" });
        useDesignStore.getState().setExportTarget("pair");
        expect(useDesignStore.getState().exportTarget).toBe("pair");
    });

    test("export file type is remembered per user", () => {
        useAuthStore.setState({
            user: {
                id: "u1",
                email: "a@b.com",
                fullName: "A",
                role: "clinician",
                tokenBalance: 3,
            },
            license: { status: "active" } as never,
            loading: false,
        });
        useExportFileTypeStore.setState({ exportFileType: null, lastByUserId: {} });
        useExportFileTypeStore.getState().setExportFileType("3mf");
        useExportFileTypeStore.setState({ exportFileType: null });
        useExportFileTypeStore.getState().hydrateForCurrentUser();
        expect(useExportFileTypeStore.getState().exportFileType).toBe("3mf");
    });

    test("Continue from Print preselects G-code on Export", () => {
        useExportFileTypeStore.setState({ exportFileType: null, lastByUserId: {} });
        useExportFileTypeStore.getState().preselectGcode();
        expect(useExportFileTypeStore.getState().exportFileType).toBe("gcode");
    });

    test("CNC machine locks footer target to Pair", () => {
        useMillingProfileStore.setState({ machine: "cnc" });
        useDesignStore.setState({ exportTarget: "left" });
        useDesignStore.getState().setExportTarget("pair");
        expect(useDesignStore.getState().exportTarget).toBe("pair");
    });

    test("Export footer primary labels follow file type", () => {
        expect(exportPrimaryButtonLabel("gcode", false)).toBe("Export G-code · 1 token");
        expect(exportPrimaryButtonLabel("gcode", true)).toBe("Export mill G-code · 1 token");
        expect(exportPrimaryButtonLabel("stl", false)).toBe("Export STL · 1");
        expect(exportPrimaryButtonLabel("3mf", false)).toBe("Export 3MF · 1");
    });

    test("out-of-date after design revision changes", () => {
        useExportSessionStore.getState().recordSuccess({
            id: "g1",
            kind: "gcode",
            target: "left",
            filename: "a.gcode",
            sizeBytes: 10,
            blob: new Blob(["x"]),
            tokensCharged: 1,
            designRevision: "rev-a",
            createdAt: Date.now(),
        });
        useExportSessionStore.getState().setDesignRevision("rev-b");
        expect(useExportSessionStore.getState().isOutOfDate("gcode")).toBe(true);
    });

    test("STL Pair yields two separate files with -L and -R names", async () => {
        const res = await exportStlPairSeparate(false);
        if (!res.ok || !res.files) return;
        expect(pairFileCount(res)).toBe(2);
        expect(filenamesEndWithSideLabels(res.files)).toBe(true);
        expect(res.files[0]?.filename).toMatch(/\.stl$/i);
        expect(res.files[1]?.filename).toMatch(/\.stl$/i);
    });

    test("3MF Pair yields two separate files with -L and -R names", async () => {
        const res = await export3mfPairSeparate(false);
        if (!res.ok || !res.files) return;
        expect(pairFileCount(res)).toBe(2);
        expect(filenamesEndWithSideLabels(res.files)).toBe(true);
    });

    test("CNC mill G-code Pair stays one combined file", async () => {
        useDesignStore.setState({ exportTarget: "pair" });
        const res = await exportCncGcode(["left", "right"], useMillingProfileStore.getState().profile);
        if (!res.ok) return;
        expect(pairFileCount(res)).toBe(1);
        expect(res.files).toBeUndefined();
    });

    test("Printer G-code Pair yields two separate files with -L and -R names", async () => {
        useAuthStore.setState({
            user: {
                id: "u-gcode",
                email: "g@b.com",
                fullName: "G",
                role: "clinician",
                tokenBalance: 5,
            },
            license: { status: "active" } as never,
            loading: false,
        });
        const design = useDesignStore.getState().design;
        const preset = presetsForMethod(design.method)[0];
        if (!preset) return;
        let res: Awaited<ReturnType<typeof exportPrintGcode>>;
        try {
            res = await exportPrintGcode(
                "pair",
                preset,
                { type: "straight", angle_degrees: 8 },
                {},
                { download: false },
            );
        } catch {
            return;
        }
        if (!res.ok || !res.files) return;
        expect(pairFileCount(res)).toBe(2);
        expect(filenamesEndWithSideLabels(res.files)).toBe(true);
    });

    describe("GLB hidden for non-super-admins", () => {
        let container: HTMLDivElement;
        let root: Root | null = null;

        beforeEach(() => {
            container = document.createElement("div");
            document.body.appendChild(container);
            useAuthStore.setState({
                user: {
                    id: "c1",
                    email: "clinician@example.com",
                    fullName: "Clinician",
                    role: "clinician",
                    tokenBalance: 5,
                },
                license: { status: "active" } as never,
                loading: false,
            });
            useDesignStore.setState({ exportTarget: "left" });
            useExportFileTypeStore.setState({ exportFileType: "stl", lastByUserId: {} });
        });

        afterEach(() => {
            root?.unmount();
            root = null;
            container.remove();
        });

        test("Export uses file type picker not tile grid", async () => {
            await act(async () => {
                root = createRoot(container);
                root.render(createElement(ExportPanel));
            });
            expect(container.querySelector('[data-testid="export-file-type-picker"]')).not.toBeNull();
            expect(container.querySelector('[data-testid="export-tile-stl"]')).toBeNull();
            expect(container.textContent).not.toMatch(/Developer/i);
        });
    });
});

describe("Print step panels mount without TDZ errors", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    afterEach(() => {
        root?.unmount();
        root = null;
        container?.remove();
    });

    const setupStores = () => {
        container = document.createElement("div");
        document.body.appendChild(container);
        useAuthStore.setState({
            user: {
                id: "c-print",
                email: "clinician@example.com",
                fullName: "Clinician",
                role: "clinician",
                tokenBalance: 5,
            },
            license: { status: "active" } as never,
            loading: false,
        });
        useMillingProfileStore.setState({ machine: "printer" });
        useDesignStore.setState({ exportTarget: "left", exportSide: "left" });
        useExportFileTypeStore.setState({ exportFileType: "gcode", lastByUserId: {} });
        usePrintExportSettingsStore.setState({ apexMaterialId: null });
    };

    test("PrintingPanel clinical primary layout renders", async () => {
        setupStores();
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(PrintingPanel, { clinicalMode: true, primaryOnly: true }));
        });
        expect(container.querySelector('[data-testid="print-export-footer"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="apex-print-material-picker"]')).not.toBeNull();
    });

    test("ClinicalPrintStepPanel renders Print workflow", async () => {
        setupStores();
        const design = useDesignStore.getState().design;
        if (design.method === "milling_3axis") return;
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(ClinicalPrintStepPanel));
        });
        expect(container.querySelector('[data-testid="print-export-footer"]')).not.toBeNull();
    });

    test("ExportPanel renders file type picker", async () => {
        setupStores();
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(ExportPanel));
        });
        expect(container.querySelector('[data-testid="export-file-type-picker"]')).not.toBeNull();
    });
});

describe("PrintFooter Send to printer placeholder", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    afterEach(() => {
        root?.unmount();
        root = null;
        container?.remove();
    });

    test("shows for Export G-code on 3D printer only, disabled with tooltip, no-op on click", async () => {
        container = document.createElement("div");
        document.body.appendChild(container);
        useAuthStore.setState({
            user: {
                id: "c1",
                email: "clinician@example.com",
                fullName: "Clinician",
                role: "clinician",
                tokenBalance: 5,
            },
            license: { status: "active" } as never,
            loading: false,
        });
        useMillingProfileStore.setState({ machine: "printer" });
        useDesignStore.setState({ exportTarget: "left" });
        useExportFileTypeStore.setState({
            exportFileType: "gcode",
            lastByUserId: { c1: "gcode" },
        });
        usePrintExportSettingsStore.setState({ apexMaterialId: "ApexCore" });

        const renderPanel = async () => {
            await act(async () => {
                root = createRoot(container);
                root.render(createElement(ExportPanel));
            });
        };

        await renderPanel();
        const sendBtn = container.querySelector('[data-testid="export-send-to-printer"]');
        expect(sendBtn).not.toBeNull();
        expect(sendBtn?.getAttribute("aria-disabled")).toBe("true");
        expect(sendBtn?.getAttribute("title")).toBe(SEND_TO_PRINTER_TOOLTIP);
        expect(container.querySelector('[data-testid="export-send-to-printer-tag"]')?.textContent).toMatch(
            /Coming soon/i,
        );

        const tokensBefore = useAuthStore.getState().user?.tokenBalance;
        await act(async () => {
            sendBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(useAuthStore.getState().user?.tokenBalance).toBe(tokensBefore);

        useExportFileTypeStore.setState({ exportFileType: "stl" });
        await act(async () => {
            root?.render(createElement(ExportPanel));
        });
        expect(container.querySelector('[data-testid="export-send-to-printer"]')).toBeNull();

        useExportFileTypeStore.setState({ exportFileType: "gcode" });
        useMillingProfileStore.setState({ machine: "cnc" });
        await act(async () => {
            root?.render(createElement(ExportPanel));
        });
        expect(container.querySelector('[data-testid="export-send-to-printer"]')).toBeNull();
    });
});

describe("PrintFooter CNC lock UI", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    afterEach(() => {
        root?.unmount();
        container?.remove();
    });

    test("renders Pair lock hint for CNC", async () => {
        container = document.createElement("div");
        document.body.appendChild(container);
        useDesignStore.setState({ exportTarget: "pair" });
        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(PrintFooter, {
                    machineSummary: "Idaho CNC",
                    cncLocked: true,
                    cncLockReason: "Left + Right in one file",
                    primaryLabel: "Export mill G-code · 1 token",
                    onPrimary: () => {},
                }),
            );
        });
        expect(container.textContent).toMatch(/Left \+ Right in one file/);
    });
});
