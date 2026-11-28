#!/usr/bin/env node
/**
 * No-op proof on BASE and bad-change proofs. Run before the freeze commit.
 * Does not grade the candidate.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
    appendFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const proofs = join(here, "proofs");
mkdirSync(proofs, { recursive: true });

function run(args) {
    const result = spawnSync("node", [join(here, "run-gates.mjs"), ...args], {
        cwd: repo,
        stdio: "inherit",
        timeout: 1_200_000,
    });
    if (result.status !== 0) throw new Error(`exit ${result.status ?? "null"}`);
}

function worktree() {
    const dir = mkdtempSync(join(tmpdir(), "narrow-heelcup-gate-"));
    rmSync(dir, { recursive: true });
    execFileSync("git", ["-C", repo, "worktree", "add", "--detach", dir, "HEAD"], { stdio: "inherit" });
    symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
    symlinkSync(join(repo, "vertex/node_modules"), join(dir, "vertex/node_modules"));
    return dir;
}

function removeWorktree(dir) {
    execFileSync("git", ["-C", repo, "worktree", "remove", "--force", dir], { stdio: "inherit" });
}

function replaceOnce(dir, rel, from, to) {
    const path = join(dir, rel);
    const text = readFileSync(path, "utf8");
    if (!text.includes(from)) throw new Error(`pattern missing in ${rel}`);
    writeFileSync(path, text.replace(from, to));
}

const onlyProofs = new Set(process.argv.slice(2));
const cases = [];
function selected(name) {
    return onlyProofs.size === 0 || onlyProofs.has(name);
}

function record(name, status, detail) {
    cases.push({ name, status, detail });
    console.log(`${status}\t${name}`);
}

function staticBad(name, mutate, failIds) {
    if (!selected(name)) return;
    const dir = worktree();
    try {
        mutate(dir);
        const out = join(proofs, `${name}.json`);
        try {
            run([
                "--product",
                dir,
                "--mode",
                "base",
                "--runtime",
                "none",
                "--out",
                out,
                "--require-fail",
                failIds,
            ]);
            record(name, "PASS", `gate failed as required: ${failIds}`);
        } catch (error) {
            record(name, "FAIL", String(error.message ?? error));
        }
    } finally {
        removeWorktree(dir);
    }
}

console.log("noop on BASE");
if (!selected("noop")) {
    console.log("SKIP\tnoop");
} else
    try {
        run([
            "--product",
            repo,
            "--mode",
            "base",
            "--runtime",
            "full",
            "--out",
            join(proofs, "noop.json"),
            "--require-pass",
            "G-R1,G-R2,G-R3,G-R4,G-R5,G-R6,G-MUST-THRESHOLD,G-R7,G-MUST-IDENTITY,G-REPRO,G-TESTS-EXISTING",
            "--require-fail",
            "G-TESTS-EXPORT,G-ONE,G-TESTS-NEW",
        ]);
        record("noop", "PASS", "BASE passes the gates it should pass; the defect gates fail closed");
    } catch (error) {
        record("noop", "FAIL", String(error.message ?? error));
    }

staticBad(
    "bad-r1",
    (dir) =>
        appendFileSync(
            join(dir, "vertex/src/lib/geometry/procedural-wall/wall-spline.ts"),
            "\n// gate-bad surface\n",
        ),
    "G-R1",
);
staticBad(
    "bad-r2",
    (dir) => appendFileSync(join(dir, "vertex/src/lib/kiri/slicer.ts"), "\n// gate-bad seam layer\n"),
    "G-R2",
);
staticBad(
    "bad-r3",
    (dir) => appendFileSync(join(dir, "vertex/src/lib/geometry/sink.ts"), "\n// gate-bad scope\n"),
    "G-R3",
);
staticBad(
    "bad-r4",
    (dir) =>
        appendFileSync(
            join(dir, "vertex/src/lib/geometry/procedural-wall/sample-top-id.ts"),
            "\n// gate-bad mesh\n",
        ),
    "G-R4",
);
staticBad(
    "bad-r5",
    (dir) =>
        appendFileSync(
            join(dir, "vertex/src/lib/geometry/text-marking/constants.ts"),
            "\n// gate-bad engraving\n",
        ),
    "G-R5",
);
staticBad(
    "bad-r6-secret",
    (dir) =>
        appendFileSync(
            join(dir, "vertex/src/lib/geometry/shoe-width.ts"),
            '\nconst api_key = "not-a-real-secret";\n',
        ),
    "G-R6",
);
staticBad(
    "bad-r6-railway",
    (dir) => {
        mkdirSync(join(dir, "vertex-web"), { recursive: true });
        writeFileSync(join(dir, "vertex-web/touched.txt"), "railway\n");
    },
    "G-R6",
);
staticBad(
    "bad-threshold",
    (dir) =>
        replaceOnce(
            dir,
            "vertex/src/lib/geometry/procedural-wall/station-gates.ts",
            "export const SKEW_INSET_RATIO = 0.5;",
            "export const SKEW_INSET_RATIO = 10;",
        ),
    "G-MUST-THRESHOLD",
);

function runtimeBad(name, mutate, runtime, extra, failIds) {
    if (!selected(name)) return;
    const dir = worktree();
    try {
        mutate(dir);
        const out = join(proofs, `${name}.json`);
        try {
            run([
                "--product",
                dir,
                "--mode",
                "base",
                "--runtime",
                runtime,
                "--out",
                out,
                ...extra,
                "--require-fail",
                failIds,
            ]);
            record(name, "PASS", `gate failed as required: ${failIds}`);
        } catch (error) {
            record(name, "FAIL", String(error.message ?? error));
        }
    } finally {
        removeWorktree(dir);
    }
}

runtimeBad(
    "bad-identity",
    (dir) =>
        replaceOnce(
            dir,
            "vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts",
            "return geometry === preview.geometry ? preview : { ...preview, geometry };",
            "geometry.translate(0.25, 0, 0);\n        return geometry === preview.geometry ? preview : { ...preview, geometry };",
        ),
    "identity",
    ["--only", "s9-medium"],
    "G-R7,G-MUST-IDENTITY",
);
runtimeBad(
    "bad-export",
    (dir) =>
        replaceOnce(
            dir,
            "vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts",
            'const side = cache?.side ?? options.side ?? (options.mirrored ? "left" : "right");',
            'throw new Error("gate-bad-export");\n    const side = cache?.side ?? options.side ?? (options.mirrored ? "left" : "right");',
        ),
    "defect",
    ["--only", "defect"],
    "G-TESTS-EXPORT",
);
runtimeBad(
    "bad-one-threshold",
    (dir) =>
        replaceOnce(
            dir,
            "vertex/src/lib/geometry/procedural-wall/station-gates.ts",
            "export const SKEW_INSET_RATIO = 0.5;",
            "export const SKEW_INSET_RATIO = 10;",
        ),
    "defect",
    ["--only", "defect"],
    "G-ONE,G-MUST-THRESHOLD",
);
runtimeBad(
    "bad-existing",
    (dir) =>
        appendFileSync(
            join(dir, "vertex/src/lib/geometry/procedural-wall/station-gates.test.ts"),
            '\ntest("gate-bad-existing", () => {\n    expect(1).toBe(2);\n});\n',
        ),
    "existing",
    [],
    "G-TESTS-EXISTING",
);
runtimeBad(
    "bad-new-test",
    (dir) =>
        writeFileSync(
            join(dir, "vertex/src/lib/geometry/procedural-wall/gate-bad-new.test.ts"),
            'import { expect, test } from "@rstest/core";\n\ntest("narrow heelCupHeightMm met_pad buildProceduralExportSolid", () => {\n    expect(1).toBe(2);\n});\n',
        ),
    "worker",
    [],
    "G-TESTS-NEW",
);

const summaryPath = join(proofs, onlyProofs.size === 0 ? "summary.json" : "summary-rerun.json");
writeFileSync(summaryPath, JSON.stringify(cases, null, 2));
const failed = cases.filter((row) => row.status !== "PASS");
console.log(JSON.stringify(cases, null, 2));
if (failed.length) process.exit(1);
