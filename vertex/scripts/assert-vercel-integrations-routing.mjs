// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Guardrail: VO2 integration URLs are multi-segment (/api/integrations/v1/...).
 * Vercel filesystem routes in non-Next apps do not invoke catch-alls for those paths;
 * we must rewrite to api/integrations/index.ts instead of api/integrations/[[...path]].ts.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const vertexRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vercelPath = join(vertexRoot, "vercel.json");
const entryPath = join(vertexRoot, "api/integrations/index.ts");
const legacyCatchAll = join(vertexRoot, "api/integrations/[[...path]].ts");

const config = JSON.parse(readFileSync(vercelPath, "utf8"));
const rewrites = config.rewrites ?? [];

const integrationRewrite = rewrites.find(
    (r) => r.source === "/api/integrations/:path*" && r.destination === "/api/integrations",
);

if (!integrationRewrite) {
    console.error(
        "vercel-integrations-routing: missing rewrite /api/integrations/:path* → /api/integrations",
    );
    process.exit(1);
}

if (!existsSync(entryPath)) {
    console.error("vercel-integrations-routing: expected api/integrations/index.ts");
    process.exit(1);
}

if (existsSync(legacyCatchAll)) {
    console.error(
        "vercel-integrations-routing: remove api/integrations/[[...path]].ts (multi-segment paths NOT_FOUND on Vercel)",
    );
    process.exit(1);
}

console.log("vercel-integrations-routing: ok");
