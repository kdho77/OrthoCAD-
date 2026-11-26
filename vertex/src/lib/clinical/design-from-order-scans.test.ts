// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { describe, expect, test } from "@rstest/core";
import { importFootScanFile } from "@/lib/geometry/import-foot-scan";
import { SAMPLE_TOP_ASSET_ID, SAMPLE_TOP_GLB_PATH } from "@/lib/geometry/procedural-wall/sample-top-id";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { archHeightScan } from "../../../../tests/helpers/arch-height-scan";
import { settingsEnvelopeForSave } from "../../../server/src/lib/design-schema.js";
import { parseSavedDesignCatalog } from "../../../shared/saved-design-catalog.js";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot.js";
import { applyOrderScansToSavedDesign, designFromImportedScanFiles } from "./design-from-order-scans";
import { generateOrthoticFromScanAndRx } from "./generateOrthoticFromScanAndRx";
import { type OrderScanFile, selectLatestScanPerSide } from "./order-scan-file";

function stlFile(heightMm: number, side: "left" | "right", name: string): File {
    const bytes = new Uint8Array(geometryToBinarySTL(archHeightScan(heightMm, side)));
    return new File([bytes], name);
}

function orderFile(heightMm: number, side: "left" | "right", id: string, uploadedAt: string): OrderScanFile {
    const file = stlFile(heightMm, side, `${side}.stl`);
    return {
        id,
        side,
        fileName: file.name,
        uploadedAt,
        bytes: new Uint8Array(geometryToBinarySTL(archHeightScan(heightMm, side))),
    };
}

const CATALOG = parseSavedDesignCatalog({
    shoe_size: { system: "US_M", size: 9 },
    sliders: { medial_skive_mm: 4 },
});

