// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { CustomGcodeBlocks, MillingProfile } from "./types";

const EMPTY_BLOCKS: CustomGcodeBlocks = {
    toolpathStart: "",
    toolpathEnd: "",
    bottomStart: "",
    bottomEnd: "",
    contourStart: "",
    contourEnd: "",
};

/** Seeded from the founder milling-table screenshots: Vertex Lab (Idaho) — ONE SIDE. */
export const IDAHO_PROFILE: MillingProfile = {
    id: "vertex-lab-idaho-one-side",
    name: "Vertex Lab (Idaho) - ONE SIDE",
    brand: "Default",
    documentType: "Insole design",
    strategy: "spiral",
    dimensions: "2D",
    strategyContour: "spiral",
    twoSides: false,
    twoSidesRotate: "Rotate Y-axis (table)",
    fileExtension: ".gcode",
    decimals: 4,
    tableWidthMm: 368.3,
    tableLengthMm: 260.35,
    materialHeightMm: 30,
    zeroX: "left",
    zeroY: "front",
    zeroZ: "bottom",
    freeMovementHeightMm: 50,
    topOffsetMm: 2.5,
    offsetBottomMm: 2,
    createCenterline: false,
    zOffsetCorrectionMm: 0,
    contourEnabled: true,
    extraMovementMm: -1,
    supportEnabled: false,
    supportMm: 10,
    layeredEnabled: true,
    layeredMm: 15,
    flatEnabled: true,
    toolpathCutter: { diameterMm: 10, type: "ball", rpm: 24000, enabled: true },
    contourCutter: { diameterMm: 10, type: "ball", rpm: 24000, enabled: true },
    topFeeds: { dip: 3500, normal: 36000, slow: 3500, contour: 2500 },
    bottomFeeds: { dip: 3500, normal: 24000, slow: 3500, contour: 2500 },
    customGcode: { ...EMPTY_BLOCKS },
    pockets: [
        { x: 0, y: 0, width: 368.3, length: 130.175 },
        { x: 0, y: 130.175, width: 368.3, length: 130.175 },
    ],
    alignX: "left",
    alignY: "center",
    insolesHorizontal: true,
    // Founder-confirmed: heel X0 (left), toe right; one insole per Y-stacked full-width pocket.
    heelDirection: "x0",
    // Founder-confirmed: 2.5 mm is a horizontal overrun ring around the outline, not Z.
    topOffsetMeaning: "horizontal_overrun",
    stepoverBallMm: 1.4,
    stepoverFlatMm: 3,
    sampleMm: 0.25,
    chordTolMm: 0.01,
};

export function cloneProfile(src: MillingProfile = IDAHO_PROFILE): MillingProfile {
    return {
        ...src,
        toolpathCutter: { ...src.toolpathCutter },
        contourCutter: { ...src.contourCutter },
        topFeeds: { ...src.topFeeds },
        bottomFeeds: { ...src.bottomFeeds },
        customGcode: { ...src.customGcode },
        pockets: src.pockets.map((p) => ({ ...p })),
    };
}

/**
 * Keep the milling rectangle at least as large as the pocket union.
 * Persisted Idaho profiles from the single-pocket era still have tableLength
 * 130.175 mm while carrying the later Y-stacked pockets — Right then paints
 * red at default even though the pocket itself is on the block.
 */
export function reconcileMillingProfile(profile: MillingProfile): MillingProfile {
    const next = cloneProfile(profile);
    if (next.id === IDAHO_PROFILE.id && next.pockets.length < IDAHO_PROFILE.pockets.length) {
        next.pockets = IDAHO_PROFILE.pockets.map((p) => ({ ...p }));
    }
    let maxX = 0;
    let maxY = 0;
    for (const pk of next.pockets) {
        maxX = Math.max(maxX, pk.x + pk.width);
        maxY = Math.max(maxY, pk.y + pk.length);
    }
    if (maxX > next.tableWidthMm) next.tableWidthMm = maxX;
    if (maxY > next.tableLengthMm) next.tableLengthMm = maxY;
    return next;
}

export function toolRadiusMm(diameterMm: number): number {
    return Math.max(0.1, diameterMm / 2);
}

export function stepoverMm(profile: MillingProfile, type: "ball" | "flat"): number {
    const raw = type === "ball" ? profile.stepoverBallMm : profile.stepoverFlatMm;
    if (type === "ball") return Math.min(3, Math.max(0.5, raw));
    return Math.max(0.5, raw);
}

export function skinZ(profile: MillingProfile): number {
    return Math.abs(profile.extraMovementMm);
}

/** Remaining-stock ceiling in the 0.2 mm band outside the outline after contour. */
export function wallClearZ(profile: MillingProfile): number {
    if (profile.contourCutter.type === "ball") {
        return skinZ(profile) + toolRadiusMm(profile.contourCutter.diameterMm);
    }
    return skinZ(profile);
}

/**
 * XY offset of the contour tool centre from the outline.
 * Exactly +R: the ball centreline. The 10 mm slot is outline → outline+2R.
 */
export function contourOffsetMm(profile: MillingProfile): number {
    return toolRadiusMm(profile.contourCutter.diameterMm);
}

export function clearanceZ(profile: MillingProfile): number {
    return profile.freeMovementHeightMm + profile.zOffsetCorrectionMm;
}

export function maxStepdownMm(profile: MillingProfile): number {
    return profile.layeredEnabled ? Math.max(0.1, profile.layeredMm) : profile.materialHeightMm;
}
