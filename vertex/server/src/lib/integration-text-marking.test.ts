// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import {
    hasActiveTextMarking,
    mergeTextMarkingIntoEnvelope,
    patientDisplayName,
    resolveProductionTextMarking,
    settingsEnvelopeForPatientName,
    textMarkingFromPatientName,
} from "./integration-text-marking.js";

describe("integration patient bottom textMarking", () => {
    test("sanitized patient name yields bottom engrave on both feet", () => {
        const marking = textMarkingFromPatientName("Jane Doe");
        expect(marking).not.toBeNull();
        expect(marking?.text).toBe("JANE DOE");
        expect(marking?.surface).toBe("bottom");
        expect(marking?.mode).toBe("engrave");
        expect(marking?.feet).toBe("both");
    });

    test("merge preserves unrelated settingsJson keys", () => {
        const prior = {
            schemaVersion: 1,
            settings: { shoeCatalog: { width: "medium" }, textMarking: { text: "OLD" } },
        };
        const marking = textMarkingFromPatientName("JANE DOE");
        expect(marking).not.toBeNull();
        const envelope = mergeTextMarkingIntoEnvelope(prior, marking as NonNullable<typeof marking>);
        const settings = readStoredDesignSettings(envelope);
        expect(settings?.shoeCatalog).toEqual({ width: "medium" });
        expect(settings?.textMarking).toMatchObject({
            text: "JANE DOE",
            surface: "bottom",
            mode: "engrave",
            feet: "both",
        });
    });

    test("patient_name override applies the same marking for export", () => {
        const resolved = resolveProductionTextMarking({
            settingsJson: null,
            patientNameOverride: "jane doe",
        });
        expect(resolved.textMarking.text).toBe("JANE DOE");
        expect(hasActiveTextMarking(resolved.textMarking)).toBe(true);
        expect(resolved.persisted).toBe(true);
    });

    test("saved-design path without name fails closed after sanitize", () => {
        const resolved = resolveProductionTextMarking({ settingsJson: null });
        expect(hasActiveTextMarking(resolved.textMarking)).toBe(false);
    });

    test("display name trims and skips blanks", () => {
        expect(patientDisplayName("  Jane ", " Doe ")).toBe("Jane Doe");
        expect(settingsEnvelopeForPatientName(null, "   ")).toBeNull();
    });
});
