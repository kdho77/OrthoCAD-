// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Issue one server-to-server credential for an existing tenant allowlist.
// The API key and webhook secret are printed once to stdout. They are stored
// hashed / encrypted. Do not commit them, log them, or put them in a browser.
//
//   INTEGRATION_SECRET_KEY="$(openssl rand -base64 32)" \
//   npx tsx server/src/auth/issue-integration-key.ts \
//     --label "VO2 staging" \
//     --tenant <tenant-uuid> \
//     [--tenant <another-tenant-uuid>] \
//     [--webhook-url https://example.com/hooks/orthocad]
//
// Omit --webhook-url when the caller does not want design.exported.
// INTEGRATION_SECRET_KEY is required only when --webhook-url is set.
// This script refuses unknown tenants and never inserts a tenant row.

import { issueIntegrationCredential } from "./integration-keys.js";

function values(flag: string): string[] {
    const argv = process.argv.slice(2);
    const found: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] !== flag) continue;
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) throw new Error(`${flag} needs a value`);
        found.push(next);
        i += 1;
    }
    return found;
}

function isDirectRun(): boolean {
    const entry = process.argv[1] ?? "";
    return entry.endsWith("issue-integration-key.ts") || entry.endsWith("issue-integration-key.js");
}

async function main(): Promise<void> {
    const label = values("--label")[0];
    const tenantIds = values("--tenant");
    const webhookUrl = values("--webhook-url")[0] ?? null;
    if (!label) throw new Error("--label is required");
    if (tenantIds.length === 0) throw new Error("--tenant is required");
    const { createPrismaIntegrationStore } = await import("../routers/integrations/prisma-store.js");
    const issued = await issueIntegrationCredential(createPrismaIntegrationStore(), {
        label,
        tenantIds,
        webhookUrl,
        secretKey: process.env.INTEGRATION_SECRET_KEY ?? null,
    });
    process.stdout.write(`credential_id=${issued.credentialId}\n`);
    process.stdout.write(`api_key=${issued.apiKey}\n`);
    if (issued.webhookSecret) process.stdout.write(`webhook_secret=${issued.webhookSecret}\n`);
    process.stderr.write(
        "Shown once. Store the key in the caller's secret manager. Do not commit it or send it to a browser.\n",
    );
}

if (isDirectRun()) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Could not issue a credential";
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
    });
}
