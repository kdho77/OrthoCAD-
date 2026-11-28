/**
 * Bad-change proof. A synthetic passing tree is local to /tmp.
 * Each required defect is rejected. The candidate is not used.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    applyGood,
    capAt120,
    flipStockLoftByte,
    removeSetImmediate,
    restoreSequentialEnqueue,
    touchGeometrySource,
    useSetTimeoutZero,
    waitForLoftBeforeReturn,
} from "./synthetic-good-patch.mjs";
import { BASE_SHA } from "./thresholds.mjs";
import { runGates } from "./spawn-gates.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tree = "/tmp/mcp-flush-gates-bad";

function git(args, allowFail = false) {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0 && !allowFail) {
        throw new Error(result.stderr || result.stdout || `git failed: ${args.join(" ")}`);
    }
}

function reset() {
    if (!tree.startsWith("/tmp/")) throw new Error("refusing to reset outside /tmp");
    git(["-C", tree, "reset", "--hard", BASE_SHA]);
    git(["-C", tree, "clean", "-fd", "-e", "node_modules"]);
}

function ids(run) {
    return Object.fromEntries((run.report?.gates ?? []).map((gate) => [gate.id, gate.pass]));
}

git(["worktree", "remove", "--force", tree], true);
git(["worktree", "add", "--detach", tree, BASE_SHA]);

const cases = [];
try {
    reset();
    applyGood(tree);
    const control = runGates(tree);
    cases.push({
        name: "synthetic-good-control",
        expect: "all pass",
        status: control.status,
        gates: ids(control),
        pass: control.report?.pass === true && control.status === 0,
        measured: Object.fromEntries((control.report?.gates ?? []).map((gate) => [gate.id, gate.measured])),
        stderrTail: control.report?.pass ? "" : control.stderr,
    });

    const defects = [
        {
            name: "missing-setImmediate",
            mutate: removeSetImmediate,
            rejects: ["G5", "G1"],
        },
        {
            name: "wait_s-cap-120",
            mutate: capAt120,
            rejects: ["G3"],
        },
        {
            name: "wait-for-loft-before-return",
            mutate: waitForLoftBeforeReturn,
            rejects: ["G1"],
        },
        {
            name: "sequential-enqueue",
            mutate: restoreSequentialEnqueue,
            rejects: ["G2"],
        },
        {
            name: "stl-byte-change",
            mutate: flipStockLoftByte,
            rejects: ["G4"],
        },
        {
            name: "geometry-file-change",
            mutate: touchGeometrySource,
            rejects: ["G4"],
        },
        {
            name: "setTimeout-0-equivalent",
            mutate: useSetTimeoutZero,
            rejects: [],
            expectPass: true,
        },
    ];

    for (const defect of defects) {
        reset();
        applyGood(tree);
        defect.mutate(tree);
        const run = runGates(tree);
        const got = ids(run);
        const rejected = defect.rejects.every((id) => got[id] === false);
        const kept = defect.expectPass
            ? run.report?.pass === true
            : run.report?.pass === false && run.status !== 0;
        cases.push({
            name: defect.name,
            expectReject: defect.rejects,
            status: run.status,
            gates: got,
            pass: rejected && kept,
            measured: Object.fromEntries(
                (run.report?.gates ?? [])
                    .filter((gate) => defect.rejects.includes(gate.id) || defect.expectPass)
                    .map((gate) => [gate.id, gate.measured]),
            ),
            stderrTail: rejected && kept ? "" : run.stderr,
        });
        process.stderr.write(`${defect.name} ${rejected && kept ? "rejected" : "UNEXPECTED"}\n`);
    }
} finally {
    git(["worktree", "remove", "--force", tree], true);
}

const proof = {
    kind: "bad-change",
    baseSha: BASE_SHA,
    command: "node prove-bad-change.mjs",
    pass: cases.every((row) => row.pass === true),
    cases,
};
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "proofs");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "bad-change.json"), JSON.stringify(proof, null, 2));
process.stdout.write(
    `${JSON.stringify({ pass: proof.pass, cases: cases.map((row) => ({ name: row.name, pass: row.pass, gates: row.gates })) }, null, 2)}\n`,
);
process.exit(proof.pass ? 0 : 1);
