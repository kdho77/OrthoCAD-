// Frozen heel-lift cup-depth gates.
// Outer surface, seam, layer-change, and slicer files stay byte-identical to BASE.
// Do not edit after the gates pull request is opened.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg, repoFile, sha256File, surfacePaths } from "./lib.mjs";

const manifestPath = resolve(import.meta.dirname, "frozen/surface-files.sha256");

function fail(message) {
    console.error(`FAIL surface: ${message}`);
    process.exitCode = 1;
}

function loadManifest() {
    const map = new Map();
    for (const line of readFileSync(manifestPath, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const space = trimmed.indexOf("  ");
        if (space < 0) throw new Error(`bad manifest line ${JSON.stringify(trimmed)}`);
        map.set(trimmed.slice(space + 2), trimmed.slice(0, space));
    }
    return map;
}

const manifest = loadManifest();
const compare = arg("--compare");
const original = arg("--original");
const root = arg("--root");

if (compare || original) {
    if (!compare || !original) {
        fail("--compare and --original are both required");
        process.exit(1);
    }
    const want = manifest.get(original);
    if (!want) {
        fail(`no frozen hash for ${original}`);
        process.exit(1);
    }
    const got = sha256File(compare);
    if (got === want) console.log(`PASS surface: copy matches frozen ${original}`);
    else fail(`copy of ${original} is ${got}, frozen is ${want}`);
    process.exit(process.exitCode ?? 0);
}

const paths = surfacePaths();
if (paths.length !== manifest.size) {
    fail(`surface path list has ${paths.length} files, manifest has ${manifest.size}`);
}
for (const rel of paths) {
    const want = manifest.get(rel);
    if (!want) {
        fail(`missing frozen hash for ${rel}`);
        continue;
    }
    const got = sha256File(repoFile(rel, root));
    if (got !== want) fail(`${rel} SHA-256 ${got} != frozen ${want}`);
    else console.log(`PASS surface: ${rel} ${got}`);
}
for (const rel of manifest.keys()) {
    if (!paths.includes(rel)) fail(`manifest path ${rel} is not in surface-files.txt`);
}
if (process.exitCode) process.exit(process.exitCode);
console.log("PASS surface: outer-surface, seam, layer-change, and slicer files match BASE");
