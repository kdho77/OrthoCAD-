// Frozen Right-foot [S1-PRELOFT] rim-follow gates.
// Gate files do not change product code. Any path outside this directory fails.
// Do not edit after the gates pull request is opened.

import { spawnSync } from "node:child_process";
import { baseSha, productPaths, REPO_ROOT } from "./lib.mjs";

function fail(message) {
    console.error(`FAIL product-diff: ${message}`);
    process.exitCode = 1;
}

function gitLines(args) {
    const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
    }
    return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

if (process.argv.includes("--self-test")) {
    const bad = productPaths([
        "validation/right_preloft_rim_follow_gates/check-cap.mjs",
        "vertex/src/lib/kiri/slicer.ts",
    ]);
    const good = productPaths(["validation/right_preloft_rim_follow_gates/frozen/left-pins.json"]);
    if (bad.length !== 1 || bad[0] !== "vertex/src/lib/kiri/slicer.ts") {
        fail(`classifier did not reject a product path: ${bad.join(", ")}`);
    } else {
        console.log("PASS product-diff: a product-file path is rejected");
    }
    if (good.length !== 0) {
        fail(`classifier rejected a gate file: ${good.join(", ")}`);
    } else {
        console.log("PASS product-diff: a gate-file path is allowed");
    }
    if (process.exitCode) process.exit(process.exitCode);
}

const base = baseSha();
const tracked = gitLines(["diff", "--name-only", base, "--"]);
const untracked = gitLines(["ls-files", "--others", "--exclude-standard"]);
const changed = [...tracked, ...untracked];
const product = productPaths(changed);
if (product.length) {
    fail(`product files differ from ${base}:\n${product.join("\n")}`);
    process.exit(1);
}
console.log(`PASS product-diff: 0 product paths differ from ${base} (${changed.length} gate path(s))`);
