// No-op proof: on unfixed main the Right M5/M6/M8 gates fail [S1-PRELOFT] skew,
// the 0.5 cap still matches, and the existing Left pins still match.
// Exit 0 means that proof held. This is not the candidate grade.
// Do not edit after the gates pull request is opened.

import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./lib.mjs";

const config = "validation/right_preloft_rim_follow_gates/rstest.gates.config.ts";
const testFile = "validation/right_preloft_rim_follow_gates/right-preloft-rim-follow.optional.test.ts";
const result = spawnSync("npx", ["rstest", "run", "--bail", "0", "--config", config, testFile], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
});
const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
process.stdout.write(text);
if (result.error) {
    console.error(`FAIL noop: could not start rstest: ${result.error.message}`);
    process.exit(1);
}

function count(name) {
    const match = text.match(new RegExp(`"${name}":\\s*(\\d+)`));
    return match ? Number(match[1]) : Number.NaN;
}

function sizeFailed(size) {
    return text.includes(`Right US M${size}: [S1-PRELOFT]`) && text.includes("skew[");
}

const rightFailed = sizeFailed(5) && sizeFailed(6) && sizeFailed(8);
const onlyRightFailed =
    count("failedTests") === 1 &&
    count("passedTests") === 2 &&
    text.includes("pass S1-PRELOFT") &&
    !text.includes("existing Left narrow-heelcup-preloft pins stay SHA-256 identical to main");

if (result.status === 0) {
    console.error("FAIL noop: Right gates passed on this tree. Unfixed main must fail them.");
    process.exit(1);
}
if (!rightFailed) {
    console.error("FAIL noop: Right M5/M6/M8 did not each fail with [S1-PRELOFT] skew[].");
    process.exit(1);
}
if (!onlyRightFailed) {
    console.error(
        "FAIL noop: expected exactly the Right gate to fail and the cap and Left pin gates to pass.",
    );
    process.exit(1);
}
console.log(
    "PASS noop: Right M5/M6/M8 fail [S1-PRELOFT] skew on this tree; cap stays 0.5; Left pins match main",
);
