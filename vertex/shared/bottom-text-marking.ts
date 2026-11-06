// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Bottom patient-name textMarking shared by Print/Export and the production server.
// The Vercel Node entry only transpiles api/, server/src/, and shared/, so this
// module must not import vertex/src.

export type Side = "left" | "right";
export type TextSurface = "bottom" | "wall" | "medial";
export type TextMode = "engrave" | "emboss";
export type TextAnchor = "heel" | "arch" | "forefoot";
export type TextFeet = "both" | "left" | "right";

/** Same shape as the client TextMarking. Empty text is a no-op. */
export interface TextMarking {
    /** Optional second line on the bottom (below the auto patient name). */
    text: string;
    /** When true (default), bottom engrave includes the linked client name; user does not type it. */
    addPatientName?: boolean;
    surface: TextSurface;
    mode: TextMode;
    bold: boolean;
    capHeightMm: number;
    depthMm: number;
    heightMm: number;
    letterSpacingMm: number;
    rotationDeg: number;
    placementU: number;
    anchor: TextAnchor;
    feet: TextFeet;
    differentOnLR: boolean;
    textLeft: string;
    textRight: string;
    nudgeAlongMm: number;
    nudgeAcrossMm: number;
}

export const TEXT_MAX_CHARS = 24;
/** A–Z, digits, and the punctuation patient marks actually use. */
export const TEXT_ALLOWED_CHAR = /[^A-Z0-9 .,/'’-]/;
export const TEXT_MIN_LETTER_SPACING_MM = 0.6;
export const TEXT_DEPTH_STEP_MM = 0.1;
export const TEXT_ROTATION_MAX_DEG = 90;

export const BOTTOM_CAP = { min: 2.5, default: 6, max: 12 } as const;
export const BOTTOM_ENGRAVE = { min: 0.3, default: 0.6, max: 1.2 } as const;
export const BOTTOM_EMBOSS_HEIGHT = { min: 0.3, default: 0.4, max: 1.2 } as const;
export const BOTTOM_U = { min: 0.12, default: 0.32, max: 0.78 } as const;
/** Arch anchor. Matches TEXT_ANCHOR_U.arch. */
export const BOTTOM_ANCHOR_U = 0.32;

export function sanitizeText(text: string): string {
    return text.toUpperCase().replace(new RegExp(TEXT_ALLOWED_CHAR.source, "g"), "").slice(0, TEXT_MAX_CHARS);
}

export function hasActiveTextMarking(marking: TextMarking | null | undefined): boolean {
    return Boolean(marking && marking.text.trim().length > 0);
}

function isSideText(surface: TextSurface): boolean {
    return surface === "wall" || surface === "medial";
}

function snapTextStep(value: number, min: number, max: number, step: number): number {
    const snapped = Math.round(value / step) * step;
    const clamped = Math.min(max, Math.max(min, snapped));
    return Number(clamped.toFixed(4));
}

/** Print/Export bottom default: name checkbox on, extra line empty, engrave. */
export function defaultBottomTextMarking(): TextMarking {
    return {
        text: "",
        addPatientName: true,
        surface: "bottom",
        mode: "engrave",
        bold: true,
        capHeightMm: BOTTOM_CAP.default,
        depthMm: BOTTOM_ENGRAVE.default,
        heightMm: BOTTOM_ENGRAVE.default,
        letterSpacingMm: TEXT_MIN_LETTER_SPACING_MM,
        rotationDeg: 0,
        placementU: BOTTOM_ANCHOR_U,
        anchor: "arch",
        feet: "both",
        differentOnLR: false,
        textLeft: "",
        textRight: "",
        nudgeAlongMm: 0,
        nudgeAcrossMm: 0,
    };
}

/**
 * Bottom branch of client normalizeTextMarking, with no wall-height or thickness override.
 * Bounds match textControlBounds("bottom") at the default 99 mm thickness.
 */
export function normalizeBottomTextMarking(input: Partial<TextMarking> | null | undefined): TextMarking {
    const base = defaultBottomTextMarking();
    const next: TextMarking = { ...base, ...input, surface: "bottom" };
    next.addPatientName = input?.addPatientName !== undefined ? input.addPatientName !== false : true;
    next.bold = true;
    next.anchor = input?.anchor ?? base.anchor;
    next.feet = input?.feet ?? base.feet;
    next.differentOnLR = Boolean(input?.differentOnLR);
    next.textLeft = (input?.textLeft ?? "").toUpperCase();
    next.textRight = (input?.textRight ?? "").toUpperCase();
    next.nudgeAlongMm = input?.nudgeAlongMm ?? 0;
    next.nudgeAcrossMm = input?.nudgeAcrossMm ?? 0;
    if (typeof next.text === "string") next.text = next.text.toUpperCase();
    next.mode = "engrave";
    next.capHeightMm = snapTextStep(next.capHeightMm, BOTTOM_CAP.min, BOTTOM_CAP.max, 0.1);
    next.depthMm = snapTextStep(next.depthMm, BOTTOM_ENGRAVE.min, BOTTOM_ENGRAVE.max, TEXT_DEPTH_STEP_MM);
    next.heightMm = snapTextStep(
        next.heightMm,
        BOTTOM_EMBOSS_HEIGHT.min,
        BOTTOM_EMBOSS_HEIGHT.max,
        TEXT_DEPTH_STEP_MM,
    );
    next.letterSpacingMm = Math.max(TEXT_MIN_LETTER_SPACING_MM, next.letterSpacingMm);
    next.rotationDeg = Math.max(-TEXT_ROTATION_MAX_DEG, Math.min(TEXT_ROTATION_MAX_DEG, next.rotationDeg));
    next.placementU = Math.max(BOTTOM_U.min, Math.min(BOTTOM_U.max, next.placementU));
    next.bold = next.bold !== false;
    if (typeof next.text === "string" && next.text.length > TEXT_MAX_CHARS) {
        next.text = next.text.slice(0, TEXT_MAX_CHARS);
    }
    return next;
}

export function patientDisplayNameFromParts(firstName: string, lastName: string): string {
    return [firstName, lastName]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
}

/** Default on when the flag is missing (new designs and legacy rows). */
export function addPatientNameEnabled(marking: Partial<TextMarking> | null | undefined): boolean {
    return marking?.addPatientName !== false;
}

export function sanitizeExtraText(raw: string): string {
    return sanitizeText(raw);
}

/** Extra line only — never the auto patient name. */
export function extraTextForSide(marking: TextMarking, side: Side): string {
    const raw = marking.differentOnLR
        ? side === "left"
            ? marking.textLeft || marking.text
            : marking.textRight || marking.text
        : marking.text;
    return sanitizeExtraText(raw);
}

export function composeBottomEngraveLines(args: {
    marking: TextMarking;
    side: Side;
    patientDisplayName?: string | null;
}): string[] {
    const lines: string[] = [];
    if (addPatientNameEnabled(args.marking) && args.patientDisplayName) {
        const name = sanitizeText(args.patientDisplayName.trim());
        if (name) lines.push(name);
    }
    const extra = extraTextForSide(args.marking, args.side);
    if (extra) lines.push(extra);
    return lines;
}

export function composeMarkingTextForSide(
    marking: TextMarking,
    side: Side,
    patientDisplayName?: string | null,
): string {
    return composeBottomEngraveLines({ marking, side, patientDisplayName }).join("\n");
}

/** Geometry/export: one marking copy with composed multi-line text in `text`. */
export function markingWithComposedText(
    marking: TextMarking,
    side: Side,
    patientDisplayName?: string | null,
): TextMarking {
    return { ...marking, text: composeMarkingTextForSide(marking, side, patientDisplayName) };
}

export function hasActiveComposedTextMarking(
    marking: TextMarking | null | undefined,
    patientDisplayName?: string | null,
    side: Side = "left",
): boolean {
    if (!marking) return false;
    if (isSideText(marking.surface)) return hasActiveTextMarking(marking);
    return composeMarkingTextForSide(marking, side, patientDisplayName).trim().length > 0;
}

/**
 * Legacy integration rows stored the client name in `text`. When addPatientName is unset and
 * text equals the client name, treat text as empty extra and default the checkbox on.
 */
export function migrateLegacyPatientNameInText(
    marking: TextMarking,
    patientDisplayName?: string | null,
): TextMarking {
    const next: TextMarking = {
        ...marking,
        addPatientName: marking.addPatientName !== false,
    };
    if (!patientDisplayName) return next;
    const name = sanitizeText(patientDisplayName.trim());
    const extra = sanitizeExtraText(marking.text);
    if (name && extra === name) {
        return { ...next, text: "", textLeft: "", textRight: "" };
    }
    return next;
}
