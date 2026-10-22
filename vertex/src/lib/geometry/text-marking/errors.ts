// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Print-time text failure — never produce an STL. */
export class TextMarkingError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(`[TEXT] ${message}`);
        this.name = "TextMarkingError";
        this.code = code;
    }
}

export function textTooThin(): TextMarkingError {
    return new TextMarkingError("too-thin", "too thin, enable Bold or increase size");
}

export function textTooLong(): TextMarkingError {
    return new TextMarkingError("too-long", "text is too long (max 24 characters)");
}

export function textDoesNotFit(): TextMarkingError {
    return new TextMarkingError("too-long", "text does not fit the placement zone");
}

export function textBottomEmboss(): TextMarkingError {
    return new TextMarkingError("bottom-emboss", "bottom emboss is disabled (bottom stays flat at z=0)");
}

export function textForbiddenZone(detail: string): TextMarkingError {
    return new TextMarkingError("forbidden-zone", `placement is in a forbidden zone: ${detail}`);
}

/** Shown when no station along a hybrid wall keeps the glyph 1.5 mm off the rim seam. */
export const HYBRID_SEAM_OVERLAP_MESSAGE = "Text overlaps the hybrid wall transition; move or shorten it";

export function textHybridSeamOverlap(): TextMarkingError {
    return new TextMarkingError("hybrid-seam", HYBRID_SEAM_OVERLAP_MESSAGE);
}

export function textTooThinRemaining(): TextMarkingError {
    return new TextMarkingError("thickness", "remaining thickness under engraving is below 1.0 mm");
}

export function textOutOfRange(control: string, min: number, max: number): TextMarkingError {
    return new TextMarkingError(
        "out-of-range",
        `${control} is out of range (${min}–${max} mm); no STL produced`,
    );
}
