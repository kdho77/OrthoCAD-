import type { PrismaClient } from "@prisma/client";
import { describe, expect, test } from "@rstest/core";

import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import { parseSavedDesignCatalog, SavedDesignSnapshotError } from "../../../shared/saved-design-catalog.js";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot.js";
import { designStateFromDocument } from "../../../src/features/clients/design-document.js";
import { assertMilledCncOrder, PRINT_ORDER_CNC_REFUSAL } from "../../../src/lib/cnc/mill-job.js";
import { millExportSides } from "../../../src/lib/cnc/order-sides.js";
import { thicknessMmForDesignSide } from "../../../src/lib/geometry/shape-finish-modifiers.js";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import { settingsEnvelopeForSave } from "./design-schema.js";
import { persistSavedDesignSnapshotOnDesign } from "./saved-design-snapshot.js";

const DESIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-dogfood",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

function row(patch: Record<string, unknown> = {}) {
    return {
        id: DESIGN_ID,
        ownerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Fixture insole",
        kind: "insole",
        pattern: "full_contact",
        method: "printing_solid",
        thicknessMm: 2,
        linked: true,
        unit: "mm",
        settingsJson: null,
        updatedAt: "2026-11-06T00:00:00.000Z",
        deletedAt: null,
        client: { tenantId: DOGFOOD_TENANT_ID },
        integrationLink: {
            tenantId: DOGFOOD_TENANT_ID,
            source: "vo2",
            externalOrderId: "fixture-order",
            sides: "pair",
            shoeSizeSystem: "US_M",
            shoeSize: 9,
            shoeSizeLeft: null,
            shoeSizeRight: null,
            shoeWidth: "medium",
            rxText: "Morton's extension and flexible foot",
            notes: "Extra Soft",
        },
        ...patch,
    };
}

