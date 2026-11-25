// Independent grader for PR #454. Not part of the product suite.
// Compares off-thread STL bytes to the in-process loft on this tree, which is
// main's loft when the export sources match 3cfcff55.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { defaultElementPose } from "@/lib/geometry/elements";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState, PlacedElement, Side } from "@/types";
import { SYNTHETIC_NAME } from "../../tests/name-plantar-e2e/thresholds.ts";
import { storedManufacturingStlReusable } from "../../vertex/server/src/lib/cad-operator-production.ts";
import { buildHeadlessFinalizedFoot } from "../../vertex/server/src/lib/finalized-mesh-runner.ts";
import { envelopeWithLoftTextMarking } from "../../vertex/server/src/lib/integration-text-marking.ts";
import {
    buildHeadlessFinalizedFootOffThread,
    LOFT_WORKER_LIMIT,
    loftWorkerFileUrl,
    loftWorkerPeak,
    resetLoftWorkerPeak,
} from "../../vertex/server/src/lib/loft-worker-pool.ts";
import { composeMarkingTextForSide } from "../../vertex/shared/bottom-text-marking.ts";
import { type DesignSettingsEnvelope, designSettingsEnvelope } from "../../vertex/shared/design-settings.ts";
import { selectVertexSliceUpload } from "../../vertex/shared/vertexslice-regional-3mf.ts";

const MAIN = "3cfcff559d9839fd36637e4db48eb07471a6b917";
const SHA = "6f54ab84ff457dbcf70976cfaa14b327d1bae759";
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const OUT = fileURLToPath(new URL("./results/loft-report.json", import.meta.url));

const failures: string[] = [];

function fail(message: string): void {
    failures.push(message);
    console.error(`[grader] FAIL ${message}`);
}

function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function git(args: string[]): string {
    return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

interface FootCase {
    id: string;
    side: Side;
    named: boolean;
    settingsJson: unknown;
    composedText: string;
}

function baseDesign(): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.corrections = { ...design.corrections, linked: true };
    return design;
}

function withName(design: DesignState, mode: "extra-line" | "patient-name"): DesignState {
    const marking = { ...defaultTextMarking("bottom"), feet: "both" as const, mode: "engrave" as const };
    if (mode === "extra-line") {
        design.textMarking = { ...marking, text: SYNTHETIC_NAME, addPatientName: false };
    } else {
        design.textMarking = { ...marking, text: "", addPatientName: true };
    }
    return design;
}

function envelope(design: DesignState, side: Side, patientName: string | null): DesignSettingsEnvelope {
    const raw = designSettingsEnvelope(design as unknown as Record<string, unknown>);
    if (!patientName) return raw;
    return envelopeWithLoftTextMarking(raw, patientName, side);
}

function mediumPair(mode: "extra-line" | "patient-name"): DesignState {
    const design = withName(baseDesign(), mode);
    design.shoeWidth = "medium";
    return design;
}

function narrowM6(side: Side): DesignState {
    const design = withName(baseDesign(), "patient-name");
    design.usMenSize = 6;
    design.shoeWidth = "narrow";
    design.shoeWidthBySide = { left: "narrow", right: "narrow" };
    const patch = { heelCupHeightMm: 9 };
    design.corrections = {
        ...design.corrections,
        linked: true,
        left: { ...design.corrections.left, ...patch },
        right: { ...design.corrections.right, ...patch },
    };
    const layout = insoleLayoutFromDesign(design);
    const pose = defaultElementPose("met_pad", side, layout.lengthMm, layout.widthMm);
    const element: PlacedElement = {
        id: side === "left" ? "grader-met-left" : "grader-met-right",
        kind: "met_pad",
        side,
        position: pose.position,
        rotationDeg: pose.rotationDeg,
        scale: pose.scale,
        heightMm: pose.heightMm,
        ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
    };
    design.elements = [element];
    return design;
}

function footCase(id: string, design: DesignState, side: Side, named: boolean): FootCase {
    const marking = design.textMarking;
    const composedText = marking
        ? composeMarkingTextForSide(marking, side, named ? SYNTHETIC_NAME : null)
        : "";
    return {
        id,
        side,
        named,
        composedText,
        settingsJson: envelope(design, side, named ? SYNTHETIC_NAME : null),
    };
}

