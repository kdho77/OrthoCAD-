// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Production/integration bottom text uses the same textMarking model as Print/Export.

import {
    type DesignSettingsEnvelope,
    designSettingsEnvelope,
    readStoredDesignSettings,
} from "../../../shared/design-settings.js";
import {
    defaultTextMarking,
    hasActiveTextMarking,
    sanitizeText,
} from "../../../src/lib/geometry/text-marking/constants.js";
import type { TextMarking } from "../../../src/lib/geometry/text-marking/types.js";
import { normalizeTextMarking } from "../../../src/lib/geometry/text-marking/validate.js";

export { hasActiveTextMarking, sanitizeText };

export function patientDisplayName(firstName: string, lastName: string): string {
    return [firstName, lastName]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
}

/** Bottom engrave on both feet — matches the Print/Export panel defaults. */
export function textMarkingFromPatientName(rawName: string): TextMarking | null {
    const sanitized = sanitizeText(rawName.trim());
    if (!sanitized) return null;
    return normalizeTextMarking({
        ...defaultTextMarking("bottom"),
        text: sanitized,
        surface: "bottom",
        mode: "engrave",
        feet: "both",
    });
}

export function mergeTextMarkingIntoEnvelope(
    rawSettingsJson: unknown,
    marking: TextMarking,
): DesignSettingsEnvelope {
    const existing = readStoredDesignSettings(rawSettingsJson) ?? {};
    const prior = (existing.textMarking as Partial<TextMarking> | undefined) ?? {};
    const merged = normalizeTextMarking({
        ...defaultTextMarking("bottom"),
        ...prior,
        ...marking,
        surface: "bottom",
        mode: "engrave",
    });
    return designSettingsEnvelope({
        ...existing,
        textMarking: merged,
    });
}

export function settingsEnvelopeForPatientName(
    rawSettingsJson: unknown,
    rawName: string,
): DesignSettingsEnvelope | null {
    const marking = textMarkingFromPatientName(rawName);
    if (!marking) return null;
    return mergeTextMarkingIntoEnvelope(rawSettingsJson, marking);
}

export interface ResolvedProductionTextMarking {
    envelope: DesignSettingsEnvelope;
    textMarking: TextMarking;
    persisted: boolean;
}

/**
 * CAD-operator export: optional patient_name overrides saved text for this run and is merged into settingsJson.
 * When patientNameOverride is omitted, saved textMarking is kept as-is.
 */
export function resolveProductionTextMarking(args: {
    settingsJson: unknown;
    patientNameOverride?: string;
}): ResolvedProductionTextMarking {
    const existing = readStoredDesignSettings(args.settingsJson) ?? {};
    const prior = normalizeTextMarking({
        ...defaultTextMarking("bottom"),
        ...((existing.textMarking as Partial<TextMarking> | undefined) ?? {}),
        surface: "bottom",
        mode: "engrave",
    });
    const marking =
        args.patientNameOverride !== undefined
            ? normalizeTextMarking({
                  ...prior,
                  text: sanitizeText(args.patientNameOverride),
                  surface: "bottom",
                  mode: "engrave",
                  feet: "both",
              })
            : prior;
    const envelope = mergeTextMarkingIntoEnvelope(args.settingsJson, marking);
    const persisted =
        args.patientNameOverride !== undefined ||
        JSON.stringify(existing.textMarking ?? null) !== JSON.stringify(envelope.settings.textMarking);
    return {
        envelope,
        textMarking: marking,
        persisted,
    };
}
