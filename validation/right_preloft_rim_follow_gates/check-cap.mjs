// Frozen Right-foot [S1-PRELOFT] rim-follow gates.
// The 0.5×inset skew cap and assertPreLoftStations stay the main text.
// A copy that loosens the cap, or drops the rim-follow / assert calls, is rejected.
// Do not edit after the gates pull request is opened.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    ASSERT_CALL,
    extractFunction,
    RATIO_LINE,
    RECONSTRUCT,
    REPO_ROOT,
    RIM_FOLLOW_CALL,
    repoFile,
    SAMPLE_TOP_PREVIEW,
    SKEW_CAP_LINE,
    STATION_GATES,
    sha256Text,
    stripOneTrailingNewline,
} from "./lib.mjs";

const frozenBodyPath = resolve(import.meta.dirname, "frozen/assert-preloft-stations.txt");

function arg(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message) {
    console.error(`FAIL cap: ${message}`);
    process.exitCode = 1;
}

function countLine(source, line) {
    return source.split("\n").filter((row) => row.trim() === line).length;
}

const stationOnly = process.argv.includes("--station-only");
const stationPath = arg("--file") ?? repoFile(STATION_GATES);
const stationRel = arg("--file") ? arg("--file") : STATION_GATES;

let source;
try {
    source = readFileSync(stationPath, "utf8");
} catch (error) {
    fail(`cannot read ${stationRel}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
}

const ratioCount = countLine(source, RATIO_LINE);
if (ratioCount !== 1) {
    fail(`need exactly one ${JSON.stringify(RATIO_LINE)} in ${stationRel}, found ${ratioCount}`);
}

let body;
try {
    body = extractFunction(source, "assertPreLoftStations");
} catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    process.exit(1);
}

if (!body.includes(SKEW_CAP_LINE)) {
    fail(`assertPreLoftStations is missing ${JSON.stringify(SKEW_CAP_LINE)}`);
}
if (!body.includes("if (skewMm > skewCap + 1e-3)")) {
    fail("assertPreLoftStations no longer rejects skew above the 0.5×inset cap");
}

const frozenBody = stripOneTrailingNewline(readFileSync(frozenBodyPath, "utf8"));
if (body !== frozenBody) {
    fail(
        `assertPreLoftStations body differs from frozen main (live ${sha256Text(body)} frozen ${sha256Text(frozenBody)})`,
    );
} else {
    console.log(`PASS cap: assertPreLoftStations SHA-256 ${sha256Text(body)} matches frozen main`);
}

if (process.exitCode) process.exit(process.exitCode);

if (!stationOnly) {
    const preview = readFileSync(resolve(REPO_ROOT, SAMPLE_TOP_PREVIEW), "utf8");
    const reconstruct = readFileSync(resolve(REPO_ROOT, RECONSTRUCT), "utf8");
    if (countLine(preview, RIM_FOLLOW_CALL) !== 1) {
        fail(`rim-follow call is not the frozen line in ${SAMPLE_TOP_PREVIEW}`);
    } else {
        console.log("PASS cap: shoe-width rim-follow call is unchanged");
    }
    if (countLine(reconstruct, ASSERT_CALL) !== 1) {
        fail(`assertPreLoftStations call is not the frozen line in ${RECONSTRUCT}`);
    } else {
        console.log("PASS cap: reconstruct still calls assertPreLoftStations");
    }
}

if (process.exitCode) process.exit(process.exitCode);
console.log("PASS cap: SKEW_INSET_RATIO stays 0.5 and the skew cap formula is unchanged");