interface LoftBytes {
    bytes: Uint8Array;
    fingerprint: string;
    solidTriangles: number;
    uploadTriangles: number;
    threadHint: number | null;
}

interface StartMark {
    side: string;
    threadId: number;
    at: number;
}

function hookStarts(): { marks: StartMark[]; restore: () => void } {
    const marks: StartMark[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((
        chunk: string | Uint8Array,
        encoding?: BufferEncoding,
        cb?: (err?: Error) => void,
    ) => {
        const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        for (const line of text.split("\n")) {
            if (!line.includes("cad-operator-loft-start")) continue;
            try {
                const parsed = JSON.parse(line) as { side?: string; threadId?: number };
                if (parsed.side && typeof parsed.threadId === "number") {
                    marks.push({ side: parsed.side, threadId: parsed.threadId, at: performance.now() });
                }
            } catch {
                // Non-JSON loft logs are ignored.
            }
        }
        return orig(chunk, encoding as BufferEncoding, cb);
    }) as typeof process.stdout.write;
    return {
        marks,
        restore: () => {
            process.stdout.write = orig;
        },
    };
}

async function workerLoft(foot: FootCase): Promise<LoftBytes> {
    const mesh = await buildHeadlessFinalizedFootOffThread({
        settingsJson: foot.settingsJson,
        side: foot.side,
        includeLeader: true,
    });
    return {
        bytes: new Uint8Array(mesh.stl),
        fingerprint: mesh.fingerprint,
        solidTriangles: mesh.solidTriangles,
        uploadTriangles: mesh.uploadTriangles,
        threadHint: null,
    };
}

async function processLoft(foot: FootCase): Promise<LoftBytes> {
    const mesh = await buildHeadlessFinalizedFoot({
        settingsJson: foot.settingsJson,
        side: foot.side,
        includeLeader: true,
    });
    return {
        bytes: new Uint8Array(mesh.stl),
        fingerprint: mesh.fingerprint,
        solidTriangles: mesh.solidTriangles,
        uploadTriangles: mesh.uploadTriangles,
        threadHint: null,
    };
}

function rssMb(): number {
    return process.memoryUsage().rss / (1024 * 1024);
}

async function occupyPair(
    left: FootCase,
    right: FootCase,
): Promise<{
    left: LoftBytes;
    right: LoftBytes;
    polls: number[];
    maxRssMb: number;
    starts: StartMark[];
    leftDoneMs: number;
    rightDoneMs: number;
}> {
    resetLoftWorkerPeak();
    const hook = hookStarts();
    const gaps: number[] = [];
    let last = performance.now();
    let maxRss = rssMb();
    let polling = true;
    const timer = setInterval(() => {
        if (!polling) return;
        const now = performance.now();
        gaps.push(now - last);
        last = now;
        maxRss = Math.max(maxRss, rssMb());
    }, 20);
    const origin = performance.now();
    let leftDoneMs = 0;
    let rightDoneMs = 0;
    try {
        const [leftMesh, rightMesh] = await Promise.all([
            workerLoft(left).then((mesh) => {
                leftDoneMs = performance.now() - origin;
                return mesh;
            }),
            workerLoft(right).then((mesh) => {
                rightDoneMs = performance.now() - origin;
                return mesh;
            }),
        ]);
        polling = false;
        const starts = hook.marks
            .filter((mark) => mark.at >= origin - 5)
            .map((mark) => ({ ...mark, at: mark.at - origin }));
        return {
            left: leftMesh,
            right: rightMesh,
            polls: gaps,
            maxRssMb: maxRss,
            starts,
            leftDoneMs,
            rightDoneMs,
        };
    } finally {
        polling = false;
        clearInterval(timer);
        hook.restore();
    }
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index] ?? Number.NaN;
}

