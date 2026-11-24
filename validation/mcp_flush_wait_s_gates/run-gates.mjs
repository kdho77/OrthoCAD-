/**
 * Frozen gates for generate_gcode flush / get_production wait_s.
 * Read-only on the tree under test. Do not edit after the freeze commit.
 *
 *   node --import ./register.mjs ./run-gates.mjs --tree <repo> --out report.json
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
    BASE_SHA,
    STOCK_LOFT_PATHS,
    THRESHOLDS,
    displayPath,
    isGatePath,
    isGeometryOrSurfacePath,
    redact,
} from "./thresholds.mjs";

const DESIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCTION_PROBE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FIXED_NOW = new Date("2026-11-09T00:00:00.000Z");

function arg(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function git(tree, args, encoding = "utf8") {
    const result = spawnSync("git", ["-C", tree, ...args], {
        encoding,
        maxBuffer: 32 * 1024 * 1024,
    });
    if (result.status !== 0) {
        const err = redact(result.stderr || result.stdout || "git failed");
        throw new Error(err);
    }
    return result.stdout;
}

function insert(side, nonce) {
    return {
        designId: DESIGN_ID,
        side,
        presetId: "apex-v2-insole-95a",
        idempotencyKey: `cadop:v1:design:${side}:${nonce}`,
        settingsFingerprint: nonce,
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    };
}

function config() {
    return {
        apiBase: "http://127.0.0.1:9",
        trpcUrl: "http://127.0.0.1:9/trpc",
        apiKey: "ocad_test",
    };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function payloadOf(result) {
    if (!result || result.isError) return null;
    try {
        return JSON.parse(result.content?.[0]?.text ?? "null");
    } catch {
        return null;
    }
}

function pairIds(payload) {
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const ids = { left: null, right: null };
    for (const file of files) {
        if (file?.side === "left" || file?.side === "right") {
            ids[file.side] = typeof file.production_id === "string" ? file.production_id : null;
        }
    }
    const ok = Boolean(ids.left) && Boolean(ids.right) && ids.left !== ids.right;
    return { ids, ok, count: files.length };
}

function gapMs(records) {
    const at = {};
    for (const record of records) at[record.side] = record.at;
    if (typeof at.left !== "number" || typeof at.right !== "number") return null;
    return Math.abs(at.left - at.right);
}

function toolError(result) {
    if (!result?.isError) return null;
    return redact(result.content?.[0]?.text ?? "tool error").slice(0, 400);
}

async function withHang(promise, capMs) {
    let timer;
    const hang = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ kind: "hang" }), capMs);
    });
    const done = promise.then(
        (value) => ({ kind: "done", value }),
        (error) => ({ kind: "error", error }),
    );
    const raced = await Promise.race([done, hang]);
    if (raced.kind !== "hang") clearTimeout(timer);
    return raced;
}

function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function deferralSource(source) {
    const start = source.indexOf("export async function beginCadOperatorProduction");
    if (start < 0) return { ok: false, reason: "beginCadOperatorProduction missing" };
    const next = source.indexOf("\nexport ", start + 40);
    const body = stripComments(source.slice(start, next === -1 ? source.length : next));
    const immediateAt = body.indexOf("setImmediate");
    const timeoutAt = /setTimeout\s*\([\s\S]*?,\s*0\s*\)/.test(body) ? body.search(/setTimeout\s*\(/) : -1;
    const candidates = [immediateAt, timeoutAt].filter((index) => index >= 0);
    const deferAt = candidates.length ? Math.min(...candidates) : -1;
    const execAt = body.indexOf(".execute(");
    if (deferAt < 0) {
        return { ok: false, reason: "no setImmediate or setTimeout(0) in beginCadOperatorProduction", deferAt, execAt };
    }
    if (execAt < 0) return { ok: false, reason: "args.execute call missing", deferAt, execAt };
    if (execAt < deferAt) return { ok: false, reason: "execute runs before the deferral", deferAt, execAt };
    return {
        ok: true,
        kind: immediateAt >= 0 && (timeoutAt < 0 || immediateAt <= timeoutAt) ? "setImmediate" : "setTimeout(0)",
        deferAt,
        execAt,
    };
}

function sha256(buf) {
    return createHash("sha256").update(buf).digest("hex");
}

function productPaths(tree) {
    const status = git(tree, ["diff", "--name-status", "--find-renames", BASE_SHA]);
    const untracked = git(tree, ["ls-files", "--others", "--exclude-standard"]);
    const paths = new Set();
    for (const line of status.split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("\t").slice(1);
        for (const part of parts) {
            if (part && !isGatePath(part)) paths.add(part);
        }
    }
    for (const line of untracked.split("\n")) {
        const name = line.trim();
        if (name && !isGatePath(name)) paths.add(name);
    }
    return [...paths].sort();
}

function gateBytes(tree) {
    const paths = productPaths(tree);
    const geometry = paths.filter(isGeometryOrSurfacePath);
    const hashes = {};
    let hashOk = true;
    for (const rel of STOCK_LOFT_PATHS) {
        const livePath = path.join(tree, rel);
        const live = existsSync(livePath) ? sha256(readFileSync(livePath)) : null;
        let base = null;
        const shown = spawnSync("git", ["-C", tree, "show", `${BASE_SHA}:${rel}`], {
            maxBuffer: 32 * 1024 * 1024,
        });
        if (shown.status === 0) base = sha256(shown.stdout);
        const match = live !== null && live === base;
        if (!match) hashOk = false;
        hashes[rel] = { live, base, match };
    }
    return {
        id: "G4",
        name: "STL and geometry bytes unchanged vs main",
        pass: geometry.length === 0 && hashOk,
        measured: {
            geometryPathCount: geometry.length,
            geometryPaths: geometry.map(displayPath),
            productDiffCount: paths.length,
            productDiff: paths.map(displayPath),
            stockLoft: hashes,
            baseSha: BASE_SHA,
        },
    };
}

async function gateFlush(tree, begin, MemoryStore) {
    const store = new MemoryStore();
    let entered = false;
    const pending = begin({
        store,
        insert: insert("left", "gate5"),
        now: FIXED_NOW,
        schedule: (work) => {
            work.catch(() => {});
        },
        execute: () => {
            entered = true;
            return Promise.resolve();
        },
    });
    const resolvedBeforeExecute = await pending.then(() => entered === false);
    if (!entered) {
        await new Promise((resolve) => setImmediate(resolve));
        if (!entered) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const source = deferralSource(
        readFileSync(path.join(tree, "vertex/server/src/lib/cad-operator-production.ts"), "utf8"),
    );
    const pass = resolvedBeforeExecute === true && entered === true && source.ok === true;
    return {
        id: "G5",
        name: "setImmediate or setTimeout(0) defers execute in beginCadOperatorProduction",
        pass,
        measured: {
            resolvedBeforeExecute,
            executeEnteredAfterDrain: entered,
            source,
        },
    };
}

async function runPair(handle, manufacturing) {
    const started = Date.now();
    const raced = await withHang(
        handle(
            "generate_gcode",
            { use_saved_design: true, design_id: DESIGN_ID },
            { config: config(), manufacturing },
        ),
        THRESHOLDS.pairHangCapMs,
    );
    return { raced, responseMs: Date.now() - started };
}

async function scenarioParallel(handle, begin, MemoryStore) {
    const store = new MemoryStore();
    const invoked = [];
    const flags = { left: false, right: false };
    const manufacturing = {
        generateFromSavedDesign: async (input) => {
            invoked.push({ side: input.side, at: Date.now() });
            flags[input.side] = true;
            const other = input.side === "left" ? "right" : "left";
            const waitStart = Date.now();
            while (!flags[other] && Date.now() - waitStart < THRESHOLDS.parallelProbeMs) {
                await sleep(20);
            }
            const started = await begin({
                store,
                insert: insert(input.side, "probe-parallel"),
                now: FIXED_NOW,
                schedule: (work) => {
                    work.catch(() => {});
                },
                execute: () => Promise.resolve(),
            });
            return { productionId: started.productionId, status: started.status, side: input.side };
        },
    };
    const { raced, responseMs } = await runPair(handle, manufacturing);
    return { invoked, raced, responseMs, invokeGapMs: gapMs(invoked) };
}

async function scenarioLoft(handle, begin, MemoryStore) {
    const store = new MemoryStore();
    const enqueued = [];
    const loftEntered = [];
    let suppressLoft = false;
    const manufacturing = {
        generateFromSavedDesign: async (input) => {
            const started = await begin({
                store,
                insert: insert(input.side, "probe-loft"),
                now: FIXED_NOW,
                schedule: (work) => {
                    work.catch(() => {});
                },
                execute: () => {
                    loftEntered.push({ side: input.side, at: Date.now() });
                    if (suppressLoft) return Promise.resolve();
                    const end = Date.now() + THRESHOLDS.loftBlockMs;
                    while (Date.now() < end) {
                        /* synchronous loft stand-in */
                    }
                    return Promise.resolve();
                },
            });
            enqueued.push({ side: input.side, at: Date.now(), productionId: started.productionId });
            return { productionId: started.productionId, status: started.status, side: input.side };
        },
    };
    const startedAt = Date.now();
    const raced = await withHang(
        handle(
            "generate_gcode",
            { use_saved_design: true, design_id: DESIGN_ID },
            { config: config(), manufacturing },
        ),
        THRESHOLDS.pairHangCapMs,
    );
    const responseMs = Date.now() - startedAt;
    const loftBeforeReturn = loftEntered.length;
    suppressLoft = true;
    return { enqueued, raced, responseMs, loftBeforeReturn, enqueueGapMs: gapMs(enqueued) };
}

