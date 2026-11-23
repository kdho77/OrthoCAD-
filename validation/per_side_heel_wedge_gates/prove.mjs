// Proofs for the frozen gates. Runs on copies. Does not grade the candidate and does not edit product code.
//   node validation/per_side_heel_wedge_gates/prove.mjs noop
//   node validation/per_side_heel_wedge_gates/prove.mjs bad-slicer
//   node validation/per_side_heel_wedge_gates/prove.mjs bad-secret
//   node validation/per_side_heel_wedge_gates/prove.mjs bad-text
//   node validation/per_side_heel_wedge_gates/prove.mjs bad-translate
//   node validation/per_side_heel_wedge_gates/prove.mjs bad-wrong-foot
//   node validation/per_side_heel_wedge_gates/prove.mjs bad-sign
//   node validation/per_side_heel_wedge_gates/prove.mjs good-expose
//   node validation/per_side_heel_wedge_gates/prove.mjs candidate
//   node validation/per_side_heel_wedge_gates/prove.mjs pre-candidate

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const BASE = "268aac85847160b5b2703a05688721ea4cb93b24";
const CANDIDATE = "a77214bb89bd184d7b10b9200ed79c29c5c076af";
const CANDIDATE_BRANCH =
    "cursor/let-a-production-design-carry-a-heel-wedge-on-one-side-only-in-degrees-with-an-unambiguous-medial-985c";

const WEDGE_BLOCK = `    if (catalog.rearfoot_wedge) {
        const wedge = {
            side: catalog.rearfoot_wedge.side,
            value: catalog.rearfoot_wedge.value,
            unit: catalog.rearfoot_wedge.unit,
            ...(catalog.rearfoot_wedge.degree_mode ? { degreeMode: catalog.rearfoot_wedge.degree_mode } : {}),
        };
        design.corrections.left.rearfootWedge = wedge;
        design.corrections.right.rearfootWedge = { ...wedge };
        paths.push("settings.corrections.left.rearfootWedge", "settings.corrections.right.rearfootWedge");
    }`;

function wedgeBlock(wrongFoot) {
    const target = wrongFoot ? `(sideName === "right" ? "left" : "right")` : "sideName";
    return `    const perSideHeel = catalog.rearfoot_wedge_by_side;
    const perSideHeelRequested = Boolean(perSideHeel?.left || perSideHeel?.right);
    if (catalog.rearfoot_wedge && perSideHeelRequested) {
        throw new SavedDesignSnapshotError("provide rearfoot_wedge or rearfoot_wedge_by_side, not both.");
    }
    if (perSideHeelRequested && perSideHeel) {
        design.corrections.linked = false;
        if (!paths.includes("settings.corrections.linked")) paths.push("settings.corrections.linked");
        for (const sideName of ["left", "right"] as const) {
            const entry = perSideHeel[sideName];
            if (!entry) continue;
            const targetSide = ${target};
            design.corrections[targetSide].rearfootWedge = {
                side: entry.side,
                value: entry.value,
                unit: entry.unit,
                ...(entry.degree_mode ? { degreeMode: entry.degree_mode } : {}),
            };
            paths.push(\`settings.corrections.\${targetSide}.rearfootWedge\`);
        }
    } else if (catalog.rearfoot_wedge) {
        const wedge = {
            side: catalog.rearfoot_wedge.side,
            value: catalog.rearfoot_wedge.value,
            unit: catalog.rearfoot_wedge.unit,
            ...(catalog.rearfoot_wedge.degree_mode ? { degreeMode: catalog.rearfoot_wedge.degree_mode } : {}),
        };
        design.corrections.left.rearfootWedge = wedge;
        design.corrections.right.rearfootWedge = { ...wedge };
        paths.push("settings.corrections.left.rearfootWedge", "settings.corrections.right.rearfootWedge");
    }`;
}

const BY_SIDE_SCHEMA = `
        rearfoot_wedge_by_side: z
            .object({
                left: wedgeSchema.optional(),
                right: wedgeSchema.optional(),
            })
            .strict()
            .optional(),`;

const SIGN_SENTENCE =
    "rearfoot_wedge_by_side (one foot; side medial raises the medial heel; side lateral raises the lateral heel), ";

function replaceOnce(file, needle, replacement) {
    const text = fs.readFileSync(file, "utf8");
    const count = text.split(needle).length - 1;
    if (count !== 1) {
        throw new Error(`needle count ${count} in ${file} for ${JSON.stringify(needle).slice(0, 140)}`);
    }
    fs.writeFileSync(file, text.replace(needle, replacement));
}

