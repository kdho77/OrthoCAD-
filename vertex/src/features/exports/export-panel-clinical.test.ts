// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { useDesignStore } from "@/stores/design-store";
import {
    clinicalExportFormatTabs,
    clinicalExportOffersGcode,
    defaultPrinterPresetForMethod,
    exportClinicalPrinterGcode,
    grindingStyleFromViewerWall,
} from "./export-panel-clinical";

const hybridSpy = rs.fn(async () => ({ ok: true as const, filename: "order.gcode" }));

rs.mock("@/features/exports/export-service", () => ({
    generateHybridGcode: (...args: unknown[]) => hybridSpy(...args),
    exportGcode: rs.fn(async () => ({ ok: false as const, reason: "unexpected client path" })),
}));

beforeEach(() => {
    hybridSpy.mockClear();
    useDesignStore.setState({
        design: { ...useDesignStore.getState().design, method: "printing_solid" },
        exportSide: "left",
    });
});

describe("export panel clinical gcode", () => {
    test("printing_solid orders offer G-code on the Export tab", () => {
        expect(clinicalExportOffersGcode("printing_solid")).toBe(true);
        expect(clinicalExportFormatTabs("printing_solid")).toEqual(["stl", "3mf", "glb", "gcode"]);
        expect(clinicalExportFormatTabs("milling_3axis")).toEqual(["stl", "3mf", "glb"]);
    });

    test("default belt preset and grinding style follow viewer wall", () => {
        expect(defaultPrinterPresetForMethod("printing_solid")?.id).toBe("apex-belt-v2");
        expect(grindingStyleFromViewerWall(undefined)).toEqual({ type: "rounded", radius_mm: 3 });
        expect(grindingStyleFromViewerWall("straight")).toEqual({ type: "straight", angle_degrees: 8 });
    });

    test("exportClinicalPrinterGcode uses generateHybridGcode (VertexSlice server path)", async () => {
        const res = await exportClinicalPrinterGcode({
            side: "left",
            design: useDesignStore.getState().design,
            wallStyle: undefined,
        });
        expect(res.ok).toBe(true);
        expect(hybridSpy).toHaveBeenCalledTimes(1);
        const [, preset, grinding] = hybridSpy.mock.calls[0] as [
            string,
            { id: string; beltAngleDeg?: number },
            { type: string },
            { layerHeightMm?: number; infillDensity?: number },
        ];
        expect(preset.id).toBe("apex-belt-v2");
        expect(preset.beltAngleDeg).toBe(45);
        expect(grinding.type).toBe("rounded");
        const options = hybridSpy.mock.calls[0][4] as {
            apexMaterialId?: string;
            includeLeaderBlock?: boolean;
            material?: string;
        };
        expect(options.apexMaterialId).toBe("ApexCore");
        expect(options.includeLeaderBlock).toBe(true);
        expect(options.material).toBeUndefined();
    });

    test("Apex Light is passed through and Bounce is refused before slicing", async () => {
        const res = await exportClinicalPrinterGcode({
            side: "left",
            design: useDesignStore.getState().design,
            wallStyle: "straight",
            apexMaterialId: "ApexLight",
        });
        expect(res.ok).toBe(true);
        const options = hybridSpy.mock.calls[0][4] as {
            apexMaterialId?: string;
            includeLeaderBlock?: boolean;
        };
        expect(options.apexMaterialId).toBe("ApexLight");
        expect(options.includeLeaderBlock).toBe(true);

        const blocked = await exportClinicalPrinterGcode({
            side: "left",
            design: useDesignStore.getState().design,
            apexMaterialId: "ApexBounce",
        });
        expect(blocked.ok).toBe(false);
        if (!blocked.ok) expect(blocked.reason).toMatch(/approved/i);
        expect(hybridSpy).toHaveBeenCalledTimes(1);

        const forge = await exportClinicalPrinterGcode({
            side: "left",
            design: useDesignStore.getState().design,
            apexMaterialId: "ApexForge",
        });
        expect(forge.ok).toBe(false);
        expect(hybridSpy).toHaveBeenCalledTimes(1);
    });
});
