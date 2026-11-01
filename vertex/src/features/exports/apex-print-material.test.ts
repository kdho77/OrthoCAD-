// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApexPrintMaterialPicker } from "@/features/exports/ApexPrintMaterialPicker";
import {
    APEX_PRINT_MATERIAL_PICK_HINT,
    apexPrintMaterialById,
    lockedProfileIdForApexMaterial,
    printerPresetForApexMaterial,
} from "@/features/exports/apex-print-material";
import { buildExportFilename } from "@/features/exports/export-filename";
import { usePrintExportSettingsStore } from "@/features/exports/print-export-settings-store";
import { runExportForChoice } from "@/features/exports/run-export-action";
import { presetsForMethod } from "@/lib/kiri";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("Apex print material", () => {
    test("enabled materials map to existing locked profile ids", () => {
        expect(lockedProfileIdForApexMaterial("ApexCore")).toBe("apex-belt-v2");
        expect(lockedProfileIdForApexMaterial("ApexLight")).toBe("apex-belt-v2-shell");
        expect(printerPresetForApexMaterial("ApexCore")?.id).toBe("apex-belt-v2");
        expect(printerPresetForApexMaterial("ApexLight")?.id).toBe("apex-belt-v2-shell");
    });

    test("Bounce and Forge are disabled options", () => {
        expect(apexPrintMaterialById("ApexBounce").enabled).toBe(false);
        expect(apexPrintMaterialById("ApexForge").enabled).toBe(false);
        expect(apexPrintMaterialById("ApexBounce").disabledReason).toMatch(/not set up yet/i);
    });

    test("G-code filename includes material id when provided", () => {
        const name = buildExportFilename("gcode", "left", { apexMaterialId: "ApexCore" });
        expect(name).toContain("ApexCore");
        expect(name.endsWith(".gcode")).toBe(true);
    });

    test("printer G-code export blocked until material is picked", async () => {
        useAuthStore.setState({
            user: {
                id: "u-mat",
                email: "m@b.com",
                fullName: "M",
                role: "clinician",
                tokenBalance: 5,
            },
            license: { status: "active" } as never,
            loading: false,
        });
        useMillingProfileStore.setState({ machine: "printer" });
        useDesignStore.setState({ exportTarget: "left" });
        usePrintExportSettingsStore.setState({
            presetId: presetsForMethod(useDesignStore.getState().design.method)[0]?.id ?? "",
            apexMaterialId: null,
        });
        const preset = presetsForMethod(useDesignStore.getState().design.method)[0];
        const blocked = await runExportForChoice({
            choice: "gcode",
            target: "left",
            cnc: false,
            preset,
            apexMaterialId: null,
            grindingStyle: { type: "straight", angle_degrees: 8 },
            overrides: {},
            millingProfile: useMillingProfileStore.getState().profile,
            designRevision: "rev",
        });
        expect(blocked.ok).toBe(false);
        if (!blocked.ok) {
            expect(blocked.reason).toBe(APEX_PRINT_MATERIAL_PICK_HINT);
        }
    });

    describe("ApexPrintMaterialPicker UI", () => {
        let container: HTMLDivElement;
        let root: Root | null = null;

        afterEach(() => {
            root?.unmount();
            container?.remove();
        });

        test("disables Bounce and Forge buttons", async () => {
            container = document.createElement("div");
            document.body.appendChild(container);
            await act(async () => {
                root = createRoot(container);
                root.render(
                    createElement(ApexPrintMaterialPicker, {
                        value: null,
                        onChange: () => {},
                    }),
                );
            });
            const bounce = container.querySelector(
                '[data-testid="apex-material-ApexBounce"]',
            ) as HTMLButtonElement;
            const forge = container.querySelector(
                '[data-testid="apex-material-ApexForge"]',
            ) as HTMLButtonElement;
            expect(bounce?.disabled).toBe(true);
            expect(forge?.disabled).toBe(true);
            expect(bounce?.title).toMatch(/not set up yet/i);
        });
    });
});
