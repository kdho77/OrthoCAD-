// Frozen before grading candidate f059edf74b9bed33071a4deb8ad3c9674d289dfd.
// Live runner. Does not modify product source.
//
// node validation/export_parallel_workers_gates/run-gates.mjs live --label base --product . --sha <sha> --base-sha <sha> --out <dir> --worker-builds 0
// node validation/export_parallel_workers_gates/run-gates.mjs grade --base-out <dir> --candidate-out <dir> --grade <file>

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    checkEngraveMarking,
    checkExportCancel,
    checkFallback,
    checkGeometryMatch,
    checkHashesDiffer,
    checkParallelDispatch,
    checkPreviewCancel,
    checkSourceRules,
    checkTests,
    checkWarm,
    checkWorkerCase,
} from "./checkers.mjs";
import { collectGitDiff } from "./source-gate.mjs";
import { compareStlFiles } from "./stl-compare.mjs";
import { EXISTING_TEST_FILES } from "./thresholds.mjs";

const repo = resolve(".");

function arg(name, fallback = "") {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) return fallback;
    return process.argv[index + 1];
}

function redact(text) {
    return String(text)
        .split("\n")
        .filter((line) => !/api_key|bearer/i.test(line))
        .join("\n");
}

function runProcess(command, args, options) {
    const { cwd, env, timeoutMs } = options;
    return new Promise((resolvePromise) => {
        const child = spawn(command, args, {
            cwd,
            env: { ...process.env, ...env },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer =
            timeoutMs > 0
                ? setTimeout(() => {
                      timedOut = true;
                      child.kill("SIGKILL");
                  }, timeoutMs)
                : null;
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
            if (stdout.length > 1_500_000) stdout = stdout.slice(-750_000);
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
            if (stderr.length > 1_500_000) stderr = stderr.slice(-750_000);
        });
        child.on("close", (code) => {
            if (timer) clearTimeout(timer);
            resolvePromise({ code: code ?? 1, stdout, stderr, timedOut });
        });
    });
}

function readJson(path) {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
}

function ensureModules(product) {
    if (resolve(product) === repo) return;
    const links = [
        [join(repo, "node_modules"), join(product, "node_modules")],
        [join(repo, "vertex/node_modules"), join(product, "vertex/node_modules")],
    ];
    for (const [target, link] of links) {
        if (!existsSync(link)) symlinkSync(target, link, "dir");
    }
}

async function runRstestGate(file, env, timeoutMs, logPath) {
    const result = await runProcess(
        "npx",
        ["rstest", "--config", "validation/export_parallel_workers_gates/rstest.gates.config.ts", file],
        { cwd: repo, env, timeoutMs },
    );
    writeFileSync(logPath, redact(`${result.stdout}\n${result.stderr}`));
    return result;
}

async function live(options) {
    const out = resolve(options.out);
    mkdirSync(out, { recursive: true });
    const source = collectGitDiff(repo, options.baseSha, options.sha);
    writeFileSync(join(out, "source.json"), JSON.stringify(source, null, 2));

    const dispatch = await runRstestGate(
        "validation/export_parallel_workers_gates/dispatch.gate.ts",
        { GATE_PRODUCT_ROOT: options.product, GATE_TRACE: join(out, "dispatch.json"), GATE_SHA: options.sha },
        25_000,
        join(out, "dispatch.log"),
    );
    const cancel = await runRstestGate(
        "validation/export_parallel_workers_gates/cancel.gate.ts",
        { GATE_PRODUCT_ROOT: options.product, GATE_TRACE: join(out, "cancel.json"), GATE_SHA: options.sha },
        30_000,
        join(out, "cancel.log"),
    );
    const geometry = await runRstestGate(
        "validation/export_parallel_workers_gates/geometry.gate.ts",
        {
            GATE_PRODUCT_ROOT: options.product,
            GATE_OUT: out,
            GATE_SHA: options.sha,
            GATE_LABEL: options.label,
            GATE_WORKER_BUILDS: options.workerBuilds ? "1" : "0",
        },
        2_400_000,
        join(out, "geometry.log"),
    );
    ensureModules(options.product);
    const tests = await runProcess("npx", ["rstest", ...EXISTING_TEST_FILES], {
        cwd: options.product,
        env: {},
        timeoutMs: 2_400_000,
    });
    writeFileSync(join(out, "existing-tests.log"), redact(`${tests.stdout}\n${tests.stderr}`));
    writeFileSync(
        join(out, "run.json"),
        JSON.stringify(
            {
                label: options.label,
                sha: options.sha,
                dispatch: { code: dispatch.code, timedOut: dispatch.timedOut },
                cancel: { code: cancel.code, timedOut: cancel.timedOut },
                geometry: { code: geometry.code, timedOut: geometry.timedOut },
                tests: { code: tests.code, timedOut: tests.timedOut },
            },
            null,
            2,
        ),
    );
    console.log(
        JSON.stringify({
            label: options.label,
            dispatch: dispatch.code,
            dispatchTimedOut: dispatch.timedOut,
            cancel: cancel.code,
            cancelTimedOut: cancel.timedOut,
            geometry: geometry.code,
            geometryTimedOut: geometry.timedOut,
            tests: tests.code,
        }),
    );
}

