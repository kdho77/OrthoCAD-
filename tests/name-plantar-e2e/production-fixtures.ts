// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Production-path fixtures. Design ids are the only identifiers.
// The engraved string is the synthetic JABBOUR, never a patient name.

import type { DesignState, Side } from "@/types";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import { defaultBottomTextMarking } from "../../vertex/shared/bottom-text-marking";
import { designSettingsEnvelope } from "../../vertex/shared/design-settings";
import {
    envelopeWithLoftTextMarking,
    resolveProductionTextMarking,
} from "../../vertex/server/src/lib/integration-text-marking";
import { migratePrintRecipe, type HardnessName } from "../../vertex/shared/print-recipe/print-recipe";
import { SYNTHETIC_NAME } from "./thresholds";

export type GenerateMode = "pair" | "single";

export interface ProductionPathSpec {
    /** Stable cell id. Canonical rows use the design id. */
    id: string;
    /** US men's size. */
    size: number;
    hardness: HardnessName;
    linked: boolean;
    leftHeelMm: number;
    rightHeelMm: number;
    generate: GenerateMode;
    /**
     * #442 control writes the synthetic name into textMarking.text.
     * Production rows keep saved text empty and compose addPatientName.
     */
    composePatientName: boolean;
}

/** #442 SAMPLE_Top cell: default size, explicit synthetic text, belt STL. */
export const CONTROL_442: ProductionPathSpec = {
    id: "control-442",
    size: 9,
    hardness: "Medium",
    linked: true,
    leftHeelMm: 0,
    rightHeelMm: 0,
    generate: "single",
    composePatientName: false,
};

/** Design ad1e0cc5 production path. */
export const PATH_AD1E0CC5: ProductionPathSpec = {
    id: "ad1e0cc5",
    size: 12,
    hardness: "Hard",
    linked: true,
    leftHeelMm: 0,
    rightHeelMm: 0,
    generate: "single",
    composePatientName: true,
};

/** Design 0d3db1c0 production path. */
export const PATH_0D3DB1C0: ProductionPathSpec = {
    id: "0d3db1c0",
    size: 11.5,
    hardness: "Medium",
    linked: false,
    leftHeelMm: 0,
    rightHeelMm: 12,
    generate: "pair",
    composePatientName: true,
};

/**
 * One-factor variants so a fix cannot pass only the full combination.
 * Each axis in the incident delta appears on its own row.
 */
export const AXIS_VARIANTS: ProductionPathSpec[] = [
    { ...PATH_0D3DB1C0, id: "0d3db1c0-hard", hardness: "Hard" },
    { ...PATH_0D3DB1C0, id: "0d3db1c0-linked", linked: true },
    { ...PATH_0D3DB1C0, id: "0d3db1c0-heel0", leftHeelMm: 0, rightHeelMm: 0 },
    { ...PATH_0D3DB1C0, id: "0d3db1c0-size12", size: 12 },
    { ...PATH_AD1E0CC5, id: "ad1e0cc5-medium", hardness: "Medium" },
    { ...PATH_AD1E0CC5, id: "ad1e0cc5-unlinked", linked: false },
    { ...PATH_AD1E0CC5, id: "ad1e0cc5-heel12", linked: false, rightHeelMm: 12 },
    { ...PATH_AD1E0CC5, id: "ad1e0cc5-size11.5", size: 11.5 },
    { ...PATH_AD1E0CC5, id: "ad1e0cc5-pair", generate: "pair" },
];

export const PRODUCTION_PATHS: ProductionPathSpec[] = [CONTROL_442, PATH_AD1E0CC5, PATH_0D3DB1C0, ...AXIS_VARIANTS];

export function designForPath(spec: ProductionPathSpec): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.productType = "insole";
    design.elements = [];
    design.sizeSystem = "us";
    design.usMenSize = spec.size;
    design.corrections = {
        ...design.corrections,
        linked: spec.linked,
        left: { ...design.corrections.left, heelLiftMm: spec.leftHeelMm },
        right: { ...design.corrections.right, heelLiftMm: spec.rightHeelMm },
    };
    const recipe = migratePrintRecipe(design.printRecipe);
    design.printRecipe = { ...recipe, defaultHardness: spec.hardness, zones: [] };
    design.textMarking = spec.composePatientName
        ? { ...defaultBottomTextMarking(), addPatientName: true, text: "", surface: "bottom", mode: "engrave", feet: "both" }
        : { ...defaultBottomTextMarking(), text: SYNTHETIC_NAME, feet: "both", mode: "engrave" };
    return design;
}

/** Saved-design envelope after addPatientName composition. Synthetic name only. */
export function loftEnvelope(spec: ProductionPathSpec, side: Side) {
    const design = designForPath(spec);
    const envelope = designSettingsEnvelope(JSON.parse(JSON.stringify(design)));
    const resolved = resolveProductionTextMarking({
        settingsJson: envelope,
        patientNameOverride: SYNTHETIC_NAME,
        clientDisplayName: null,
    });
    return envelopeWithLoftTextMarking(resolved.envelope, resolved.patientDisplayName, side);
}