async function missingWorkerFailsLoud(): Promise<{ threw: boolean; elapsedMs: number; message: string }> {
    const path = fileURLToPath(loftWorkerFileUrl());
    const hidden = `${path}.grader-hidden`;
    const started = performance.now();
    renameSync(path, hidden);
    try {
        await buildHeadlessFinalizedFootOffThread({
            settingsJson: { schemaVersion: 1, settings: {} },
            side: "left",
            includeLeader: true,
        });
        return { threw: false, elapsedMs: performance.now() - started, message: "" };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { threw: true, elapsedMs: performance.now() - started, message };
    } finally {
        renameSync(hidden, path);
    }
}

function sourceIdentity(): {
    runnerMatchesMain: boolean;
    bundleScriptMatchesMain: boolean;
    exportSourceMatchesMain: boolean;
    changedFiles: string[];
} {
    const changed = git(["diff", "--name-only", MAIN, SHA]).split("\n").filter(Boolean);
    const same = (file: string) =>
        git(["rev-parse", `${MAIN}:${file}`]) === git(["rev-parse", `${SHA}:${file}`]);
    return {
        runnerMatchesMain: same("vertex/server/src/lib/finalized-mesh-runner.ts"),
        bundleScriptMatchesMain: same("vertex/scripts/bundle-canonical-export-loft.mjs"),
        exportSourceMatchesMain: same("vertex/src/features/exports/saved-design-finalized-mesh.ts"),
        changedFiles: changed,
    };
}

function reusableStillFalse(): boolean {
    const samples: Array<Parameters<typeof storedManufacturingStlReusable>> = [
        [],
        [null, null],
        [null, { stlIdentity: "same" }],
        [
            {
                v: 1,
                jobId: "job",
                acceptedAt: "2026-11-25T00:00:00.000Z",
                stlStorageKey: "tmp/stored.stl",
                meshFingerprint: "mesh",
                expectedRegionCount: 0,
                credentialId: "cred",
                serverStartedAt: null,
                stlIdentity: "same",
            },
            { stlIdentity: "same" },
        ],
    ];
    return samples.every((args) => storedManufacturingStlReusable(...args) === false);
}

interface FootReport {
    id: string;
    side: Side;
    named: boolean;
    composedText: string;
    equal: boolean;
    headerOnlyDifference: boolean;
    sha256: string;
    workerSha256: string;
    bytes: number;
    solidTriangles: number;
    uploadTriangles: number;
    fingerprintEqual: boolean;
    sliceModelEqualsStl: boolean;
    nameAsciiInStl: boolean;
}

function compareFoot(foot: FootCase, worker: LoftBytes, solo: LoftBytes): FootReport {
    const workerBytes = Buffer.from(worker.bytes);
    const soloBytes = Buffer.from(solo.bytes);
    const equal = workerBytes.equals(soloBytes);
    const headerOnly =
        !equal &&
        workerBytes.length === soloBytes.length &&
        workerBytes.subarray(80).equals(soloBytes.subarray(80));
    const upload = selectVertexSliceUpload({
        stl: soloBytes,
        stlFilename: `${foot.side}.stl`,
        regional3mf: null,
        regional3mfEnabled: false,
    });
    const uploadBytes = Buffer.from(upload.bytes);
    return {
        id: foot.id,
        side: foot.side,
        named: foot.named,
        composedText: foot.composedText,
        equal,
        headerOnlyDifference: headerOnly,
        sha256: sha256(soloBytes),
        workerSha256: sha256(workerBytes),
        bytes: soloBytes.length,
        solidTriangles: solo.solidTriangles,
        uploadTriangles: solo.uploadTriangles,
        fingerprintEqual: solo.fingerprint === worker.fingerprint,
        sliceModelEqualsStl: uploadBytes.equals(soloBytes) && upload.filename === `${foot.side}.stl`,
        nameAsciiInStl: soloBytes.includes(Buffer.from(SYNTHETIC_NAME)),
    };
}

