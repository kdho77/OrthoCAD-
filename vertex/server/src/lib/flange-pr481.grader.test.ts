// Independent grader for PR #481 persist merge (452a2f6). Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, test } from "@rstest/core";

import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import { parseSavedDesignCatalog } from "../../../shared/saved-design-catalog.js";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot.js";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import { settingsEnvelopeForSave } from "./design-schema.js";
import { persistSavedDesignSnapshotOnDesign } from "./saved-design-snapshot.js";

const DESIGN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-grader-481",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare"],
};

function row(patch: Record<string, unknown> = {}) {
    return {
        id: DESIGN_ID,
        ownerId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        name: "Grader PR481",
        kind: "insole",
        pattern: "full_contact",
        method: "printing_solid",
        thicknessMm: 2,
        linked: true,
        unit: "mm",
        settingsJson: null,
        updatedAt: "2026-11-23T00:00:00.000Z",
        deletedAt: null,
        client: { tenantId: DOGFOOD_TENANT_ID },
        integrationLink: {
            tenantId: DOGFOOD_TENANT_ID,
            source: "vo2",
            externalOrderId: "grader-481",
            sides: "pair",
            shoeSizeSystem: "US_M",
            shoeSize: 9,
            shoeSizeLeft: null,
            shoeSizeRight: null,
            shoeWidth: "medium",
            rxText: null,
            notes: null,
        },
        ...patch,
    };
}

function fakePrisma(current = row()) {
    const prisma = {
        design: {
            findUnique: async () => current,
            update: async (input: { where: { id: string }; data: Record<string, unknown> }) => ({
                id: input.where.id,
            }),
        },
    };
    return { prisma: prisma as unknown as PrismaClient };
}

describe("PR #481 grader G6 — persist merge cannot restore stored 3 over explicit 0", () => {
    test("G6 Heinrich stored L lateral 3 + catalog lateral_mm 0 → readback 0", async () => {
        const seeded = buildSavedDesignSnapshot({
            stored: { system: "US_M", size: 9, left: null, right: null, width: "medium" },
            catalog: parseSavedDesignCatalog({}),
        });
        seeded.design.corrections.left.medialFlangeMm = 4;
        seeded.design.corrections.left.lateralFlangeMm = 3;
        const settingsJson = settingsEnvelopeForSave(seeded.design);

        const result = await persistSavedDesignSnapshotOnDesign({
            prisma: fakePrisma(row({ settingsJson })).prisma,
            principal,
            designId: DESIGN_ID,
            catalog: { flange: { left: { lateral_mm: 0 } } },
            buildSnapshot: buildSavedDesignSnapshot,
        });

        const settings = readStoredDesignSettings(result.settingsJson);
        const left = (
            settings?.corrections as {
                left: { medialFlangeMm: number; lateralFlangeMm: number };
            }
        ).left;
        expect(left.lateralFlangeMm).toBe(0);
        expect(left.lateralFlangeMm).not.toBe(3);
        expect(JSON.stringify(result.settingsJson)).toContain('"lateralFlangeMm":0');
    });

    test("G6b omitted flange catalog keeps seeded stored millimeters", async () => {
        const seeded = buildSavedDesignSnapshot({
            stored: { system: "US_M", size: 9, left: null, right: null, width: "medium" },
            catalog: parseSavedDesignCatalog({}),
        });
        seeded.design.corrections.left.lateralFlangeMm = 3;
        const settingsJson = settingsEnvelopeForSave(seeded.design);

        const result = await persistSavedDesignSnapshotOnDesign({
            prisma: fakePrisma(row({ settingsJson })).prisma,
            principal,
            designId: DESIGN_ID,
            catalog: {},
            buildSnapshot: buildSavedDesignSnapshot,
        });
        const left = (
            readStoredDesignSettings(result.settingsJson)?.corrections as {
                left: { lateralFlangeMm: number };
            }
        ).left;
        expect(left.lateralFlangeMm).toBe(3);
    });
});

describe("PR #481 grader G7 — MCP zod schemas preserve numeric zero", () => {
    test("G7 create and persist inputs keep flange *_mm: 0", async () => {
        const { createSavedDesignInputSchema, persistSavedDesignSnapshotInputSchema } = await import(
            "../../../../packages/mcp/src/tools/schemas.js"
        );
        const catalog = {
            flange: { left: { lateral_mm: 0 }, right: { medial_mm: 0, lateral_mm: 4 } },
        };
        const persist = persistSavedDesignSnapshotInputSchema.safeParse({
            design_id: DESIGN_ID,
            catalog,
        });
        const create = createSavedDesignInputSchema.safeParse({
            external_order_id: "grader-481",
            catalog,
        });
        expect(persist.success).toBe(true);
        expect(create.success).toBe(true);
        if (persist.success) {
            expect(persist.data.catalog?.flange?.left?.lateral_mm).toBe(0);
        }
        if (create.success) {
            expect(create.data.catalog?.flange?.right?.medial_mm).toBe(0);
        }
    });
});

describe("PR #481 grader G8 — reapplyExplicitFlangeMm present in server merge", () => {
    test("G8 server saved-design-snapshot calls reapplyExplicitFlangeMm after merge", () => {
        const src = readFileSync(join(import.meta.dirname, "saved-design-snapshot.ts"), "utf8");
        expect(src).toContain("reapplyExplicitFlangeMm(built, catalog)");
        expect(src).toMatch(/typeof entry\.medial_mm === "number"/);
        expect(src).toMatch(/typeof entry\.lateral_mm === "number"/);
    });
});
