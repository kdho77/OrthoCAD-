// Grade one candidate commit with the frozen gates.
// Does not check out or modify the candidate branch. A detached worktree is removed at the end.
// Exit 0 only when every candidate gate passes.
// Do not edit after the gates pull request is opened.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { baseSha, GATES_DIR, productPaths, REPO_ROOT, surfacePaths } from "./lib.mjs";

const shaArg = process.argv[2];
if (!shaArg) {
    console.error("usage: node grade-candidate.mjs <commit>");
    process.exit(2);
}

function git(args, cwd = REPO_ROOT) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || `git ${args.join(" ")}`).trim());
    }
    return result.stdout.trim();
}

const sha = git(["rev-parse", "--verify", `${shaArg}^{commit}`]);
const base = baseSha();
const names = git(["diff", "--name-only", base, sha])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
console.log(`candidate ${sha}`);
console.log(`base ${base}`);
console.log(`diff paths ${names.length}`);
for (const name of names) console.log(`  ${name}`);

let failed = false;
function mark(ok, message) {
    console.log(`${ok ? "PASS" : "FAIL"} candidate: ${message}`);
    if (!ok) failed = true;
}

const surface = new Set(surfacePaths());
const surfaceTouched = names.filter((name) => surface.has(name));
mark(
    surfaceTouched.length === 0,
    surfaceTouched.length
        ? `outer-surface/seam/layer-change/surface-quality files changed: ${surfaceTouched.join(", ")}`
        : "no outer-surface, seam, layer-change, or surface-quality file changed",
);

const graderTouched = names.filter((name) => name.startsWith("validation/right_preloft_rim_follow_gates/"));
mark(
    graderTouched.length === 0,
    graderTouched.length ? `grader files edited: ${graderTouched.join(", ")}` : "grader files untouched",
);

const work = resolve(tmpdir(), `right-preloft-grade-${sha.slice(0, 12)}`);
rmSync(work, { recursive: true, force: true });
git(["worktree", "add", "--detach", work, sha]);
try {
    const overlaid = resolve(work, "validation/right_preloft_rim_follow_gates");
    mkdirSync(resolve(work, "validation"), { recursive: true });
    cpSync(GATES_DIR, overlaid, { recursive: true });
    symlinkSync(resolve(REPO_ROOT, "node_modules"), resolve(work, "node_modules"));
    symlinkSync(resolve(REPO_ROOT, "vertex/node_modules"), resolve(work, "vertex/node_modules"));

    const cap = spawnSync(process.execPath, ["validation/right_preloft_rim_follow_gates/check-cap.mjs"], {
        cwd: work,
        encoding: "utf8",
    });
    process.stdout.write(cap.stdout ?? "");
    process.stderr.write(cap.stderr ?? "");
    mark(cap.status === 0, "assertPreLoftStations and the 0.5×inset cap match frozen main");

    const surfaceCheck = spawnSync(
        process.execPath,
        ["validation/right_preloft_rim_follow_gates/check-surface.mjs"],
        {
            cwd: work,
            encoding: "utf8",
        },
    );
    process.stdout.write(surfaceCheck.stdout ?? "");
    process.stderr.write(surfaceCheck.stderr ?? "");
    mark(surfaceCheck.status === 0, "surface file bytes match frozen main");

    const geometry = spawnSync(
        "npx",
        [
            "rstest",
            "run",
            "--bail",
            "0",
            "--config",
            "validation/right_preloft_rim_follow_gates/rstest.gates.config.ts",
            "validation/right_preloft_rim_follow_gates/right-preloft-rim-follow.optional.test.ts",
        ],
        { cwd: work, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    process.stdout.write(geometry.stdout ?? "");
    process.stderr.write(geometry.stderr ?? "");
    const geometryText = `${geometry.stdout ?? ""}\n${geometry.stderr ?? ""}`;
    const countIn = (name) => {
        const match = geometryText.match(new RegExp(`"${name}":\\s*(\\d+)`));
        return match ? Number(match[1]) : Number.NaN;
    };
    const geometryPassed =
        geometry.status === 0 && countIn("failedTests") === 0 && countIn("passedTests") === 3;
    mark(
        geometryPassed,
        "Right US M5/M6/M8 narrow + 9 mm heel cup + default met pad pass S1-PRELOFT at 0.5×inset",
    );
    mark(geometryPassed, "Left narrow-heelcup-preloft pins stay SHA-256 identical to main");
} finally {
    spawnSync("git", ["worktree", "remove", "--force", work], { cwd: REPO_ROOT, encoding: "utf8" });
}

const product = productPaths(names);
console.log(`product paths in the candidate diff: ${product.length}`);
if (failed) {
    console.error("FAIL candidate grade");
    process.exit(1);
}
console.log("PASS candidate grade");
