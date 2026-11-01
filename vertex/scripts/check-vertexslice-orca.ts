// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Gate 13 — does VertexSlice's Orca headless CLI accept a 3MF with
 * Metadata/model_settings.config per-volume modifiers?
 *
 * Looks for VERTEXSLICE_CLI / ORCA_SLICER / orca-slicer on PATH.
 * Does not print secrets. Writes a JSON report to stdout.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const CANDIDATES = [
    process.env.VERTEXSLICE_CLI,
    process.env.ORCA_SLICER,
    process.env.ORCASLICER,
    "orca-slicer",
    "orca-slicer-cli",
    "orcaslicer",
    "OrcaSlicer",
    "vertexslice",
].filter((s): s is string => Boolean(s));

function which(cmd: string): string | null {
    if (cmd.includes("/") && existsSync(cmd)) return cmd;
    const r = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(cmd)}`], { encoding: "utf8" });
    const p = r.stdout.trim();
    return p.length > 0 ? p : null;
}

const found: string[] = [];
for (const c of CANDIDATES) {
    const p = which(c);
    if (p) found.push(p);
}

const report = {
    gate: 13,
    foundCli: found,
    env: {
        VERTEXSLICE_CLI: Boolean(process.env.VERTEXSLICE_CLI),
        ORCA_SLICER: Boolean(process.env.ORCA_SLICER),
        ORCASLICER: Boolean(process.env.ORCASLICER),
    },
    needed: [
        "VertexSlice Orca build (or upstream OrcaSlicer) with a headless CLI on PATH",
        "Env VERTEXSLICE_CLI=/path/to/orca-slicer (or ORCA_SLICER)",
        "Command shape to verify: `$CLI --slice <file.3mf> --outputdir <dir>` (Bambu/Orca) or `$CLI --export-3mf / --slice`",
        "Confirm Metadata/model_settings.config part subtype=modifier_part sparse_infill_density/pattern/speed are applied headless",
        "Then re-run verifyGcodeByClass on the produced gcode with required classes from the fixture",
    ],
    sliceAttempted: false as boolean,
    sliceOk: false as boolean,
    detail: found.length
        ? `CLI present: ${found.join(", ")} — no 3MF argument passed in this probe.`
        : "No VertexSlice/Orca CLI on PATH or VERTEXSLICE_CLI. Headless slice not run.",
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(found.length ? 0 : 2);
