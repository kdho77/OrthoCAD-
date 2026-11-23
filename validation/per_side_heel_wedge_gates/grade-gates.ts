// Frozen gates. Do not edit after the freeze commit.
// Thresholds were measured on BASE 268aac85 by driving the existing rearfootWedge field.
// The candidate is graded by this file as it was frozen. It is not an input to the thresholds.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "@rstest/core";
import {
    BASE_SHA,
    bilateralPostingDesign,
    bilateralWedgeDesign,
    buildCatalog,
    changedProductFiles,
    composeSide,
    DESIGN_ID,
    directRightMedialDesign,
    documentsMedialAndLateral,
    edgeFieldsMm,
    EXPECTED_WEDGE,
    expectedRiseMm,
    exportRightAgainstStock,
    FIELD_TOL_MM,
    gitText,
    isSampleTop,
    LIFT_TOL_MM,
    mcpAccepts,
    ORDER_ID,
    persistRightMedial,
    productDiffAddedLines,
    RIGHT_MEDIAL_2,
    sharedAccepts,
    stockDesign,
    stlMd5,
    toolDescriptions,
} from "./measure";

const GATES_DIR = resolve(process.cwd(), "validation/per_side_heel_wedge_gates");
const THRESHOLDS_PATH = resolve(GATES_DIR, "thresholds.json");

const SURFACE_FILES = [
    "vertex/src/lib/kiri/",
    "vertex/src/features/shape-finish/",
    "vertex/src/lib/geometry/procedural-wall/ring-seam.ts",
    "vertex/src/lib/geometry/procedural-wall/wall-spline.ts",
    "vertex/src/lib/geometry/procedural-wall/hermite.ts",
    "vertex/src/lib/geometry/procedural-wall/loft.ts",
    "vertex/src/lib/geometry/procedural-wall/reconstruct.ts",
    "vertex/src/lib/geometry/procedural-wall/metrics.ts",
    "vertex/src/lib/geometry/trimline-mesh.ts",
];

const GEOMETRY_FILES = [
    "vertex/src/lib/geometry/wedge.ts",
    "vertex/src/lib/geometry/posting-degrees.ts",
    "vertex/src/lib/geometry/height-field.ts",
    "vertex/src/lib/geometry/base-modifier.ts",
    "vertex/src/lib/geometry/procedural-wall/print-solid-compose.ts",
    "vertex/src/lib/geometry/heel-lift.ts",
];

const TEXT_FILES = ["vertex/shared/bottom-text-marking.ts", "vertex/src/lib/geometry/text-marking/"];

const DEPLOY_FILES = ["package.json", "render.yaml", "vercel.json", "vertex-web/", "vertex-api/", "railway"];

const ALLOWED_EXACT = new Set([
    "packages/mcp/src/tools/schemas.ts",
    "packages/mcp/test/persist-saved-design-snapshot.test.ts",
    "vertex/server/src/lib/saved-design-snapshot.ts",
    "vertex/server/src/lib/saved-design-snapshot.test.ts",
    "vertex/server/src/orthocad-mcp.bundled.mjs",
    "vertex/shared/saved-design-catalog.ts",
    "vertex/shared/saved-design-snapshot.ts",
    "vertex/src/lib/geometry/corrections-posting-wedge.test.ts",
]);

const EXISTING_TESTS = [
    "vertex/src/lib/geometry/corrections-posting-wedge.test.ts",
    "vertex/src/stores/posting-degree-mode.test.ts",
    "vertex/server/src/lib/saved-design-snapshot.test.ts",
    "vertex/src/lib/clinical/saved-design-snapshot.test.ts",
    "packages/mcp/test/persist-saved-design-snapshot.test.ts",
];

