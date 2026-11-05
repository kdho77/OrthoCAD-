#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

/**
 * Committed unit tests, minus the rstest.config.ts excludes.
 * GitHub Actions' `rstest list` was returning one more path than a local
 * list of the same commit, which failed every shard before any test ran.
 */
export function listUnitTestFiles() {
    const result = spawnSync("git", ["ls-files", "-z", "--", "*.test.ts", "*.test.tsx"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`git ls-files failed (exit ${result.status}): ${result.stderr || result.stdout}`);
    }
    const files = result.stdout
        .split("\0")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !excludedUnitTest(line));
    if (files.length === 0) {
        throw new Error("git ls-files returned no unit tests");
    }
    return [...new Set(files)].sort();
}

function excludedUnitTest(file) {
    const base = file.split("/").pop() ?? file;
    if (file.includes("/cpp/") || file.startsWith("cpp/")) return true;
    if (base.endsWith(".wasm.test.ts") || base.endsWith(".wasm.test.tsx")) return true;
    if (base.includes(".optional.test.")) return true;
    if (base.startsWith("dump-") && /\.test\.tsx?$/.test(base)) return true;
    if (base === "pressure-map.webgl.test.ts") return true;
    return false;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    for (const file of listUnitTestFiles()) {
        console.log(file);
    }
}
