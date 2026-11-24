// Frozen runner for the pair-run transaction timeout and wait_s gates.
// Exit 0 only when gates A, B, C, and D all pass.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const gatesRepo = resolve(here, "../..");
const tsx = join(gatesRepo, "node_modules/tsx/dist/cli.mjs");

const GATES = {
    a: "gate-a-pair-txn.ts",
    b: "gate-b-wait-s.ts",
    c: "gate-c-bytes.ts",
    d: "gate-d-ci.mjs",
};

export function productRootFromEnv() {
    return resolve(process.env.ORTHOCAD_ROOT ?? gatesRepo);
}

function ensureNodeModules(productRoot) {
    if (productRoot === gatesRepo) return;
    const link = join(productRoot, "node_modules");
    if (existsSync(link)) return;
    symlinkSync(join(gatesRepo, "node_modules"), link, "dir");
}

export function runOneCaptured(id, options = {}) {
    const script = GATES[id];
    if (!script) throw new Error(`unknown gate ${id}`);
    const productRoot = options.productRoot ?? productRootFromEnv();
    ensureNodeModules(productRoot);
    const resultPath = join(tmpdir(), `cadop-gate-${id}-${process.pid}-${Date.now()}.json`);
    const scriptPath = join(here, script);
    const argv = script.endsWith(".mjs")
        ? [scriptPath, ...(options.extraArgs ?? [])]
        : [tsx, scriptPath, ...(options.extraArgs ?? [])];
    const env = {
        ...process.env,
        ORTHOCAD_ROOT: productRoot,
        GATE_RESULT_PATH: resultPath,
        NODE_PATH: join(gatesRepo, "node_modules"),
    };
    if (options.sha) env.GATE_SHA = options.sha;
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let status = 0;
    try {
        stdout = execFileSync(process.execPath, argv, {
            cwd: gatesRepo,
            env,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 180_000,
            maxBuffer: 16 * 1024 * 1024,
        });
    } catch (error) {
        status = typeof error.status === "number" ? error.status : 1;
        stdout = error.stdout?.toString?.() ?? "";
        stderr = error.stderr?.toString?.() ?? "";
        if (error.stdout === undefined && error.stderr === undefined && error.message) stderr = error.message;
    }
    let result = null;
    if (existsSync(resultPath)) {
        result = JSON.parse(readFileSync(resultPath, "utf8"));
    }
    return {
        id,
        status,
        elapsed_ms: Date.now() - started,
        stdout,
        stderr,
        result,
    };
}

function selectedIds() {
    const only = process.argv.find((arg) => arg.startsWith("--only="));
    if (!only) return ["a", "b", "c", "d"];
    return only
        .slice("--only=".length)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
}

function printResult(captured) {
    const pass = captured.result?.pass === true && captured.status === 0;
    const line = captured.result?.summary ?? captured.stderr.slice(0, 400) ?? "no result";
    console.log(
        `gate ${captured.id.toUpperCase()}: ${pass ? "PASS" : "FAIL"} (${captured.elapsed_ms} ms) ${line}`,
    );
    if (captured.result?.measured) {
        console.log(JSON.stringify(captured.result.measured, null, 2));
    }
    return pass;
}

function main() {
    if (!existsSync(tsx)) {
        console.error(`tsx is missing at ${tsx}`);
        process.exit(2);
    }
    const ids = selectedIds();
    const productRoot = productRootFromEnv();
    const sha = process.env.GATE_SHA;
    console.log(`product_root=${productRoot}`);
    let failed = 0;
    const report = [];
    for (const id of ids) {
        const captured = runOneCaptured(id, { productRoot, sha });
        const pass = printResult(captured);
        if (!pass) failed += 1;
        report.push({
            id,
            pass,
            status: captured.status,
            elapsed_ms: captured.elapsed_ms,
            result: captured.result,
        });
    }
    const out = process.env.GATE_REPORT_PATH;
    if (out) {
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify({ productRoot, failed, report }, null, 2));
    }
    console.log(failed === 0 ? "GATES PASS" : `GATES FAIL (${failed})`);
    process.exit(failed === 0 ? 0 : 1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
