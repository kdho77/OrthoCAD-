// FROZEN judges for the heel-bridge watertight grade.
// Thresholds were fixed from the worker TESTS / MUST-MATCH / R1–R7 lines
// against BASE 268aac85847160b5b2703a05688721ea4cb93b24, before candidate
// ad1c3851fb9502f224002f91a875c639863f0323 was measured.
// Do not edit thresholds, allowlists, or judges after the freeze commit.

export const BASE_SHA = "268aac85847160b5b2703a05688721ea4cb93b24";
export const CANDIDATE_SHA = "ad1c3851fb9502f224002f91a875c639863f0323";

export const SI_THRESHOLD = 0;
export const OPEN_EDGE_THRESHOLD = 0;
export const NON_MANIFOLD_THRESHOLD = 0;
export const EULER_THRESHOLD = 2;
export const MIN_TOP_VERTICES = 1000;
export const MIN_BRIDGE_TRIANGLES = 1;
export const REVERSE_HEIGHT_MM = 3;
export const DEFECT_THICKNESS_MM = 3;
export const DEFECT_US_MEN_SIZE = 7.5;
export const DEFECT_SHOE_WIDTH = "medium";

export const FROZEN_SEAM = {
    limit: 6,
    fallback: 9.5,
    slack: 0.01,
    spline: 6.05,
} as const;

export const GATE_COMMAND =
    "HEEL_GATE_MODE=grade node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts";
export const EXISTING_TEST_COMMAND =
    "node_modules/.bin/rstest run vertex/src/lib/geometry/elements.test.ts vertex/src/lib/geometry/anatomical-side.test.ts";

export type GateLabel = "base" | "candidate";

export interface FootMeasure {
    id: string;
    exported: boolean;
    si: number | null;
    productSi: number | null;
    openEdges: number | null;
    nonManifold: number | null;
    watertight: boolean | null;
    euler: number | null;
    productEuler: number | null;
    topVertexCount: number | null;
    bridgeTriangles: number | null;
    sha256: string | null;
    md5: string | null;
    triangles: number | null;
    error: string | null;
    baselineSeen: number | null;
}

export interface GateRow {
    id: string;
    rule: string;
    pass: boolean;
    measured: string;
    threshold: string;
    command: string;
}

export interface PlacedSpec {
    kind: string;
    side: string;
    heightMm: number;
}

export interface DesignSpec {
    usMenSize: number;
    shoeWidth: string;
    thicknessMm: number;
    leftThicknessMm: number;
    rightThicknessMm: number;
    method: string;
    pattern: string;
    elements: PlacedSpec[];
    correctionsUnchanged: boolean;
    assetId: string;
    glbPath: string;
    notice: string | null;
}

const ALLOW_EXACT = new Set([
    "vertex/src/lib/geometry/elements.ts",
    "vertex/src/lib/geometry/elements.test.ts",
    "vertex/src/lib/geometry/mortons-extension.ts",
    "vertex/src/lib/geometry/height-field.ts",
    "vertex/src/lib/geometry/mesh-close.ts",
    "vertex/src/lib/geometry/export-geometry.ts",
    "vertex/src/lib/geometry/base-modifier.ts",
    "vertex/src/lib/geometry/anatomical-side.test.ts",
]);

const SURFACE_DENY = [
    "vertex/src/lib/geometry/procedural-wall/bezier-column.ts",
    "vertex/src/lib/geometry/procedural-wall/wall-spline.ts",
    "vertex/src/lib/geometry/procedural-wall/reconstruct.ts",
    "vertex/shared/print-recipe/",
    "vertex/src/lib/kiri/",
    "python-service/",
    "vertex/src/features/exports/vertexslice",
    "vertex/src/lib/hardness/",
];

const TEXT_PREFIXES = ["vertex/shared/bottom-text-marking.ts", "vertex/src/lib/geometry/text-marking/"];

const SAMPLE_TOP_FILES = ["vertex/public/Templates/SAMPLE_Top.glb", "tests/fixtures/SAMPLE_Top.glb"];

const DEPLOY_DENY = [
    /(^|\/)railway/i,
    /vertex-web/i,
    /vertex-api/i,
    /render\.yaml$/i,
    /fly\.toml$/i,
    /(^|\/)Dockerfile$/i,
    /^\.github\/workflows\//,
    /^vertex\/prisma\/migrations\//,
];

