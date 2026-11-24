// Frozen heel-lift cup-depth gates.
// Cup-depth tolerance stays 0.2 mm. A looser constant is rejected.
// Do not edit after the gates pull request is opened.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg } from "./lib.mjs";

const REQUIRED = [
    "export const SEAT_TOL_MM = 0.2;",
    "export const CUP_DEPTH_TOL_MM = 0.2;",
    "export const MET_HEAD_TOL_MM = 0.1;",
    "export const BELT_TOL_MM = 0.1;",
];

function fail(message) {
    console.error(`FAIL tolerance: ${message}`);
    process.exitCode = 1;
}

const file = arg("--file") ?? resolve(import.meta.dirname, "thresholds.ts");
const source = readFileSync(file, "utf8");
for (const line of REQUIRED) {
    const count = source.split("\n").filter((row) => row.trim() === line).length;
    if (count !== 1) fail(`need exactly one ${JSON.stringify(line)} in ${file}, found ${count}`);
    else console.log(`PASS tolerance: ${line}`);
}
if (process.exitCode) process.exit(process.exitCode);
console.log("PASS tolerance: seat 0.2, cup 0.2, met 0.1, belt 0.1");
