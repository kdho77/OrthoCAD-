// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    createDefaultStockPairedBases,
    getDefaultStockBaseSync,
    getDesignBase,
    getOfflineFallbackStockBase,
    sanitizeDesignStockBases,
    sanitizeStockBaseForServerMode,
    stockBaseNeedsServerResolution,
} from "@/lib/geometry/base-asset";
import { isApiConfigured } from "@/lib/trpc";
import type { DesignBase, DesignState } from "@/types";

function stockSource(primarySide: "left" | "right"): DesignBase {
    return {
        assetId: "stock-1",
        name: "Default Stock Base",
        source: "stock",
        glbPath: "Templates/Default.glb",
        primarySide,
    };
}

function pairedDesign(leftBase: DesignBase, rightBase: DesignBase): DesignState {
    return {
        pattern: "custom",
        method: "printing_solid",
        thicknessMm: 3,
        corrections: {
            unit: "mm",
            linked: false,
            left: {},
            right: {},
        },
        elements: [],
        paired: {
            leftBase,
            rightBase,
            leftThicknessMm: 3,
            rightThicknessMm: 3,
            leftMethod: "printing_solid",
            rightMethod: "printing_solid",
            linked: false,
        },
    };
}

describe("createDefaultStockPairedBases", () => {
    test("builtin sync default is primarySide left (Default.glb arch is on width−)", () => {
        expect(getDefaultStockBaseSync().primarySide).toBe("left");
        const { left, right } = createDefaultStockPairedBases();
        expect(left.mirrored).toBeFalsy();
        expect(right.mirrored).toBe(true);
        expect(left.name).toMatch(/\(Left\)/i);
        expect(right.name).toMatch(/\(Right\)/i);
    });

    test("API mode sync default is a non-loadable pending stub (no glbPath/url)", () => {
        // When Supabase/API is configured the stub must not carry a fetchable URL,
        // so the viewer shows loading until applyDefaultStockBase resolves.
        if (!isApiConfigured()) {
            const offline = getOfflineFallbackStockBase();
            expect(offline.glbPath).toBeTruthy();
            expect(offline.resolutionFallback).toBe(true);
            return;
        }
        const stub = getDefaultStockBaseSync();
        expect(stub.glbPath).toBeUndefined();
        expect(stub.url).toBeUndefined();
        expect(stockBaseNeedsServerResolution(stub)).toBe(true);
        const { left, right } = createDefaultStockPairedBases();
        expect(left.url).toBeUndefined();
        expect(right.url).toBeUndefined();
        expect(stockBaseNeedsServerResolution(left)).toBe(true);
    });

    test("sanitize strips persisted placeholder URLs so Default.glb is not loaded early", () => {
        if (!isApiConfigured()) return;
        const persisted: DesignBase = {
            assetId: "stock-default",
            name: "Default Stock Base (Left)",
            source: "stock",
            glbPath: "Templates/Default.glb",
            url: "https://example.supabase.co/storage/v1/object/public/stock-bases/Templates/Default.glb",
            primarySide: "left",
        };
        const sanitized = sanitizeStockBaseForServerMode(persisted);
        expect(sanitized.glbPath).toBeUndefined();
        expect(sanitized.url).toBeUndefined();
        expect(stockBaseNeedsServerResolution(sanitized)).toBe(true);
    });

    test("primarySide right on Default.glb is normalized to left-primary pairing", () => {
        const { left, right } = createDefaultStockPairedBases(stockSource("right"));
        // Builtin Default path is normalized to left regardless of the stale "right" label.
        expect(left.mirrored).toBeFalsy();
        expect(right.mirrored).toBe(true);
        expect(left.primarySide).toBe("left");
        expect(left.name).toMatch(/\(Left\)/i);
        expect(right.name).toMatch(/\(Right\)/i);
    });

    test("non-default stock with primarySide right keeps right as source", () => {
        const custom: DesignBase = {
            assetId: "custom-stock-uuid",
            name: "Custom Right Stock",
            source: "stock",
            glbPath: "stock/custom/RightOnly.glb",
            primarySide: "right",
        };
        const { left, right } = createDefaultStockPairedBases(custom);
        expect(left.mirrored).toBe(true);
        expect(right.mirrored).toBeFalsy();
        expect(left.name).toMatch(/\(Left\)/i);
        expect(right.name).toMatch(/\(Right\)/i);
    });

    test("primarySide left: left is source with Left label, right is mirrored with Right label", () => {
        const { left, right } = createDefaultStockPairedBases(stockSource("left"));
        expect(left.mirrored).toBeFalsy();
        expect(right.mirrored).toBe(true);
        expect(left.name).toMatch(/\(Left\)/i);
        expect(right.name).toMatch(/\(Right\)/i);
    });
});

describe("getDesignBase paired routing", () => {
    test("maps left/right keys to matching paired bases", () => {
        const { left, right } = createDefaultStockPairedBases(stockSource("left"));
        const design = pairedDesign(left, right);
        expect(getDesignBase(design, "left")?.name).toMatch(/\(Left\)/i);
        expect(getDesignBase(design, "right")?.name).toMatch(/\(Right\)/i);
        expect(getDesignBase(design, "left")?.mirrored).toBeFalsy();
        expect(getDesignBase(design, "right")?.mirrored).toBe(true);
    });
});

describe("sanitizeDesignStockBases", () => {
    test("heals inverted Left/Right suffixes on legacy primarySide=left pairs", () => {
        const legacyLeft: DesignBase = {
            assetId: "stock-1",
            name: "Default Stock Base (Right)",
            source: "stock",
            glbPath: "Templates/Default.glb",
            primarySide: "left",
        };
        const legacyRight: DesignBase = {
            assetId: "stock-1",
            name: "Default Stock Base (Left)",
            source: "stock",
            glbPath: "Templates/Default.glb",
            mirrored: true,
            primarySide: "left",
        };
        const design = pairedDesign(legacyLeft, legacyRight);
        const healed = sanitizeDesignStockBases(design);
        expect(healed.paired?.leftBase?.name).toMatch(/\(Left\)/i);
        expect(healed.paired?.rightBase?.name).toMatch(/\(Right\)/i);
    });

    test("heals contralateral default pairing when left was mirrored (legacy primarySide=right)", () => {
        const legacyLeft: DesignBase = {
            assetId: "default-stock",
            name: "Default Stock Base (Left)",
            source: "stock",
            glbPath: "Templates/Default.glb",
            mirrored: true,
            mirroredFrom: "default-stock",
            primarySide: "right",
        };
        const legacyRight: DesignBase = {
            assetId: "default-stock",
            name: "Default Stock Base (Right)",
            source: "stock",
            glbPath: "Templates/Default.glb",
            primarySide: "right",
        };
        const design = pairedDesign(legacyLeft, legacyRight);
        const healed = sanitizeDesignStockBases(design);
        expect(healed.paired?.leftBase?.mirrored).toBeFalsy();
        expect(healed.paired?.rightBase?.mirrored).toBe(true);
        expect(healed.paired?.leftBase?.primarySide).toBe("left");
        expect(healed.paired?.rightBase?.primarySide).toBe("left");
        expect(healed.paired?.leftBase?.name).toMatch(/\(Left\)/i);
        expect(healed.paired?.rightBase?.name).toMatch(/\(Right\)/i);
    });
});
