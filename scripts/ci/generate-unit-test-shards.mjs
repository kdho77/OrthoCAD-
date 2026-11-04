#!/usr/bin/env node
/**
 * Build ci/unit-test-shards.json from `npx rstest list --filesOnly`.
 * Heavy geometry suites are pinned to different shards so one runner
 * does not inherit procedural-wall + sink gates together.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { listUnitTestFiles } from "./list-unit-test-files.mjs";

const SHARD_COUNT = 6;
const OUT = resolve("ci/unit-test-shards.json");

/** Paths relative to repo root — keep on distinct shards from each other. */
const PINNED_HEAVY = {
    "tests/procedural-wall-s1-parity.test.ts": 1,
    "tests/procedural-wall-style.test.ts": 2,
    "tests/s1-ring-size-regression.test.ts": 3,
    "tests/one-click-export-artifacts.test.ts": 3,
    "tests/export-order-parity.test.ts": 6,
    "tests/sink-fold-gate.test.ts": 2,
    "tests/sink-medial-band.test.ts": 3,
    "tests/procedural-wall-s0-parity.test.ts": 5,
    "tests/rim-conformity-matrix.test.ts": 5,
    "tests/arch-dome-smoothness.test.ts": 6,
    "tests/apex-move-standard-flexible.test.ts": 5,
    "tests/bottom-wall-rim-conformity.test.ts": 6,
    "tests/heel-cup-depth.realmesh.test.ts": 2,
    "tests/heel-cup-depth.export-solid.test.ts": 3,
    "tests/toprim-extraction.test.ts": 4,
    "tests/two-pointer-walk-steering.phase3.test.ts": 5,
    "tests/synced-bottom-shell-field.test.ts": 6,
};

const files = listUnitTestFiles();
const shards = Array.from({ length: SHARD_COUNT }, () => []);

for (const file of files) {
    const pinned = PINNED_HEAVY[file];
    if (pinned != null) {
        shards[pinned - 1].push(file);
        continue;
    }
    const smallest = shards.reduce(
        (best, bucket, index) => (bucket.length < shards[best].length ? index : best),
        0,
    );
    shards[smallest].push(file);
}

for (const [file, shard] of Object.entries(PINNED_HEAVY)) {
    if (!files.includes(file)) {
        throw new Error(`Pinned file missing from rstest list: ${file}`);
    }
}

const payload = {
    shardCount: SHARD_COUNT,
    generatedFrom: "npx rstest list --filesOnly",
    shards: shards.map((bucket, index) => ({
        index: index + 1,
        files: bucket.sort(),
    })),
};

writeFileSync(OUT, `${JSON.stringify(payload, null, 4)}\n`);
console.log(`Wrote ${OUT} (${files.length} files across ${SHARD_COUNT} shards)`);
for (const { index, files: bucket } of payload.shards) {
    console.log(`  shard ${index}: ${bucket.length} files`);
}
