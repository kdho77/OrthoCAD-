// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Independent grader gates for PR #468 (72347f76). Not the worker's test suite.

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";
import {
    createSavedDesignInputSchema,
    persistSavedDesignSnapshotInputSchema,
} from "../../../../packages/mcp/src/tools/schemas.js";
import { settingsEnvelopeForSave } from "../../../server/src/lib/design-schema.js";
import { cadOperatorManufacturingIdentity } from "../../../server/src/lib/cad-operator-production.js";
import { applyRequestedOrderScans } from "../../../server/src/lib/saved-design-snapshot.js";
import { parseSavedDesignCatalog } from "../../../shared/saved-design-catalog.js";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot.js";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { archHeightScan } from "../../../../tests/helpers/arch-height-scan";
import { designFromImportedScanFiles } from "./design-from-order-scans";
import { generateOrthoticFromScanAndRx } from "./generateOrthoticFromScanAndRx";
import { importFootScanFile } from "@/lib/geometry/import-foot-scan";

const PR_HEAD = "72347f76bce9864c70ef25342ee8d3dc4b22b4c7";
const PR_BASE = "228c72f2771a74e5b7c1d515ab0d01e4dd44d751";
const REPO_ROOT = join(import.meta.dirname, "../../../..");

const PR_FILE_SCOPE = [
    "ci/unit-test-shards.json",
    "packages/mcp/README.md",
    "packages/mcp/package.json",
    "packages/mcp/src/clients/manufacturing-client.ts",
    "packages/mcp/src/tools/handlers.ts",
    "packages/mcp/src/tools/schemas.ts",
    "packages/mcp/test/dogfood-order-identity.test.ts",
    "vertex/server/src/lib/dogfood-saved-design.ts",
    "vertex/server/src/lib/order-scans.ts",
    "vertex/server/src/lib/saved-design-snapshot.test.ts",
    "vertex/server/src/lib/saved-design-snapshot.ts",
    "vertex/server/src/orthocad-mcp.bundled.mjs",
    "vertex/server/src/routers/manufacturing.ts",
    "vertex/src/features/scans/ScanImport.tsx",
    "vertex/src/lib/clinical/design-from-order-scans.test.ts",
    "vertex/src/lib/clinical/design-from-order-scans.ts",
    "vertex/src/lib/clinical/order-scan-file.ts",
    "vertex/src/lib/geometry/import-foot-scan.ts",
    "vertex/src/types/index.ts",
];

function stl(heightMm: number, side: "left" | "right"): File {
    return new File(
        [new Uint8Array(geometryToBinarySTL(archHeightScan(heightMm, side)))],
        `${side}.stl`,
    );
}

