import { describe, expect, test } from "@rstest/core";

import { readStoredDesignSettings } from "../../../shared/design-settings";
import {
    parseSavedDesignCatalog,
    SavedDesignSnapshotError,
    type StoredLinkShoe,
} from "../../../shared/saved-design-catalog";
import { designStateFromSavedSettings } from "../../features/exports/saved-design-finalized-mesh";
import { defaultElementPose, ELEMENT_PROFILES } from "../geometry/elements";
import { SAMPLE_TOP_ASSET_ID, SAMPLE_TOP_GLB_PATH } from "../geometry/procedural-wall/sample-top-id";
import { buildSavedDesignSnapshot } from "./saved-design-snapshot";

const storedNine: StoredLinkShoe = {
    system: "US_M",
    size: 9,
    left: null,
    right: null,
    width: null,
};

function build(catalog: unknown, stored = storedNine) {
    return buildSavedDesignSnapshot({
        stored,
        catalog: parseSavedDesignCatalog(catalog),
    });
}

function expect422(fn: () => void) {
    try {
        fn();
        throw new Error("expected 422");
    } catch (error) {
        expect(error).toBeInstanceOf(SavedDesignSnapshotError);
        expect((error as SavedDesignSnapshotError).status).toBe(422);
        expect((error as Error).message).toMatch(/^422 /);
        return error as SavedDesignSnapshotError;
    }
}

