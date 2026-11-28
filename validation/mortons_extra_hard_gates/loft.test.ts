import { describe, expect, test } from "@rstest/core";
import type { PlacedElement } from "@/types";
import {
    elementOn,
    loadSavedDesign,
    loftLeft,
    readBaseline,
    regionalPack,
    standInShell,
    textMarkingFacts,
    writeBaseline,
} from "./harness";
import { BASE_SHA } from "./thresholds";

function withHardness(el: PlacedElement, hardnessClass: PlacedElement["hardnessClass"]): PlacedElement {
    return {
        ...el,
        regionId: el.id,
        hardnessClass,
        priority: 1,
        depth: { type: "element", depthBelowMm: 2 },
    };
}

async function measureBaseline() {
    const stock = loadSavedDesign({});
    const met = loadSavedDesign({ elements: [{ name: "met_pad", side: "left" }] });
    const mortons = loadSavedDesign({ elements: [{ name: "mortons_extension", side: "left" }] });
    const explicitOff = loadSavedDesign({ elements: [{ name: "mortons_extension", side: "left" }] });
    const offEl = elementOn(explicitOff, "mortons_extension", "left");
    explicitOff.elements = [withHardness(offEl, "Hard")];
    const explicitOn = loadSavedDesign({ elements: [{ name: "mortons_extension", side: "left" }] });
    const onEl = elementOn(explicitOn, "mortons_extension", "left");
    explicitOn.splitElements = true;
    explicitOn.elements = [withHardness(onEl, "Hard")];
    const metSoft = loadSavedDesign({ elements: [{ name: "met_pad", side: "left" }] });
    const metEl = elementOn(metSoft, "met_pad", "left");
    metSoft.splitElements = true;
    metSoft.elements = [withHardness(metEl, "Soft")];

    const stockLoft = await loftLeft(stock);
    const metLoft = await loftLeft(met);
    const mortonsLoft = await loftLeft(mortons);
    const explicitOffPack = await regionalPack(explicitOff, "left", standInShell());
    const explicitOnPack = await regionalPack(explicitOn, "left", standInShell());
    const metSoftPack = await regionalPack(metSoft, "left", standInShell());
    return {
        baseSha: BASE_SHA,
        stockLeftStlSha256: stockLoft.sha256,
        metUnsetLeftStlSha256: metLoft.sha256,
        mortonsUnsetLeftStlSha256: mortonsLoft.sha256,
        explicitSplitOffModelSha256: explicitOffPack.modelSha256,
        explicitSplitOnThrew: explicitOnPack.threw,
        explicitSplitOnError: explicitOnPack.error,
        explicitSplitOnModelSha256: explicitOnPack.modelSha256,
        metSoftModelSha256: metSoftPack.modelSha256,
        textMarkingSha256: textMarkingFacts(stock).sha256,
    };
}

if (process.env.MORTONS_GATES_WRITE_BASELINE === "1") {
    test("WRITE-BASELINE freeze slice-request hashes from this checkout", async () => {
        const measured = await measureBaseline();
        writeBaseline(measured);
        expect(measured.stockLeftStlSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(measured.baseSha).toBe(BASE_SHA);
    }, 600_000);
}

describe("manufacturing STL byte identity", () => {
    test("pass-on-base MM-LOFT stock, met pad, and unset Morton's STL hashes", async () => {
        const baseline = readBaseline();
        expect(baseline.baseSha).toBe(BASE_SHA);
        const stock = await loftLeft(loadSavedDesign({}));
        const met = await loftLeft(loadSavedDesign({ elements: [{ name: "met_pad", side: "left" }] }));
        const mortons = await loftLeft(
            loadSavedDesign({ elements: [{ name: "mortons_extension", side: "left" }] }),
        );
        expect(stock.sha256, `stock STL measured ${stock.sha256}`).toBe(baseline.stockLeftStlSha256);
        expect(met.sha256, `met STL measured ${met.sha256}`).toBe(baseline.metUnsetLeftStlSha256);
        expect(mortons.sha256, `mortons STL measured ${mortons.sha256}`).toBe(
            baseline.mortonsUnsetLeftStlSha256,
        );
        expect(stock.sha256).not.toBe(met.sha256);
        expect(stock.sha256).not.toBe(mortons.sha256);
    }, 600_000);

    test("pass-on-base MM-MET-SOFT 3MF matches the frozen base modifier pack", async () => {
        const baseline = readBaseline();
        const design = loadSavedDesign({ elements: [{ name: "met_pad", side: "left" }] });
        const el = elementOn(design, "met_pad", "left");
        design.splitElements = true;
        design.elements = [withHardness(el, "Soft")];
        const pack = await regionalPack(design, "left", standInShell());
        expect(pack.threw, pack.error).toBe(false);
        expect(pack.modelSha256, `met Soft 3MF measured ${pack.modelSha256}`).toBe(
            baseline.metSoftModelSha256,
        );
    });
});
