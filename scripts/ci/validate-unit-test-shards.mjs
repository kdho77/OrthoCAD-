#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listUnitTestFiles } from "./list-unit-test-files.mjs";

const manifestPath = resolve("ci/unit-test-shards.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

let expected;
try {
    expected = listUnitTestFiles();
} catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
}
const fromManifest = manifest.shards.flatMap((s) => s.files).sort();

if (expected.length !== fromManifest.length) {
    const inExpected = new Set(expected);
    const inManifest = new Set(fromManifest);
    const missing = expected.filter((f) => !inManifest.has(f));
    const extra = fromManifest.filter((f) => !inExpected.has(f));
    console.error(`Count mismatch: unit tests ${expected.length}, manifest ${fromManifest.length}`);
    if (missing.length) console.error("Missing:", missing.join("\n"));
    if (extra.length) console.error("Extra:", extra.join("\n"));
    process.exit(1);
}

for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== fromManifest[i]) {
        const inExpected = new Set(expected);
        const inManifest = new Set(fromManifest);
        const missing = expected.filter((f) => !inManifest.has(f));
        const extra = fromManifest.filter((f) => !inExpected.has(f));
        console.error("Manifest does not match rstest list.");
        if (missing.length) console.error("Missing:", missing.join("\n"));
        if (extra.length) console.error("Extra:", extra.join("\n"));
        process.exit(1);
    }
}

const seen = new Set();
for (const shard of manifest.shards) {
    for (const file of shard.files) {
        if (seen.has(file)) {
            console.error(`Duplicate assignment: ${file}`);
            process.exit(1);
        }
        seen.add(file);
    }
}

if (manifest.shardCount !== manifest.shards.length) {
    console.error("shardCount does not match shards array length");
    process.exit(1);
}

console.log(`OK: ${expected.length} test files partitioned across ${manifest.shardCount} shards`);
