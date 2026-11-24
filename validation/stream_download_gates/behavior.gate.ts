// Frozen behavior gates for pair belt G-code download timing.
// Imports product modules read-only. Does not modify them.

import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { exportClinicalPrinterGcode } from "@/features/exports/export-panel-clinical";
import { binaryStlTriangleCount, manufacturingStlForExportKind } from "@/lib/geometry/leader-block";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";
import { stampSingleFootStl } from "@/features/exports/printer-foot-isolation";
import {
    CANCEL_REASON,
    EXPECTED_FILENAMES,
    THRESHOLDS,
    judgeBytes,
    judgeCancel,
    judgePartial,
    judgeSingle,
    judgeStream,
} from "./judges.mjs";

const GCODE = {
    left: ";gate-left\n",
    right: ";gate-right\n",
} as const;

type SideName = "left" | "right";

type SliceWaiter = {
    side: string;
    input: Record<string, unknown>;
    resolve: (value: unknown) => void;
};

type DownloadRow = { filename: string; blob: Blob | null };

const waiters: SliceWaiter[] = [];
const downloads: DownloadRow[] = [];
const uploads: { url: string; bytes: Uint8Array }[] = [];
const footSolids: { left: ArrayBuffer; right: ArrayBuffer } = {
    left: new ArrayBuffer(0),
    right: new ArrayBuffer(0),
};

const results: Array<Record<string, unknown>> = [];

let lastBlob: Blob | null = null;
let originalCreate: typeof URL.createObjectURL;
let originalClick: HTMLAnchorElement["click"];
let originalFetch: typeof fetch;

rs.mock("@/lib/geometry/export-geometry", () => ({
    buildExportStl: async (side: string) => {
        const buf = side === "right" ? footSolids.right : footSolids.left;
        return buf.slice(0);
    },
    buildOrderPairStl: async () => {
        throw new Error("paired aggregate STL must not be built for belt feet");
    },
    buildOrderPairGeometry: async () => {
        throw new Error("paired scene geometry must not be sliced for one foot");
    },
    buildExportGlb: async () => new ArrayBuffer(0),
    exportModeFromMethod: () => "manufacturing",
    orderDownloadSides: (design: {
        base?: unknown;
        paired?: { leftBase?: unknown; rightBase?: unknown };
    }) => {
        const sides: string[] = [];
        if (design?.paired?.leftBase ?? design?.base) sides.push("left");
        if (design?.paired?.rightBase) sides.push("right");
        if (sides.length === 0) sides.push("left");
        return sides;
    },
}));

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => true,
    trpc: {
        manufacturing: {
            prepareManufacturingStlUpload: {
                mutate: async ({ side }: { side: string }) => ({
                    uploadUrl: `https://upload.test/${side}`,
                    storageKey: `temp/${side}`,
                    token: "",
                }),
            },
            generateSolid: {
                mutate: async (input: Record<string, unknown>) => {
                    return new Promise((resolve) => {
                        waiters.push({ side: String(input.side ?? ""), input, resolve });
                    });
                },
            },
        },
        export: { authorize: { mutate: async () => ({ ok: true, balance: 1 }) } },
    },
}));

function writeBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): ArrayBuffer {
    const v = [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
    ];
    const faces = [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
    ];
    const buffer = new ArrayBuffer(84 + faces.length * 50);
    const view = new DataView(buffer);
    view.setUint32(80, faces.length, true);
    let offset = 84;
    for (const [a, b, c] of faces) {
        offset += 12;
        for (const i of [a, b, c]) {
            const p = v[i];
            if (!p) throw new Error("box vertex missing");
            view.setFloat32(offset, p[0] ?? 0, true);
            view.setFloat32(offset + 4, p[1] ?? 0, true);
            view.setFloat32(offset + 8, p[2] ?? 0, true);
            offset += 12;
        }
        view.setUint16(offset, 0, true);
        offset += 2;
    }
    return buffer;
}

