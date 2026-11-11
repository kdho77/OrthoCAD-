import type { PrismaClient } from "@prisma/client";
import { describe, expect, test } from "@rstest/core";

import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import { SavedDesignSnapshotError } from "../../../shared/saved-design-catalog.js";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot.js";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
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
        expect(Object.keys(updates[0]?.data ?? {})).toEqual(["settingsJson"]);
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

    test("arch raise and forward apex shift are stored on both feet and out of range does not write", async () => {
        const { prisma, updates } = fakePrisma();
        const result = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog: { arch_raise_mm: 3, arch_apex_shift_mm: 4 },
            buildSnapshot: buildSavedDesignSnapshot,
        });
        expect(updates).toHaveLength(1);
        const settings = readStoredDesignSettings(result.settingsJson);
        const corrections = settings?.corrections as {
            linked: boolean;
            left: { archHeightMm: number; apexMoveMm: number; archFillMm: number };
            right: { archHeightMm: number; apexMoveMm: number; archFillMm: number };
        };
        expect(corrections.linked).toBe(true);
        expect(corrections.left).toMatchObject({ archHeightMm: 3, apexMoveMm: 4, archFillMm: 0 });
        expect(corrections.right).toMatchObject({ archHeightMm: 3, apexMoveMm: 4, archFillMm: 0 });
        expect(result.paths).toContain("settings.corrections.left.archHeightMm");
        expect(result.paths).toContain("settings.corrections.right.apexMoveMm");

        const refused = fakePrisma();
        await expect(
            persistSavedDesignSnapshotOnDesign({
                prisma: refused.prisma,
                principal,
                designId: DESIGN_ID,
                catalog: { arch_raise_mm: 14.001, arch_apex_shift_mm: 4 },
                buildSnapshot: buildSavedDesignSnapshot,
            }),
        ).rejects.toBeInstanceOf(SavedDesignSnapshotError);
        expect(refused.updates).toEqual([]);
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

    test("AFO and milled designs are refused", async () => {
        for (const current of [row({ kind: "afo" }), row({ method: "milling_3axis" })]) {
            const { prisma, updates } = fakePrisma(current);
            await expect(
                persistSavedDesignSnapshotOnDesign({ prisma, principal, designId: DESIGN_ID, catalog: {} }),
            ).rejects.toBeInstanceOf(SavedDesignSnapshotError);
            expect(updates).toEqual([]);
        }
    });
});
