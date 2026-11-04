#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const rstestBin = resolve(root, "node_modules/@rstest/core/bin/rstest.js");

/**
 * Same file set as `npx rstest list --filesOnly` (honors rstest.config.ts excludes).
 */
export function listUnitTestFiles() {
    if (!existsSync(rstestBin)) {
        throw new Error(`Missing ${rstestBin} — run npm install at repo root first.`);
    }

    const result = spawnSync(process.execPath, [rstestBin, "list", "--filesOnly"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: {
            ...process.env,
            NODE_OPTIONS: [
                process.env.NODE_OPTIONS,
                "--experimental-vm-modules",
                "--experimental-import-meta-resolve",
            ]
                .filter(Boolean)
                .join(" "),
        },
    });

    if (result.status !== 0) {
        throw new Error(
            `rstest list --filesOnly failed (exit ${result.status}): ${result.stderr || result.stdout}`,
        );
    }

    const files = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /\.test\.tsx?$/.test(line));

    if (files.length === 0) {
        throw new Error(
            `rstest list --filesOnly returned no test files; stdout=${JSON.stringify(result.stdout.slice(0, 500))}`,
        );
    }

    return [...new Set(files)].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    for (const file of listUnitTestFiles()) {
        console.log(file);
    }
}