function insertAfter(file, needle, insertion) {
    replaceOnce(file, needle, needle + insertion);
}

function expose(dir, wrongFoot) {
    for (const rel of [
        "vertex/shared/saved-design-catalog.ts",
        "packages/mcp/src/tools/schemas.ts",
        "vertex/server/src/orthocad-mcp.bundled.mjs",
    ]) {
        insertAfter(path.join(dir, rel), "rearfoot_wedge: wedgeSchema.optional(),", BY_SIDE_SCHEMA);
    }
    replaceOnce(path.join(dir, "vertex/shared/saved-design-snapshot.ts"), WEDGE_BLOCK, wedgeBlock(wrongFoot));
    for (const rel of ["packages/mcp/src/tools/schemas.ts", "vertex/server/src/orthocad-mcp.bundled.mjs"]) {
        insertAfter(path.join(dir, rel), "rearfoot_wedge.degree_mode, ", SIGN_SENTENCE);
        insertAfter(
            path.join(dir, rel),
            "Omit forefoot_wedge for a flat forefoot. ",
            "rearfoot_wedge_by_side.right sets one foot; side medial raises the medial heel; side lateral raises the lateral heel. ",
        );
    }
}

function worktree(name, sha) {
    const dir = `/tmp/heel-wedge-gate-${name}`;
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: ROOT, stdio: "ignore" });
    fs.rmSync(dir, { recursive: true, force: true });
    execFileSync("git", ["worktree", "add", "--detach", dir, sha], { cwd: ROOT, stdio: "inherit" });
    for (const rel of ["node_modules", "vertex/node_modules", "packages/mcp/node_modules"]) {
        const target = path.join(ROOT, rel);
        if (!fs.existsSync(target)) throw new Error(`missing ${target}`);
        fs.symlinkSync(target, path.join(dir, rel));
    }
    const dest = path.join(dir, "validation/per_side_heel_wedge_gates");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(HERE, dest, { recursive: true });
    return dir;
}

function runGrade(cwd, env) {
    const out = `/tmp/heel-wedge-gate-results-${path.basename(cwd)}.json`;
    const result = spawnSync(
        "npx",
        ["rstest", "run", "--config", "validation/per_side_heel_wedge_gates/rstest.config.ts"],
        {
            cwd,
            env: { ...process.env, GATE_RESULTS_OUT: out, ...env },
            encoding: "utf8",
            timeout: 25 * 60 * 1000,
        },
    );
    if (!fs.existsSync(out)) {
        process.stdout.write(result.stdout ?? "");
        process.stderr.write(result.stderr ?? "");
        throw new Error(`grade produced no results in ${cwd} (exit ${result.status})`);
    }
    const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
    return parsed.results;
}

function byId(results) {
    return new Map(results.map((result) => [result.id, result]));
}

function check(results, expectPass, expectFail) {
    const map = byId(results);
    const problems = [];
    for (const id of expectPass) {
        const row = map.get(id);
        if (!row) problems.push(`missing ${id}`);
        else if (!row.pass) problems.push(`expected PASS ${id}: ${row.measured}`);
    }
    for (const id of expectFail) {
        const row = map.get(id);
        if (!row) problems.push(`missing ${id}`);
        else if (row.pass) problems.push(`expected FAIL ${id}: ${row.measured}`);
    }
    if (problems.length > 0) {
        console.error(problems.join("\n"));
        process.exitCode = 1;
        return false;
    }
    console.log(`proof ok: pass [${expectPass.join(", ")}] fail [${expectFail.join(", ")}]`);
    return true;
}