function caseEntry(measurements, name) {
    return measurements?.cases?.[name] ?? null;
}

function matchFiles(dirA, nameA, dirB, nameB, measurementsA, measurementsB) {
    const fileA = join(dirA, `${nameA}.stl`);
    const fileB = join(dirB, `${nameB}.stl`);
    if (!existsSync(fileA) || !existsSync(fileB)) {
        return {
            pass: false,
            measured: { missing: !existsSync(fileA) ? fileA : fileB },
            threshold: { maxDeltaMm: 0 },
        };
    }
    const cmp = compareStlFiles(fileA, fileB);
    return checkGeometryMatch(
        cmp,
        caseEntry(measurementsA, nameA)?.product,
        caseEntry(measurementsB, nameB)?.product,
    );
}

function geometryRows(baseOut, candOut) {
    const base = readJson(join(baseOut, "measurements.json"));
    const cand = readJson(join(candOut, "measurements.json"));
    const rows = [];
    const selfNames = [
        "stock-left-main-a",
        "stock-left-main-b",
        "stock-right-main",
        "engraved-left-main",
        "engraved-right-main",
    ];
    rows.push({
        id: "T2-determinism",
        ...matchFiles(baseOut, "stock-left-main-a", baseOut, "stock-left-main-b", base, base),
        detail: "two cold main-thread stock-left builds on BASE",
    });
    for (const name of selfNames) {
        rows.push({
            id: `BASE-manifold-${name}`,
            ...matchFiles(baseOut, name, baseOut, name, base, base),
            detail: `BASE ${name} matches itself and is watertight`,
        });
    }
    rows.push({
        ...checkFallback(caseEntry(base, "stock-left-main-a")),
        id: "T3-left",
        detail: "BASE headless left",
    });
    rows.push({
        ...checkFallback(caseEntry(base, "stock-right-main")),
        id: "T3-right",
        detail: "BASE headless right",
    });
    rows.push({
        ...checkWarm(caseEntry(base, "stock-left-main-b"), caseEntry(base, "stock-left-warm")),
        id: "T3-warm",
        detail: "BASE warm cache",
    });
    rows.push({
        ...checkEngraveMarking(caseEntry(base, "engraved-left-main")),
        id: "R4-marking",
        detail: "BASE textMarking bottom engrave",
    });
    rows.push({
        ...checkHashesDiffer(caseEntry(base, "stock-left-main-a"), caseEntry(base, "engraved-left-main")),
        id: "engraved-differs",
        detail: "BASE patient-name STL differs from stock",
    });
    if (!cand || resolve(baseOut) === resolve(candOut)) return rows;

    const cross = [
        ["stock-left-main-a", "stock-left-main-a"],
        ["stock-right-main", "stock-right-main"],
        ["engraved-left-main", "engraved-left-main"],
        ["engraved-right-main", "engraved-right-main"],
    ];
    for (const [baseName, candName] of cross) {
        rows.push({
            id: `T2-main-vs-base-${candName}`,
            ...matchFiles(baseOut, baseName, candOut, candName, base, cand),
            detail: `candidate main ${candName} vs BASE`,
        });
    }
    rows.push({
        ...checkFallback(caseEntry(cand, "stock-left-main-a")),
        id: "T3-candidate-left",
        detail: "candidate headless left",
    });
    rows.push({
        ...checkFallback(caseEntry(cand, "stock-right-main")),
        id: "T3-candidate-right",
        detail: "candidate headless right",
    });
    rows.push({
        ...checkWarm(caseEntry(cand, "stock-left-main-b"), caseEntry(cand, "stock-left-warm")),
        id: "T3-candidate-warm",
        detail: "candidate main-thread warm cache",
    });
    rows.push({
        ...checkEngraveMarking(caseEntry(cand, "engraved-left-main")),
        id: "R4-candidate-marking",
        detail: "candidate textMarking",
    });
    rows.push({
        ...checkHashesDiffer(caseEntry(cand, "stock-left-main-a"), caseEntry(cand, "engraved-left-main")),
        id: "engraved-differs-candidate",
        detail: "candidate patient-name STL differs from its stock",
    });
    const workerNames = [
        "stock-left-worker",
        "stock-right-worker",
        "engraved-left-worker",
        "engraved-right-worker",
    ];
    const workerToMain = {
        "stock-left-worker": "stock-left-main-a",
        "stock-right-worker": "stock-right-main",
        "engraved-left-worker": "engraved-left-main",
        "engraved-right-worker": "engraved-right-main",
    };
    for (const name of workerNames) {
        rows.push({
            ...checkWorkerCase(caseEntry(cand, name)),
            id: `T2-used-${name}`,
            detail: `worker path used for ${name}`,
        });
        rows.push({
            id: `T2-worker-vs-main-${name}`,
            ...matchFiles(candOut, workerToMain[name], candOut, name, cand, cand),
            detail: `${name} vs candidate main thread`,
        });
        rows.push({
            id: `T2-worker-vs-base-${name}`,
            ...matchFiles(baseOut, workerToMain[name], candOut, name, base, cand),
            detail: `${name} vs BASE main thread`,
        });
    }
    rows.push({
        ...checkWarm(caseEntry(cand, "stock-left-worker"), caseEntry(cand, "stock-left-worker-warm")),
        id: "T3-worker-warm",
        detail: "candidate warm cache after a worker build",
    });
    return rows;
}

