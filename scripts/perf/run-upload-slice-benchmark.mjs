#!/usr/bin/env node
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Post-solid timing for SAMPLE_Top L+R (default, then Morton's extension).
// Does not call VertexSlice. Writes scripts/perf/upload-slice-benchmark.last.json.
//
//   node scripts/perf/run-upload-slice-benchmark.mjs

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config = resolve(root, "scripts/perf/rstest.upload-slice.config.ts");

const proc = spawnSync("npx", ["rstest", "--config", config, "scripts/perf/upload-slice-benchmark.test.ts"], {
    cwd: root,
    env: { ...process.env },
    stdio: "inherit",
});

process.exit(proc.status ?? 1);
