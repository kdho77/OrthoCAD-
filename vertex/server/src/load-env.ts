// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

// tsx does not auto-load .env files; import this module before context.ts so Prisma
// sees DATABASE_URL at module init. Also used by npm run db:push (server/src/prisma-cli.ts).
// Vercel/Render inject env at runtime — dotenv never overrides existing variables, and a
// missing dotenv package is ignored in production.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const vertexRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

try {
    const { config } = await import("dotenv");
    config({ path: resolve(vertexRoot, ".env") });
} catch {
    // dotenv is a devDependency; production builds that omit it rely on injected env.
}