function andRows(id, detail, items) {
    const present = items.filter(Boolean);
    const pass = present.length === items.length && present.every((item) => item.pass === true);
    return {
        id,
        pass,
        detail,
        measured: Object.fromEntries(present.map((item) => [item.id, item.pass])),
        threshold: { all: true },
        parts: present,
    };
}

export function buildGrade(baseOut, candOut) {
    const baseSource = checkSourceRules(readJson(join(baseOut, "source.json")));
    const candSource = candOut ? checkSourceRules(readJson(join(candOut, "source.json"))) : null;
    const baseDispatch = checkParallelDispatch(readJson(join(baseOut, "dispatch.json")) ?? { events: [] });
    const candDispatch = candOut
        ? checkParallelDispatch(readJson(join(candOut, "dispatch.json")) ?? { events: [] })
        : null;
    const baseCancelPreview = checkPreviewCancel(readJson(join(baseOut, "cancel.json")) ?? {});
    const candCancelPreview = candOut
        ? checkPreviewCancel(readJson(join(candOut, "cancel.json")) ?? {})
        : null;
    const baseCancelExport = checkExportCancel(readJson(join(baseOut, "cancel.json")) ?? {});
    const candCancelExport = candOut ? checkExportCancel(readJson(join(candOut, "cancel.json")) ?? {}) : null;
    const baseTests = checkTests(readJson(join(baseOut, "run.json"))?.tests?.code ?? 1);
    const candTests = candOut ? checkTests(readJson(join(candOut, "run.json"))?.tests?.code ?? 1) : null;
    const geo = geometryRows(baseOut, candOut ?? baseOut);
    const byId = Object.fromEntries(geo.map((item) => [item.id, item]));
    const baseMainManifold = [
        "stock-left-main-a",
        "stock-right-main",
        "engraved-left-main",
        "engraved-right-main",
    ].map((name) => byId[`BASE-manifold-${name}`]);
    const candidateCross = [
        "stock-left-main-a",
        "stock-right-main",
        "engraved-left-main",
        "engraved-right-main",
    ].map((name) => byId[`T2-main-vs-base-${name}`]);
    const workerVsMain = [
        "stock-left-worker",
        "stock-right-worker",
        "engraved-left-worker",
        "engraved-right-worker",
    ].map((name) => byId[`T2-worker-vs-main-${name}`]);
    const workerVsBase = [
        "stock-left-worker",
        "stock-right-worker",
        "engraved-left-worker",
        "engraved-right-worker",
    ].map((name) => byId[`T2-worker-vs-base-${name}`]);
    const workerUsed = [
        "stock-left-worker",
        "stock-right-worker",
        "engraved-left-worker",
        "engraved-right-worker",
    ].map((name) => byId[`T2-used-${name}`]);

    const rules = {};
    if (!candOut || resolve(baseOut) === resolve(candOut)) {
        rules.R1 = andRows("R1", "BASE surface unchanged against itself", [
            baseSource.R1,
            ...baseMainManifold,
        ]);
        rules.R2 = andRows("R2", "BASE sole band unchanged against itself", [
            baseSource.R2,
            ...baseMainManifold,
        ]);
        rules.R3 = baseSource.R3;
        rules.R4 = andRows("R4", "BASE bottom engrave", [
            baseSource.R4,
            byId["R4-marking"],
            byId["engraved-differs"],
            byId["BASE-manifold-engraved-left-main"],
            byId["BASE-manifold-engraved-right-main"],
        ]);
        rules.R5 = baseSource.R5;
        rules.R6 = andRows("R6", "BASE geometry and fingerprint unchanged against itself", [
            baseSource.R6,
            byId["T2-determinism"],
            ...baseMainManifold,
        ]);
        rules.T1 = baseDispatch;
        rules.T2 = {
            id: "T2",
            pass: false,
            measured: {
                reason: "BASE builds export solids on the main thread",
                dispatch: baseDispatch.measured,
            },
            threshold: { workerInstances: 2, maxDeltaMm: 0 },
            detail: "worker solids are not on BASE",
        };
        rules.T3 = andRows("T3", "BASE headless and single-foot", [
            byId["T3-left"],
            byId["T3-right"],
            byId["T3-warm"],
        ]);
        rules.T4 = baseCancelPreview;
        rules.T4a = baseCancelPreview;
        rules.T4b = baseCancelExport;
        rules.T5 = baseTests;
    } else {
        const crossOk = candidateCross.filter(Boolean);
        const workerOk = [...workerUsed, ...workerVsMain, ...workerVsBase].filter(Boolean);
        rules.R1 = andRows("R1", "surface and dorsal band identical to BASE", [
            candSource.R1,
            ...crossOk,
            ...workerVsBase.filter(Boolean),
        ]);
        rules.R2 = andRows("R2", "seams stay off the diff and the sole band matches BASE", [
            candSource.R2,
            ...crossOk,
            ...workerVsBase.filter(Boolean),
        ]);
        rules.R3 = candSource.R3;
        rules.R4 = andRows("R4", "bottom engrave unchanged versus BASE", [
            candSource.R4,
            byId["R4-candidate-marking"],
            byId["engraved-differs-candidate"],
            byId["T2-main-vs-base-engraved-left-main"],
            byId["T2-main-vs-base-engraved-right-main"],
            byId["T2-worker-vs-base-engraved-left-worker"],
            byId["T2-worker-vs-base-engraved-right-worker"],
        ]);
        rules.R5 = candSource.R5;
        rules.R6 = andRows("R6", "geometry, walls, engraving, and fingerprint unchanged", [
            candSource.R6,
            ...crossOk,
            ...workerVsBase.filter(Boolean),
        ]);
        rules.T1 = candDispatch;
        rules.T2 = andRows("T2", "worker solids match main thread and BASE", workerOk);
        rules.T3 = andRows("T3", "headless, single-foot, and warm cache", [
            byId["T3-candidate-left"],
            byId["T3-candidate-right"],
            byId["T3-candidate-warm"],
            byId["T3-worker-warm"],
        ]);
        rules.T4 = andRows("T4", "preview and export worker cleanup", [candCancelPreview, candCancelExport]);
        rules.T4a = candCancelPreview;
        rules.T4b = candCancelExport;
        rules.T5 = candTests;
        rules["MUST-MATCH"] = andRows(
            "MUST-MATCH",
            "worker bytes match main and BASE; headless and single-foot still work",
            [rules.T2, rules.T3],
        );
        rules.ONE = andRows("ONE", "cold Left and Right run together off the main thread and match main", [
            rules.T1,
            rules.T2,
        ]);
    }
    return {
        baseOut,
        candOut,
        rules,
        geometry: geo,
        source:
            candOut && resolve(baseOut) !== resolve(candOut)
                ? readJson(join(candOut, "source.json"))
                : readJson(join(baseOut, "source.json")),
    };
}

const command = process.argv[2];
if (command === "live") {
    await live({
        label: arg("--label", "base"),
        product: resolve(arg("--product", ".")),
        sha: arg("--sha"),
        baseSha: arg("--base-sha"),
        out: arg("--out"),
        workerBuilds: arg("--worker-builds", "0") === "1",
    });
} else if (command === "grade") {
    const grade = buildGrade(resolve(arg("--base-out")), resolve(arg("--candidate-out")));
    const dest = resolve(arg("--grade"));
    writeFileSync(dest, JSON.stringify(grade, null, 2));
    const summary = Object.fromEntries(Object.entries(grade.rules).map(([id, rule]) => [id, rule.pass]));
    console.log(JSON.stringify(summary, null, 2));
    if (Object.values(summary).some((pass) => pass !== true) && arg("--expect", "") === "base-regression") {
        const failed = Object.entries(summary)
            .filter(([id, pass]) => !pass && !["T1", "T2", "T4b"].includes(id))
            .map(([id]) => id);
        if (failed.length) process.exit(1);
    }
} else {
    console.error("usage: run-gates.mjs live|grade");
    process.exit(2);
}
