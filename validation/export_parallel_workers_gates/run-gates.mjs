/**
 * Run frozen gates against one product tree.
 * Does not modify product source. Do not edit after the freeze commit.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeAll } from "./checker.mjs";
import { observeSource } from "./observe-source.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

const EXISTING_TESTS = [
    "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.test.ts",
    "vertex/src/lib/geometry/procedural-wall/preview-loft-worker.test.ts",
    "vertex/src/lib/geometry/export-geometry.routing.test.ts",
    "vertex/src/lib/geometry/procedural-wall/print-export-cache-parity.test.ts",
];

function arg(name, fallback = "") {
    const index = process.argv.indexOf(name);
    if (index < 0) return fallback;
    return process.argv[index + 1] ?? fallback;
}

function has(name) {
    return process.argv.includes(name);
}

function run(command, args, options) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
            process.stdout.write(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
            process.stderr.write(chunk);
        });
        const timer =
            options.timeoutMs > 0
                ? setTimeout(() => {
                      child.kill("SIGKILL");
                  }, options.timeoutMs)
                : null;
        child.on("close", (code, signal) => {
            if (timer) clearTimeout(timer);
            resolve({ code: code ?? 1, signal, stdout, stderr });
        });
    });
}

function ensureLinkedModules(product) {
    if (path.resolve(product) === repo) return;
    for (const rel of ["node_modules", "vertex/node_modules"]) {
        const link = path.join(product, rel);
        const target = path.join(repo, rel);
        if (!existsSync(link) && existsSync(target)) {
            mkdirSync(path.dirname(link), { recursive: true });
            symlinkSync(target, link);
        }
    }
}

function readJson(file) {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8"));
}

const product = path.resolve(arg("--product", repo));
const baseline = path.resolve(arg("--baseline", repo));
const diffFrom = arg("--diff-from", "");
const outDir = path.resolve(arg("--out", path.join(here, "artifacts")));
mkdirSync(outDir, { recursive: true });
const label = arg("--label", "run");
const rstest = path.join(repo, "node_modules/.bin/rstest");
const config = path.join(here, "rstest.gates.config.ts");
const liveTest = path.join(here, "live/export-gates.optional.test.ts");

ensureLinkedModules(product);

const source = observeSource(product, baseline, diffFrom || null);
writeFileSync(path.join(outDir, `${label}-source.json`), `${JSON.stringify(source, null, 2)}\n`);

const heartbeat = path.join(outDir, `${label}-heartbeat.json`);
const probeObs = path.join(outDir, `${label}-probe.json`);
const probe = await run(rstest, ["--config", config, liveTest], {
    cwd: product,
    timeoutMs: 90_000,
    env: {
        ...process.env,
        GATE_PRODUCT_ROOT: product,
        GATE_MODE: "probe",
        GATE_HEARTBEAT: heartbeat,
        GATE_OBS: probeObs,
    },
});

const geometryObs = path.join(outDir, `${label}-geometry.json`);
const stlOut = path.join(outDir, `${label}-stl`);
mkdirSync(stlOut, { recursive: true });
const geometry = has("--skip-geometry")
    ? { code: 0, signal: null }
    : await run(rstest, ["--config", config, liveTest], {
          cwd: product,
          timeoutMs: 2_700_000,
          env: {
              ...process.env,
              GATE_PRODUCT_ROOT: product,
              GATE_MODE: "geometry",
              GATE_OBS: geometryObs,
              GATE_STL_OUT: stlOut,
              GATE_BASELINE_STL_DIR: arg("--baseline-stl", ""),
          },
      });

const existingCommand = `${rstest} --config ${path.join(product, "rstest.config.ts")} ${EXISTING_TESTS.join(" ")}`;
const existing = has("--skip-existing")
    ? { code: null, signal: null }
    : await run(rstest, ["--config", path.join(product, "rstest.config.ts"), ...EXISTING_TESTS], {
          cwd: product,
          timeoutMs: 2_700_000,
          env: { ...process.env },
      });

const probeJson = readJson(probeObs) ?? readJson(heartbeat) ?? {};
const geometryJson = readJson(geometryObs) ?? {};
const observation = {
    label,
    product,
    baseline,
    diffFrom: diffFrom || null,
    probeExit: probe.code,
    probeSignal: probe.signal,
    geometryExit: geometry.code,
    geometrySignal: geometry.signal,
    source,
    runtime: {
        ...(probeJson.runtime ?? probeJson),
        ...(geometryJson.runtime ?? {}),
        headlessExportOk: geometryJson.runtime?.headlessExportOk === true,
        workerTypeDuringHeadless: geometryJson.runtime?.workerTypeDuringHeadless ?? "undefined",
    },
    geometry: geometryJson.geometry ?? {},
    existingTests: { exitCode: existing.code, command: existingCommand },
};
if (geometryJson.runtime?.error) observation.runtime.geometryError = geometryJson.runtime.error;

const grades = gradeAll(observation);
const summary = { observation, grades };
writeFileSync(path.join(outDir, `${label}-grade.json`), `${JSON.stringify(summary, null, 2)}\n`);
for (const grade of grades) {
    const measured = JSON.stringify(grade.measured);
    process.stdout.write(
        `${grade.pass ? "PASS" : "FAIL"} ${grade.id} measured=${measured} threshold=${JSON.stringify(grade.threshold)}\n`,
    );
}
process.exit(grades.every((grade) => grade.pass) ? 0 : 2);
