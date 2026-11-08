#!/usr/bin/env node
/**
 * Synthetic integration lifecycle against the already-running disposable
 * Postgres cluster. This command does not start, stop, or delete that cluster
 * and it does not read an env file. The product server is not started.
 *
 *   ORTHOCAD_ISOLATED_PG_ACCEPTANCE=1 \
 *   ORTHOCAD_ISOLATED_PG_URL=postgresql://orthocad_test@127.0.0.1:54329/orthocad_width \
 *   node scripts/ci/isolated-integration-lifecycle.mjs
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertIsolatedAcceptanceEnv } from "./isolated-postgres-acceptance.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const REPORT_PATH = "/tmp/orthocad-isolated-lifecycle-report.json";
const CASES_PATH = "/tmp/orthocad-lifecycle-cases.json";

const BLOCKED_ENV = [
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
    "VITE_API_URL",
];

function run() {
    const url = assertIsolatedAcceptanceEnv({
        ...process.env,
        ORTHOCAD_ISOLATED_PG_ACCEPTANCE: process.env.ORTHOCAD_ISOLATED_PG_ACCEPTANCE,
        ORTHOCAD_ISOLATED_PG_URL: process.env.ORTHOCAD_ISOLATED_PG_URL,
    });
    const env = { ...process.env };
    for (const key of BLOCKED_ENV) delete env[key];
    env.ORTHOCAD_ISOLATED_PG_ACCEPTANCE = "1";
    env.ORTHOCAD_ISOLATED_PG_URL = url;
    const result = spawnSync("npx", ["rstest", "run", "--config", "rstest.isolated-lifecycle.config.ts"], {
        cwd: ROOT,
        encoding: "utf8",
        env,
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (result.error) {
        console.error(result.error.message);
        process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status ?? 1);
    if (!existsSync(REPORT_PATH) || !existsSync(CASES_PATH)) {
        console.error("lifecycle run did not write both result files. Refusing to pass.");
        process.exit(1);
    }
    const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
    const cases = JSON.parse(readFileSync(CASES_PATH, "utf8"));
    const passed = Array.isArray(cases.passed) ? cases.passed.length : 0;
    if (
        report.status !== "pass" ||
        report.summary?.failedTests !== 0 ||
        cases.failed !== 0 ||
        passed !== 13
    ) {
        console.error(`lifecycle summary rejected: status=${report.status} passed=${passed}`);
        process.exit(1);
    }
    console.log(`lifecycle_cases ${passed}`);
    console.log(`lifecycle_report ${REPORT_PATH}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        run();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
