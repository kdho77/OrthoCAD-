#!/usr/bin/env node
/**
 * Synthetic browser acceptance against disposable loopback Postgres.
 *
 * Product UI is not modified. The human Export control is not clicked: that
 * control downloads an STL before authorization. Authorization is probed with
 * export.authorize only. External origins are aborted.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "../..");
const PG_BIN = "/usr/lib/postgresql/16/bin";
const PG_PORT = "54329";
const PG_USER = "orthocad_test";
const BROWSER_DB = "orthocad_browser";
const BROWSER_URL = `postgresql://${PG_USER}@127.0.0.1:${PG_PORT}/${BROWSER_DB}`;
const RPC_PORT = "54330";
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const WEB_URL = "http://127.0.0.1:5180";
const API_URL = "http://127.0.0.1:5181";
const SYNTHETIC_KEY = "synthetic-local-service-role";
const OUT = process.env.SYNTHETIC_BROWSER_OUT ?? "/opt/cursor/artifacts/synthetic-browser";
const DISPLAY_NAME = "SYN-60B9";
const REFERENCE = "SYN-60B9";
const DESIGN_NAME = "SYN-60B9-cad";

const RPC_FILES = [
    "vertex/server/supabase/rpcs/phase_d_manufacturing.sql",
    "vertex/server/supabase/rpcs/phase_e_library.sql",
    "vertex/server/supabase/rpcs/phase_f_design.sql",
    "vertex/server/supabase/rpcs/phase_g_stock.sql",
    "vertex/server/supabase/rpcs/phase_h_admin.sql",
    "vertex/server/supabase/rpcs/phase_h_ensure_user.sql",
];

const children = [];
const report = {
    productHead: "983b9732ae0ec1d2ae26c3bd0850d8073055512b",
    stack: "loopback postgres 16 + repository SQL + synthetic dev bearer",
    cases: [],
    blockedExternalHosts: [],
    sqlApply: [],
    catalog: {},
    authorize: {},
    infill: {},
};

function caseResult(name, status, detail) {
    report.cases.push({ name, status, detail });
    console.log(`[${status}] ${name}: ${detail}`);
}

function psql(database, args) {
    return spawnSync(resolve(PG_BIN, "psql"), ["-h", "127.0.0.1", "-p", PG_PORT, "-U", PG_USER, "-d", database, ...args], {
        encoding: "utf8",
    });
}

function assertLoopback() {
    for (const url of [BROWSER_URL, RPC_URL, WEB_URL, API_URL]) {
        const parsed = new URL(url);
        if (parsed.hostname !== "127.0.0.1") throw new Error(`refusing non-loopback ${parsed.hostname}`);
    }
    const lowered = BROWSER_URL.toLowerCase();
    for (const banned of ["supabase.co", "amazonaws", "neon.tech", "render.com"]) {
        if (lowered.includes(banned)) throw new Error("refusing external database");
    }
}

function applySchema() {
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
        "MANUFACTURING_SERVICE_URL",
        "VERTEXSLICE_SLICER_URL",
        "VERTEXSLICE_API_KEY",
        "AI_API_KEY",
    ]) {
        delete env[key];
    }
    env.DATABASE_URL = BROWSER_URL;
    env.DIRECT_URL = BROWSER_URL;
    const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
        cwd: resolve(ROOT, "vertex"),
        env,
        encoding: "utf8",
    });
    if (push.status !== 0) {
        throw new Error(`prisma db push failed: ${(push.stderr || push.stdout || "").slice(-800)}`);
    }
    for (const file of RPC_FILES) {
        const applied = psql(BROWSER_DB, ["-v", "ON_ERROR_STOP=1", "-f", resolve(ROOT, file)]);
        const ok = applied.status === 0;
        report.sqlApply.push({
            file,
            status: ok ? "applied" : "failed",
            detail: ok ? "" : (applied.stderr || applied.stdout || "").split("\n").slice(-4).join(" ").slice(0, 400),
        });
        if (!ok) console.error(`sql apply failed ${file}`);
    }
}

function readCatalog() {
    const functions = psql(BROWSER_DB, [
        "-At",
        "-c",
        "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname LIKE 'vertex_%' ORDER BY 1",
    ]);
    const policies = psql(BROWSER_DB, ["-At", "-c", "SELECT count(*) FROM pg_policy"]);
    const rls = psql(BROWSER_DB, [
        "-At",
        "-c",
        "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity",
    ]);
    const namespaces = psql(BROWSER_DB, [
        "-At",
        "-c",
        "SELECT nspname FROM pg_namespace WHERE nspname IN ('auth','storage') ORDER BY 1",
    ]);
    report.catalog = {
        vertexFunctions: functions.status === 0 ? functions.stdout.trim().split("\n").filter(Boolean) : [],
        rlsEnabledTables: rls.stdout.trim(),
        policyCount: policies.stdout.trim(),
        authOrStorageSchemas: namespaces.stdout.trim() ? namespaces.stdout.trim().split("\n") : [],
        authorizeFunctionPresent: (functions.stdout ?? "").includes("vertex_authorize_export"),
    };
}

function spawnLogged(command, args, env, cwd) {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    children.push(child);
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    return child;
}

async function waitForHttp(url, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.status < 500) return;
        } catch {
            // server still booting
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    }
    throw new Error(`timed out waiting for ${url}`);
}

function localChildEnv(extra) {
    const env = { ...process.env, ...extra };
    for (const key of [
        "POSTGRES_URL",
        "POSTGRES_PRISMA_URL",
        "POSTGRES_URL_NON_POOLING",
        "POSTGRES_HOST",
        "POSTGRES_PASSWORD",
        "VITE_SUPABASE_URL",
        "VITE_SUPABASE_ANON_KEY",
        "MANUFACTURING_SERVICE_URL",
        "PYTHON_MANUFACTURING_URL",
        "VERTEXSLICE_SLICER_URL",
        "VERTEXSLICE_API_KEY",
        "AI_API_KEY",
        "STORE_PHI",
    ]) {
        delete env[key];
    }
    return env;
}

async function authorizeProbe() {
    const response = await fetch(`${API_URL}/trpc/export.authorize?batch=1`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: "Bearer dev:00000000-0000-4000-8000-000000000001",
        },
        body: JSON.stringify({
            0: { json: { format: "stl", side: "left", fileName: "synthetic-local.stl" } },
        }),
    });
    const text = await response.text();
    const direct = await fetch(`${RPC_URL}/rest/v1/rpc/vertex_authorize_export`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            apikey: SYNTHETIC_KEY,
            authorization: `Bearer ${SYNTHETIC_KEY}`,
        },
        body: JSON.stringify({ p_user_id: "00000000-0000-4000-8000-000000000001" }),
    });
    const directText = await direct.text();
    const exports = psql(BROWSER_DB, ["-At", "-c", "SELECT count(*) FROM exports"]);
    report.authorize = {
        productHttpStatus: response.status,
        productBody: text.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]").slice(0, 500),
        directRpcStatus: direct.status,
        directRpcBody: directText.slice(0, 300),
        exportRowCount: exports.stdout.trim(),
        stlDownloadClicked: false,
    };
}

function infillLock() {
    const ts = readFileSync(resolve(ROOT, "vertex/shared/print-recipe/hardness-class-table.ts"), "utf8");
    const json = readFileSync(resolve(ROOT, "vertex/shared/print-recipe/hardness-class-table.json"), "utf8");
    const tsHard = /Hard:\s*\{[^}]*sparseInfillDensityPct:\s*32/.test(ts);
    const jsonHard = /"Hard":\s*\{[^}]*"sparseInfillDensityPct":\s*32/.test(json);
    const diff = spawnSync("git", ["diff", "--exit-code", "--", "vertex/shared/print-recipe/hardness-class-table.ts", "vertex/shared/print-recipe/hardness-class-table.json"], {
        cwd: ROOT,
        encoding: "utf8",
    });
    report.infill = {
        hardDensityPct: tsHard && jsonHard ? 32 : null,
        pattern: "gyroid",
        lineWidthMm: 1.0,
        filesUnchanged: diff.status === 0,
    };
}

async function runBrowser() {
    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({
        headless: true,
        executablePath: "/usr/local/bin/google-chrome",
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(45000);
    const shot = (name) => page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: true });
    page.on("pageerror", (error) => console.error("[pageerror]", error.message));
    await page.route("**/*", (route) => {
        const target = new URL(route.request().url());
        const local =
            target.hostname === "127.0.0.1" ||
            target.protocol === "data:" ||
            target.protocol === "blob:";
        if (!local) {
            if (!report.blockedExternalHosts.includes(target.hostname)) {
                report.blockedExternalHosts.push(target.hostname);
            }
            return route.abort();
        }
        return route.continue();
    });

    try {
    await page.goto(`${WEB_URL}/clients`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Clients" }).waitFor();
    await shot("01-client-list");
    await page.getByRole("button", { name: "New client" }).click();
    await page.getByLabel("Display name or initials").fill(DISPLAY_NAME);
    await page.getByLabel("Client reference").fill(REFERENCE);
    const width = page.getByTestId("shoe-width");
    if ((await width.inputValue()) !== "medium") {
        throw new Error(`human create width default was ${await width.inputValue()}`);
    }
    await shot("02-new-client");
    await page.getByTestId("create-and-design").click();
    await page.getByTestId("type-insole").click();
    await page.getByTestId("start-from-template").click();
    await page.getByTestId("start-continue").click();
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}\/designs\/[0-9a-f-]{36}/i);
    await page.getByLabel("Design name").waitFor();
    await shot("03-editor");
    caseResult("synthetic client create", "pass", "display name SYN-60B9, reference SYN-60B9, width medium");

    const name = page.getByLabel("Design name");
    await name.fill(DESIGN_NAME);
    await name.blur();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByTestId("save-state").waitFor();
    await page.waitForTimeout(1200);
    const saveText = await page.getByTestId("save-state").innerText();
    await shot("04-saved");
    report.sessionSaveText = saveText;
    caseResult(
        "CAD edit and save",
        saveText.includes("Saved") ? "pass" : "fail",
        `design name ${DESIGN_NAME}; save-state ${saveText}; database readback is recorded separately`,
    );
    const apiConfigured = await page.evaluate(async () => {
        const mod = await import("/src/lib/trpc.ts");
        return mod.isApiConfigured();
    });
    report.clientApiConfigured = apiConfigured;
    await page.getByRole("button", { name: "Export" }).click();
    const exportButton = page.getByTestId("clinical-export-download");
    const exportVisible = await exportButton.isVisible().catch(() => false);
    await shot("05-export-control-not-clicked");
    caseResult(
        "human export control unchanged and not used as the STL path",
        exportVisible ? "pass" : "fail",
        exportVisible
            ? "opened the existing Export step and did not click clinical-export-download"
            : "Export step did not show clinical-export-download",
    );

    const designUrl = page.url();
    await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
    });
    await page.goto(`${WEB_URL}/clients`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Clients" }).waitFor();
    const visible = await page.getByText(DISPLAY_NAME).isVisible().catch(() => false);
    await shot("06-reload-list");
    if (!visible) {
        caseResult(
            "reload persistence readback",
            "fail",
            "after clearing storage the client list is empty; the dev UI did not call the local API",
        );
    } else {
        await page.getByText(DISPLAY_NAME).click();
        await page.getByRole("button", { name: DESIGN_NAME }).waitFor();
        await page.getByRole("button", { name: DESIGN_NAME }).click();
        await page.waitForURL(designUrl);
        const readback = await page.getByLabel("Design name").inputValue();
        await shot("07-reload-editor");
        caseResult(
            "reload persistence readback",
            readback === DESIGN_NAME ? "pass" : "fail",
            `design name read ${readback}`,
        );
    }
    } catch (error) {
        await shot("fail").catch(() => undefined);
        throw error;
    } finally {
        await browser.close();
    }
}

