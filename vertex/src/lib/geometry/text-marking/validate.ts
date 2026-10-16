// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    defaultTextMarking,
    hasActiveTextMarking,
    snapTextStep,
    TEXT_CAP,
    TEXT_DEPTH_STEP_MM,
    TEXT_EMBOSS_WALL,
    TEXT_ENGRAVE,
    TEXT_MAX_CHARS,
    TEXT_MIN_LETTER_SPACING_MM,
    TEXT_ROTATION_MAX_DEG,
    TEXT_U,
} from "./constants";
import { TextMarkingError, textBottomEmboss, textOutOfRange, textTooLong } from "./errors";
import type { TextMarking, TextSurface } from "./types";

export interface TextBounds {
    capMin: number;
    capMax: number;
    capDefault: number;
    depthMin: number;
    depthMax: number;
    depthDefault: number;
    heightMin: number;
    heightMax: number;
    heightDefault: number;
    uMin: number;
    uMax: number;
    uDefault: number;
    wallAvailable: boolean;
}

export function wallCapMaxMm(wallHeightMm: number): number {
    return wallHeightMm - 3;
}

export function textControlBounds(
    surface: TextSurface,
    opts: { wallHeightMm?: number; localThicknessMm?: number } = {},
): TextBounds {
    const wallHeight = opts.wallHeightMm ?? 20;
    const capMaxWall = wallCapMaxMm(wallHeight);
    const wallAvailable = capMaxWall >= TEXT_CAP.wall.min;
    const thickness = opts.localThicknessMm ?? 99;
    const engraveMaxByThick = thickness - 1.2;
    if (surface === "wall") {
        const depthMax = Math.min(TEXT_ENGRAVE.wall.max, engraveMaxByThick);
        return {
            capMin: TEXT_CAP.wall.min,
            capMax: Math.max(TEXT_CAP.wall.min, capMaxWall),
            capDefault: TEXT_CAP.wall.default,
            depthMin: TEXT_ENGRAVE.wall.min,
            depthMax: Math.max(TEXT_ENGRAVE.wall.min, depthMax),
            depthDefault: TEXT_ENGRAVE.wall.default,
            heightMin: TEXT_EMBOSS_WALL.min,
            heightMax: TEXT_EMBOSS_WALL.max,
            heightDefault: TEXT_EMBOSS_WALL.default,
            uMin: TEXT_U.wall.min,
            uMax: TEXT_U.wall.max,
            uDefault: TEXT_U.wall.default,
            wallAvailable,
        };
    }
    const depthMax = Math.min(TEXT_ENGRAVE.bottom.max, engraveMaxByThick);
    return {
        capMin: TEXT_CAP.bottom.min,
        capMax: TEXT_CAP.bottom.max,
        capDefault: TEXT_CAP.bottom.default,
        depthMin: TEXT_ENGRAVE.bottom.min,
        depthMax: Math.max(TEXT_ENGRAVE.bottom.min, depthMax),
        depthDefault: TEXT_ENGRAVE.bottom.default,
        heightMin: TEXT_EMBOSS_WALL.min,
        heightMax: TEXT_EMBOSS_WALL.max,
        heightDefault: TEXT_EMBOSS_WALL.default,
        uMin: TEXT_U.bottom.min,
        uMax: TEXT_U.bottom.max,
        uDefault: TEXT_U.bottom.default,
        wallAvailable,
    };
}

export function normalizeTextMarking(
    input: Partial<TextMarking> | null | undefined,
    surfaceHint?: TextSurface,
): TextMarking {
    const surface = input?.surface ?? surfaceHint ?? "bottom";
    const base = defaultTextMarking(surface);
    const next: TextMarking = { ...base, ...input, surface };
    if (surface === "bottom") next.mode = "engrave";
    const bounds = textControlBounds(surface);
    next.capHeightMm = snapTextStep(next.capHeightMm, bounds.capMin, bounds.capMax, 0.1);
    next.depthMm = snapTextStep(next.depthMm, bounds.depthMin, bounds.depthMax, TEXT_DEPTH_STEP_MM);
    next.heightMm = snapTextStep(next.heightMm, bounds.heightMin, bounds.heightMax, TEXT_DEPTH_STEP_MM);
    next.letterSpacingMm = Math.max(TEXT_MIN_LETTER_SPACING_MM, next.letterSpacingMm);
    next.rotationDeg = Math.max(-TEXT_ROTATION_MAX_DEG, Math.min(TEXT_ROTATION_MAX_DEG, next.rotationDeg));
    next.placementU = Math.max(bounds.uMin, Math.min(bounds.uMax, next.placementU));
    next.bold = next.bold !== false;
    if (typeof next.text === "string" && next.text.length > TEXT_MAX_CHARS) {
        next.text = next.text.slice(0, TEXT_MAX_CHARS);
    }
    return next;
}

/** Geometry-layer enforcement. Throws so an out-of-range request never yields an STL. */
export function assertTextMarkingInRange(
    marking: TextMarking,
    opts: { wallHeightMm?: number; localThicknessMm?: number } = {},
): TextMarking {
    if (marking.text.length > TEXT_MAX_CHARS) throw textTooLong();
    if (marking.surface === "bottom" && marking.mode === "emboss") throw textBottomEmboss();
    const bounds = textControlBounds(marking.surface, opts);
    if (marking.surface === "wall" && !bounds.wallAvailable) {
        throw new TextMarkingError("unavailable", "wall text is unavailable (wall height minus 3 mm is < 5)");
    }
    const cap = marking.capHeightMm;
    if (cap < bounds.capMin - 1e-6 || cap > bounds.capMax + 1e-6) {
        throw textOutOfRange("cap height", bounds.capMin, bounds.capMax);
    }
    if (marking.mode === "engrave") {
        const d = marking.depthMm;
        if (d < bounds.depthMin - 1e-6 || d > bounds.depthMax + 1e-6) {
            throw textOutOfRange("engrave depth", bounds.depthMin, bounds.depthMax);
        }
        const stepOff = Math.abs(d / TEXT_DEPTH_STEP_MM - Math.round(d / TEXT_DEPTH_STEP_MM));
        if (stepOff > 1e-6) throw textOutOfRange("engrave depth", bounds.depthMin, bounds.depthMax);
    } else {
        const h = marking.heightMm;
        if (h < bounds.heightMin - 1e-6 || h > bounds.heightMax + 1e-6) {
            throw textOutOfRange("emboss height", bounds.heightMin, bounds.heightMax);
        }
    }
    if (marking.letterSpacingMm + 1e-9 < TEXT_MIN_LETTER_SPACING_MM) {
        throw textOutOfRange("letter spacing", TEXT_MIN_LETTER_SPACING_MM, 99);
    }
    if (Math.abs(marking.rotationDeg) > TEXT_ROTATION_MAX_DEG + 1e-6) {
        throw textOutOfRange("rotation", -TEXT_ROTATION_MAX_DEG, TEXT_ROTATION_MAX_DEG);
    }
    if (marking.placementU < bounds.uMin - 1e-6 || marking.placementU > bounds.uMax + 1e-6) {
        throw textOutOfRange("placement u", bounds.uMin, bounds.uMax);
    }
    return marking;
}

export { hasActiveTextMarking };
