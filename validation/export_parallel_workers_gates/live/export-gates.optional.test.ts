/**
 * Frozen live observer. Writes measurements only. The checker decides pass/fail.
 * Do not edit after the freeze commit.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "@rstest/core";
import { maxVertexDeltaMm } from "../checker.mjs";

const mode = process.env.GATE_MODE ?? "probe";
const FIXTURE = path.resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function sha256(bytes: ArrayBuffer | Buffer): string {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return createHash("sha256").update(buf).digest("hex");
}

function writeJson(file: string, value: unknown) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function installFetch() {
    const bytes = readFileSync(FIXTURE);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("SAMPLE_Top")) {
            return new Response(bytes, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;
}

function polyfillBlobUrl() {
    if (typeof URL.createObjectURL !== "function") {
        URL.createObjectURL = () => "blob:export-parallel-workers-gate";
    }
    if (typeof URL.revokeObjectURL !== "function") {
        URL.revokeObjectURL = () => {};
    }
}

type ProbeWorkerInstance = {
    id: number;
    url: string;
    outstanding: number;
    terminated: boolean;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: { message?: string }) => void) | null;
};

class ExportProbeWorker {
    static all: ProbeWorkerInstance[] = [];
    static maxActiveWorkers = 0;
    static posted = new Set<number>();
    id: number;
    url: string;
    outstanding = 0;
    terminated = false;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: { message?: string }) => void) | null = null;

    constructor(url: URL | string) {
        this.url = String(url);
        this.id = ExportProbeWorker.all.length;
        ExportProbeWorker.all.push(this);
        ExportProbeWorker.write();
    }

    postMessage() {
        if (this.terminated) return;
        this.outstanding += 1;
        ExportProbeWorker.posted.add(this.id);
        ExportProbeWorker.recompute();
        ExportProbeWorker.write();
    }

    terminate() {
        this.terminated = true;
        this.outstanding = 0;
        ExportProbeWorker.recompute();
        ExportProbeWorker.write();
    }

    addEventListener(type: string, fn: (event: never) => void) {
        if (type === "message") this.onmessage = fn as (event: MessageEvent) => void;
        if (type === "error") this.onerror = fn as (event: { message?: string }) => void;
    }

    removeEventListener() {}

    static recompute() {
        const active = ExportProbeWorker.all.filter(
            (worker) => !worker.terminated && worker.outstanding > 0,
        ).length;
        if (active > ExportProbeWorker.maxActiveWorkers) ExportProbeWorker.maxActiveWorkers = active;
    }

    static snapshot() {
        return {
            maxActiveWorkers: ExportProbeWorker.maxActiveWorkers,
            distinctWorkersPosted: ExportProbeWorker.posted.size,
            constructed: ExportProbeWorker.all.length,
            terminated: ExportProbeWorker.all.filter((worker) => worker.terminated).length,
        };
    }

    static write() {
        const file = process.env.GATE_HEARTBEAT;
        if (!file) return;
        writeJson(file, { ...ExportProbeWorker.snapshot(), final: false });
    }
}

function installProbeWorker() {
    const probe = ExportProbeWorker as unknown as typeof Worker;
    Object.defineProperty(globalThis, "Worker", { value: probe, configurable: true, writable: true });
    if (typeof window !== "undefined") {
        Object.defineProperty(window, "Worker", { value: probe, configurable: true, writable: true });
    }
}

function forceWorkerUndefined() {
    Object.defineProperty(globalThis, "Worker", { value: undefined, configurable: true, writable: true });
    if (typeof window !== "undefined") {
        Object.defineProperty(window, "Worker", { value: undefined, configurable: true, writable: true });
    }
}

const abortListeners: Array<(event: Event) => void> = [];

function installAbortTap() {
    const proto = AbortSignal.prototype as AbortSignal & {
        addEventListener: (type: string, fn: (event: Event) => void, opts?: unknown) => void;
    };
    const original = proto.addEventListener;
    proto.addEventListener = function addEventListener(
        type: string,
        fn: (event: Event) => void,
        opts?: unknown,
    ) {
        if (type === "abort" && typeof fn === "function") abortListeners.push(fn.bind(this));
        return original.call(this, type, fn, opts);
    };
}

async function installColdStockDesign() {
    const { resetSampleTopGeometryCache } = await import("@/lib/geometry/procedural-wall/sample-top-preview");
    const { dropManufacturingSolid, resetManufacturingLoftInflightForTests } = await import(
        "@/lib/geometry/procedural-wall/manufacturing-solid-cache"
    );
    const { useBottomPatternStore } = await import("@/stores/bottom-pattern-store");
    const { createDesignWithStockPlaceholder, useDesignStore } = await import("@/stores/design-store");
    const { useClientStore } = await import("@/stores/client-store");
    resetSampleTopGeometryCache();
    resetManufacturingLoftInflightForTests();
    dropManufacturingSolid("left");
    dropManufacturingSolid("right");
    useBottomPatternStore.getState().clear();
    useClientStore.setState({ clients: [], activeClientId: null, activeDesignId: null });
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.textMarking = undefined;
    useDesignStore.setState({
        design,
        viewer: {
            wallModel: "procedural",
            wallStyle: "straight",
            deviceType: "desktop",
            transparent: false,
            heightmap: false,
            showLeft: true,
            showRight: true,
            showScans: true,
            view: "iso",
        },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
}

async function installEngravedDesign() {
    await installColdStockDesign();
    const { useDesignStore } = await import("@/stores/design-store");
    const { useClientStore } = await import("@/stores/client-store");
    const { defaultTextMarking } = await import("@/lib/geometry/text-marking/constants");
    useClientStore.getState().addClient({
        firstName: "Sample",
        lastName: "Patient",
        reference: "GATE",
        shoeSizeUs: 9,
        shoeSizesSplit: false,
        shoeSizeLeftUs: 9,
        shoeSizeRightUs: 9,
        shoeWidth: "medium",
    });
    const marking = {
        ...defaultTextMarking("bottom"),
        text: "",
        addPatientName: true,
        surface: "bottom" as const,
        mode: "engrave" as const,
    };
    useDesignStore.setState((state) => ({
        design: { ...state.design, textMarking: marking, method: "printing_solid" },
    }));
    return marking;
}

async function invokeCleanup() {
    const specs = [
        "@/lib/geometry/export-geometry",
        "@/lib/geometry/procedural-wall/preview-loft-worker",
        "@/lib/geometry/procedural-wall/preview-loft-queue",
        "@/lib/geometry/procedural-wall/sample-top-preview",
        "@/features/exports/export-service",
        "@/stores/preview-loft-status-store",
    ];
    for (const spec of specs) {
        try {
            const mod = (await import(spec)) as Record<string, unknown>;
            for (const [name, value] of Object.entries(mod)) {
                if (typeof value !== "function") continue;
                if (!/^(terminate|cancel|abort|dispose|cleanup|stop)/i.test(name)) continue;
                try {
                    value();
                } catch {
                    // Cleanup hooks may reject when nothing is in flight.
                }
            }
        } catch {
            // A candidate may not have every module. Missing modules are not a pass.
        }
    }
    for (const fn of abortListeners) {
        try {
            fn(new Event("abort"));
        } catch {
            // The listener may expect a real AbortSignal event.
        }
    }
    if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("pagehide"));
        window.dispatchEvent(new Event("beforeunload"));
    }
}

if (mode === "probe" || mode === "all") {
    describe("export parallel worker probe", () => {
        test("cold 2-foot export worker overlap", async () => {
            polyfillBlobUrl();
            installFetch();
            installProbeWorker();
            installAbortTap();
            ExportProbeWorker.write();
            await installColdStockDesign();
            const { exportDesign } = await import("@/features/exports/export-service");
            const pending = exportDesign("stl");
            pending.catch(() => undefined);
            await new Promise<void>((resolve) => {
                const started = Date.now();
                const timer = setInterval(() => {
                    ExportProbeWorker.write();
                    if (ExportProbeWorker.maxActiveWorkers >= 2 || Date.now() - started > 20_000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 50);
            });
            await invokeCleanup();
            const snapshot = { ...ExportProbeWorker.snapshot(), final: true };
            const file = process.env.GATE_HEARTBEAT;
            if (file) writeJson(file, snapshot);
            const obs = process.env.GATE_OBS;
            if (obs) writeJson(obs, { runtime: snapshot });
        });
    });
}

type MeshRow = {
    sha256: string;
    triangleCount: number;
    watertight: boolean;
    euler: number;
    maxAbsDeltaMm: number;
    bytes: number;
    error?: string;
};

function measureStl(bytes: ArrayBuffer, baseline: Buffer | null): MeshRow {
    const sha = sha256(bytes);
    const buf = Buffer.from(bytes);
    let maxAbsDeltaMm = 0;
    if (baseline) {
        maxAbsDeltaMm = sha256(baseline) === sha ? 0 : maxVertexDeltaMm(buf, baseline);
    }
    return {
        sha256: sha,
        triangleCount: 0,
        watertight: false,
        euler: 0,
        maxAbsDeltaMm,
        bytes: buf.byteLength,
    };
}

async function fillManifold(row: MeshRow, bytes: ArrayBuffer) {
    const { binaryStlToGeometry } = await import("@/lib/geometry/stl");
    const { validateManifold } = await import("@/lib/geometry/mesh-close");
    const geometry = binaryStlToGeometry(bytes);
    try {
        const report = validateManifold(geometry);
        row.triangleCount = report.triangleCount;
        row.watertight = report.isWatertight;
        row.euler = report.eulerCharacteristic;
    } finally {
        geometry.dispose();
    }
}

function baselineFile(name: string): Buffer | null {
    const dir = process.env.GATE_BASELINE_STL_DIR;
    if (!dir) return null;
    return readFileSync(path.join(dir, name));
}

function saveStl(name: string, bytes: ArrayBuffer) {
    const dir = process.env.GATE_STL_OUT;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), Buffer.from(bytes));
}

if (mode === "geometry" || mode === "all") {
    describe("export solid identity", () => {
        test("stock and engraved Left/Right STL with Worker undefined", async () => {
            const obsPath = process.env.GATE_OBS ?? "";
            const obs: {
                runtime: { headlessExportOk: boolean; workerTypeDuringHeadless: string; error?: string };
                geometry: Record<string, unknown>;
            } = {
                runtime: { headlessExportOk: false, workerTypeDuringHeadless: typeof Worker },
                geometry: {},
            };
            try {
                polyfillBlobUrl();
                forceWorkerUndefined();
                obs.runtime.workerTypeDuringHeadless = typeof Worker;
                installFetch();
                const { buildExportStl } = await import("@/lib/geometry/export-geometry");
                await installColdStockDesign();
                const stockLeft = await buildExportStl("left", { exportMode: "manufacturing" });
                const stockRight = await buildExportStl("right", { exportMode: "manufacturing" });
                saveStl("stock-left.stl", stockLeft);
                saveStl("stock-right.stl", stockRight);
                const stockLeftRow = measureStl(stockLeft, baselineFile("stock-left.stl"));
                const stockRightRow = measureStl(stockRight, baselineFile("stock-right.stl"));
                await fillManifold(stockLeftRow, stockLeft);
                await fillManifold(stockRightRow, stockRight);
                const single = measureStl(stockLeft, baselineFile("stock-left.stl"));
                single.triangleCount = stockLeftRow.triangleCount;
                single.watertight = stockLeftRow.watertight;
                single.euler = stockLeftRow.euler;
                const marking = await installEngravedDesign();
                const engravedLeft = await buildExportStl("left", { exportMode: "manufacturing" });
                const engravedRight = await buildExportStl("right", { exportMode: "manufacturing" });
                saveStl("engraved-left.stl", engravedLeft);
                saveStl("engraved-right.stl", engravedRight);
                const engravedLeftRow = measureStl(engravedLeft, baselineFile("engraved-left.stl"));
                const engravedRightRow = measureStl(engravedRight, baselineFile("engraved-right.stl"));
                await fillManifold(engravedLeftRow, engravedLeft);
                await fillManifold(engravedRightRow, engravedRight);
                obs.geometry = {
                    stockLeft: stockLeftRow,
                    stockRight: stockRightRow,
                    singleFootLeft: single,
                    engravedLeft: engravedLeftRow,
                    engravedRight: engravedRightRow,
                    engravedMarking: {
                        surface: marking.surface,
                        mode: marking.mode,
                        addPatientName: marking.addPatientName,
                    },
                };
                obs.runtime.headlessExportOk = true;
                obs.runtime.workerTypeDuringHeadless = typeof Worker;
            } catch (error) {
                obs.runtime.error = error instanceof Error ? error.message : String(error);
                throw error;
            } finally {
                if (obsPath) writeJson(obsPath, obs);
            }
        }, 2_700_000);
    });
}
