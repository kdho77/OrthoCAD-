import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { redact } from "./thresholds.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export function runGates(tree) {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "gate-out-")), "report.json");
    const result = spawnSync(
        process.execPath,
        [
            "--disable-warning=ExperimentalWarning",
            "--import",
            path.join(here, "register.mjs"),
            path.join(here, "run-gates.mjs"),
            "--tree",
            tree,
            "--out",
            out,
        ],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, cwd: here },
    );
    let report = null;
    try {
        report = JSON.parse(readFileSync(out, "utf8"));
    } catch {
        report = null;
    }
    rmSync(path.dirname(out), { recursive: true, force: true });
    return {
        status: result.status,
        report,
        stderr: redact(result.stderr ?? "").slice(-4000),
        stdoutTail: redact(result.stdout ?? "").slice(-500),
    };
}

export function gateDir() {
    return here;
}