function singleFootStl(yShift: number): ArrayBuffer {
    const heel = writeBox(0, -30 + yShift, 0, 10, 30 + yShift, 24);
    const toe = writeBox(180, -15 + yShift, 0, 200, 15 + yShift, 4);
    return concatStls([heel, toe]);
}

function concatStls(parts: ArrayBuffer[]): ArrayBuffer {
    const counts = parts.map((part) => new DataView(part).getUint32(80, true));
    const total = counts.reduce((sum, n) => sum + n, 0);
    const out = new ArrayBuffer(84 + total * 50);
    new DataView(out).setUint32(80, total, true);
    let cursor = 84;
    for (const part of parts) {
        const bytes = new Uint8Array(part).subarray(84);
        new Uint8Array(out).set(bytes, cursor);
        cursor += bytes.length;
    }
    return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function expectedUpload(raw: ArrayBuffer, side: SideName): Uint8Array {
    return new Uint8Array(stampSingleFootStl(manufacturingStlForExportKind(raw.slice(0), "gcode"), side));
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item));
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            const child = (value as Record<string, unknown>)[key];
            if (child === undefined) continue;
            out[key] = canonicalize(child);
        }
        return out;
    }
    return value;
}

function goldenPath(): string {
    return process.env.GATE_GOLDEN_PATH ?? "validation/stream_download_gates/golden-slice.json";
}

function loadGolden(): Record<string, unknown> | null {
    try {
        return JSON.parse(readFileSync(goldenPath(), "utf8")) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function record(row: Record<string, unknown>) {
    results.push(row);
}

async function blobText(blob: Blob | null): Promise<string | null> {
    if (!blob) return null;
    return blob.text();
}

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
    const start = Date.now();
    while (!pred()) {
        if (Date.now() - start > ms) return false;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return true;
}

function feetDesign(which: "both" | "left" | "right") {
    const design = useDesignStore.getState().design;
    const left = design.paired?.leftBase ?? design.base ?? { assetId: "gate-left", name: "GateLeft" };
    const right = design.paired?.rightBase ?? { assetId: "gate-right", name: "GateRight" };
    return {
        ...design,
        productType: "insole" as const,
        method: "printing_solid" as const,
        elements: [],
        base: which === "right" ? undefined : left,
        paired: {
            ...(which !== "right" ? { leftBase: left } : {}),
            ...(which !== "left" ? { rightBase: right } : {}),
        },
    };
}

function succeed(waiter: SliceWaiter) {
    const side = waiter.side === "right" ? "right" : "left";
    waiter.resolve({
        ok: true,
        gcode: GCODE[side],
        productionId: `gate-${side}`,
        balance: 1,
    });
}

function countNamed(rows: DownloadRow[], suffix: string): number {
    return rows.filter((row) => row.filename.endsWith(suffix)).length;
}

beforeEach(() => {
    footSolids.left = singleFootStl(0);
    footSolids.right = singleFootStl(4);
    waiters.length = 0;
    downloads.length = 0;
    uploads.length = 0;
    lastBlob = null;
    useClientStore.setState({
        activeClientId: "gate-client",
        activeDesignId: null,
        clients: [
            {
                id: "gate-client",
                firstName: "Stream",
                lastName: "Gate",
                displayName: "SG",
                reference: "GATE",
                dateOfBirth: null,
                notes: "",
                shoeChart: {
                    shoeSizeUs: 9,
                    shoeSizesSplit: false,
                    shoeSizeLeftUs: 9,
                    shoeSizeRightUs: 9,
                    shoeWidth: "medium",
                },
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                archivedAt: null,
            },
        ],
    });
    useDesignStore.setState({
        design: { ...useDesignStore.getState().design, method: "printing_solid", productType: "insole" },
    });
    originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = ((obj: Blob) => {
        if (obj instanceof Blob) lastBlob = obj;
        return `blob:gate/${downloads.length}-${lastBlob ? lastBlob.size : 0}`;
    }) as typeof URL.createObjectURL;
    originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
        downloads.push({ filename: this.download, blob: lastBlob });
    };
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT" && init.body != null) {
            const raw = init.body;
            let bytes: Uint8Array;
            if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
            else if (ArrayBuffer.isView(raw)) bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
            else if (raw instanceof Blob) bytes = new Uint8Array(await raw.arrayBuffer());
            else return new Response("bad put body", { status: 500 });
            uploads.push({ url: String(input), bytes });
            return new Response("", { status: 200 });
        }
        return new Response("missing", { status: 404 });
    }) as typeof fetch;
});