describe("grader PR #468 independent", () => {
    test("G-scope: graded commit diff is limited to the worker brief file list", () => {
        const names = execSync(`git diff --name-only ${PR_BASE} ${PR_HEAD}`, {
            cwd: REPO_ROOT,
            encoding: "utf8",
        })
            .trim()
            .split("\n")
            .filter(Boolean)
            .sort();
        expect(names).toEqual([...PR_FILE_SCOPE].sort());
    });

    test("MUST-MATCH: buildSavedDesignSnapshot leaves scansUsed false until the explicit scan option runs", () => {
        const catalog = parseSavedDesignCatalog({ shoe_size: { system: "US_M", size: 9 } });
        const built = buildSavedDesignSnapshot({ stored: null, catalog });
        expect(built.design.dogfoodManufacturing?.scansUsed).toBe(false);
        expect(built.design.dogfoodManufacturing?.template).toBe("SAMPLE_Top");
    });

    test("default template envelope hash (US_M 9) is unchanged on the graded commit", () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: "medium" };
        const catalog = parseSavedDesignCatalog({ shoe_size: { system: "US_M", size: 9 } });
        const encoded = JSON.stringify(
            settingsEnvelopeForSave(buildSavedDesignSnapshot({ stored, catalog }).design),
        );
        const digest = createHash("sha256").update(encoded).digest("hex");
        expect(digest).toBe("f5d8b161430ed5b2f36c3329ba35370feddebf7e8196675810ad57d7a6f9d61b");
        expect(encoded).toContain('"scansUsed":false');
    });

    test("useOrderScans is a strict opt-in: omitted and false never call the scan loader", async () => {
        const catalog = parseSavedDesignCatalog({ shoe_size: { system: "US_M", size: 9 } });
        const built = buildSavedDesignSnapshot({ stored: null, catalog });
        let loads = 0;
        const loadOrderScans = async () => {
            loads += 1;
            return [];
        };
        const base = {
            clientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            loadOrderScans,
            built,
            catalog,
        };
        expect(await applyRequestedOrderScans({ ...base, useOrderScans: undefined })).toEqual([]);
        expect(await applyRequestedOrderScans({ ...base, useOrderScans: false })).toEqual([]);
        expect(loads).toBe(0);
        await expect(applyRequestedOrderScans({ ...base, useOrderScans: true, clientId: null })).rejects.toThrow(
            /Refusing to substitute the template/,
        );
        expect(loads).toBe(0);
    });

    test("headless scan path shares importFootScanFile with ScanImport and matches Generate Orthotic", async () => {
        const scanImport = readFileSync(
            join(REPO_ROOT, "vertex/src/features/scans/ScanImport.tsx"),
            "utf8",
        );
        const moduleSource = readFileSync(join(import.meta.dirname, "design-from-order-scans.ts"), "utf8");
        expect(scanImport).toMatch(/importFootScanFile/);
        expect(moduleSource).toMatch(/importFootScanFile/);
        expect(moduleSource).toMatch(/generateOrthoticFromScanAndRx/);
        expect(moduleSource).not.toMatch(/archHeightMm\s*=\s*-?\d/);

        const built = buildSavedDesignSnapshot({
            stored: null,
            catalog: parseSavedDesignCatalog({ shoe_size: { system: "US_M", size: 9 } }),
        });
        const left = stl(25, "left");
        const right = stl(15, "right");
        const shoeSize = { system: "us" as const, value: built.usMenSize };
        const imported = await Promise.all([
            importFootScanFile(left, "left"),
            importFootScanFile(right, "right"),
        ]);
        const panel = generateOrthoticFromScanAndRx({
            baselineDesign: structuredClone(built.design),
            scans: imported.map((scan) => ({
                side: scan.side,
                geometry: scan.geometry,
                display: scan.display,
                keepSetApproved: scan.keepSetApproved,
            })),
            shoeSize,
        });
        const viaOrderPath = await designFromImportedScanFiles({
            baselineDesign: structuredClone(built.design),
            files: [
                { side: "left", file: left },
                { side: "right", file: right },
            ],
            shoeSize,
        });
        expect(panel.ok).toBe(true);
        expect(viaOrderPath.ok).toBe(true);
        if (!panel.ok || !viaOrderPath.ok) return;
        expect(viaOrderPath.design.corrections.left.archHeightMm).toBe(
            panel.design.corrections.left.archHeightMm,
        );
        expect(viaOrderPath.design.corrections.right.archHeightMm).toBe(
            panel.design.corrections.right.archHeightMm,
        );
    });

    test("MCP schemas document use_order_scans on create and persist tools", () => {
        expect(
            createSavedDesignInputSchema.safeParse({
                external_order_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                use_order_scans: true,
            }).success,
        ).toBe(true);
        expect(
            persistSavedDesignSnapshotInputSchema.safeParse({
                design_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                use_order_scans: false,
            }).success,
        ).toBe(true);
        expect(
            createSavedDesignInputSchema.safeParse({
                external_order_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                scan_geometry: true,
            }).success,
        ).toBe(false);
    });

    test("settingsJson in the manufacturing fingerprint changes when scan metadata changes", () => {
        const settingsJson = settingsEnvelopeForSave(
            buildSavedDesignSnapshot({
                stored: null,
                catalog: parseSavedDesignCatalog({ shoe_size: { system: "US_M", size: 9 } }),
            }).design,
        );
        const withScansFlag = structuredClone(settingsJson) as Record<string, unknown>;
        const dogfood = (withScansFlag.dogfoodManufacturing ?? {}) as Record<string, unknown>;
        dogfood.scansUsed = true;
        withScansFlag.dogfoodManufacturing = dogfood;
        const common = {
            designId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            side: "left" as const,
            presetId: "medium",
            useSavedDesignMesh: true,
            material: "TPU95A",
            beltAngleDeg: 30,
            layerHeightMm: 0.2,
            printRecipe: (settingsJson as { printRecipe?: unknown }).printRecipe,
            stlStorageKey: null,
        };
        const baseline = cadOperatorManufacturingIdentity({ ...common, settingsJson });
        const optedIn = cadOperatorManufacturingIdentity({ ...common, settingsJson: withScansFlag });
        expect(optedIn.fingerprint).not.toBe(baseline.fingerprint);
    });
});