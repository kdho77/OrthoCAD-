// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AfoPrintPanel } from "@/features/afo/AfoPrintPanel";
import {
    APEX_FORGE_PROCESS_SETTINGS,
    APEX_PRINT_MATERIAL_OPTIONS,
    APEX_V2_INSOLE_LOCKED_PROFILE_ID,
    APEX_VYLON_PROCESS_SETTINGS,
    afoShellSliceFields,
    VERTEX_SLICE_APEX_VYLON_PACKET,
} from "@/features/exports/apex-print-material";
import {
    AFO_MATERIAL,
    AFO_PRINT_MATERIAL_IDS,
    afoPrintParams,
    coerceAfoPrintMaterial,
    defaultAfoPrint,
} from "@/lib/geometry/afo/defaults";
import { getAfoState, setProductType } from "@/stores/afo-store";
import { defaultDesign, useDesignStore } from "@/stores/design-store";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AFO ApexVylon print material", () => {
    test("the print material list and default are exactly ApexVylon", () => {
        expect([...AFO_PRINT_MATERIAL_IDS]).toEqual(["ApexVylon"]);
        expect(AFO_MATERIAL).toBe("ApexVylon");
        expect(defaultAfoPrint().material).toBe("ApexVylon");
        expect(AFO_PRINT_MATERIAL_IDS).not.toContain("PLA");
        expect(coerceAfoPrintMaterial("PLA")).toBe("ApexVylon");
        expect(coerceAfoPrintMaterial("PA12")).toBe("ApexVylon");
        expect(coerceAfoPrintMaterial("ApexCore")).toBe("ApexVylon");
        expect(coerceAfoPrintMaterial("ApexForge")).toBe("ApexVylon");
        expect(coerceAfoPrintMaterial("ApexVylon")).toBe("ApexVylon");
        expect(coerceAfoPrintMaterial(undefined)).toBe("ApexVylon");
        expect(afoPrintParams({ material: "PLA", thicknessMm: 4, edgeMm: 2, flareMm: 1.5 })).toEqual({
            thicknessMm: 4,
            edgeMm: 2,
            flareMm: 1.5,
            material: "ApexVylon",
        });
    });

    test("saved PLA in the AFO design is coerced when the print state is read", () => {
        useDesignStore.setState({ design: defaultDesign() });
        setProductType("afo", "left");
        const afo = useDesignStore.getState().design.afo;
        if (!afo) throw new Error("AFO state missing");
        const legacy = {
            ...afo,
            print: { ...afo.print, material: "PLA" as typeof afo.print.material },
        };
        useDesignStore.setState({
            design: { ...useDesignStore.getState().design, afo: legacy },
        });
        expect(useDesignStore.getState().design.afo?.print.material).toBe("PLA");
        expect(getAfoState().print.material).toBe("ApexVylon");
        expect(afoPrintParams(getAfoState().print).material).toBe("ApexVylon");
    });

    test("ApexVylon matches ApexForge except belt/bed 60°C and wall loops 6", () => {
        const aligned = {
            ...APEX_VYLON_PROCESS_SETTINGS,
            id: APEX_FORGE_PROCESS_SETTINGS.id,
            label: APEX_FORGE_PROCESS_SETTINGS.label,
            vertexSliceMaterial: APEX_FORGE_PROCESS_SETTINGS.vertexSliceMaterial,
            bedTempC: APEX_FORGE_PROCESS_SETTINGS.bedTempC,
            beltTempC: APEX_FORGE_PROCESS_SETTINGS.beltTempC,
            wallLoops: APEX_FORGE_PROCESS_SETTINGS.wallLoops,
        };
        expect(aligned).toEqual(APEX_FORGE_PROCESS_SETTINGS);
        expect(APEX_FORGE_PROCESS_SETTINGS.bedTempC).toBe(0);
        expect(APEX_FORGE_PROCESS_SETTINGS.beltTempC).toBe(0);
        expect(APEX_FORGE_PROCESS_SETTINGS.wallLoops).toBeNull();
        expect(APEX_FORGE_PROCESS_SETTINGS.nozzleTempC).toBe(245);
        expect(APEX_VYLON_PROCESS_SETTINGS.bedTempC).toBe(60);
        expect(APEX_VYLON_PROCESS_SETTINGS.beltTempC).toBe(60);
        expect(APEX_VYLON_PROCESS_SETTINGS.wallLoops).toBe(6);
        expect(APEX_VYLON_PROCESS_SETTINGS.nozzleTempC).toBe(245);
        expect(APEX_VYLON_PROCESS_SETTINGS.id).toBe("ApexVylon");
        expect(APEX_VYLON_PROCESS_SETTINGS.label).toBe("ApexVylon");
        expect(APEX_VYLON_PROCESS_SETTINGS.vertexSliceMaterial).toBe("apex_vylon");
        expect(APEX_VYLON_PROCESS_SETTINGS.lockedProfileId).toBe(APEX_V2_INSOLE_LOCKED_PROFILE_ID);
    });

    test("AFO shell slice fields resolve to apex_vylon on the locked profile", () => {
        expect(afoShellSliceFields()).toEqual({
            presetId: "apex-v2-insole-95a",
            material: "apex_vylon",
        });
        expect(afoShellSliceFields().presetId).toBe(APEX_FORGE_PROCESS_SETTINGS.lockedProfileId);
        expect(afoShellSliceFields().presetId).toBe(APEX_V2_INSOLE_LOCKED_PROFILE_ID);
    });

    test("the VertexSlice ApexVylon packet clones Forge with belt 60 and wall loops 6", () => {
        expect(VERTEX_SLICE_APEX_VYLON_PACKET).toMatchObject({
            owner: "VertexSlice",
            liveVerified: false,
            orthocadSendsProcessOverrides: false,
            materialId: "apex_vylon",
            cloneFromMaterialId: "apex_forge",
            nozzleTempC: 245,
            bedTempC: 60,
            beltTempC: 60,
            wallLoops: 6,
            otherwiseIdenticalTo: "apex_forge",
            sliceFormFieldsSentByOrthocad: ["profile_id", "material", "infill_density", "model"],
        });
        expect(VERTEX_SLICE_APEX_VYLON_PACKET).not.toHaveProperty("printSpeedMmS");
        const proof = VERTEX_SLICE_APEX_VYLON_PACKET.runtimeProofRequired.join(" ");
        expect(proof).toMatch(/GET \/v1\/materials/);
        expect(proof).toMatch(/POST \/v1\/slice/);
        expect(proof).toMatch(/apex_vylon/);
        expect(proof).toMatch(/245C/);
        expect(proof).toMatch(/60C/);
        expect(proof).toMatch(/wall loops to 6/);
    });

    test("insole print materials stay Light, Core, Bounce, and disabled Forge", () => {
        expect(
            APEX_PRINT_MATERIAL_OPTIONS.map((opt) => [opt.id, opt.enabled, opt.vertexSliceMaterial]),
        ).toEqual([
            ["ApexLight", true, "apex_light"],
            ["ApexCore", true, "apex_core"],
            ["ApexBounce", true, "apex_bounce"],
            ["ApexForge", false, "apex_forge"],
        ]);
        expect(APEX_PRINT_MATERIAL_OPTIONS.map((opt) => opt.id)).not.toContain("ApexVylon");
    });

    describe("AfoPrintPanel material control", () => {
        let container: HTMLDivElement;
        let root: Root | null = null;

        afterEach(() => {
            root?.unmount();
            container?.remove();
        });

        test("offers only ApexVylon when saved settings still say PLA", async () => {
            useDesignStore.setState({ design: defaultDesign() });
            setProductType("afo", "left");
            const afo = useDesignStore.getState().design.afo;
            if (!afo) throw new Error("AFO state missing");
            useDesignStore.setState({
                design: {
                    ...useDesignStore.getState().design,
                    afo: {
                        ...afo,
                        print: { ...afo.print, material: "PLA" as typeof afo.print.material },
                    },
                },
            });
            container = document.createElement("div");
            document.body.appendChild(container);
            await act(async () => {
                root = createRoot(container);
                root.render(createElement(AfoPrintPanel));
            });
            const select = container.querySelector('[data-testid="afo-print-material"]') as HTMLSelectElement;
            expect([...select.options].map((opt) => opt.value)).toEqual(["ApexVylon"]);
            expect([...select.options].map((opt) => opt.text)).toEqual(["ApexVylon"]);
            expect(select.value).toBe("ApexVylon");
            expect(select.tagName).toBe("SELECT");
            expect(container.textContent).not.toMatch(/\bPLA\b/);
        });
    });
});