afterEach(() => {
    URL.createObjectURL = originalCreate;
    HTMLAnchorElement.prototype.click = originalClick;
    globalThis.fetch = originalFetch;
    for (const waiter of waiters) {
        try {
            waiter.resolve({ ok: false, reason: "gate cleanup" });
        } catch {
            // already settled
        }
    }
});

afterAll(() => {
    const path = process.env.GATE_RESULT_PATH ?? "/tmp/stream-download-gates-behavior.json";
    writeFileSync(path, JSON.stringify(results, null, 2));
});

describe("frozen stream-download judges", () => {
    test("noop proof: an immediate foot-1 download passes the stream judge", () => {
        const measured = {
            earlyLeft: 1,
            earlyRight: 0,
            earlyLeftBytesMatch: true,
            foot2Pending: true,
            slicesStarted: 2,
        };
        const pass = judgeStream(measured);
        expect(pass).toBe(true);
        record({
            id: "PROOF_NOOP_STREAM",
            group: "proof",
            threshold: THRESHOLDS.G_T1_STREAM,
            pass,
            measured,
        });
    });

    test("bad-change proof: holding foot 1 until foot 2 finishes fails the stream judge", () => {
        const measured = {
            earlyLeft: 0,
            earlyRight: 0,
            earlyLeftBytesMatch: false,
            foot2Pending: false,
            slicesStarted: 2,
        };
        const pass = judgeStream(measured);
        expect(pass).toBe(false);
        record({
            id: "PROOF_BAD_STREAM",
            group: "proof",
            threshold: THRESHOLDS.G_T1_STREAM,
            pass: pass === false,
            measured,
            detail: "judge returned false on a hold-until-both trace",
        });
    });

    test("noop proof: a partial-failure report that names the downloaded foot passes", () => {
        const measured = {
            ok: false,
            earlyLeft: 1,
            reason: "Left downloaded. Right failed.",
        };
        const pass = judgePartial(measured);
        expect(pass).toBe(true);
        record({
            id: "PROOF_NOOP_PARTIAL",
            group: "proof",
            threshold: THRESHOLDS.G_T2_PARTIAL,
            pass,
            measured,
        });
    });

    test("bad-change proof: 'No files were downloaded' fails the partial-failure judge", () => {
        const measured = {
            ok: false,
            earlyLeft: 0,
            reason: "Right G-code failed. No files were downloaded. slice failed",
        };
        const pass = judgePartial(measured);
        expect(pass).toBe(false);
        record({
            id: "PROOF_BAD_PARTIAL",
            group: "proof",
            threshold: THRESHOLDS.G_T2_PARTIAL,
            pass: pass === false,
            measured,
        });
    });
});