export function addedLines(diff: string): string {
    return diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .join("\n");
}

export function blankFoot(id: string, error: string): FootMeasure {
    return {
        id,
        exported: false,
        si: null,
        productSi: null,
        openEdges: null,
        nonManifold: null,
        watertight: null,
        euler: null,
        productEuler: null,
        topVertexCount: null,
        bridgeTriangles: null,
        sha256: null,
        md5: null,
        triangles: null,
        error,
        baselineSeen: null,
    };
}

export function defectFootOk(foot: FootMeasure): { pass: boolean; detail: string } {
    const reasons: string[] = [];
    if (!foot.exported) reasons.push("export did not return a solid");
    if (foot.si !== SI_THRESHOLD)
        reasons.push(`heelBridgeSelfIntersections=${foot.si} threshold == ${SI_THRESHOLD}`);
    if (foot.openEdges !== OPEN_EDGE_THRESHOLD) {
        reasons.push(`openEdges=${foot.openEdges} threshold == ${OPEN_EDGE_THRESHOLD}`);
    }
    if (foot.nonManifold !== NON_MANIFOLD_THRESHOLD) {
        reasons.push(`nonManifold=${foot.nonManifold} threshold == ${NON_MANIFOLD_THRESHOLD}`);
    }
    if (foot.watertight !== true) reasons.push(`watertight=${String(foot.watertight)}`);
    if (foot.euler !== EULER_THRESHOLD) reasons.push(`euler=${foot.euler} threshold == ${EULER_THRESHOLD}`);
    if (foot.topVertexCount == null || foot.topVertexCount < MIN_TOP_VERTICES) {
        reasons.push(`topVertexCount=${foot.topVertexCount} threshold >= ${MIN_TOP_VERTICES}`);
    }
    if (foot.bridgeTriangles == null || foot.bridgeTriangles < MIN_BRIDGE_TRIANGLES) {
        reasons.push(`bridgeTriangles=${foot.bridgeTriangles} threshold >= ${MIN_BRIDGE_TRIANGLES}`);
    }
    const detail =
        `si=${foot.si} productSi=${foot.productSi} open=${foot.openEdges} nonManifold=${foot.nonManifold} ` +
        `watertight=${String(foot.watertight)} euler=${foot.euler} topN=${foot.topVertexCount} ` +
        `bridge=${foot.bridgeTriangles} triangles=${foot.triangles} sha256=${foot.sha256 ?? "none"} ` +
        `exported=${foot.exported}${foot.error ? ` error=${foot.error}` : ""}`;
    return {
        pass: reasons.length === 0,
        detail: reasons.length ? `${reasons.join("; ")}; ${detail}` : detail,
    };
}

export function placementOk(elements: PlacedSpec[]): { pass: boolean; detail: string } {
    const rev = elements.filter((el) => el.kind === "reverse_mortons");
    const left = rev.filter((el) => el.side === "left");
    const right = rev.filter((el) => el.side === "right");
    const heights = rev.map((el) => el.heightMm);
    const pass =
        elements.length === 2 &&
        left.length === 1 &&
        right.length === 1 &&
        heights.length === 2 &&
        heights.every((height) => height === REVERSE_HEIGHT_MM);
    return {
        pass,
        detail: `elements=${elements.length} left=${left.length} right=${right.length} heightMm=${heights.join(",") || "none"} threshold height == ${REVERSE_HEIGHT_MM}`,
    };
}

