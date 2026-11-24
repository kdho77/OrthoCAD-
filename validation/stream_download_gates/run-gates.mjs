/**
 * Run frozen stream-download gates.
 *
 *   node validation/stream_download_gates/run-gates.mjs --mode noop
 *   node validation/stream_download_gates/run-gates.mjs --mode controls
 *   node validation/stream_download_gates/run-gates.mjs --mode grade --root <checkout>
 *
 * Product files are not modified in the grader checkout.
 * controls mode mutates throwaway git worktrees only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_SHA, scanAddedLines } from "./judges.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const EXPORT_TESTS = [
    "vertex/src/features/exports/manufacturing-stl-upload.test.ts",
    "vertex/src/features/exports/belt-print-name.test.ts",
    "vertex/src/features/exports/export-user-message.test.ts",
    "vertex/src/features/exports/export-service-filename.test.ts",
    "vertex/src/features/exports/vertexslice-gcode-path.test.ts",
    "vertex/src/features/exports/PrintingPanel.machine.test.tsx",
    "vertex/src/features/exports/export-build-gate.test.ts",
    "vertex/src/features/exports/saved-design-finalized-mesh.test.ts",
    "vertex/src/features/exports/afo-gcode-route.test.ts",
    "vertex/src/features/exports/apex-print-material.test.ts",
    "vertex/src/features/exports/export-panel-clinical.test.ts",
    "vertex/src/features/exports/ExportPanel.test.tsx",
    "vertex/src/features/exports/saved-design-thickness-loft.test.ts",
    "vertex/src/features/exports/pair-gcode-isolation.test.ts",
    "vertex/src/features/exports/vertexslice-regional-capability.test.ts",
    "vertex/src/features/exports/regional-hardness-fixtures.test.ts",
    "vertex/src/features/exports/vertexslice-regional-model.test.ts",
];

function arg(name, fallback) {
    const index = process.argv.indexOf(name);
    if (index < 0) return fallback;
    return process.argv[index + 1] ?? fallback;
}

function filterLog(text) {
    return String(text)
        .split("\n")
        .filter((line) => !/api_key|token|bearer/i.test(line))
        .join("\n");
}

function run(cmd, args, cwd, env = {}) {
    const result = spawnSync(cmd, args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, ...env },
        maxBuffer: 32 * 1024 * 1024,
    });
    return {
        status: result.status ?? 1,
        stdout: filterLog(result.stdout ?? ""),
        stderr: filterLog(result.stderr ?? ""),
    };
}

function behavior(root, resultPath) {
    const golden = resolve(repo, "validation/stream_download_gates/golden-slice.json");
    const ran = run(
        "npx",
        ["rstest", "--config", "validation/stream_download_gates/rstest.config.ts"],
        root,
        {
            GATE_RESULT_PATH: resultPath,
            GATE_GOLDEN_PATH: golden,
            GATE_CAPTURE: process.env.GATE_CAPTURE ?? "",
        },
    );
    let rows = [];
    try {
        rows = JSON.parse(readFileSync(resultPath, "utf8"));
    } catch {
        rows = [];
    }
    return { status: ran.status, rows, tail: `${ran.stdout}\n${ran.stderr}`.slice(-4000) };
}

function source(root, resultPath) {
    const ran = run("node", ["validation/stream_download_gates/source-gates.mjs"], root, {
        GATE_ROOT: root,
        GATE_SOURCE_RESULT: resultPath,
    });
    let payload = { gates: [] };
    try {
        payload = JSON.parse(readFileSync(resultPath, "utf8"));
    } catch {
        payload = { gates: [], error: ran.stderr.slice(-1000) };
    }
    return { status: ran.status, gates: payload.gates ?? [], tail: `${ran.stdout}\n${ran.stderr}`.slice(-2000) };
}

function existingTests(root) {
    const ran = run("npx", ["rstest", "--config", "rstest.config.ts", ...EXPORT_TESTS], root, {});
    const combined = `${ran.stdout}\n${ran.stderr}`;
    const failed = /fail/i.test(combined) && ran.status !== 0;
    return {
        id: "G_EXISTING_TESTS",
        threshold: "rstest exit code == 0 on the frozen export test list",
        pass: ran.status === 0,
        measured: {
            exitCode: ran.status,
            failedSignal: failed,
            files: EXPORT_TESTS.length,
        },
        command: `npx rstest --config rstest.config.ts ${EXPORT_TESTS.join(" ")}`,
        tail: combined.slice(-2500),
    };
}

function linkModules(dir) {
    symlinkSync(resolve(repo, "node_modules"), resolve(dir, "node_modules"));
    symlinkSync(resolve(repo, "vertex/node_modules"), resolve(dir, "vertex/node_modules"));
}

function worktree() {
    const dir = mkdtempSync(resolve(tmpdir(), "stream-gate-"));
    execFileSync("git", ["worktree", "add", "--detach", dir, BASE_SHA], { cwd: repo, stdio: "inherit" });
    linkModules(dir);
    mkdirSync(resolve(dir, "validation"), { recursive: true });
    cpSync(resolve(repo, "validation/stream_download_gates"), resolve(dir, "validation/stream_download_gates"), {
        recursive: true,
    });
    return dir;
}

function removeWorktree(dir) {
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: repo });
    rmSync(dir, { recursive: true, force: true });
}

function patchFile(dir, relative, needle, replacement) {
    const path = resolve(dir, relative);
    const source = readFileSync(path, "utf8");
    if (!source.includes(needle)) {
        throw new Error(`patch needle missing in ${relative}`);
    }
    writeFileSync(path, source.replace(needle, replacement));
}

function readRows(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}

function noopExpectations(rows) {
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    const errors = [];
    for (const id of ["PROOF_NOOP_STREAM", "PROOF_BAD_STREAM", "PROOF_NOOP_PARTIAL", "PROOF_BAD_PARTIAL"]) {
        if (!byId[id]?.pass) errors.push(`${id} did not pass`);
    }
    const stream = byId.G_T1_STREAM;
    if (!stream) errors.push("missing G_T1_STREAM");
    else if (stream.pass) errors.push("G_T1_STREAM passed on unchanged main");
    else if (stream.measured?.earlyLeft !== 0 || stream.measured?.slicesStarted !== 2 || stream.measured?.foot2Pending !== true) {
        errors.push(`G_T1_STREAM baseline measurement was ${JSON.stringify(stream.measured)}`);
    }
    const partial = byId.G_T2_PARTIAL;
    if (!partial) errors.push("missing G_T2_PARTIAL");
    else if (partial.pass) errors.push("G_T2_PARTIAL passed on unchanged main");
    else if (partial.measured?.earlyLeft !== 0 || !/no files were downloaded/i.test(partial.measured?.reason ?? "")) {
        errors.push(`G_T2_PARTIAL baseline measurement was ${JSON.stringify(partial.measured)}`);
    }
    for (const id of [
        "G_T3_CANCEL_BEFORE",
        "G_T3_CANCEL_INFLIGHT",
        "G_T3_SINGLE_LEFT",
        "G_T3_SINGLE_RIGHT",
        "G_BYTES_PAIR",
        "G_BYTES_SINGLE",
    ]) {
        if (!byId[id]?.pass) errors.push(`${id} failed on unchanged main: ${JSON.stringify(byId[id]?.measured)}`);
    }
    return errors;
}

function controls() {
    const notes = [];
    const secret = scanAddedLines('+ const api_key = "supersecretvalue";\n');
    const phi = scanAddedLines("+ reach-me@example.com\n");
    const clean = scanAddedLines("+ const deferDownload = true;\n");
    if (secret.secrets !== 1) throw new Error(`secret scanner measured ${secret.secrets}, threshold 1`);
    if (phi.phi !== 1) throw new Error(`phi scanner measured ${phi.phi}, threshold 1`);
    if (clean.secrets !== 0 || clean.phi !== 0) throw new Error("scanner false-positive on a plain line");
    notes.push("scanner noop accepts a plain line; scanner rejects a planted key and a planted email");

    const positive = worktree();
    try {
        patchFile(
            positive,
            "vertex/src/features/exports/export-panel-clinical.ts",
            `            return {
                foot,
                res: await generateHybridGcode(foot, preset, grindingStyle, overrides, options),
            };`,
            `            const res = await generateHybridGcode(foot, preset, grindingStyle, overrides, options);
            if (res.ok && res.blob && res.filename) {
                downloadNamedBlobs([{ filename: res.filename, blob: res.blob }]);
            }
            return { foot, res };`,
        );
        const resultPath = resolve(tmpdir(), "stream-positive.json");
        const ran = behavior(positive, resultPath);
        const stream = ran.rows.find((row) => row.id === "G_T1_STREAM");
        if (ran.status !== 0) throw new Error(`positive behavior harness exited ${ran.status}: ${ran.tail}`);
        if (!stream?.pass) {
            throw new Error(`positive patch did not pass G_T1_STREAM: ${JSON.stringify(stream)}`);
        }
        notes.push(`positive patch earlyLeft=${stream.measured.earlyLeft} earlyRight=${stream.measured.earlyRight} pass=true`);
    } finally {
        removeWorktree(positive);
    }

    const bytes = worktree();
    try {
        patchFile(
            bytes,
            "vertex/src/features/exports/export-service.ts",
            `blob = new Blob([res.gcode], { type: "text/plain" });`,
            `blob = new Blob([res.gcode + "\\n;tamper\\n"], { type: "text/plain" });`,
        );
        const resultPath = resolve(tmpdir(), "stream-bad-bytes.json");
        const ran = behavior(bytes, resultPath);
        const pair = ran.rows.find((row) => row.id === "G_BYTES_PAIR");
        const single = ran.rows.find((row) => row.id === "G_BYTES_SINGLE");
        if (ran.status !== 0) throw new Error(`bad-bytes harness exited ${ran.status}: ${ran.tail}`);
        if (pair?.pass !== false || single?.pass !== false) {
            throw new Error(`tampered G-code bytes were not rejected: pair=${pair?.pass} single=${single?.pass}`);
        }
        notes.push(
            `bad gcode blob pair mismatches=${pair.measured.gcodeMismatches} single pass=${single.pass}`,
        );
    } finally {
        removeWorktree(bytes);
    }

    const spans = worktree();
    try {
        patchFile(
            spans,
            "vertex/src/features/exports/export-service.ts",
            "const solid = await buildExportStl(side, {",
            "const solid = await buildExportStl(side, /* tamper */ {",
        );
        const resultPath = resolve(tmpdir(), "stream-bad-spans.json");
        const ran = source(spans, resultPath);
        const gate = ran.gates.find((row) => row.id === "G_R5_SPANS");
        if (!gate || gate.pass !== false) throw new Error(`span tamper was not rejected: ${JSON.stringify(gate)}`);
        notes.push(`bad span mismatches=${gate.measured.mismatches.length}`);
    } finally {
        removeWorktree(spans);
    }

    const surface = worktree();
    try {
        const leader = resolve(surface, "vertex/src/lib/geometry/leader-block.ts");
        writeFileSync(leader, `${readFileSync(leader, "utf8")}\n// gate-tamper\n`);
        const resultPath = resolve(tmpdir(), "stream-bad-surface.json");
        const ran = source(surface, resultPath);
        const r1 = ran.gates.find((row) => row.id === "G_R1_SURFACE");
        const scope = ran.gates.find((row) => row.id === "G_R3_SCOPE");
        const leaderGate = ran.gates.find((row) => row.id === "G_MUST_LEADER_FILE");
        if (!r1 || r1.pass !== false) throw new Error("surface tamper was not rejected");
        if (!scope || scope.pass !== false) throw new Error("out-of-scope file was allowed");
        if (!leaderGate || leaderGate.pass !== false) throw new Error("leader file tamper was not rejected");
        notes.push(
            `bad surface changedLines=${r1.measured.changedLines} disallowed=${scope.measured.disallowed.length}`,
        );
    } finally {
        removeWorktree(surface);
    }

    const brokenTest = worktree();
    try {
        patchFile(
            brokenTest,
            "vertex/src/features/exports/export-panel-clinical.test.ts",
            "expect(res.ok).toBe(true);",
            "expect(res.ok).toBe(false);",
        );
        const ran = run(
            "npx",
            ["rstest", "--config", "rstest.config.ts", "vertex/src/features/exports/export-panel-clinical.test.ts"],
            brokenTest,
            {},
        );
        if (ran.status === 0) throw new Error("broken export test exited 0");
        notes.push(`bad export test exit=${ran.status}`);
    } finally {
        removeWorktree(brokenTest);
    }

    return notes;
}

