// Frozen before grading candidate f059edf74b9bed33071a4deb8ad3c9674d289dfd.
// Builds stock and engraved SAMPLE_Top STLs. Worker builds run only when GATE_WORKER_BUILDS=1.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "@rstest/core";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

const outDir = process.env.GATE_OUT ?? "";
const workerBuilds = process.env.GATE_WORKER_BUILDS === "1";

interface ProductReport {
    isWatertight: boolean;
    euler: number;
    triangles: number;
    openEdges: number;
    nonManifoldEdges: number;
}

interface CaseResult {
    ok: boolean;
    error?: string;
    sha256?: string;
    byteLength?: number;
    stlFile?: string;
    product?: ProductReport;
    workerConstructs: number;
    workerPosts: number;
    workerErrors: string[];
    fallbackWarnings: string[];
    textSurface: string | null;
    textMode: string | null;
    ms: number;
}

const report: {
    label: string;
    sha: string;
    workerBuilds: boolean;
    complete: boolean;
    cases: Record<string, CaseResult>;
} = {
    label: process.env.GATE_LABEL ?? "",
    sha: process.env.GATE_SHA ?? "",
    workerBuilds,
    complete: false,
    cases: {},
};

let workerConstructs = 0;
let workerPosts = 0;
const workerErrors: string[] = [];
const fallbackWarnings: string[] = [];

function redact(value: unknown): string {
    return String(value instanceof Error ? value.message : value)
        .replace(/api[_-]?key\S*/gi, "[redacted]")
        .replace(/bearer\s+\S+/gi, "bearer [redacted]")
        .slice(0, 500);
}

function persist(): void {
    if (!outDir) return;
    writeFileSync(join(outDir, "measurements.json"), JSON.stringify(report, null, 2));
}

function sha256(buf: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(buf)).digest("hex");
}

async function runWorkerMessage(msg: unknown): Promise<{ response: { type?: string; message?: string } }> {
    const mod = await import("@/workers/procedural-wall.worker");
    const handler = (
        mod as {
            handleProceduralWallWorkerRequest?: (
                message: unknown,
            ) => Promise<{ response: { type?: string; message?: string } }>;
        }
    ).handleProceduralWallWorkerRequest;
    if (typeof handler === "function") return handler(msg);
    const scope = self as unknown as {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: (data: unknown) => void;
    };
    return new Promise((resolve, reject) => {
        if (typeof scope.onmessage !== "function") {
            reject(new Error("worker module has no message handler"));
            return;
        }
        const previous = scope.postMessage.bind(scope);
        scope.postMessage = (data: unknown) => {
            scope.postMessage = previous;
            resolve({ response: data as { type?: string; message?: string } });
        };
        try {
            scope.onmessage({ data: msg });
        } catch (error) {
            scope.postMessage = previous;
            reject(error);
        }
    });
}

function setWorkerUndefined(): void {
    (globalThis as { Worker?: unknown }).Worker = undefined;
}

function setExecutingWorker(): void {
    class ExecutingWorker {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: { message?: string }) => void) | null = null;
        terminated = false;
        constructor(url: unknown, options?: unknown) {
            void url;
            void options;
            workerConstructs += 1;
        }
        postMessage(msg: unknown): void {
            workerPosts += 1;
            void runWorkerMessage(msg)
                .then((result) => {
                    if (result.response?.type === "error") {
                        workerErrors.push(redact(result.response.message ?? "error"));
                    }
                    if (!this.terminated) this.onmessage?.({ data: result.response });
                })
                .catch((error: unknown) => {
                    workerErrors.push(redact(error));
                    this.onerror?.({ message: redact(error) });
                });
        }
        terminate(): void {
            this.terminated = true;
        }
    }
    (globalThis as { Worker?: unknown }).Worker = ExecutingWorker;
}

