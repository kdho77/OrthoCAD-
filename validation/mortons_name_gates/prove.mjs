// No-op, bad-change, and candidate grading. Does not import product code.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { badMutations, grade, syntheticFixed } from "./score.mjs";

const mode = process.argv.includes("--grade") ? "grade" : process.argv.includes("--bad") ? "bad" : "noop";

function arg(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
}

const measPath = resolve(arg("--meas", "validation/mortons_name_gates/out/measurement.json"));
const basePath = resolve(
    arg("--base", mode === "grade" ? "validation/mortons_name_gates/out/base.json" : measPath),
);
const outPath = resolve(
    arg(
        "--out",
        mode === "grade"
            ? "validation/mortons_name_gates/out/grade.json"
            : mode === "bad"
              ? "validation/mortons_name_gates/out/bad.json"
              : "validation/mortons_name_gates/out/noop.json",
    ),
);

const meas = JSON.parse(readFileSync(measPath, "utf8"));
const base = JSON.parse(readFileSync(basePath, "utf8"));
const report = grade(meas, base);

function line(id, row) {
    return `${row.pass ? "PASS" : "FAIL"}\t${id}`;
}

const ids = Object.keys(report).filter((id) => id.startsWith("G-"));
console.log(ids.map((id) => line(id, report[id])).join("\n"));

let exit = 0;
if (mode === "noop") {
    const mustPass = [
        "G-DETECTOR",
        "G-OTHER-FOOT",
        "G-ELEMENT",
        "G-R1",
        "G-R2",
        "G-R3",
        "G-R4",
        "G-R5",
        "G-R6",
        "G-R7",
    ];
    const missed = mustPass.filter((id) => !report[id].pass);
    const fixed = grade(syntheticFixed(meas), base);
    const fixedOk = fixed["G-DEFECT"].pass === true;
    console.log(`synthetic-fixed G-DEFECT ${fixedOk ? "PASS" : "FAIL"} (control, not the candidate)`);
    console.log(
        `BASE G-DEFECT ${report["G-DEFECT"].pass ? "PASS" : "FAIL"} area=${report["G-DEFECT"].areaMm2}`,
    );
    if (missed.length || !fixedOk) exit = 2;
    if (report["G-DEFECT"].pass) {
        console.log("BASE still engraved the Morton's foot. The harness did not reproduce the defect.");
        exit = 3;
    }
} else if (mode === "bad") {
    const still = badMutations(meas);
    console.log(
        still.length
            ? `bad-change still passed: ${still.join(", ")}`
            : "bad-change: every broken copy failed",
    );
    if (still.length) exit = 2;
} else {
    console.log(`candidate sha ${meas.sha}`);
    console.log(`base sha ${base.sha}`);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
    outPath,
    JSON.stringify(
        {
            mode,
            measSha: meas.sha,
            baseSha: base.sha,
            report,
            badStillPassing: mode === "bad" ? badMutations(meas) : undefined,
        },
        null,
        2,
    ),
);
console.log(`wrote ${outPath}`);
process.exit(exit);