describe("product export download gates", () => {
    test("pair export streams foot 1 before foot 2 resolves", async () => {
        const design = feetDesign("both");
        const task = exportClinicalPrinterGcode({
            side: "left",
            feet: "both",
            design,
            apexMaterialId: "ApexCore",
            includeLeaderBlock: true,
        });
        const started = await waitFor(() => waiters.length >= 2, 20_000);
        const left = waiters.find((waiter) => waiter.side === "left");
        const right = waiters.find((waiter) => waiter.side === "right");
        if (!started || !left || !right) {
            record({
                id: "G_T1_STREAM",
                group: "product",
                threshold: THRESHOLDS.G_T1_STREAM,
                pass: false,
                measured: { slicesStarted: waiters.length, started },
                detail: "both deferred slice calls did not start",
            });
            await Promise.allSettled([task]);
            return;
        }
        succeed(left);
        await waitFor(() => downloads.length >= 1, 500);
        const early = downloads.slice();
        const earlyLeftRows = early.filter((row) => row.filename.endsWith("_L.gcode"));
        const earlyLeftText = await blobText(earlyLeftRows[0]?.blob ?? null);
        const measured = {
            slicesStarted: waiters.length,
            foot2Pending: true,
            earlyLeft: countNamed(early, "_L.gcode"),
            earlyRight: countNamed(early, "_R.gcode"),
            earlyLeftBytesMatch: earlyLeftText === GCODE.left,
            earlyLeftFilename: earlyLeftRows[0]?.filename ?? "",
        };
        record({
            id: "G_T1_STREAM",
            group: "product",
            threshold: THRESHOLDS.G_T1_STREAM,
            pass: judgeStream(measured),
            measured,
        });
        succeed(right);
        await task;
    });

    test("foot 2 failure after foot 1 downloaded reports both facts", async () => {
        const design = feetDesign("both");
        const task = exportClinicalPrinterGcode({
            side: "left",
            feet: "both",
            design,
            apexMaterialId: "ApexCore",
            includeLeaderBlock: true,
        });
        const started = await waitFor(() => waiters.length >= 2, 20_000);
        const left = waiters.find((waiter) => waiter.side === "left");
        const right = waiters.find((waiter) => waiter.side === "right");
        if (!started || !left || !right) {
            record({
                id: "G_T2_PARTIAL",
                group: "product",
                threshold: THRESHOLDS.G_T2_PARTIAL,
                pass: false,
                measured: { slicesStarted: waiters.length },
                detail: "both deferred slice calls did not start",
            });
            await Promise.allSettled([task]);
            return;
        }
        succeed(left);
        await waitFor(() => downloads.length >= 1, 500);
        const earlyLeft = countNamed(downloads, "_L.gcode");
        right.resolve({ ok: false, reason: "slice failed" });
        const outcome = await task;
        const measured = {
            ok: outcome.ok,
            earlyLeft,
            reason: outcome.ok ? "" : outcome.reason,
            downloads: downloads.map((row) => row.filename),
        };
        record({
            id: "G_T2_PARTIAL",
            group: "product",
            threshold: THRESHOLDS.G_T2_PARTIAL,
            pass: judgePartial(measured),
            measured,
        });
    });

    test("cancelling before any slice starts downloads nothing", async () => {
        const design = feetDesign("both");
        const outcome = await exportClinicalPrinterGcode({
            side: "left",
            feet: "both",
            design,
            apexMaterialId: "ApexCore",
            shouldAbort: () => true,
        });
        const measured = {
            ok: outcome.ok,
            cancelled: outcome.cancelled === true,
            downloads: downloads.length,
            reason: outcome.ok ? "" : outcome.reason,
            slicesStarted: waiters.length,
            expectedSlices: 0,
        };
        record({
            id: "G_T3_CANCEL_BEFORE",
            group: "product",
            threshold: THRESHOLDS.G_T3_CANCEL_BEFORE,
            pass: judgeCancel(measured),
            measured,
        });
    });

    test("cancelling while both slices are still pending downloads nothing", async () => {
        let abort = false;
        const design = feetDesign("both");
        const task = exportClinicalPrinterGcode({
            side: "left",
            feet: "both",
            design,
            apexMaterialId: "ApexCore",
            shouldAbort: () => abort,
        });
        const started = await waitFor(() => waiters.length >= 2, 20_000);
        abort = true;
        for (const waiter of waiters) succeed(waiter);
        const outcome = await task;
        const measured = {
            ok: outcome.ok,
            cancelled: outcome.cancelled === true,
            downloads: downloads.length,
            reason: outcome.ok ? "" : outcome.reason,
            slicesStarted: started ? 2 : waiters.length,
            expectedSlices: 2,
        };
        record({
            id: "G_T3_CANCEL_INFLIGHT",
            group: "product",
            threshold: THRESHOLDS.G_T3_CANCEL_INFLIGHT,
            pass: judgeCancel(measured),
            measured,
        });
    });

    test("single-foot exports keep one file, leader STL, and server G-code bytes", async () => {
        await recordSingle("G_T3_SINGLE_LEFT", "left", "omit");
        await recordSingle("G_T3_SINGLE_RIGHT", "right", "right");
    });

    test("pair export bytes, filenames, leader, and slice fields match the frozen golden", async () => {
        const captured = await runPair();
        const golden = loadGolden();
        const sliceJson = JSON.stringify(captured.slices);
        if (process.env.GATE_CAPTURE === "1") {
            const previous = golden ?? {};
            writeFileSync(
                goldenPath(),
                JSON.stringify({ ...previous, pair: captured.slices, pairFilenames: captured.filenames }, null, 2),
            );
        }
        const goldenPair = golden ? JSON.stringify(golden.pair ?? null) : "";
        const measured = {
            gcodeMismatches: captured.gcodeMismatches,
            uploadMismatches: captured.uploadMismatches,
            filenameMismatches: captured.filenameMismatches,
            sliceMatch: golden ? sliceJson === goldenPair : false,
            feetWithNoLeader: captured.feetWithNoLeader,
            filenames: captured.filenames,
            uploadTriangles: captured.uploadTriangles,
            rawTriangles: captured.rawTriangles,
            gcodeTexts: captured.gcodeTexts,
        };
        record({
            id: "G_BYTES_PAIR",
            group: "product",
            threshold: THRESHOLDS.G_BYTES_PAIR,
            pass: process.env.GATE_CAPTURE === "1" ? true : judgeBytes(measured),
            measured,
        });
    });
});

