// Frozen rigid heel-lift cup-depth gates.
// Do not edit after the gates pull request is opened.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const GATES_DIR = resolve(import.meta.dirname);
export const REPO_ROOT = resolve(GATES_DIR, "../..");
export const FROZEN_DIR = resolve(GATES_DIR, "frozen");
export const GATES_PREFIX = "validation/heel_lift_rigid_cup_gates/";
export const BASE_SHA = "df78a4f1a6a657c4e72e15c14c797ad2f492669a";

export const RATIO_LINE = "export const SKEW_INSET_RATIO = 0.5;";
export const SKEW_CAP_LINE = "const skewCap = SKEW_INSET_RATIO * Math.max(insetMm, 0);";
export const PAIRING_CAP_LINE =
    "const cap = Math.min(SKEW_LIMIT_MM, SKEW_INSET_RATIO * Math.max(inset, 1e-6));";

export const STATION_GATES = "vertex/src/lib/geometry/procedural-wall/station-gates.ts";
export const STATIONS = "vertex/src/lib/geometry/procedural-wall/stations.ts";

export const MEASURE = "validation/heel_lift_rigid_cup_gates/measure.ts";
export const THRESHOLDS = "validation/heel_lift_rigid_cup_gates/thresholds.ts";
export const CLINICAL = "validation/heel_lift_rigid_cup_gates/heel-lift-rigid-cup.optional.test.ts";

export function readText(path) {
    return readFileSync(path, "utf8");
}

export function repoFile(rel, root = REPO_ROOT) {
    return resolve(root, rel);
}

export function sha256Text(text) {
    return createHash("sha256").update(text).digest("hex");
}

export function sha256File(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function stripOneTrailingNewline(text) {
    return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function extractFunction(source, name) {
    const marker = `export function ${name}(`;
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`missing export function ${name}`);
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

export function productPaths(paths) {
    return paths.filter((rel) => {
        const norm = rel.replaceAll("\\", "/").replace(/^\.\//, "");
        return norm.length > 0 && !norm.startsWith(GATES_PREFIX);
    });
}

export function arg(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
