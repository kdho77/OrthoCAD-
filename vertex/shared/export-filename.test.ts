// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import {
    buildExportFilename,
    canonicalExportMaterialName,
    exportPatientFilenameSegment,
    exportPatientPartsForProduction,
    exportSideSuffix,
    looksLikeInitialsLabel,
    parsePatientNameForExport,
    sanitizeFilenamePart,
} from "./export-filename.js";

describe("buildExportFilename", () => {
    test("normal patient names and each canonical material with L and R", () => {
        for (const material of ["ApexLight", "ApexCore", "ApexBounce", "ApexForge"]) {
            expect(
                buildExportFilename({
                    firstName: "Jane",
                    lastName: "Doe",
                    material,
                    side: "L",
                    ext: ".gcode",
                }),
            ).toBe(`Jane_Doe_${material}_L.gcode`);
            expect(
                buildExportFilename({
                    firstName: "Jane",
                    lastName: "Doe",
                    material,
                    side: "R",
                    ext: "stl",
                }),
            ).toBe(`Jane_Doe_${material}_R.stl`);
        }
    });

    test("spaces, apostrophes, hyphens, and accents inside name parts", () => {
        expect(
            buildExportFilename({
                firstName: "Mary-Jane",
                lastName: "O'Connor",
                material: "ApexCore",
                side: "L",
                ext: ".gcode",
            }),
        ).toBe("Mary-Jane_O'Connor_ApexCore_L.gcode");
        expect(
            buildExportFilename({
                firstName: "Renée",
                lastName: "Çelik",
                material: "apex_light",
                side: "R",
                ext: ".3mf",
            }),
        ).toBe("Renée_Çelik_ApexLight_R.3mf");
    });

    test("missing patient name uses Unknown_Patient", () => {
        expect(
            buildExportFilename({
                firstName: "",
                lastName: "",
                material: "ApexCore",
                side: "LR",
                ext: ".gcode",
            }),
        ).toBe("Unknown_Patient_ApexCore_LR.gcode");
    });

    test("only a first name omits an empty last segment", () => {
        expect(
            buildExportFilename({
                firstName: "Madonna",
                lastName: "",
                material: "ApexLight",
                side: "L",
                ext: ".glb",
            }),
        ).toBe("Madonna_ApexLight_L.glb");
    });
});

describe("canonicalExportMaterialName", () => {
    test("maps slicer ids and aliases to canonical ids", () => {
        expect(canonicalExportMaterialName("apex_core")).toBe("ApexCore");
        expect(canonicalExportMaterialName("Apex Light")).toBe("ApexLight");
        expect(canonicalExportMaterialName("ApexComfort")).toBe("ApexCore");
        expect(canonicalExportMaterialName(undefined)).toBe("ApexCore");
    });
});

describe("sanitizeFilenamePart", () => {
    test("strips unsafe characters but keeps capitalization", () => {
        expect(sanitizeFilenamePart("  Jane  ")).toBe("Jane");
        expect(sanitizeFilenamePart("Ana María")).toBe("Ana-María");
    });
});

describe("parsePatientNameForExport", () => {
    test("splits a display name into first and last", () => {
        expect(parsePatientNameForExport("Jane Q Public")).toEqual({
            firstName: "Jane",
            lastName: "Q Public",
        });
    });
});

describe("exportPatientFilenameSegment and exportSideSuffix", () => {
    test("fallback and paired sides", () => {
        expect(exportPatientFilenameSegment("", "")).toBe("Unknown_Patient");
        expect(exportSideSuffix(["left", "right"])).toBe("LR");
        expect(exportSideSuffix("right")).toBe("R");
    });
});

describe("exportPatientPartsForProduction", () => {
    test("prefers chart first and last over initials label", () => {
        expect(
            exportPatientPartsForProduction({
                clientFirstName: "Jane",
                clientLastName: "Doe",
                clientLabel: "JD",
            }),
        ).toEqual({ firstName: "Jane", lastName: "Doe" });
    });

    test("does not treat initials as a first name", () => {
        expect(looksLikeInitialsLabel("JD")).toBe(true);
        expect(exportPatientPartsForProduction({ clientLabel: "JD" })).toEqual({
            firstName: "",
            lastName: "",
        });
        expect(
            buildExportFilename({
                ...exportPatientPartsForProduction({ clientLabel: "JD" }),
                material: "ApexCore",
                side: "LR",
                ext: "gcode",
            }),
        ).toBe("Unknown_Patient_ApexCore_LR.gcode");
    });

    test("parses a multi-word display label when chart names are absent", () => {
        expect(exportPatientPartsForProduction({ clientLabel: "Jane Doe" })).toEqual({
            firstName: "Jane",
            lastName: "Doe",
        });
    });
});
