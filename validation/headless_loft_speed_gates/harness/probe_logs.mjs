// Run executeCadOperatorProduction with in-process materialize and slice.
// No network. Captures console and stdout during the call.
// Usage: node --experimental-strip-types probe_logs.mjs <worktree> <report.json>

import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [worktree, reportPath] = process.argv.slice(2);
if (!worktree || !reportPath) {
    console.error("usage: node --experimental-strip-types probe_logs.mjs <worktree> <report.json>");
    process.exit(2);
}

delete process.env.VERTEXSLICE_API_KEY;
delete process.env.VERTEXSLICE_SLICER_URL;

const modulePath = path.join(worktree, "vertex/server/src/lib/cad-operator-production.ts");
const cad = await import(pathToFileURL(modulePath).href);

const lines = [];
function record(args) {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
}

const originals = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
};
console.log = (...args) => {
    record(args);
};
console.info = (...args) => {
    record(args);
};
console.debug = (...args) => {
    record(args);
};
console.warn = (...args) => {
    record(args);
};
console.error = (...args) => {
    record(args);
};

const stdoutWrite = process.stdout.write.bind(process.stdout);
const stderrWrite = process.stderr.write.bind(process.stderr);
process.stdout.write = (chunk, encoding, callback) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return stdoutWrite(chunk, encoding, callback);
};
process.stderr.write = (chunk, encoding, callback) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return stderrWrite(chunk, encoding, callback);
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const store = new cad.MemoryCadProductionStore();
const now = new Date("2026-11-24T00:00:00.000Z");
const claimed = await cad.claimProduction(
    store,
    {
        designId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        side: "left",
        presetId: "apex-v2-insole-95a",
        idempotencyKey: "cadop:v1:gate:left:fixture",
        settingsFingerprint: "gate-fixture",
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    },
    now,
);

let materializeCalls = 0;
let sliceCalls = 0;
let errorMessage = null;
try {
    await cad.executeCadOperatorProduction({
        row: (await store.findById(claimed.row.id)) ?? claimed.row,
        store,
        now: () => new Date(),
        materialize: async () => {
            materializeCalls += 1;
            await sleep(30);
            return { stlStorageKey: "temp/gate-fixture-left.stl", meshFingerprint: "gate-fixture" };
        },
        slice: async () => {
            sliceCalls += 1;
            await sleep(30);
            return { gcode: "G1\n", jobId: "gate-job" };
        },
        uploadGcode: async () => ({ storageKey: "gcode/gate/fixture/left.gcode" }),
        charge: async () => ({ exportId: "exp-gate", balance: 1, alreadyCharged: false }),
    });
} catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
} finally {
    console.log = originals.log;
    console.info = originals.info;
    console.debug = originals.debug;
    console.warn = originals.warn;
    console.error = originals.error;
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
}

const row = await store.findById(claimed.row.id);
const report = {
    status: row?.status ?? null,
    materializeCalls,
    sliceCalls,
    errorMessage,
    captured: lines.join("\n"),
};
writeFileSync(reportPath, JSON.stringify(report, null, 2));
if (errorMessage || row?.status !== "succeeded" || materializeCalls !== 1 || sliceCalls !== 1) {
    process.exit(2);
}
