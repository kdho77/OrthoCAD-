// FROZEN runner. Loads the product at the worktree SHA and scores G1–G14.
// Judges live in check.ts. This file does not retune them.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "@rstest/core";
import {
    BASE_SHA,
    baselineTextOk,
    blankFoot,
    bottomEngraveOk,
    type DesignSpec,
    defectDesignOk,
    defectFootOk,
    EXISTING_TEST_COMMAND,
    type FootMeasure,
    type GateLabel,
    type GradeInput,
    sampleTopOk,
    scoreGates,
    seamValuesOk,
    surfaceFilesOk,
    syntheticProofs,
    testsGreen,
} from "./check.ts";
import { frozenHeelBridge, frozenManifold } from "./frozen_mesh.ts";

const MESH_CLOSE = "vertex/src/lib/geometry/mesh-close.ts";
const EXPORT_GEOMETRY = "vertex/src/lib/geometry/export-geometry.ts";

function redact(text: string): string {
    return text
        .replace(/bearer\s+\S+/gi, "bearer [redacted]")
        .replace(/(api[_-]?key|token)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .replace(/\s+/g, " ")
        .slice(0, 500);
}

function sha256(bytes: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function md5(bytes: ArrayBuffer): string {
    return createHash("md5").update(Buffer.from(bytes)).digest("hex");
}

function git(args: string): string {
    return execSync(`git ${args}`, { encoding: "utf8" }).trim();
}

function labelOf(): GateLabel {
    return process.env.HEEL_GATE_LABEL === "candidate" ? "candidate" : "base";
}

function workerDiff(): { files: string[]; text: string } {
    if (labelOf() !== "candidate") return { files: [], text: "" };
    const text = execSync(`git diff -U3 ${BASE_SHA} HEAD`, { encoding: "utf8", maxBuffer: 40_000_000 });
    const files = execSync(`git diff --name-only ${BASE_SHA} HEAD`, { encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("validation/heel_bridge_watertight_gates/"));
    return { files, text };
}

function installFetch(): void {
    const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (/SAMPLE_Top\.glb/i.test(url) || url.includes("Templates/")) {
            return new Response(bytes);
        }
        throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
}

async function primeSample(): Promise<void> {
    const preview = await import("@/lib/geometry/procedural-wall/sample-top-preview");
    const cache = await import("@/lib/geometry/procedural-wall/manufacturing-solid-cache");
    const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    cache.resetManufacturingSolidCache();
    preview.resetSampleTopGeometryCache();
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const native = await preview.sampleTopFromArrayBuffer(copy);
    preview.primeSampleTopGeometry(native);
}

async function loadStores() {
    const store = await import("@/stores/design-store");
    const bottom = await import("@/stores/bottom-pattern-store");
    const edits = await import("@/stores/mesh-edit-store");
    const shoe = await import("@/lib/geometry/shoe-size");
    return { store, bottom, edits, shoe };
}

function readSpec(
    design: {
        usMenSize: number;
        shoeWidth: string;
        thicknessMm: number;
        method: string;
        pattern: string;
        paired?: {
            leftThicknessMm: number;
            rightThicknessMm: number;
            leftBase?: { assetId?: string; glbPath?: string };
            rightBase?: { assetId?: string };
        };
        base?: { assetId?: string; glbPath?: string };
        elements: Array<{ kind: string; side: string; heightMm: number }>;
    },
    correctionsUnchanged: boolean,
    notice: string | null,
): DesignSpec {
    const base = design.paired?.leftBase ?? design.base;
    return {
        usMenSize: design.usMenSize,
        shoeWidth: design.shoeWidth,
        thicknessMm: design.thicknessMm,
        leftThicknessMm: design.paired?.leftThicknessMm ?? design.thicknessMm,
        rightThicknessMm: design.paired?.rightThicknessMm ?? design.thicknessMm,
        method: design.method,
        pattern: design.pattern,
        elements: design.elements.map((el) => ({ kind: el.kind, side: el.side, heightMm: el.heightMm })),
        correctionsUnchanged,
        assetId: base?.assetId ?? "",
        glbPath: base?.glbPath ?? "",
        notice,
    };
}

async function buildCase(kind: "stock" | "control" | "defect"): Promise<DesignSpec> {
    await primeSample();
    const { store, bottom, edits, shoe } = await loadStores();
    bottom.useBottomPatternStore.getState().clear();
    edits.useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    const design = store.createDesignWithStockPlaceholder();
    design.elements = [];
    design.textMarking = undefined;
    design.method = "printing_solid";
    design.pattern = "full_contact";
    design.shoeWidth = "medium";
    design.shoeWidthBySide = { left: "medium", right: "medium" };
    if (kind !== "stock") {
        design.sizeSystem = "us";
        design.usMenSize = 7.5;
        design.footLengthMm = shoe.insoleLayoutForUsMenSize(7.5).footLengthMm;
        design.thicknessMm = 3;
        design.shellThicknessMode = "zonal";
        if (design.paired) {
            design.paired.leftThicknessMm = 3;
            design.paired.rightThicknessMm = 3;
            design.paired.leftMethod = "printing_solid";
            design.paired.rightMethod = "printing_solid";
        }
    }
    const correctionsBefore = JSON.stringify(design.corrections);
    const viewer = store.useDesignStore.getState().viewer;
    store.useDesignStore.setState({
        design,
        viewer: { ...viewer, wallModel: "procedural" },
        elementNotice: null,
    });
    if (kind === "defect") {
        store.useDesignStore.getState().addElement("reverse_mortons", "left");
        store.useDesignStore.getState().addElement("reverse_mortons", "right");
    }
    const state = store.useDesignStore.getState();
    const notice = state.elementNotice ? String(state.elementNotice) : null;
    const correctionsUnchanged = JSON.stringify(state.design.corrections) === correctionsBefore;
    return readSpec(state.design, correctionsUnchanged, notice);
}

async function exportSide(caseId: string, side: "left" | "right"): Promise<FootMeasure> {
    const started = Date.now();
    console.log(`[gate] export ${caseId} ${side}`);
    const row = blankFoot(`${caseId}-${side}`, "");
    row.error = null;
    try {
        const exp = await import("@/lib/geometry/export-geometry");
        const close = await import("@/lib/geometry/mesh-close");
        const stl = await import("@/lib/geometry/stl");
        const geometry = await exp.buildValidatedExportGeometry(side);
        try {
            const topN = Number((geometry.userData as { topVertexCount?: number }).topVertexCount ?? 0);
            const frozen = frozenHeelBridge(geometry, topN);
            const manifold = frozenManifold(geometry);
            const product = close.validateManifold(geometry);
            const bytes = stl.geometryToBinarySTL(geometry);
            row.exported = true;
            row.si = frozen.heelBridgeSelfIntersections;
            row.productSi = close.countHeelBridgeSelfIntersections(geometry, topN);
            row.bridgeTriangles = frozen.bridgeTriangles;
            row.openEdges = manifold.openEdges;
            row.nonManifold = manifold.nonManifoldEdges;
            row.watertight = manifold.isWatertight;
            row.euler = manifold.eulerCharacteristic;
            row.productEuler = product.eulerCharacteristic;
            row.topVertexCount = topN;
            row.triangles = manifold.triangleCount;
            row.sha256 = sha256(bytes);
            row.md5 = md5(bytes);
            row.baselineSeen = 0;
        } finally {
            geometry.dispose();
        }
    } catch (error) {
        row.exported = false;
        const message = error instanceof Error ? error.message : String(error);
        row.error = redact(message);
        const report = (
            error as {
                report?: {
                    openEdges?: number;
                    nonManifoldEdges?: number;
                    isWatertight?: boolean;
                    eulerCharacteristic?: number;
                };
            }
        ).report;
        if (report) {
            row.openEdges = report.openEdges ?? null;
            row.nonManifold = report.nonManifoldEdges ?? null;
            row.watertight = report.isWatertight ?? null;
            row.euler = report.eulerCharacteristic ?? null;
            row.productEuler = report.eulerCharacteristic ?? null;
        }
        const si = /heelBridgeSelfIntersections=(\d+)/.exec(message);
        if (si) {
            row.si = Number(si[1]);
            row.productSi = Number(si[1]);
        }
        const baseline = /exceeds baseline (\d+)/.exec(message);
        row.baselineSeen = baseline ? Number(baseline[1]) : null;
    }
    console.log(
        `[gate] ${caseId} ${side} exported=${row.exported} si=${row.si} productSi=${row.productSi} ` +
            `open=${row.openEdges} watertight=${row.watertight} euler=${row.euler} topN=${row.topVertexCount} ` +
            `sha=${row.sha256?.slice(0, 12) ?? "-"} ${(Date.now() - started) / 1000}s`,
    );
    return row;
}

function runExistingTests(): { passed: number; failed: number; exitCode: number; tail: string } {
    console.log(`[gate] ${EXISTING_TEST_COMMAND}`);
    let exitCode = 0;
    let output = "";
    try {
        output = execSync(EXISTING_TEST_COMMAND, {
            encoding: "utf8",
            maxBuffer: 30_000_000,
            timeout: 300_000,
        });
    } catch (error) {
        const err = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
        exitCode = err.status ?? 1;
        output = `${err.stdout?.toString() ?? ""}\n${err.stderr?.toString() ?? ""}`;
    }
    const passed = Number(
        /"passedTests":\s*(\d+)/.exec(output)?.[1] ?? /Tests\s+(\d+)\s+passed/.exec(output)?.[1] ?? 0,
    );
    const failed = Number(
        /"failedTests":\s*(\d+)/.exec(output)?.[1] ??
            /Tests\s+(\d+)\s+failed/.exec(output)?.[1] ??
            (exitCode === 0 ? 0 : 1),
    );
    const tail = redact(
        /"counts":\s*\{[^}]+\}/.exec(output)?.[0] ?? output.split("\n").slice(-12).join("\n"),
    );
    console.log(`[gate] existing tests passed=${passed} failed=${failed} exit=${exitCode}`);
    return { passed, failed, exitCode, tail };
}

function brokenTestDetected(): { detected: boolean; detail: string } {
    const dir = resolve("validation/heel_bridge_watertight_gates/.proof-bad");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const testFile = resolve(dir, "broken.test.ts");
    const configFile = resolve(dir, "rstest.config.ts");
    writeFileSync(
        testFile,
        `import { expect, test } from "@rstest/core";
test("deliberately broken copy", () => {
    expect(1).toBe(0);
});
`,
    );
    writeFileSync(
        configFile,
        `import { defineConfig } from "@rstest/core";
export default defineConfig({
    include: [${JSON.stringify(testFile)}],
    testEnvironment: "node",
    testTimeout: 30_000,
});
`,
    );
    let output = "";
    let code = 0;
    try {
        output = execSync(`node_modules/.bin/rstest run --config ${configFile}`, {
            encoding: "utf8",
            timeout: 180_000,
        });
    } catch (error) {
        const err = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
        code = err.status ?? 1;
        output = `${err.stdout?.toString() ?? ""}\n${err.stderr?.toString() ?? ""}`;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
    const failedTests = Number(/"failedTests":\s*(\d+)/.exec(output)?.[1] ?? 0);
    return {
        detected: code !== 0 && failedTests >= 1,
        detail: `broken test exit ${code} failedTests=${failedTests}`,
    };
}

function readBaseline(): { pass: boolean; reasons: string[] } {
    return baselineTextOk(readFileSync(MESH_CLOSE, "utf8"), readFileSync(EXPORT_GEOMETRY, "utf8"));
}

async function readSeam(): Promise<{ limit: number; fallback: number; slack: number; spline: number }> {
    const bezier = await import("@/lib/geometry/procedural-wall/bezier-column");
    const spline = await import("@/lib/geometry/procedural-wall/wall-spline");
    return {
        limit: bezier.SEAM_B_LIMIT_DEG,
        fallback: bezier.SEAM_B_FALLBACK_DEG,
        slack: bezier.SEAM_B_SLACK_DEG,
        spline: spline.SPLINE_SEAM_B_MAX_DEG,
    };
}

async function readText(): Promise<{ surface: string; mode: string }> {
    const text = await import("@/lib/geometry/text-marking/constants");
    const marking = text.defaultTextMarking();
    return { surface: marking.surface, mode: marking.mode };
}

function ancestor(): boolean {
    try {
        execSync(`git merge-base --is-ancestor ${BASE_SHA} HEAD`, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

test(
    "heel bridge watertight gates",
    async () => {
        const mode = process.env.HEEL_GATE_MODE ?? "grade";
        const outPath = process.env.HEEL_GATE_OUT;
        if (!outPath) throw new Error("HEEL_GATE_OUT is required");
        installFetch();
        if (mode === "proof") {
            const proof = await runProof();
            writeFileSync(outPath, `${JSON.stringify(proof, null, 2)}\n`);
            if (!proof.pass) throw new Error(`proof failed: ${proof.failures.join("; ")}`);
            return;
        }
        const grade = await runGrade();
        writeFileSync(outPath, `${JSON.stringify(grade, null, 2)}\n`);
    },
    40 * 60 * 1000,
);

async function runProof(): Promise<{
    pass: boolean;
    failures: string[];
    synthetic: ReturnType<typeof syntheticProofs>;
    live: Record<string, unknown>;
    broken: Record<string, unknown>;
}> {
    const failures: string[] = [];
    const synthetic = syntheticProofs();
    for (const row of synthetic) {
        if (!row.noopPass) failures.push(`${row.gate} noop did not pass (${row.detail})`);
        if (!row.badDetected) failures.push(`${row.gate} bad copy was not detected (${row.detail})`);
    }
    const baseline = readBaseline();
    if (!baseline.pass) failures.push(`live baseline source failed: ${baseline.reasons.join("; ")}`);
    const brokenBaseline = baselineTextOk(
        readFileSync(MESH_CLOSE, "utf8").replaceAll(
            "heelBridgeSelfIntersections: 0",
            "heelBridgeSelfIntersections: 4",
        ),
        readFileSync(EXPORT_GEOMETRY, "utf8"),
    );
    if (brokenBaseline.pass) failures.push("broken mesh-close copy with baseline 4 was accepted");
    const seam = await readSeam();
    if (!seamValuesOk(seam)) failures.push(`live seam constants drifted ${JSON.stringify(seam)}`);
    if (surfaceFilesOk(["vertex/src/lib/geometry/procedural-wall/reconstruct.ts"]).pass) {
        failures.push("reconstruct.ts copy was allowed");
    }
    const text = await readText();
    if (!bottomEngraveOk(text.surface, text.mode)) {
        failures.push(`live text is ${text.surface} ${text.mode}`);
    }
    const spec = await buildCase("stock");
    if (!sampleTopOk(spec.assetId, spec.glbPath)) {
        failures.push(`live stock base ${spec.assetId} ${spec.glbPath}`);
    }
    if (spec.usMenSize !== 9 || spec.thicknessMm !== 2 || spec.leftThicknessMm !== 2) {
        failures.push(
            `stock spec is not the default anchor us=${spec.usMenSize} thickness=${spec.thicknessMm}/${spec.leftThicknessMm}`,
        );
    }
    const stock = await exportSide("stock", "left");
    const stockJudge = defectFootOk(stock);
    if (!stockJudge.pass) failures.push(`live stock export is not the no-op anchor: ${stockJudge.detail}`);
    const dirty = { ...stock, si: 4, id: "stock-broken-copy" };
    if (defectFootOk(dirty).pass) failures.push("broken stock measurement with si 4 was accepted");
    const existing = runExistingTests();
    const existingJudge = testsGreen(existing.passed, existing.failed);
    if (!existingJudge.pass) failures.push(`live existing tests: ${existingJudge.detail}; ${existing.tail}`);
    const broken = brokenTestDetected();
    if (!broken.detected) failures.push(broken.detail);
    return {
        pass: failures.length === 0,
        failures,
        synthetic,
        live: {
            baseline,
            seam,
            text,
            assetId: spec.assetId,
            glbPath: spec.glbPath,
            stock,
            existing,
        },
        broken: {
            baselineRejected: !brokenBaseline.pass,
            stockSi4Rejected: !defectFootOk(dirty).pass,
            brokenTest: broken,
        },
    };
}

async function runGrade(): Promise<Record<string, unknown>> {
    const label = labelOf();
    const head = git("rev-parse HEAD");
    const branch = git("rev-parse --abbrev-ref HEAD");
    const diff = workerDiff();
    const seam = await readSeam();
    const text = await readText();
    const stockSpec = await buildCase("stock");
    const stock = await exportSide("stock", "left");
    const controlSpec = await buildCase("control");
    const control = await exportSide("control", "left");
    const defectSpec = await buildCase("defect");
    const designSpec = defectDesignOk(defectSpec);
    let left = blankFoot("defect-left", "design spec failed");
    let right = blankFoot("defect-right", "design spec failed");
    if (designSpec.pass) {
        left = await exportSide("defect", "left");
        right = await exportSide("defect", "right");
    }
    const existing = runExistingTests();
    const baseRaw = process.env.HEEL_GATE_BASE_JSON
        ? (JSON.parse(readFileSync(process.env.HEEL_GATE_BASE_JSON, "utf8")) as {
              stock?: FootMeasure;
              control?: FootMeasure;
          })
        : null;
    const baseStockAnchor = Boolean(baseRaw?.stock && defectFootOk(baseRaw.stock).pass);
    const baseControlAnchor = Boolean(baseRaw?.control && defectFootOk(baseRaw.control).pass);
    const input: GradeInput = {
        label,
        head,
        branch,
        baseIsAncestor: ancestor(),
        files: diff.files,
        diff: diff.text,
        designSpec,
        left,
        right,
        stock,
        control,
        baseStockHash: baseRaw?.stock?.sha256 ?? null,
        baseControlHash: baseRaw?.control?.sha256 ?? null,
        baseStockAnchor,
        baseControlAnchor,
        baseline: readBaseline(),
        seam,
        textSurface: text.surface,
        textMode: text.mode,
        assetId: defectSpec.assetId,
        glbPath: defectSpec.glbPath,
        existingPassed: existing.passed,
        existingFailed: existing.failed,
    };
    const gates = scoreGates(input);
    for (const gate of gates) console.log(`[gate] ${gate.id} ${gate.pass ? "PASS" : "FAIL"}`);
    return {
        schema: 1,
        label,
        sha: head,
        branch,
        baseSha: BASE_SHA,
        files: diff.files,
        gates,
        designSpec,
        stockSpec: {
            assetId: stockSpec.assetId,
            glbPath: stockSpec.glbPath,
            thicknessMm: stockSpec.thicknessMm,
            usMenSize: stockSpec.usMenSize,
        },
        controlSpec: {
            thicknessMm: controlSpec.thicknessMm,
            usMenSize: controlSpec.usMenSize,
            shoeWidth: controlSpec.shoeWidth,
        },
        stock,
        control,
        left,
        right,
        existing,
        seam,
        text,
    };
}