async function recordSingle(id: "G_T3_SINGLE_LEFT" | "G_T3_SINGLE_RIGHT", side: SideName, scope: "omit" | "right") {
    waiters.length = 0;
    downloads.length = 0;
    uploads.length = 0;
    const design = feetDesign(side);
    const task = exportClinicalPrinterGcode({
        side,
        ...(scope === "right" ? { feet: "right" as const } : {}),
        design,
        apexMaterialId: "ApexCore",
        includeLeaderBlock: true,
    });
    const started = await waitFor(() => waiters.length >= 1, 20_000);
    const waiter = waiters.find((row) => row.side === side) ?? waiters[0];
    if (!started || !waiter) {
        record({
            id,
            group: "product",
            threshold: side === "left" ? THRESHOLDS.G_T3_SINGLE_LEFT : THRESHOLDS.G_T3_SINGLE_RIGHT,
            pass: false,
            measured: { slicesStarted: waiters.length },
            detail: "single-foot slice did not start",
        });
        await Promise.allSettled([task]);
        return;
    }
    succeed(waiter);
    const outcome = await task;
    const expectedFilename = EXPECTED_FILENAMES[side];
    const download = downloads[0];
    const text = await blobText(download?.blob ?? null);
    const raw = side === "right" ? footSolids.right : footSolids.left;
    const expected = expectedUpload(raw, side);
    const upload = uploads.find((row) => row.url.includes(`/${side}`));
    const golden = loadGolden();
    const goldenKey = side === "left" ? "singleLeft" : "singleRight";
    const slice = canonicalize(waiter.input);
    if (process.env.GATE_CAPTURE === "1") {
        const previous = golden ?? {};
        writeFileSync(goldenPath(), JSON.stringify({ ...previous, [goldenKey]: [slice] }, null, 2));
    }
    const goldenSlice = golden ? JSON.stringify(golden[goldenKey] ?? null) : "";
    const measured = {
        ok: outcome.ok,
        downloadCount: downloads.length,
        filename: download?.filename ?? "",
        expectedFilename,
        gcodeMatch: text === GCODE[side],
        uploadMatch: upload ? sameBytes(upload.bytes, expected) : false,
        uploadTriangles: upload ? binaryStlTriangleCount(upload.bytes.buffer.slice(upload.bytes.byteOffset, upload.bytes.byteOffset + upload.bytes.byteLength)) : 0,
        rawTriangles: binaryStlTriangleCount(raw),
        sliceMatch: golden ? JSON.stringify([slice]) === goldenSlice : false,
        gcodeText: text,
    };
    const pass = judgeSingle(measured);
    record({
        id,
        group: "product",
        threshold: side === "left" ? THRESHOLDS.G_T3_SINGLE_LEFT : THRESHOLDS.G_T3_SINGLE_RIGHT,
        pass: process.env.GATE_CAPTURE === "1" ? true : pass,
        measured,
    });
    if (id === "G_T3_SINGLE_LEFT") {
        record({
            id: "G_BYTES_SINGLE",
            group: "product",
            threshold: THRESHOLDS.G_BYTES_SINGLE,
            pass: process.env.GATE_CAPTURE === "1" ? true : pass,
            measured: {
                gcodeMismatches: measured.gcodeMatch ? 0 : 1,
                uploadMismatches: measured.uploadMatch ? 0 : 1,
                filenameMismatches: measured.filename === expectedFilename ? 0 : 1,
                sliceMatch: measured.sliceMatch,
                feetWithNoLeader: measured.uploadTriangles > measured.rawTriangles ? 0 : 1,
                filename: measured.filename,
                gcodeText: measured.gcodeText,
            },
        });
    }
}

