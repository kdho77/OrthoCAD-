#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shardIndex = Number(process.argv[2]);
if (!Number.isInteger(shardIndex) || shardIndex < 1) {
    console.error("Usage: node scripts/ci/run-unit-test-shard.mjs <1-based-shard-index>");
    process.exit(1);
}

const manifest = JSON.parse(readFileSync(resolve("ci/unit-test-shards.json"), "utf8"));
const shard = manifest.shards.find((s) => s.index === shardIndex);
if (!shard) {
    console.error(`Unknown shard index ${shardIndex}`);
    process.exit(1);
}

console.log(`Running shard ${shardIndex}/${manifest.shardCount} (${shard.files.length} files)`);

execFileSync("npx", ["rstest", ...shard.files], {
    stdio: "inherit",
    cwd: resolve("."),
});
