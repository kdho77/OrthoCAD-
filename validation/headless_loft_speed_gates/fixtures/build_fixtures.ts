// Build synthetic settings envelopes from the baseline stock design.
// Run from vertex/: npx tsx --tsconfig tsconfig.json ../validation/headless_loft_speed_gates/fixtures/build_fixtures.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultElementPose } from "@/lib/geometry/elements";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState, PlacedElement } from "@/types";
import { defaultBottomTextMarking } from "../../../vertex/shared/bottom-text-marking.ts";
import { designSettingsEnvelope } from "../../../vertex/shared/design-settings.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function stock(): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.usMenSize = 9;
    design.shoeWidth = "medium";
    design.shoeWidthBySide = { left: "medium", right: "medium" };
    design.elements = [];
    design.textMarking = {
        ...defaultBottomTextMarking(),
        text: "",
        addPatientName: false,
    };
    return design;
}

function envelope(design: DesignState) {
    const plain = JSON.parse(JSON.stringify(design)) as Record<string, unknown>;
    return designSettingsEnvelope(plain);
}

function assertStock(design: DesignState): void {
    if (design.usMenSize !== 9) throw new Error(`stock size ${design.usMenSize}`);
    if (design.shoeWidth !== "medium") throw new Error(`stock width ${design.shoeWidth}`);
    if (design.elements.length !== 0) throw new Error("stock has elements");
    if (design.corrections.left.heelCupDepthMm !== 0 || design.corrections.left.heelCupHeightMm !== 0) {
        throw new Error("stock heel cup is not zero");
    }
}

function narrowHeelCup(): DesignState {
    const design = stock();
    design.shoeWidth = "narrow";
    design.shoeWidthBySide = { left: "narrow", right: "narrow" };
    const patch = { heelCupDepthMm: 12, heelCupHeightMm: 9 };
    design.corrections = {
        ...design.corrections,
        linked: true,
        left: { ...design.corrections.left, ...patch },
        right: { ...design.corrections.right, ...patch },
    };
    if (design.corrections.left.heelCupDepthMm !== 12 || design.corrections.left.heelCupHeightMm !== 9) {
        throw new Error("narrow heel cup fields were not stored");
    }
    return design;
}

function mortons(): DesignState {
    const design = stock();
    const layout = insoleLayoutFromDesign(design);
    const pose = defaultElementPose("mortons_extension", "left", layout.lengthMm, layout.widthMm);
    if (pose.heightMm !== 3) throw new Error(`Morton's height ${pose.heightMm}`);
    if (!(pose.position.y < 0)) throw new Error(`left Morton's Y ${pose.position.y} is not medial`);
    const el: PlacedElement = {
        id: "fixture-mortons-extension",
        kind: "mortons_extension",
        side: "left",
        position: pose.position,
        rotationDeg: pose.rotationDeg,
        scale: pose.scale,
        heightMm: pose.heightMm,
        ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
    };
    design.elements = [el];
    return design;
}

function bottomName(): DesignState {
    const design = stock();
    design.textMarking = {
        ...defaultBottomTextMarking(),
        text: "FIXTURE",
        addPatientName: false,
        surface: "bottom",
        mode: "engrave",
    };
    return design;
}

const files: Record<string, DesignState> = {
    stock: stock(),
    narrow_heelcup: narrowHeelCup(),
    mortons_extension: mortons(),
    bottom_name: bottomName(),
};
assertStock(files.stock);

mkdirSync(HERE, { recursive: true });
for (const [name, design] of Object.entries(files)) {
    writeFileSync(join(HERE, `${name}.json`), JSON.stringify(envelope(design)));
}

const manifest = {
    design_id_note: "fixtures carry no patient name; bottom text is the literal FIXTURE",
    cases: [
        { id: "stock_left", side: "left", settings: "stock.json" },
        { id: "stock_right", side: "right", settings: "stock.json" },
        { id: "narrow_heelcup_left", side: "left", settings: "narrow_heelcup.json" },
        { id: "mortons_extension_left", side: "left", settings: "mortons_extension.json" },
        { id: "bottom_name_left", side: "left", settings: "bottom_name.json" },
    ],
};
writeFileSync(join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