export function defectDesignOk(spec: DesignSpec): { pass: boolean; detail: string } {
    const reasons: string[] = [];
    if (spec.usMenSize !== DEFECT_US_MEN_SIZE)
        reasons.push(`usMenSize=${spec.usMenSize} threshold == ${DEFECT_US_MEN_SIZE}`);
    if (spec.shoeWidth !== DEFECT_SHOE_WIDTH)
        reasons.push(`shoeWidth=${spec.shoeWidth} threshold == ${DEFECT_SHOE_WIDTH}`);
    if (spec.thicknessMm !== DEFECT_THICKNESS_MM) {
        reasons.push(`thicknessMm=${spec.thicknessMm} threshold == ${DEFECT_THICKNESS_MM}`);
    }
    if (spec.leftThicknessMm !== DEFECT_THICKNESS_MM) {
        reasons.push(`leftThicknessMm=${spec.leftThicknessMm} threshold == ${DEFECT_THICKNESS_MM}`);
    }
    if (spec.rightThicknessMm !== DEFECT_THICKNESS_MM) {
        reasons.push(`rightThicknessMm=${spec.rightThicknessMm} threshold == ${DEFECT_THICKNESS_MM}`);
    }
    if (spec.method !== "printing_solid") reasons.push(`method=${spec.method}`);
    if (spec.pattern !== "full_contact") reasons.push(`pattern=${spec.pattern}`);
    if (!spec.correctionsUnchanged) reasons.push("corrections changed while placing reverse Morton's");
    if (spec.notice) reasons.push(`placement notice=${spec.notice}`);
    const placed = placementOk(spec.elements);
    if (!placed.pass) reasons.push(placed.detail);
    const detail = `${placed.detail}; usMenSize=${spec.usMenSize} shoeWidth=${spec.shoeWidth} thickness=${spec.thicknessMm}/${spec.leftThicknessMm}/${spec.rightThicknessMm}`;
    return {
        pass: reasons.length === 0,
        detail: reasons.length ? `${reasons.join("; ")}; ${detail}` : detail,
    };
}

export function reproTestOk(diff: string): { pass: boolean; detail: string } {
    const added = addedLines(diff);
    const need: Array<[string, boolean]> = [
        ["reverse_mortons", /reverse_mortons/.test(added)],
        ["left", /\bleft\b/.test(added)],
        ["right", /\bright\b/.test(added)],
        ["7.5", /7\.5/.test(added)],
        ["thickness 3", /thickness(?:Mm|_mm)?[^\n]{0,80}\b3\b|\b3\b[^\n]{0,40}thickness/i.test(added)],
        ["heelBridgeSelfIntersections", /heelBridgeSelfIntersections/.test(added)],
        ["watertight", /watertight|openEdges|isWatertight/.test(added)],
    ];
    const missing = need.filter((row) => !row[1]).map((row) => row[0]);
    return {
        pass: missing.length === 0,
        detail: missing.length
            ? `added test lines missing ${missing.join(", ")}`
            : "added lines name reverse_mortons L+R, 7.5, thickness 3, heelBridgeSelfIntersections, watertight",
    };
}

export function testsGreen(passed: number, failed: number): { pass: boolean; detail: string } {
    const pass = failed === 0 && passed > 0;
    return { pass, detail: `passed=${passed} failed=${failed} threshold failed == 0 and passed > 0` };
}

export function hashesMatch(a: string | null, b: string | null): boolean {
    return Boolean(a && b && a === b);
}

function codeLines(source: string): string[] {
    return source.split("\n").map((line) => line.replace(/\/\/.*$/, ""));
}

function liveIncludes(source: string, needle: string): boolean {
    return codeLines(source).some((line) => line.includes(needle));
}

