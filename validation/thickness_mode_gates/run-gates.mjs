/**
 * Frozen thickness-mode gates.
 *
 * proofs — no-op and deliberately broken copies.
 * grade  — proofs again, then base and the candidate. Writes RESULTS.md.
 * freeze-manifest — hash gate sources. Run once, commit, do not edit sources after.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const BASE = "268aac85847160b5b2703a05688721ea4cb93b24";
const CANDIDATE = "3dd73e97bdcfe0cefeac531ace243f7c46c9ab14";
const WT_BASE = "/tmp/tm-gates-base";
const WT_CANDIDATE = "/tmp/tm-gates-candidate";
const WT_PROOF = "/tmp/tm-gates-proof";
const SNAPSHOT = "vertex/shared/saved-design-snapshot.ts";
const LOFT_TEST = "vertex/src/features/exports/saved-design-thickness-loft.test.ts";
const GUARD_FILE = "vertex/src/features/exports/saved-design-finalized-mesh.ts";
const GATE_SOURCES = ["README.md", "probe.mts", "run-gates.mjs"];

const PRODUCT_ALLOW = new Set([SNAPSHOT]);
const TEST_ALLOW = new Set([
    "vertex/server/src/lib/saved-design-snapshot.test.ts",
    "packages/mcp/test/persist-saved-design-snapshot.test.ts",
    "packages/mcp/test/central-fab-stl.test.ts",
    "tests/cnc/catalog-shell-thickness.test.ts",
    LOFT_TEST,
]);
const EXISTING_TESTS = [...TEST_ALLOW];

const SURFACE_DENY = [
    /ring-seam/,
    /slicer/i,
    /surface-quality/i,
    /surface_quality/i,
    /layer-change/i,
    /layer_change/i,
    /\/kiri\//,
];
const ENGRAVE_DENY = [/bottom-text-marking/, /text-marking/, /engrav/i];
const FORBIDDEN_TOUCH = [
    /vertex-web/i,
    /vertex-api/i,
    /railway/i,
    /print-bridge/i,
    /moonraker/i,
    /printer/i,
    /deploy/i,
];

const PRINTING_SHELL_MODE = `        design.thicknessMm = mm;
        if (design.method === "printing_shell") {
            design.shellThicknessMode = "uniform";
        }`;
const UNIFORM_MODE = `        design.thicknessMm = mm;
        design.shellThicknessMode = "uniform";`;
const ZONAL_MODE = `        design.thicknessMm = mm;
        design.shellThicknessMode = "zonal";`;

function git(args, cwd = REPO) {
    const child = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (child.status !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${child.stderr || child.stdout}`);
    }
    return (child.stdout || "").trim();
}

function ensureWorktree(dir, sha) {
    if (!existsSync(dir)) {
        git(["worktree", "add", "--detach", dir, sha]);
    } else {
        const head = git(["rev-parse", "HEAD"], dir);
        if (head !== sha) git(["checkout", "--detach", sha], dir);
    }
    linkModules(dir);
}

function linkModules(dir) {
    const links = [
        ["node_modules", join(REPO, "node_modules")],
        ["vertex/node_modules", join(REPO, "vertex/node_modules")],
        ["packages/mcp/node_modules", join(REPO, "packages/mcp/node_modules")],
    ];
    for (const [rel, target] of links) {
        if (!existsSync(target)) continue;
        const link = join(dir, rel);
        if (existsSync(link)) continue;
        symlinkSync(target, link);
    }
}

function resetProof() {
    git(["checkout", "--detach", BASE], WT_PROOF);
    git(["reset", "--hard", BASE], WT_PROOF);
    git(
        [
            "clean",
            "-fd",
            "-e",
            "node_modules",
            "-e",
            "vertex/node_modules",
            "-e",
            "packages/mcp/node_modules",
        ],
        WT_PROOF,
    );
    linkModules(WT_PROOF);
}

function readText(dir, rel) {
    return readFileSync(join(dir, rel), "utf8");
}

function writeText(dir, rel, text) {
    writeFileSync(join(dir, rel), text);
}

function replaceOnce(dir, rel, from, to) {
    const text = readText(dir, rel);
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`expected one match in ${rel}, found ${count}`);
    writeText(dir, rel, text.replace(from, to));
}

function replaceAllLiteral(dir, rel, from, to) {
    const text = readText(dir, rel);
    if (!text.includes(from)) throw new Error(`missing ${from} in ${rel}`);
    writeText(dir, rel, text.split(from).join(to));
}

function walls(row) {
    return [
        row.shellThicknessRfMm,
        row.shellThicknessMfMm,
        row.shellThicknessFfMm,
        row.shellThicknessBlendMm,
    ].join(",");
}

function sampleTopOk(row) {
    return (
        row.assetId === "sample-top" &&
        row.source === "stock" &&
        row.glbPath === "Templates/SAMPLE_Top.glb" &&
        row.url === "/Templates/SAMPLE_Top.glb" &&
        row.rightMirrored === true &&
        row.method === "printing_solid"
    );
}

function hits(files, patterns) {
    return files.filter((file) => patterns.some((pattern) => pattern.test(file)));
}

function judge(probe, baseProbe, files) {
    const rows = [];
    const push = (id, rule, pass, measured, threshold) => {
        rows.push({ id, rule, pass: Boolean(pass), measured, threshold });
    };
    const broken = !probe || probe.ok !== true;
    const thick = probe?.thick3;
    const omitted = probe?.omitted;
    const rt = thick?.roundTrip;

    push(
        "G-ONE",
        "ONE",
        !broken &&
            rt?.shellThicknessMode === "uniform" &&
            rt?.thicknessMm === 3 &&
            rt?.leftThicknessMm === 3 &&
            rt?.rightThicknessMm === 3 &&
            thick.shellThicknessMode === "uniform" &&
            thick.thicknessMm === 3 &&
            thick.leftThicknessMm === 3 &&
            thick.rightThicknessMm === 3,
        broken
            ? `probe error: ${probe?.error ?? "missing"}`
            : `mode=${rt?.shellThicknessMode} thicknessMm=${rt?.thicknessMm} left=${rt?.leftThicknessMm} right=${rt?.rightThicknessMm}`,
        "round-trip shellThicknessMode=uniform, thicknessMm=3, leftThicknessMm=3, rightThicknessMm=3",
    );

    push(
        "G-MUST-OMIT",
        "MUST-MATCH",
        !broken &&
            omitted.thicknessMm === 2 &&
            omitted.shellThicknessMode === "zonal" &&
            omitted.leftThicknessMm === 2 &&
            omitted.rightThicknessMm === 2 &&
            omitted.roundTrip?.shellThicknessMode === "zonal" &&
            omitted.roundTrip?.thicknessMm === 2 &&
            omitted.hash === baseProbe.omitted.hash,
        broken
            ? `probe error: ${probe?.error ?? "missing"}`
            : `mode=${omitted.shellThicknessMode} thicknessMm=${omitted.thicknessMm} left=${omitted.leftThicknessMm} right=${omitted.rightThicknessMm} hashEq=${omitted.hash === baseProbe.omitted.hash}`,
        "omitted thicknessMm=2, shellThicknessMode=zonal, both sides 2, settings hash equal to base",
    );

    push(
        "G-MUST-ZONAL",
        "MUST-MATCH",
        !broken &&
            omitted.shellThicknessMode === "zonal" &&
            walls(omitted) === walls(thick) &&
            walls(omitted) === walls(baseProbe.omitted),
        broken
            ? `probe error: ${probe?.error ?? "missing"}`
            : `omittedWalls=${walls(omitted)} thickWalls=${walls(thick)} baseWalls=${walls(baseProbe.omitted)} omittedMode=${omitted.shellThicknessMode}`,
        "zonal rf/mf/ff/blend unchanged by thickness_mm and equal to base; omitted mode stays zonal",
    );

    const surfaceHits = hits(files, SURFACE_DENY);
    push(
        "G-R1",
        "R1",
        surfaceHits.length === 0,
        `surfaceOrSeamFiles=${surfaceHits.length === 0 ? "none" : surfaceHits.join(",")}`,
        "zero changed files matching seam, slicer, layer-change, or surface-quality paths",
    );

    push(
        "G-R2",
        "R2",
        surfaceHits.length === 0 &&
            !broken &&
            omitted.textSurface === "bottom" &&
            thick.textSurface === "bottom",
        `surfaceOrSeamFiles=${surfaceHits.length === 0 ? "none" : surfaceHits.join(",")} textSurface=${broken ? "probe-error" : omitted.textSurface}`,
        "zero seam/layer/slicer file edits, and text marking surface stays bottom",
    );

    const outOfAllow = files.filter((file) => !PRODUCT_ALLOW.has(file) && !TEST_ALLOW.has(file));
    const guardDropped =
        !broken && probe.guardNameCount !== baseProbe.guardNameCount && probe.readPathGuardCount === 0;
    const forefootBandKept = !broken && probe.loftForefootBand === true;
    push(
        "G-R3",
        "R3",
        outOfAllow.length === 0 && !guardDropped && forefootBandKept,
        `outOfAllow=${outOfAllow.length === 0 ? "none" : outOfAllow.join(",")} guardCount=${broken ? "probe-error" : probe.guardNameCount} readPathGuardCount=${broken ? "probe-error" : probe.readPathGuardCount} loftForefootBand=${broken ? "probe-error" : probe.loftForefootBand}`,
        "diff only snapshot writer plus existing thickness tests; manufacturing guard count stays 2 because get_design_params does not call it; loft forefoot 0.9–1.1 band stays",
    );

    push(
        "G-R4",
        "R4",
        !broken && sampleTopOk(omitted) && sampleTopOk(thick) && omitted.elementCount === 0,
        broken
            ? `probe error: ${probe?.error ?? "missing"}`
            : `asset=${omitted.assetId} source=${omitted.source} glb=${omitted.glbPath} method=${omitted.method} elements=${omitted.elementCount}`,
        "SAMPLE_Top stock asset sample-top, Templates/SAMPLE_Top.glb, printing_solid, no elements",
    );

    const engraveHits = hits(files, ENGRAVE_DENY);
    push(
        "G-R5",
        "R5",
        engraveHits.length === 0 &&
            !broken &&
            omitted.textSurface === "bottom" &&
            omitted.textMode === "engrave" &&
            omitted.addPatientName === true &&
            omitted.textHash === thick.textHash &&
            omitted.textHash === baseProbe.omitted.textHash,
        broken
            ? `probe error: ${probe?.error ?? "missing"}`
            : `surface=${omitted.textSurface} mode=${omitted.textMode} nameFlag=${omitted.addPatientName} engraveFiles=${engraveHits.length === 0 ? "none" : engraveHits.join(",")}`,
        "bottom engrave textMarking unchanged, no new engraving files",
    );

    const forbiddenHits = hits(files, FORBIDDEN_TOUCH);
    push(
        "G-R6",
        "R6",
        forbiddenHits.length === 0,
        `forbiddenPaths=${forbiddenHits.length === 0 ? "none" : forbiddenHits.join(",")}`,
        "diff does not touch railway, vertex-web, vertex-api, printers, or deploy paths",
    );

    push(
        "G-R7",
        "R7",
        !broken && omitted.hash === baseProbe.omitted.hash && probe.archHigh.hash === baseProbe.archHigh.hash,
        broken
            ? `probe error: ${probe?.error ?? "missing"}`
            : `emptyCatalogHashEq=${omitted.hash === baseProbe.omitted.hash} archHighHashEq=${probe.archHigh.hash === baseProbe.archHigh.hash}`,
        "SAMPLE_Top with no thickness_mm, and a non-thickness catalog, hash-equal to base",
    );

    return rows;
}

function probeTree(dir) {
    const tsx = join(REPO, "vertex/node_modules/.bin/tsx");
    const probe = join(HERE, "probe.mts");
    const child = spawnSync(tsx, [probe], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, GATE_ROOT: dir },
        maxBuffer: 20 * 1024 * 1024,
    });
    const line = `${child.stdout || ""}`.trim().split("\n").filter(Boolean).at(-1) ?? "";
    if (!line) {
        return { ok: false, error: (child.stderr || "probe produced no output").slice(0, 500) };
    }
    return JSON.parse(line);
}

function filesBetween(fromSha, toSha) {
    if (fromSha === toSha) return [];
    const out = git(["diff", "--name-only", fromSha, toSha]);
    return out ? out.split("\n").filter(Boolean) : [];
}

function runExistingTests(dir, extraArgs = []) {
    const rstest = join(REPO, "node_modules/.bin/rstest");
    const child = spawnSync(rstest, ["run", ...extraArgs, ...EXISTING_TESTS], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, CI: "1" },
        maxBuffer: 30 * 1024 * 1024,
        timeout: 20 * 60 * 1000,
    });
    const text = `${child.stdout || ""}\n${child.stderr || ""}`;
    const summary = text
        .split("\n")
        .filter((line) => /Test Files|Tests /.test(line))
        .slice(-4)
        .join(" | ");
    return { exitCode: child.status ?? 1, summary: summary || `signal ${child.signal ?? "none"}` };
}

function redact(text) {
    return String(text).replace(/api_key|token|bearer/gi, "[redacted]");
}

function applyCase(name) {
    resetProof();
    if (name === "noop") {
        writeText(WT_PROOF, SNAPSHOT, `${readText(WT_PROOF, SNAPSHOT)}\n// thickness-mode-gate-noop\n`);
        return;
    }
    if (name === "good") {
        replaceOnce(WT_PROOF, SNAPSHOT, PRINTING_SHELL_MODE, UNIFORM_MODE);
        return;
    }
    if (name === "good-noop") {
        replaceOnce(WT_PROOF, SNAPSHOT, PRINTING_SHELL_MODE, UNIFORM_MODE);
        writeText(WT_PROOF, SNAPSHOT, `${readText(WT_PROOF, SNAPSHOT)}\n// thickness-mode-gate-noop\n`);
        return;
    }
    if (name === "bad-zonal") {
        replaceOnce(WT_PROOF, SNAPSHOT, PRINTING_SHELL_MODE, ZONAL_MODE);
        return;
    }
    if (name === "bad-omit") {
        replaceOnce(WT_PROOF, SNAPSHOT, "thicknessMm: BASE_REFERENCE_THICKNESS_MM,", "thicknessMm: 7,");
        return;
    }
    if (name === "bad-walls") {
        replaceOnce(
            WT_PROOF,
            SNAPSHOT,
            "design.thicknessMm = mm;",
            "design.thicknessMm = mm;\n        design.shellThicknessRfMm = 9;",
        );
        return;
    }
    if (name === "bad-stock") {
        replaceOnce(
            WT_PROOF,
            SNAPSHOT,
            'const SAMPLE_TOP_ASSET_ID = "sample-top";',
            'const SAMPLE_TOP_ASSET_ID = "not-sample-top";',
        );
        return;
    }
    if (name === "bad-text") {
        replaceOnce(
            WT_PROOF,
            SNAPSHOT,
            "design.textMarking = defaultBottomTextMarking();",
            'design.textMarking = defaultBottomTextMarking();\n    design.textMarking.surface = "wall";\n    design.textMarking.mode = "emboss";',
        );
        return;
    }
    if (name === "bad-band") {
        replaceAllLiteral(WT_PROOF, LOFT_TEST, "maxTopZInLengthBand", "removedTopBand");
        return;
    }
    throw new Error(`unknown case ${name}`);
}

function proofRows(baseProbe) {
    const cases = [];
    const record = (label, kind, files, expect) => {
        const probe = probeTree(WT_PROOF);
        const rows = judge(probe, baseProbe, files);
        for (const row of rows) {
            if (!Object.hasOwn(expect, row.id)) continue;
            const wanted = expect[row.id];
            cases.push({
                ...row,
                proof: label,
                kind,
                proofPass: row.pass === wanted,
                wanted,
            });
        }
    };

    applyCase("noop");
    record("noop-on-base", "noop", [], {
        "G-ONE": false,
        "G-MUST-OMIT": true,
        "G-MUST-ZONAL": true,
        "G-R4": true,
        "G-R5": true,
        "G-R7": true,
        "G-R1": true,
        "G-R2": true,
        "G-R3": true,
        "G-R6": true,
    });

    applyCase("good");
    record("spec-uniform-copy", "noop", [], { "G-ONE": true });

    applyCase("good-noop");
    record("noop-on-spec-uniform", "noop", [], { "G-ONE": true });

    applyCase("bad-zonal");
    record("bad-force-zonal", "bad", [], { "G-ONE": false });

    applyCase("bad-omit");
    record("bad-omit-thickness", "bad", [], { "G-MUST-OMIT": false, "G-R7": false });

    applyCase("bad-walls");
    record("bad-zonal-wall", "bad", [], { "G-MUST-ZONAL": false });

    applyCase("bad-stock");
    record("bad-stock-mesh", "bad", [], { "G-R4": false });

    applyCase("bad-text");
    record("bad-text-surface", "bad", [], { "G-R5": false, "G-R2": false });

    applyCase("bad-band");
    record("bad-delete-forefoot-band", "bad", [], { "G-R3": false });

    resetProof();
    const baseFiles = [];
    const synthetic = judge(baseProbe, baseProbe, ["vertex/src/lib/geometry/procedural-wall/ring-seam.ts"]);
    for (const id of ["G-R1", "G-R2"]) {
        const row = synthetic.find((item) => item.id === id);
        cases.push({
            ...row,
            proof: "bad-seam-file",
            kind: "bad",
            proofPass: row.pass === false,
            wanted: false,
        });
    }
    const scope = judge(baseProbe, baseProbe, [GUARD_FILE]);
    const r3 = scope.find((item) => item.id === "G-R3");
    cases.push({ ...r3, proof: "bad-guard-file", kind: "bad", proofPass: r3.pass === false, wanted: false });
    const forbidden = judge(baseProbe, baseProbe, ["vertex-api/railway.toml"]);
    const r6 = forbidden.find((item) => item.id === "G-R6");
    cases.push({
        ...r6,
        proof: "bad-forbidden-path",
        kind: "bad",
        proofPass: r6.pass === false,
        wanted: false,
    });
    const clean = judge(baseProbe, baseProbe, baseFiles);
    for (const id of ["G-R1", "G-R2", "G-R3", "G-R6"]) {
        const row = clean.find((item) => item.id === id);
        cases.push({
            ...row,
            proof: "noop-empty-diff",
            kind: "noop",
            proofPass: row.pass === true,
            wanted: true,
        });
    }
    return cases;
}

function testProof(baseDir) {
    const pattern = ["--testNamePattern", "omitted thickness stays 2 mm"];
    const onlySnapshot = ["vertex/server/src/lib/saved-design-snapshot.test.ts"];
    const rstest = join(REPO, "node_modules/.bin/rstest");
    const run = (dir) => {
        const child = spawnSync(rstest, ["run", ...pattern, ...onlySnapshot], {
            cwd: dir,
            encoding: "utf8",
            env: { ...process.env, CI: "1" },
            timeout: 180000,
            maxBuffer: 20 * 1024 * 1024,
        });
        return child.status ?? 1;
    };
    const noopCode = run(baseDir);
    applyCase("bad-omit");
    const badCode = run(WT_PROOF);
    resetProof();
    return [
        {
            id: "G-TESTS",
            rule: "TESTS",
            proof: "noop-existing-omit-test",
            kind: "noop",
            pass: noopCode === 0,
            wanted: true,
            proofPass: noopCode === 0,
            measured: `exit=${noopCode}`,
            threshold: "exit=0",
        },
        {
            id: "G-TESTS",
            rule: "TESTS",
            proof: "bad-omit-breaks-existing-test",
            kind: "bad",
            pass: badCode === 0,
            wanted: false,
            proofPass: badCode !== 0,
            measured: `exit=${badCode}`,
            threshold: "exit!=0 on a thickness default of 7",
        },
    ];
}

function sourceHashes() {
    const hashes = {};
    for (const name of GATE_SOURCES) {
        const body = readFileSync(join(HERE, name));
        hashes[name] = createHash("sha256").update(body).digest("hex");
    }
    return hashes;
}

function writeFreezeManifest() {
    const manifest = {
        frozenBeforeCandidateGrade: true,
        base: BASE,
        candidate: CANDIDATE,
        sources: sourceHashes(),
    };
    writeFileSync(join(HERE, "freeze-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(manifest, null, 2));
}

function assertFrozen() {
    const manifest = JSON.parse(readText(HERE, "freeze-manifest.json"));
    const current = sourceHashes();
    for (const name of GATE_SOURCES) {
        if (manifest.sources[name] !== current[name]) {
            throw new Error(`gate source ${name} changed after freeze`);
        }
    }
}

function markdownTable(headers, rows) {
    const head = `| ${headers.join(" | ")} |`;
    const sep = `| ${headers.map(() => "---").join(" | ")} |`;
    const body = rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, "/")).join(" | ")} |`);
    return [head, sep, ...body].join("\n");
}

function writeResults({ proofs, grades, tests }) {
    const proofFails = proofs.filter((row) => !row.proofPass);
    const lines = [];
    lines.push("# Thickness-mode gate results");
    lines.push("");
    lines.push(`Base \`${BASE}\`. Candidate \`${CANDIDATE}\` (PR #403).`);
    lines.push("");
    lines.push(
        `Proof failures: ${proofFails.length}. Threshold is zero proof failures before the grade is trusted.`,
    );
    lines.push("");
    lines.push("## Proofs");
    lines.push("");
    lines.push(
        markdownTable(
            ["Proof", "Kind", "Gate", "Wanted", "Gate result", "Proof", "Measured"],
            proofs.map((row) => [
                row.proof,
                row.kind,
                row.id,
                row.wanted ? "PASS" : "FAIL",
                row.pass ? "PASS" : "FAIL",
                row.proofPass ? "PASS" : "FAIL",
                redact(row.measured),
            ]),
        ),
    );
    lines.push("");
    lines.push("## Grade");
    lines.push("");
    lines.push(
        markdownTable(
            ["Tree", "Gate", "Rule", "Result", "Measured", "Threshold"],
            grades.map((row) => [
                row.tree,
                row.id,
                row.rule,
                row.pass ? "PASS" : "FAIL",
                redact(row.measured),
                row.threshold,
            ]),
        ),
    );
    lines.push("");
    lines.push("## Existing tests");
    lines.push("");
    lines.push(
        markdownTable(
            ["Tree", "Result", "Exit", "Summary"],
            tests.map((row) => [row.tree, row.pass ? "PASS" : "FAIL", row.exitCode, redact(row.summary)]),
        ),
    );
    lines.push("");
    lines.push("## Scope note");
    lines.push("");
    lines.push(
        "G-R3 fails when `saved-design-finalized-mesh.ts` drops `assertSolidManufacturingShellThickness` while `get_design_params` never calls that guard (`readPathGuardCount` 0). That removal is not required for the readback defect. It is a scope-growth question for Kendon: the guard refused uniform non-default thickness on solid and milling loft.",
    );
    lines.push("");
    writeFileSync(join(HERE, "RESULTS.md"), lines.join("\n"));
}

function grade() {
    assertFrozen();
    ensureWorktree(WT_BASE, BASE);
    ensureWorktree(WT_CANDIDATE, CANDIDATE);
    ensureWorktree(WT_PROOF, BASE);
    const baseProbe = probeTree(WT_BASE);
    if (!baseProbe.ok) throw new Error(`base probe failed: ${baseProbe.error}`);
    const proofs = [...proofRows(baseProbe), ...testProof(WT_BASE)];
    const proofFails = proofs.filter((row) => !row.proofPass);
    if (proofFails.length) {
        writeResults({ proofs, grades: [], tests: [] });
        throw new Error(`proofs failed: ${proofFails.map((row) => `${row.proof}:${row.id}`).join(", ")}`);
    }
    const candidateProbe = probeTree(WT_CANDIDATE);
    const baseFiles = filesBetween(BASE, BASE);
    const candidateFiles = filesBetween(BASE, CANDIDATE);
    const grades = [
        ...judge(baseProbe, baseProbe, baseFiles).map((row) => ({ ...row, tree: "base" })),
        ...judge(candidateProbe, baseProbe, candidateFiles).map((row) => ({ ...row, tree: "candidate" })),
    ];
    const tests = [];
    for (const [tree, dir] of [
        ["base", WT_BASE],
        ["candidate", WT_CANDIDATE],
    ]) {
        const result = runExistingTests(dir);
        tests.push({ tree, ...result, pass: result.exitCode === 0 });
        grades.push({
            tree,
            id: "G-TESTS",
            rule: "TESTS",
            pass: result.exitCode === 0,
            measured: `exit=${result.exitCode} ${result.summary}`,
            threshold: "existing thickness tests exit 0",
        });
    }
    writeResults({ proofs, grades, tests });
    const failed = grades.filter((row) => !row.pass).map((row) => `${row.tree}:${row.id}`);
    console.log(`wrote RESULTS.md; failing grades: ${failed.length ? failed.join(", ") : "none"}`);
}

const command = process.argv[2] ?? "grade";
if (command === "freeze-manifest") {
    writeFreezeManifest();
} else if (command === "proofs") {
    ensureWorktree(WT_BASE, BASE);
    ensureWorktree(WT_PROOF, BASE);
    const baseProbe = probeTree(WT_BASE);
    if (!baseProbe.ok) {
        console.error(baseProbe.error);
        process.exit(1);
    }
    const proofs = [...proofRows(baseProbe), ...testProof(WT_BASE)];
    console.log(JSON.stringify(proofs, null, 2));
    const failed = proofs.filter((row) => !row.proofPass);
    if (failed.length) process.exit(1);
} else if (command === "grade") {
    grade();
} else {
    console.error("use proofs, grade, or freeze-manifest");
    process.exit(2);
}
