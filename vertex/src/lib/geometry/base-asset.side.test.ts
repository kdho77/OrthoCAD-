// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { createDefaultStockPairedBases, getDesignBase, sanitizeDesignStockBases } from "@/lib/geometry/base-asset";
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
    test("primarySide right: left is mirrored with Left label, right is source with Right label", () => {
        const { left, right } = createDefaultStockPairedBases(stockSource("right"));
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
        const { left, right } = createDefaultStockPairedBases(stockSource("right"));
        const design = pairedDesign(left, right);
        expect(getDesignBase(design, "left")?.name).toMatch(/\(Left\)/i);
        expect(getDesignBase(design, "right")?.name).toMatch(/\(Right\)/i);
        expect(getDesignBase(design, "left")?.mirrored).toBe(true);
        expect(getDesignBase(design, "right")?.mirrored).toBeFalsy();
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
});