export function baselineTextOk(
    meshClose: string,
    exportGeometry: string,
): { pass: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (!liveIncludes(meshClose, "heelBridgeSelfIntersections: 0")) {
        reasons.push("mesh-close heelBridgeSelfIntersections literal is not 0");
    }
    if (!liveIncludes(meshClose, "if (si > baseline.heelBridgeSelfIntersections)")) {
        reasons.push("compare is not si > baseline.heelBridgeSelfIntersections");
    }
    if (!liveIncludes(exportGeometry, "heelBridgeSelfIntersections: 0")) {
        reasons.push("export procedural heelBridgeSelfIntersections literal is not 0");
    }
    if (!liveIncludes(exportGeometry, "assertClosedSolidAcceptable(solid, topN, baseline)")) {
        reasons.push("export does not call assertClosedSolidAcceptable(solid, topN, baseline)");
    }
    if (/heelBridgeSelfIntersections:\s*[1-9]/.test(meshClose))
        reasons.push("mesh-close baseline number is above 0");
    if (/heelBridgeSelfIntersections:\s*[1-9]/.test(exportGeometry)) {
        reasons.push("export baseline number is above 0");
    }
    if (/if\s*\(\s*si\s*>\s*[1-9]/.test(meshClose)) reasons.push("SI compare uses a numeric ceiling above 0");
    if (/if\s*\(\s*si\s*>=\s*baseline\.heelBridgeSelfIntersections/.test(meshClose)) {
        reasons.push("SI compare was changed to >=");
    }
    return { pass: reasons.length === 0, reasons };
}

export function countersMatch(feet: FootMeasure[]): { pass: boolean; detail: string } {
    const rows = feet.filter((foot) => foot.exported && foot.si != null && foot.productSi != null);
    const bad = rows.filter((foot) => foot.si !== foot.productSi);
    if (bad.length) {
        return {
            pass: false,
            detail: bad.map((foot) => `${foot.id} frozen=${foot.si} product=${foot.productSi}`).join("; "),
        };
    }
    return {
        pass: true,
        detail: rows.length
            ? rows.map((foot) => `${foot.id} frozen=product=${foot.si}`).join("; ")
            : "no successful export to compare counters",
    };
}

export function seamValuesOk(measured: {
    limit: number;
    fallback: number;
    slack: number;
    spline: number;
}): boolean {
    return (
        measured.limit === FROZEN_SEAM.limit &&
        measured.fallback === FROZEN_SEAM.fallback &&
        measured.slack === FROZEN_SEAM.slack &&
        measured.spline === FROZEN_SEAM.spline
    );
}

function pathDenied(file: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => file === prefix || file.startsWith(prefix));
}

export function surfaceFilesOk(files: string[]): { pass: boolean; reasons: string[] } {
    const reasons = files
        .filter((file) => pathDenied(file, SURFACE_DENY))
        .map((file) => `surface file ${file}`);
    return { pass: reasons.length === 0, reasons };
}

export function slicerSurfaceLinesOk(diff: string): { pass: boolean; hits: string[] } {
    const hits = addedLines(diff)
        .split("\n")
        .filter((line) => /seam_position|layer_change|fuzzy_skin|ironing/i.test(line));
    return { pass: hits.length === 0, hits };
}

export function scopeFilesOk(files: string[]): { pass: boolean; reasons: string[] } {
    const reasons: string[] = [];
    for (const file of files) {
        if (file.startsWith("validation/heel_bridge_watertight_gates/")) continue;
        const allowed =
            ALLOW_EXACT.has(file) ||
            file.startsWith("vertex/src/lib/geometry/procedural-wall/") ||
            file.startsWith("vertex/src/lib/geometry/mesh-close.") ||
            file.startsWith("vertex/src/lib/geometry/export-geometry.") ||
            /^vertex\/src\/lib\/geometry\/.*\.(test|spec)\.ts$/.test(file) ||
            /^tests\/.*\.(test|spec)\.ts$/.test(file) ||
            (/reverse.?morton|heel.?bridge/i.test(file) && file.endsWith(".ts"));
        if (!allowed) reasons.push(`outside the defect allowlist: ${file}`);
    }
    return { pass: reasons.length === 0, reasons };
}

export function sampleTopOk(assetId: string, glbPath: string): boolean {
    return assetId === "sample-top" && /SAMPLE_Top\.glb$/i.test(glbPath);
}

export function sampleTopFilesOk(files: string[]): { pass: boolean; reasons: string[] } {
    const reasons = files
        .filter((file) => SAMPLE_TOP_FILES.includes(file))
        .map((file) => `stock mesh replaced: ${file}`);
    return { pass: reasons.length === 0, reasons };
}

export function bottomEngraveOk(surface: string, mode: string): boolean {
    return surface === "bottom" && mode === "engrave";
}

export function textFilesOk(files: string[]): { pass: boolean; reasons: string[] } {
    const reasons: string[] = [];
    for (const file of files) {
        if (pathDenied(file, TEXT_PREFIXES)) reasons.push(`text marking file ${file}`);
        if (/engrav/i.test(file) && !file.includes("text-marking"))
            reasons.push(`new engraving path ${file}`);
    }
    return { pass: reasons.length === 0, reasons };
}

export function secretsOk(files: string[], diff: string): { pass: boolean; reasons: string[] } {
    const reasons: string[] = [];
    for (const file of files) {
        if (DEPLOY_DENY.some((re) => re.test(file))) reasons.push(`deploy or forbidden path ${file}`);
    }
    const added = addedLines(diff);
    if (/api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i.test(added)) reasons.push("api_key literal in diff");
    if (/bearer\s+[a-z0-9._-]{12,}/i.test(added)) reasons.push("bearer token in diff");
    if (/ghp_[A-Za-z0-9]{20,}/.test(added)) reasons.push("github token in diff");
    if (/sk_live_/.test(added)) reasons.push("live secret in diff");
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(added)) reasons.push("email in diff");
    if (/\b\d{3}-\d{3}-\d{4}\b/.test(added)) reasons.push("phone number in diff");
    if (/firstName["']?\s*[:=]\s*["'][A-Za-z]/.test(added)) reasons.push("firstName literal in diff");
    if (/lastName["']?\s*[:=]\s*["'][A-Za-z]/.test(added)) reasons.push("lastName literal in diff");
    return { pass: reasons.length === 0, reasons };
}

export function pushOk(input: { head: string; branch: string; baseIsAncestor: boolean; label: GateLabel }): {
    pass: boolean;
    detail: string;
} {
    const reasons: string[] = [];
    if (input.branch === "main") reasons.push("HEAD is main");
    if (!input.baseIsAncestor) reasons.push("BASE is not an ancestor of HEAD");
    if (input.label === "base" && input.head !== BASE_SHA) reasons.push(`HEAD ${input.head} != ${BASE_SHA}`);
    if (input.label === "candidate" && input.head !== CANDIDATE_SHA) {
        reasons.push(`HEAD ${input.head} != ${CANDIDATE_SHA}`);
    }
    const detail = `head=${input.head} branch=${input.branch} baseIsAncestor=${input.baseIsAncestor}`;
    return {
        pass: reasons.length === 0,
        detail: reasons.length ? `${reasons.join("; ")}; ${detail}` : detail,
    };
}

function stockAnchor(foot: FootMeasure): boolean {
    return defectFootOk(foot).pass && Boolean(foot.sha256);
}

function identityAgainstBase(
    label: GateLabel,
    name: string,
    foot: FootMeasure,
    baseHash: string | null,
    baseWasAnchor: boolean,
    requiredOnBase: boolean,
): { pass: boolean; detail: string } {
    if (!foot.exported) return { pass: false, detail: `${name} export failed ${foot.error ?? ""}`.trim() };
    const anchor = stockAnchor(foot);
    if (label === "base") {
        if (!anchor && requiredOnBase) {
            return {
                pass: false,
                detail: `${name} is not a watertight anchor; ${defectFootOk(foot).detail}`,
            };
        }
        if (!anchor)
            return {
                pass: true,
                detail: `${name} not watertight on BASE; excluded from identity. ${defectFootOk(foot).detail}`,
            };
        return { pass: true, detail: `${name} sha256 ${foot.sha256} md5 ${foot.md5}` };
    }
    if (!baseWasAnchor)
        return { pass: true, detail: `${name} BASE was not watertight; not an identity case` };
    if (!hashesMatch(foot.sha256, baseHash)) {
        return { pass: false, detail: `${name} sha256 ${foot.sha256} != BASE ${baseHash}` };
    }
    return { pass: true, detail: `${name} sha256 ${foot.sha256} matches BASE` };
}

export interface GradeInput {
    label: GateLabel;
    head: string;
    branch: string;
    baseIsAncestor: boolean;
    files: string[];
    diff: string;
    designSpec: { pass: boolean; detail: string };
    left: FootMeasure;
    right: FootMeasure;
    stock: FootMeasure;
    control: FootMeasure;
    baseStockHash: string | null;
    baseControlHash: string | null;
    baseStockAnchor: boolean;
    baseControlAnchor: boolean;
    baseline: { pass: boolean; reasons: string[] };
    seam: { limit: number; fallback: number; slack: number; spline: number };
    textSurface: string;
    textMode: string;
    assetId: string;
    glbPath: string;
    existingPassed: number;
    existingFailed: number;
}

export function scoreGates(input: GradeInput): GateRow[] {
    const left = defectFootOk(input.left);
    const right = defectFootOk(input.right);
    const g1Pass = left.pass && right.pass && input.designSpec.pass;
    const repro = reproTestOk(input.diff);
    const g2Pass = input.label === "base" ? false : repro.pass;
    const g2Measured =
        input.label === "base" ? "BASE has no worker diff, so the reproducing test is absent" : repro.detail;
    const existing = testsGreen(input.existingPassed, input.existingFailed);
    const stockId = identityAgainstBase(
        input.label,
        "SAMPLE_Top stock",
        input.stock,
        input.baseStockHash,
        input.baseStockAnchor,
        true,
    );
    const controlId = identityAgainstBase(
        input.label,
        "US M7.5 thickness 3 no elements",
        input.control,
        input.baseControlHash,
        input.baseControlAnchor,
        false,
    );
    const counters = countersMatch([input.stock, input.control, input.left, input.right]);
    const g5Pass = input.baseline.pass && counters.pass;
    const seamOk = seamValuesOk(input.seam);
    const surface = surfaceFilesOk(input.files);
    const slicer = slicerSurfaceLinesOk(input.diff);
    const g6Pass = seamOk && surface.pass && slicer.pass;
    const textFiles = textFilesOk(input.files);
    const engrave = bottomEngraveOk(input.textSurface, input.textMode);
    const g7Pass = engrave && textFiles.pass && slicer.pass && seamOk;
    const scope = scopeFilesOk(input.files);
    const oneReasons = [...scope.reasons];
    if (input.label === "candidate" && input.files.length === 0) oneReasons.push("candidate diff is empty");
    const sampleMesh = sampleTopFilesOk(input.files);
    const sampleShape = sampleTopOk(input.assetId, input.glbPath);
    const secrets = secretsOk(input.files, input.diff);
    const pushed = pushOk(input);

    const row = (
        id: string,
        rule: string,
        pass: boolean,
        measured: string,
        threshold: string,
        command = GATE_COMMAND,
    ): GateRow => ({ id, rule, pass, measured, threshold, command });

    return [
        row(
            "G1",
            "TESTS export",
            g1Pass,
            `design ${input.designSpec.detail} | left ${left.detail} | right ${right.detail}`,
            "reverse_mortons L+R height 3, thickness 3, US M 7.5 medium; each foot exports; frozen heelBridgeSelfIntersections == 0; openEdges == 0; nonManifold == 0; watertight; euler == 2; topVertexCount >= 1000; bridgeTriangles >= 1",
        ),
        row(
            "G2",
            "TESTS new test",
            g2Pass,
            g2Measured,
            "candidate diff adds reverse_mortons, left, right, 7.5, thickness 3, heelBridgeSelfIntersections, and watertight. BASE fails this gate because that test is not on BASE.",
        ),
        row(
            "G3",
            "TESTS existing",
            existing.pass,
            `${existing.detail}; command ${EXISTING_TEST_COMMAND}`,
            "elements.test.ts and anatomical-side.test.ts exit with failed == 0 and passed > 0",
            EXISTING_TEST_COMMAND,
        ),
        row(
            "G4",
            "MUST-MATCH identity",
            stockId.pass && controlId.pass,
            `${stockId.detail} | ${controlId.detail}`,
            "A design that exports watertight on BASE keeps the same STL sha256. Stock must be that anchor. The 7.5 / thickness 3 / no-element foot is an anchor only when BASE already exports it watertight.",
        ),
        row(
            "G5",
            "MUST-MATCH baseline 0",
            g5Pass,
            `source ${input.baseline.pass ? "baseline 0 and si > baseline" : input.baseline.reasons.join("; ")} | counters ${counters.detail}`,
            "DEFAULT and procedural heelBridgeSelfIntersections stay 0; compare stays si > baseline; product counter equals the frozen BASE counter on every solid this run exported",
        ),
        row(
            "G6",
            "R1",
            g6Pass,
            `seam limit=${input.seam.limit} fallback=${input.seam.fallback} slack=${input.seam.slack} spline=${input.seam.spline} | files ${surface.pass ? "untouched" : surface.reasons.join("; ")} | slicer lines ${slicer.pass ? "none" : slicer.hits.join("; ")}`,
            `SEAM_B_LIMIT_DEG == ${FROZEN_SEAM.limit}, SEAM_B_FALLBACK_DEG == ${FROZEN_SEAM.fallback}, SEAM_B_SLACK_DEG == ${FROZEN_SEAM.slack}, SPLINE_SEAM_B_MAX_DEG == ${FROZEN_SEAM.spline}; bezier-column, wall-spline, reconstruct, print-recipe, kiri, python-service, vertexslice, and hardness diff empty; no new seam_position, layer_change, fuzzy_skin, or ironing line`,
        ),
        row(
            "G7",
            "R2",
            g7Pass,
            `default text surface=${input.textSurface} mode=${input.textMode} | text files ${textFiles.pass ? "untouched" : textFiles.reasons.join("; ")}`,
            "default bottom text stays surface bottom and mode engrave; bottom-text-marking and text-marking diff empty; seam constants unchanged; no new top/side seam or layer-change line",
        ),
        row(
            "G8",
            "R3",
            scope.pass,
            scope.pass ? `files ${input.files.join(", ") || "(none)"}` : scope.reasons.join("; "),
            "diff stays on reverse Morton's height, the height field, the procedural loft, mesh-close, export close, and tests. Other subsystems are out of scope.",
        ),
        row(
            "G9",
            "R4",
            sampleShape && sampleMesh.pass,
            `assetId=${input.assetId} glbPath=${input.glbPath} | meshes ${sampleMesh.pass ? "untouched" : sampleMesh.reasons.join("; ")}`,
            "placed design base is sample-top and ends in SAMPLE_Top.glb; the SAMPLE_Top glb files are not in the diff",
        ),
        row(
            "G10",
            "R5",
            engrave && textFiles.pass,
            `surface=${input.textSurface} mode=${input.textMode} | ${textFiles.pass ? "no new engraving file" : textFiles.reasons.join("; ")}`,
            "textMarking default remains bottom engrave; no new engraving system and no edit under text-marking or bottom-text-marking",
        ),
        row(
            "G11",
            "R6",
            secrets.pass,
            secrets.pass
                ? "no secret, PHI, railway, vertex-web, vertex-api, or deploy path in the diff"
                : secrets.reasons.join("; "),
            "diff has no api_key, bearer token, email, phone, or patient first/last name; no railway, vertex-web, vertex-api, workflow, or prisma migration path",
        ),
        row(
            "G12",
            "R7",
            stockId.pass,
            stockId.detail,
            "SAMPLE_Top stock, no corrections, left foot STL sha256 matches BASE and the solid is watertight with heelBridgeSelfIntersections == 0",
        ),
        row(
            "G13",
            "ONE",
            oneReasons.length === 0,
            oneReasons.length ? oneReasons.join("; ") : `files ${input.files.join(", ") || "(none)"}`,
            "candidate diff is non-empty and inside the same allowlist as R3. BASE with an empty product diff passes.",
        ),
        row(
            "G14",
            "PUSH",
            pushed.pass,
            pushed.detail,
            input.label === "candidate"
                ? `HEAD == ${CANDIDATE_SHA}, branch is not main, BASE is an ancestor`
                : `HEAD == ${BASE_SHA}, branch is not main, BASE is an ancestor`,
        ),
    ];
}

export interface SyntheticProof {
    gate: string;
    noopPass: boolean;
    badDetected: boolean;
    detail: string;
}

export function syntheticProofs(): SyntheticProof[] {
    const clean = blankFoot("clean", "");
    clean.exported = true;
    clean.si = 0;
    clean.productSi = 0;
    clean.openEdges = 0;
    clean.nonManifold = 0;
    clean.watertight = true;
    clean.euler = 2;
    clean.topVertexCount = 5000;
    clean.bridgeTriangles = 12;
    clean.sha256 = "abc";
    const dirty = { ...clean, si: 4, id: "dirty" };
    const mesh = [
        "export const DEFAULT_GLB_CLOSED_BASELINE = { eulerCharacteristic: 3, heelBridgeSelfIntersections: 0 };",
        "if (si > baseline.heelBridgeSelfIntersections) {",
    ].join("\n");
    const exp = ["heelBridgeSelfIntersections: 0", "assertClosedSolidAcceptable(solid, topN, baseline)"].join(
        "\n",
    );
    const goodDiff = [
        "+ kind: reverse_mortons, side left and right",
        "+ usMenSize = 7.5",
        "+ thicknessMm: 3",
        "+ heelBridgeSelfIntersections === 0",
        "+ watertight",
    ].join("\n");
    const rows: SyntheticProof[] = [
        {
            gate: "G1",
            noopPass: defectFootOk(clean).pass,
            badDetected: !defectFootOk(dirty).pass,
            detail: "clean foot passes; si 4 fails",
        },
        {
            gate: "G2",
            noopPass: reproTestOk(goodDiff).pass,
            badDetected: !reproTestOk("+ reverse_mortons only\n").pass,
            detail: "full fixture passes; kind-only fixture fails",
        },
        {
            gate: "G3",
            noopPass: testsGreen(26, 0).pass,
            badDetected: !testsGreen(25, 1).pass,
            detail: "failed == 0 passes; one failure is detected",
        },
        {
            gate: "G4",
            noopPass: hashesMatch("abc", "abc"),
            badDetected: !hashesMatch("abc", "abd"),
            detail: "equal sha256 passes; one flipped nibble fails",
        },
        {
            gate: "G5",
            noopPass: baselineTextOk(mesh, exp).pass,
            badDetected: !baselineTextOk(
                mesh.replace("heelBridgeSelfIntersections: 0", "heelBridgeSelfIntersections: 4"),
                exp,
            ).pass,
            detail: "baseline 0 passes; a copy set to 4 fails",
        },
        {
            gate: "G6",
            noopPass: seamValuesOk(FROZEN_SEAM) && surfaceFilesOk([]).pass,
            badDetected:
                !seamValuesOk({ ...FROZEN_SEAM, limit: 9 }) &&
                !surfaceFilesOk(["vertex/shared/print-recipe/print-recipe.ts"]).pass,
            detail: "frozen seam numbers pass; limit 9 and print-recipe fail",
        },
        {
            gate: "G7",
            noopPass: bottomEngraveOk("bottom", "engrave") && textFilesOk([]).pass,
            badDetected:
                !bottomEngraveOk("wall", "emboss") &&
                !textFilesOk(["vertex/src/lib/geometry/text-marking/apply.ts"]).pass,
            detail: "bottom engrave passes; wall emboss and a text-marking edit fail",
        },
        {
            gate: "G8",
            noopPass: scopeFilesOk([]).pass && scopeFilesOk(["vertex/src/lib/geometry/elements.ts"]).pass,
            badDetected: !scopeFilesOk(["python-service/app/services/gyroid_infill.py"]).pass,
            detail: "empty diff and elements.ts pass; python-service fails",
        },
        {
            gate: "G9",
            noopPass: sampleTopOk("sample-top", "Templates/SAMPLE_Top.glb"),
            badDetected:
                !sampleTopOk("invented-mesh", "Templates/NEW.glb") &&
                !sampleTopFilesOk(["tests/fixtures/SAMPLE_Top.glb"]).pass,
            detail: "sample-top passes; a new mesh id and a replaced glb fail",
        },
        {
            gate: "G10",
            noopPass: bottomEngraveOk("bottom", "engrave"),
            badDetected:
                !bottomEngraveOk("wall", "emboss") &&
                !textFilesOk(["vertex/src/lib/geometry/new-engraving.ts"]).pass,
            detail: "bottom engrave passes; a new engraving file fails",
        },
        {
            gate: "G11",
            noopPass: secretsOk([], "").pass,
            badDetected: !secretsOk([".github/workflows/deploy.yml"], '+ api_key = "abcd"\n').pass,
            detail: "empty diff passes; a workflow path and api_key fail",
        },
        {
            gate: "G12",
            noopPass: defectFootOk(clean).pass,
            badDetected: !defectFootOk({ ...clean, watertight: false, openEdges: 2 }).pass,
            detail: "watertight stock predicate passes; openEdges 2 fails",
        },
        {
            gate: "G13",
            noopPass: scopeFilesOk(["vertex/src/lib/geometry/elements.ts"]).pass,
            badDetected: !scopeFilesOk(["vertex/src/lib/cnc/profile.ts"]).pass,
            detail: "elements.ts passes; cnc profile fails",
        },
        {
            gate: "G14",
            noopPass: pushOk({
                head: BASE_SHA,
                branch: "cursor/heel-bridge-watertight-gates-1123",
                baseIsAncestor: true,
                label: "base",
            }).pass,
            badDetected: !pushOk({ head: "abc", branch: "main", baseIsAncestor: false, label: "candidate" })
                .pass,
            detail: "pinned BASE head passes; main with a foreign sha fails",
        },
    ];
    return rows;
}
