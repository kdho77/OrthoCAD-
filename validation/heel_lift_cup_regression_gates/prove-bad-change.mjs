// Bad-change proofs. Each proof uses a throwaway copy. Product files are not modified.
// Exit 0 means every bad copy was rejected.
// Do not edit after the gates pull request is opened.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { repoFile, STATION_GATES, STATIONS } from "./lib.mjs";

const dir = mkdtempSync(resolve(tmpdir(), "heel-lift-gates-"));
const node = process.execPath;
const here = import.meta.dirname;

function run(script, args) {
    return spawnSync(node, [resolve(here, script), ...args], { encoding: "utf8" });
}

function expectReject(label, result, needle) {
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status === 0) {
        console.error(`FAIL bad-change: ${label} was accepted\n${text}`);
        process.exitCode = 1;
        return;
    }
    if (needle && !text.includes(needle)) {
        console.error(`FAIL bad-change: ${label} rejected without ${JSON.stringify(needle)}\n${text}`);
        process.exitCode = 1;
        return;
    }
    console.log(`PASS bad-change: ${label} rejected (exit ${result.status})`);
}

function expectAccept(label, result) {
    if (result.status !== 0) {
        console.error(`FAIL bad-change: ${label} did not pass\n${result.stdout}\n${result.stderr}`);
        process.exitCode = 1;
        return;
    }
    console.log(`PASS bad-change: ${label}`);
}

expectAccept("unchanged BASE cap", run("check-cap.mjs", []));
expectAccept("unchanged tolerances", run("check-tolerances.mjs", []));
expectAccept("unchanged surface files", run("check-surface.mjs", []));

const ratioCopy = resolve(dir, "station-gates-ratio.ts");
writeFileSync(
    ratioCopy,
    readFileSync(repoFile(STATION_GATES), "utf8").replace(
        "export const SKEW_INSET_RATIO = 0.5;",
        "export const SKEW_INSET_RATIO = 1;",
    ),
);
expectReject(
    "S1-PRELOFT SKEW_INSET_RATIO loosened from 0.5 to 1",
    run("check-cap.mjs", ["--file", ratioCopy]),
    "SKEW_INSET_RATIO",
);

const formulaCopy = resolve(dir, "station-gates-formula.ts");
writeFileSync(
    formulaCopy,
    readFileSync(repoFile(STATION_GATES), "utf8").replace(
        "const skewCap = SKEW_INSET_RATIO * Math.max(insetMm, 0);",
        "const skewCap = SKEW_INSET_RATIO * Math.max(insetMm, 0) * 4;",
    ),
);
expectReject(
    "0.5×inset cap multiplied by 4",
    run("check-cap.mjs", ["--file", formulaCopy]),
    "assertPreLoftStations body differs",
);

const stationsCopy = resolve(dir, "stations.ts");
writeFileSync(
    stationsCopy,
    readFileSync(repoFile(STATIONS), "utf8").replace(
        "const cap = Math.min(SKEW_LIMIT_MM, SKEW_INSET_RATIO * Math.max(inset, 1e-6));",
        "const cap = Math.min(SKEW_LIMIT_MM, SKEW_INSET_RATIO * Math.max(inset, 1e-6)) * 4;",
    ),
);
expectReject(
    "limitPairingSkew 0.5×inset cap multiplied by 4",
    run("check-cap.mjs", ["--stations", stationsCopy]),
    "limitPairingSkew",
);

const loose = resolve(dir, "thresholds.ts");
writeFileSync(
    loose,
    readFileSync(resolve(here, "thresholds.ts"), "utf8").replace(
        "export const CUP_DEPTH_TOL_MM = 0.2;",
        "export const CUP_DEPTH_TOL_MM = 8;",
    ),
);
expectReject(
    "cup-depth tolerance loosened from 0.2 mm to 8 mm",
    run("check-tolerances.mjs", ["--file", loose]),
    "CUP_DEPTH_TOL_MM",
);

const slicerRel = "vertex/src/lib/kiri/slicer.ts";
const slicerCopy = resolve(dir, "slicer.ts");
writeFileSync(
    slicerCopy,
    readFileSync(repoFile(slicerRel), "utf8").replace(
        "// Perimeters, outer → inner.",
        "// Perimeters, inner → outer.",
    ),
);
expectReject(
    "outer-surface perimeter order reversed",
    run("check-surface.mjs", ["--compare", slicerCopy, "--original", slicerRel]),
    "FAIL surface",
);

const engineRel = "vertex/src/lib/kiri/engine.ts";
const engineCopy = resolve(dir, "engine.ts");
writeFileSync(
    engineCopy,
    readFileSync(repoFile(engineRel), "utf8").replace("slow_down_layer_time = 0", "slow_down_layer_time = 5"),
);
expectReject(
    "layer-change timing constant edited",
    run("check-surface.mjs", ["--compare", engineCopy, "--original", engineRel]),
    "FAIL surface",
);

const seamRel = "vertex/src/lib/geometry/procedural-wall/ring-seam.ts";
const seamCopy = resolve(dir, "ring-seam.ts");
writeFileSync(
    seamCopy,
    readFileSync(repoFile(seamRel), "utf8").replace(
        "if (start === 0) return 0;",
        "if (start === 0) return 1;",
    ),
);
expectReject(
    "ring seam start moved off the frozen index",
    run("check-surface.mjs", ["--compare", seamCopy, "--original", seamRel]),
    "FAIL surface",
);

const pyRel = "python-service/app/services/slicer.py";
const pyCopy = resolve(dir, "slicer.py");
writeFileSync(
    pyCopy,
    readFileSync(repoFile(pyRel), "utf8").replace("layer_h: float = 0.3", "layer_h: float = 0.6", 1),
);
expectReject(
    "slicer layer height changed from 0.3 to 0.6",
    run("check-surface.mjs", ["--compare", pyCopy, "--original", pyRel]),
    "FAIL surface",
);

expectAccept("product-diff classifier self-test", run("check-product-diff.mjs", ["--self-test"]));

if (process.exitCode) {
    console.error("FAIL bad-change: one or more bad copies were accepted");
    process.exit(process.exitCode);
}
console.log(
    "PASS bad-change: rim cap, cup tolerance, belt-unrelated surface, seam, and slicer copies were rejected",
);