function writeProof(name, results) {
    const dir = path.join(HERE, "proofs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(results, null, 2)}\n`);
}

const FAST = { GATE_SKIP_MESH: "1", GATE_SKIP_EXISTING: "1" };

const jobs = {
    noop() {
        const results = runGrade(ROOT, {});
        writeProof("noop", results);
        check(
            results,
            ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "MUST_MATCH", "TESTS_EXISTING"],
            ["TESTS_READBACK", "TESTS_EXPORT", "ONE"],
        );
    },
    "bad-slicer"() {
        const dir = worktree("bad-slicer", BASE);
        fs.appendFileSync(path.join(dir, "vertex/src/lib/kiri/slicer.ts"), "\n// bad: seam moved onto the top surface\n");
        const results = runGrade(dir, { ...FAST, GATE_ONLY: "R1,R2,R3" });
        writeProof("bad-slicer", results);
        check(results, [], ["R1", "R2", "R3"]);
    },
    "bad-secret"() {
        const dir = worktree("bad-secret", BASE);
        fs.appendFileSync(
            path.join(dir, "packages/mcp/src/tools/schemas.ts"),
            '\nconst api_key = "grade-bad-not-a-real-secret";\n',
        );
        const results = runGrade(dir, { ...FAST, GATE_ONLY: "R6" });
        writeProof("bad-secret", results);
        check(results, [], ["R6"]);
    },
    "bad-text"() {
        const dir = worktree("bad-text", BASE);
        replaceOnce(
            path.join(dir, "vertex/shared/bottom-text-marking.ts"),
            `        addPatientName: true,\n        surface: "bottom",\n        mode: "engrave",`,
            `        addPatientName: true,\n        surface: "wall",\n        mode: "engrave",`,
        );
        const results = runGrade(dir, { ...FAST, GATE_ONLY: "R5" });
        writeProof("bad-text", results);
        check(results, [], ["R5"]);
    },
    "bad-translate"() {
        const dir = worktree("bad-translate", BASE);
        replaceOnce(
            path.join(dir, "vertex/src/lib/geometry/procedural-wall/print-solid-compose.ts"),
            "    return { geometry: modified, referenceBase: current, ownedWidth: owned };",
            "    modified.translate(0, 0, 1);\n    return { geometry: modified, referenceBase: current, ownedWidth: owned };",
        );
        const results = runGrade(dir, { GATE_SKIP_EXISTING: "1", GATE_ONLY: "R7,MUST_MATCH" });
        writeProof("bad-translate", results);
        check(results, [], ["R7", "MUST_MATCH"]);
    },
    "bad-wrong-foot"() {
        const dir = worktree("bad-wrong-foot", BASE);
        expose(dir, true);
        const results = runGrade(dir, {
            GATE_SKIP_EXISTING: "1",
            GATE_ONLY: "TESTS_READBACK,TESTS_EXPORT,ONE,MUST_MATCH,R7,R3",
        });
        writeProof("bad-wrong-foot", results);
        check(results, ["MUST_MATCH", "R7", "R3"], ["TESTS_READBACK", "TESTS_EXPORT", "ONE"]);
    },
    "bad-sign"() {
        const dir = worktree("bad-sign", BASE);
        expose(dir, false);
        replaceOnce(
            path.join(dir, "vertex/src/lib/geometry/wedge.ts"),
            'const isMedial = wedge.side === "medial";',
            'const isMedial = wedge.side !== "medial";',
        );
        const results = runGrade(dir, { GATE_ONLY: "TESTS_EXPORT,TESTS_EXISTING,ONE,R3,R7" });
        writeProof("bad-sign", results);
        check(results, ["R7"], ["TESTS_EXPORT", "TESTS_EXISTING", "ONE", "R3"]);
    },
    "good-expose"() {
        const dir = worktree("good-expose", BASE);
        expose(dir, false);
        const results = runGrade(dir, {});
        writeProof("good-expose", results);
        check(
            results,
            [
                "R1",
                "R2",
                "R3",
                "R4",
                "R5",
                "R6",
                "R7",
                "MUST_MATCH",
                "TESTS_READBACK",
                "TESTS_EXPORT",
                "TESTS_EXISTING",
                "ONE",
            ],
            [],
        );
    },
    candidate() {
        execFileSync("git", ["fetch", "origin", CANDIDATE_BRANCH], { cwd: ROOT, stdio: "inherit" });
        const hasSha = spawnSync("git", ["cat-file", "-e", `${CANDIDATE}^{commit}`], { cwd: ROOT });
        if (hasSha.status !== 0) {
            execFileSync("git", ["fetch", "origin", CANDIDATE], { cwd: ROOT, stdio: "inherit" });
        }
        const dir = worktree("candidate", CANDIDATE);
        const results = runGrade(dir, {});
        writeProof("candidate", results);
        console.log(JSON.stringify(results, null, 2));
    },
};

const name = process.argv[2] ?? "pre-candidate";
if (name === "pre-candidate") {
    for (const step of ["noop", "bad-slicer", "bad-secret", "bad-text", "bad-translate", "bad-wrong-foot", "bad-sign", "good-expose"]) {
        console.log(`\n=== ${step} ===`);
        jobs[step]();
        if (process.exitCode) process.exit(process.exitCode);
    }
} else if (!jobs[name]) {
    console.error(`unknown proof ${name}`);
    process.exit(1);
} else {
    jobs[name]();
}