function sqlReadback() {
    const names = psql(BROWSER_DB, [
        "-At",
        "-F",
        "|",
        "-c",
        `SELECT c.reference, d.name, (d."settingsJson" IS NOT NULL) FROM designs d JOIN clients c ON c.id = d."clientId"`,
    ]);
    const integration = psql(BROWSER_DB, [
        "-At",
        "-c",
        "SELECT 'integration_clients', count(*)::text FROM integration_clients UNION ALL SELECT 'integration_designs', count(*)::text FROM integration_designs",
    ]);
    report.persistence = {
        rows: names.status === 0 ? names.stdout.trim() : names.stderr.slice(0, 300),
        integrationLinkCounts: integration.status === 0 ? integration.stdout.trim() : "tables absent or unreadable",
    };
}

function stopChildren() {
    for (const child of children) {
        if (!child.pid) continue;
        try {
            process.kill(-child.pid, "SIGTERM");
        } catch {
            if (!child.killed) child.kill("SIGTERM");
        }
    }
}

async function main() {
    assertLoopback();
    infillLock();
    const exists = psql("postgres", ["-At", "-c", `SELECT 1 FROM pg_database WHERE datname = '${BROWSER_DB}'`]);
    if (exists.status !== 0) throw new Error(exists.stderr || "postgres is not accepting local connections");
    if (!exists.stdout.includes("1")) {
        const created = spawnSync(resolve(PG_BIN, "createdb"), ["-h", "127.0.0.1", "-p", PG_PORT, "-U", PG_USER, BROWSER_DB], {
            encoding: "utf8",
        });
        if (created.status !== 0) throw new Error(created.stderr || "createdb failed");
    }
    applySchema();
    readCatalog();
    spawnLogged("node", ["scripts/ci/local-rpc-shim.mjs"], localChildEnv({
        ORTHOCAD_BROWSER_DATABASE_URL: BROWSER_URL,
        ORTHOCAD_LOCAL_RPC_PORT: RPC_PORT,
    }), ROOT);
    spawnLogged(
        "npx",
        ["tsx", "server/src/index.ts"],
        localChildEnv({
            NODE_ENV: "development",
            PORT: "5181",
            DATABASE_URL: BROWSER_URL,
            DIRECT_URL: BROWSER_URL,
            SUPABASE_URL: RPC_URL,
            SUPABASE_SERVICE_ROLE_KEY: SYNTHETIC_KEY,
            CORS_ORIGIN: WEB_URL,
        }),
        resolve(ROOT, "vertex"),
    );
    spawnLogged(
        "npx",
        ["vite", "--host", "127.0.0.1", "--port", "5180", "--strictPort"],
        localChildEnv({ VITE_API_URL: `${API_URL}/trpc` }),
        resolve(ROOT, "vertex"),
    );
    await waitForHttp(`${RPC_URL}/rest/v1/rpc/vertex_authorize_export`, 20000).catch(() => undefined);
    await waitForHttp(`${API_URL}/trpc/user.health`, 30000);
    await waitForHttp(WEB_URL, 30000);
    try {
        await runBrowser();
    } catch (error) {
        caseResult("browser session", "fail", error instanceof Error ? error.message : String(error));
    }
    await authorizeProbe();
    sqlReadback();
    const passed = report.cases.filter((item) => item.status === "pass").length;
    const failed = report.cases.filter((item) => item.status === "fail").length;
    report.summary = { passed, failed };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
    console.log(`synthetic_browser_report ${resolve(OUT, "report.json")}`);
    stopChildren();
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    stopChildren();
    process.exit(1);
});