const SECRET_RE = /(api[_-]?key|secret|password)\s*[:=]\s*['"][^'"]{6,}/i;
const BEARER_RE = /bearer\s+[a-z0-9._-]{8,}/i;
const PHI_RE = /patient[_ ]?name['"]?\s*[:=]\s*['"][A-Za-z]{2,}/i;

interface Thresholds {
    baseSha: string;
    stockDesignSha256: string;
    bilateralWedgeDesignSha256: string;
    bilateralPostingDesignSha256: string;
    stockStlMd5: { left: string; right: string };
    bilateralWedgeStlMd5: { left: string; right: string };
    directMedial: {
        chordMm: number;
        expectedMm: number;
        medialFieldMm: number;
        lateralFieldMm: number;
        medialLiftMm: number;
        lateralLiftMm: number;
        medialV: number;
        lateralV: number;
        rightStlMd5: string;
        leftStlMd5: string;
    };
}

interface GateResult {
    id: string;
    rule: string;
    quote: string;
    pass: boolean;
    measured: string;
    threshold: string;
    command: string;
}

const results: GateResult[] = [];
const only = new Set(
    (process.env.GATE_ONLY ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
);
const skipMesh = process.env.GATE_SKIP_MESH === "1";
const skipExisting = process.env.GATE_SKIP_EXISTING === "1";

function wanted(id: string): boolean {
    return only.size === 0 || only.has(id);
}

function record(result: GateResult): void {
    results.push(result);
    console.log(`${result.pass ? "PASS" : "FAIL"} ${result.id}: ${result.measured}`);
}

function touches(files: string[], needles: string[]): string[] {
    return files.filter((file) => needles.some((needle) => file === needle || file.startsWith(needle)));
}

function near(actual: number, expected: number, tol: number): boolean {
    return Math.abs(actual - expected) <= tol;
}

function loadThresholds(): Thresholds {
    return JSON.parse(readFileSync(THRESHOLDS_PATH, "utf8")) as Thresholds;
}

describe("per-side heel wedge gates", () => {
    test("grade", async () => {
        const thresholds = loadThresholds();
        if (thresholds.baseSha !== BASE_SHA) {
            throw new Error(`thresholds base ${thresholds.baseSha} is not ${BASE_SHA}`);
        }
        const files = changedProductFiles();
        const command = `git diff --name-only ${BASE_SHA} && npx rstest run --config validation/per_side_heel_wedge_gates/rstest.config.ts`;

        if (wanted("R1")) gradeR1(files, command);
        if (wanted("R2")) gradeR2(files, command);
        if (wanted("R3")) gradeR3(files, command);
        if (wanted("R4")) gradeR4(files, command);
        if (wanted("R5")) gradeR5(files, command);
        if (wanted("R6")) gradeR6(files, command);
        if (wanted("R7") || wanted("MUST_MATCH") || wanted("TESTS_EXPORT") || wanted("ONE")) {
            await gradeBehavior(thresholds, command);
        }
        if (wanted("TESTS_EXISTING")) gradeExisting(command);

        const out = process.env.GATE_RESULTS_OUT ?? "/tmp/per-side-heel-wedge-gates-last-run.json";
        writeFileSync(out, `${JSON.stringify({ head: gitText(["rev-parse", "HEAD"]).trim(), results }, null, 2)}\n`);
    });
});

function gradeR1(files: string[], command: string): void {
    const hit = touches(files, SURFACE_FILES);
    record({
        id: "R1",
        rule: "R1",
        quote: "print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.",
        pass: hit.length === 0,
        measured: hit.length === 0 ? "0 surface/seam/layer files changed" : `changed ${hit.join(", ")}`,
        threshold: "0 files under the surface, seam, and layer-change paths",
        command,
    });
}

function gradeR2(files: string[], command: string): void {
    const hit = touches(files, SURFACE_FILES);
    record({
        id: "R2",
        rule: "R2",
        quote: "seams and layer changes must always be on the bottom (plantar/belt face).",
        pass: hit.length === 0,
        measured: hit.length === 0 ? "seam and layer placement files match BASE" : `changed ${hit.join(", ")}`,
        threshold: "0 changes to slicer, seam, loft, or layer-placement files versus BASE",
        command,
    });
}

function gradeR3(files: string[], command: string): void {
    const extra = files.filter((file) => {
        if (ALLOWED_EXACT.has(file)) return false;
        if (file.endsWith(".test.ts")) return false;
        if (file.startsWith("docs/") && file.endsWith(".md")) return false;
        if (file.startsWith("vertex/docs/") && file.endsWith(".md")) return false;
        if (file.startsWith("packages/mcp/") && file.endsWith(".md")) return false;
        return true;
    });
    record({
        id: "R3",
        rule: "R3",
        quote: "slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.",
        pass: extra.length === 0,
        measured: extra.length === 0 ? `${files.length} changed product files, all on the catalog/persist/test allowlist` : `outside scope: ${extra.join(", ")}`,
        threshold: "every changed product file is the saved-design catalog, its persist path, the MCP schema or bundle, a test, or a doc",
        command,
    });
}

function gradeR4(files: string[], command: string): void {
    const stock = stockDesign();
    const meshes = files.filter((file) => /\.(stl|glb|obj|ply)$/i.test(file));
    const sampleTop = isSampleTop(stock.design);
    record({
        id: "R4",
        rule: "R4",
        quote: "Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.",
        pass: sampleTop && meshes.length === 0,
        measured: `SAMPLE_Top asset ${stock.design.base?.assetId ?? "missing"} path ${stock.design.base?.glbPath ?? "missing"}; new mesh files ${meshes.length}`,
        threshold: `assetId sample-top, glbPath Templates/SAMPLE_Top.glb, mirrored right base, template SAMPLE_Top; 0 new mesh files`,
        command,
    });
}

function gradeR5(files: string[], command: string): void {
    const stock = stockDesign();
    const marking = stock.design.textMarking;
    const hit = touches(files, TEXT_FILES);
    const pass =
        hit.length === 0 &&
        marking?.surface === "bottom" &&
        marking.mode === "engrave" &&
        marking.addPatientName === true;
    record({
        id: "R5",
        rule: "R5",
        quote: "every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.",
        pass,
        measured: `text files changed ${hit.length}; surface ${marking?.surface ?? "missing"}; mode ${marking?.mode ?? "missing"}; addPatientName ${String(marking?.addPatientName)}`,
        threshold: "0 text-marking files changed; surface bottom; mode engrave; addPatientName true",
        command,
    });
}

function gradeR6(files: string[], command: string): void {
    const deploy = touches(files, DEPLOY_FILES);
    const added = productDiffAddedLines();
    let secretHits = 0;
    let phiHits = 0;
    for (const line of added) {
        if (SECRET_RE.test(line) || BEARER_RE.test(line)) secretHits += 1;
        if (PHI_RE.test(line)) phiHits += 1;
    }
    let merged = false;
    try {
        gitText(["merge-base", "--is-ancestor", "HEAD", "main"]);
        const head = gitText(["rev-parse", "HEAD"]).trim();
        merged = head !== BASE_SHA;
    } catch {
        merged = false;
    }
    const mainSha = gitText(["rev-parse", "main"]).trim();
    const mainUntouched = mainSha === BASE_SHA;
    const pass = deploy.length === 0 && secretHits === 0 && phiHits === 0 && !merged && mainUntouched;
    record({
        id: "R6",
        rule: "R6",
        quote: "Security: never print secrets (filter output through grep -v -i \"api_key\\|token\\|bearer\"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy.",
        pass,
        measured: `deploy/package paths ${deploy.length}; secret-like added lines ${secretHits}; patient-name added lines ${phiHits}; head merged into main ${merged}; main ${mainSha}`,
        threshold: `0 deploy paths (package.json is PR #310); 0 secret-like lines; 0 patient-name lines; HEAD is not a new commit on main; main stays ${BASE_SHA}. Design id ${DESIGN_ID}, order id ${ORDER_ID}.`,
        command,
    });
}

async function gradeBehavior(thresholds: Thresholds, command: string): Promise<void> {
    const stock = stockDesign();
    const bilateral = bilateralWedgeDesign();
    const posting = bilateralPostingDesign();
    const direct = directRightMedialDesign();
    const directFields = edgeFieldsMm(direct.design, "right");
    const directRise = expectedRiseMm(direct.design, "right");

    let stockLeftMd5 = "";
    let stockRightMd5 = "";
    let bilateralLeftMd5 = "";
    let bilateralRightMd5 = "";
    let directRightMd5 = "";
    let directLeftMd5 = "";
    let directMedialLift = Number.NaN;
    let directLateralLift = Number.NaN;
    if (!skipMesh) {
        const stockLeft = await composeSide(stock.design, "left");
        const stockRight = await composeSide(stock.design, "right");
        const bilateralLeft = await composeSide(bilateral.design, "left");
        const bilateralRight = await composeSide(bilateral.design, "right");
        const directLeft = await composeSide(direct.design, "left");
        const directMesh = await exportRightAgainstStock(direct.design, stock.design);
        stockLeftMd5 = stlMd5(stockLeft);
        stockRightMd5 = stlMd5(stockRight);
        bilateralLeftMd5 = stlMd5(bilateralLeft);
        bilateralRightMd5 = stlMd5(bilateralRight);
        directLeftMd5 = stlMd5(directLeft);
        directRightMd5 = directMesh.md5;
        directMedialLift = directMesh.medial.liftMm;
        directLateralLift = directMesh.lateral.liftMm;
        stockLeft.dispose();
        stockRight.dispose();
        bilateralLeft.dispose();
        bilateralRight.dispose();
        directLeft.dispose();
    }

    if (wanted("R7")) {
        const jsonOk = stock.sha256 === thresholds.stockDesignSha256;
        const stlOk =
            skipMesh ||
            (stockLeftMd5 === thresholds.stockStlMd5.left && stockRightMd5 === thresholds.stockStlMd5.right);
        record({
            id: "R7",
            rule: "R7",
            quote: "designs and exports not affected by your defect must produce identical output to current main (prove with a before/after comparison on at least the SAMPLE_Top stock design with no corrections).",
            pass: jsonOk && stlOk,
            measured: `stock design sha256 ${stock.sha256}; left stl ${stockLeftMd5 || "skipped"}; right stl ${stockRightMd5 || "skipped"}`,
            threshold: `sha256 ${thresholds.stockDesignSha256}; left md5 ${thresholds.stockStlMd5.left}; right md5 ${thresholds.stockStlMd5.right}`,
            command,
        });
    }

    if (wanted("MUST_MATCH")) {
        const wedgeJson = bilateral.sha256 === thresholds.bilateralWedgeDesignSha256;
        const postingJson = posting.sha256 === thresholds.bilateralPostingDesignSha256;
        const stlOk =
            skipMesh ||
            (bilateralLeftMd5 === thresholds.bilateralWedgeStlMd5.left &&
                bilateralRightMd5 === thresholds.bilateralWedgeStlMd5.right);
        const bothFeet =
            JSON.stringify(bilateral.design.corrections.left.rearfootWedge) ===
            JSON.stringify(bilateral.design.corrections.right.rearfootWedge);
        const postingBoth =
            posting.design.corrections.left.rearfootPostingDeg === 2 &&
            posting.design.corrections.right.rearfootPostingDeg === 2;
        const stockClear =
            stock.design.corrections.left.rearfootWedge === undefined &&
            stock.design.corrections.right.rearfootWedge === undefined;
        record({
            id: "MUST_MATCH",
            rule: "MUST-MATCH",
            quote: "bilateral posting and designs without wedges unchanged",
            pass: wedgeJson && postingJson && stlOk && bothFeet && postingBoth && stockClear,
            measured: `bilateral wedge sha256 ${bilateral.sha256}; posting sha256 ${posting.sha256}; bilateral stl L ${bilateralLeftMd5 || "skipped"} R ${bilateralRightMd5 || "skipped"}; both feet equal ${bothFeet}; posting deg L/R ${posting.design.corrections.left.rearfootPostingDeg}/${posting.design.corrections.right.rearfootPostingDeg}; stock wedges unset ${stockClear}`,
            threshold: `wedge sha256 ${thresholds.bilateralWedgeDesignSha256}; posting sha256 ${thresholds.bilateralPostingDesignSha256}; stl L ${thresholds.bilateralWedgeStlMd5.left} R ${thresholds.bilateralWedgeStlMd5.right}; both feet carry the same wedge; rearfootPostingDeg 2/2; stock wedges unset`,
            command,
        });
    }

    const shared = sharedAccepts(RIGHT_MEDIAL_2);
    const mcp = mcpAccepts(RIGHT_MEDIAL_2);
    const varus = sharedAccepts({
        shoe_size: { system: "US_M", size: 9 },
        rearfoot_wedge_by_side: { right: { side: "varus", value: 2, unit: "deg", degree_mode: "station" } },
    });
    let builtError = "";
    let builtRight = "";
    let builtLeft = "";
    let persisted = "";
    let catalogDesign = null as ReturnType<typeof buildCatalog> | null;
    if (shared.ok) {
        try {
            catalogDesign = buildCatalog(RIGHT_MEDIAL_2);
            builtRight = JSON.stringify(catalogDesign.design.corrections.right.rearfootWedge ?? null);
            builtLeft = JSON.stringify(catalogDesign.design.corrections.left.rearfootWedge ?? null);
            const read = await persistRightMedial();
            persisted = JSON.stringify({
                right: read.right ?? null,
                left: read.left ?? null,
                leftPostingDeg: read.leftPostingDeg,
                rightPostingDeg: read.rightPostingDeg,
            });
        } catch (error) {
            builtError = error instanceof Error ? error.message : String(error);
        }
    }
    const readbackPass =
        shared.ok &&
        mcp.ok &&
        !varus.ok &&
        builtError === "" &&
        builtRight === JSON.stringify(EXPECTED_WEDGE) &&
        builtLeft === "null" &&
        persisted.includes(`"side":"medial"`) &&
        persisted.includes(`"value":2`) &&
        persisted.includes(`"degreeMode":"station"`) &&
        persisted.includes(`"left":null`) &&
        persisted.includes(`"leftPostingDeg":0`) &&
        persisted.includes(`"rightPostingDeg":0`);

    if (wanted("TESTS_READBACK")) {
        record({
            id: "TESTS_READBACK",
            rule: "TESTS",
            quote: "right-only 2 degree medial heel wedge reads back on R only with the correct sign (medial = raises the medial side), L unchanged",
            pass: readbackPass,
            measured: `shared ${shared.ok ? "accepted" : shared.error}; mcp ${mcp.ok ? "accepted" : mcp.error}; varus rejected ${!varus.ok}; built right ${builtRight || builtError || "absent"}; built left ${builtLeft || "absent"}; persisted ${persisted || "absent"}`,
            threshold: `shared and MCP accept rearfoot_wedge_by_side.right {side medial, value 2, unit deg, degree_mode station}; varus rejected; persisted right equals ${JSON.stringify(EXPECTED_WEDGE)}; left wedge absent; both rearfootPostingDeg 0`,
            command,
        });
    }

    const docs = toolDescriptions();
    const geometryTouched = touches(changedProductFiles(), GEOMETRY_FILES);
    const newGeometry = changedProductFiles().filter(
        (file) => file.startsWith("vertex/src/lib/geometry/") && !file.endsWith(".test.ts") && !GEOMETRY_FILES.includes(file),
    );

    let exportMeasured = "catalog design was not built";
    let exportPass = false;
    let catalogRightMd5 = "";
    let catalogLeftMd5 = "";
    let catalogMedialLift = Number.NaN;
    let catalogLateralLift = Number.NaN;
    let catalogMedialField = Number.NaN;
    let catalogLateralField = Number.NaN;
    if (catalogDesign && !skipMesh) {
        const mesh = await exportRightAgainstStock(catalogDesign.design, stock.design);
        const left = await composeSide(catalogDesign.design, "left");
        catalogRightMd5 = mesh.md5;
        catalogLeftMd5 = stlMd5(left);
        catalogMedialLift = mesh.medial.liftMm;
        catalogLateralLift = mesh.lateral.liftMm;
        const fields = edgeFieldsMm(catalogDesign.design, "right");
        catalogMedialField = fields.medialMm;
        catalogLateralField = fields.lateralMm;
        left.dispose();
        const fieldOk =
            near(catalogMedialField, directRise.expectedMm, FIELD_TOL_MM) &&
            catalogLateralField <= FIELD_TOL_MM &&
            catalogMedialField > catalogLateralField;
        const liftOk =
            near(catalogMedialLift, thresholds.directMedial.medialLiftMm, LIFT_TOL_MM) &&
            near(catalogLateralLift, thresholds.directMedial.lateralLiftMm, LIFT_TOL_MM) &&
            mesh.medial.v < -0.5 &&
            mesh.lateral.v > 0.5 &&
            catalogMedialLift > catalogLateralLift;
        const stlOk =
            catalogRightMd5 === thresholds.directMedial.rightStlMd5 &&
            catalogLeftMd5 === thresholds.stockStlMd5.left;
        exportPass = fieldOk && liftOk && stlOk;
        exportMeasured = `medial field ${catalogMedialField.toFixed(4)} mm; lateral field ${catalogLateralField.toFixed(4)} mm; expected ${directRise.expectedMm.toFixed(4)} mm from chord ${directRise.chordMm.toFixed(4)} * tan(2°); medial lift ${catalogMedialLift.toFixed(4)} mm at v ${mesh.medial.v.toFixed(4)}; lateral lift ${catalogLateralLift.toFixed(4)} mm at v ${mesh.lateral.v.toFixed(4)}; right stl ${catalogRightMd5}; left stl ${catalogLeftMd5}`;
    } else if (skipMesh) {
        exportMeasured = "mesh comparison skipped";
    }

    if (wanted("TESTS_EXPORT")) {
        record({
            id: "TESTS_EXPORT",
            rule: "TESTS",
            quote: "export geometry shows the medial heel raised by the expected amount for 2 degrees",
            pass: exportPass,
            measured: exportMeasured,
            threshold: `medial field within ${FIELD_TOL_MM} mm of heelChord*tan(2°); lateral field <= ${FIELD_TOL_MM} mm; medial lift within ${LIFT_TOL_MM} mm of frozen ${thresholds.directMedial.medialLiftMm} mm; lateral lift within ${LIFT_TOL_MM} mm of frozen ${thresholds.directMedial.lateralLiftMm} mm; medial v < -0.5; lateral v > 0.5; right stl ${thresholds.directMedial.rightStlMd5}; left stl equals stock ${thresholds.stockStlMd5.left}`,
            command,
        });
    }

    if (wanted("ONE")) {
        const described =
            documentsMedialAndLateral(docs.persist) &&
            documentsMedialAndLateral(docs.create) &&
            docs.bundle.includes("rearfoot_wedge_by_side") &&
            /raises the medial/i.test(docs.bundle) &&
            /raises the lateral/i.test(docs.bundle);
        const sameGeometry =
            !skipMesh &&
            directRightMd5 === thresholds.directMedial.rightStlMd5 &&
            near(directFields.medialMm, thresholds.directMedial.medialFieldMm, FIELD_TOL_MM) &&
            near(directMedialLift, thresholds.directMedial.medialLiftMm, LIFT_TOL_MM) &&
            directLeftMd5 === thresholds.directMedial.leftStlMd5;
        const exposed = readbackPass && exportPass;
        const pass = geometryTouched.length === 0 && newGeometry.length === 0 && described && sameGeometry && exposed;
        record({
            id: "ONE",
            rule: "ONE",
            quote: "Let a production design carry a heel wedge on one side only, in degrees, with an unambiguous medial/lateral sign, using the existing heel posting/wedge geometry (no new construction). If the existing geometry already supports per-side wedges, only expose and document it; if it needs new geometry, STOP and report.",
            pass,
            measured: `geometry files changed ${geometryTouched.length}; new geometry files ${newGeometry.length}; documented ${described}; existing right medial field ${directFields.medialMm.toFixed(4)} mm vs chord*tan(2°) ${directRise.expectedMm.toFixed(4)} mm; existing right stl ${directRightMd5 || "skipped"}; catalog exposed ${exposed}`,
            threshold: `0 changes to wedge.ts, posting-degrees.ts, height-field.ts, base-modifier.ts, print-solid-compose.ts, heel-lift.ts; 0 new geometry modules; persist and create descriptions and the MCP bundle say rearfoot_wedge_by_side raises the medial heel and raises the lateral heel; existing-field right STL stays ${thresholds.directMedial.rightStlMd5}; catalog readback and export gates pass`,
            command,
        });
    }
}

function gradeExisting(command: string): void {
    if (skipExisting) {
        record({
            id: "TESTS_EXISTING",
            rule: "TESTS",
            quote: "existing tests green",
            pass: false,
            measured: "skipped",
            threshold: "exit 0 from the posting, wedge, saved-design, and MCP persist tests that already exist on BASE",
            command,
        });
        return;
    }
    const args = ["rstest", "run", "--maxConcurrency", "1", ...EXISTING_TESTS];
    let status = 1;
    let tail = "";
    try {
        const out = execFileSync("npx", args, {
            cwd: process.cwd(),
            encoding: "utf8",
            timeout: 20 * 60 * 1000,
            env: { ...process.env, GATE_CAPTURE: "", GATE_ONLY: "", GATE_SKIP_MESH: "", GATE_SKIP_EXISTING: "" },
        });
        status = 0;
        tail = out.split("\n").slice(-30).join("\n");
    } catch (error) {
        const failed = error as { status?: number; stdout?: string; stderr?: string };
        status = failed.status ?? 1;
        tail = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`.split("\n").slice(-40).join("\n");
    }
    record({
        id: "TESTS_EXISTING",
        rule: "TESTS",
        quote: "existing tests green",
        pass: status === 0,
        measured: `exit ${status}; ${tail.replace(/\s+/g, " ").slice(-500)}`,
        threshold: "exit 0. Files: corrections-posting-wedge, posting-degree-mode, server and clinical saved-design-snapshot, mcp persist-saved-design-snapshot. Failed tests = 0.",
        command: `npx ${args.join(" ")}`,
    });
}
