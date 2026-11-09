// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import { printerFootStlFacts } from "@/features/exports/printer-foot-isolation";
import {
    buildFinalizedFootFromSavedDesign,
    designStateFromSavedSettings,
} from "@/features/exports/saved-design-finalized-mesh";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import { binaryStlTriangleCount } from "@/lib/geometry/leader-block";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { designSettingsEnvelope } from "../../../shared/design-settings";

const originalFetch = globalThis.fetch;

function sha256(bytes: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function installDesign(design: ReturnType<typeof createDesignWithStockPlaceholder>) {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
    const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    globalThis.fetch = async () => new Response(bytes);
    useDesignStore.setState({
        design,
        viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
    });
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
});

describe("saved-design mesh matches canonical Export", () => {
    test("left and right solids match Export bytes, are watertight before the leader, and differ by foot", async () => {
        const design = createDesignWithStockPlaceholder();
        const sampleTop = installDesign(design);
        const settingsJson = designSettingsEnvelope(design as unknown as Record<string, unknown>);
        const fromSettings = designStateFromSavedSettings(settingsJson);
        expect(fromSettings.thicknessMm).toBe(design.thicknessMm);
        expect(fromSettings.corrections.left.archHeightMm).toBe(design.corrections.left.archHeightMm);

        const canonicalSolid = await buildExportStl("left");
        const solidGeometry = binaryStlToGeometry(canonicalSolid);
        try {
            const report = validateManifold(solidGeometry);
            expect(report.isWatertight).toBe(true);
            expect(report.eulerCharacteristic).toBe(2);
            expect(report.triangleCount).toBe(binaryStlTriangleCount(canonicalSolid));
        } finally {
            solidGeometry.dispose();
        }

        installDesign(design);
        const canonicalLeft = await buildPrinterFootManufacturingStl("left", true);
        installDesign(design);
        const savedLeft = await buildFinalizedFootFromSavedDesign({
            design,
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: true,
        });
        expect(sha256(savedLeft.stl)).toBe(sha256(canonicalLeft.stl));
        expect(savedLeft.solidTriangles).toBe(binaryStlTriangleCount(canonicalSolid));
        expect(savedLeft.uploadTriangles).toBe(canonicalLeft.uploadTriangles);
        expect(savedLeft.uploadTriangles - savedLeft.solidTriangles).toBeGreaterThan(0);
        expect(printerFootStlFacts(savedLeft.stl).side).toBe("left");
        expect(savedLeft.fingerprint).toMatch(/^[a-f0-9]{64}$/);

        installDesign(design);
        const canonicalRight = await buildPrinterFootManufacturingStl("right", true);
        installDesign(design);
        const savedRight = await buildFinalizedFootFromSavedDesign({
            design,
            side: "right",
            sampleTopBytes: sampleTop,
            includeLeader: true,
        });
        expect(sha256(savedRight.stl)).toBe(sha256(canonicalRight.stl));
        expect(printerFootStlFacts(savedRight.stl).side).toBe("right");
        expect(sha256(savedLeft.stl)).not.toBe(sha256(savedRight.stl));
        expect(savedLeft.fingerprint).not.toBe(savedRight.fingerprint);

        const corrected = createDesignWithStockPlaceholder({
            ...design,
            corrections: {
                ...design.corrections,
                left: { ...design.corrections.left, archHeightMm: design.corrections.left.archHeightMm + 2 },
            },
        });
        installDesign(corrected);
        const savedCorrected = await buildFinalizedFootFromSavedDesign({
            design: corrected,
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: true,
        });
        expect(savedCorrected.fingerprint).not.toBe(savedLeft.fingerprint);
        expect(sha256(savedCorrected.stl)).not.toBe(sha256(savedLeft.stl));
    }, 240_000);
});