async function runPair() {
    waiters.length = 0;
    downloads.length = 0;
    uploads.length = 0;
    const design = feetDesign("both");
    const task = exportClinicalPrinterGcode({
        side: "left",
        feet: "both",
        design,
        apexMaterialId: "ApexCore",
        includeLeaderBlock: true,
    });
    await waitFor(() => waiters.length >= 2, 20_000);
    for (const waiter of waiters) succeed(waiter);
    await task;
    const slices = waiters
        .map((waiter) => canonicalize(waiter.input))
        .sort((a, b) => String((a as { side?: string }).side).localeCompare(String((b as { side?: string }).side)));
    const filenames = [EXPECTED_FILENAMES.left, EXPECTED_FILENAMES.right];
    let gcodeMismatches = 0;
    let filenameMismatches = 0;
    let uploadMismatches = 0;
    let feetWithNoLeader = 0;
    const gcodeTexts: string[] = [];
    const uploadTriangles: number[] = [];
    const rawTriangles: number[] = [];
    for (const side of ["left", "right"] as const) {
        const row = downloads.find((item) => item.filename === EXPECTED_FILENAMES[side]);
        const text = await blobText(row?.blob ?? null);
        gcodeTexts.push(text ?? "");
        if (text !== GCODE[side]) gcodeMismatches += 1;
        if (!downloads.some((item) => item.filename === EXPECTED_FILENAMES[side])) filenameMismatches += 1;
        const raw = footSolids[side];
        const expected = expectedUpload(raw, side);
        const upload = uploads.find((item) => item.url.includes(`/${side}`));
        const rawCount = binaryStlTriangleCount(raw);
        const uploadCount = upload
            ? binaryStlTriangleCount(
                  upload.bytes.buffer.slice(upload.bytes.byteOffset, upload.bytes.byteOffset + upload.bytes.byteLength),
              )
            : 0;
        rawTriangles.push(rawCount);
        uploadTriangles.push(uploadCount);
        if (!upload || !sameBytes(upload.bytes, expected)) uploadMismatches += 1;
        if (!(uploadCount > rawCount)) feetWithNoLeader += 1;
    }
    return {
        slices,
        filenames,
        gcodeMismatches,
        filenameMismatches,
        uploadMismatches,
        feetWithNoLeader,
        gcodeTexts,
        uploadTriangles,
        rawTriangles,
    };
}
