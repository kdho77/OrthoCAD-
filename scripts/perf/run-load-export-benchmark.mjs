#!/usr/bin/env node
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Local timing harness for SAMPLE_Top mesh load + manufacturing export.
// Usage (from repo root):
//   node scripts/perf/run-load-export-benchmark.mjs
//   BENCHMARK_JSON=1 node scripts/perf/run-load-export-benchmark.mjs

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config = resolve(root, "scripts/perf/rstest.benchmark.config.ts");

const proc = spawnSync(
    "npx",
    ["rstest", "--config", config, "scripts/perf/load-and-export-benchmark.test.ts"],
    {
        cwd: root,
        env: { ...process.env },
        stdio: "inherit",
    },
);

process.exit(proc.status ?? 1);
