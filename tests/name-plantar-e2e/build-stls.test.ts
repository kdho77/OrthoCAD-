// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// The STL the bot sends: SAMPLE_Top, both feet, default bottom textMarking,
// engrave, name JABBOUR, buildPrinterFootManufacturingStl(side, true).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import { printerFootStlFacts } from "@/features/exports/printer-foot-isolation";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { composeMarkingTextForSide } from "@/lib/geometry/text-marking/compose";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";
import { SYNTHETIC_NAME } from "./thresholds";

const originalFetch = globalThis.fetch;

function installSampleTop(): void {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
    const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    globalThis.fetch = async (input) => {
        const url = String(input);
        if (!url.includes("SAMPLE_Top")) throw new Error(`unexpected fetch ${url}`);
        return new Response(bytes);
    };
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.textMarking = {
        ...defaultTextMarking("bottom"),
        text: SYNTHETIC_NAME,
        feet: "both",
        mode: "engrave",
    };
    useDesignStore.setState({
        design,
        viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
    });
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
});

describe("plantar-name manufacturing STLs", () => {
    test("both feet are the belt STL the bot sends, with JABBOUR engraved", async () => {
        installSampleTop();
        const marking = useDesignStore.getState().design.textMarking!;
        expect(marking.surface).toBe("bottom");
        expect(marking.mode).toBe("engrave");
        expect(marking.feet).toBe("both");
        expect(marking.bold).toBe(true);
        expect(marking.capHeightMm).toBe(12);
        expect(marking.depthMm).toBe(0.6);
        expect(composeMarkingTextForSide(marking, "left", null)).toBe(SYNTHETIC_NAME);
        expect(composeMarkingTextForSide(marking, "right", null)).toBe(SYNTHETIC_NAME);

        const outDir = process.env.NAME_PLANTAR_STL_DIR;
        if (outDir) mkdirSync(outDir, { recursive: true });
        const manifest: Record<string, number> = {};
        const bytes: Partial<Record<Side, Buffer>> = {};
        for (const side of ["left", "right"] as const) {
            const built = await buildPrinterFootManufacturingStl(side, true);
            expect(built.uploadTriangles, side).toBeGreaterThan(built.solidTriangles);
            expect(built.solidTriangles, side).toBeGreaterThan(1000);
            const facts = printerFootStlFacts(built.stl);
            expect(facts.side, side).toBe(side);
            expect(facts.triangleCount, side).toBe(built.uploadTriangles);
            const file = Buffer.from(built.stl);
            bytes[side] = file;
            manifest[`${side}Solid`] = built.solidTriangles;
            manifest[`${side}Upload`] = built.uploadTriangles;
            if (outDir) writeFileSync(join(outDir, `${side}.stl`), file);
        }
        expect(bytes.left!.equals(bytes.right!)).toBe(false);
        if (outDir) writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    }, 600_000);
});
