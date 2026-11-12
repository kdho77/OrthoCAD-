// Regenerates vertex/tests/fixtures/regional-hardness/* from the Export G-code loft.
// Run from the repo root: node vertex/scripts/regenerate-regional-hardness-fixtures.mjs

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const result = spawnSync(
    "npx",
    ["rstest", "run", "vertex/src/features/exports/regional-hardness-fixtures.test.ts"],
    {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, REGENERATE_REGIONAL_FIXTURES: "1" },
    },
);
process.exit(result.status ?? 1);
