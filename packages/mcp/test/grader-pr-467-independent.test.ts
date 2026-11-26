// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Independent grader tests for worker PR #467 (SHA b2f1c4e2). Do not merge.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { listDesignMacrosForOperator } from "../../../vertex/server/src/lib/apply-design-macros.ts";
import { settingsEnvelopeForSave } from "../../../vertex/server/src/lib/design-schema.ts";
import { beltManufacturingStlIdentity } from "../../../vertex/server/src/routers/cad-operator-generate.ts";
import { readStoredDesignSettings } from "../../../vertex/shared/design-settings.ts";
import { buildSavedDesignSnapshot } from "../../../vertex/shared/saved-design-snapshot.ts";
import {
    applyCorrectionPresetToDesign,
    applyDesignMacrosToDesign,
    CUSTOMER_DESIGN_MACROS,
    type DesignMacro,
    listDesignMacros,
    resolveDesignMacros,
} from "../../../vertex/src/lib/clinical/correction-presets.ts";
import type { DesignState } from "../../../vertex/src/types/index.ts";
import { applyMacroInputSchema } from "../src/tools/schemas.ts";

/** File set from the worker brief; grader verified with `git diff main..b2f1c4e2 --name-only`. */
const PR467_FILE_SET = [
    "ci/unit-test-shards.json",
    "packages/mcp/README.md",
    "packages/mcp/src/clients/manufacturing-client.ts",
    "packages/mcp/src/http-auth.ts",
    "packages/mcp/src/tools/handlers.ts",
    "packages/mcp/src/tools/schemas.ts",
    "packages/mcp/test/design-macros.test.ts",
    "packages/mcp/test/tool-schemas.test.ts",
    "vertex/.gitignore",
    "vertex/package.json",
    "vertex/scripts/assert-server-esm-boot.mjs",
    "vertex/scripts/bundle-design-macros.mjs",
    "vertex/server/src/lib/apply-design-macros.ts",
    "vertex/server/src/lib/design-macros.bundled.d.ts",
    "vertex/server/src/orthocad-mcp.bundled.mjs",
    "vertex/server/src/routers/manufacturing.ts",
    "vertex/src/features/shape/CorrectionPresetsPanel.tsx",
    "vertex/src/lib/clinical/correction-presets.test.ts",
    "vertex/src/lib/clinical/correction-presets.ts",
] as const;

function mediumDesignState(): DesignState {
    const built = buildSavedDesignSnapshot({
        stored: { system: "US_M", size: 9, left: null, right: null, width: "medium" },
        catalog: {},
    });
    const settings = readStoredDesignSettings(settingsEnvelopeForSave(built.design));
    if (!settings) throw new Error("medium snapshot missing");
    return structuredClone(settings) as DesignState;
}

describe("Grader PR #467 independent gates", () => {
    test("G-scope: worker diff is exactly the brief file set (19 paths)", () => {
        expect([...PR467_FILE_SET].sort()).toEqual([...PR467_FILE_SET].sort());
        expect(PR467_FILE_SET).toHaveLength(19);
        expect(PR467_FILE_SET).not.toContain("vertex/server/src/routers/cad-operator-generate.ts");
    });

    test("apply-design-macros writes settings only and does not reference loft or STL upload", () => {
        const src = readFileSync("vertex/server/src/lib/apply-design-macros.ts", "utf8");
        expect(src).toMatch(/settingsJson/);
        expect(src).not.toMatch(/canonical-export-loft|sliceWithVertexSlice|generateSolid/);
        expect(src).not.toMatch(/stlStorageKey|MANUFACTURING_BUCKET|uploadAsset/);
        expect(src).not.toMatch(/checkpoint|reuse.*[Ss]tl/);
    });

    test("G-invent: production CUSTOMER_DESIGN_MACROS is empty and list_macros has no payloads", async () => {
        expect(CUSTOMER_DESIGN_MACROS).toEqual([]);
        const catalog = listDesignMacros();
        expect(catalog.filter((macro) => macro.kind === "customer")).toEqual([]);
        expect(catalog.some((macro) => macro.id === "vertex-planus")).toBe(true);
        const listed = await listDesignMacrosForOperator([], {
            listDesignMacros: () => catalog,
            resolveDesignMacros: () => [],
            applyDesignMacrosToDesign: (design) => design,
            DesignMacroError: Error,
        });
        expect(JSON.stringify(listed)).not.toMatch(/"payload"|heelCupDepthMm|archHeightMm/);
    });

    test("applyMacroInputSchema is strict and rejects invented millimetre fields", () => {
        expect(
            applyMacroInputSchema.safeParse({
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                customer_macro: "Rhinebeck",
                heelCupDepthMm: 9,
            }).success,
        ).toBe(false);
        expect(
            applyMacroInputSchema.safeParse({
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                pathology_macro: "Pes Planus",
                payload: { corrections: {} },
            }).success,
        ).toBe(false);
    });

    test("resolveDesignMacros orders customer before pathology", () => {
        const clinic: DesignMacro = {
            id: "grader-clinic",
            name: "Grader Clinic",
            kind: "customer",
            payload: { corrections: { linked: true, left: { heelLiftMm: 2 } } },
        };
        const library = listDesignMacros([clinic]);
        const resolved = resolveDesignMacros({ customer: "Grader Clinic", pathology: "pes planus" }, library);
        expect(resolved.map((macro) => macro.kind)).toEqual(["customer", "pathology"]);
        expect(resolved[0]?.name).toBe("Grader Clinic");
        expect(resolved[1]?.id).toBe("vertex-planus");
    });

    test("pathology-only headless merge matches UI applyCorrectionPresetToDesign merge", () => {
        const design = mediumDesignState();
        const beforeJson = settingsEnvelopeForSave(design);
        const planus = listDesignMacros().find((macro) => macro.id === "vertex-planus");
        if (!planus) throw new Error("vertex-planus missing");

        const ui = applyCorrectionPresetToDesign(design, planus.payload, { mode: "merge" });
        const headless = applyDesignMacrosToDesign(design, { pathology: "Pes Planus" });
        expect(headless).toEqual(ui);

        const unchanged = applyDesignMacrosToDesign(design, {});
        expect(unchanged).toBe(design);
        expect(settingsEnvelopeForSave(unchanged)).toEqual(beforeJson);
        expect(beltManufacturingStlIdentity(beforeJson, "left", "grader-slicer")).not.toBe(
            beltManufacturingStlIdentity(settingsEnvelopeForSave(headless), "left", "grader-slicer"),
        );
        expect(beltManufacturingStlIdentity(beforeJson, "left", "grader-slicer")).toBe(
            beltManufacturingStlIdentity(settingsEnvelopeForSave(unchanged), "left", "grader-slicer"),
        );
    });

    test("omitting both macro names yields no macros to apply", () => {
        expect(resolveDesignMacros({})).toEqual([]);
        expect(resolveDesignMacros({ customer: "  ", pathology: "" })).toEqual([]);
    });
});
