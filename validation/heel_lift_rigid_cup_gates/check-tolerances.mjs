// Frozen rigid heel-lift cup-depth gates.
// Seat and cup tolerances stay ±0.3 mm. H = 6, 10, and 12. A looser constant is rejected.
// Do not edit after the gates pull request is opened.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg } from "./lib.mjs";

const REQUIRED = [
    "export const SEAT_TOL_MM = 0.3;",
    "export const CUP_DEPTH_TOL_MM = 0.3;",
    "export const MET_HEAD_TOL_MM = 0.1;",
    "export const BELT_TOL_MM = 0.1;",
    "export const LIFT_MM = [6, 10, 12] as const;",
];

function fail(message) {
    console.error(`FAIL tolerance: ${message}`);
    process.exitCode = 1;
}

const clinical = arg("--clinical");
if (clinical) {
    const source = readFileSync(clinical, "utf8");
    const loops = source.split("for (const H of LIFT_MM)").length - 1;
    if (loops < 2) {
        fail(`clinical gate skips H=10: need for (const H of LIFT_MM) twice, found ${loops}`);
    } else if (!source.includes('from "./thresholds"') || !source.includes("LIFT_MM")) {
        fail("clinical gate skips H=10: LIFT_MM is not the lift list");
    } else {
        console.log("PASS tolerance: clinical gate loops H=6, 10, and 12");
    }
    if (process.exitCode) process.exit(process.exitCode);
    process.exit(0);
}

const file = arg("--file") ?? resolve(import.meta.dirname, "thresholds.ts");
const source = readFileSync(file, "utf8");
for (const line of REQUIRED) {
    const count = source.split("\n").filter((row) => row.trim() === line).length;
    if (count !== 1) {
        const why = line.includes("LIFT_MM") ? " (H=10 is required)" : "";
        fail(`need exactly one ${JSON.stringify(line)} in ${file}, found ${count}${why}`);
    } else console.log(`PASS tolerance: ${line}`);
}
if (source.includes("heelLiftDeltaAt")) {
    fail("thresholds must not accept heelLiftDeltaAt in place of the full lift H");
}
if (process.exitCode) process.exit(process.exitCode);
console.log("PASS tolerance: seat ±0.3, cup ±0.3, met ±0.1, belt ±0.1, H=6, 10, and 12");
