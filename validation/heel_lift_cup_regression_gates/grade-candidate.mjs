// Grade a candidate SHA with the frozen gates. Does not edit product code or the gates.
// Usage: node validation/heel_lift_cup_regression_gates/grade-candidate.mjs <sha>

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";

const sha = process.argv[2];
if (!sha || sha.startsWith("-")) {
    console.error("usage: grade-candidate.mjs <sha>");
    process.exit(1);
}

const root = resolve(import.meta.dirname, "../..");
const wt = `/tmp/heel-lift-grade-${sha.slice(0, 12)}`;
const node = process.execPath;

function run(cmd, args, cwd) {
    return spawnSync(cmd, args, { encoding: "utf8", cwd });
}

rmSync(wt, { recursive: true, force: true });
const add = spawnSync("git", ["worktree", "add", "--detach", wt, sha], { cwd: root, encoding: "utf8" });
if (add.status !== 0) {
    console.error(add.stderr || add.stdout);
    process.exit(1);
}

function link(from, to) {
    if (!existsSync(from)) return;
    rmSync(to, { recursive: true, force: true });
    symlinkSync(from, to);
}

link(resolve(root, "node_modules"), resolve(wt, "node_modules"));
link(resolve(root, "vertex/node_modules"), resolve(wt, "vertex/node_modules"));
mkdirSync(resolve(wt, "packages/mcp"), { recursive: true });
link(resolve(root, "packages/mcp/node_modules"), resolve(wt, "packages/mcp/node_modules"));
cpSync(
    resolve(root, "validation/heel_lift_cup_regression_gates"),
    resolve(wt, "validation/heel_lift_cup_regression_gates"),
    {
        recursive: true,
    },
);

const gates = "validation/heel_lift_cup_regression_gates";
const steps = [
    ["surface", node, [`${gates}/check-surface.mjs`, "--root", wt]],
    ["cap", node, [`${gates}/check-cap.mjs`, "--root", wt]],
    [
        "clinical",
        "npx",
        [
            "rstest",
            "run",
            "--config",
            `${gates}/rstest.gates.config.ts`,
            `${gates}/heel-lift-cup.optional.test.ts`,
        ],
    ],
];

let failed = 0;
for (const [label, cmd, args] of steps) {
    const result = run(cmd, args, wt);
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    console.log(`\n===== ${label} exit ${result.status} =====\n${text}`);
    if (result.status !== 0) failed += 1;
}

spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: root, encoding: "utf8" });
if (failed) {
    console.error(`FAIL candidate ${sha}: ${failed} gate step(s) failed`);
    process.exit(1);
}
console.log(`PASS candidate ${sha}`);
