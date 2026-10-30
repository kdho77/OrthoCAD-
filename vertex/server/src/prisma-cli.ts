// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

// Load vertex/.env the same way as dev:server, then delegate to the Prisma CLI.
import "./load-env.js";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const vertexRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const prismaArgs = process.argv.slice(2);

if (prismaArgs.length === 0) {
    console.error("Usage: tsx server/src/prisma-cli.ts <prisma-command> [args...]");
    process.exit(1);
}

const result = spawnSync("npx", ["prisma", ...prismaArgs], {
    cwd: vertexRoot,
    stdio: "inherit",
    env: process.env,
});

process.exit(result.status ?? 1);
