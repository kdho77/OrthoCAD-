// FROZEN formatter. Fills PASS/FAIL from gate JSON. Does not change thresholds.
import { readFileSync, existsSync } from "node:fs";

const [proofPath, basePath, candPath] = process.argv.slice(2);
if (!proofPath || !basePath || !candPath) {
    console.error("usage: format_results.mjs proof.json base.json candidate.json");
    process.exit(2);
}

function read(path) {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
}

const proof = read(proofPath);
const base = read(basePath);
const cand = read(candPath);

function cell(file, id) {
    const row = file?.gates?.find((gate) => gate.id === id);
    if (!row) return "n/a";
    return row.pass ? "PASS" : "FAIL";
}

function measured(file, id) {
    const row = file?.gates?.find((gate) => gate.id === id);
    return row ? row.measured : "n/a";
}

function jobs(file, pred) {
    return (file?.jobs ?? []).filter(pred);
}

const lines = [];
const push = (s = "") => lines.push(s);

push("# EVA CNC gates — results");
push("");
push("Independent grade. Gates were frozen before the candidate run. This file is the measured output.");
push("");
push(`- Base SHA: \`4e2e196561bada8f2a4faf4ad174a716306d8c94\``);
push(`- Candidate SHA: \`${cand?.sha ?? "3260b001686883fa74ea95b1833df42100bfc656"}\``);
push(`- Graded HEAD recorded by the candidate run: \`${cand?.sha ?? "not run"}\``);
push(`- BASE own-cutout entry max: \`${base?.ownEntryMaxMm ?? "n/a"}\` mm`);
push("");
push("## Proofs");
push("");
push(`Proof harness: **${proof?.pass ? "PASS" : "FAIL"}**`);
push("");
push("| Gate | No-op on a good copy | Bad copy detected | Detail |");
push("| --- | --- | --- | --- |");
for (const row of proof?.synthetic ?? []) {
    push(`| ${row.gate} | ${row.noopPass ? "PASS" : "FAIL"} | ${row.badDetected ? "PASS" : "FAIL"} | ${row.detail} |`);
}
push("");
push("Live BASE Men's 9 LR (where BASE should pass):");
push("");
push("```json");
push(JSON.stringify(proof?.live ?? null, null, 2));
push("```");
push("");
push("Deliberately broken copy of that G-code / segment list:");
push("");
push("```json");
push(JSON.stringify(proof?.broken ?? null, null, 2));
push("```");
if (proof?.failures?.length) {
    push("");
    push("Proof failures:");
    for (const failure of proof.failures) push(`- ${failure}`);
}
push("");
push("## Gate table");
push("");
push("| Gate | BASE | Candidate | Threshold | Candidate measured |");
push("| --- | --- | --- | --- | --- |");
for (const id of ["G1", "G2", "G3", "G4", "G5", "G6"]) {
    const row = cand?.gates?.find((gate) => gate.id === id);
    push(
        `| ${id} | ${cell(base, id)} | ${cell(cand, id)} | ${row?.threshold ?? ""} | ${measured(cand, id)} |`,
    );
}
push("");
push("## Commands");
push("");
push("```bash");
push("bash validation/eva_cnc_gates/run_gates.sh proof");
push("bash validation/eva_cnc_gates/run_gates.sh grade-base");
push("bash validation/eva_cnc_gates/run_gates.sh grade-candidate");
push("bash validation/eva_cnc_gates/run_gates.sh format");
push("```");
push("");
push("## Per job");
push("");
function jobTable(title, file) {
    push(`### ${title}`);
    push("");
    push("| Job | Side | Refused | sha256 | Filename | Edge mm | Other gap mm | Own entry mm | Slide mm | Feet |");
    push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const job of file?.jobs ?? []) {
        const feet = (job.feet ?? [])
            .map((foot) => `${foot.foot}:${foot.otherGapMm == null ? "n/a" : Number(foot.otherGapMm).toFixed(3)}`)
            .join(" ");
        push(
            `| ${job.id} | ${job.millSide} | ${job.refused ? (job.error ?? "yes") : "no"} | ${job.sha256 ? String(job.sha256).slice(0, 12) : ""} | ${job.filename ?? ""} | ${fmt(job.edgeClearanceMm)} | ${fmt(job.minOtherGapMm)} | ${fmt(job.ownEntryMm)} | ${fmt(job.slideMm)} | ${feet} |`,
        );
    }
    push("");
}
function fmt(value) {
    return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "";
}
jobTable("BASE", base);
jobTable("Candidate", cand);

push("## Scope and schema");
push("");
push(`Candidate profile diffs: ${(cand?.profileDiffs ?? []).join("; ") || "none"}`);
push("");
push(`Candidate scope: ${cand?.scope?.ok ? "PASS" : "FAIL"} ${(cand?.scope?.reasons ?? []).join("; ")}`);
push("");
push(`Schema: ${cand?.schema ?? ""}`);
push("");
push(`create_saved_design: ${cand?.savedDesign ?? ""}`);
push("");
push("G1 byte identity uses full sha256 in the JSON artifacts `base.json` and `candidate.json` (not only the 12-character prefix in the table).");
push("");

const g2 = jobs(cand, (job) => ["sample-m13.5", "sample-m14", "sample-m15"].includes(job.id) && job.millSide === "LR");
push("## Size-15 slide and clearance");
push("");
for (const job of g2) {
    push(
        `- M${job.menSize} LR: refused=${job.refused} edge=${fmt(job.edgeClearanceMm)} mm gap=${fmt(job.minOtherGapMm)} mm slide=${fmt(job.slideMm)} mm heels ${fmt(job.slot1HeelX)} -> ${fmt(job.slot2HeelX)} ownEntry=${fmt(job.ownEntryMm)} mm`,
    );
}
push("");

process.stdout.write(`${lines.join("\n")}\n`);
