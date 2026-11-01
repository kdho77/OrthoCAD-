// Apply the client-list migration to a local, dev, or explicitly marked preview database.
// Refuses production. The Founder approves production migrations separately.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? "";
if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
}
if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    console.error("Refusing to apply the client-list migration in production.");
    process.exit(1);
}

let host = "";
try {
    host = new URL(url).hostname;
} catch {
    console.error("DATABASE_URL is not a valid URL.");
    process.exit(1);
}

const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
const previewOk = process.env.ALLOW_PREVIEW_MIGRATION === "1";
if (!local && !previewOk) {
    console.error(
        `Refusing to migrate ${host}. Use a local database, or set ALLOW_PREVIEW_MIGRATION=1 for a non-production preview database.`,
    );
    process.exit(1);
}

const files = [
    "../prisma/migrations/20261101120000_client_list_workflow/migration.sql",
    "../prisma/migrations/20261101143000_phi_minimal_client/migration.sql",
];
for (const relative of files) {
    const file = fileURLToPath(new URL(relative, import.meta.url));
    const result = spawnSync(
        "npx",
        ["prisma", "db", "execute", "--file", file, "--schema", "prisma/schema.prisma"],
        { stdio: "inherit", env: process.env },
    );
    if (result.status) process.exit(result.status);
}
