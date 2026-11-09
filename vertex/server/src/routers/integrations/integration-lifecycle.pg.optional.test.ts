// Synthetic integration lifecycle against disposable local Postgres.
// The handler, Prisma store, and shoe-width checks are the product code.
// This file does not call export, storage, or any host except 127.0.0.1.

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import {
    assertDisposableUrl,
    assertIsolatedAcceptanceEnv,
} from "../../../../../scripts/ci/isolated-postgres-acceptance.mjs";
import { assertDogfoodNotHeld } from "../../../../shared/dogfood-holds.js";
import { DOGFOOD_TENANT_ID } from "../../auth/cad-operator.js";
import { issueIntegrationCredential, redactSecrets } from "../../auth/integration-keys.js";
import { createIntegrationHandler } from "./http.js";

const MIGRATION = "vertex/prisma/migrations/20261104120000_integration_launch_connector/migration.sql";
const OWNER_ID = "abababab-abab-4aba-8aba-abababababab";
const CASES_PATH = "/tmp/orthocad-lifecycle-cases.json";
const LOCAL_UPLOAD = "http://127.0.0.1:9/local-upload-unused";

type Json = Record<string, unknown>;

const passed: string[] = [];

function syntheticId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const id = randomUUID();
        try {
            assertDogfoodNotHeld(id);
            return id;
        } catch {
            // Draw another local id. The held list is not recorded.
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
    for (const key of [
        "DATABASE_URL",
        "DIRECT_URL",
        "POSTGRES_URL",
        "POSTGRES_PRISMA_URL",
        "POSTGRES_URL_NON_POOLING",
        "POSTGRES_HOST",
        "POSTGRES_PASSWORD",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "VITE_SUPABASE_URL",
        "VITE_SUPABASE_ANON_KEY",
    ]) {
        delete env[key];
    }
    env.DATABASE_URL = url;
    env.DIRECT_URL = url;
    execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
        cwd: "vertex",
        env,
        stdio: "inherit",
    });
}