function setupDesign(kind: "stock" | "engraved"): void {
    resetManufacturingSolidCache();
    useBottomPatternStore.getState().clear();
    useClientStore.setState({ clients: [], designs: [], activeClientId: null, activeDesignId: null });
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.usMenSize = 9;
    if (kind === "engraved") {
        useClientStore.getState().addClient({
            firstName: "SAMPLE",
            lastName: "PATIENT",
            shoeSizeUs: 9,
            shoeWidth: "medium",
        });
        design.textMarking = {
            ...defaultTextMarking("bottom"),
            text: "",
            addPatientName: true,
            mode: "engrave",
            surface: "bottom",
            feet: "both",
        };
    } else {
        delete design.textMarking;
    }
    useDesignStore.setState({
        design,
        viewer: { wallModel: "procedural", wallStyle: "round", deviceType: "functional" },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
}

async function capture(name: string, side: Side, setup: "stock" | "engraved" | "reuse"): Promise<void> {
    const constructsBefore = workerConstructs;
    const postsBefore = workerPosts;
    const errorsBefore = workerErrors.length;
    const warnsBefore = fallbackWarnings.length;
    const started = Date.now();
    if (setup !== "reuse") setupDesign(setup);
    try {
        const stl = await buildExportStl(side, { exportMode: "manufacturing" });
        const geometry = binaryStlToGeometry(stl);
        let product: ProductReport;
        try {
            const validated = validateManifold(geometry);
            product = {
                isWatertight: validated.isWatertight,
                euler: validated.eulerCharacteristic,
                triangles: validated.triangleCount,
                openEdges: validated.openEdges,
                nonManifoldEdges: validated.nonManifoldEdges,
            };
        } finally {
            geometry.dispose();
        }
        const stlFile = `${name}.stl`;
        writeFileSync(join(outDir, stlFile), Buffer.from(stl));
        const marking = useDesignStore.getState().design.textMarking;
        report.cases[name] = {
            ok: true,
            sha256: sha256(stl),
            byteLength: stl.byteLength,
            stlFile,
            product,
            workerConstructs: workerConstructs - constructsBefore,
            workerPosts: workerPosts - postsBefore,
            workerErrors: workerErrors.slice(errorsBefore),
            fallbackWarnings: fallbackWarnings.slice(warnsBefore),
            textSurface: marking?.surface ?? null,
            textMode: marking?.mode ?? null,
            ms: Date.now() - started,
        };
    } catch (error) {
        report.cases[name] = {
            ok: false,
            error: redact(error),
            workerConstructs: workerConstructs - constructsBefore,
            workerPosts: workerPosts - postsBefore,
            workerErrors: workerErrors.slice(errorsBefore),
            fallbackWarnings: fallbackWarnings.slice(warnsBefore),
            textSurface: null,
            textMode: null,
            ms: Date.now() - started,
        };
    }
    const done = report.cases[name];
    console.log(
        `[gate] ${name} ok=${done?.ok} ms=${done?.ms} tris=${done?.product?.triangles ?? 0} posts=${done?.workerPosts}`,
    );
    persist();
}

test("stock and engraved export solids", async () => {
    if (!outDir) throw new Error("GATE_OUT is required");
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
        const line = args.map((item) => String(item)).join(" ");
        if (/falling back/i.test(line)) fallbackWarnings.push(redact(line));
        originalWarn.apply(console, args);
    };
    try {
        const bytes = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
        const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        resetSampleTopGeometryCache();
        primeSampleTopGeometry(await sampleTopFromArrayBuffer(copy));
        setWorkerUndefined();
        await capture("stock-left-main-a", "left", "stock");
        await capture("stock-left-main-b", "left", "stock");
        await capture("stock-left-warm", "left", "reuse");
        await capture("stock-right-main", "right", "stock");
        await capture("engraved-left-main", "left", "engraved");
        await capture("engraved-right-main", "right", "engraved");
        if (workerBuilds) {
            setExecutingWorker();
            await capture("stock-left-worker", "left", "stock");
            await capture("stock-left-worker-warm", "left", "reuse");
            await capture("stock-right-worker", "right", "stock");
            await capture("engraved-left-worker", "left", "engraved");
            await capture("engraved-right-worker", "right", "engraved");
        }
        report.complete = true;
        persist();
    } finally {
        console.warn = originalWarn;
    }
}, 2_400_000);
