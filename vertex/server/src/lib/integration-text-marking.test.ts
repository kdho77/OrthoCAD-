// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import { hasActiveComposedTextMarking } from "../../../src/lib/geometry/text-marking/compose.js";
import { defaultTextMarking } from "../../../src/lib/geometry/text-marking/constants.js";
import {
    envelopeWithLoftTextMarking,
    integrationBottomTextMarkingDefaults,
    mergeTextMarkingIntoEnvelope,
    patientDisplayName,
    resolveProductionTextMarking,
    settingsEnvelopeForPatientName,
} from "./integration-text-marking.js";

describe("integration patient bottom textMarking", () => {
    test("integration defaults keep the name out of textMarking.text", () => {
        const marking = integrationBottomTextMarkingDefaults();
        expect(marking.text).toBe("");
        expect(marking.addPatientName).toBe(true);
        expect(marking.surface).toBe("bottom");
        expect(marking.mode).toBe("engrave");
        expect(marking.feet).toBe("both");
        expect(marking.capHeightMm).toBe(12);
        expect(marking.bold).toBe(true);
    });

    test("legacy implicit 6 mm resolves to 12 mm bold; an explicit cap is kept", () => {
        const legacySettings = {
            schemaVersion: 1,
            settings: {
                textMarking: {
                    ...integrationBottomTextMarkingDefaults(),
                    capHeightMm: 6,
                    bold: false,
                },
            },
        };
        const legacy = resolveProductionTextMarking({
            settingsJson: legacySettings,
            clientDisplayName: "Jane Doe",
        });
        expect(legacy.textMarking.capHeightMm).toBe(12);
        expect(legacy.textMarking.bold).toBe(true);
        expect(legacy.textMarking.capHeightUserSet).toBe(false);

        const chosen = resolveProductionTextMarking({
            settingsJson: {
                schemaVersion: 1,
                settings: {
                    textMarking: {
                        ...integrationBottomTextMarkingDefaults(),
                        capHeightMm: 8,
                        capHeightUserSet: true,
                        bold: false,
                    },
                },
            },
        });
        expect(chosen.textMarking.capHeightMm).toBe(8);
        expect(chosen.textMarking.bold).toBe(true);

        const chosenSix = resolveProductionTextMarking({
            settingsJson: {
                schemaVersion: 1,
                settings: {
                    textMarking: {
                        ...integrationBottomTextMarkingDefaults(),
                        capHeightMm: 6,
                        capHeightUserSet: true,
                    },
                },
            },
        });
        expect(chosenSix.textMarking.capHeightMm).toBe(6);
        expect(chosenSix.textMarking.bold).toBe(true);
    });

    test("loft envelope composes name and extra on separate lines", () => {
        const envelope = mergeTextMarkingIntoEnvelope(null, {
            ...defaultTextMarking("bottom"),
            addPatientName: true,
            text: "RX 42",
        });
        const loft = envelopeWithLoftTextMarking(envelope, "Jane Doe", "left");
        const settings = readStoredDesignSettings(loft);
        expect(settings?.textMarking).toMatchObject({ text: "JANE DOE\nRX 42" });
    });

    test("merge preserves unrelated settingsJson keys", () => {
        const prior = {
            schemaVersion: 1,
            settings: { shoeCatalog: { width: "medium" }, textMarking: { text: "OLD" } },
        };
        const envelope = mergeTextMarkingIntoEnvelope(prior, {
            ...integrationBottomTextMarkingDefaults(),
            text: "NOTE A",
        });
        const settings = readStoredDesignSettings(envelope);
        expect(settings?.shoeCatalog).toEqual({ width: "medium" });
        expect(settings?.textMarking).toMatchObject({
            addPatientName: true,
            text: "NOTE A",
            surface: "bottom",
            mode: "engrave",
            feet: "both",
        });
    });

    test("patient_name override resolves display name without storing it in text", () => {
        const resolved = resolveProductionTextMarking({
            settingsJson: null,
            patientNameOverride: "jane doe",
        });
        expect(resolved.textMarking.text).toBe("");
        expect(resolved.patientDisplayName).toBe("JANE DOE");
        expect(hasActiveComposedTextMarking(resolved.textMarking, resolved.patientDisplayName, "left")).toBe(
            true,
        );
        expect(resolved.persisted).toBe(true);
    });

    test("saved-design path without name fails closed after sanitize", () => {
        const resolved = resolveProductionTextMarking({ settingsJson: null, clientDisplayName: "" });
        expect(hasActiveComposedTextMarking(resolved.textMarking, resolved.patientDisplayName, "left")).toBe(
            false,
        );
    });

    test("display name trims and client-less create still defaults addPatientName", () => {
        expect(patientDisplayName("  Jane ", " Doe ")).toBe("Jane Doe");
        const envelope = settingsEnvelopeForPatientName(null, "   ");
        expect(envelope.settings.textMarking).toMatchObject({ addPatientName: true, text: "" });
    });
});
