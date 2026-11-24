// Frozen Right-foot [S1-PRELOFT] rim-follow gates.
// Left STL pins are the narrow-heelcup-preloft hashes from main.
// A changed hash is rejected. Do not edit after the gates pull request is opened.

import { loadLeftPins, pinsEqual } from "./lib.mjs";

function fail(message) {
    console.error(`FAIL left-pins: ${message}`);
    process.exitCode = 1;
}

const expected = loadLeftPins();
if (!process.argv.includes("--self-test")) {
    console.log(`PASS left-pins: frozen catalog has ${Object.keys(expected).length} main pins`);
    for (const [id, pin] of Object.entries(expected)) {
        console.log(`  ${id} verts=${pin.verts} sha256=${pin.hash}`);
    }
    process.exit(0);
}

const same = pinsEqual(expected, expected);
if (same.length) {
    fail(`identical pins were rejected: ${same.join("; ")}`);
} else {
    console.log("PASS left-pins: unchanged pins match");
}

const flipped = structuredClone(expected);
const id = Object.keys(flipped)[0];
const hash = flipped[id].hash;
flipped[id].hash = `${hash.slice(0, -1)}${hash.endsWith("a") ? "b" : "a"}`;
const mismatches = pinsEqual(flipped, expected);
if (!mismatches.some((row) => row.includes(id) && row.includes("hash"))) {
    fail("a one-nibble hash change was accepted");
} else {
    console.log(`PASS left-pins: bad hash rejected (${mismatches[0]})`);
}

if (process.exitCode) process.exit(process.exitCode);
