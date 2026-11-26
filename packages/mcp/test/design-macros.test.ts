// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execFileSync } from "node:child_process";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, test } from "@rstest/core";
import {
    type CadOperatorPrincipal,
    DOGFOOD_TENANT_ID,
} from "../../../vertex/server/src/auth/cad-operator.ts";
import {
    applyDesignMacrosOnDesign,
    type DesignMacroRuntime,
    listDesignMacrosForOperator,
} from "../../../vertex/server/src/lib/apply-design-macros.ts";
import { settingsEnvelopeForSave } from "../../../vertex/server/src/lib/design-schema.ts";
import { beltManufacturingStlIdentity } from "../../../vertex/server/src/routers/cad-operator-generate.ts";
import { readStoredDesignSettings } from "../../../vertex/shared/design-settings.ts";
import { buildSavedDesignSnapshot } from "../../../vertex/shared/saved-design-snapshot.ts";
import {
    applyDesignMacrosToDesign,
    type DesignMacro,
    DesignMacroError,
    listDesignMacros,
    resolveDesignMacros,
} from "../../../vertex/src/lib/clinical/correction-presets.ts";
import { useDesignStore } from "../../../vertex/src/stores/design-store.ts";
import type { DesignState } from "../../../vertex/src/types/index.ts";
import type { ManufacturingClient } from "../src/clients/manufacturing-client.ts";
import type { OrthocadMcpConfig } from "../src/config.ts";
import { handleOrthocadTool } from "../src/tools/handlers.ts";
import { applyMacroInputSchema, MCP_TOOL_DEFINITIONS } from "../src/tools/schemas.ts";

const config = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    apiKey: "ocad_test",
} as OrthocadMcpConfig;

const designId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-dogfood",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

/**
 * Order fixture only. Heel cup 14 mm and arch height 4 mm are the vertex-pf
 * starter values. This is not a stored Rhinebeck protocol.
 */
const rhinebeck: DesignMacro = {
    id: "fixture-customer-order",
    name: "Rhinebeck",
    kind: "customer",
    payload: {
        corrections: { linked: true, left: { heelCupDepthMm: 14, archHeightMm: 4 } },
    },
};

const runtime: DesignMacroRuntime = {
    listDesignMacros: (extra) => listDesignMacros((extra ?? []) as DesignMacro[]),
    resolveDesignMacros: (selection, macros) =>
        resolveDesignMacros(selection, macros as DesignMacro[] | undefined),
    applyDesignMacrosToDesign: (design, selection, macros) =>
        applyDesignMacrosToDesign(
            design as DesignState,
            selection,
            macros as DesignMacro[] | undefined,
        ) as Record<string, unknown>,
    DesignMacroError,
};

function libraryWithFixture(): DesignMacro[] {
    return listDesignMacros([rhinebeck]);
}

function mediumSavedDesign() {
    const built = buildSavedDesignSnapshot({
        stored: { system: "US_M", size: 9, left: null, right: null, width: "medium" },
        catalog: {},
    });
    return settingsEnvelopeForSave(built.design);
}

function row(settingsJson: unknown) {
    return {
        id: designId,
        ownerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Fixture insole",
        kind: "insole",
        pattern: "full_contact",
        method: "printing_solid",
        thicknessMm: 2,
        linked: true,
        unit: "mm",
        settingsJson,
        updatedAt: "2026-11-06T00:00:00.000Z",
        deletedAt: null,
        client: { tenantId: DOGFOOD_TENANT_ID },
        integrationLink: {
            tenantId: DOGFOOD_TENANT_ID,
            source: "vo2",
            externalOrderId: "fixture-order",
            sides: "pair",
        },
    };
}

function fakePrisma(current: ReturnType<typeof row>) {
    const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
    const prisma = {
        design: {
            findUnique: async () => current,
            update: async (input: { where: { id: string }; data: Record<string, unknown> }) => {
                updates.push(input);
                return { id: input.where.id };
            },
        },
    };
    return { prisma: prisma as unknown as PrismaClient, updates };
}