function fail(label: string, status: number, body: Json): never {
    const redacted = redactSecrets(JSON.stringify(body)).replace(/sig=[^&"\s]+/g, "sig=[redacted]");
    throw new Error(`${label} failed status=${status} body=${redacted}`);
}

function assertLoopbackUploads(body: Json): void {
    const urls = body.upload_urls;
    if (!urls || typeof urls !== "object" || Array.isArray(urls)) throw new Error("upload urls missing");
    for (const value of Object.values(urls)) {
        if (typeof value !== "string") throw new Error("upload url was not a string");
        const host = new URL(value).hostname;
        if (host !== "127.0.0.1") throw new Error(`upload host refused: ${host}`);
    }
}

let prisma: PrismaClient;
let databaseUrl = "";
let server: Server;
let port = 0;
let apiKey = "";
let externalClientId = "";
let narrowClientId = "";
let externalOrderId = "";
let clientId = "";
let designId = "";

async function api(
    method: string,
    path: string,
    body?: Json,
    auth = true,
): Promise<{ status: number; body: Json }> {
    const target = new URL(`http://127.0.0.1:${port}${path}`);
    if (target.hostname !== "127.0.0.1") throw new Error("refusing a non-local lifecycle request");
    const headers = new Headers({ "content-type": "application/json" });
    if (auth) headers.set("authorization", `Bearer ${apiKey}`);
    const response = await fetch(target, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed: unknown = text.trim() ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("response was not an object");
    return { status: response.status, body: parsed as Json };
}

function clientBody(externalId: string, lastName: string, width?: string): Json {
    return {
        source: "vo2",
        external_client_id: externalId,
        tenant_id: DOGFOOD_TENANT_ID,
        first_name: "Synth",
        last_name: lastName,
        shoe_size: { system: "US_M", size: 10 },
        ...(width ? { width } : {}),
    };
}

describe("isolated integration lifecycle", () => {
    beforeAll(async () => {
        const url = assertIsolatedAcceptanceEnv(process.env);
        databaseUrl = url;
        const parsed = new URL(url);
        if (parsed.hostname !== "127.0.0.1") throw new Error("lifecycle postgres must be loopback");
        prisma = new PrismaClient({ datasourceUrl: url });
        const ready = await prisma.$queryRaw<Array<{ ok: string | null }>>`
            SELECT to_regclass('public.integration_designs')::text AS ok
        `;
        if (!ready[0]?.ok) pushSchema(url);
        const sql = readFileSync(MIGRATION, "utf8");
        for (const [table, name] of [
            ["integration_clients", "integration_clients_shoeWidth_check"],
            ["integration_designs", "integration_designs_shoeWidth_check"],
        ] as const) {
            const expression = checkExpression(sql, name);
            await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`);
            await prisma.$executeRawUnsafe(
                `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK ${expression}`,
            );
        }
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
        process.env.DATABASE_URL = url;
        process.env.DIRECT_URL = url;
        const { createPrismaIntegrationStore } = await import("./prisma-store.js");
        const store = createPrismaIntegrationStore(prisma);
        const issued = await issueIntegrationCredential(store, {
            label: "synthetic-lifecycle",
            tenantIds: [DOGFOOD_TENANT_ID],
        });
        apiKey = issued.apiKey;
        const handler = createIntegrationHandler({
            store,
            now: () => new Date(),
            uploadSigningKey: randomBytes(32).toString("hex"),
            uploadBaseUrl: LOCAL_UPLOAD,
            appOrigin: "http://127.0.0.1:5180",
        });
        server = createServer(async (req, res) => {
            const remote = req.socket.remoteAddress ?? "";
            if (remote !== "127.0.0.1" && remote !== "::ffff:127.0.0.1") {
                res.statusCode = 403;
                res.end(JSON.stringify({ error: "local only" }));
                return;
            }
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            const raw = Buffer.concat(chunks);
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
                if (value === undefined) continue;
                headers.set(key, Array.isArray(value) ? value.join(", ") : value);
            }
            const request = new Request(`http://127.0.0.1${req.url ?? "/"}`, {
                method: req.method,
                headers,
                body: req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(raw),
            });
            const response = await handler(request);
            res.statusCode = response.status;
            res.setHeader("content-type", response.headers.get("content-type") ?? "application/json");
            res.end(Buffer.from(await response.arrayBuffer()));
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        const address = server.address();
        if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
            throw new Error("lifecycle API did not bind to 127.0.0.1");
        }
        port = address.port;
        externalClientId = `synthetic-${syntheticId()}`;
        narrowClientId = `synthetic-${syntheticId()}`;
        externalOrderId = syntheticId();
    });

    afterAll(async () => {
        writeFileSync(
            CASES_PATH,
            JSON.stringify(
                {
                    origin: "127.0.0.1",
                    port,
                    uploadRequested: false,
                    exportAuthorizationCalled: false,
                    passed,
                    failed: 0,
                },
                null,
                2,
            ),
        );
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        await prisma?.$disconnect();
    });

    test("the harness refuses a non-local url before connecting", () => {
        expect(() =>
            assertDisposableUrl("postgresql://orthocad_test@db.example.supabase.co/orthocad_width"),
        ).toThrow(/localhost/);
        passed.push("refuses a non-local url");
    });

    test("create, edit, save, and read back through the local integration API", async () => {
        const denied = await api(
            "POST",
            "/api/integrations/v1/clients/upsert",
            clientBody(externalClientId, "Create", "medium"),
            false,
        );
        if (denied.status !== 401) fail("unauthenticated create", denied.status, denied.body);
        expect(await prisma.integrationClient.findFirst({ where: { externalClientId } })).toBeNull();
        passed.push("unauthenticated create writes nothing");

        const created = await api(
            "POST",
            "/api/integrations/v1/clients/upsert",
            clientBody(externalClientId, "Create", "medium"),
        );
        if (created.status !== 200 || typeof created.body.client_id !== "string")
            fail("create client", created.status, created.body);
        clientId = created.body.client_id;
        const createdRow = await prisma.integrationClient.findFirstOrThrow({
            where: { externalClientId },
            include: { client: true },
        });
        expect(createdRow.clientId).toBe(clientId);
        expect(createdRow.shoeWidth).toBe("medium");
        expect(createdRow.client.shoeWidth).toBe("medium");
        expect(createdRow.client.displayName).toBe("Synth Create");
        passed.push("create client persists medium");

        const edited = await api(
            "POST",
            "/api/integrations/v1/clients/upsert",
            clientBody(externalClientId, "Edited", "wide"),
        );
        if (edited.status !== 200 || edited.body.client_id !== clientId)
            fail("edit client", edited.status, edited.body);
        const editedRow = await prisma.integrationClient.findFirstOrThrow({
            where: { externalClientId },
            include: { client: true },
        });
        expect(editedRow.clientId).toBe(clientId);
        expect(editedRow.shoeWidth).toBe("wide");
        expect(editedRow.shoeSizeMismatch).toBe(true);
        expect(editedRow.client.shoeWidth).toBe("medium");
        expect(editedRow.client.displayName).toBe("Synth Edited");
        passed.push("edit upsert persists wide on the order link and keeps the declared chart width");

        for (const width of ["extra_narrow", "extra_wide"]) {
            const rejected = await api(
                "POST",
                "/api/integrations/v1/clients/upsert",
                clientBody(externalClientId, "Edited", width),
            );
            if (rejected.status !== 422) fail(`${width} rejection`, rejected.status, rejected.body);
            const unchanged = await prisma.integrationClient.findFirstOrThrow({
                where: { externalClientId },
                include: { client: true },
            });
            expect(unchanged.shoeWidth).toBe("wide");
            expect(unchanged.client.shoeWidth).toBe("medium");
            expect(unchanged.client.displayName).toBe("Synth Edited");
            passed.push(`${width} is rejected and writes nothing`);
        }

        const narrow = await api(
            "POST",
            "/api/integrations/v1/clients/upsert",
            clientBody(narrowClientId, "Narrow", "narrow"),
        );
        if (narrow.status !== 200) fail("narrow create", narrow.status, narrow.body);
        const narrowRow = await prisma.integrationClient.findFirstOrThrow({
            where: { externalClientId: narrowClientId },
            include: { client: true },
        });
        expect(narrowRow.shoeWidth).toBe("narrow");
        expect(narrowRow.client.shoeWidth).toBe("narrow");
        passed.push("accepted narrow persists on chart and link");

        const design = await api("POST", "/api/integrations/v1/designs", {
            source: "vo2",
            tenant_id: DOGFOOD_TENANT_ID,
            client_id: clientId,
            external_order_id: externalOrderId,
            type: "insole",
            sides: "left",
            notes: "lifecycle-note-1",
            width: "medium",
            shoe_size: { system: "US_M", size: 10 },
            scans: [{ side: "left", format: "stl" }],
        });
        if (design.status !== 200 || typeof design.body.design_id !== "string")
            fail("create design", design.status, design.body);
        assertLoopbackUploads(design.body);
        designId = design.body.design_id;
        const designRow = await prisma.integrationDesign.findFirstOrThrow({
            where: { externalOrderId },
            include: { design: true },
        });
        expect(designRow.designId).toBe(designId);
        expect(designRow.notes).toBe("lifecycle-note-1");
        expect(designRow.design.notes).toBe("lifecycle-note-1");
        expect(designRow.shoeWidth).toBe("medium");
        passed.push("create design persists notes and medium");

        const repeat = await api("POST", "/api/integrations/v1/designs", {
            source: "vo2",
            tenant_id: DOGFOOD_TENANT_ID,
            client_id: clientId,
            external_order_id: externalOrderId,
            type: "insole",
            sides: "left",
            notes: "lifecycle-note-2",
            width: "wide",
            shoe_size: { system: "US_M", size: 10 },
            scans: [{ side: "left", format: "stl" }],
        });
        if (repeat.status !== 200 || repeat.body.design_id !== designId)
            fail("repeat design", repeat.status, repeat.body);
        assertLoopbackUploads(repeat.body);
        const repeatRow = await prisma.integrationDesign.findFirstOrThrow({
            where: { externalOrderId },
            include: { design: true },
        });
        expect(repeatRow.notes).toBe("lifecycle-note-1");
        expect(repeatRow.design.notes).toBe("lifecycle-note-1");
        expect(repeatRow.shoeWidth).toBe("medium");
        passed.push("repeat create does not edit notes or width");

        const patched = await api("PATCH", `/api/integrations/v1/designs/${designId}`, {
            notes: "lifecycle-note-2",
        });
        if (patched.status !== 405) fail("patch design", patched.status, patched.body);
        passed.push("design PATCH is not an edit endpoint");

        const saved = await api("POST", `/api/integrations/v1/designs/${designId}/scans/complete`, {
            scans: [{ side: "left", file_name: "synthetic-left.stl", format: "stl", size_bytes: 128 }],
        });
        if (saved.status !== 200 || saved.body.completed !== 1)
            fail("complete scan", saved.status, saved.body);
        const upload = await prisma.integrationScanUpload.findFirstOrThrow({
            where: { design: { designId }, completedAt: { not: null } },
        });
        expect(upload.fileName).toBe("synthetic-left.stl");
        expect(upload.sizeBytes).toBe(128);
        expect(await prisma.scan.count({ where: { designId } })).toBe(1);
        passed.push("scan completion persists metadata and is not an upload");

        const readBack = await api("GET", `/api/integrations/v1/designs/${designId}`);
        if (readBack.status !== 200) fail("read design", readBack.status, readBack.body);
        expect(readBack.body.design_id).toBe(designId);
        expect(readBack.body.client_id).toBe(clientId);
        expect(readBack.body.external_order_id).toBe(externalOrderId);
        expect(readBack.body.notes).toBeUndefined();
        expect(readBack.body.first_name).toBeUndefined();
        const listed = await api(
            "GET",
            `/api/integrations/v1/designs?source=vo2&tenant_id=${DOGFOOD_TENANT_ID}&external_order_id=${externalOrderId}`,
        );
        if (listed.status !== 200 || !Array.isArray(listed.body.designs))
            fail("list designs", listed.status, listed.body);
        expect(listed.body.designs).toHaveLength(1);
        passed.push("HTTP readback returns the public design and omits notes");

        const again = new PrismaClient({ datasourceUrl: databaseUrl });
        try {
            const reread = await again.integrationDesign.findFirstOrThrow({
                where: { externalOrderId },
                include: { design: { include: { client: true } } },
            });
            expect(reread.designId).toBe(designId);
            expect(reread.design.notes).toBe("lifecycle-note-1");
            expect(reread.design.client.displayName).toBe("Synth Edited");
            expect(reread.design.client.shoeWidth).toBe("medium");
            expect(reread.shoeWidth).toBe("medium");
            expect(await again.export.count({ where: { designId } })).toBe(0);
        } finally {
            await again.$disconnect();
        }
        passed.push("reconnect readback matches and no export row exists");
    });
});
