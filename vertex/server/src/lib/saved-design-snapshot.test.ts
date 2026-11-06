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
