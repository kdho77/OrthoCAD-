// Bad-change proofs. Each proof uses a throwaway copy. Product files are not modified.
// Exit 0 means every bad copy was rejected.
// Do not edit after the gates pull request is opened.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { repoFile, STATION_GATES, STATIONS } from "./lib.mjs";

const dir = mkdtempSync(resolve(tmpdir(), "heel-lift-rigid-gates-"));
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
expectAccept("unchanged seat rule", run("check-seat-rule.mjs", []));
expectAccept(
    "unchanged clinical list",
    run("check-tolerances.mjs", ["--clinical", resolve(here, "heel-lift-rigid-cup.optional.test.ts")]),
);

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

const looseSeat = resolve(dir, "thresholds-seat.ts");
writeFileSync(
    looseSeat,
    readFileSync(resolve(here, "thresholds.ts"), "utf8").replace(
        "export const SEAT_TOL_MM = 0.3;",
        "export const SEAT_TOL_MM = 2;",
    ),
);
expectReject(
    "seat-rise tolerance loosened from ±0.3 mm to ±2 mm",
    run("check-tolerances.mjs", ["--file", looseSeat]),
    "SEAT_TOL_MM",
);

const looseCup = resolve(dir, "thresholds-cup.ts");
writeFileSync(
    looseCup,
    readFileSync(resolve(here, "thresholds.ts"), "utf8").replace(
        "export const CUP_DEPTH_TOL_MM = 0.3;",
        "export const CUP_DEPTH_TOL_MM = 2;",
    ),
);
expectReject(
    "cup-depth tolerance loosened from ±0.3 mm to ±2 mm",
    run("check-tolerances.mjs", ["--file", looseCup]),
    "CUP_DEPTH_TOL_MM",
);

const skipH10 = resolve(dir, "thresholds-skip-h10.ts");
writeFileSync(
    skipH10,
    readFileSync(resolve(here, "thresholds.ts"), "utf8").replace(
        "export const LIFT_MM = [6, 10, 12] as const;",
        "export const LIFT_MM = [6, 12] as const;",
    ),
);
expectReject("lift list skips H=10", run("check-tolerances.mjs", ["--file", skipH10]), "H=10");

const skipClinical = resolve(dir, "clinical-skip-h10.ts");
writeFileSync(
    skipClinical,
    readFileSync(resolve(here, "heel-lift-rigid-cup.optional.test.ts"), "utf8").replaceAll(
        "for (const H of LIFT_MM)",
        "for (const H of [6, 12] as const)",
    ),
);
expectReject("clinical loop skips H=10", run("check-tolerances.mjs", ["--clinical", skipClinical]), "H=10");

const highest = resolve(dir, "measure-highest.ts");
writeFileSync(
    highest,
    readFileSync(resolve(here, "measure.ts"), "utf8").replace("p.z < seat.z - 1e-6", "p.z > seat.z + 1e-6"),
);
expectReject(
    "seat sample changed from the lowest point to the highest",
    run("check-seat-rule.mjs", ["--file", highest]),
    "p.z < seat.z - 1e-6",
);

const curve = resolve(dir, "measure-curve.ts");
writeFileSync(
    curve,
    readFileSync(resolve(here, "measure.ts"), "utf8").replace(
        "Math.abs(row.dSeat - H)",
        "Math.abs(row.dSeat - heelLiftDeltaAt(row.seatU, H))",
    ),
);
expectReject(
    "seat rise accepted via heelLiftDeltaAt instead of full H",
    run("check-seat-rule.mjs", ["--file", curve]),
    "heelLiftDeltaAt",
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

const wallRel = "vertex/src/lib/geometry/procedural-wall/wall-spline.ts";
const wallCopy = resolve(dir, "wall-spline.ts");
writeFileSync(
    wallCopy,
    readFileSync(repoFile(wallRel), "utf8").replace(
        "export const SPLINE_DEGREE = 3;",
        "export const SPLINE_DEGREE = 4;",
    ),
);
expectReject(
    "wall-builder spline degree changed",
    run("check-surface.mjs", ["--compare", wallCopy, "--original", wallRel]),
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

const sampleLog = resolve(here, "proofs/bad-sample.log");
writeFileSync(sampleLog, "");
const synthetic = spawnSync(
    "npx",
    [
        "rstest",
        "run",
        "--config",
        "validation/heel_lift_rigid_cup_gates/rstest.gates.config.ts",
        "validation/heel_lift_rigid_cup_gates/bad-change.optional.test.ts",
    ],
    { encoding: "utf8", cwd: resolve(here, "../..") },
);
const syntheticText = `${synthetic.stdout ?? ""}\n${synthetic.stderr ?? ""}\n${readFileSync(sampleLog, "utf8")}`;
const syntheticNeedles = [
    "PASS bad-sample: non-lowest seat measurement rejected",
    "PASS bad-sample: seat-only raise rejected (cup shallower)",
    "PASS bad-sample: rim-only raise rejected (cup deeper)",
    "PASS bad-sample: belt raise rejected",
    "PASS bad-sample: meshMinZ change rejected",
    "PASS bad-sample: plantarAbsMaxZ change rejected",
    "PASS bad-sample: met-head rise rejected",
    "PASS bad-sample: non-monotonic taper rejected",
    "PASS bad-sample: published BASE seat and cup measurements rejected",
    "PASS bad-sample: ±0.3 mm seat and cup bounds hold",
    "PASS bad-sample: rigid lift accepted at H=6, 10, and 12",
];
if (synthetic.status !== 0 || syntheticNeedles.some((needle) => !syntheticText.includes(needle))) {
    const missing = syntheticNeedles.filter((needle) => !syntheticText.includes(needle));
    console.error(
        `FAIL bad-change: synthetic rows were not all rejected\nmissing ${missing.join(", ")}\n${syntheticText}`,
    );
    process.exitCode = 1;
} else {
    console.log("PASS bad-change: synthetic seat-only, rim-only, belt, plate, and wrong-point rows rejected");
}

if (process.exitCode) {
    console.error("FAIL bad-change: one or more bad copies were accepted");
    process.exit(process.exitCode);
}
console.log(
    "PASS bad-change: seat-only and rim-only rows, belt rise, wrong seat point, loosened ±0.3 mm, skipped H=10, surface, seam, wall-builder, and S1-PRELOFT copies were rejected",
);
