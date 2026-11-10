// Explicit isolated PostgreSQL acceptance. Default unit shards exclude this
// file. Selecting it without ORTHOCAD_ISOLATED_PG_ACCEPTANCE=1 fails closed.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import {
    assertDisposableUrl,
    assertIsolatedAcceptanceEnv,
} from "../../../../scripts/ci/isolated-postgres-acceptance.mjs";
import { assertDogfoodNotHeld } from "../../../shared/dogfood-holds.js";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot.js";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import type { OrderPersonVerification, OrderPersonVerifier } from "./dogfood-order-person-verifier.js";
import { VO_ORDER_OWNER_PRINCIPAL } from "./dogfood-order-person-verifier.js";
import {
    createDogfoodSavedDesign,
    IntegrationShoeWidthError,
    prismaDogfoodSavedDesignStore,
} from "./dogfood-saved-design.js";

const MIGRATION = "vertex/prisma/migrations/20261104120000_integration_launch_connector/migration.sql";
const OWNER_ID = "abababab-abab-4aba-8aba-abababababab";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-dogfood",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

function syntheticId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const id = randomUUID();
        try {
            assertDogfoodNotHeld(id);
            return id;
        } catch {
            // Draw another local id.
        }
    }
    throw new Error("could not draw a synthetic id");
}

function checkExpression(sql: string, constraint: string): string {
    const marker = `CONSTRAINT "${constraint}" CHECK `;
    const at = sql.indexOf(marker);
    if (at < 0) throw new Error(`migration is missing ${constraint}`);
    const open = sql.indexOf("(", at);
    let depth = 0;
    for (let index = open; index < sql.length; index += 1) {
        const char = sql[index];
        if (char === "(") depth += 1;
        else if (char === ")") {
            depth -= 1;
            if (depth === 0) return sql.slice(open, index + 1);
        }
    }
    throw new Error(`unclosed check ${constraint}`);
}

function pushSchema(url: string): void {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.DIRECT_URL;
    delete env.POSTGRES_URL;
    delete env.POSTGRES_PRISMA_URL;
    delete env.POSTGRES_URL_NON_POOLING;
    delete env.SUPABASE_URL;
    delete env.VITE_SUPABASE_URL;
    env.DATABASE_URL = url;
    env.DIRECT_URL = url;
    execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
        cwd: "vertex",
        env,
        stdio: "inherit",
    });
}

let prisma: PrismaClient;

async function counts() {
    const [clients, integrationClients, designs, integrationDesigns] = await Promise.all([
        prisma.client.count(),
        prisma.integrationClient.count(),
        prisma.design.count(),
        prisma.integrationDesign.count(),
    ]);
    return { clients, integrationClients, designs, integrationDesigns };
}

function accepting(personId: string, now: Date): OrderPersonVerifier {
    return {
        async verify(request) {
            return {
                ok: true,
                principal: VO_ORDER_OWNER_PRINCIPAL,
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                externalOrderId: request.externalOrderId,
                externalPersonId: personId,
                audience: "dogfood-saved-design",
                operation: "bind-order-person",
                verifiedAt: now.toISOString(),
                givenName: "Chart",
                familyName: "Label",
            };
        },
    };
}

async function establish(args: {
    orderId: string;
    personId: string;
    width?: string;
    verifier?: OrderPersonVerifier;
}) {
    const now = new Date();
    const catalog: Record<string, unknown> = {
        shoe_size: { system: "US_M", size: 10 },
        hardness: "Hard",
    };
    if (args.width) catalog.width = args.width;
    return createDogfoodSavedDesign({
        principal,
        externalOrderId: args.orderId,
        catalog,
        chart: { givenName: "Chart", familyName: "Label" },
        store: prismaDogfoodSavedDesignStore(prisma),
        verifier: args.verifier ?? accepting(args.personId, now),
        now: () => now,
        buildSnapshot: buildSavedDesignSnapshot,
        persist: refreshSnapshot,
    });
}

