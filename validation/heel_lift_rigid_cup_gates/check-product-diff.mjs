// Frozen rigid heel-lift cup-depth gates.
// This change may only add files under validation/heel_lift_rigid_cup_gates/.
// Do not edit after the gates pull request is opened.

import { spawnSync } from "node:child_process";
import { BASE_SHA, productPaths } from "./lib.mjs";

function fail(message) {
    console.error(`FAIL product-diff: ${message}`);
    process.exitCode = 1;
}

function pathsFromPorcelain(text) {
    const out = [];
    for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const path = line.slice(3).trim();
        const renamed = path.includes(" -> ") ? path.split(" -> ").pop() : path;
        if (renamed) out.push(renamed);
    }
    return out;
}

if (process.argv.includes("--self-test")) {
    const bad = productPaths([
        "validation/heel_lift_rigid_cup_gates/README.md",
        "vertex/src/lib/geometry/base-modifier.ts",
    ]);
    if (bad.length !== 1 || bad[0] !== "vertex/src/lib/geometry/base-modifier.ts") {
        fail(`self-test classified ${JSON.stringify(bad)}`);
        process.exit(1);
    }
    console.log("PASS product-diff: a product-file path is rejected");
    process.exit(0);
}

const diff = spawnSync("git", ["diff", "--name-only", BASE_SHA, "--"], { encoding: "utf8" });
const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
if (diff.status !== 0 || status.status !== 0) {
    fail(diff.stderr || status.stderr || "git diff failed");
    process.exit(1);
}
const names = [
    ...diff.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ...pathsFromPorcelain(status.stdout),
];
const outside = productPaths(names);
if (outside.length) {
    fail(`product files differ from BASE ${BASE_SHA}: ${outside.join(", ")}`);
    process.exit(1);
}
console.log(`PASS product-diff: no product file differs from BASE ${BASE_SHA}`);