function scorePair(parallel, loft) {
    const parallelValue = parallel.raced.kind === "done" ? parallel.raced.value : null;
    const loftValue = loft.raced.kind === "done" ? loft.raced.value : null;
    const parallelPayload = payloadOf(parallelValue);
    const loftPayload = payloadOf(loftValue);
    const parallelIds = pairIds(parallelPayload);
    const loftIds = pairIds(loftPayload);
    const g1 = {
        id: "G1",
        name: "saved-design generate_gcode with side omitted returns both production ids within 5s without waiting for loft",
        pass:
            loft.raced.kind === "done" &&
            !loftValue?.isError &&
            loft.responseMs <= THRESHOLDS.pairReturnBudgetMs &&
            loft.loftBeforeReturn === 0 &&
            loftIds.ok,
        measured: {
            responseMs: loft.responseMs,
            budgetMs: THRESHOLDS.pairReturnBudgetMs,
            loftBlockMs: THRESHOLDS.loftBlockMs,
            loftEnteredBeforeReturn: loft.loftBeforeReturn,
            race: loft.raced.kind,
            productionIds: loftIds.ids,
            bothIds: loftIds.ok,
            error: toolError(loftValue),
        },
    };
    const g2 = {
        id: "G2",
        name: "both feet are enqueued and started within a few seconds of each other",
        pass:
            parallel.invokeGapMs !== null &&
            parallel.invokeGapMs <= THRESHOLDS.pairStartGapBudgetMs &&
            loft.enqueueGapMs !== null &&
            loft.enqueueGapMs <= THRESHOLDS.pairStartGapBudgetMs &&
            parallelIds.ok &&
            loftIds.ok,
        measured: {
            invokeGapMs: parallel.invokeGapMs,
            enqueueGapMs: loft.enqueueGapMs,
            budgetMs: THRESHOLDS.pairStartGapBudgetMs,
            parallelProbeMs: THRESHOLDS.parallelProbeMs,
            invokeOrder: parallel.invoked.map((row) => row.side),
            bothInvoked: parallelIds.ok,
            bothEnqueued: loftIds.ok,
            error: toolError(parallelValue) || toolError(loftValue),
        },
    };
    return { g1, g2 };
}

