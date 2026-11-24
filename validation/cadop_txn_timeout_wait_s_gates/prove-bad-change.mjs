// Bad-change proof. Does not edit the product checkout. Mutations stay in throwaway worktrees.
// A non-zero exit from a case that must be rejected is a successful proof.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { gatesRepo, runOneCaptured } from "./run-gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function worktree() {
    const dir = mkdtempSync(join(tmpdir(), "cadop-bad-"));
    execFileSync("git", ["worktree", "add", "--detach", dir, "HEAD"], { cwd: gatesRepo, stdio: "ignore" });
    const modules = join(dir, "node_modules");
    symlinkSync(join(gatesRepo, "node_modules"), modules, "dir");
    return dir;
}

function removeWorktree(dir) {
    execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: gatesRepo, stdio: "ignore" });
    rmSync(dir, { recursive: true, force: true });
}

function replaceOnce(path, needle, replacement) {
    const text = readFileSync(path, "utf8");
    if (!text.includes(needle)) throw new Error(`needle missing in ${path}`);
    writeFileSync(path, text.replace(needle, replacement));
}

function scrub(text) {
    return text
        .split("\n")
        .filter((line) => !/api_key|token|bearer/i.test(line))
        .join("\n");
}

function section(title, captured) {
    const measured = captured.result?.measured ?? {};
    return [
        `## ${title}`,
        `exit=${captured.status} pass=${captured.result?.pass === true}`,
        captured.result?.summary ?? "(no summary)",
        JSON.stringify(measured, null, 2),
        "",
    ].join("\n");
}

function main() {
    const lines = [];
    lines.push("Bad-change proof for the frozen pair-run transaction timeout and wait_s gates.");
    lines.push(`repo=${gatesRepo}`);
    lines.push("");

    const oracle = runOneCaptured("a", { extraArgs: ["--self-test"] });
    lines.push(section("Oracle: long work inside a 5 s interactive transaction is rejected", oracle));
    if (oracle.status !== 0 || oracle.result?.pass !== true) {
        throw new Error("oracle self-test did not reject the 5 s interactive transaction");
    }

    const pair = runOneCaptured("a");
    lines.push(
        section("Product: BASE updateIf leaves the interactive transaction open across a 6 s loft", pair),
    );
    if (pair.result?.pass === true) throw new Error("BASE pair run was accepted");

    const schemaOracle = runOneCaptured("b", { extraArgs: ["--self-test"] });
    lines.push(
        section(
            "Oracle: dropped wait_s advertisement or single-fetch handler text is rejected",
            schemaOracle,
        ),
    );
    if (schemaOracle.status !== 0 || schemaOracle.result?.pass !== true) {
        throw new Error("wait_s advertisement oracle did not reject the bad schemas");
    }

    const advertised = runOneCaptured("b");
    lines.push(section("Product: BASE get_production advertisement (bundle and JSON schema)", advertised));
    if (advertised.result?.pass === true) throw new Error("BASE wait_s gate passed");

    const waitDir = worktree();
    try {
        replaceOnce(
            join(waitDir, "packages/mcp/src/tools/handlers.ts"),
            "return getProductionWithOptionalWait(manufacturing, input.production_id, input.wait_s ?? 0);",
            "return publicProductionFromResult(await manufacturing.getProduction(input.production_id));",
        );
        const dropped = runOneCaptured("b", { productRoot: waitDir });
        lines.push(section("Product mutation: get_production long-poll replaced with one fetch", dropped));
        const fetches = dropped.result?.measured?.long_poll?.fetches;
        const elapsed = dropped.result?.measured?.long_poll?.elapsed_ms;
        const status = dropped.result?.measured?.long_poll?.status;
        if (dropped.result?.pass === true) throw new Error("single-fetch handler was accepted");
        if (fetches !== 1 || status === "succeeded" || (elapsed ?? 9999) >= 1900) {
            throw new Error(
                `single-fetch mutation was not measured as one immediate fetch (fetches=${fetches} status=${status} elapsed=${elapsed})`,
            );
        }
        lines.push(
            `measured long_poll fetches=${fetches} status=${status} elapsed_ms=${elapsed} (threshold: fetches>=2, status=succeeded, elapsed>=1900)`,
        );
        lines.push("");
    } finally {
        removeWorktree(waitDir);
    }

    const byteDir = worktree();
    try {
        replaceOnce(
            join(byteDir, "vertex/src/lib/kiri/engine.ts"),
            'g.raw("G21");',
            'g.raw("G21 ; bad-change");',
        );
        const changed = runOneCaptured("c", { productRoot: byteDir });
        lines.push(section("Product mutation: one G-code byte change in the FDM emitter", changed));
        if (changed.result?.pass === true) throw new Error("G-code byte change was accepted");
        const problems = changed.result?.measured?.problems ?? [];
        if (!problems.some((problem) => /G-code sha256/.test(problem))) {
            throw new Error(`G-code hash mismatch was not reported: ${problems.join(" | ")}`);
        }
    } finally {
        removeWorktree(byteDir);
    }

    const stlDir = worktree();
    try {
        replaceOnce(
            join(stlDir, "vertex/src/lib/geometry/stl.ts"),
            "view.setUint16(offset, 0, true);",
            "view.setUint16(offset, 1, true);",
        );
        const changed = runOneCaptured("c", { productRoot: stlDir });
        lines.push(section("Product mutation: one STL attribute-byte change", changed));
        if (changed.result?.pass === true) throw new Error("STL byte change was accepted");
        const problems = changed.result?.measured?.problems ?? [];
        if (!problems.some((problem) => /STL sha256/.test(problem))) {
            throw new Error(`STL hash mismatch was not reported: ${problems.join(" | ")}`);
        }
    } finally {
        removeWorktree(stlDir);
    }

    const text = scrub(lines.join("\n"));
    const out = join(here, "proofs/bad-change.txt");
    writeFileSync(out, `${text}\n`);
    console.log(text);
    console.log(`wrote ${out}`);
}

main();
