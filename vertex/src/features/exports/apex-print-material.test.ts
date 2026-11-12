// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApexPrintMaterialPicker } from "@/features/exports/ApexPrintMaterialPicker";
import {
    APEX_BOUNCE_BED_TEMP_C,
    APEX_BOUNCE_NOZZLE_TEMP_C,
    APEX_BOUNCE_SPEED_FACTOR,
    APEX_CORE_NOZZLE_TEMP_C,
    APEX_V2_INSOLE_LOCKED_PROFILE_ID,
    apexPrintMaterialById,
    apexPrintMaterialForOrderMaterial,
    lockedProfileIdForApexMaterial,
    printerPresetForApexMaterial,
    REGIONAL_INFILL_PRESETS,
    VERTEX_SLICE_APEX_BOUNCE_PACKET,
    vertexSliceMaterialForApexMaterial,
    vertexSliceRegional3mfEnabled,
} from "@/features/exports/apex-print-material";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("Apex print material", () => {
    test("enabled materials map to the locked VertexSlice profile and material ids", () => {
        expect(lockedProfileIdForApexMaterial("ApexCore")).toBe(APEX_V2_INSOLE_LOCKED_PROFILE_ID);
        expect(lockedProfileIdForApexMaterial("ApexLight")).toBe("apex-v2-insole-95a");
        expect(vertexSliceMaterialForApexMaterial("ApexCore")).toBe("apex_core");
        expect(vertexSliceMaterialForApexMaterial("ApexLight")).toBe("apex_light");
        expect(apexPrintMaterialById("ApexCore").label).toBe("Apex Core");
        expect(apexPrintMaterialById("ApexLight").label).toBe("Apex Light");
        expect(apexPrintMaterialById("ApexCore").shoreLabel).toBe("Shore 95A");
        expect(apexPrintMaterialById("ApexLight").shoreLabel).toBe("Shore 90A");
        expect(printerPresetForApexMaterial("ApexCore").id).toBe("apex-v2-insole-95a");
        expect(printerPresetForApexMaterial("ApexLight").id).toBe("apex-v2-insole-95a");
        expect(printerPresetForApexMaterial("ApexCore").beltAngleDeg).toBe(45);
    });

    test("ApexComfort uses Apex Core locked settings", () => {
        expect(apexPrintMaterialForOrderMaterial("ApexComfort")).toBe("ApexCore");
        expect(apexPrintMaterialForOrderMaterial("Apex Comfort")).toBe("ApexCore");
        expect(lockedProfileIdForApexMaterial("ApexCore")).toBe("apex-v2-insole-95a");
    });

    test("ApexLight Foam is the Apex Light order label", () => {
        expect(apexPrintMaterialForOrderMaterial("ApexLight Foam")).toBe("ApexLight");
        expect(apexPrintMaterialForOrderMaterial("Apex Light Foam")).toBe("ApexLight");
        expect(apexPrintMaterialForOrderMaterial("apex-light-foam")).toBe("ApexLight");
        expect(apexPrintMaterialForOrderMaterial("Apex Light")).toBe("ApexLight");
        expect(apexPrintMaterialForOrderMaterial("ApexLight")).toBe("ApexLight");
        expect(apexPrintMaterialForOrderMaterial("apex_light")).toBe("ApexLight");
        expect(vertexSliceMaterialForApexMaterial("ApexLight")).toBe("apex_light");
        expect(apexPrintMaterialForOrderMaterial("Apex Forge")).toBe("ApexForge");
        expect(apexPrintMaterialById("ApexForge").enabled).toBe(false);
        expect(apexPrintMaterialForOrderMaterial("ApexVylon")).toBeNull();
    });

    test("Apex Bounce uses the approved Core deltas and Forge stays disabled", () => {
        expect(apexPrintMaterialById("ApexBounce").enabled).toBe(true);
        expect(lockedProfileIdForApexMaterial("ApexBounce")).toBe(APEX_V2_INSOLE_LOCKED_PROFILE_ID);
        expect(vertexSliceMaterialForApexMaterial("ApexBounce")).toBe("apex_bounce");
        expect(APEX_CORE_NOZZLE_TEMP_C).toBe(225);
        expect(APEX_BOUNCE_NOZZLE_TEMP_C).toBe(220);
        expect(APEX_BOUNCE_BED_TEMP_C).toBe(70);
        expect(APEX_BOUNCE_SPEED_FACTOR).toBe(0.8);
        expect(VERTEX_SLICE_APEX_BOUNCE_PACKET).toMatchObject({
            owner: "VertexSlice",
            liveVerified: false,
            orthocadSendsProcessOverrides: false,
            materialId: "apex_bounce",
            cloneFromMaterialId: "apex_core",
            speedFactorVersusCore: 0.8,
        });
        expect(VERTEX_SLICE_APEX_BOUNCE_PACKET).not.toHaveProperty("printSpeedMmS");
        expect(VERTEX_SLICE_APEX_BOUNCE_PACKET.coreSpeedMmS).toBeNull();
        expect(VERTEX_SLICE_APEX_BOUNCE_PACKET.runtimeProofRequired.join(" ")).toMatch(/220C/);
        expect(VERTEX_SLICE_APEX_BOUNCE_PACKET.runtimeProofRequired.join(" ")).toMatch(/70C/);
        expect(VERTEX_SLICE_APEX_BOUNCE_PACKET.runtimeProofRequired.join(" ")).toMatch(/0\.8/);
        expect(apexPrintMaterialById("ApexForge").enabled).toBe(false);
        expect(() => lockedProfileIdForApexMaterial("ApexForge")).toThrow(/approved/i);
    });

    test("regional hardness uses the same four slice fields and stays gated off", () => {
        expect(vertexSliceRegional3mfEnabled({})).toBe(false);
        expect(vertexSliceRegional3mfEnabled({ VERTEXSLICE_REGIONAL_3MF: "1" })).toBe(true);
        expect(vertexSliceRegional3mfEnabled({ VERTEXSLICE_REGIONAL_3MF: "true" })).toBe(true);
        expect(vertexSliceRegional3mfEnabled({ VERTEXSLICE_REGIONAL_3MF: "off" })).toBe(false);
        expect(REGIONAL_INFILL_PRESETS.map((preset) => [preset.hardnessClass, preset.densityPct])).toEqual([
            ["Extra Soft", 14],
            ["Soft", 20],
            ["Medium", 26],
            ["Hard", 32],
            ["Extra Hard", 38],
        ]);
        expect(VERTEX_SLICE_APEX_BOUNCE_PACKET.sliceFormFieldsSentByOrthocad).toEqual([
            "profile_id",
            "material",
            "infill_density",
            "model",
        ]);
        expect(VERTEX_SLICE_APEX_BOUNCE_PACKET.regionalModelGateEnv).toBe("VERTEXSLICE_REGIONAL_3MF");
    });

    describe("ApexPrintMaterialPicker", () => {
        let container: HTMLDivElement;
        let root: Root | null = null;

        afterEach(() => {
            root?.unmount();
            container?.remove();
        });

        test("shows Apex Light, Core, and Bounce as selectable and disables Forge", async () => {
            container = document.createElement("div");
            document.body.appendChild(container);
            const picks: string[] = [];
            await act(async () => {
                root = createRoot(container);
                root.render(
                    createElement(ApexPrintMaterialPicker, {
                        value: "ApexCore",
                        onChange: (id) => picks.push(id),
                    }),
                );
            });
            const select = container.querySelector('[data-testid="gcode-material"]') as HTMLSelectElement;
            const labels = [...select.options].map((opt) => opt.text);
            expect(labels).toEqual(["Apex Light", "Apex Core", "Apex Bounce", "Apex Forge"]);
            expect(select.value).toBe("ApexCore");
            const light = container.querySelector(
                '[data-testid="apex-material-ApexLight"]',
            ) as HTMLOptionElement;
            const core = container.querySelector(
                '[data-testid="apex-material-ApexCore"]',
            ) as HTMLOptionElement;
            const bounce = container.querySelector(
                '[data-testid="apex-material-ApexBounce"]',
            ) as HTMLOptionElement;
            const forge = container.querySelector(
                '[data-testid="apex-material-ApexForge"]',
            ) as HTMLOptionElement;
            expect(light.disabled).toBe(false);
            expect(core.disabled).toBe(false);
            expect(bounce.disabled).toBe(false);
            expect(forge.disabled).toBe(true);
            expect(forge.title).toMatch(/approved/i);
            expect(container.textContent).not.toMatch(/TPU 9[058]A/);
            expect(container.querySelector('[data-testid="gcode-material-shore"]')?.textContent).toBe(
                "Apex Core · Shore 95A",
            );

            await act(async () => {
                select.value = "ApexBounce";
                select.dispatchEvent(new Event("change", { bubbles: true }));
            });
            expect(picks).toEqual(["ApexBounce"]);

            await act(async () => {
                select.value = "ApexLight";
                select.dispatchEvent(new Event("change", { bubbles: true }));
            });
            expect(picks).toEqual(["ApexBounce", "ApexLight"]);
        });
    });
});