async function gateWait(schema, handle) {
    const id = PRODUCTION_PROBE_ID;
    const parsed300 = schema.safeParse({ production_id: id, wait_s: THRESHOLDS.waitSCap });
    const parsed301 = schema.safeParse({ production_id: id, wait_s: THRESHOLDS.waitSReject });
    const parsed0 = schema.safeParse({ production_id: id, wait_s: 0 });
    const capOk =
        parsed300.success === true &&
        parsed300.data.wait_s === THRESHOLDS.waitSCap &&
        parsed301.success === false &&
        parsed0.success === true &&
        parsed0.data.wait_s === 0;

    async function once(args) {
        let fetches = 0;
        const manufacturing = {
            getProduction: async () => {
                fetches += 1;
                return { productionId: id, status: "pending", side: "left" };
            },
        };
        const started = Date.now();
        const result = await handle("get_production", args, { config: config(), manufacturing });
        return { fetches, elapsedMs: Date.now() - started, isError: result.isError === true };
    }

    const omitted = await once({ production_id: id });
    const zero = await once({ production_id: id, wait_s: 0 });
    const zeroOk =
        omitted.fetches === 1 &&
        omitted.elapsedMs <= THRESHOLDS.zeroFetchMaxMs &&
        omitted.isError === false &&
        zero.fetches === 1 &&
        zero.elapsedMs <= THRESHOLDS.zeroFetchMaxMs &&
        zero.isError === false;
    let positive = null;
    if (capOk && zeroOk) {
        positive = await once({ production_id: id, wait_s: THRESHOLDS.positiveWaitS });
    }
    const positiveOk =
        positive !== null &&
        positive.fetches >= THRESHOLDS.positiveWaitMinFetches &&
        positive.elapsedMs >= THRESHOLDS.positiveWaitMinMs &&
        positive.elapsedMs <= THRESHOLDS.positiveWaitMaxMs &&
        positive.isError === false;
    return {
        id: "G3",
        name: "get_production wait_s cap is 300 and 0 stays a single fetch",
        pass: capOk && zeroOk && positiveOk,
        measured: {
            cap: THRESHOLDS.waitSCap,
            accepts300: parsed300.success === true && parsed300.data?.wait_s === 300,
            rejects301: parsed301.success === false,
            retainsZero: parsed0.success === true && parsed0.data?.wait_s === 0,
            omittedFetches: omitted.fetches,
            omittedMs: omitted.elapsedMs,
            zeroFetches: zero.fetches,
            zeroMs: zero.elapsedMs,
            positiveWaitS: positive ? THRESHOLDS.positiveWaitS : null,
            positiveFetches: positive?.fetches ?? null,
            positiveMs: positive?.elapsedMs ?? null,
            positiveMinFetches: THRESHOLDS.positiveWaitMinFetches,
            positiveMinMs: THRESHOLDS.positiveWaitMinMs,
            positiveMaxMs: THRESHOLDS.positiveWaitMaxMs,
        },
    };
}