describe("SAMPLE_Top saved-design snapshot", () => {
    test("a null catalog becomes a loftable snapshot and omitted fields stay unset", () => {
        const built = build({});
        const envelope = { schemaVersion: 1, settings: built.design };
        const settings = readStoredDesignSettings(envelope);
        expect(settings?.usMenSize).toBe(9);
        expect(settings?.sizeSystem).toBe("us");
        expect(settings?.shoeWidth).toBe("medium");
        expect(built.shoeWidthSource).toBe("defaulted");
        expect(built.hardnessSource).toBe("unspecified");
        expect(built.design.dogfoodManufacturing).toMatchObject({
            template: "SAMPLE_Top",
            scansUsed: false,
            shoeWidth: "medium",
            shoeWidthSource: "defaulted",
            hardness: null,
            hardnessSource: "unspecified",
        });
        expect(built.design.elements).toEqual([]);
        expect(built.design.corrections.left.archHeightMm).toBe(0);
        expect(built.design.corrections.right.archHeightMm).toBe(0);
        expect(built.design.corrections.left.apexMoveMm).toBe(0);
        expect(built.design.corrections.left.heelLiftMm).toBe(0);
        expect(built.design.corrections.left.rearfootWedge).toBeUndefined();
        expect(built.paths.some((path) => path.includes("archHeightMm") || path.includes("apexMoveMm"))).toBe(
            false,
        );
        expect(built.design.base?.assetId).toBe(SAMPLE_TOP_ASSET_ID);
        expect(built.design.base?.glbPath).toBe(SAMPLE_TOP_GLB_PATH);
        expect(built.design.paired?.rightBase?.mirrored).toBe(true);
        const lofted = designStateFromSavedSettings(envelope);
        expect(lofted.usMenSize).toBe(9);
        expect(lofted.elements).toEqual([]);
        expect(lofted.base?.glbPath).toBe(SAMPLE_TOP_GLB_PATH);
    });

    test("stored link size and width are copied", () => {
        const mens = build({}, { ...storedNine, size: 10.5, width: "wide" });
        expect(mens.usMenSize).toBe(10.5);
        expect(mens.design.shoeWidth).toBe("wide");
        expect(mens.shoeWidthSource).toBe("prescribed");
        const womens = build({}, { ...storedNine, system: "US_W", size: 8, width: "narrow" });
        expect(womens.usMenSize).toBe(6.5);
        expect(womens.design.shoeWidth).toBe("narrow");
    });

    test("rx text and rigidity do not create clinical corrections", () => {
        const built = build({
            rx_text: "Morton's extension, flexible foot, arch high",
            notes: "Extra Soft shell with Morton's",
            rigidity: "Extra Soft",
            extra_soft: true,
            hardness: "Extra Soft",
        });
        expect(built.design.elements).toEqual([]);
        expect(built.design.corrections.left.apexMoveMm).toBe(0);
        expect(built.design.corrections.left.archHeightMm).toBe(0);
        expect(built.design.printRecipe?.defaultHardness).toBe("Extra Soft");
        expect(built.hardnessSource).toBe("prescribed");
        expect(built.ignoredFields).toEqual(["rx_text", "notes", "rigidity", "extra_soft"]);
        expect(JSON.stringify(built.design)).not.toMatch(/Morton|Extra Soft shell/i);
    });

    test("arch maps only from a structured Low/Medium/High value", () => {
        expect(build({ arch: "Low" }).design.corrections.left.archHeightMm).toBe(-3.5);
        expect(build({ arch: "Medium" }).design.corrections.right.archHeightMm).toBe(0);
        expect(build({ arch: "Standard" }).design.corrections.left.archHeightMm).toBe(0);
        expect(build({ arch: "High" }).design.corrections.right.archHeightMm).toBe(3);
    });

    test("flexible apex is +4 mm only when flexible_foot is true", () => {
        const marked = build({ flexible_foot: true, rigidity: "Extra Soft" });
        expect(marked.design.corrections.left.apexMoveMm).toBe(4);
        expect(marked.design.corrections.right.apexMoveMm).toBe(4);
        expect(build({ flexible_foot: false, extra_soft: true }).design.corrections.left.apexMoveMm).toBe(0);
    });

    test("named elements use the built-in magnitude unless a number is supplied", () => {
        const named = build({
            elements: [{ name: "Morton's Ext.", side: "left" }],
        });
        expect(named.design.elements).toHaveLength(1);
        const element = named.design.elements[0];
        expect(element?.kind).toBe("mortons_extension");
        expect(element?.side).toBe("left");
        expect(element?.heightMm).toBe(ELEMENT_PROFILES.mortons_extension.defaultHeightMm);
        expect(element?.position).toEqual(defaultElementPose("mortons_extension", "left", 260, 95).position);
        const numbered = build({
            elements: [{ name: "mortons_extension", side: "right", height_mm: 3.5 }],
        });
        expect(numbered.design.elements[0]?.heightMm).toBe(3.5);
        expect(numbered.design.elements[0]?.side).toBe("right");
        expect(build({ sliders: { heel_lift_mm: 6 } }).design.corrections.left.heelLiftMm).toBe(6);
        expect(build({ sliders: { heel_lift_mm: 6 } }).paths).toContain(
            "settings.corrections.left.heelLiftMm",
        );
    });

    test("missing shoe size, EU, split sizes, and conflicts fail closed", () => {
        expect(expect422(() => build({}, { ...storedNine, size: null })).message).toMatch(
            /shoe size is required/,
        );
        expect(expect422(() => build({}, { ...storedNine, system: "EU" })).message).toMatch(/EU/);
        expect(expect422(() => build({}, { ...storedNine, left: 9, right: 10 })).message).toMatch(
            /left and right shoe sizes differ/,
        );
        expect(
            expect422(() => build({ shoe_size: { system: "US_M", size: 10 } }, storedNine)).message,
        ).toMatch(/disagrees/);
        expect(expect422(() => build({ width: "wide" }, { ...storedNine, width: "medium" })).message).toMatch(
            /width disagrees/,
        );
        expect(
            expect422(() => build({ elements: [{ name: "not a real pad", side: "left" }] })).message,
        ).toMatch(/unrecognized element/);
        expect(expect422(() => parseSavedDesignCatalog({ invented_mm: 4 })).message).toMatch(
            /invalid catalog field/,
        );
    });
});
