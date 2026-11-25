// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { CLINICAL_LIMITS } from "@/lib/geometry/clinical-constraints";
import { FOREFOOT_POST_DEG_MAX, REARFOOT_POST_DEG_MAX } from "@/lib/geometry/posting-degrees";
import type { SideCorrections } from "@/types";

export type CorrectionFieldMeta = {
    key: keyof SideCorrections;
    label: string;
    min: number;
    max: number;
    unit?: string;
    group: string;
    hint?: string;
};

/** Scalar sliders shared with CorrectionsPanel and AI prescription review. */
export const CORRECTION_SCALAR_FIELDS: CorrectionFieldMeta[] = [
    {
        key: "archHeightMm",
        label: "Arch height",
        min: CLINICAL_LIMITS.archHeightMm.min,
        max: CLINICAL_LIMITS.archHeightMm.max,
        group: "Arch",
    },
    {
        key: "archElongationMm",
        label: "Arch elongation",
        min: CLINICAL_LIMITS.archElongationMm.min,
        max: CLINICAL_LIMITS.archElongationMm.max,
        group: "Arch",
    },
    { key: "apexMoveMm", label: "Apex shift (distal / posterior)", min: -12, max: 12, group: "Arch" },
    {
        key: "heelCupDepthMm",
        label: "Heel cup depth",
        min: 0,
        max: CLINICAL_LIMITS.heelCupDepthMm.max,
        group: "Heel",
    },
    {
        key: "heelCupWidthMm",
        label: "Heel cup width",
        min: CLINICAL_LIMITS.heelCupWidthMm.min,
        max: CLINICAL_LIMITS.heelCupWidthMm.max,
        group: "Heel",
    },
    {
        key: "forefootWidthMm",
        label: "Forefoot width",
        min: CLINICAL_LIMITS.forefootWidthMm.min,
        max: CLINICAL_LIMITS.forefootWidthMm.max,
        group: "Forefoot",
        hint: "per side (total width change = 2x)",
    },
    {
        key: "heelLiftMm",
        label: "Heel lift",
        min: CLINICAL_LIMITS.heelLiftMm.min,
        max: CLINICAL_LIMITS.heelLiftMm.max,
        group: "Heel",
    },
    { key: "medialFlangeMm", label: "Medial flange", min: 0, max: 8, group: "Flanges" },
    { key: "lateralFlangeMm", label: "Lateral flange", min: 0, max: 8, group: "Flanges" },
    { key: "medialSkiveMm", label: "Medial depth", min: 0, max: 8, unit: "mm", group: "Skive" },
    { key: "lateralSkiveMm", label: "Lateral depth", min: 0, max: 8, unit: "mm", group: "Skive" },
    {
        key: "archFillMm",
        label: "Arch fill",
        min: CLINICAL_LIMITS.archFillMm.min,
        max: CLINICAL_LIMITS.archFillMm.max,
        group: "Arch",
    },
    {
        key: "heelCupHeightMm",
        label: "Heel cup height",
        min: CLINICAL_LIMITS.heelCupHeightMm.min,
        max: CLINICAL_LIMITS.heelCupHeightMm.max,
        group: "Heel",
    },
    {
        key: "rearfootPostingDeg",
        label: "Rearfoot posting",
        min: -REARFOOT_POST_DEG_MAX,
        max: REARFOOT_POST_DEG_MAX,
        unit: "deg",
        group: "Posting",
    },
    {
        key: "forefootPostingDeg",
        label: "Forefoot posting",
        min: -FOREFOOT_POST_DEG_MAX,
        max: FOREFOOT_POST_DEG_MAX,
        unit: "deg",
        group: "Posting",
    },
];

const scalarByKey = new Map(CORRECTION_SCALAR_FIELDS.map((f) => [f.key, f]));

export function scalarFieldMeta(key: keyof SideCorrections): CorrectionFieldMeta | undefined {
    return scalarByKey.get(key);
}

export type WedgeFieldKey = "rearfootWedge" | "forefootWedge" | "fullLengthWedge";

export const WEDGE_FIELD_META: {
    key: WedgeFieldKey;
    label: string;
    maxDeg: number;
    maxMm: number;
}[] = [
    {
        key: "rearfootWedge",
        label: "Rearfoot",
        maxDeg: REARFOOT_POST_DEG_MAX,
        maxMm: CLINICAL_LIMITS.rearfootWedgeMm.max,
    },
    {
        key: "forefootWedge",
        label: "Forefoot",
        maxDeg: FOREFOOT_POST_DEG_MAX,
        maxMm: CLINICAL_LIMITS.rearfootWedgeMm.max,
    },
    {
        key: "fullLengthWedge",
        label: "Full-length",
        maxDeg: 10,
        maxMm: 20,
    },
];

export function clampScalarField(key: keyof SideCorrections, value: number): number {
    const meta = scalarFieldMeta(key);
    if (!meta) return value;
    return Math.min(meta.max, Math.max(meta.min, value));
}