function fakePrisma(current = row()) {
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

function prescribedHighArchSnapshot() {
    const built = buildSavedDesignSnapshot({
        stored: null,
        catalog: {
            shoe_size: { system: "US_M", size: 9 },
            arch: "high",
            flexible_foot: true,
            hardness: "Hard",
            elements: [{ name: "Met Pad", side: "left" }],
        },
    });
    return settingsEnvelopeForSave(built.design);
}

describe("persist saved design snapshot", () => {
    test("null settingsJson is replaced in place and rx text is not mapped", async () => {
        const { prisma, updates } = fakePrisma();
        const result = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog: { rx_text: "Please add Morton's 6mm", notes: "Extra Soft", rigidity: "Extra Soft" },
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(updates).toHaveLength(1);
        expect(updates[0]?.where).toEqual({ id: DESIGN_ID });
        expect(Object.keys(updates[0]?.data ?? {}).sort()).toEqual(["settingsJson"]);
        expect(result.design_id).toBe(DESIGN_ID);
        expect(result.unmapped_fields).toEqual(["rx_text", "notes", "rigidity"]);
        const settings = readStoredDesignSettings(result.settingsJson);
        expect(settings?.usMenSize).toBe(9);
        expect(settings?.shoeWidth).toBe("medium");
        expect(settings?.elements).toEqual([]);
        expect(
            (settings?.corrections as { left: { archHeightMm: number; apexMoveMm: number } }).left
                .archHeightMm,
        ).toBe(0);
        expect((settings?.corrections as { left: { apexMoveMm: number } }).left.apexMoveMm).toBe(0);
        expect(JSON.stringify(result.settingsJson)).not.toMatch(/Morton|Extra Soft/);
        expect(result.paths).toContain("settings.usMenSize");
        expect(result.paths).toContain("settings.shoeWidth");
        expect(result.shoe_width).toBe("medium");
        expect(result.shoe_width_source).toBe("prescribed");
        expect(result.hardness_source).toBe("unspecified");
        expect(result.scans_used).toBe(false);
        const marking = settings?.textMarking as { capHeightMm?: number; bold?: boolean } | undefined;
        expect(marking?.capHeightMm).toBe(12);
        expect(marking?.bold).toBe(true);
    });

    test("a stored legacy 6 mm cap resolves to 12 mm bold and an explicit cap is kept", async () => {
        const template = buildSavedDesignSnapshot({
            stored: { system: "US_M", size: 9, left: null, right: null, width: null },
            catalog: parseSavedDesignCatalog({}),
        }).design;
        const legacyRow = settingsEnvelopeForSave({
            ...template,
            textMarking: { ...template.textMarking, capHeightMm: 6, bold: false },
        });
        const legacy = await persistSavedDesignSnapshotOnDesign({
            prisma: fakePrisma(row({ settingsJson: legacyRow })).prisma,
            principal,
            designId: DESIGN_ID,
            catalog: {},
            buildSnapshot: buildSavedDesignSnapshot,
        });
        const legacyMarking = readStoredDesignSettings(legacy.settingsJson)?.textMarking as {
            capHeightMm?: number;
            bold?: boolean;
            capHeightUserSet?: boolean;
        };
        expect(legacyMarking.capHeightMm).toBe(12);
        expect(legacyMarking.bold).toBe(true);
        expect(legacyMarking.capHeightUserSet).toBe(false);

        const explicitRow = settingsEnvelopeForSave({
            ...template,
            textMarking: {
                ...template.textMarking,
                capHeightMm: 8,
                capHeightUserSet: true,
                bold: false,
            },
        });
        const explicit = await persistSavedDesignSnapshotOnDesign({
            prisma: fakePrisma(row({ settingsJson: explicitRow })).prisma,
            principal,
            designId: DESIGN_ID,
            catalog: {},
            buildSnapshot: buildSavedDesignSnapshot,
        });
        const explicitMarking = readStoredDesignSettings(explicit.settingsJson)?.textMarking as {
            capHeightMm?: number;
            bold?: boolean;
            capHeightUserSet?: boolean;
        };
        expect(explicitMarking.capHeightMm).toBe(8);
        expect(explicitMarking.bold).toBe(true);
        expect(explicitMarking.capHeightUserSet).toBe(true);
    });

    test("stored xx_wide maps and an omitted width does not change shoeWidthSource", async () => {
        const xxWide = await persistSavedDesignSnapshotOnDesign({
            prisma: fakePrisma(
                row({
                    integrationLink: { ...row().integrationLink, shoeWidth: "xx_wide" },
                }),
            ).prisma,
            principal,
            designId: DESIGN_ID,
            catalog: { thickness_mm: 4 },
            manufacturingMethod: "milling_3axis",
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(xxWide.shoe_width).toBe("xx_wide");
        expect(xxWide.shoe_width_source).toBe("prescribed");
        const settings = readStoredDesignSettings(xxWide.settingsJson);
        expect(settings?.shoeWidth).toBe("xx_wide");

        const defaulted = settingsEnvelopeForSave(
            buildSavedDesignSnapshot({
                stored: { system: "US_M", size: 9, left: null, right: null, width: null },
                catalog: {},
            }).design,
        );
        const kept = await persistSavedDesignSnapshotOnDesign({
            prisma: fakePrisma(row({ settingsJson: defaulted })).prisma,
            principal,
            designId: DESIGN_ID,
            catalog: { thickness_mm: 4 },
            manufacturingMethod: "milling_3axis",
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(kept.shoe_width).toBe("medium");
        expect(kept.shoe_width_source).toBe("defaulted");
        expect(
            (
                readStoredDesignSettings(kept.settingsJson)?.dogfoodManufacturing as {
                    shoeWidthSource?: string;
                }
            ).shoeWidthSource,
        ).toBe("defaulted");

        const { prisma, updates } = fakePrisma(
            row({
                integrationLink: { ...row().integrationLink, shoeWidth: "unknown_width" },
            }),
        );
        await expect(
            persistSavedDesignSnapshotOnDesign({
                prisma,
                principal,
                designId: DESIGN_ID,
                catalog: { thickness_mm: 4 },
                buildSnapshot: buildSavedDesignSnapshot,
            }),
        ).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/cannot be mapped/) });
        expect(updates).toEqual([]);
    });

    test("a blank stored width is medium and recorded as defaulted", async () => {
        const { prisma, updates } = fakePrisma(
            row({
                integrationLink: {
                    ...row().integrationLink,
                    shoeWidth: "",
                },
            }),
        );
        const result = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog: {},
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(updates).toHaveLength(1);
        expect(result.shoe_width).toBe("medium");
        expect(result.shoe_width_source).toBe("defaulted");
        const settings = readStoredDesignSettings(result.settingsJson);
        expect(settings?.shoeWidth).toBe("medium");
        expect(
            (settings?.dogfoodManufacturing as { shoeWidthSource?: string } | undefined)?.shoeWidthSource,
        ).toBe("defaulted");
    });

    test("an unknown hardness does not write", async () => {
        const { prisma, updates } = fakePrisma();
        await expect(
            persistSavedDesignSnapshotOnDesign({
                prisma,
                principal,
                designId: DESIGN_ID,
                catalog: { hardness: "shore 99" },
                buildSnapshot: buildSavedDesignSnapshot,
            }),
        ).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/hardness/) });
        expect(updates).toEqual([]);
    });

    test("a bilateral 1.5 mm 1st met head sink is stored and a flat forefoot stays unset", async () => {
        const { prisma, updates } = fakePrisma();
        const result = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog: {
                sinks: [
                    { name: "1st met head", side: "left", depth_mm: 1.5 },
                    { name: "1st MPJ", side: "right", depth_mm: 1.5 },
                ],
            },
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(updates).toHaveLength(1);
        const settings = readStoredDesignSettings(result.settingsJson);
        const sinks = settings?.sinks as {
            left?: Array<{ kind: string; depthMm: number; u?: number; v?: number }>;
            right?: Array<{ kind: string; depthMm: number; u?: number; v?: number }>;
        };
        expect(sinks.left?.[0]).toMatchObject({ kind: "mpj1", depthMm: 1.5 });
        expect(sinks.right?.[0]).toMatchObject({ kind: "mpj1", depthMm: 1.5 });
        expect(sinks.left?.[0]?.u).toBeUndefined();
        expect(sinks.right?.[0]?.v).toBeUndefined();
        expect(settings?.elements).toEqual([]);
        const corrections = settings?.corrections as {
            left: { forefootWedge?: unknown };
            right: { forefootWedge?: unknown };
        };
        expect(corrections.left.forefootWedge).toBeUndefined();
        expect(corrections.right.forefootWedge).toBeUndefined();
    });

    test("a sink depth of 0 or above the mpj1 maximum is 422 and does not write", async () => {
        for (const depth_mm of [0, -1, 5]) {
            const { prisma, updates } = fakePrisma();
            await expect(
                persistSavedDesignSnapshotOnDesign({
                    prisma,
                    principal,
                    designId: DESIGN_ID,
                    catalog: { sinks: [{ name: "mpj1", side: "left", depth_mm }] },
                    buildSnapshot: buildSavedDesignSnapshot,
                }),
            ).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/depth/) });
            expect(updates).toEqual([]);
        }
        const { prisma, updates } = fakePrisma();
        await expect(
            persistSavedDesignSnapshotOnDesign({
                prisma,
                principal,
                designId: DESIGN_ID,
                catalog: { sinks: [{ name: "no such sink", side: "right" }] },
                buildSnapshot: buildSavedDesignSnapshot,
            }),
        ).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/unrecognized sink/) });
        expect(updates).toEqual([]);
    });

    test("a conflicting supplied size is 422 and does not write", async () => {
        const { prisma, updates } = fakePrisma();
        await expect(
            persistSavedDesignSnapshotOnDesign({
                prisma,
                principal,
                designId: DESIGN_ID,
                catalog: { shoe_size: { system: "US_M", size: 11 } },
                buildSnapshot: buildSavedDesignSnapshot,
            }),
        ).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/disagrees/) });
        expect(updates).toEqual([]);
    });

    test("another design id is not updated", async () => {
        const { prisma, updates } = fakePrisma(row({ id: OTHER_ID }));
        const result = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: OTHER_ID,
            catalog: {},
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(result.design_id).toBe(OTHER_ID);
        expect(updates[0]?.where.id).toBe(OTHER_ID);
        expect(updates[0]?.where.id).not.toBe(DESIGN_ID);
    });

    test("low arch with sinks and a lateral rearfoot wedge survive the save mapping", async () => {
        const low = await persistSavedDesignSnapshotOnDesign({
            prisma: fakePrisma().prisma,
            principal,
            designId: DESIGN_ID,
            catalog: {
                shoe_size: { system: "US_M", size: 9 },
                arch: "low",
                sinks: [{ name: "1st met head", side: "left", depth_mm: 1.5 }],
            },
        });
        const lowSettings = readStoredDesignSettings(low.settingsJson);
        const lowCorrections = lowSettings?.corrections as {
            left: { archHeightMm: number };
            right: { archHeightMm: number };
        };
        expect(lowCorrections.left.archHeightMm).toBe(-3.5);
        expect(lowCorrections.right.archHeightMm).toBe(-3.5);
        const sinks = lowSettings?.sinks as {
            left?: Array<{ kind: string; depthMm: number; u?: number; v?: number }>;
        };
        expect(sinks.left?.[0]).toMatchObject({ kind: "mpj1", depthMm: 1.5 });
        expect(sinks.left?.[0]?.u).toBeUndefined();
        expect(sinks.left?.[0]?.v).toBeUndefined();

        const high = await persistSavedDesignSnapshotOnDesign({
            prisma: fakePrisma().prisma,
            principal,
            designId: DESIGN_ID,
            catalog: { shoe_size: { system: "US_M", size: 9 }, arch: "high" },
        });
        const highCorrections = readStoredDesignSettings(high.settingsJson)?.corrections as {
            left: { archHeightMm: number };
        };
        expect(highCorrections.left.archHeightMm).toBe(3);

        const wedge = await persistSavedDesignSnapshotOnDesign({
            prisma: fakePrisma().prisma,
            principal,
            designId: DESIGN_ID,
            catalog: {
                shoe_size: { system: "US_M", size: 9 },
                rearfoot_wedge: { side: "lateral", value: 3, unit: "mm" },
            },
        });
        const wedgeCorrections = readStoredDesignSettings(wedge.settingsJson)?.corrections as {
            left: { rearfootWedge?: { side: string; value: number; unit: string; degreeMode?: string } };
            right: { rearfootWedge?: { side: string; value: number; unit: string; degreeMode?: string } };
        };
        for (const side of ["left", "right"] as const) {
            expect(JSON.parse(JSON.stringify(wedgeCorrections[side].rearfootWedge))).toEqual({
                side: "lateral",
                value: 3,
                unit: "mm",
            });
            expect(JSON.stringify(wedgeCorrections[side].rearfootWedge)).not.toContain("degree");
        }
    });

    test("a second persist with only shoe_size keeps stored arch, apex, hardness, and elements", async () => {
        const existing = prescribedHighArchSnapshot();
        const { prisma, updates } = fakePrisma(
            row({
                settingsJson: existing,
                integrationLink: {
                    ...row().integrationLink,
                    shoeSize: 10,
                },
            }),
        );
        const result = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog: { shoe_size: { system: "US_M", size: 10 } },
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(updates).toHaveLength(1);
        const settings = readStoredDesignSettings(result.settingsJson);
        expect(settings?.usMenSize).toBe(10);
        const corrections = settings?.corrections as {
            left: { archHeightMm: number; apexMoveMm: number };
            right: { archHeightMm: number; apexMoveMm: number };
        };
        expect(corrections.left.archHeightMm).toBe(3);
        expect(corrections.right.archHeightMm).toBe(3);
        expect(corrections.left.apexMoveMm).toBe(4);
        expect(corrections.right.apexMoveMm).toBe(4);
        expect((settings?.printRecipe as { defaultHardness?: string })?.defaultHardness).toBe("Hard");
        expect(
            (settings?.dogfoodManufacturing as { hardnessSource?: string } | undefined)?.hardnessSource,
        ).toBe("prescribed");
        const elements = settings?.elements as Array<{ kind: string }>;
        expect(elements).toHaveLength(1);
        expect(elements[0]?.kind).toBe("met_pad");
        expect(result.hardness_source).toBe("prescribed");
    });

    test("explicit arch, flexible_foot, and hardness still replace stored values", async () => {
        const existing = prescribedHighArchSnapshot();
        const { prisma } = fakePrisma(row({ settingsJson: existing }));
        const result = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog: { arch: "low", flexible_foot: false, hardness: "Medium" },
            buildSnapshot: buildSavedDesignSnapshot,
        });
        const settings = readStoredDesignSettings(result.settingsJson);
        const corrections = settings?.corrections as {
            left: { archHeightMm: number; apexMoveMm: number };
        };
        expect(corrections.left.archHeightMm).toBe(-3.5);
        expect(corrections.left.apexMoveMm).toBe(0);
        expect((settings?.printRecipe as { defaultHardness?: string })?.defaultHardness).toBe("Medium");
        expect(result.hardness_source).toBe("prescribed");
    });

    test("an empty catalog on an existing design keeps clinical fields", async () => {
        const existing = prescribedHighArchSnapshot();
        const { prisma, updates } = fakePrisma(row({ settingsJson: existing }));
        const result = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog: {},
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(updates).toHaveLength(1);
        const settings = readStoredDesignSettings(result.settingsJson);
        const corrections = settings?.corrections as {
            left: { archHeightMm: number; apexMoveMm: number };
            right: { archHeightMm: number; apexMoveMm: number };
        };
        expect(corrections.left.archHeightMm).toBe(3);
        expect(corrections.right.archHeightMm).toBe(3);
        expect(corrections.left.apexMoveMm).toBe(4);
        expect(corrections.right.apexMoveMm).toBe(4);
        expect((settings?.printRecipe as { defaultHardness?: string })?.defaultHardness).toBe("Hard");
        expect(
            (settings?.dogfoodManufacturing as { hardnessSource?: string } | undefined)?.hardnessSource,
        ).toBe("prescribed");
        const elements = settings?.elements as Array<{ kind: string }>;
        expect(elements).toHaveLength(1);
        expect(elements[0]?.kind).toBe("met_pad");
    });

    test("null settingsJson still builds from the SAMPLE_Top template", async () => {
        const { prisma, updates } = fakePrisma(row({ settingsJson: null }));
        const result = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog: {},
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(updates).toHaveLength(1);
        const settings = readStoredDesignSettings(result.settingsJson);
        expect(
            (settings?.corrections as { left: { archHeightMm: number; apexMoveMm: number } }).left
                .archHeightMm,
        ).toBe(0);
        expect((settings?.corrections as { left: { apexMoveMm: number } }).left.apexMoveMm).toBe(0);
        expect(settings?.elements).toEqual([]);
        expect(result.hardness_source).toBe("unspecified");
    });

    test("AFO designs are refused", async () => {
        const { prisma, updates } = fakePrisma(row({ kind: "afo" }));
        await expect(
            persistSavedDesignSnapshotOnDesign({ prisma, principal, designId: DESIGN_ID, catalog: {} }),
        ).rejects.toBeInstanceOf(SavedDesignSnapshotError);
        expect(updates).toEqual([]);
    });

    test("omitted thickness stays 2 mm zonal, and 4 mm is stored", () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: "medium" };
        const omitted = buildSavedDesignSnapshot({ stored, catalog: parseSavedDesignCatalog({}) });
        const thick = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ thickness_mm: 4 }),
        });
        expect(omitted.design.thicknessMm).toBe(2);
        expect(omitted.design.shellThicknessMode).toBe("zonal");
        expect(omitted.design.paired?.leftThicknessMm).toBe(2);
        expect(omitted.design.paired?.rightThicknessMm).toBe(2);
        expect(thick.design.thicknessMm).toBe(4);
        expect(thick.design.shellThicknessMode).toBe("zonal");
        expect(thick.design.paired?.leftThicknessMm).toBe(4);
        expect(thick.design.paired?.rightThicknessMm).toBe(4);
        expect(omitted.design.method).toBe(thick.design.method);
    });

    test("thickness outside 1.5–8 mm is 422", () => {
        for (const thickness_mm of [1.4, 8.1, 0]) {
            expect(() => parseSavedDesignCatalog({ thickness_mm })).toThrow(SavedDesignSnapshotError);
            try {
                parseSavedDesignCatalog({ thickness_mm });
            } catch (error) {
                expect(error).toMatchObject({ status: 422 });
            }
        }
    });

    test("a milled row stores shell thickness and does not change method or order status", async () => {
        const { prisma, updates } = fakePrisma(row({ method: "milling_3axis" }));
        const result = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog: { thickness_mm: 4 },
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(updates).toHaveLength(1);
        expect(Object.keys(updates[0]?.data ?? {}).sort()).toEqual(["settingsJson", "thicknessMm"]);
        expect(updates[0]?.data).toMatchObject({ thicknessMm: 4 });
        expect(updates[0]?.data).not.toHaveProperty("method");
        expect(updates[0]?.data).not.toHaveProperty("status");
        const settings = readStoredDesignSettings(result.settingsJson);
        expect(settings?.thicknessMm).toBe(4);
        expect(settings?.shellThicknessMode).toBe("zonal");
        expect(
            (settings?.paired as { leftThicknessMm: number; rightThicknessMm: number }).leftThicknessMm,
        ).toBe(4);
        expect((settings?.paired as { rightThicknessMm: number }).rightThicknessMm).toBe(4);
    });

    test("milling_3axis is explicit, keeps clinical settings, and is one CNC pair", async () => {
        const catalog = {
            shoe_size: { system: "US_M" as const, size: 9 },
            arch: "high" as const,
            flexible_foot: true,
            thickness_mm: 4,
            elements: [{ name: "Met Pad", side: "left" as const }],
        };
        const existing = settingsEnvelopeForSave(
            buildSavedDesignSnapshot({ stored: null, catalog: parseSavedDesignCatalog(catalog) }).design,
        );
        const before = readStoredDesignSettings(existing);
        const { prisma, updates } = fakePrisma(
            row({ settingsJson: existing, method: "printing_solid", thicknessMm: 2 }),
        );
        const milled = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog,
            manufacturingMethod: "milling_3axis",
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(updates[0]?.data.method).toBe("milling_3axis");
        expect(updates[0]?.data.thicknessMm).toBe(4);
        const settings = readStoredDesignSettings(milled.settingsJson);
        expect(settings?.method).toBe("milling_3axis");
        const paired = settings?.paired as {
            leftMethod: string;
            rightMethod: string;
            leftThicknessMm: number;
            rightThicknessMm: number;
        };
        expect(paired.leftMethod).toBe("milling_3axis");
        expect(paired.rightMethod).toBe("milling_3axis");
        expect((settings?.corrections as { left: { archHeightMm: number } }).left.archHeightMm).toBe(
            (before?.corrections as { left: { archHeightMm: number } }).left.archHeightMm,
        );
        expect(settings?.elements).toEqual(before?.elements);
        const design = designStateFromDocument({
            id: DESIGN_ID,
            pattern: "full_contact",
            method: "printing_solid",
            thicknessMm: 2,
            linked: true,
            unit: "mm",
            createdAt: "2026-11-15T00:00:00.000Z",
            updatedAt: "2026-11-15T00:00:00.000Z",
            corrections: [],
            elements: [],
            settingsJson: milled.settingsJson,
        });
        expect(design.method).toBe("milling_3axis");
        expect(design.thicknessMm).toBe(4);
        expect(thicknessMmForDesignSide(design, "left")).toBe(4);
        expect(thicknessMmForDesignSide(design, "right")).toBe(4);
        expect(() => assertMilledCncOrder(design)).not.toThrow();
        expect(millExportSides(design)).toEqual(["left", "right"]);
    });

    test("a print design stays printing_solid and CNC still refuses it", async () => {
        const catalog = { shoe_size: { system: "US_M" as const, size: 9 }, thickness_mm: 4 };
        const omitted = await persistSavedDesignSnapshotOnDesign({
            prisma: fakePrisma().prisma,
            principal,
            designId: DESIGN_ID,
            catalog,
            buildSnapshot: buildSavedDesignSnapshot,
        });
        const { prisma, updates } = fakePrisma();
        const explicit = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog,
            manufacturingMethod: "printing_solid",
            buildSnapshot: buildSavedDesignSnapshot,
        });
        const omittedSettings = readStoredDesignSettings(omitted.settingsJson);
        const explicitSettings = readStoredDesignSettings(explicit.settingsJson);
        expect(omittedSettings?.method).toBe("printing_solid");
        expect(explicitSettings?.method).toBe("printing_solid");
        expect((omittedSettings?.paired as { leftMethod: string }).leftMethod).toBe("printing_solid");
        expect((explicitSettings?.paired as { rightMethod: string }).rightMethod).toBe("printing_solid");
        expect(explicitSettings?.thicknessMm).toBe(omittedSettings?.thicknessMm);
        expect(explicitSettings?.shellThicknessMode).toBe(omittedSettings?.shellThicknessMode);
        expect(updates[0]?.data.method).toBe("printing_solid");
        const design = designStateFromDocument({
            id: DESIGN_ID,
            pattern: "full_contact",
            method: "printing_solid",
            thicknessMm: 2,
            linked: true,
            unit: "mm",
            createdAt: "2026-11-15T00:00:00.000Z",
            updatedAt: "2026-11-15T00:00:00.000Z",
            corrections: [],
            elements: [],
            settingsJson: omitted.settingsJson,
        });
        expect(() => assertMilledCncOrder(design)).toThrow(PRINT_ORDER_CNC_REFUSAL);
        expect(design.method).toBe("printing_solid");
    });

    test("catalog length stores the #364 preset and Full does not cut", () => {
        const stored = {
            system: "US_M" as const,
            size: 9,
            left: null,
            right: null,
            width: "medium" as const,
        };
        const omitted = buildSavedDesignSnapshot({ stored, catalog: parseSavedDesignCatalog({}) });
        const full = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ length: "Full" }),
        });
        const threeQuarter = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ length: "3/4" }),
        });
        const sulcus = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ length: "Sulcus" }),
        });
        expect(parseSavedDesignCatalog({ length: "3/4 length" }).length).toBe("met_head");
        expect(parseSavedDesignCatalog({ length: "Met-head" }).length).toBe("met_head");
        expect(omitted.design.trimPreset).toBeUndefined();
        expect(omitted.design.trimlines).toBeUndefined();
        expect(full.design.trimPreset).toEqual({ left: "full", right: "full" });
        expect(full.design.trimlines).toBeUndefined();
        const { trimPreset: _fullPreset, ...fullRest } = full.design;
        expect(fullRest).toEqual(omitted.design);
        expect(threeQuarter.design.trimPreset).toEqual({ left: "met_head", right: "met_head" });
        expect(threeQuarter.design.trimlines).toBeUndefined();
        expect(sulcus.design.trimPreset).toEqual({ left: "sulcus", right: "sulcus" });
        expect(sulcus.design.trimlines).toBeUndefined();
        expect(threeQuarter.design.textMarking).toEqual(omitted.design.textMarking);
        expect(threeQuarter.design.textMarking).toMatchObject({
            surface: "bottom",
            mode: "engrave",
            addPatientName: true,
            feet: "both",
        });
        expect(() => parseSavedDesignCatalog({ length: "half" })).toThrow(SavedDesignSnapshotError);
    });
});
