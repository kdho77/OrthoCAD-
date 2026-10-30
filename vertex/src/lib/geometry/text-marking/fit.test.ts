// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { evaluateTextFit } from "./fit";

const base = {
    surface: "wall" as const,
    capMm: 6,
    depthMm: 0.4,
    advanceMm: 40,
    strokeMm: 1.1,
    usableMm: 12,
    fitLengthMm: 80,
    thickMm: 3,
    toolDiameterMm: null as number | null,
    unsupported: "",
};

describe("text fit warnings", () => {
    test("chars", () => {
        const r = evaluateTextFit({ ...base, unsupported: "@" });
        expect(r.warnings.map((w) => w.id)).toContain("chars");
        expect(r.warnings.find((w) => w.id === "chars")?.message).toMatch(/@/);
    });

    test("feature", () => {
        const r = evaluateTextFit({ ...base, capMm: 3.5 });
        expect(r.warnings.map((w) => w.id)).toContain("feature");
        expect(r.warnings.find((w) => w.id === "feature")?.message).toMatch(/3\.5 mm/);
        expect(r.warnings.find((w) => w.id === "feature")?.fixes).toContain("bottom");
    });

    test("stroke", () => {
        const r = evaluateTextFit({ ...base, strokeMm: 0.4 });
        expect(r.warnings.map((w) => w.id)).toContain("stroke");
        expect(r.warnings.find((w) => w.id === "stroke")?.message).toMatch(/0\.40 mm/);
    });

    test("tool", () => {
        const r = evaluateTextFit({ ...base, strokeMm: 1.1, toolDiameterMm: 6 });
        expect(r.warnings.map((w) => w.id)).toContain("tool");
        expect(r.warnings.find((w) => w.id === "tool")?.message).toMatch(/6\.0 mm CNC/);
    });

    test("taller", () => {
        const r = evaluateTextFit({ ...base, capMm: 8, usableMm: 5.2 });
        expect(r.warnings.map((w) => w.id)).toContain("taller");
        expect(r.warnings.find((w) => w.id === "taller")?.message).toMatch(/5\.2 mm/);
        expect(r.warnings.find((w) => w.id === "taller")?.fixes).toEqual(["shrink", "bottom"]);
    });

    test("longer", () => {
        const r = evaluateTextFit({ ...base, advanceMm: 90, fitLengthMm: 40 });
        expect(r.warnings.map((w) => w.id)).toContain("longer");
        expect(r.warnings.find((w) => w.id === "longer")?.message).toMatch(/90\.0 mm/);
        expect(r.warnings.find((w) => w.id === "longer")?.fixes).toEqual(["shorten", "shrink"]);
    });

    test("depth clamps so 1.0 mm of wall remains", () => {
        const r = evaluateTextFit({ ...base, depthMm: 1.2, thickMm: 1.8 });
        expect(r.clampedDepthMm).toBe(0.8);
        expect(r.notes[0]).toMatch(/1\.2 mm to 0\.8 mm/);
    });

    test("bottom skips side-only warnings", () => {
        const r = evaluateTextFit({ ...base, surface: "bottom", capMm: 3.5, usableMm: 1 });
        expect(r.warnings.map((w) => w.id)).not.toContain("taller");
        expect(r.warnings.map((w) => w.id)).not.toContain("feature");
    });
});
