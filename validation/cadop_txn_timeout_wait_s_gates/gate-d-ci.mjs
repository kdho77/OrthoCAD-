// Gate D. CI for the graded SHA is green. Read-only GitHub check-run lookup.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OWNER = "kdho77";
const REPO = "OrthoCAD-";

function finish(result) {
    const path = process.env.GATE_RESULT_PATH;
    if (path) writeFileSync(path, JSON.stringify(result, null, 2));
    console.log(result.summary);
}

function productSha() {
    if (process.env.GATE_SHA) return process.env.GATE_SHA;
    const root = process.env.ORTHOCAD_ROOT ?? new URL("../../", import.meta.url).pathname;
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function checkRuns(sha) {
    const runs = [];
    let page = 1;
    let total = Infinity;
    while (runs.length < total && page <= 10) {
        const raw = execFileSync(
            "gh",
            [
                "api",
                `repos/${OWNER}/${REPO}/commits/${sha}/check-runs?per_page=100&page=${page}`,
                "-H",
                "Accept: application/vnd.github+json",
            ],
            { encoding: "utf8" },
        );
        const body = JSON.parse(raw);
        total = body.total_count ?? 0;
        runs.push(...(body.check_runs ?? []));
        if ((body.check_runs ?? []).length === 0) break;
        page += 1;
    }
    return runs;
}

function main() {
    const sha = productSha();
    let runs = [];
    try {
        runs = checkRuns(sha);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finish({
            pass: false,
            summary: `could not read CI for ${sha}: ${message.split("\n")[0]}`,
            measured: { sha, error: message.slice(0, 500) },
        });
        process.exit(1);
    }
    const rows = runs.map((run) => ({
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
    }));
    const pending = rows.filter((run) => run.status !== "completed");
    const bad = rows.filter(
        (run) => run.status === "completed" && run.conclusion !== "success" && run.conclusion !== "skipped",
    );
    const successes = rows.filter((run) => run.conclusion === "success");
    const pass = rows.length > 0 && pending.length === 0 && bad.length === 0 && successes.length > 0;
    finish({
        pass,
        summary: pass
            ? `CI green on ${sha.slice(0, 12)}: ${successes.length} success, ${rows.length - successes.length} skipped, 0 failed`
            : `CI not green on ${sha.slice(0, 12)}: pending=${pending.length} failed=${bad.length} success=${successes.length} total=${rows.length}`,
        measured: {
            sha,
            total: rows.length,
            success: successes.length,
            pending: pending.map((run) => run.name),
            failed: bad.map((run) => `${run.name}=${run.conclusion}`),
            checks: rows,
        },
    });
    process.exit(pass ? 0 : 1);
}

main();