describe("order-scan design option", () => {
    test("the newest file on a side wins, then the greater id", () => {
        const older = orderFile(10, "left", "a", "2026-01-01T00:00:00.000Z");
        const newer = orderFile(30, "left", "b", "2026-06-01T00:00:00.000Z");
        const right = orderFile(20, "right", "c", "2026-01-01T00:00:00.000Z");
        expect(selectLatestScanPerSide([older, right, newer]).map((file) => file.id)).toEqual(["b", "c"]);
        const tieLow = orderFile(10, "left", "m", "2026-06-01T00:00:00.000Z");
        const tieHigh = orderFile(30, "left", "z", "2026-06-01T00:00:00.000Z");
        expect(selectLatestScanPerSide([tieLow, tieHigh])[0]?.id).toBe("z");
    });

    test("imported scans take the same arch slider Generate Orthotic writes", async () => {
        const left = stlFile(30, "left", "left.stl");
        const right = stlFile(20, "right", "right.stl");
        const built = buildSavedDesignSnapshot({ stored: null, catalog: CATALOG });
        const importedLeft = await importFootScanFile(left, "left");
        const importedRight = await importFootScanFile(right, "right");
        const shoeSize = { system: "us" as const, value: built.usMenSize };
        const panel = generateOrthoticFromScanAndRx({
            baselineDesign: built.design,
            scans: [importedLeft, importedRight].map((scan) => ({
                side: scan.side,
                geometry: scan.geometry,
                display: scan.display,
                keepSetApproved: scan.keepSetApproved,
            })),
            shoeSize,
            flexibleBySide: { left: false, right: false },
        });
        const throughFiles = await designFromImportedScanFiles({
            baselineDesign: built.design,
            files: [
                { side: "left", file: left },
                { side: "right", file: right },
            ],
            shoeSize,
            flexibleBySide: { left: false, right: false },
        });
        expect(panel.ok).toBe(true);
        expect(throughFiles.ok).toBe(true);
        if (!panel.ok || !throughFiles.ok) return;
        expect(throughFiles.design.corrections.left.archHeightMm).toBe(
            panel.design.corrections.left.archHeightMm,
        );
        expect(throughFiles.design.corrections.right.archHeightMm).toBe(
            panel.design.corrections.right.archHeightMm,
        );
        expect(panel.design.corrections.left.archHeightMm).toBe(3);
        expect(panel.design.corrections.right.archHeightMm).toBe(-3.5);
        expect(panel.design.base?.assetId).toBe(SAMPLE_TOP_ASSET_ID);
        expect(panel.design.base?.glbPath).toBe(SAMPLE_TOP_GLB_PATH);

        const before = JSON.stringify(settingsEnvelopeForSave(built.design));
        await applyOrderScansToSavedDesign({
            built,
            catalog: CATALOG,
            files: [
                orderFile(30, "left", "left-new", "2026-06-01T00:00:00.000Z"),
                orderFile(10, "left", "left-old", "2026-01-01T00:00:00.000Z"),
                orderFile(20, "right", "right", "2026-06-01T00:00:00.000Z"),
            ],
        });
        expect(built.design.corrections.left.archHeightMm).toBe(panel.design.corrections.left.archHeightMm);
        expect(built.design.corrections.right.archHeightMm).toBe(panel.design.corrections.right.archHeightMm);
        expect(built.design.corrections.left.medialSkiveMm).toBe(4);
        expect(built.design.corrections.right.medialSkiveMm).toBe(4);
        expect(built.design.corrections.left.apexMoveMm).toBe(0);
        expect(built.design.corrections.linked).toBe(false);
        expect(built.design.dogfoodManufacturing?.scansUsed).toBe(true);
        expect(built.design.dogfoodManufacturing?.template).toBe("SAMPLE_Top");
        expect(built.design.base?.assetId).toBe(SAMPLE_TOP_ASSET_ID);
        expect(built.design.paired?.rightBase?.mirrored).toBe(true);
        expect(JSON.stringify(settingsEnvelopeForSave(built.design))).not.toBe(before);
    });

    test("an explicit catalog arch replaces the scan class and an empty scan list does not write", async () => {
        const catalog = parseSavedDesignCatalog({
            shoe_size: { system: "US_M", size: 9 },
            arch: "high",
            flexible_foot: true,
        });
        const built = buildSavedDesignSnapshot({ stored: null, catalog });
        const review = await applyOrderScansToSavedDesign({
            built,
            catalog,
            files: [orderFile(20, "left", "left", "2026-06-01T00:00:00.000Z")],
        });
        expect(built.design.corrections.left.archHeightMm).toBe(3);
        expect(built.design.corrections.right.archHeightMm).toBe(3);
        expect(built.design.corrections.left.apexMoveMm).toBe(4);
        expect(built.design.dogfoodManufacturing?.scansUsed).toBe(true);
        expect(review.some((line) => line.includes("catalog arch overrides"))).toBe(true);

        const untouched = buildSavedDesignSnapshot({ stored: null, catalog: CATALOG });
        await expect(
            applyOrderScansToSavedDesign({ built: untouched, catalog: CATALOG, files: [] }),
        ).rejects.toThrow(/no foot scans/);
        expect(untouched.design.dogfoodManufacturing?.scansUsed).toBe(false);
        expect(untouched.design.corrections.left.archHeightMm).toBe(0);
        expect(untouched.design.corrections.left.medialSkiveMm).toBe(4);
    });

    test("the template snapshot stays byte-identical when scans are not requested", () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: "medium" };
        const catalog = parseSavedDesignCatalog({ shoe_size: { system: "US_M", size: 9 } });
        const first = settingsEnvelopeForSave(buildSavedDesignSnapshot({ stored, catalog }).design);
        const second = settingsEnvelopeForSave(buildSavedDesignSnapshot({ stored, catalog }).design);
        const encoded = JSON.stringify(first);
        expect(encoded).toBe(JSON.stringify(second));
        expect(encoded).toContain('"scansUsed":false');
        expect(encoded).not.toContain('"scansUsed":true');
        const digest = createHash("sha256").update(encoded).digest("hex");
        expect(digest).toBe("f5d8b161430ed5b2f36c3329ba35370feddebf7e8196675810ad57d7a6f9d61b");
    });
});
