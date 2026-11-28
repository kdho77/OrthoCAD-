#!/usr/bin/env node
/**
 * Frozen grader for the narrow-heelcup preloft defect.
 * Reads a product tree. Does not modify it. Does not edit these gates.
 *
 *   node validation/narrow_heelcup_preloft_gates/run-gates.mjs \
 *     --product <checkout> --mode base|candidate --runtime full|identity|defect|none \
 *     --out <report.json> [--only id,id] [--require-pass G-R1,...] [--require-fail G-R1,...]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const expected = JSON.parse(readFileSync(join(here, "expected.json"), "utf8"));

function arg(name, fallback = "") {
    const i = process.argv.indexOf(name);
    if (i === -1) return fallback;
    return process.argv[i + 1] ?? fallback;
}

function listArg(name) {
    const raw = arg(name, "");
    return raw
        ? raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
        : [];
}

const product = resolve(arg("--product", repo));
const mode = arg("--mode", "base");
const runtime = arg("--runtime", "none");
const outPath = resolve(arg("--out", join(here, "last-run.json")));
const only = arg("--only", "");
const requirePass = listArg("--require-pass");
const requireFail = listArg("--require-fail");

function git(args, cwd = product) {
    return execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    });
}

function gitOk(args, cwd = product) {
    try {
        return git(args, cwd).trim();
    } catch {
        return null;
    }
}

function redact(text) {
    return String(text)
        .replace(/api_key\s*=\s*"[^"]*"/gi, 'api_key="[redacted]"')
        .replace(/bearer\s+\S+/gi, "bearer [redacted]")
        .replace(/sk_live_\S+/g, "sk_live_[redacted]")
        .replace(/ghp_\S+/g, "ghp_[redacted]");
}

function changedFiles() {
    const chunks = [
        gitOk(["diff", "--name-only", expected.baseSha]) ?? "",
        gitOk(["diff", "--name-only", "--cached", expected.baseSha]) ?? "",
        gitOk(["ls-files", "--others", "--exclude-standard"]) ?? "",
    ];
    const names = new Set();
    for (const chunk of chunks) {
        for (const line of chunk.split("\n")) {
            const name = line.trim();
            if (!name) continue;
            if (name.startsWith("validation/narrow_heelcup_preloft_gates/")) continue;
            if (name === "node_modules" || name.startsWith("node_modules/")) continue;
            if (name === "vertex/node_modules" || name.startsWith("vertex/node_modules/")) continue;
            names.add(name);
        }
    }
    return [...names].sort();
}

function sameBlob(rel) {
    const baseHash = gitOk(["rev-parse", `${expected.baseSha}:${rel}`]);
    if (!baseHash) return { rel, ok: false, reason: "missing on BASE" };
    if (!existsSync(join(product, rel))) return { rel, ok: false, reason: "missing on product", baseHash };
    const now = gitOk(["hash-object", rel]);
    return { rel, ok: now === baseHash, baseHash, now };
}

function blobGroup(rels) {
    const rows = rels.map(sameBlob);
    const bad = rows.filter((row) => !row.ok);
    return { ok: bad.length === 0, rows, bad };
}

function readConst(rel, name) {
    const text = readFileSync(join(product, rel), "utf8");
    const matched = text.match(new RegExp(`export const ${name} = ([0-9.]+);`));
    return matched ? Number(matched[1]) : null;
}

function addedLines() {
    const parts = [
        gitOk([
            "diff",
            "-U0",
            expected.baseSha,
            "--",
            ".",
            ":(exclude)validation/narrow_heelcup_preloft_gates",
        ]) ?? "",
        gitOk([
            "diff",
            "--cached",
            "-U0",
            expected.baseSha,
            "--",
            ".",
            ":(exclude)validation/narrow_heelcup_preloft_gates",
        ]) ?? "",
    ];
    const lines = [];
    for (const part of parts) {
        for (const line of part.split("\n")) {
            if (line.startsWith("+") && !line.startsWith("+++")) lines.push(line.slice(1));
        }
    }
    for (const rel of changedFiles()) {
        if (!existsSync(join(product, rel))) continue;
        const base = gitOk(["cat-file", "-e", `${expected.baseSha}:${rel}`]);
        if (base === null && gitOk(["cat-file", "-t", `${expected.baseSha}:${rel}`]) === null) {
            try {
                const body = readFileSync(join(product, rel), "utf8");
                lines.push(...body.split("\n"));
            } catch {
                // binary untracked file: path checks still see the name
            }
        }
    }
    return lines;
}

function secretHits(lines) {
    const patterns = [/api_key/i, /bearer\s/i, /sk_live_/, /ghp_/, /xox[baprs]-/];
    return lines.filter((line) => patterns.some((pattern) => pattern.test(line))).map(redact);
}

function phiHits(lines) {
    return lines.filter((line) => /patient(Name|DisplayName)\s*[:=]\s*["'][A-Za-z]{2,}/.test(line));
}

function allowed(rel) {
    return expected.allowPrefixes.some((prefix) =>
        prefix.endsWith("/") ? rel.startsWith(prefix) : rel === prefix,
    );
}

function shardOk(changed) {
    const rel = "ci/unit-test-shards.json";
    if (!changed.includes(rel)) return { ok: true, detail: "unchanged" };
    const diff = gitOk(["diff", "-U0", expected.baseSha, "--", rel]) ?? "";
    const removed = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"));
    const added = diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .map((line) => line.slice(1).trim());
    const badAdded = added.filter(
        (line) => !/"vertex\/src\/lib\/geometry\/procedural-wall\/[^"]+\.test\.ts"/.test(line),
    );
    return {
        ok: removed.length === 0 && badAdded.length === 0,
        removed: removed.length,
        badAdded,
    };
}

function constructionFiles(changed) {
    const blocked = new Set([
        ...expected.identicalFiles.threshold,
        ...expected.identicalFiles.r1,
        ...expected.identicalFiles.r4,
    ]);
    return changed.filter((rel) => {
        if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false;
        if (blocked.has(rel)) return false;
        if (rel.startsWith("vertex/src/lib/geometry/procedural-wall/")) return true;
        return (
            rel === "vertex/src/lib/geometry/shoe-width.ts" ||
            rel === "vertex/src/lib/geometry/shoe-size.ts" ||
            rel === "vertex/src/lib/geometry/height-field.ts"
        );
    });
}

function findWorkerTests() {
    const root = join(product, "vertex");
    let listed = "";
    try {
        listed = execFileSync("rg", ["-l", "-g", "*.test.ts", "heelCupHeightMm", root], {
            encoding: "utf8",
        });
    } catch {
        listed = "";
    }
    const hits = [];
    for (const abs of listed.split("\n").filter(Boolean)) {
        const text = readFileSync(abs, "utf8");
        if (
            !text.includes("met_pad") ||
            !text.includes("narrow") ||
            !text.includes("buildProceduralExportSolid")
        ) {
            continue;
        }
        hits.push(abs.slice(product.length + 1));
    }
    return hits;
}

function runCommand(cmd, args, cwd, env, timeout) {
    const started = Date.now();
    const result = spawnSync(cmd, args, {
        cwd,
        env,
        encoding: "utf8",
        timeout,
        maxBuffer: 32 * 1024 * 1024,
    });
    const tail = redact(`${result.stdout ?? ""}\n${result.stderr ?? ""}`).slice(-2500);
    return {
        status: result.status,
        ms: Date.now() - started,
        tail,
        error: result.error ? String(result.error.message ?? result.error) : "",
    };
}

function runRuntime() {
    const runtimeOut = join(here, `.runtime-${process.pid}.json`);
    const config = join(here, "rstest.gate.config.ts");
    const env = {
        ...process.env,
        GATE_PRODUCT_ROOT: product,
        GATE_CASES_JSON: join(here, "expected.json"),
        GATE_OUT: runtimeOut,
        GATE_ONLY: only,
    };
    const command = `npx rstest --config validation/narrow_heelcup_preloft_gates/rstest.gate.config.ts`;
    const ran = runCommand("npx", ["rstest", "--config", config], repo, env, 900_000);
    let measured = null;
    if (existsSync(runtimeOut)) {
        measured = JSON.parse(readFileSync(runtimeOut, "utf8"));
        unlinkSync(runtimeOut);
    }
    return { command, ...ran, measured };
}

function runExistingTests() {
    const command = `npx rstest ${expected.existingTests.join(" ")}`;
    const ran = runCommand("npx", ["rstest", ...expected.existingTests], product, process.env, 900_000);
    return { command, ...ran };
}

function runWorkerTests(files) {
    if (files.length === 0)
        return {
            command: "rg heelCupHeightMm vertex -g '*.test.ts'",
            status: 1,
            ms: 0,
            tail: "no test file",
            measuredFiles: files,
        };
    const command = `npx rstest ${files.join(" ")}`;
    const ran = runCommand("npx", ["rstest", ...files], product, process.env, 900_000);
    return { command, ...ran, measuredFiles: files };
}

function gate(id, status, measured, threshold, evidence, command) {
    return { id, status, measured: redact(measured), threshold, evidence: redact(evidence), command };
}

function containsSignature(message) {
    const text = message ?? "";
    const missing = expected.signature.filter((part) => !text.includes(part));
    return { ok: missing.length === 0, missing };
}

function gradeIdentity(runtimeReport, partial) {
    const rows = [];
    let ok = true;
    for (const row of expected.identity) {
        if (partial && runtimeReport?.identity?.[row.id] == null) continue;
        const got = runtimeReport?.identity?.[row.id];
        if (!got) {
            ok = false;
            rows.push(`${row.id}: missing`);
            continue;
        }
        const hashOk = got.ok === true && got.hash === row.hash && got.verts === row.verts;
        if (!hashOk) ok = false;
        rows.push(
            `${row.id}: ok=${got.ok} verts ${got.verts ?? "n/a"} vs ${row.verts} hash ${got.hash === row.hash ? "match" : "DIFF"}`,
        );
    }
    if (!partial && rows.length !== expected.identity.length) ok = false;
    return { ok, detail: rows.join("; ") };
}

const changed = changedFiles();
const thresholdBlobs = blobGroup(expected.identicalFiles.threshold);
const r1Blobs = blobGroup(expected.identicalFiles.r1);
const r2Blobs = blobGroup(expected.identicalFiles.r2);
const r4Blobs = blobGroup(expected.identicalFiles.r4);
const r5Files = (gitOk(["ls-tree", "-r", "--name-only", expected.baseSha, expected.r5Prefix]) ?? "")
    .split("\n")
    .filter(Boolean);
const r5Blobs = blobGroup(r5Files);
const r5New = changed.filter((rel) => rel.startsWith(expected.r5Prefix) || /engrav/i.test(rel));
const meshNew = changed.filter((rel) => /\.(glb|stl|obj|3mf|ply)$/i.test(rel));
const scopeBad = changed.filter((rel) => !allowed(rel));
const shard = shardOk(changed);
const secrets = secretHits(addedLines());
const phi = phiHits(addedLines());
const deploy = changed.filter((rel) =>
    /(^|\/)(vertex-web|vertex-api|print-bridge)(\/|$)|railway|print-bridge-/.test(rel),
);
const ratioGates = readConst("vertex/src/lib/geometry/procedural-wall/station-gates.ts", "SKEW_INSET_RATIO");
const ratioStations = readConst("vertex/src/lib/geometry/procedural-wall/stations.ts", "SKEW_INSET_RATIO");
const skewLimit = readConst("vertex/src/lib/geometry/procedural-wall/stations.ts", "SKEW_LIMIT_MM");
const heading = readConst(
    "vertex/src/lib/geometry/procedural-wall/station-gates.ts",
    "PRELOFT_HEADING_MAX_DEG",
);
const dihedral = readConst(
    "vertex/src/lib/geometry/procedural-wall/station-gates.ts",
    "POSTLOFT_DIHEDRAL_MAX_DEG",
);
const numbersOk =
    ratioGates === expected.thresholds.SKEW_INSET_RATIO &&
    ratioStations === expected.thresholds.SKEW_INSET_RATIO &&
    skewLimit === expected.thresholds.SKEW_LIMIT_MM &&
    heading === expected.thresholds.PRELOFT_HEADING_MAX_DEG &&
    dihedral === expected.thresholds.POSTLOFT_DIHEDRAL_MAX_DEG;
const redefined = addedLines().filter((line) =>
    /SKEW_INSET_RATIO\s*=\s*(?!0\.5\b)|SKEW_LIMIT_MM\s*=\s*(?!2\b)|PRELOFT_HEADING_MAX_DEG\s*=\s*(?!15\b)|POSTLOFT_DIHEDRAL_MAX_DEG\s*=\s*(?!150\b)/.test(
        line,
    ),
);
const constructed = constructionFiles(changed);
const head = gitOk(["rev-parse", "HEAD"]);
const ancestor = spawnSync("git", [
    "-C",
    product,
    "merge-base",
    "--is-ancestor",
    expected.candidateSha,
    expected.baseSha,
]);

let runtimeReport = null;
let runtimeMeta = null;
if (runtime === "full" || runtime === "identity" || runtime === "defect") {
    runtimeMeta = runRuntime();
    runtimeReport = runtimeMeta.measured;
}

let existingMeta = null;
if (runtime === "full" || runtime === "existing") {
    existingMeta = runExistingTests();
}

let workerFiles = [];
let workerMeta = null;
if (runtime === "full" || runtime === "worker") {
    workerFiles = findWorkerTests();
    workerMeta = runWorkerTests(workerFiles);
}

const ref = expected.identity.find((row) => row.id === expected.vertBand.referenceId);
const minVerts = Math.round(ref.verts * expected.vertBand.minRatio);
const maxVerts = Math.round(ref.verts * expected.vertBand.maxRatio);
const identityHashes = new Set(expected.identity.map((row) => row.hash));
const loft = runtimeReport?.defect?.loft;
const headless = runtimeReport?.defect?.headless;
const loftSignature = containsSignature(loft?.message);
const headlessSignature = containsSignature(headless?.message);
const loftClean =
    loft?.ok === true &&
    typeof loft.verts === "number" &&
    loft.verts >= minVerts &&
    loft.verts <= maxVerts &&
    !identityHashes.has(loft.hash);
const headlessClean =
    headless?.ok === true &&
    typeof headless.solidTriangles === "number" &&
    headless.solidTriangles >= expected.headlessMinTriangles;
const partialIdentity = only.length > 0;

const gates = [];

gates.push(
    gate(
        "G-R1",
        r1Blobs.ok ? "PASS" : "FAIL",
        r1Blobs.ok
            ? `${r1Blobs.rows.length} surface/seam files byte-identical to BASE`
            : r1Blobs.bad.map((row) => row.rel).join(", "),
        "kiri, base-modifier, wall-spline, ring-seam, densify-stations unchanged",
        "R1 print surface quality is untouched",
        "git hash-object vs BASE",
    ),
);
gates.push(
    gate(
        "G-R2",
        r2Blobs.ok ? "PASS" : "FAIL",
        r2Blobs.ok
            ? `${r2Blobs.rows.length} slicer files byte-identical to BASE`
            : r2Blobs.bad.map((row) => row.rel).join(", "),
        "kiri engine/gcode/presets/slicer unchanged",
        "R2 seam and layer-change placement stays on the existing bottom path",
        "git hash-object vs BASE",
    ),
);
gates.push(
    gate(
        "G-R3",
        scopeBad.length === 0 && shard.ok ? "PASS" : "FAIL",
        `changed=${changed.length ? changed.join(" ") : "(none)"}; outside=${scopeBad.join(" ") || "(none)"}; shardRemoved=${shard.removed ?? 0}`,
        "only procedural-wall, shoe-width, shoe-size, height-field, and an additive procedural-wall shard line",
        "R3 scope stays on the preloft outline defect",
        "git diff --name-only BASE",
    ),
);
gates.push(
    gate(
        "G-R4",
        r4Blobs.ok && meshNew.length === 0 ? "PASS" : "FAIL",
        `meshPaths=${meshNew.join(" ") || "(none)"}; id/glb ${r4Blobs.ok ? "match BASE" : r4Blobs.bad.map((row) => row.rel).join(", ")}`,
        "SAMPLE_Top id and both SAMPLE_Top.glb blobs unchanged; no new glb/stl/obj/3mf/ply",
        "R4 designs still start from the approved SAMPLE_Top stock mesh",
        "git hash-object SAMPLE_Top.glb",
    ),
);
gates.push(
    gate(
        "G-R5",
        r5Blobs.ok && r5New.length === 0 ? "PASS" : "FAIL",
        `text-marking files ${r5Blobs.rows.length}; new=${r5New.join(" ") || "(none)"}`,
        "vertex/src/lib/geometry/text-marking identical to BASE; no new engraving file",
        "R5 patient marking stays on the existing textMarking bottom engrave",
        "git hash-object text-marking",
    ),
);
gates.push(
    gate(
        "G-R6",
        secrets.length === 0 && phi.length === 0 && deploy.length === 0 ? "PASS" : "FAIL",
        `secretLines=${secrets.length}; phiLines=${phi.length}; deployPaths=${deploy.join(" ") || "(none)"}`,
        "no api_key/bearer/token-like secret, no patient name literal, no vertex-web/vertex-api/railway/print-bridge path",
        "R6 secrets, PHI, Railway, and printers stay out of the diff",
        "git diff -U0 | secret scan",
    ),
);
gates.push(
    gate(
        "G-MUST-THRESHOLD",
        thresholdBlobs.ok && numbersOk && redefined.length === 0 ? "PASS" : "FAIL",
        `SKEW_INSET_RATIO station-gates=${ratioGates} stations=${ratioStations}; SKEW_LIMIT_MM=${skewLimit}; PRELOFT_HEADING_MAX_DEG=${heading}; POSTLOFT_DIHEDRAL_MAX_DEG=${dihedral}; redefined=${redefined.length}; blobs=${thresholdBlobs.ok}`,
        `SKEW_INSET_RATIO=${expected.thresholds.SKEW_INSET_RATIO}; SKEW_LIMIT_MM=${expected.thresholds.SKEW_LIMIT_MM}; PRELOFT_HEADING_MAX_DEG=${expected.thresholds.PRELOFT_HEADING_MAX_DEG}; POSTLOFT_DIHEDRAL_MAX_DEG=${expected.thresholds.POSTLOFT_DIHEDRAL_MAX_DEG}; station-gates.ts stations.ts reconstruct.ts identical`,
        "MUST-MATCH skew thresholds unchanged",
        "git hash-object + const parse",
    ),
);

const identity = runtimeReport ? gradeIdentity(runtimeReport, partialIdentity) : null;
if (identity) {
    const r7 = runtimeReport?.identity?.["s9-medium"];
    const r7pin = expected.identity.find((row) => row.id === "s9-medium");
    const r7ok = r7?.ok === true && r7.hash === r7pin.hash && r7.verts === r7pin.verts;
    const r7Missing = partialIdentity && r7 == null;
    gates.push(
        gate(
            "G-R7",
            r7Missing ? "SKIP" : r7ok ? "PASS" : "FAIL",
            r7Missing
                ? "not measured in this partial run"
                : `verts ${r7?.verts ?? "n/a"} vs ${r7pin.verts}; hash ${r7?.hash === r7pin.hash ? "match" : (r7?.hash ?? r7?.message ?? "missing")}`,
            `sha256 ${r7pin.hash} verts ${r7pin.verts}`,
            "R7 SAMPLE_Top stock with no corrections is byte-identical",
            runtimeMeta?.command ?? "",
        ),
    );
    gates.push(
        gate(
            "G-MUST-IDENTITY",
            identity.ok ? "PASS" : "FAIL",
            identity.detail || "no rows",
            "every already-exporting design matches the BASE hash and vertex count",
            "MUST-MATCH designs that already export produce identical meshes",
            runtimeMeta?.command ?? "",
        ),
    );
}

const onlyIds = only
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const measureDefect =
    runtime === "full" ||
    runtime === "defect" ||
    (runtime === "identity" &&
        (onlyIds.length === 0 || onlyIds.includes("defect") || onlyIds.includes(expected.defect.id)));
if (measureDefect) {
    const ranDefect = loft != null || headless != null;
    gates.push(
        gate(
            "G-REPRO",
            ranDefect && loftSignature.ok && headlessSignature.ok ? "PASS" : "FAIL",
            `loftMissing=${loftSignature.missing.join("|") || "(none)"}; headlessMissing=${headlessSignature.missing.join("|") || "(none)"}`,
            expected.signature.join(" && "),
            "BASE reproduces the production S1-PRELOFT signature on US M6 narrow, heel cup 9 mm, default met pad",
            runtimeMeta?.command ?? "",
        ),
    );
    gates.push(
        gate(
            "G-TESTS-EXPORT",
            ranDefect && loftClean && headlessClean ? "PASS" : "FAIL",
            `loftOk=${loft?.ok === true} verts=${loft?.verts ?? "n/a"} band=[${minVerts},${maxVerts}] substituted=${loft?.hash ? identityHashes.has(loft.hash) : "n/a"}; headlessOk=${headless?.ok === true} triangles=${headless?.solidTriangles ?? "n/a"} (min ${expected.headlessMinTriangles}); loftMsg=${(loft?.message ?? "").slice(0, 180)}; headlessMsg=${(headless?.message ?? "").slice(0, 180)}`,
            `loft succeeds, verts in [${minVerts},${maxVerts}], hash is not an already-exporting mesh; headless solid triangles >= ${expected.headlessMinTriangles}; no S1-PRELOFT`,
            "TESTS narrow width, heel cup 9 mm, default met pad exports headless with no S1-PRELOFT skew failure",
            runtimeMeta?.command ?? "",
        ),
    );
    const oneOk =
        loftClean &&
        headlessClean &&
        thresholdBlobs.ok &&
        numbersOk &&
        redefined.length === 0 &&
        constructed.length > 0;
    gates.push(
        gate(
            "G-ONE",
            oneOk ? "PASS" : "FAIL",
            `export=${loftClean && headlessClean}; threshold=${thresholdBlobs.ok && numbersOk && redefined.length === 0}; constructionFiles=${constructed.join(" ") || "(none)"}`,
            "headless export succeeds, skew constants and gate files unchanged, and a construction file moved",
            "ONE fix the construction; do not just raise the skew threshold",
            runtimeMeta?.command ?? "",
        ),
    );
}

if (existingMeta) {
    gates.push(
        gate(
            "G-TESTS-EXISTING",
            existingMeta.status === 0 ? "PASS" : "FAIL",
            `exit ${existingMeta.status} in ${existingMeta.ms} ms`,
            "exit 0",
            "TESTS existing tests green",
            existingMeta.command,
        ),
    );
}

if (workerMeta) {
    const pass = workerFiles.length > 0 && workerMeta.status === 0;
    gates.push(
        gate(
            "G-TESTS-NEW",
            pass ? "PASS" : "FAIL",
            `files=${workerFiles.join(" ") || "(none)"} exit=${workerMeta.status}`,
            "at least one vertex test names narrow + heelCupHeightMm + met_pad + buildProceduralExportSolid and rstest exits 0",
            "TESTS new test reproduces the narrow / heel cup 9 mm / default met pad export",
            workerMeta.command,
        ),
    );
}

if (mode === "candidate") {
    const shaOk = head === expected.candidateSha;
    const notMerged = ancestor.status !== 0;
    gates.push(
        gate(
            "G-PUSH",
            shaOk && notMerged ? "PASS" : "FAIL",
            `HEAD=${head}; candidate=${expected.candidateSha}; mergedIntoBase=${ancestor.status === 0}`,
            `HEAD ${expected.candidateSha} and that commit is not contained in BASE`,
            "PUSH candidate is the worker draft head and is not merged to main",
            "git rev-parse HEAD && git merge-base --is-ancestor",
        ),
    );
}

const report = {
    mode,
    product,
    baseSha: expected.baseSha,
    head,
    changed,
    gates,
    runtimeTail: runtimeMeta ? runtimeMeta.tail.slice(-800) : "",
    existingTail: existingMeta && existingMeta.status !== 0 ? existingMeta.tail.slice(-800) : "",
};
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`mode=${mode} product=${product} changed=${changed.length}`);
for (const row of gates) {
    console.log(`${row.status}\t${row.id}\t${row.measured}`);
}

let exit = 0;
for (const id of requirePass) {
    const row = gates.find((item) => item.id === id);
    if (!row || row.status !== "PASS") {
        console.error(`required PASS missing: ${id} (${row?.status ?? "absent"})`);
        exit = 1;
    }
}
for (const id of requireFail) {
    const row = gates.find((item) => item.id === id);
    if (!row || row.status !== "FAIL") {
        console.error(`required FAIL missing: ${id} (${row?.status ?? "absent"})`);
        exit = 1;
    }
}
if (mode === "candidate" && requirePass.length === 0 && requireFail.length === 0) {
    const must = [
        "G-R1",
        "G-R2",
        "G-R3",
        "G-R4",
        "G-R5",
        "G-R6",
        "G-MUST-THRESHOLD",
        "G-R7",
        "G-MUST-IDENTITY",
        "G-TESTS-EXPORT",
        "G-ONE",
        "G-TESTS-EXISTING",
        "G-TESTS-NEW",
        "G-PUSH",
    ];
    for (const id of must) {
        const row = gates.find((item) => item.id === id);
        if (!row || row.status !== "PASS") exit = 1;
    }
}
process.exit(exit);
