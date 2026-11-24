/**
 * Frozen source gates. Compares a checkout to BASE.
 * Does not modify product files.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    ALLOWED_PRODUCT_FILES,
    BASE_SHA,
    THRESHOLDS,
    scanAddedLines,
} from "./judges.mjs";

const root = resolve(process.env.GATE_ROOT ?? process.cwd());

function git(args) {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function numstat(paths) {
    const out = git(["diff", "--numstat", BASE_SHA, "--", ...paths]);
    let changed = 0;
    const files = [];
    for (const row of out.split("\n")) {
        if (!row.trim()) continue;
        const [add, del, file] = row.split("\t");
        if (add === "-" || del === "-") continue;
        const n = Number(add) + Number(del);
        changed += n;
        files.push({ file, changedLines: n });
    }
    return { changed, files };
}

function changedProductPaths() {
    const out = git([
        "diff",
        "--name-only",
        BASE_SHA,
        "--",
        ".",
        ":(exclude)validation/stream_download_gates",
    ]);
    return out
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

function productDiff() {
    return git([
        "diff",
        "-U0",
        BASE_SHA,
        "--",
        ".",
        ":(exclude)validation/stream_download_gates",
    ]);
}

function extractFunction(source, name) {
    const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
    const match = re.exec(source);
    if (!match) return null;
    let i = match.index + match[0].length - 1;
    let paren = 0;
    for (; i < source.length; i++) {
        const ch = source[i];
        if (ch === "(") paren += 1;
        else if (ch === ")") {
            paren -= 1;
            if (paren === 0) {
                i += 1;
                break;
            }
        }
    }
    let angle = 0;
    let brace = 0;
    let bodyStart = -1;
    for (; i < source.length; i++) {
        const ch = source[i];
        if (ch === "<") angle += 1;
        else if (ch === ">") angle = Math.max(0, angle - 1);
        else if (ch === "{") {
            if (angle === 0 && brace === 0) {
                bodyStart = i;
                break;
            }
            brace += 1;
        } else if (ch === "}") brace = Math.max(0, brace - 1);
    }
    if (bodyStart < 0) return null;
    let depth = 0;
    for (let j = bodyStart; j < source.length; j++) {
        const ch = source[j];
        if (ch === "{") depth += 1;
        else if (ch === "}") {
            depth -= 1;
            if (depth === 0) return source.slice(match.index, j + 1);
        }
    }
    return null;
}

function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    if (start < 0) return null;
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (end < 0) return null;
    return source.slice(start, end);
}

function extractCall(source, marker) {
    const start = source.indexOf(marker);
    if (start < 0) return null;
    const open = start + marker.length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (ch === "(") depth += 1;
        else if (ch === ")") {
            depth -= 1;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return null;
}

function show(path) {
    return git(["show", `${BASE_SHA}:${path}`]);
}

function readRoot(path) {
    return readFileSync(resolve(root, path), "utf8");
}

const SERVICE = "vertex/src/features/exports/export-service.ts";
const CLINICAL = "vertex/src/features/exports/export-panel-clinical.ts";

const FUNCTIONS = {
    [SERVICE]: [
        "buildPrinterFootManufacturingStl",
        "printerGcodeSliceFields",
        "resolveHybridSlice",
        "hybridGcodeFilename",
        "userExportFilename",
        "activeExportPatientParts",
        "packOne3mf",
        "packOrder3mf",
        "export3mf",
        "exportDesign",
        "exportGcode",
        "downloadBlob",
        "exportGlb",
        "exportCancelled",
    ],
    [CLINICAL]: [
        "downloadNamedBlobs",
        "objectUrlForBlob",
        "grindingStyleFromViewerWall",
        "camOverridesForClinicalExport",
        "gcodeFeetForExport",
        "defaultGcodeFootScope",
        "clinicalExportFormatTabs",
        "clinicalExportOffersGcode",
        "defaultPrinterPresetForMethod",
        "defaultClinicalGcodeMaterial",
    ],
};

function spanReport() {
    const mismatches = [];
    let compared = 0;
    for (const [path, names] of Object.entries(FUNCTIONS)) {
        const base = show(path);
        const head = readRoot(path);
        for (const name of names) {
            compared += 1;
            const a = extractFunction(base, name);
            const b = extractFunction(head, name);
            if (a == null || b == null || a !== b) {
                mismatches.push({
                    path,
                    name,
                    baseChars: a ? a.length : 0,
                    headChars: b ? b.length : 0,
                    missing: a == null || b == null,
                });
            }
        }
    }
    const baseService = show(SERVICE);
    const headService = readRoot(SERVICE);
    const regions = [
        {
            name: "generateSolid.mutate payload",
            base: extractCall(baseService, "trpc.manufacturing.generateSolid.mutate("),
            head: extractCall(headService, "trpc.manufacturing.generateSolid.mutate("),
        },
        {
            name: "manufacturing STL build",
            base: extractBetween(
                baseService,
                "const includeLeader = separateFiles && options.includeLeaderBlock !== false;",
                "const stopped = abort();",
            ),
            head: extractBetween(
                headService,
                "const includeLeader = separateFiles && options.includeLeaderBlock !== false;",
                "const stopped = abort();",
            ),
        },
        {
            name: "gcode/stl blob bytes",
            base: extractBetween(baseService, "let blob: Blob | undefined;", "if (!options.deferDownload) downloadBlob"),
            head: extractBetween(headService, "let blob: Blob | undefined;", "if (!options.deferDownload) downloadBlob"),
        },
    ];
    for (const region of regions) {
        compared += 1;
        if (region.base == null || region.head == null || region.base !== region.head) {
            mismatches.push({
                path: SERVICE,
                name: region.name,
                baseChars: region.base ? region.base.length : 0,
                headChars: region.head ? region.head.length : 0,
                missing: region.base == null || region.head == null,
            });
        }
    }
    return { compared, mismatches };
}

const seamLine = /seam|layer[-_ ]?change|z[-_ ]?seam|start[_ ]?point/i;
const railwayPath = /vertex-web|vertex-api|railway/i;

const surface = numstat([
    "vertex/src/lib/geometry",
    "vertex/src/lib/kiri",
    "vertex/src/lib/hardness",
]);
const seamTrees = numstat(["vertex/src/lib/kiri", "vertex/src/lib/geometry"]);
const engrave = numstat(["vertex/src/lib/geometry/text-marking"]);
const leader = numstat(["vertex/src/lib/geometry/leader-block.ts"]);
const paths = changedProductPaths();
const disallowed = paths.filter((path) => !ALLOWED_PRODUCT_FILES.includes(path));
const railway = paths.filter((path) => railwayPath.test(path));
const scanned = scanAddedLines(productDiff());
let seamHits = 0;
let current = "";
for (const line of productDiff().split("\n")) {
    if (line.startsWith("+++ b/")) current = line.slice(6);
    if (current.includes("validation/stream_download_gates")) continue;
    if (line.startsWith("+") && !line.startsWith("+++") && seamLine.test(line)) seamHits += 1;
}
const spans = spanReport();
let mainSha = "";
try {
    mainSha = git(["rev-parse", "main"]).trim();
} catch {
    mainSha = "missing";
}

const gates = [
    {
        id: "G_R1_SURFACE",
        threshold: THRESHOLDS.G_R1_SURFACE,
        pass: surface.changed === 0,
        measured: { changedLines: surface.changed, files: surface.files },
        command: `git diff --numstat ${BASE_SHA} -- vertex/src/lib/geometry vertex/src/lib/kiri vertex/src/lib/hardness`,
    },
    {
        id: "G_R2_SEAMS",
        threshold: THRESHOLDS.G_R2_SEAMS,
        pass: seamTrees.changed === 0 && seamHits === 0,
        measured: { geometryAndKiriChangedLines: seamTrees.changed, seamOrLayerAddedLines: seamHits },
        command: `git diff -U0 ${BASE_SHA} -- vertex/src/lib/kiri vertex/src/lib/geometry`,
    },
    {
        id: "G_R3_SCOPE",
        threshold: THRESHOLDS.G_R3_SCOPE,
        pass: disallowed.length === 0,
        measured: { changedPaths: paths, disallowed },
        command: `git diff --name-only ${BASE_SHA} -- . ':(exclude)validation/stream_download_gates'`,
    },
    {
        id: "G_R4_SECRETS",
        threshold: THRESHOLDS.G_R4_SECRETS,
        pass: scanned.secrets === 0,
        measured: { secretAssignments: scanned.secrets, addedLines: scanned.addedLines },
        command: `git diff -U0 ${BASE_SHA} | secret-line scan`,
    },
    {
        id: "G_R4_PHI",
        threshold: THRESHOLDS.G_R4_PHI,
        pass: scanned.phi === 0,
        measured: { phiLines: scanned.phi },
        command: `git diff -U0 ${BASE_SHA} | email/phone/ssn scan`,
    },
    {
        id: "G_R4_RAILWAY",
        threshold: THRESHOLDS.G_R4_RAILWAY,
        pass: railway.length === 0,
        measured: { railwayPaths: railway },
        command: "changed paths filtered for vertex-web, vertex-api, railway",
    },
    {
        id: "G_R4_MAIN",
        threshold: THRESHOLDS.G_R4_MAIN,
        pass: mainSha === BASE_SHA,
        measured: { mainSha, baseSha: BASE_SHA },
        command: "git rev-parse main",
    },
    {
        id: "G_R5_SPANS",
        threshold: THRESHOLDS.G_R5_SPANS,
        pass: spans.mismatches.length === 0,
        measured: { compared: spans.compared, mismatches: spans.mismatches },
        command: "function and payload spans vs git show BASE",
    },
    {
        id: "G_MUST_ENGRAVE",
        threshold: THRESHOLDS.G_MUST_ENGRAVE,
        pass: engrave.changed === 0,
        measured: { changedLines: engrave.changed, files: engrave.files },
        command: `git diff --numstat ${BASE_SHA} -- vertex/src/lib/geometry/text-marking`,
    },
    {
        id: "G_MUST_LEADER_FILE",
        threshold: THRESHOLDS.G_MUST_LEADER_FILE,
        pass: leader.changed === 0,
        measured: { changedLines: leader.changed },
        command: `git diff --numstat ${BASE_SHA} -- vertex/src/lib/geometry/leader-block.ts`,
    },
];

const payload = { root, base: BASE_SHA, gates };
const outPath = process.env.GATE_SOURCE_RESULT ?? "/tmp/stream-download-gates-source.json";
writeFileSync(outPath, JSON.stringify(payload, null, 2));
process.stdout.write(
    `${JSON.stringify({ outPath, pass: gates.every((gate) => gate.pass), failed: gates.filter((gate) => !gate.pass).map((gate) => gate.id) })}\n`,
);
