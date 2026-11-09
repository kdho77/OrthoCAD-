// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Production/integration bottom text uses the same textMarking model as Print/Export.

import {
    addPatientNameEnabled,
    defaultBottomTextMarking,
    hasActiveComposedTextMarking,
    hasActiveTextMarking,
    markingWithComposedText,
    migrateLegacyPatientNameInText,
    normalizeBottomTextMarking,
    patientDisplayNameFromParts,
    type Side,
    sanitizeText,
    type TextMarking,
} from "../../../shared/bottom-text-marking.js";
import {
    type DesignSettingsEnvelope,
    designSettingsEnvelope,
    readStoredDesignSettings,
} from "../../../shared/design-settings.js";

export { hasActiveComposedTextMarking, hasActiveTextMarking, patientDisplayNameFromParts, sanitizeText };

export function patientDisplayName(firstName: string, lastName: string): string {
    return patientDisplayNameFromParts(firstName, lastName);
}

/** Integration createDesign: default-on checkbox, extra line empty until the user adds text. */
export function integrationBottomTextMarkingDefaults(): TextMarking {
    return normalizeBottomTextMarking({
        ...defaultBottomTextMarking(),
        addPatientName: true,
        text: "",
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
    const merged = normalizeBottomTextMarking({
        ...defaultBottomTextMarking(),
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
    _rawName: string,
): DesignSettingsEnvelope {
    return mergeTextMarkingIntoEnvelope(rawSettingsJson, integrationBottomTextMarkingDefaults());
}

export interface ResolvedProductionTextMarking {
    envelope: DesignSettingsEnvelope;
    textMarking: TextMarking;
    patientDisplayName: string | null;
    persisted: boolean;
}

function resolvePatientDisplayName(args: {
    patientNameOverride?: string;
    clientDisplayName?: string | null;
}): string | null {
    const raw =
        args.patientNameOverride !== undefined ? args.patientNameOverride : (args.clientDisplayName ?? "");
    const sanitized = sanitizeText(raw.trim());
    return sanitized || null;
}

/**
 * CAD-operator export: optional patient_name overrides the linked client name for this run.
 * Persisted settings keep addPatientName and extra text separate; loft uses envelopeWithLoftTextMarking.
 */
export function resolveProductionTextMarking(args: {
    settingsJson: unknown;
    patientNameOverride?: string;
    clientDisplayName?: string | null;
}): ResolvedProductionTextMarking {
    const existing = readStoredDesignSettings(args.settingsJson) ?? {};
    const patientDisplayName = resolvePatientDisplayName(args);
    let prior = normalizeBottomTextMarking({
        ...defaultBottomTextMarking(),
        ...((existing.textMarking as Partial<TextMarking> | undefined) ?? {}),
        surface: "bottom",
        mode: "engrave",
    });
    prior = migrateLegacyPatientNameInText(prior, patientDisplayName ?? args.clientDisplayName ?? null);
    if (args.patientNameOverride !== undefined) {
        prior = normalizeBottomTextMarking({ ...prior, addPatientName: true });
    }
    const envelope = mergeTextMarkingIntoEnvelope(args.settingsJson, prior);
    const persisted =
        args.patientNameOverride !== undefined ||
        JSON.stringify(existing.textMarking ?? null) !== JSON.stringify(envelope.settings.textMarking);
    return {
        envelope,
        textMarking: prior,
        patientDisplayName,
        persisted,
    };
}

/** In-memory snapshot for headless Export loft (composed name + extra on one bottom string). */
export function envelopeWithLoftTextMarking(
    envelope: DesignSettingsEnvelope,
    patientDisplayName: string | null,
    side: Side,
): DesignSettingsEnvelope {
    const marking = envelope.settings.textMarking as TextMarking | undefined;
    if (!marking) return envelope;
    if (!addPatientNameEnabled(marking) && !hasActiveTextMarking(marking)) return envelope;
    const composed = markingWithComposedText(marking, side, patientDisplayName);
    return designSettingsEnvelope({
        ...envelope.settings,
        textMarking: composed,
    });
}
