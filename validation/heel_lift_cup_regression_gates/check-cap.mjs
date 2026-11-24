// Frozen heel-lift cup-depth gates.
// The 0.5×inset S1-PRELOFT cap stays the BASE text.
// Do not edit after the gates pull request is opened.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    arg,
    extractFunction,
    PAIRING_CAP_LINE,
    RATIO_LINE,
    repoFile,
    SKEW_CAP_LINE,
    STATION_GATES,
    STATIONS,
    sha256Text,
    stripOneTrailingNewline,
} from "./lib.mjs";

const frozenBodyPath = resolve(import.meta.dirname, "frozen/assert-preloft-stations.txt");

function fail(message) {
    console.error(`FAIL cap: ${message}`);
    process.exitCode = 1;
}

function countLine(source, line) {
    return source.split("\n").filter((row) => row.trim() === line).length;
}

const stationPath = arg("--file") ?? repoFile(STATION_GATES, arg("--root"));
const stationsPath = arg("--stations") ?? repoFile(STATIONS, arg("--root"));

let stationSource;
let stationsSource;
try {
    stationSource = readFileSync(stationPath, "utf8");
    stationsSource = readFileSync(stationsPath, "utf8");
} catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    process.exit(1);
}

if (countLine(stationSource, RATIO_LINE) !== 1) {
    fail(`need exactly one ${JSON.stringify(RATIO_LINE)} in station-gates.ts`);
}
if (countLine(stationsSource, RATIO_LINE) !== 1) {
    fail(`need exactly one ${JSON.stringify(RATIO_LINE)} in stations.ts`);
}
if (countLine(stationsSource, PAIRING_CAP_LINE) !== 1) {
    fail(`limitPairingSkew cap is not ${JSON.stringify(PAIRING_CAP_LINE)}`);
}

let body;
try {
    body = extractFunction(stationSource, "assertPreLoftStations");
} catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
if (!body.includes(SKEW_CAP_LINE)) fail(`assertPreLoftStations is missing ${JSON.stringify(SKEW_CAP_LINE)}`);
if (!body.includes("if (skewMm > skewCap + 1e-3)")) {
    fail("assertPreLoftStations no longer rejects skew above the 0.5×inset cap");
}
const frozenBody = stripOneTrailingNewline(readFileSync(frozenBodyPath, "utf8"));
if (body !== frozenBody) {
    fail(
        `assertPreLoftStations body differs from frozen BASE (live ${sha256Text(body)} frozen ${sha256Text(frozenBody)})`,
    );
} else {
    console.log(`PASS cap: assertPreLoftStations SHA-256 ${sha256Text(body)} matches frozen BASE`);
}
if (process.exitCode) process.exit(process.exitCode);
console.log("PASS cap: SKEW_INSET_RATIO stays 0.5 and the 0.5×inset cap formulas are unchanged");
