// Formats the two grade JSON files into RESULTS.md. No product imports.
// Gate logic is not here; this only prints what the frozen judges already decided.

import { readFileSync, writeFileSync } from "node:fs";
import type { GateResult } from "./judge";

interface FloorRow {
    kind: string;
    depthMm: number;
    minMm: number;
    medianMm: number;
    plateauCount: number;
    rayMisses: number;
    ringMedianMm: number;
    ringCount: number;
    dropMedianMm: number;
    dropMaxMm: number;
    lowShellMedianMm?: number;
    lowShellCount?: number;
    ringDeltaMm?: number;
    beltMoveMm: number;
    xyMoveMm: number;
    unsunkMedianMm?: number;
}

interface Report {
    label: string;
    sha: string;
    hashes: { defaultNoSink: string; uniform3NoSink: string };
    floors: FloorRow[];
    gates: GateResult[];
    proofs: GateResult[];
}

const QUOTES: Array<{ id: string; text: string }> = [
    {
        id: "R1",
        text: "R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.",
    },
    {
        id: "R2",
        text: "R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).",
    },
    {
        id: "R3",
        text: "R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.",
    },
    {
        id: "R4",
        text: "R4 (2026-11-05): Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.",
    },
    {
        id: "R5",
        text: "R5 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.",
    },
    {
        id: "R6",
        text: 'R6 Security: never print secrets (filter output through grep -v -i "api_key\\|token\\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy.',
    },
    {
        id: "R7",
        text: "R7: designs and exports not affected by your defect must produce identical output to current main (prove with a before/after comparison on at least the SAMPLE_Top stock design with no corrections).",
    },
    {
        id: "PUSH",
        text: 'PUSH: new branch cursor/sink-depth-gates-1123 (from BASE) -> ONE draft PR "[GATES ONLY - DO NOT MERGE] sink-depth gates". Never push to the worker branch; never push/merge main, deploy, Railway (never touch vertex-web / vertex-api or #310), printers, production orders.',
    },
    {
        id: "FILES",
        text: "FILES: validation/sink_depth_gates/** only (new); read-only everything else - do not modify product code or the worker's tests.",
    },
    {
        id: "MUST-MATCH",
        text: "MUST-MATCH: sinks of other depths/positions remove exactly depthMm; every non-sink design unchanged.",
    },
    {
        id: "TESTS",
        text: "TESTS: new unit/geometry test: mpj5 and mpj1 sinks at depthMm 2 on a 3 mm uniform shell leave a floor of 1.0 mm +/-0.15 everywhere under the sink (measure min and median remaining thickness). Gates derive from this: measure remaining floor thickness under the sink on the observed design shape (mpj5 depth 2, thickness 3, and mpj1) in the export mesh; flat 3 mm shell with no wall under the pad must stay exactly depth removed.",
    },
    {
        id: "ONE",
        text: "ONE: Independent grade of worker PR #401. Make a sink remove exactly its configured depth. Observed: design b2d48d94 (order c813e723), mpj5 sink depthMm 2, thickness_mm 3.",
    },
    {
        id: "CAP",
        text: "CAP: 0/3",
    },
];

function load(path: string): Report {
    return JSON.parse(readFileSync(path, "utf8")) as Report;
}