function uiMerge(saved: unknown, macros: DesignMacro[]): unknown {
    const settings = readStoredDesignSettings(saved);
    if (!settings) throw new Error("saved design missing");
    useDesignStore.setState({
        design: structuredClone(settings) as DesignState,
        history: [],
        future: [],
        pendingSessionDesign: null,
    });
    const customer = macros.find((macro) => macro.kind === "customer");
    const pathology = macros.find((macro) => macro.id === "vertex-planus");
    if (!customer || !pathology) throw new Error("fixture macros missing");
    const store = useDesignStore.getState();
    store.applyCorrectionPreset(customer.payload, "merge", { activeSide: "left", label: customer.name });
    store.applyCorrectionPreset(pathology.payload, "merge", { activeSide: "left", label: "Pes Planus" });
    return settingsEnvelopeForSave(useDesignStore.getState().design);
}

afterEach(() => {
    localStorage.removeItem("vertex-design-session");
});

describe("MCP list_macros and apply_macro", () => {
    test("the production catalog lists pes planus and does not invent Rhinebeck", async () => {
        const listed = await listDesignMacrosForOperator([], runtime);
        const planus = listed.macros.find((macro) => macro.id === "vertex-planus");
        expect(planus?.kind).toBe("pathology");
        expect(planus?.aliases).toEqual(["pes planus"]);
        expect(listed.macros.some((macro) => macro.name === "Rhinebeck")).toBe(false);
        expect(listed.macros.some((macro) => macro.kind === "customer")).toBe(false);
        expect(JSON.stringify(listed)).not.toMatch(/heelCup|archHeightMm|payload/);
        const tool = MCP_TOOL_DEFINITIONS.find((entry) => entry.name === "list_macros");
        expect(tool?.description).toMatch(/pes planus/);
        expect(tool?.description).toMatch(/Does not return millimetre payloads/);
    });

    test("list_macros returns that catalog and apply_macro rejects a millimetre payload", async () => {
        const manufacturing = {
            listDesignMacros: async () => listDesignMacrosForOperator([], runtime),
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool("list_macros", {}, { config, manufacturing });
        expect(result.isError).toBeUndefined();
        const body = JSON.parse(result.content[0]?.text ?? "{}") as { macros: Array<{ id: string }> };
        expect(body.macros.map((macro) => macro.id)).toEqual(
            (await listDesignMacrosForOperator([], runtime)).macros.map((macro) => macro.id),
        );
        expect(
            applyMacroInputSchema.safeParse({
                design_id: designId,
                customer_macro: "Rhinebeck",
                payload: { heelCupDepthMm: 9 },
            }).success,
        ).toBe(false);
    });

    test("customer then pathology matches the UI Merge and no macro leaves the saved design", async () => {
        const saved = mediumSavedDesign();
        const beforeMarking = readStoredDesignSettings(saved)?.textMarking;
        const library = libraryWithFixture();
        const uiSaved = uiMerge(saved, library);
        const { prisma, updates } = fakePrisma(row(structuredClone(saved)));
        const applied = await applyDesignMacrosOnDesign({
            prisma,
            principal,
            designId,
            customerMacro: "Rhinebeck",
            pathologyMacro: "Pes Planus",
            macros: library,
            runtime,
        });
        expect(applied.changed).toBe(true);
        expect(applied.applied.map((macro) => macro.kind)).toEqual(["customer", "pathology"]);
        expect(applied.settingsJson).toEqual(uiSaved);
        expect(updates).toHaveLength(1);
        expect(Object.keys(updates[0]?.data ?? {}).sort()).toEqual(["settingsJson"]);
        expect(readStoredDesignSettings(applied.settingsJson)?.elements).toEqual([]);
        expect(readStoredDesignSettings(applied.settingsJson)?.textMarking).toEqual(beforeMarking);
        expect(readStoredDesignSettings(applied.settingsJson)?.shoeWidth).toBe("medium");
        expect(beltManufacturingStlIdentity(saved, "left", "test-slicer")).not.toBe(
            beltManufacturingStlIdentity(applied.settingsJson, "left", "test-slicer"),
        );

        const quiet = fakePrisma(row(saved));
        const unchanged = await applyDesignMacrosOnDesign({
            prisma: quiet.prisma,
            principal,
            designId,
            runtime,
        });
        expect(unchanged.changed).toBe(false);
        expect(unchanged.applied).toEqual([]);
        expect(unchanged.settingsJson).toBe(saved);
        expect(quiet.updates).toHaveLength(0);
        expect(beltManufacturingStlIdentity(unchanged.settingsJson, "right", "test-slicer")).toBe(
            beltManufacturingStlIdentity(saved, "right", "test-slicer"),
        );
    });

    test("apply_macro forwards customer then pathology and returns the UI saved design", async () => {
        const saved = mediumSavedDesign();
        const library = libraryWithFixture();
        const uiSaved = uiMerge(saved, library);
        let forwarded: { designId?: string; customerMacro?: string; pathologyMacro?: string } | undefined;
        const { prisma } = fakePrisma(row(structuredClone(saved)));
        const manufacturing = {
            applyDesignMacros: async (input: {
                designId: string;
                customerMacro?: string;
                pathologyMacro?: string;
            }) => {
                forwarded = input;
                return applyDesignMacrosOnDesign({
                    prisma,
                    principal,
                    designId: input.designId,
                    customerMacro: input.customerMacro,
                    pathologyMacro: input.pathologyMacro,
                    macros: library,
                    runtime,
                });
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "apply_macro",
            {
                design_id: designId,
                pathology_macro: "Pes Planus",
                customer_macro: "Rhinebeck",
            },
            { config, manufacturing },
        );
        expect(result.isError).toBeUndefined();
        expect(forwarded).toEqual({
            designId,
            customerMacro: "Rhinebeck",
            pathologyMacro: "Pes Planus",
        });
        const body = JSON.parse(result.content[0]?.text ?? "{}") as {
            settingsJson: unknown;
            changed: boolean;
        };
        expect(body.changed).toBe(true);
        expect(body.settingsJson).toEqual(uiSaved);
    });

    test("an unknown Rhinebeck macro asks and does not write", async () => {
        const saved = mediumSavedDesign();
        const { prisma, updates } = fakePrisma(row(saved));
        await expect(
            applyDesignMacrosOnDesign({
                prisma,
                principal,
                designId,
                customerMacro: "Rhinebeck",
                pathologyMacro: "Pes Planus",
                runtime,
            }),
        ).rejects.toThrow(/No customer macro named "Rhinebeck"/);
        expect(updates).toHaveLength(0);

        const manufacturing = {
            applyDesignMacros: async () => {
                throw new DesignMacroError(
                    'No customer macro named "Rhinebeck" is in the library. Refusing to guess a clinical value.',
                );
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "apply_macro",
            { design_id: designId, customer_macro: "Rhinebeck", pathology_macro: "Pes Planus" },
            { config, manufacturing },
        );
        expect(result.isError).toBeUndefined();
        const body = JSON.parse(result.content[0]?.text ?? "{}") as {
            ok: boolean;
            ask: string;
            questions: Array<{ field: string; prompt: string }>;
        };
        expect(body.ok).toBe(false);
        expect(body.ask).toBe("user");
        expect(body.questions[0]?.field).toBe("customer_macro");
        expect(body.questions[0]?.prompt).toMatch(/Rhinebeck/);
        expect(body.questions[0]?.prompt).toMatch(/refuses to guess/i);
    });

    test("the generated bundle lists the same pathology ids as the UI module", () => {
        execFileSync(process.execPath, ["vertex/scripts/bundle-design-macros.mjs"], {
            cwd: process.cwd(),
            stdio: "pipe",
        });
        const listed = execFileSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                `import { listDesignMacros } from "./vertex/server/src/lib/design-macros.bundled.js";
                 process.stdout.write(JSON.stringify(listDesignMacros().map((macro) => macro.id)));`,
            ],
            { cwd: process.cwd(), encoding: "utf8" },
        );
        expect(JSON.parse(listed)).toEqual(listDesignMacros().map((macro) => macro.id));
    });
});
