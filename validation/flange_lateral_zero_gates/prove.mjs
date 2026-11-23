/**
 * Proof driver for the frozen gates. Copies live only under /tmp worktrees.
 * Does not edit validation/flange_lateral_zero_gates or the grader checkout.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const THRESHOLDS = JSON.parse(readFileSync(path.join(HERE, "thresholds.json"), "utf8"));
const BASE = THRESHOLDS.baseSha;
const OUT_DIR = "/tmp/flz-proofs";

function git(args, cwd = REPO) {
    execFileSync("git", args, { cwd, stdio: "inherit" });
}

function ensureWorktree(dir, sha) {
    if (!existsSync(path.join(dir, ".git"))) {
        git(["worktree", "add", "--detach", dir, sha]);
    }
    const rootNm = path.join(dir, "node_modules");
    const vertexNm = path.join(dir, "vertex", "node_modules");
    if (!existsSync(rootNm)) symlinkSync(path.join(REPO, "node_modules"), rootNm);
    if (!existsSync(vertexNm)) symlinkSync(path.join(REPO, "vertex", "node_modules"), vertexNm);
}

function reset(dir) {
    execFileSync("git", ["checkout", "--", "."], { cwd: dir, stdio: "inherit" });
    execFileSync("git", ["clean", "-fd"], { cwd: dir, stdio: "inherit" });
}

function replaceOnce(file, from, to) {
    const text = readFileSync(file, "utf8");
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`expected 1 match in ${file}, found ${count} for:\n${from}`);
    writeFileSync(file, text.replace(from, to));
}

function runGates(subject, extra, outName) {
    mkdirSync(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, outName);
    const args = [path.join(HERE, "run-gates.mjs"), "--subject", subject, "--out", out, ...extra];
    const result = spawnSync("node", args, { cwd: REPO, encoding: "utf8" });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    const report = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
    return { status: result.status, report, out };
}

function gatePass(report, id) {
    const gate = report?.gates?.find((item) => item.id === id);
    if (!gate) throw new Error(`missing gate ${id}`);
    return gate.pass === true;
}

const mode = process.argv[2] ?? "noop";
const baseDir = "/tmp/flz-base";
const badDir = "/tmp/flz-bad";

if (mode === "noop") {
    ensureWorktree(baseDir, BASE);
    reset(baseDir);
    const result = runGates(baseDir, ["--expect-head", BASE], "noop.json");
    const expectFail = new Set(["G_ONE_EXPLICIT", "G_TESTS_OMITTED", "G_ONE"]);
    const expectPass = [
        "G_MUST_SLIDERS",
        "G_MUST_BILATERAL",
        "G_TESTS_EXISTING",
        "G_R1_SURFACE",
        "G_R2_SEAMS",
        "G_R3_SCOPE",
        "G_R4_SAMPLE_TOP",
        "G_R5_TEXT_MARKING",
        "G_R6_SECURITY",
        "G_R7_UNAFFECTED",
        "G_HEAD",
    ];
    let ok = true;
    for (const id of expectFail) {
        if (gatePass(result.report, id)) {
            process.stderr.write(`noop expected FAIL ${id}\n`);
            ok = false;
        }
    }
    for (const id of expectPass) {
        if (!gatePass(result.report, id)) {
            process.stderr.write(`noop expected PASS ${id}\n`);
            ok = false;
        }
    }
    if (!ok) process.exit(1);
    process.stdout.write("noop proof matched expected BASE results\n");
    process.exit(0);
}

if (mode === "known-good") {
    ensureWorktree(badDir, BASE);
    reset(badDir);
    replaceOnce(
        path.join(badDir, "vertex/shared/saved-design-snapshot.ts"),
        `        const fallback = defaultFlangeMmFromLevel(entry.level);
        const medial = entry.medial_mm ?? fallback;
        const lateral = entry.lateral_mm ?? fallback;`,
        `        const fallback = defaultFlangeMmFromLevel(entry.level);
        const bothOmitted = entry.medial_mm === undefined && entry.lateral_mm === undefined;
        const fillOmitted = bothOmitted || entry.level !== undefined;
        const medial = entry.medial_mm ?? (fillOmitted ? fallback : 0);
        const lateral = entry.lateral_mm ?? (fillOmitted ? fallback : 0);`,
    );
    replaceOnce(
        path.join(badDir, "vertex/server/src/lib/saved-design-snapshot.ts"),
        `            if (catalogSetsSliderField(catalog, side, key)) continue;
            if (key === "archHeightMm" && catalog.arch !== undefined) continue;`,
        `            if (catalogSetsSliderField(catalog, side, key)) continue;
            if (
                (key === "medialFlangeMm" || key === "lateralFlangeMm") &&
                catalog.flange?.[side] !== undefined
            ) {
                continue;
            }
            if (key === "archHeightMm" && catalog.arch !== undefined) continue;`,
    );
    replaceOnce(
        path.join(badDir, "vertex/src/lib/clinical/saved-design-snapshot.test.ts"),
        `        expect(split.design.corrections.right.medialFlangeMm).toBe(3);
        expect(split.design.corrections.right.lateralFlangeMm).toBe(3);`,
        `        expect(split.design.corrections.right.medialFlangeMm).toBe(3);
        expect(split.design.corrections.right.lateralFlangeMm).toBe(0);`,
    );
    const baseline = "/tmp/flz-probe-flz-base.json";
    if (!existsSync(baseline)) throw new Error("run noop first so the BASE probe exists");
    const result = runGates(badDir, ["--baseline-json", baseline, "--expect-head", BASE], "known-good.json");
    const expectPass = [
        "G_ONE_EXPLICIT",
        "G_TESTS_OMITTED",
        "G_ONE",
        "G_MUST_SLIDERS",
        "G_MUST_BILATERAL",
        "G_TESTS_EXISTING",
        "G_R1_SURFACE",
        "G_R2_SEAMS",
        "G_R3_SCOPE",
        "G_R4_SAMPLE_TOP",
        "G_R5_TEXT_MARKING",
        "G_R6_SECURITY",
        "G_R7_UNAFFECTED",
    ];
    let ok = true;
    for (const id of expectPass) {
        if (!gatePass(result.report, id)) {
            process.stderr.write(`known-good expected PASS ${id}\n`);
            ok = false;
        }
    }
    if (!ok) process.exit(1);
    process.stdout.write("known-good proof passed the defect gates without failing must-match or R1-R7\n");
    process.exit(0);
}

if (mode === "bad") {
    ensureWorktree(badDir, BASE);
    const baseline = "/tmp/flz-probe-flz-base.json";
    if (!existsSync(baseline)) throw new Error("run noop first so the BASE probe exists");
    const cases = [
        {
            id: "G_ONE",
            skipExisting: true,
            patch() {
                replaceOnce(
                    path.join(badDir, "vertex/shared/saved-design-snapshot.ts"),
                    `        const medial = entry.medial_mm ?? fallback;
        const lateral = entry.lateral_mm ?? fallback;`,
                    `        const medial = entry.medial_mm ?? fallback;
        const lateral = 3;`,
                );
            },
        },
        {
            id: "G_ONE_EXPLICIT",
            skipExisting: true,
            patch() {
                replaceOnce(
                    path.join(badDir, "vertex/shared/saved-design-snapshot.ts"),
                    `        const medial = entry.medial_mm ?? fallback;
        const lateral = entry.lateral_mm ?? fallback;`,
                    `        const medial = entry.medial_mm ?? fallback;
        const lateral = 3;`,
                );
            },
        },
        {
            id: "G_TESTS_OMITTED",
            skipExisting: true,
            patch() {
                replaceOnce(
                    path.join(badDir, "vertex/shared/saved-design-snapshot.ts"),
                    `        const medial = entry.medial_mm ?? fallback;
        const lateral = entry.lateral_mm ?? fallback;`,
                    `        const medial = entry.medial_mm ?? fallback;
        const lateral = 3;`,
                );
            },
        },
        {
            id: "G_MUST_SLIDERS",
            skipExisting: true,
            patch() {
                replaceOnce(
                    path.join(badDir, "vertex/shared/saved-design-snapshot.ts"),
                    `        if (typeof value !== "number") continue;
        (side as unknown as Record<string, number>)[field] = value;`,
                    `        if (typeof value !== "number") continue;
        (side as unknown as Record<string, number>)[field] = key === "lateral_flange_mm" ? 3 : value;`,
                );
            },
        },
        {
            id: "G_MUST_BILATERAL",
            skipExisting: true,
            patch() {
                replaceOnce(
                    path.join(badDir, "vertex/shared/saved-design-snapshot.ts"),
                    `        const medial = entry.medial_mm ?? fallback;
        const lateral = entry.lateral_mm ?? fallback;`,
                    `        const medial = 0;
        const lateral = 0;`,
                );
            },
        },
        {
            id: "G_TESTS_EXISTING",
            skipExisting: false,
            patch() {
                replaceOnce(
                    path.join(badDir, "vertex/shared/saved-design-catalog.ts"),
                    `    mild: 2,
    standard: 3,
    high: 6,`,
                    `    mild: 2,
    standard: 4,
    high: 6,`,
                );
            },
        },
        {
            id: "G_R1_SURFACE",
            skipExisting: true,
            patch() {
                appendFileSync(
                    path.join(badDir, "vertex/src/lib/geometry/export-geometry.ts"),
                    "\n// flz-bad-surface\n",
                );
            },
        },
        {
            id: "G_R2_SEAMS",
            skipExisting: true,
            patch() {
                appendFileSync(path.join(badDir, "vertex/src/lib/kiri/slicer.ts"), "\n// flz-bad-seam\n");
            },
        },
        {
            id: "G_R3_SCOPE",
            skipExisting: true,
            patch() {
                appendFileSync(path.join(badDir, "vertex/src/lib/kiri/slicer.ts"), "\n// flz-bad-scope\n");
            },
        },
        {
            id: "G_R4_SAMPLE_TOP",
            skipExisting: true,
            patch() {
                replaceOnce(
                    path.join(badDir, "vertex/shared/saved-design-snapshot.ts"),
                    'const SAMPLE_TOP_ASSET_ID = "sample-top";',
                    'const SAMPLE_TOP_ASSET_ID = "not-sample-top";',
                );
            },
        },
        {
            id: "G_R5_TEXT_MARKING",
            skipExisting: true,
            patch() {
                replaceOnce(
                    path.join(badDir, "vertex/shared/bottom-text-marking.ts"),
                    `        surface: "bottom",
        mode: "engrave",`,
                    `        surface: "top",
        mode: "engrave",`,
                );
            },
        },
        {
            id: "G_R6_SECURITY",
            skipExisting: true,
            patch() {
                const dir = path.join(badDir, "vertex-api");
                mkdirSync(dir, { recursive: true });
                writeFileSync(path.join(dir, "leak.ts"), 'const api_key = "abcd1234secret";\n');
            },
        },
        {
            id: "G_R7_UNAFFECTED",
            skipExisting: true,
            patch() {
                replaceOnce(
                    path.join(badDir, "vertex/shared/saved-design-snapshot.ts"),
                    `        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,`,
                    `        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 1,
        lateralFlangeMm: 0,`,
                );
            },
        },
    ];
    const failures = [];
    for (const item of cases) {
        reset(badDir);
        item.patch();
        const extra = ["--baseline-json", baseline, "--only", item.id, "--expect-head", BASE];
        if (item.skipExisting) extra.push("--skip-existing-tests");
        const result = runGates(badDir, extra, `bad-${item.id}.json`);
        if (!result.report || gatePass(result.report, item.id)) {
            failures.push(item.id);
            process.stderr.write(`bad-change expected FAIL ${item.id}\n`);
        } else {
            process.stdout.write(`bad-change FAIL confirmed ${item.id}\n`);
        }
    }
    if (failures.length) process.exit(1);
    process.stdout.write("bad-change proofs failed every targeted gate\n");
    process.exit(0);
}

process.stderr.write("usage: node prove.mjs noop|known-good|bad\n");
process.exit(2);
