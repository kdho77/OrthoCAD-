#!/usr/bin/env node
/**
 * Explicit isolated PostgreSQL acceptance.
 *
 * Default `npm test` and the unit shards exclude `*.optional.test.ts`. That
 * skip does not connect anywhere. This command is the required acceptance
 * gate. It fails if it is not selected, the disposable URL is missing or
 * unsafe, a production-style URL is present, or any required case is absent.
 *
 * Disposable local cluster (no live credentials):
 *   node scripts/ci/isolated-postgres-acceptance.mjs setup
 *   node scripts/ci/isolated-postgres-acceptance.mjs run
 *   node scripts/ci/isolated-postgres-acceptance.mjs teardown
 *
 * setup writes only /tmp/orthocad-pg-width. teardown stops that cluster and
 * removes that directory. It does not read or delete user or production data.
 *
 * CI starts a synthetic postgres:16 service and calls `run` with
 * ORTHOCAD_ISOLATED_PG_ACCEPTANCE=1 and ORTHOCAD_ISOLATED_PG_URL.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const DATA_DIR = "/tmp/orthocad-pg-width";
const PORT = "54329";
const DATABASE = "orthocad_width";
const USER = "orthocad_test";
const SYNTHETIC_PASSWORD = "orthocad_test";
const LOCAL_URL = `postgresql://${USER}@127.0.0.1:${PORT}/${DATABASE}`;
export const ACCEPTANCE_REPORT_PATH = "/tmp/orthocad-isolated-pg-report.json";

const BLOCKED_ENV = [
    "DATABASE_URL",
    "DIRECT_URL",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
    "SUPABASE_URL",
    "VITE_SUPABASE_URL",
];

export const REQUIRED_CASES = [
    "the harness refuses a non-local url before connecting",
    "the migration shoe-width checks are present on both link tables",
    "an omitted width stores medium and keeps defaulted snapshot provenance",
    "prescribed narrow, medium, and wide are stored as prescribed",
    "extra and invalid widths are rejected before a transaction and write nothing",
    "the human client table still accepts extra_wide",
    "a last-insert shoe-width check rolls back all four rows",
    "the establishment transaction rolls back when the last insert violates the check",
    "parallel first-time calls keep one client, one design, and medium",
    "a mismatch and an untrusted proof write nothing",
];

export function assertDisposableUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(
            "UNEXECUTED isolated PostgreSQL: ORTHOCAD_ISOLATED_PG_URL is missing or unusable. Refusing to skip.",
        );
    }
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
        throw new Error("isolated postgres url must use the postgresql protocol");
    }
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
        throw new Error("isolated postgres must listen on localhost");
    }
    if (parsed.username !== USER) throw new Error("isolated postgres user must be orthocad_test");
    if (parsed.password && parsed.password !== SYNTHETIC_PASSWORD) {
        throw new Error("isolated postgres url must not carry a live or non-synthetic password");
    }
    if (parsed.pathname !== `/${DATABASE}`) {
        throw new Error("isolated postgres database must be the disposable orthocad_width database");
    }
    const lowered = url.toLowerCase();
    for (const banned of ["supabase", "amazonaws", "neon.tech", "render.com", "pooler"]) {
        if (lowered.includes(banned)) throw new Error("refusing a non-disposable postgres host");
    }
    return url;
}

export function assertAcceptanceSummary(report, requiredCases = REQUIRED_CASES) {
    const summary = report?.summary;
    if (report?.tool !== "rstest" || !summary || !Array.isArray(report.tests)) {
        throw new Error("isolated acceptance did not emit an rstest JSON summary. Refusing to pass.");
    }
    const problems = [];
    if (report.status !== "pass") problems.push(`status ${report.status}`);
    if (summary.passedTests !== requiredCases.length) problems.push(`passedTests ${summary.passedTests}`);
    if (summary.failedTests !== 0) problems.push(`failedTests ${summary.failedTests}`);
    if (summary.skippedTests !== 0) problems.push(`skippedTests ${summary.skippedTests}`);
    if (summary.todoTests !== 0) problems.push(`todoTests ${summary.todoTests}`);
    if (summary.tests !== requiredCases.length) problems.push(`tests ${summary.tests}`);
    const passedNames = report.tests
        .filter((test) => test.status === "pass")
        .map((test) => String(test.fullName ?? ""));
    const missing = requiredCases.filter((name) => !passedNames.some((fullName) => fullName.includes(name)));
    if (missing.length > 0) {
        const sample = report.tests[0] ? Object.keys(report.tests[0]).join(",") : "none";
        problems.push(`missing passed cases: ${missing.join("; ")} (test fields ${sample})`);
    }
    const skippedOrFailed = report.tests.filter((test) => test.status !== "pass");
    if (skippedOrFailed.length > 0) {
        problems.push(`non-pass results: ${skippedOrFailed.map((test) => test.status).join(", ")}`);
    }
    if (problems.length > 0) {
        throw new Error(`isolated acceptance summary rejected: ${problems.join("; ")}. Refusing to pass.`);
    }
}

export function assertIsolatedAcceptanceEnv(env) {
    if (env.ORTHOCAD_ISOLATED_PG_ACCEPTANCE !== "1") {
        throw new Error(
            "explicit isolated postgres acceptance was not selected (ORTHOCAD_ISOLATED_PG_ACCEPTANCE=1). Refusing to skip.",
        );
    }
    const url = typeof env.ORTHOCAD_ISOLATED_PG_URL === "string" ? env.ORTHOCAD_ISOLATED_PG_URL.trim() : "";
    if (!url) {
        throw new Error("ORTHOCAD_ISOLATED_PG_URL is missing. Refusing to skip.");
    }
    for (const key of BLOCKED_ENV) {
        if (typeof env[key] === "string" && env[key].trim()) {
            throw new Error(
                `${key} is set. Isolated acceptance refuses every database URL except ORTHOCAD_ISOLATED_PG_URL.`,
            );
        }
    }
    return assertDisposableUrl(url);
}

function pgBin() {
    for (const dir of ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/17/bin"]) {
        if (existsSync(resolve(dir, "initdb"))) return dir;
    }
    throw new Error(
        "PostgreSQL binaries not found. Use the CI postgres service or install postgresql locally. Refusing to skip.",
    );
}

function assertDisposableDataDir(dir) {
    if (dir !== DATA_DIR) throw new Error(`refusing to touch ${dir}`);
}

function setup() {
    assertDisposableDataDir(DATA_DIR);
    const bin = pgBin();
    if (existsSync(resolve(DATA_DIR, "postmaster.pid"))) {
        spawnSync(resolve(bin, "pg_ctl"), ["-D", DATA_DIR, "stop", "-m", "fast"], { stdio: "inherit" });
    }
    rmSync(DATA_DIR, { recursive: true, force: true });
    execFileSync(
        resolve(bin, "initdb"),
        ["-D", DATA_DIR, `--username=${USER}`, "--auth=trust", "--no-instructions"],
        {
            stdio: "inherit",
        },
    );
    execFileSync(
        resolve(bin, "pg_ctl"),
        [
            "-D",
            DATA_DIR,
            "-l",
            `${DATA_DIR}.log`,
            "-o",
            `-p ${PORT} -k ${DATA_DIR} -c listen_addresses=127.0.0.1`,
            "start",
        ],
        { stdio: "inherit" },
    );
    execFileSync(resolve(bin, "createdb"), ["-h", "127.0.0.1", "-p", PORT, "-U", USER, DATABASE], {
        stdio: "inherit",
    });
    const version = execFileSync(
        resolve(bin, "psql"),
        ["-h", "127.0.0.1", "-p", PORT, "-U", USER, "-d", DATABASE, "-At", "-c", "SELECT version()"],
        { encoding: "utf8" },
    ).trim();
    console.log(`isolated_postgres_version ${version}`);
    console.log(`ORTHOCAD_ISOLATED_PG_URL=${LOCAL_URL}`);
    console.log("next: node scripts/ci/isolated-postgres-acceptance.mjs run");
}

function teardown() {
    assertDisposableDataDir(DATA_DIR);
    const bin = pgBin();
    if (existsSync(DATA_DIR)) {
        spawnSync(resolve(bin, "pg_ctl"), ["-D", DATA_DIR, "stop", "-m", "fast"], { stdio: "inherit" });
        rmSync(DATA_DIR, { recursive: true, force: true });
    }
    rmSync(`${DATA_DIR}.log`, { force: true });
    console.log(`removed disposable cluster ${DATA_DIR}`);
}

function printVersion(url) {
    const result = spawnSync(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasourceUrl: process.env.ORTHOCAD_ISOLATED_PG_URL });
const rows = await prisma.$queryRawUnsafe("SELECT version() AS version");
console.log("isolated_postgres_version " + (rows[0]?.version ?? ""));
await prisma.$disconnect();`,
        ],
        {
            cwd: resolve(ROOT, "vertex"),
            env: { ...process.env, ORTHOCAD_ISOLATED_PG_URL: url },
            encoding: "utf8",
        },
    );
    process.stdout.write(result.stdout ?? "");
    if (result.status !== 0) {
        process.stderr.write(result.stderr ?? "");
        console.error("could not read the disposable postgres version. Refusing to skip.");
        process.exit(1);
    }
}

function run() {
    const url = assertIsolatedAcceptanceEnv({
        ...process.env,
        ORTHOCAD_ISOLATED_PG_ACCEPTANCE: process.env.ORTHOCAD_ISOLATED_PG_ACCEPTANCE,
        ORTHOCAD_ISOLATED_PG_URL: process.env.ORTHOCAD_ISOLATED_PG_URL,
    });
    printVersion(url);
    rmSync(ACCEPTANCE_REPORT_PATH, { force: true });
    const env = { ...process.env };
    for (const key of BLOCKED_ENV) delete env[key];
    env.ORTHOCAD_ISOLATED_PG_ACCEPTANCE = "1";
    env.ORTHOCAD_ISOLATED_PG_URL = url;
    const result = spawnSync("npx", ["rstest", "run", "--config", "rstest.isolated-pg.config.ts"], {
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
    if (!existsSync(ACCEPTANCE_REPORT_PATH)) {
        console.error("isolated acceptance did not write the rstest JSON summary. Refusing to pass.");
        process.exit(1);
    }
    let report;
    try {
        report = JSON.parse(readFileSync(ACCEPTANCE_REPORT_PATH, "utf8"));
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        console.error("isolated acceptance JSON summary was not readable. Refusing to pass.");
        process.exit(1);
    }
    try {
        assertAcceptanceSummary(report);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    } finally {
        rmSync(ACCEPTANCE_REPORT_PATH, { force: true });
    }
}

function main() {
    const command = process.argv[2] ?? "run";
    if (command === "setup") return setup();
    if (command === "teardown") return teardown();
    if (command === "run") return run();
    console.error("Usage: node scripts/ci/isolated-postgres-acceptance.mjs <setup|run|teardown>");
    process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
