// No-op proof on BASE. The clinical gates must FAIL. Identity, surface, cap,
// tolerance, and product-diff gates must PASS. Product files are not modified.
// Do not edit after the gates pull request is opened.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const here = import.meta.dirname;
const root = resolve(here, "../..");
const node = process.execPath;

function run(cmd, args, extra) {
    return spawnSync(cmd, args, { encoding: "utf8", cwd: root, ...extra });
}

function expectPass(label, result) {
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status !== 0) {
        console.error(`FAIL noop: ${label} did not pass\n${text}`);
        process.exitCode = 1;
        return;
    }
    console.log(`PASS noop: ${label}`);
}

function expectClinicalFail(result) {
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status === 0) {
        console.error(`FAIL noop: clinical gates passed on BASE\n${text}`);
        process.exitCode = 1;
        return;
    }
    const need = [
        "PASS identity right-0-after-left-12",
        "PASS identity right-0-after-left-6",
        "PASS identity left-0",
        "FAIL clinical right H=6",
        "FAIL clinical right H=12",
        "FAIL clinical left H=6",
        "FAIL clinical left H=12",
        "cup depth",
        "seat rise",
    ];
    const missing = need.filter((needle) => !text.includes(needle));
    if (missing.length) {
        console.error(`FAIL noop: clinical run failed without ${missing.join(", ")}\n${text}`);
        process.exitCode = 1;
        return;
    }
    writeFileSync(resolve(here, "proofs/clinical-base.log"), text);
    console.log("PASS noop: clinical gates FAIL on BASE and identity hashes match");
}

expectPass("product diff", run(node, [resolve(here, "check-product-diff.mjs")]));
expectPass("surface", run(node, [resolve(here, "check-surface.mjs")]));
expectPass("cap", run(node, [resolve(here, "check-cap.mjs")]));
expectPass("tolerances", run(node, [resolve(here, "check-tolerances.mjs")]));
expectPass(
    "checker",
    run("npx", ["rstest", "run", "validation/heel_lift_cup_regression_gates/checker.test.ts"]),
);
expectClinicalFail(
    run("npx", [
        "rstest",
        "run",
        "--config",
        "validation/heel_lift_cup_regression_gates/rstest.gates.config.ts",
        "validation/heel_lift_cup_regression_gates/heel-lift-cup.optional.test.ts",
    ]),
);

if (process.exitCode) process.exit(process.exitCode);
console.log("PASS noop: unchanged BASE fails the heel-lift clinical gates and passes the identity gates");