function failedGate(id, name, error) {
    return {
        id,
        name,
        pass: false,
        measured: { error: redact(error?.stack || error?.message || error).slice(0, 800) },
    };
}

async function main() {
    const tree = path.resolve(arg("--tree") ?? path.resolve(import.meta.dirname, "../.."));
    const out = arg("--out");
    let head = null;
    try {
        head = String(git(tree, ["rev-parse", "HEAD"])).trim();
    } catch (error) {
        head = redact(error.message);
    }
    const report = {
        baseSha: BASE_SHA,
        tree,
        head,
        thresholds: THRESHOLDS,
        gates: [],
        pass: false,
    };
    try {
        const handlers = await import(pathToFileURL(path.join(tree, "packages/mcp/src/tools/handlers.ts")).href);
        const production = await import(
            pathToFileURL(path.join(tree, "vertex/server/src/lib/cad-operator-production.ts")).href
        );
        const schemas = await import(pathToFileURL(path.join(tree, "packages/mcp/src/tools/schemas.ts")).href);
        const handle = handlers.handleOrthocadTool;
        const begin = production.beginCadOperatorProduction;
        const MemoryStore = production.MemoryCadProductionStore;
        process.stderr.write("gate G5 flush deferral\n");
        const g5 = await gateFlush(tree, begin, MemoryStore);
        process.stderr.write("gate G2 parallel enqueue\n");
        const parallel = await scenarioParallel(handle, begin, MemoryStore);
        process.stderr.write("gate G1 loft flush\n");
        const loft = await scenarioLoft(handle, begin, MemoryStore);
        const scored = scorePair(parallel, loft);
        process.stderr.write("gate G3 wait_s\n");
        const g3 = await gateWait(schemas.getProductionInputSchema, handle);
        process.stderr.write("gate G4 bytes\n");
        const g4 = gateBytes(tree);
        report.gates = [scored.g1, scored.g2, g3, g4, g5];
    } catch (error) {
        process.stderr.write(`gate load failed: ${redact(error?.message || error)}\n`);
        report.gates = [
            failedGate("G1", "pair return", error),
            failedGate("G2", "pair start gap", error),
            failedGate("G3", "wait_s", error),
            gateBytes(tree),
            failedGate("G5", "flush deferral", error),
        ];
    }
    report.pass = report.gates.every((gate) => gate.pass === true);
    const json = JSON.stringify(report, null, 2);
    if (out) writeFileSync(out, json);
    process.stdout.write(`${json}\n`);
    process.exit(report.pass ? 0 : 1);
}

main();
