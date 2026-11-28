/**
 * No-op proof: frozen gates fail on main (sequential enqueue, no flush deferral,
 * wait_s cap missing). Stock loft bytes on main match main, so G4 passes.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BASE_SHA } from "./thresholds.mjs";
import { runGates } from "./spawn-gates.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tree = "/tmp/mcp-flush-gates-noop";

function git(args, allowFail = false) {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0 && !allowFail) {
        throw new Error(result.stderr || result.stdout || "git failed");
    }
}

git(["worktree", "remove", "--force", tree], true);
git(["worktree", "add", "--detach", tree, BASE_SHA]);

let proof;
try {
    const run = runGates(tree);
    const byId = Object.fromEntries((run.report?.gates ?? []).map((gate) => [gate.id, gate]));
    const failedOnMain = ["G1", "G2", "G3", "G5"].every((id) => byId[id]?.pass === false);
    const bytesMatch = byId.G4?.pass === true;
    const suiteFails = run.report?.pass === false && run.status !== 0;
    const behavioral =
        (byId.G1?.measured?.responseMs ?? 0) > 5000 &&
        (byId.G1?.measured?.loftEnteredBeforeReturn ?? 0) > 0 &&
        (byId.G2?.measured?.invokeGapMs ?? 0) > 5000 &&
        byId.G3?.measured?.accepts300 === false &&
        byId.G5?.measured?.resolvedBeforeExecute === false &&
        !byId.G1?.measured?.error;
    proof = {
        kind: "noop",
        baseSha: BASE_SHA,
        treeHead: run.report?.head ?? null,
        command: "node --import register.mjs run-gates.mjs --tree <detached main>",
        suiteFails,
        failedOnMain,
        bytesMatch,
        behavioral,
        pass: suiteFails && failedOnMain && bytesMatch && behavioral,
        gates: byId,
        stderrTail: run.stderr,
    };
} finally {
    git(["worktree", "remove", "--force", tree], true);
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "proofs");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "noop.json"), JSON.stringify(proof, null, 2));
process.stdout.write(`${JSON.stringify({ pass: proof.pass, suiteFails: proof.suiteFails, failedOnMain: proof.failedOnMain, bytesMatch: proof.bytesMatch, behavioral: proof.behavioral }, null, 2)}\n`);
process.exit(proof.pass ? 0 : 1);
