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

const hybridSpy = rs.fn(async (side: string) => ({
    ok: true as const,
    filename: `hybrid-${side}.gcode`,
    blob: new Blob([side]),
}));

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

    test("Apex Light, Bounce, and Forge are passed through before slicing", async () => {
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

        const bounce = await exportClinicalPrinterGcode({
            side: "left",
            design: useDesignStore.getState().design,
            apexMaterialId: "ApexBounce",
        });
        expect(bounce.ok).toBe(true);
        expect(hybridSpy).toHaveBeenCalledTimes(2);
        expect((hybridSpy.mock.calls[1]?.[4] as { apexMaterialId?: string }).apexMaterialId).toBe(
            "ApexBounce",
        );

        hybridSpy.mockClear();
        const forge = await exportClinicalPrinterGcode({
            side: "left",
            design: useDesignStore.getState().design,
            apexMaterialId: "ApexForge",
        });
        expect(forge.ok).toBe(true);
        expect((hybridSpy.mock.calls[0]?.[4] as { apexMaterialId?: string }).apexMaterialId).toBe(
            "ApexForge",
        );
    });

    test("paired export requests both feet and a single side stays one foot", async () => {
        const design = useDesignStore.getState().design;
        const both = await exportClinicalPrinterGcode({
            side: "left",
            feet: "both",
            design,
        });
        expect(both.ok).toBe(true);
        expect(hybridSpy.mock.calls.map((call) => call[0])).toEqual(["left", "right"]);
        expect(both.filenames).toEqual(["hybrid-left.gcode", "hybrid-right.gcode"]);
        for (const call of hybridSpy.mock.calls) {
            expect((call[4] as { includeLeaderBlock?: boolean }).includeLeaderBlock).toBe(true);
            expect((call[4] as { deferDownload?: boolean }).deferDownload).toBe(true);
        }

        hybridSpy.mockClear();
        const rightOnly = await exportClinicalPrinterGcode({
            side: "left",
            feet: "right",
            design,
        });
        expect(rightOnly.ok).toBe(true);
        expect(hybridSpy).toHaveBeenCalledTimes(1);
        expect(hybridSpy.mock.calls[0]?.[0]).toBe("right");
        expect(rightOnly.filenames).toEqual(["hybrid-right.gcode"]);
    });

    test("a pair failure is not a one-foot success, and cancel downloads nothing", async () => {
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
            expect(failed.reason).toMatch(/Right/);
            expect(failed.reason).toMatch(/No files were downloaded/);
        }
        expect(created).toEqual([]);

        hybridSpy.mockReset();
        let started = false;
        hybridSpy.mockImplementation(async () => {
            started = true;
            return { ok: true as const, filename: "hybrid-left.gcode", blob: new Blob(["L"]) };
        });
        const cancelled = await exportClinicalPrinterGcode({
            side: "left",
            feet: "both",
            design,
            shouldAbort: () => started,
        });
        expect(cancelled.ok).toBe(false);
        expect(cancelled.cancelled).toBe(true);
        expect(hybridSpy).toHaveBeenCalledTimes(1);
        expect(created).toEqual([]);
        URL.createObjectURL = original;
    });
});