async function installChecks(): Promise<void> {
    const sql = readFileSync(MIGRATION, "utf8");
    const specs = [
        ["integration_clients", "integration_clients_shoeWidth_check"],
        ["integration_designs", "integration_designs_shoeWidth_check"],
    ] as const;
    for (const [table, name] of specs) {
        const expression = checkExpression(sql, name);
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`);
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK ${expression}`);
    }
}

describe("isolated postgres identity transaction", () => {
    beforeAll(async () => {
        const url = assertIsolatedAcceptanceEnv(process.env);
        prisma = new PrismaClient({ datasourceUrl: url });
        const version = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version() AS version`;
        console.info(`isolated_postgres_version ${version[0]?.version ?? ""}`);
        const ready = await prisma.$queryRaw<Array<{ ok: string | null }>>`
            SELECT to_regclass('public.integration_designs')::text AS ok
        `;
        if (!ready[0]?.ok) pushSchema(url);
        await installChecks();
        await prisma.tenant.upsert({
            where: { id: DOGFOOD_TENANT_ID },
            update: {},
            create: {
                id: DOGFOOD_TENANT_ID,
                name: "Synthetic dogfood",
                slug: "synthetic-dogfood",
                status: "active",
            },
        });
        await prisma.user.upsert({
            where: { email: "synthetic-owner@example.test" },
            update: { isActive: true, role: "clinician", tenantId: DOGFOOD_TENANT_ID },
            create: {
                id: OWNER_ID,
                email: "synthetic-owner@example.test",
                fullName: "Synthetic Owner",
                role: "clinician",
                isActive: true,
                tenantId: DOGFOOD_TENANT_ID,
            },
        });
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    test("the harness refuses a non-local url before connecting", () => {
        expect(process.env.ORTHOCAD_ISOLATED_PG_ACCEPTANCE).toBe("1");
        expect(process.env.DATABASE_URL ?? "").toBe("");
        expect(() =>
            assertDisposableUrl("postgresql://user:secret@db.example.supabase.co:5432/postgres"),
        ).toThrow(/localhost|password|disposable|orthocad_test/);
        expect(() =>
            assertDisposableUrl("postgresql://orthocad_test:live-secret@127.0.0.1:54329/orthocad_width"),
        ).toThrow(/password/);
        expect(() => assertIsolatedAcceptanceEnv({})).toThrow(/not selected/);
        expect(() =>
            assertIsolatedAcceptanceEnv({
                ORTHOCAD_ISOLATED_PG_ACCEPTANCE: "1",
                ORTHOCAD_ISOLATED_PG_URL: "postgresql://orthocad_test@127.0.0.1:54329/orthocad_width",
                DATABASE_URL: "postgresql://prod.example/postgres",
            }),
        ).toThrow(/DATABASE_URL/);
    });

    test("the migration shoe-width checks are present on both link tables", async () => {
        const rows = await prisma.$queryRaw<Array<{ conname: string; def: string }>>`
            SELECT conname, pg_get_constraintdef(oid) AS def
            FROM pg_constraint
            WHERE conname IN (
                'integration_clients_shoeWidth_check',
                'integration_designs_shoeWidth_check'
            )
            ORDER BY conname
        `;
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row.def).toContain("narrow");
            expect(row.def).toContain("medium");
            expect(row.def).toContain("wide");
            expect(row.def).not.toContain("extra_wide");
            expect(row.def).not.toContain("extra_narrow");
        }
    });

    test("an omitted width stores medium and keeps defaulted snapshot provenance", async () => {
        const orderId = syntheticId();
        const personId = `synthetic-${syntheticId()}`;
        const result = await establish({ orderId, personId });
        expect(result.shoe_width).toBe("medium");
        expect(result.shoe_width_source).toBe("defaulted");
        expect(result.hardness).toBe("Hard");
        const link = await prisma.integrationDesign.findFirstOrThrow({ where: { externalOrderId: orderId } });
        const client = await prisma.client.findUniqueOrThrow({ where: { id: result.client_id } });
        const person = await prisma.integrationClient.findFirstOrThrow({
            where: { externalClientId: personId },
        });
        const design = await prisma.design.findUniqueOrThrow({ where: { id: result.design_id } });
        expect(link.shoeWidth).toBe("medium");
        expect(client.shoeWidth).toBe("medium");
        expect(person.shoeWidth).toBe("medium");
        expect(design.settingsJson).toMatchObject({
            settings: {
                shoeWidth: "medium",
                dogfoodManufacturing: { shoeWidthSource: "defaulted", shoeWidth: "medium" },
            },
        });
    });

    test("prescribed narrow, medium, and wide are stored as prescribed", async () => {
        for (const width of ["narrow", "medium", "wide"] as const) {
            const orderId = syntheticId();
            const personId = `synthetic-${syntheticId()}`;
            const result = await establish({ orderId, personId, width });
            expect(result.shoe_width).toBe(width);
            expect(result.shoe_width_source).toBe("prescribed");
            const link = await prisma.integrationDesign.findFirstOrThrow({
                where: { externalOrderId: orderId },
            });
            expect(link.shoeWidth).toBe(width);
            expect(link.clientId).toBe(result.client_id);
            const design = await prisma.design.findUniqueOrThrow({ where: { id: result.design_id } });
            expect(design.settingsJson).toMatchObject({
                settings: { dogfoodManufacturing: { shoeWidthSource: "prescribed", shoeWidth: width } },
            });
        }
    });

    test("extra and invalid widths are rejected before a transaction and write nothing", async () => {
        const before = await counts();
        const original = prisma.$transaction.bind(prisma);
        let began = 0;
        prisma.$transaction = ((...args: Parameters<typeof original>) => {
            began += 1;
            return original(...args);
        }) as typeof prisma.$transaction;
        try {
            for (const width of ["extra_narrow", "extra_wide"]) {
                const orderId = syntheticId();
                await expect(
                    establish({ orderId, personId: `synthetic-${syntheticId()}`, width }),
                ).rejects.toBeInstanceOf(IntegrationShoeWidthError);
                expect(await prisma.integrationDesign.count({ where: { externalOrderId: orderId } })).toBe(0);
            }
            await expect(
                establish({ orderId: syntheticId(), personId: `synthetic-${syntheticId()}`, width: "giant" }),
            ).rejects.toThrow();
            const store = prismaDogfoodSavedDesignStore(prisma);
            await expect(
                store.establishVerifiedOrder?.({
                    externalOrderId: syntheticId(),
                    externalPersonId: `synthetic-${syntheticId()}`,
                    givenName: "Chart",
                    familyName: "Label",
                    verifiedAt: new Date().toISOString(),
                    now: new Date(),
                    settingsJson: { schemaVersion: 1 },
                    linkShoe: { system: "US_M", size: 10, left: null, right: null },
                    linkShoeWidth: "giant",
                    chartWidth: "medium",
                }),
            ).rejects.toBeInstanceOf(IntegrationShoeWidthError);
            expect(began).toBe(0);
            expect(await counts()).toEqual(before);
        } finally {
            prisma.$transaction = original;
        }
    });

    test("the human client table still accepts extra_wide", async () => {
        const id = syntheticId();
        const row = await prisma.client.create({
            data: {
                id,
                tenantId: DOGFOOD_TENANT_ID,
                ownerId: OWNER_ID,
                firstName: "Chart",
                lastName: "Label",
                shoeWidth: "extra_wide",
            },
        });
        expect(row.shoeWidth).toBe("extra_wide");
        await prisma.client.delete({ where: { id } });
    });

    test("a last-insert shoe-width check rolls back all four rows", async () => {
        const before = await counts();
        const clientId = syntheticId();
        const designId = syntheticId();
        const orderId = syntheticId();
        const personId = `synthetic-${syntheticId()}`;
        await expect(
            prisma.$transaction(async (tx) => {
                await tx.client.create({
                    data: {
                        id: clientId,
                        tenantId: DOGFOOD_TENANT_ID,
                        ownerId: OWNER_ID,
                        firstName: "Chart",
                        lastName: "Label",
                        displayName: "Chart Label",
                        shoeSizeSystem: "US_M",
                        shoeSizeUs: 10,
                        shoeWidth: "medium",
                    },
                });
                await tx.integrationClient.create({
                    data: {
                        source: "vo2",
                        tenantId: DOGFOOD_TENANT_ID,
                        externalClientId: personId,
                        clientId,
                        shoeSizeSystem: "US_M",
                        shoeSize: 10,
                        shoeWidth: "medium",
                    },
                });
                await tx.design.create({
                    data: {
                        id: designId,
                        clientId,
                        ownerId: OWNER_ID,
                        name: "rollback probe",
                        kind: "insole",
                    },
                });
                await tx.integrationDesign.create({
                    data: {
                        source: "vo2",
                        tenantId: DOGFOOD_TENANT_ID,
                        externalOrderId: orderId,
                        designId,
                        clientId,
                        kind: "insole",
                        sides: "pair",
                        shoeSizeSystem: "US_M",
                        shoeSize: 10,
                        shoeWidth: "extra_wide",
                    },
                });
            }),
        ).rejects.toThrow(/integration_designs_shoeWidth_check/);
        expect(await prisma.client.findUnique({ where: { id: clientId } })).toBeNull();
        expect(
            await prisma.integrationClient.findFirst({ where: { externalClientId: personId } }),
        ).toBeNull();
        expect(await prisma.design.findUnique({ where: { id: designId } })).toBeNull();
        expect(await prisma.integrationDesign.findFirst({ where: { externalOrderId: orderId } })).toBeNull();
        expect(await counts()).toEqual(before);
    });

    test("the establishment transaction rolls back when the last insert violates the check", async () => {
        const before = await counts();
        const orderId = syntheticId();
        const personId = `synthetic-${syntheticId()}`;
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS orthocad_test_fault (
                id integer PRIMARY KEY,
                fail_last boolean NOT NULL
            )
        `);
        await prisma.$executeRawUnsafe(`
            INSERT INTO orthocad_test_fault (id, fail_last) VALUES (1, false)
            ON CONFLICT (id) DO UPDATE SET fail_last = false
        `);
        await prisma.$executeRawUnsafe(`
            CREATE OR REPLACE FUNCTION orthocad_test_force_link_width() RETURNS trigger AS $$
            BEGIN
                IF EXISTS (SELECT 1 FROM orthocad_test_fault WHERE id = 1 AND fail_last) THEN
                    NEW."shoeWidth" := 'extra_wide';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);
        await prisma.$executeRawUnsafe(`
            DROP TRIGGER IF EXISTS orthocad_test_force_link_width ON integration_designs
        `);
        await prisma.$executeRawUnsafe(`
            CREATE TRIGGER orthocad_test_force_link_width
            BEFORE INSERT ON integration_designs
            FOR EACH ROW EXECUTE FUNCTION orthocad_test_force_link_width()
        `);
        try {
            await prisma.$executeRawUnsafe(`UPDATE orthocad_test_fault SET fail_last = true WHERE id = 1`);
            await expect(establish({ orderId, personId })).rejects.toThrow(
                /integration_designs_shoeWidth_check/,
            );
            expect(
                await prisma.integrationDesign.findFirst({ where: { externalOrderId: orderId } }),
            ).toBeNull();
            expect(
                await prisma.integrationClient.findFirst({ where: { externalClientId: personId } }),
            ).toBeNull();
            expect(await counts()).toEqual(before);
        } finally {
            await prisma.$executeRawUnsafe(`UPDATE orthocad_test_fault SET fail_last = false WHERE id = 1`);
            await prisma.$executeRawUnsafe(`
                DROP TRIGGER IF EXISTS orthocad_test_force_link_width ON integration_designs
            `);
        }
    });

    test("parallel first-time calls keep one client, one design, and medium", async () => {
        for (let round = 0; round < 4; round += 1) {
            const orderId = syntheticId();
            const personId = `synthetic-${syntheticId()}`;
            const [left, right] = await Promise.all([
                establish({ orderId, personId }),
                establish({ orderId, personId }),
            ]);
            expect(left.client_id).toBe(right.client_id);
            expect(left.design_id).toBe(right.design_id);
            expect(await prisma.integrationClient.count({ where: { externalClientId: personId } })).toBe(1);
            expect(await prisma.integrationDesign.count({ where: { externalOrderId: orderId } })).toBe(1);
            expect(await prisma.client.count({ where: { id: left.client_id } })).toBe(1);
            expect(await prisma.design.count({ where: { id: left.design_id } })).toBe(1);
            const link = await prisma.integrationDesign.findFirstOrThrow({
                where: { externalOrderId: orderId },
            });
            expect(link.shoeWidth).toBe("medium");
            expect(link.clientId).toBe(left.client_id);
            expect(link.designId).toBe(left.design_id);
            const again = await establish({ orderId, personId });
            expect(again.created).toBe(false);
            expect(again.established).toBe(false);
            expect(again.client_id).toBe(left.client_id);
            expect(again.design_id).toBe(left.design_id);
            expect(await prisma.integrationDesign.count({ where: { externalOrderId: orderId } })).toBe(1);
            expect(await prisma.integrationClient.count({ where: { externalClientId: personId } })).toBe(1);
        }
    });

    test("a mismatch and an untrusted proof write nothing", async () => {
        const kept = await establish({
            orderId: syntheticId(),
            personId: `synthetic-${syntheticId()}`,
            width: "wide",
        });
        const other = await establish({
            orderId: syntheticId(),
            personId: `synthetic-${syntheticId()}`,
            width: "narrow",
        });
        const before = await counts();
        const keptLink = await prisma.integrationDesign.findFirstOrThrow({
            where: { designId: kept.design_id },
        });
        const otherLink = await prisma.integrationDesign.findFirstOrThrow({
            where: { designId: other.design_id },
        });
        const mismatch = await prismaDogfoodSavedDesignStore(prisma).establishVerifiedOrder?.({
            externalOrderId: keptLink.externalOrderId,
            externalPersonId: (
                await prisma.integrationClient.findFirstOrThrow({ where: { clientId: other.client_id } })
            ).externalClientId,
            givenName: "Chart",
            familyName: "Label",
            verifiedAt: new Date().toISOString(),
            now: new Date(),
            settingsJson: { schemaVersion: 1 },
            linkShoe: { system: "US_M", size: 10, left: null, right: null },
            linkShoeWidth: "medium",
            chartWidth: "medium",
        });
        expect(mismatch).toEqual({ outcome: "mismatch" });
        const freshOrder = syntheticId();
        const untrusted: OrderPersonVerification = {
            ok: true,
            principal: VO_ORDER_OWNER_PRINCIPAL,
            source: "vo2",
            tenantId: DOGFOOD_TENANT_ID,
            externalOrderId: syntheticId(),
            externalPersonId: `synthetic-${syntheticId()}`,
            audience: "dogfood-saved-design",
            operation: "bind-order-person",
            verifiedAt: new Date().toISOString(),
            givenName: "Chart",
            familyName: "Label",
        };
        await expect(
            establish({
                orderId: freshOrder,
                personId: `synthetic-${syntheticId()}`,
                verifier: {
                    async verify() {
                        return untrusted;
                    },
                },
            }),
        ).rejects.toMatchObject({ code: "verifier_untrusted" });
        expect(await counts()).toEqual(before);
        expect(
            await prisma.integrationDesign.findFirst({ where: { externalOrderId: freshOrder } }),
        ).toBeNull();
        expect(
            await prisma.integrationDesign.findFirst({
                where: { externalOrderId: keptLink.externalOrderId },
            }),
        ).toMatchObject({ clientId: kept.client_id, designId: kept.design_id, shoeWidth: "wide" });
        expect(
            await prisma.integrationDesign.findFirst({
                where: { externalOrderId: otherLink.externalOrderId },
            }),
        ).toMatchObject({ clientId: other.client_id, shoeWidth: "narrow" });
    });
});

function refreshSnapshot(designId: string) {
    return {
        ok: true as const,
        design_id: designId,
        ignored_fields: [],
        unmapped_fields: [],
        paths: [],
        settingsJson: {},
        template: "SAMPLE_Top" as const,
        scans_used: false as const,
        shoe_width: "medium",
        shoe_width_source: "defaulted" as const,
        hardness: "Hard" as const,
        hardness_source: "prescribed" as const,
    };
}