async function main(): Promise<void> {
    const identity = sourceIdentity();
    if (!identity.runnerMatchesMain) fail("finalized-mesh-runner.ts differs from main");
    if (!identity.bundleScriptMatchesMain) fail("bundle-canonical-export-loft.mjs differs from main");
    if (!identity.exportSourceMatchesMain) fail("saved-design-finalized-mesh.ts differs from main");
    if (LOFT_WORKER_LIMIT !== 2) fail(`LOFT_WORKER_LIMIT is ${LOFT_WORKER_LIMIT}`);
    if (!reusableStillFalse()) fail("storedManufacturingStlReusable returned true");

    const extraLeft = footCase("medium-extra-left", mediumPair("extra-line"), "left", true);
    const extraRight = footCase("medium-extra-right", mediumPair("extra-line"), "right", true);
    const nameLeft = footCase("medium-name-left", mediumPair("patient-name"), "left", true);
    const nameRight = footCase("medium-name-right", mediumPair("patient-name"), "right", true);
    const narrowLeft = footCase("narrow-m6-left", narrowM6("left"), "left", true);
    const narrowRight = footCase("narrow-m6-right", narrowM6("right"), "right", true);
    const unnamedMediumLeft = footCase(
        "medium-unnamed-left",
        (() => {
            const design = baseDesign();
            design.shoeWidth = "medium";
            return design;
        })(),
        "left",
        false,
    );
    const unnamedMediumRight = footCase(
        "medium-unnamed-right",
        (() => {
            const design = baseDesign();
            design.shoeWidth = "medium";
            return design;
        })(),
        "right",
        false,
    );

    for (const foot of [extraLeft, extraRight, nameLeft, nameRight, narrowLeft, narrowRight]) {
        if (foot.composedText !== SYNTHETIC_NAME)
            fail(`${foot.id} composed text is ${JSON.stringify(foot.composedText)}`);
        if (!JSON.stringify(foot.settingsJson).includes(SYNTHETIC_NAME))
            fail(`${foot.id} settings omit the synthetic name`);
    }

    console.log("[grader] pair overlap + event-loop polls");
    const pairStarted = performance.now();
    const pair = await occupyPair(extraLeft, extraRight);
    const pairMs = performance.now() - pairStarted;
    const leftStarts = pair.starts.filter((mark) => mark.side === "left");
    const rightStarts = pair.starts.filter((mark) => mark.side === "right");
    const leftStart = leftStarts[0];
    const rightStart = rightStarts[0];
    if (!leftStart || !rightStart)
        fail(`missing loft-start marks left=${Boolean(leftStart)} right=${Boolean(rightStart)}`);
    if (leftStart && rightStart && leftStart.threadId === rightStart.threadId) {
        fail(`pair lofts shared thread ${leftStart.threadId}`);
    }
    if (loftWorkerPeak() !== 2) fail(`pair peak workers ${loftWorkerPeak()}`);
    const overlapMs =
        leftStart && rightStart
            ? Math.min(pair.leftDoneMs, pair.rightDoneMs) - Math.max(leftStart.at, rightStart.at)
            : 0;
    const rightBeforeLeftSlice =
        Boolean(rightStart) && (rightStart?.at ?? Number.POSITIVE_INFINITY) < pair.leftDoneMs;
    if (!rightBeforeLeftSlice) {
        fail(
            `right loft start ${rightStart?.at ?? "missing"} ms is not before left slice (left loft done ${pair.leftDoneMs.toFixed(0)} ms)`,
        );
    }
    if (overlapMs < 1000) fail(`pair lofts overlapped only ${overlapMs.toFixed(0)} ms`);
    const maxGap = pair.polls.length ? Math.max(...pair.polls) : Number.POSITIVE_INFINITY;
    const p95 = percentile(pair.polls, 95);
    if (!(maxGap < 2000))
        fail(`request-thread poll stretched to ${maxGap.toFixed(1)} ms during the pair loft`);
    if (pair.polls.length < pairMs / 40) fail(`only ${pair.polls.length} polls in ${pairMs.toFixed(0)} ms`);

    console.log("[grader] two different designs in the pool");
    resetLoftWorkerPeak();
    const mixedHook = hookStarts();
    let mixed: { name: LoftBytes; narrow: LoftBytes };
    try {
        const [nameMesh, narrowMesh] = await Promise.all([workerLoft(nameLeft), workerLoft(narrowRight)]);
        mixed = { name: nameMesh, narrow: narrowMesh };
    } finally {
        mixedHook.restore();
    }
    if (loftWorkerPeak() < 2) fail(`mixed-design peak workers ${loftWorkerPeak()}`);
    const mixedThreads = new Set(mixedHook.marks.map((mark) => mark.threadId));
    if (mixedThreads.size < 2) fail(`mixed designs did not use two threads (${[...mixedThreads].join(",")})`);

    const unnamedNarrowLeft = footCase(
        "narrow-unnamed-left",
        (() => {
            const design = baseDesign();
            design.usMenSize = 6;
            design.shoeWidth = "narrow";
            design.shoeWidthBySide = { left: "narrow", right: "narrow" };
            const patch = { heelCupHeightMm: 9 };
            design.corrections = {
                ...design.corrections,
                linked: true,
                left: { ...design.corrections.left, ...patch },
                right: { ...design.corrections.right, ...patch },
            };
            const layout = insoleLayoutFromDesign(design);
            const pose = defaultElementPose("met_pad", "left", layout.lengthMm, layout.widthMm);
            design.elements = [
                {
                    id: "grader-met-left",
                    kind: "met_pad",
                    side: "left",
                    position: pose.position,
                    rotationDeg: pose.rotationDeg,
                    scale: pose.scale,
                    heightMm: pose.heightMm,
                    ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
                },
            ];
            return design;
        })(),
        "left",
        false,
    );
    const unnamedNarrowRight = footCase(
        "narrow-unnamed-right",
        (() => {
            const design = narrowM6("right");
            design.textMarking = {
                ...defaultTextMarking("bottom"),
                text: "",
                addPatientName: false,
                feet: "both",
            };
            return design;
        })(),
        "right",
        false,
    );

    console.log("[grader] remaining worker feet");
    const nameRightWorker = await workerLoft(nameRight);
    const narrowLeftWorker = await workerLoft(narrowLeft);
    const [unnamedLeftWorker, unnamedRightWorker] = await Promise.all([
        workerLoft(unnamedMediumLeft),
        workerLoft(unnamedMediumRight),
    ]);
    const [unnamedNarrowLeftWorker, unnamedNarrowRightWorker] = await Promise.all([
        workerLoft(unnamedNarrowLeft),
        workerLoft(unnamedNarrowRight),
    ]);

    const workerById = new Map<string, LoftBytes>([
        [extraLeft.id, pair.left],
        [extraRight.id, pair.right],
        [nameLeft.id, mixed.name],
        [narrowRight.id, mixed.narrow],
        [nameRight.id, nameRightWorker],
        [narrowLeft.id, narrowLeftWorker],
        [unnamedMediumLeft.id, unnamedLeftWorker],
        [unnamedMediumRight.id, unnamedRightWorker],
        [unnamedNarrowLeft.id, unnamedNarrowLeftWorker],
        [unnamedNarrowRight.id, unnamedNarrowRightWorker],
    ]);

    console.log("[grader] solo in-process lofts");
    const reports: FootReport[] = [];
    const inProcessFeet = [extraLeft, extraRight, nameLeft, nameRight, narrowLeft, narrowRight];
    for (const foot of inProcessFeet) {
        const worker = workerById.get(foot.id);
        if (!worker) {
            fail(`no worker bytes for ${foot.id}`);
            continue;
        }
        console.log(`[grader] in-process ${foot.id}`);
        const solo = await processLoft(foot);
        const report = compareFoot(foot, worker, solo);
        reports.push(report);
        if (!report.equal) fail(`${foot.id} worker bytes differ from in-process`);
        if (!report.fingerprintEqual) fail(`${foot.id} fingerprint differs`);
        if (!report.sliceModelEqualsStl) fail(`${foot.id} slice model is not the STL`);
        if (report.solidTriangles < 1000) fail(`${foot.id} solid triangle count ${report.solidTriangles}`);
    }

    const byId = new Map(reports.map((row) => [row.id, row]));
    const requireRow = (id: string) => {
        const row = byId.get(id);
        if (!row) fail(`missing report ${id}`);
        return row;
    };
    const extraL = requireRow("medium-extra-left");
    const extraR = requireRow("medium-extra-right");
    const nameL = requireRow("medium-name-left");
    const nameR = requireRow("medium-name-right");
    const narrowL = requireRow("narrow-m6-left");
    const narrowR = requireRow("narrow-m6-right");
    const bareLHash = sha256(unnamedLeftWorker.bytes);
    const bareRHash = sha256(unnamedRightWorker.bytes);
    const bareNarrowLHash = sha256(unnamedNarrowLeftWorker.bytes);
    const bareNarrowRHash = sha256(unnamedNarrowRightWorker.bytes);
    if (extraL && extraR && extraL.sha256 === extraR.sha256)
        fail("medium extra-line left and right STL hashes match");
    if (nameL && nameR && nameL.sha256 === nameR.sha256)
        fail("medium patient-name left and right STL hashes match");
    if (narrowL && narrowR && narrowL.sha256 === narrowR.sha256)
        fail("narrow M6 left and right STL hashes match");
    if (extraL && nameL && extraL.sha256 !== nameL.sha256)
        fail("extra-line and patient-name left meshes differ");
    if (extraR && nameR && extraR.sha256 !== nameR.sha256)
        fail("extra-line and patient-name right meshes differ");
    if (extraL && extraL.workerSha256 === bareLHash) fail("left name did not change the STL");
    if (extraR && extraR.workerSha256 === bareRHash) fail("right name did not change the STL");
    if (narrowL && narrowL.workerSha256 === bareNarrowLHash) fail("narrow left name did not change the STL");
    // The synthetic name is in this foot's settings. On 6f54ab84 the right
    // narrow STL is still byte-identical to the unnamed foot, and that matches
    // the in-process loft. The pair's two feet do change when the name is removed.
    if (narrowR && narrowR.workerSha256 === bareNarrowRHash) fail("narrow right name did not change the STL");
    if (narrowL && extraL && narrowL.sha256 === extraL.sha256) fail("narrow M6 left matches the medium pair");

    console.log("[grader] missing worker file");
    const missing = await missingWorkerFailsLoud();
    if (!missing.threw) fail("missing loft worker returned a mesh");
    if (missing.elapsedMs > 3000)
        fail(`missing worker took ${missing.elapsedMs.toFixed(0)} ms (possible in-process fallback)`);
    if (/fallback|in-process loft substituted/i.test(missing.message))
        fail(`missing worker fell back: ${missing.message}`);

    const report = {
        sha: SHA,
        main: MAIN,
        syntheticName: SYNTHETIC_NAME,
        identity,
        reusableFalse: reusableStillFalse(),
        loftWorkerLimit: LOFT_WORKER_LIMIT,
        pair: {
            wallMs: pairMs,
            peakWorkers: 2,
            leftThread: leftStart?.threadId ?? null,
            rightThread: rightStart?.threadId ?? null,
            leftStartMs: leftStart ? leftStart.at : null,
            rightStartMs: rightStart ? rightStart.at : null,
            leftDoneMs: pair.leftDoneMs,
            rightDoneMs: pair.rightDoneMs,
            overlapMs,
            rightStartBeforeLeftSlicePost: rightBeforeLeftSlice,
            pollCount: pair.polls.length,
            pollMaxMs: maxGap,
            pollP95Ms: p95,
            maxRssMb: pair.maxRssMb,
        },
        mixedThreadIds: [...mixedThreads],
        feet: reports.map((row) => ({
            ...row,
            namePresent:
                row.named &&
                row.composedText === SYNTHETIC_NAME &&
                row.workerSha256 !==
                    (row.id.startsWith("narrow")
                        ? row.side === "left"
                            ? bareNarrowLHash
                            : bareNarrowRHash
                        : row.side === "left"
                          ? bareLHash
                          : bareRHash),
        })),
        missingWorker: {
            threw: missing.threw,
            elapsedMs: missing.elapsedMs,
            message: missing.message.slice(0, 400),
        },
        failures,
    };
    mkdirSync(fileURLToPath(new URL("./results", import.meta.url)), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[grader] wrote ${OUT}`);
    if (failures.length) {
        console.error(`[grader] ${failures.length} failure(s)`);
        process.exitCode = 1;
    } else {
        console.log("[grader] loft gates passed");
    }
}

await main();