function esc(value: string): string {
    return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function verdict(gates: GateResult[], rule: string): { pass: boolean; rows: string } {
    const mine = gates.filter((g) => g.rule === rule);
    if (!mine.length) return { pass: false, rows: "(no gate)" };
    const pass = mine.every((g) => g.pass);
    const rows = mine
        .map(
            (g) =>
                `${g.pass ? "PASS" : "FAIL"} \`${g.id}\` measured ${g.measured} ; threshold ${g.threshold}`,
        )
        .join("<br>");
    return { pass, rows };
}

function num(value: number): string {
    return Number.isFinite(value) ? value.toFixed(3) : "n/a";
}

export function render(base: Report, candidate: Report): string {
    const lines: string[] = [];
    lines.push("# Sink-depth gates");
    lines.push("");
    lines.push("Frozen before the candidate was graded. Product code was not modified.");
    lines.push("");
    lines.push(`- Base product SHA: \`${base.sha}\``);
    lines.push(`- Candidate SHA: \`${candidate.sha}\` (worker draft PR #401)`);
    lines.push(`- Design id b2d48d94, order id c813e723. No patient names.`);
    lines.push("");
    lines.push("## Floor thickness");
    lines.push("");
    lines.push(
        "Remaining material under the plateau (vertical gap from the sunk top to the next surface). Target 1.0 ± 0.15 mm.",
    );
    lines.push("");
    lines.push(
        "| Sink | Tree | min mm | low-shell median | overall median | drop median | drop max | ring Δ | unsunk median | n | verdict |",
    );
    lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const report of [base, candidate]) {
        for (const row of report.floors) {
            const gate = report.gates.find(
                (g) =>
                    g.id === `G-FLOOR-${row.kind.toUpperCase()}` ||
                    g.id === `G-EXACT-${row.kind.toUpperCase()}-D${row.depthMm}`,
            );
            lines.push(
                `| ${row.kind} d${row.depthMm} | ${report.label} | ${num(row.minMm)} | ${num(row.lowShellMedianMm ?? Number.NaN)} | ${num(row.medianMm)} | ${num(row.dropMedianMm)} | ${num(row.dropMaxMm)} | ${num(row.ringDeltaMm ?? Number.NaN)} | ${num(row.unsunkMedianMm ?? Number.NaN)} | ${row.plateauCount} | ${gate ? (gate.pass ? "PASS" : "FAIL") : ""} |`,
            );
        }
    }
    lines.push("");
    lines.push("## Hashes");
    lines.push("");
    lines.push("| Mesh | Base | Candidate | Match |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(
        `| default no-sink | \`${base.hashes.defaultNoSink}\` | \`${candidate.hashes.defaultNoSink}\` | ${base.hashes.defaultNoSink === candidate.hashes.defaultNoSink ? "yes" : "no"} |`,
    );
    lines.push(
        `| uniform 3 mm no-sink | \`${base.hashes.uniform3NoSink}\` | \`${candidate.hashes.uniform3NoSink}\` | ${base.hashes.uniform3NoSink === candidate.hashes.uniform3NoSink ? "yes" : "no"} |`,
    );
    lines.push("");
    lines.push("## Gates");
    lines.push("");
    lines.push("| Id | Rule | Base | Candidate | Candidate measured | Threshold |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    const ids = [...new Set([...base.gates.map((g) => g.id), ...candidate.gates.map((g) => g.id)])];
    for (const id of ids) {
        const b = base.gates.find((g) => g.id === id);
        const c = candidate.gates.find((g) => g.id === id);
        lines.push(
            `| \`${id}\` | ${c?.rule ?? b?.rule ?? ""} | ${b ? (b.pass ? "PASS" : "FAIL") : ""} | ${c ? (c.pass ? "PASS" : "FAIL") : ""} | ${esc(c?.measured ?? "")} | ${esc(c?.threshold ?? b?.threshold ?? "")} |`,
        );
    }
    lines.push("");
    lines.push("## Proofs");
    lines.push("");
    lines.push("No-op proofs must pass. Bad-change proofs pass only when the gate itself fails.");
    lines.push("");
    const proofIds = [...new Set([...base.proofs.map((p) => p.id), ...candidate.proofs.map((p) => p.id)])];
    lines.push("| Id | Base | Candidate |");
    lines.push("| --- | --- | --- |");
    for (const id of proofIds) {
        const b = base.proofs.find((p) => p.id === id);
        const c = candidate.proofs.find((p) => p.id === id);
        lines.push(
            `| \`${id}\` | ${b ? (b.pass ? "PASS" : "FAIL") : ""} | ${c ? (c.pass ? "PASS" : "FAIL") : ""} |`,
        );
    }
    lines.push("");
    lines.push("## Rule compliance");
    lines.push("");
    lines.push("Graded on the candidate. A rule passes only when every gate tagged with that rule passes.");
    lines.push("");
    for (const quote of QUOTES) {
        const { pass, rows } = verdict(candidate.gates, quote.id);
        lines.push(`### ${quote.id}: ${pass ? "PASS" : "FAIL"}`);
        lines.push("");
        lines.push(`> ${quote.text}`);
        lines.push("");
        lines.push(rows);
        lines.push("");
    }
    lines.push("## Commands");
    lines.push("");
    lines.push("```");
    lines.push("npx rstest validation/sink_depth_gates/run.spec.ts -t instrument");
    lines.push(
        'SINK_GATE_LIVE=1 SINK_GATE_LABEL=base SINK_GATE_SHA=<base> npx rstest validation/sink_depth_gates/run.spec.ts -t "export grade"',
    );
    lines.push(
        'SINK_GATE_LIVE=1 SINK_GATE_LABEL=candidate SINK_GATE_SHA=<candidate> npx rstest validation/sink_depth_gates/run.spec.ts -t "export grade"',
    );
    lines.push("```");
    lines.push("");
    return lines.join("\n");
}

const basePath = process.argv[2];
const candidatePath = process.argv[3];
const outPath = process.argv[4];
if (basePath && candidatePath && outPath) {
    writeFileSync(outPath, render(load(basePath), load(candidatePath)));
}
