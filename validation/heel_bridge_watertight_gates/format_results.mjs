// FROZEN formatter. Fills RESULTS.md from proof, base, and candidate JSON.
// It does not change a threshold.
import { readFileSync, writeFileSync } from "node:fs";

const dir = "validation/heel_bridge_watertight_gates";
const proof = JSON.parse(readFileSync(`${dir}/proof.json`, "utf8"));
const base = JSON.parse(readFileSync(`${dir}/base.json`, "utf8"));
const candidate = JSON.parse(readFileSync(`${dir}/candidate.json`, "utf8"));

const QUOTES = {
    G1: "TESTS: new test reproducing the failure: reverse_mortons L+R (default 3 mm), thickness 3, US_M 7.5 Medium exports headless with heelBridgeSelfIntersections 0 and a watertight mesh; existing tests green",
    G2: "TESTS: new test reproducing the failure: reverse_mortons L+R (default 3 mm), thickness 3, US_M 7.5 Medium exports headless with heelBridgeSelfIntersections 0 and a watertight mesh; existing tests green",
    G3: "TESTS: new test reproducing the failure: reverse_mortons L+R (default 3 mm), thickness 3, US_M 7.5 Medium exports headless with heelBridgeSelfIntersections 0 and a watertight mesh; existing tests green",
    G4: "MUST-MATCH: designs that already export watertight produce identical meshes; do not loosen the baseline 0 check",
    G5: "MUST-MATCH: designs that already export watertight produce identical meshes; do not loosen the baseline 0 check",
    G6: "R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.",
    G7: "R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).",
    G8: "R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.",
    G9: "R4 (2026-11-05): Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.",
    G10: "R5 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.",
    G11: 'R6 Security: never print secrets (filter output through grep -v -i "api_key\\|token\\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy.',
    G12: "R7: designs and exports not affected by your defect must produce identical output to current main (prove with a before/after comparison on at least the SAMPLE_Top stock design with no corrections).",
    G13: 'ONE: Fix the export failure: design 2be9d906 (order 2a31cd8e) Generate L failed with "Canonical Export mesh is not available headless. Refusing to substitute a different mesh. (MeshNotWatertightError: [MESH-CLOSE] heelBridgeSelfIntersections=4 exceeds baseline 0)". Design: reverse_mortons element L+R (3 mm default), thickness_mm 3, US_M 7.5, Medium.',
    G14: "PUSH: new branch from BASE, never main. Worker head stays the pinned candidate SHA.",
};

function mark(pass) {
    return pass ? "PASS" : "FAIL";
}

function footLine(foot) {
    if (!foot) return "missing";
    return `si=${foot.si} productSi=${foot.productSi} open=${foot.openEdges} nonManifold=${foot.nonManifold} watertight=${foot.watertight} euler=${foot.euler} topN=${foot.topVertexCount} bridge=${foot.bridgeTriangles} sha256=${foot.sha256 ?? "none"} md5=${foot.md5 ?? "none"} exported=${foot.exported}${foot.error ? ` error=${foot.error}` : ""}${foot.baselineSeen != null ? ` baselineSeen=${foot.baselineSeen}` : ""}`;
}

const byId = (grade) => new Map(grade.gates.map((gate) => [gate.id, gate]));
const baseGates = byId(base);
const candGates = byId(candidate);

