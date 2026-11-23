/**
 * Frozen gate runner. Compares a subject tree to pinned thresholds and to BASE
 * file bytes. Does not modify the subject.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THRESHOLDS = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8"));
const LOCKED = JSON.parse(readFileSync(path.join(HERE, "locked-files.json"), "utf8"));
const SCOPE = JSON.parse(readFileSync(path.join(HERE, "scope.json"), "utf8"));
const BASE_SHA = THRESHOLDS.baseSha;

function arg(name, fallback = undefined) {
    const i = process.argv.indexOf(name);
    if (i < 0) return fallback;
    return process.argv[i + 1];
}

function hasFlag(name) {
    return process.argv.includes(name);
}

const subject = path.resolve(arg("--subject"));
const baselineJson = arg("--baseline-json");
const outPath = arg("--out");
const only = new Set(
    (arg("--only", "") || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
);
const skipExisting = hasFlag("--skip-existing-tests");
const expectHead = arg("--expect-head", "");

function wanted(id) {
    return only.size === 0 || only.has(id);
}

function sha256File(file) {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sha256Buffer(buf) {
    return createHash("sha256").update(buf).digest("hex");
}

function git(args, cwd = subject) {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function baseBytes(rel) {
    return execFileSync("git", ["show", `${BASE_SHA}:${rel}`], { cwd: subject });
}

function zeroOrAbsent(value) {
    return value === null || value === 0;
}

function exactQuad(read, expected) {
    if (!read) return false;
    return (
        read.Lmed === expected.Lmed &&
        read.Llat === expected.Llat &&
        read.Rmed === expected.Rmed &&
        read.Rlat === expected.Rlat
    );
}

function leftRequestOk(read) {
    if (!read) return false;
    return (
        read.Lmed === THRESHOLDS.medialMm &&
        zeroOrAbsent(read.Llat) &&
        read.Llat !== THRESHOLDS.forbiddenLateralDefaultMm &&
        zeroOrAbsent(read.Rmed) &&
        zeroOrAbsent(read.Rlat) &&
        read.rightFlangePaths === false
    );
}

function fmtRead(read) {
    if (!read) return "missing";
    const lat = read.Llat === null ? "absent" : String(read.Llat);
    const rmed = read.Rmed === null ? "absent" : String(read.Rmed);
    const rlat = read.Rlat === null ? "absent" : String(read.Rlat);
    return `L med ${read.Lmed} lat ${lat}; R med ${rmed} lat ${rlat}; rightPaths ${read.rightFlangePaths}`;
}

function changedPaths() {
    const tracked = git(["diff", "--name-only", BASE_SHA])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const untracked = git(["ls-files", "--others", "--exclude-standard"])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    return [...new Set([...tracked, ...untracked])].sort();
}

function addedLines() {
    const diff = git(["diff", "-U0", BASE_SHA]);
    const lines = [];
    for (const line of diff.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+")) lines.push(line.slice(1));
    }
    for (const rel of git(["ls-files", "--others", "--exclude-standard"]).split("\n")) {
        const name = rel.trim();
        if (!name) continue;
        const file = path.join(subject, name);
        if (!existsSync(file)) continue;
        try {
            lines.push(...readFileSync(file, "utf8").split("\n"));
        } catch {
            lines.push(`<unreadable ${name}>`);
        }
    }
    return lines;
}

function fileLock(id, files) {
    const mismatches = [];
    for (const rel of files) {
        const abs = path.join(subject, rel);
        if (!existsSync(abs)) {
            mismatches.push(`${rel} missing`);
            continue;
        }
        let base;
        try {
            base = sha256Buffer(baseBytes(rel));
        } catch (error) {
            mismatches.push(`${rel} base-unreadable`);
            continue;
        }
        const now = sha256File(abs);
        if (now !== base) mismatches.push(rel);
    }
    const pass = mismatches.length === 0;
    return {
        id,
        pass,
        measured: pass
            ? `0 files differ (${files.length} checked)`
            : `${mismatches.length} differ: ${mismatches.join(", ")}`,
        threshold: "0 files differ from BASE sha256",
    };
}

function allowsPath(rel) {
    const lower = rel.toLowerCase();
    if (SCOPE.denySubstrings.some((part) => lower.includes(part.toLowerCase()))) return false;
    if (SCOPE.allowExact.includes(rel)) return true;
    const isFlangeTest =
        /flange/i.test(rel) &&
        /\.test\./.test(rel) &&
        !rel.includes("vertex/src/lib/geometry/") &&
        !rel.includes("vertex/src/lib/kiri/");
    return isFlangeTest;
}

function gateExplicit(probe) {
    const freshOk = leftRequestOk(probe.explicitFresh) && probe.explicitFresh?.parsedLateral === 0;
    const persistOk = leftRequestOk(probe.explicitPersist) && probe.explicitPersist?.parsedLateral === 0;
    return {
        id: "G_ONE_EXPLICIT",
        pass: Boolean(freshOk && persistOk),
        measured: `fresh [${fmtRead(probe.explicitFresh)}] parsedLateral ${probe.explicitFresh?.parsedLateral}; persist [${fmtRead(probe.explicitPersist)}]`,
        threshold:
            "flange.left {medial_mm:3, lateral_mm:0} fresh and persist-over-stored-lateral-3: L medial 3, L lateral 0 or absent, R medial/lateral 0 or absent, no right flange paths",
    };
}

function gateOmitted(probe) {
    const freshOk = leftRequestOk(probe.omittedFresh) && probe.omittedFresh?.parsedLateral === "absent";
    const persistOk = leftRequestOk(probe.omittedPersist) && probe.omittedPersist?.parsedLateral === "absent";
    return {
        id: "G_TESTS_OMITTED",
        pass: Boolean(freshOk && persistOk),
        measured: `fresh [${fmtRead(probe.omittedFresh)}]; persist [${fmtRead(probe.omittedPersist)}]`,
        threshold:
            "flange.left {medial_mm:3} with lateral_mm omitted, fresh and persist-over-stored-lateral-3: L medial 3, L lateral 0 or absent (not 3), nothing on R",
    };
}

function gateSliders(probe) {
    const expect = {
        Lmed: THRESHOLDS.sliders.medialFlangeMm,
        Llat: THRESHOLDS.sliders.lateralFlangeMm,
        Rmed: THRESHOLDS.sliders.rightMedialFlangeMm,
        Rlat: THRESHOLDS.sliders.rightLateralFlangeMm,
    };
    const freshOk = exactQuad(probe.slidersFresh, expect) && probe.slidersFresh?.rightFlangePaths === false;
    const persistOk =
        exactQuad(probe.slidersPersist, expect) && probe.slidersPersist?.rightFlangePaths === false;
    return {
        id: "G_MUST_SLIDERS",
        pass: Boolean(freshOk && persistOk),
        measured: `fresh [${fmtRead(probe.slidersFresh)}]; persist [${fmtRead(probe.slidersPersist)}]`,
        threshold:
            "sliders_by_side.left {medial_flange_mm:3, lateral_flange_mm:0} fresh and persist-over-stored-lateral-3: L 3/0, R 0/0",
    };
}

function gateBilateral(probe) {
    const names = ["split", "emptyLeft", "mildRight", "highLeft", "levelPlusMedial"];
    const failed = [];
    for (const name of names) {
        const read = probe.bilateral?.[name];
        const expected = THRESHOLDS.bilateral[name];
        if (!exactQuad(read, expected)) failed.push(`${name} [${fmtRead(read)}]`);
    }
    return {
        id: "G_MUST_BILATERAL",
        pass: failed.length === 0,
        measured: failed.length === 0 ? "5 bilateral/level cases match" : failed.join("; "),
        threshold:
            "split 4/5 and 6/1; empty left 3/3; mild right 2/2; high left 6/6; level high + medial 3 keeps lateral 6",
    };
}

function gateR7(probe, baseline, head) {
    if (!baselineJson && head !== BASE_SHA) {
        return {
            id: "G_R7_UNAFFECTED",
            pass: false,
            measured: "baseline json missing for a tree that is not BASE",
            threshold: `${THRESHOLDS.r7MaxDifferingCatalogs} differing unaffected catalogs vs BASE, including empty SAMPLE_Top`,
        };
    }
    const names = Object.keys(probe.r7 ?? {});
    const differ = [];
    for (const name of names) {
        const left = probe.r7?.[name] ?? null;
        const right = baseline?.r7?.[name] ?? null;
        if (left === null || right === null || left !== right) differ.push(name);
    }
    for (const name of Object.keys(baseline?.r7 ?? {})) {
        if (!(name in (probe.r7 ?? {}))) differ.push(name);
    }
    const unique = [...new Set(differ)];
    const emptySubject = probe.r7?.empty ?? "missing";
    const emptyBase = baseline?.r7?.empty ?? "missing";
    return {
        id: "G_R7_UNAFFECTED",
        pass: unique.length === THRESHOLDS.r7MaxDifferingCatalogs,
        measured: `${unique.length} catalogs differ (${unique.join(", ") || "none"}); empty sha subject ${String(emptySubject).slice(0, 12)} base ${String(emptyBase).slice(0, 12)}`,
        threshold: `${THRESHOLDS.r7MaxDifferingCatalogs} differing unaffected catalogs vs BASE, including empty SAMPLE_Top`,
    };
}

function gateSample(probe) {
    const sample = probe.sampleTop;
    const want = THRESHOLDS.sampleTop;
    const behaviorOk = Boolean(
        sample &&
            sample.assetId === want.assetId &&
            sample.glbPath === want.glbPath &&
            sample.url === want.url &&
            sample.rightMirrored === want.rightMirrored &&
            sample.rightAssetId === want.assetId &&
            sample.rightGlbPath === want.glbPath,
    );
    const meshes = fileLock("R4_mesh", LOCKED.R4_mesh);
    return {
        id: "G_R4_SAMPLE_TOP",
        pass: behaviorOk && meshes.pass,
        measured: `asset ${sample?.assetId ?? "missing"} glb ${sample?.glbPath ?? "missing"} url ${sample?.url ?? "missing"} mirrored ${sample?.rightMirrored}; ${meshes.measured}`,
        threshold: `assetId ${want.assetId}, glb ${want.glbPath}, url ${want.url}, right mirrored, mesh bytes match BASE`,
    };
}

function gateText(probe, paths) {
    const mark = probe.textMarking;
    const want = THRESHOLDS.textMarking;
    const behaviorOk = Boolean(
        mark &&
            mark.surface === want.surface &&
            mark.mode === want.mode &&
            mark.addPatientName === want.addPatientName &&
            mark.bold === want.bold,
    );
    const files = fileLock("R5_files", LOCKED.R5_engraving);
    const newEngraving = paths.filter(
        (rel) =>
            /engrave|text-marking/i.test(rel) &&
            !LOCKED.R5_engraving.includes(rel) &&
            !LOCKED.R2_seams_layers.includes(rel),
    );
    return {
        id: "G_R5_TEXT_MARKING",
        pass: behaviorOk && files.pass && newEngraving.length === 0,
        measured: `surface ${mark?.surface ?? "missing"} mode ${mark?.mode ?? "missing"} addPatientName ${mark?.addPatientName} bold ${mark?.bold}; ${files.measured}; newEngraving ${newEngraving.length}`,
        threshold:
            "surface bottom, mode engrave, existing bottom textMarking only, engraving files match BASE",
    };
}

function gateScope(paths) {
    const outside = paths.filter((rel) => !allowsPath(rel));
    return {
        id: "G_R3_SCOPE",
        pass: outside.length === 0,
        measured:
            paths.length === 0
                ? "0 paths differ from BASE"
                : `${paths.length} paths, ${outside.length} outside flange snapshot allowlist${outside.length ? `: ${outside.join(", ")}` : ""}`,
        threshold:
            "every changed path is an allowlisted flange snapshot/test/schema file and none are denied",
    };
}

function gateSecurity(paths) {
    const forbidden = paths.filter((rel) =>
        SCOPE.r6ForbiddenSubstrings.some((part) => rel.toLowerCase().includes(part.toLowerCase())),
    );
    const secretRes = [
        { name: "api_key", re: /api[_-]?key/i },
        { name: "bearer_value", re: /bearer\s+[A-Za-z0-9\-._~+/]{8,}/i },
        { name: "secret_assignment", re: /(?:secret|password)\s*[:=]\s*['"][^'"]{4,}['"]/i },
        { name: "patient_name", re: /patient[_ ]?name\s*[:=]\s*['"][A-Za-z]{2,}/i },
    ];
    const hits = [];
    const lines = addedLines();
    for (const line of lines) {
        for (const spec of secretRes) {
            if (spec.re.test(line)) hits.push(spec.name);
        }
    }
    const hitCount = hits.length;
    return {
        id: "G_R6_SECURITY",
        pass: forbidden.length === THRESHOLDS.r6MaxForbiddenPaths && hitCount === THRESHOLDS.r6MaxSecretHits,
        measured: `forbidden paths ${forbidden.length}${forbidden.length ? ` (${forbidden.join(", ")})` : ""}; secret/PHI pattern hits ${hitCount}`,
        threshold:
            "0 forbidden deploy/api/railway/printer/production paths and 0 secret or patient-name assignments in added lines",
    };
}

function gateExisting() {
    const rstest = path.join(subject, "node_modules", ".bin", "rstest");
    if (!existsSync(rstest)) {
        return {
            id: "G_TESTS_EXISTING",
            pass: false,
            measured: "rstest binary missing",
            threshold: `exit code ${THRESHOLDS.existingTestsExitCode}`,
        };
    }
    const files = [
        "vertex/src/lib/clinical/saved-design-snapshot.test.ts",
        "vertex/server/src/lib/saved-design-snapshot.test.ts",
    ];
    const result = spawnSync(rstest, files, {
        cwd: subject,
        encoding: "utf8",
        timeout: 300000,
        env: {
            ...process.env,
            MANUFACTURING_BUCKET: "vertex-manufacturing",
            STORAGE_BUCKET: "vertex-assets",
        },
    });
    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const redacted = combined
        .split("\n")
        .filter((line) => !/api_key|bearer|\btoken\b/i.test(line))
        .slice(-40)
        .join("\n");
    const exitCode = result.status ?? 1;
    return {
        id: "G_TESTS_EXISTING",
        pass: exitCode === THRESHOLDS.existingTestsExitCode,
        measured: `exit ${exitCode}`,
        threshold: `exit code ${THRESHOLDS.existingTestsExitCode} on the two saved-design snapshot test files`,
        tail: redacted,
    };
}

function gateHead() {
    const head = git(["rev-parse", "HEAD"]).trim();
    return {
        id: "G_HEAD",
        pass: expectHead ? head === expectHead : true,
        measured: head,
        threshold: expectHead || "recorded",
    };
}

function runProbe() {
    const tsx = path.resolve(HERE, "../../vertex/node_modules/.bin/tsx");
    if (!existsSync(tsx)) throw new Error(`tsx missing at ${tsx}`);
    const out = path.join("/tmp", `flz-probe-${path.basename(subject)}.json`);
    const result = spawnSync(tsx, [path.join(HERE, "probe.ts"), "--subject", subject, "--out", out], {
        encoding: "utf8",
        timeout: 120000,
        env: {
            ...process.env,
            MANUFACTURING_BUCKET: "vertex-manufacturing",
            STORAGE_BUCKET: "vertex-assets",
        },
    });
    if (result.status !== 0) {
        const err = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.split("\n").slice(-30).join("\n");
        throw new Error(`probe failed (${result.status}): ${err}`);
    }
    return JSON.parse(readFileSync(out, "utf8"));
}

const paths = changedPaths();
const head = git(["rev-parse", "HEAD"]).trim();
const probe = runProbe();
const baseline = baselineJson ? JSON.parse(readFileSync(baselineJson, "utf8")) : probe;

const gates = [];
if (wanted("G_HEAD")) gates.push(gateHead());
const explicitGate = wanted("G_ONE_EXPLICIT") || wanted("G_ONE") ? gateExplicit(probe) : null;
const omittedGate = wanted("G_TESTS_OMITTED") || wanted("G_ONE") ? gateOmitted(probe) : null;
if (wanted("G_ONE_EXPLICIT") && explicitGate) gates.push(explicitGate);
if (wanted("G_TESTS_OMITTED") && omittedGate) gates.push(omittedGate);
if (wanted("G_MUST_SLIDERS")) gates.push(gateSliders(probe));
if (wanted("G_MUST_BILATERAL")) gates.push(gateBilateral(probe));
if (wanted("G_R1_SURFACE"))
    gates.push({
        ...fileLock("G_R1_SURFACE", LOCKED.R1_surface),
        threshold: "0 surface/top/side files differ from BASE sha256",
    });
if (wanted("G_R2_SEAMS"))
    gates.push({
        ...fileLock("G_R2_SEAMS", LOCKED.R2_seams_layers),
        threshold: "0 seam/layer/slicer/bottom-engrave files differ from BASE sha256",
    });
if (wanted("G_R3_SCOPE")) gates.push(gateScope(paths));
if (wanted("G_R4_SAMPLE_TOP")) gates.push(gateSample(probe));
if (wanted("G_R5_TEXT_MARKING")) gates.push(gateText(probe, paths));
if (wanted("G_R6_SECURITY")) gates.push(gateSecurity(paths));
if (wanted("G_R7_UNAFFECTED")) gates.push(gateR7(probe, baseline, head));
if (wanted("G_TESTS_EXISTING") && !skipExisting) gates.push(gateExisting());

if (wanted("G_ONE") && explicitGate && omittedGate) {
    gates.push({
        id: "G_ONE",
        pass: explicitGate.pass && omittedGate.pass,
        measured: `explicit ${explicitGate.pass ? "PASS" : "FAIL"}; omitted ${omittedGate.pass ? "PASS" : "FAIL"}`,
        threshold: "explicit lateral_mm 0 and omitted lateral_mm do not produce a 3 mm lateral flange",
    });
}

const report = {
    subject,
    head,
    baseSha: BASE_SHA,
    changedPaths: paths,
    gates,
    probeErrors: probe.errors ?? [],
};
if (outPath) {
    mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2));
}
for (const gate of gates) {
    process.stdout.write(`${gate.pass ? "PASS" : "FAIL"}\t${gate.id}\t${gate.measured}\n`);
}
if (gates.some((gate) => !gate.pass)) process.exitCode = 1;
