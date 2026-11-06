// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    addPatientNameEnabled,
    composeMarkingTextForSide,
    hasActiveComposedTextMarking,
    migrateLegacyPatientNameInText,
} from "./compose";
import { defaultTextMarking } from "./constants";

describe("bottom patient name compose", () => {
    test("add patient name is on by default", () => {
        expect(addPatientNameEnabled(defaultTextMarking("bottom"))).toBe(true);
        expect(addPatientNameEnabled({ ...defaultTextMarking("bottom"), addPatientName: false })).toBe(false);
    });

    test("name and extra compose as two lines", () => {
        const marking = {
            ...defaultTextMarking("bottom"),
            addPatientName: true,
            text: "SHOE 9W",
        };
        expect(composeMarkingTextForSide(marking, "left", "Jane Doe")).toBe("JANE DOE\nSHOE 9W");
    });

    test("checkbox off omits the name but keeps extra text", () => {
        const marking = {
            ...defaultTextMarking("bottom"),
            addPatientName: false,
            text: "SHOE 9W",
        };
        expect(composeMarkingTextForSide(marking, "left", "Jane Doe")).toBe("SHOE 9W");
    });

    test("missing client name does not invent composed text", () => {
        const marking = { ...defaultTextMarking("bottom"), addPatientName: true, text: "" };
        expect(hasActiveComposedTextMarking(marking, null, "left")).toBe(false);
    });

    test("legacy name-only text migrates to addPatientName with empty extra", () => {
        const legacy = { ...defaultTextMarking("bottom"), text: "JANE DOE" };
        const migrated = migrateLegacyPatientNameInText(legacy, "Jane Doe");
        expect(migrated.addPatientName).toBe(true);
        expect(migrated.text).toBe("");
    });
});
