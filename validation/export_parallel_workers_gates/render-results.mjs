// Frozen before grading. Fills RESULTS.md from grade JSON. Does not change thresholds.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function arg(name, fallback = "") {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) return fallback;
    return process.argv[index + 1];
}

const QUOTES = {
    PUSH: 'PUSH: new branch cursor/export-parallel-workers-gates-1123 (from BASE) -> ONE draft PR "[GATES ONLY - DO NOT MERGE] export-parallel-workers gates". Never push to the worker branch; never push/merge main, deploy, Railway (never touch vertex-web / vertex-api or #310), printers, production orders.',
    FILES: "FILES: validation/export_parallel_workers_gates/** only (new); read-only everything else - do not modify product code or the worker's tests - don't explore beyond",
    "MUST-MATCH":
        "MUST-MATCH: exported Left and Right STL bytes produced via workers are byte-identical (or vertex/triangle-identical within 0.0 mm) to the existing main-thread export path; single-foot export and headless Node export (where Web Workers are unavailable) continue working unchanged. Also verify byte-identical STL / geometry output vs current main on stock SAMPLE_Top and on engraved patient-name designs (no geometry or surface-quality regression).",
    TESTS: "TESTS: run the frozen gates on BASE and on the candidate SHA; results table in validation/export_parallel_workers_gates/RESULTS.md. Gates derive from the worker's TESTS line: (1) on a 2-foot cold browser export, Left and Right solid builds dispatch to independent worker instances (or worker pool of size >=2) so they execute concurrently rather than blocking the main thread sequentially; (2) worker-produced solid for Left and Right matches the main-thread solid and current main (same triangle count, watertight/Euler checks, and vertex positions) on stock SAMPLE_Top and engraved patient-name designs; (3) graceful fallback to main thread in Node/headless environments where Worker is undefined; (4) worker cancellation/cleanup on abort or unmount; existing tests green",
    ONE: "ONE: Independent grade of worker PR #412. Worker ONE line: Run cold Left and Right browser export solid builds off the main thread in parallel workers so a 2-foot export does not serialize ~2x CPU work on the single UI thread.",
    R1: "R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.",
    R2: "R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).",
    R3: "R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.",
    R4: "R4 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.",
    R5: 'R5 Security: never print secrets (filter output through grep -v -i "api_key\\|token\\|bearer"); no PHI; never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy; no database writes.',
    R6: "R6: zero change to geometry, walls, outer surface, or text engraving; only parallel worker execution of the existing build. Do not modify manufacturingSolidFingerprint or Print cache invalidation (a separate agent owns that).",
};

function mark(pass) {
    return pass === true ? "PASS" : "FAIL";
}

function short(value) {
    const text = JSON.stringify(value);
    if (!text) return "";
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

const grade = JSON.parse(readFileSync(resolve(arg("--grade")), "utf8"));
const proofsPath = arg("--proofs");
const proofs = proofsPath ? JSON.parse(readFileSync(resolve(proofsPath), "utf8")) : null;
const lines = [];
lines.push("# Export parallel workers — frozen gate results");
lines.push("");
lines.push(`BASE SHA: \`${grade.baseSha ?? ""}\``);
lines.push("");
lines.push(`Candidate SHA: \`${grade.candidateSha ?? ""}\``);
lines.push("");
lines.push(
    "Thresholds: vertex delta 0.0 mm, Euler characteristic 2, watertight (0 open edges), worker instances >= 2, peak busy workers >= 2, warm extra posts 0.",
);
lines.push("");
lines.push("## Results");
lines.push("");
lines.push("| Gate | Result | Threshold | Measured |");
lines.push("| --- | --- | --- | --- |");
for (const [id, rule] of Object.entries(grade.rules ?? {})) {
    lines.push(`| ${id} | ${mark(rule.pass)} | ${short(rule.threshold)} | ${short(rule.measured)} |`);
}
lines.push("");
lines.push("## Rule compliance");
lines.push("");
for (const [id, quote] of Object.entries(QUOTES)) {
    const rule = grade.rules?.[id] ?? grade.rules?.[id.replace("MUST-MATCH", "MUST-MATCH")];
    const header = grade.headers?.[id];
    const result = rule ? mark(rule.pass) : header ? mark(header.pass) : "see grade";
    lines.push(`> ${quote}`);
    lines.push("");
    lines.push(`**${id}: ${result}**`);
    if (rule?.detail) lines.push("");
    if (rule?.detail) lines.push(rule.detail);
    if (header?.evidence) {
        lines.push("");
        lines.push(header.evidence);
    }
    lines.push("");
}
if (grade.geometry?.length) {
    lines.push("## Geometry parts");
    lines.push("");
    lines.push("| Part | Result | maxDeltaMm | triangles | bytesEqual |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const part of grade.geometry) {
        const delta = part.measured?.maxDeltaMm;
        const triangles = `${part.measured?.trianglesA ?? ""}/${part.measured?.trianglesB ?? ""}`;
        lines.push(
            `| ${part.id} | ${mark(part.pass)} | ${delta ?? ""} | ${triangles} | ${part.measured?.bytesEqual ?? ""} |`,
        );
    }
    lines.push("");
}
if (proofs) {
    const bad = (proofs.results ?? []).filter((item) => !item.ok);
    lines.push("## Checker proofs");
    lines.push("");
    lines.push(
        `No-op and bad-change proofs: **${bad.length === 0 ? "PASS" : "FAIL"}** (${(proofs.results ?? []).length} checks, ${bad.length} unexpected).`,
    );
    lines.push("");
}
lines.push("## Hard prohibition");
lines.push("");
lines.push(
    "This grade did not change the outer surface, seams, layer-change placement, or surface quality. The only files added are under validation/export_parallel_workers_gates/.",
);
lines.push("");
writeFileSync(resolve(arg("--out")), lines.join("\n"));
console.log(arg("--out"));
