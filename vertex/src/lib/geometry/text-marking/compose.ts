// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Side } from "@/types";
import { hasActiveTextMarking, isSideText, sanitizeText } from "./constants";
import type { TextMarking } from "./types";

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
