// Frozen rigid heel-lift cup-depth gates.
// Logic files stay byte-identical to the freeze commit's manifest.
// RESULTS.md, RULES.md, HANDOFF.md, and proofs/ are reports and are not hashed.
// Do not edit after the gates pull request is opened.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg, repoFile, sha256File } from "./lib.mjs";

const manifestPath = resolve(import.meta.dirname, "frozen/logic.sha256");

function fail(message) {
    console.error(`FAIL frozen: ${message}`);
    process.exitCode = 1;
}

const root = arg("--root");
const map = new Map();
for (const line of readFileSync(manifestPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const space = trimmed.indexOf("  ");
    if (space < 0) throw new Error(`bad manifest line ${JSON.stringify(trimmed)}`);
    map.set(trimmed.slice(space + 2), trimmed.slice(0, space));
}
if (map.size < 8) fail(`logic manifest has ${map.size} files`);
for (const [rel, want] of map) {
    const got = sha256File(repoFile(rel, root));
    if (got !== want) fail(`${rel} SHA-256 ${got} != frozen ${want}`);
    else console.log(`PASS frozen: ${rel} ${got}`);
}
if (process.exitCode) process.exit(process.exitCode);
console.log("PASS frozen: gate logic matches the freeze manifest");
