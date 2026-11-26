// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import {
    buildExportFilename,
    canonicalExportMaterialName,
    cncPairGcodeFilename,
    exportPatientFilenameSegment,
    exportPatientPartsForProduction,
    exportSideSuffix,
    looksLikeInitialsLabel,
    parsePatientNameForExport,
    productionFootExportFilename,
    physicalSideLabel,
    SAMPLE_TOP_TEMPLATE_ASSET_ID,
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
        expect(canonicalExportMaterialName("EVA Milled")).toBe("EVA");
        expect(canonicalExportMaterialName("EVA 45 Shore A")).toBe("EVA");
    });

    test("an EVA pair filename is First_Last_EVA_LR.gcode", () => {
        expect(
            cncPairGcodeFilename({
                firstName: "Anginette",
                lastName: "Arrington",
                material: "EVA Milled",
                sides: ["left", "right"],
            }),
        ).toBe("Anginette_Arrington_EVA_LR.gcode");
        expect(
            cncPairGcodeFilename({
                firstName: "Anginette",
                lastName: "Arrington",
                material: "EVA 45 Shore A",
                sides: ["left", "right"],
            }),
        ).toBe("Anginette_Arrington_EVA_LR.gcode");
        expect(
            cncPairGcodeFilename({
                firstName: "Fixture",
                lastName: "Sample",
                material: "EVA",
                sides: ["left", "right"],
                millSide: "LR",
            }),
        ).toBe("Fixture_Sample_EVA_LR.gcode");
        expect(
            cncPairGcodeFilename({
                firstName: "Fixture",
                lastName: "Sample",
                material: "EVA",
                sides: ["left", "left"],
                millSide: "RR",
            }),
        ).toBe("Fixture_Sample_EVA_RR.gcode");
        expect(
            cncPairGcodeFilename({
                firstName: "Fixture",
                lastName: "Sample",
                material: "EVA",
                sides: ["right", "right"],
                millSide: "LL",
            }),
        ).toBe("Fixture_Sample_EVA_LL.gcode");
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

describe("physicalSideLabel and SAMPLE_Top export filenames", () => {
    const sampleTop = { assetId: SAMPLE_TOP_TEMPLATE_ASSET_ID };

    test("sample-top keeps the requested side, same as every other base", () => {
        expect(physicalSideLabel("left", sampleTop)).toBe("left");
        expect(physicalSideLabel("right", sampleTop)).toBe("right");
        expect(physicalSideLabel("left", { assetId: "stock-default" })).toBe("left");
        expect(physicalSideLabel("right", null)).toBe("right");
    });

    test("exportSideSuffix maps the requested side for sample-top", () => {
        expect(exportSideSuffix("left", sampleTop)).toBe("L");
        expect(exportSideSuffix("right", sampleTop)).toBe("R");
        expect(exportSideSuffix(["left", "right"], sampleTop)).toBe("LR");
        expect(exportSideSuffix("left", { assetId: "patient-scan" })).toBe("L");
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

describe("productionFootExportFilename", () => {
    test("a right-foot Unknown_Patient key uses the chart when the left already names the patient", () => {
        const left = productionFootExportFilename({
            fileName: "Jane_Doe_ApexCore_L.gcode",
            firstName: "Jane",
            lastName: "Doe",
            material: "ApexCore",
            side: "left",
        });
        const right = productionFootExportFilename({
            fileName: "Unknown_Patient_ApexCore_R.gcode",
            firstName: "Jane",
            lastName: "Doe",
            material: "ApexCore",
            side: "right",
        });
        expect(left).toBe("Jane_Doe_ApexCore_L.gcode");
        expect(right).toBe("Jane_Doe_ApexCore_R.gcode");
        expect(right).not.toContain("Unknown_Patient");
    });

    test("an explicit filename is kept and an empty request uses the chart", () => {
        expect(
            productionFootExportFilename({
                fileName: "Ada_Lovelace_ApexCore_R.gcode",
                firstName: "Jane",
                lastName: "Doe",
                material: "ApexCore",
                side: "right",
            }),
        ).toBe("Ada_Lovelace_ApexCore_R.gcode");
        expect(
            productionFootExportFilename({
                patientName: "Ada Lovelace",
                firstName: "Jane",
                lastName: "Doe",
                material: "apex_core",
                side: "right",
            }),
        ).toBe("Ada_Lovelace_ApexCore_R.gcode");
        expect(
            productionFootExportFilename({
                firstName: "Jane",
                lastName: "Doe",
                material: "ApexCore",
                side: "right",
            }),
        ).toBe("Jane_Doe_ApexCore_R.gcode");
    });
});