const lines = [];
lines.push("# Heel-bridge watertight gates — results");
lines.push("");
lines.push(
    "Independent grade of worker draft PR #399. Gates were frozen before the candidate run. Do not merge.",
);
lines.push("");
lines.push(`- BASE SHA: \`${base.sha}\``);
lines.push(`- Candidate SHA: \`${candidate.sha}\``);
lines.push(`- Proof: ${proof.pass ? "PASS" : "FAIL"}`);
lines.push(
    `- Candidate files: ${candidate.files.length ? candidate.files.map((file) => `\`${file}\``).join(", ") : "(none)"}`,
);
lines.push("");
lines.push("## Results");
lines.push("");
lines.push("| Gate | Rule | BASE | Candidate | Measured vs threshold |");
lines.push("| --- | --- | --- | --- | --- |");
for (const gate of base.gates) {
    const other = candGates.get(gate.id);
    const measured = `BASE: ${gate.measured} || CANDIDATE: ${other ? other.measured : "missing"} || threshold: ${gate.threshold}`;
    lines.push(
        `| ${gate.id} | ${gate.rule} | ${mark(gate.pass)} | ${other ? mark(other.pass) : "missing"} | ${measured.replaceAll("|", "/")} |`,
    );
}
lines.push("");
lines.push("## Feet");
lines.push("");
lines.push("| Case | BASE | Candidate |");
lines.push("| --- | --- | --- |");
for (const key of ["stock", "control", "left", "right"]) {
    lines.push(
        `| ${key} | ${footLine(base[key]).replaceAll("|", "/")} | ${footLine(candidate[key]).replaceAll("|", "/")} |`,
    );
}
lines.push("");
lines.push("## Proofs");
lines.push("");
lines.push(
    `Proof command: \`HEEL_GATE_MODE=proof HEEL_GATE_LABEL=base HEEL_GATE_OUT=validation/heel_bridge_watertight_gates/proof.json node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts\``,
);
lines.push("");
lines.push("| Gate | No-op | Bad copy detected | Detail |");
lines.push("| --- | --- | --- | --- |");
for (const row of proof.synthetic) {
    lines.push(`| ${row.gate} | ${mark(row.noopPass)} | ${mark(row.badDetected)} | ${row.detail} |`);
}
lines.push("");
lines.push(`Live stock no-op: ${footLine(proof.live?.stock)}`);
lines.push("");
lines.push(
    `Live existing tests: passed=${proof.live?.existing?.passed} failed=${proof.live?.existing?.failed} exit=${proof.live?.existing?.exitCode}`,
);
lines.push("");
lines.push(`Broken copies: ${JSON.stringify(proof.broken)}`);
if (proof.failures?.length) {
    lines.push("");
    lines.push(`Proof failures: ${proof.failures.join("; ")}`);
}
lines.push("");
lines.push("## Rule compliance");
lines.push("");
lines.push(
    "Each rule is quoted, then PASS or FAIL for BASE and for the candidate. Evidence is the gate measured value against its threshold.",
);
lines.push("");
for (const gate of candidate.gates) {
    const baseGate = baseGates.get(gate.id);
    lines.push(`### ${gate.id} ${gate.rule}`);
    lines.push("");
    lines.push(`> ${QUOTES[gate.id] ?? gate.rule}`);
    lines.push("");
    lines.push(`- BASE: ${baseGate ? mark(baseGate.pass) : "missing"}`);
    lines.push(`- Candidate: ${mark(gate.pass)}`);
    lines.push(`- Threshold: ${gate.threshold}`);
    lines.push(`- BASE measured: ${baseGate ? baseGate.measured : "missing"}`);
    lines.push(`- Candidate measured: ${gate.measured}`);
    lines.push(`- Command: \`${gate.command}\``);
    lines.push("");
}
lines.push("## Grader constraints");
lines.push("");
lines.push(
    "The grader did not change the outer surface, seams, layer-change placement, or surface quality. Product code and the worker's tests were not edited. Files added are only under `validation/heel_bridge_watertight_gates/`.",
);
lines.push("");
lines.push("CAP 0/3: this run did not add a capability, a printer, a deploy, or a production-order change.");
lines.push("");
lines.push("FILES: `validation/heel_bridge_watertight_gates/**` only.");
lines.push("");
lines.push(
    "PUSH: branch `cursor/heel-bridge-watertight-gates-1123` from BASE. Draft PR only. Worker branch, main, Railway, vertex-web, vertex-api, and PR #310 were not pushed.",
);
lines.push("");

writeFileSync(`${dir}/RESULTS.md`, lines.join("\n"));
console.log(`wrote ${dir}/RESULTS.md`);
