// Frozen Right-foot [S1-PRELOFT] rim-follow gates.
// Written against main f759bde1e212ae99d475601fc58dd89dd37469c7.
// Do not edit after the gates pull request is opened.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const GATES_DIR = resolve(import.meta.dirname);
export const REPO_ROOT = resolve(GATES_DIR, "../..");
export const FROZEN_DIR = resolve(GATES_DIR, "frozen");
export const GATES_PREFIX = "validation/right_preloft_rim_follow_gates/";

export const RATIO_LINE = "export const SKEW_INSET_RATIO = 0.5;";
export const SKEW_CAP_LINE = "const skewCap = SKEW_INSET_RATIO * Math.max(insetMm, 0);";
export const RIM_FOLLOW_CALL =
    "return loft(shiftPatternByRimFollow(scaledPattern, shoeWidthRimBefore, shoeWidthRimAfter, 1));";
export const ASSERT_CALL = "assertPreLoftStations(stations, r1, r2, stationSkewOpts);";

export const STATION_GATES = "vertex/src/lib/geometry/procedural-wall/station-gates.ts";
export const SAMPLE_TOP_PREVIEW = "vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts";
export const RECONSTRUCT = "vertex/src/lib/geometry/procedural-wall/reconstruct.ts";

export function readText(path) {
    return readFileSync(path, "utf8");
}

export function repoFile(rel) {
    return resolve(REPO_ROOT, rel);
}

export function baseSha() {
    return readText(resolve(FROZEN_DIR, "BASE.txt")).trim();
}

export function sha256Text(text) {
    return createHash("sha256").update(text).digest("hex");
}

export function sha256File(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Drop a single trailing newline so the frozen excerpt can be a text file. */
export function stripOneTrailingNewline(text) {
    return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function extractFunction(source, name) {
    const marker = `export function ${name}(`;
    const start = source.indexOf(marker);
    if (start < 0) {
        throw new Error(`missing export function ${name}`);
    }
    let i = start + marker.length - 1;
    let paren = 0;
    let angle = 0;
    for (; i < source.length; i++) {
        const ch = source[i];
        if (ch === "(") paren += 1;
        else if (ch === ")") {
            paren -= 1;
            if (paren === 0 && angle === 0) {
                i += 1;
                break;
            }
        } else if (ch === "<") angle += 1;
        else if (ch === ">") angle -= 1;
    }
    while (i < source.length && source[i] !== "{") i += 1;
    if (source[i] !== "{") throw new Error(`missing body for ${name}`);
    let depth = 0;
    for (; i < source.length; i++) {
        const ch = source[i];
        if (ch === "{") depth += 1;
        else if (ch === "}") {
            depth -= 1;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`unclosed export function ${name}`);
}

export function surfacePaths() {
    return readText(resolve(FROZEN_DIR, "surface-files.txt"))
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Paths that are product code. Gate files under the gates directory are the
 * only paths this change is allowed to add.
 */
export function productPaths(paths) {
    return paths.filter((rel) => {
        const norm = rel.replaceAll("\\", "/").replace(/^\.\//, "");
        return norm.length > 0 && !norm.startsWith(GATES_PREFIX);
    });
}

export function loadLeftPins() {
    return JSON.parse(readText(resolve(FROZEN_DIR, "left-pins.json")));
}

export function pinsEqual(actual, expected) {
    const keys = Object.keys(expected);
    const mismatches = [];
    for (const id of keys) {
        const want = expected[id];
        const got = actual[id];
        if (!got) {
            mismatches.push(`${id} missing`);
            continue;
        }
        if (got.verts !== want.verts) mismatches.push(`${id} verts ${got.verts}!=${want.verts}`);
        if (got.hash !== want.hash) mismatches.push(`${id} hash ${got.hash}!=${want.hash}`);
    }
    for (const id of Object.keys(actual)) {
        if (!expected[id]) mismatches.push(`${id} unexpected`);
    }
    return mismatches;
}
