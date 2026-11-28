// Frozen rigid heel-lift cup-depth gates.
// The seat sample is the lowest heel-seat point, and the rise is compared to H.
// Do not edit after the gates pull request is opened.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg } from "./lib.mjs";

const REQUIRED = [
    "p.z < seat.z - 1e-6",
    "assertIsLowestHeelSeat",
    "Math.abs(row.dSeat - H)",
    "lowest heel-seat point",
];

const FORBIDDEN = ["heelLiftDeltaAt", "percentile", "p.z > seat.z"];

function fail(message) {
    console.error(`FAIL seat-rule: ${message}`);
    process.exitCode = 1;
}

const file = arg("--file") ?? resolve(import.meta.dirname, "measure.ts");
const source = readFileSync(file, "utf8");
for (const needle of REQUIRED) {
    if (!source.includes(needle)) fail(`measure.ts is missing ${JSON.stringify(needle)}`);
    else console.log(`PASS seat-rule: contains ${JSON.stringify(needle)}`);
}
for (const needle of FORBIDDEN) {
    if (source.includes(needle))
        fail(`measure.ts selects a seat other than the lowest point via ${JSON.stringify(needle)}`);
    else console.log(`PASS seat-rule: no ${JSON.stringify(needle)}`);
}
if (process.exitCode) process.exit(process.exitCode);
console.log("PASS seat-rule: seat rise is H at the lowest heel-seat point");