const mode = arg("--mode", "grade");
const root = resolve(arg("--root", repo));
const out = resolve(arg("--out", "/tmp/stream-download-gates-report.json"));

if (mode === "controls") {
    const notes = controls();
    writeFileSync(out, JSON.stringify({ mode, notes }, null, 2));
    process.stdout.write(`${notes.join("\n")}\n`);
    process.exit(0);
}

const behaviorPath = resolve(tmpdir(), `stream-behavior-${mode}.json`);
const sourcePath = resolve(tmpdir(), `stream-source-${mode}.json`);
const behaviorRun = behavior(root, behaviorPath);
const sourceRun = source(root, sourcePath);
let tests = null;
if (mode !== "behavior-only" && mode !== "source-only") {
    tests = existingTests(root);
}

const report = {
    mode,
    root,
    base: BASE_SHA,
    behaviorStatus: behaviorRun.status,
    behavior: behaviorRun.rows,
    source: sourceRun.gates,
    existingTests: tests,
    behaviorTail: behaviorRun.status === 0 ? "" : behaviorRun.tail,
};
if (mode === "noop") {
    report.noopErrors = noopExpectations(behaviorRun.rows);
    const sourceFails = sourceRun.gates.filter((gate) => !gate.pass).map((gate) => gate.id);
    if (sourceFails.length) report.noopErrors.push(`source gates failed on main: ${sourceFails.join(",")}`);
    if (behaviorRun.status !== 0) report.noopErrors.push(`behavior harness exit ${behaviorRun.status}`);
    if (tests && !tests.pass) report.noopErrors.push(`existing tests exit ${tests.measured.exitCode}`);
}
writeFileSync(out, JSON.stringify(report, null, 2));
const failedProduct = [...behaviorRun.rows, ...sourceRun.gates, ...(tests ? [tests] : [])].filter(
    (row) => row.group !== "proof" && row.pass === false,
);
process.stdout.write(
    `${JSON.stringify({
        mode,
        out,
        behaviorStatus: behaviorRun.status,
        noopErrors: report.noopErrors ?? null,
        failed: failedProduct.map((row) => row.id),
    })}\n`,
);
if (mode === "noop" && report.noopErrors.length) process.exit(1);
