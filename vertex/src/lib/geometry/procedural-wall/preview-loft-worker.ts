// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { type geometryToPayload, payloadToGeometry } from "@/lib/geometry/geometry-buffer";
import { perfMark } from "@/lib/geometry/perf/load-export-perf";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { ScanPattern, SideCorrections } from "@/types";
import type { PolyPoint } from "./curves";
import {
    awaitManufacturingLoftInflight,
    type ManufacturingSolidContext,
    manufacturingSolidFingerprint,
    noteManufacturingSolidBuilt,
    peekManufacturingSolid,
    rememberManufacturingSolid,
    trackManufacturingLoftInflight,
} from "./manufacturing-solid-cache";
import {
    buildProceduralExportSolid,
    buildProceduralViewerPattern,
    loadSampleTopGeometry,
    type ProceduralPreviewOptions,
    reconstructProceduralPreview,
} from "./sample-top-preview";

export interface ProceduralWallReconstructRequest {
    id: number;
    type: "reconstruct";
    positions: Float32Array;
    indices: Uint32Array | null;
    options: ProceduralPreviewOptions;
}

export interface ProceduralWallPatternRequest {
    id: number;
    type: "buildPattern";
    positions: Float32Array;
    indices: Uint32Array | null;
    scanPattern?: ScanPattern;
    corrections?: Partial<SideCorrections>;
}

/** Cold manufacturing loft. The mesh is already mirrored; the worker does not mirror again. */
export interface ProceduralWallExportSolidRequest {
    id: number;
    type: "exportSolid";
    positions: Float32Array;
    indices: Uint32Array | null;
    options: ProceduralPreviewOptions & { mirrored?: boolean };
}

export type ProceduralWallWorkerRequest =
    | ProceduralWallReconstructRequest
    | ProceduralWallPatternRequest
    | ProceduralWallExportSolidRequest;

export interface ProceduralWallWorkerResponse {
    id: number;
    type: "geometry" | "pattern" | "error" | "exportSolid";
    payload?: ReturnType<typeof geometryToPayload>;
    prePayload?: ReturnType<typeof geometryToPayload>;
    postPayload?: ReturnType<typeof geometryToPayload>;
    preUserData?: Record<string, unknown>;
    postUserData?: Record<string, unknown>;
    pattern?: PolyPoint[];
    userData?: Record<string, unknown>;
    message?: string;
}

interface Pending {
    resolve: (value: { geometry?: BufferGeometry; pattern: PolyPoint[] }) => void;
    reject: (err: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function geometryCopy(geo: BufferGeometry): {
    positions: Float32Array;
    indices: Uint32Array | null;
} {
    const pos = geo.getAttribute("position");
    if (!pos) throw new Error("procedural wall worker: top mesh has no positions");
    const positions = new Float32Array(pos.array as ArrayLike<number>);
    const index = geo.getIndex();
    const indices = index ? new Uint32Array(index.array as ArrayLike<number>) : null;
    return { positions, indices };
}

function ensureWorker(): Worker | null {
    if (worker) return worker;
    if (typeof Worker === "undefined") return null;
    try {
        worker = new Worker(new URL("../../../workers/procedural-wall.worker.ts", import.meta.url), {
            type: "module",
        });
        worker.onmessage = (event: MessageEvent<ProceduralWallWorkerResponse>) => {
            const msg = event.data;
            const req = pending.get(msg.id);
            if (!req) return;
            pending.delete(msg.id);
            if (msg.type === "error") {
                req.reject(new Error(msg.message ?? "Procedural wall worker failed"));
                return;
            }
            if (msg.type === "pattern") {
                req.resolve({ pattern: msg.pattern ?? [] });
                return;
            }
            if (!msg.payload) {
                req.reject(new Error(msg.message ?? "Procedural wall worker failed"));
                return;
            }
            const geometry = payloadToGeometry(msg.payload);
            if (msg.userData) geometry.userData = { ...geometry.userData, ...msg.userData };
            req.resolve({ geometry, pattern: msg.pattern ?? [] });
        };
        worker.onerror = (ev) => {
            const err = new Error(ev.message || "Procedural wall worker crashed");
            for (const req of pending.values()) req.reject(err);
            pending.clear();
            worker?.terminate();
            worker = null;
        };
        return worker;
    } catch {
        return null;
    }
}

/** Kill an in-flight reconstruct so Cancel does not leave a running worker. */
export function terminateProceduralWallWorker(): void {
    const err = new Error("Print solid cancelled");
    for (const req of pending.values()) req.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
    terminateExportSolidWorkers();
}

/**
 * Loft SAMPLE_Top + the live bottom pattern off the main thread.
 * Falls back to a synchronous reconstruct when Workers are unavailable (tests).
 */
export async function reconstructProceduralPreviewInWorker(
    topGeo: BufferGeometry,
    options: ProceduralPreviewOptions = {},
): Promise<{ geometry: BufferGeometry; pattern: PolyPoint[] }> {
    const sync = async () => {
        const preview = await reconstructProceduralPreview(topGeo, options);
        return { geometry: preview.geometry, pattern: preview.pattern };
    };
    const w = ensureWorker();
    if (!w) return await sync();
    const id = ++nextId;
    const copy = geometryCopy(topGeo);
    try {
        return await new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            const transfer: Transferable[] = [copy.positions.buffer];
            if (copy.indices) transfer.push(copy.indices.buffer);
            const msg: ProceduralWallWorkerRequest = {
                id,
                type: "reconstruct",
                positions: copy.positions,
                indices: copy.indices,
                options: {
                    ...options,
                    bottomPattern: options.bottomPattern?.map((p) => ({
                        x: p.x,
                        y: p.y,
                        z: p.z ?? 0,
                    })),
                    trimline: options.trimline
                        ? {
                              points: options.trimline.points.map((p) => ({
                                  x: p.x,
                                  y: p.y,
                                  z: p.z ?? 0,
                              })),
                          }
                        : options.trimline,
                    sourceField: options.sourceField
                        ? {
                              ...options.sourceField,
                              topEdgeAvProfile: undefined,
                              graph: undefined,
                              trimline: options.sourceField.trimline
                                  ? {
                                        points: options.sourceField.trimline.points.map((p) => ({
                                            x: p.x,
                                            y: p.y,
                                            z: p.z ?? 0,
                                        })),
                                    }
                                  : options.sourceField.trimline,
                          }
                        : undefined,
                },
            };
            w.postMessage(msg, transfer);
        }).then((result) => {
            if (!result.geometry) throw new Error("Procedural wall worker returned no geometry");
            return { geometry: result.geometry, pattern: result.pattern };
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/cancelled/i.test(message)) throw e;
        console.warn("[preview-loft-worker] falling back to main thread:", message);
        return sync();
    }
}

/**
 * Fair the SAMPLE_Top rim off the main thread (`extractTopOnlyModel` is ~4s).
 * Same function as the sync viewer path — hashes stay identical.
 */
export async function buildProceduralViewerPatternInWorker(
    topGeo: BufferGeometry,
    scanPattern?: ScanPattern,
    corrections?: Partial<SideCorrections>,
): Promise<PolyPoint[]> {
    const sync = () => buildProceduralViewerPattern(topGeo, scanPattern, corrections);
    const w = ensureWorker();
    if (!w) return sync();
    const id = ++nextId;
    const copy = geometryCopy(topGeo);
    try {
        const result = await new Promise<{ pattern: PolyPoint[] }>((resolve, reject) => {
            pending.set(id, { resolve, reject });
            const transfer: Transferable[] = [copy.positions.buffer];
            if (copy.indices) transfer.push(copy.indices.buffer);
            const msg: ProceduralWallWorkerRequest = {
                id,
                type: "buildPattern",
                positions: copy.positions,
                indices: copy.indices,
                scanPattern,
                corrections,
            };
            w.postMessage(msg, transfer);
        });
        return result.pattern;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn("[preview-loft-worker] pattern falling back to main thread:", message);
        return sync();
    }
}

/**
 * Two cold feet must not share one worker. A pair export checks out one
 * worker per foot so the lofts run at the same time. Further feet reuse the pool.
 */
export const EXPORT_SOLID_WORKER_POOL_SIZE = 2;

interface ExportJob {
    worker: Worker;
    resolve: (value: ProceduralWallWorkerResponse) => void;
    reject: (err: Error) => void;
}

const exportPool: Worker[] = [];
const exportReserved = new Set<Worker>();
const exportPending = new Map<number, ExportJob>();
let exportNextId = 1;
let exportCursor = 0;

export function exportSolidWorkerCountForTests(): number {
    return exportPool.length;
}

function cancelledMessage(error: unknown): boolean {
    return error instanceof Error && /cancelled/i.test(error.message);
}

function stripFunctions(value: unknown, stack = new WeakSet<object>()): unknown {
    if (typeof value === "function" || typeof value === "symbol") return undefined;
    if (value === null || typeof value !== "object") return value;
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
    if (value instanceof Date || value instanceof Map || value instanceof Set) return value;
    // Shared objects (corrections on both the options and the field) must stay.
    // Only a back-edge that is already on this path is a cycle.
    if (stack.has(value)) return null;
    stack.add(value);
    try {
        if (Array.isArray(value)) return value.map((item) => stripFunctions(item, stack));
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            const next = stripFunctions(entry, stack);
            if (next !== undefined) out[key] = next;
        }
        return out;
    } finally {
        stack.delete(value);
    }
}

function failExportWorker(worker: Worker, error: Error): void {
    exportReserved.delete(worker);
    for (const [id, job] of exportPending) {
        if (job.worker !== worker) continue;
        exportPending.delete(id);
        job.reject(error);
    }
    const index = exportPool.indexOf(worker);
    if (index >= 0) exportPool.splice(index, 1);
    worker.terminate();
}

function createExportWorker(): Worker | null {
    if (typeof Worker === "undefined") return null;
    try {
        const created = new Worker(new URL("../../../workers/procedural-wall.worker.ts", import.meta.url), {
            type: "module",
        });
        created.onmessage = (event: MessageEvent<ProceduralWallWorkerResponse>) => {
            const msg = event.data;
            const job = exportPending.get(msg.id);
            if (!job) return;
            exportPending.delete(msg.id);
            if (msg.type === "error" || msg.type !== "exportSolid" || !msg.prePayload || !msg.postPayload) {
                job.reject(new Error(msg.message ?? "Procedural wall worker failed"));
                return;
            }
            job.resolve(msg);
        };
        created.onerror = (ev) => {
            failExportWorker(created, new Error(ev.message || "Procedural wall worker crashed"));
        };
        return created;
    } catch {
        return null;
    }
}

/** Reserve a worker before the next await so a pair does not both land on one thread. */
function checkoutExportWorker(): { worker: Worker; reserved: boolean } | null {
    if (typeof Worker === "undefined") return null;
    const idle = exportPool.find((candidate) => !exportReserved.has(candidate));
    if (idle) {
        exportReserved.add(idle);
        return { worker: idle, reserved: true };
    }
    if (exportPool.length < EXPORT_SOLID_WORKER_POOL_SIZE) {
        const created = createExportWorker();
        if (!created) return null;
        exportPool.push(created);
        exportReserved.add(created);
        return { worker: created, reserved: true };
    }
    const shared = exportPool[exportCursor % exportPool.length];
    exportCursor += 1;
    if (!shared) return null;
    return { worker: shared, reserved: false };
}

/** Stop every cold-export worker. Preview cancel and export abort both call this. */
export function terminateExportSolidWorkers(): void {
    const err = new Error("Print solid cancelled");
    const jobs = [...exportPending.values()];
    exportPending.clear();
    exportReserved.clear();
    for (const job of jobs) job.reject(err);
    for (const live of exportPool) live.terminate();
    exportPool.length = 0;
    exportCursor = 0;
}

function releaseExportWorker(worker: Worker): void {
    exportReserved.delete(worker);
}

function geometryFromPayload(
    payload: NonNullable<ProceduralWallWorkerResponse["postPayload"]>,
    userData: Record<string, unknown> | undefined,
): BufferGeometry {
    const geometry = payloadToGeometry(payload);
    if (userData) geometry.userData = { ...userData };
    return geometry;
}

async function waitForExportJob(
    work: Promise<ProceduralWallWorkerResponse>,
    shouldAbort?: () => boolean,
): Promise<ProceduralWallWorkerResponse> {
    if (!shouldAbort) return work;
    return new Promise((resolve, reject) => {
        const timer = setInterval(() => {
            if (!shouldAbort()) return;
            clearInterval(timer);
            terminateExportSolidWorkers();
            reject(new Error("Print solid cancelled"));
        }, 32);
        work.then(
            (value) => {
                clearInterval(timer);
                resolve(value);
            },
            (error) => {
                clearInterval(timer);
                reject(error);
            },
        );
    });
}

/**
 * Cold Print/Export loft off the main thread.
 * A cache hit stays on the main thread (same text-on-hit path as today).
 * Node and any environment without Worker run {@link buildProceduralExportSolid}.
 */
export async function buildProceduralExportSolidOffThread(
    options: ProceduralPreviewOptions & { mirrored?: boolean } = {},
    cache?: ManufacturingSolidContext | null,
    shouldAbort?: () => boolean,
): Promise<{ geometry: BufferGeometry }> {
    if (shouldAbort?.()) throw new Error("Print solid cancelled");
    const side = cache?.side ?? options.side ?? (options.mirrored ? "left" : "right");
    const fingerprint = cache ? manufacturingSolidFingerprint(options, cache) : "";
    if (cache && fingerprint) {
        await awaitManufacturingLoftInflight(fingerprint, side);
        const cached = peekManufacturingSolid(fingerprint, side);
        if (cached) {
            cached.dispose();
            return buildProceduralExportSolid(options, cache);
        }
    }
    const checkedOut = checkoutExportWorker();
    if (!checkedOut) return buildProceduralExportSolid(options, cache);
    const worker = checkedOut.worker;
    try {
        if (shouldAbort?.()) throw new Error("Print solid cancelled");
        let raw = await loadSampleTopGeometry();
        if (options.mirrored) {
            const mirrored = mirrorGeometry(raw);
            raw.dispose();
            raw = mirrored;
        }
        if (shouldAbort?.()) {
            raw.dispose();
            throw new Error("Print solid cancelled");
        }
        const copy = geometryCopy(raw);
        raw.dispose();
        let safeOptions: ProceduralPreviewOptions & { mirrored?: boolean };
        try {
            safeOptions = structuredClone(stripFunctions(options)) as ProceduralPreviewOptions & {
                mirrored?: boolean;
            };
        } catch (cloneError) {
            throw cloneError instanceof Error ? cloneError : new Error(String(cloneError));
        }
        const id = ++exportNextId;
        perfMark("export:loft", { side, warm: false });
        const workerPromise = new Promise<ProceduralWallWorkerResponse>((resolve, reject) => {
            exportPending.set(id, { worker, resolve, reject });
            const transfer: Transferable[] = [copy.positions.buffer];
            if (copy.indices) transfer.push(copy.indices.buffer);
            const msg: ProceduralWallExportSolidRequest = {
                id,
                type: "exportSolid",
                positions: copy.positions,
                indices: copy.indices,
                options: safeOptions,
            };
            try {
                worker.postMessage(msg, transfer);
            } catch (postError) {
                exportPending.delete(id);
                reject(postError instanceof Error ? postError : new Error(String(postError)));
            }
        });
        if (cache && fingerprint) trackManufacturingLoftInflight(fingerprint, side, workerPromise);
        const msg = await waitForExportJob(workerPromise, shouldAbort);
        if (!msg.prePayload || !msg.postPayload) {
            throw new Error("Procedural wall worker returned no export solid");
        }
        const pre = geometryFromPayload(msg.prePayload, msg.preUserData);
        if (cache && fingerprint) rememberManufacturingSolid(fingerprint, side, pre);
        pre.dispose();
        noteManufacturingSolidBuilt(side);
        const geometry = geometryFromPayload(msg.postPayload, msg.postUserData);
        if (fingerprint) {
            geometry.userData = {
                ...geometry.userData,
                manufacturingFingerprint: fingerprint,
                fromManufacturingCache: false,
            };
        }
        return { geometry };
    } catch (e) {
        if (cancelledMessage(e)) throw e;
        const message = e instanceof Error ? e.message : String(e);
        console.warn("[preview-loft-worker] export solid falling back to main thread:", message);
        return buildProceduralExportSolid(options, cache);
    } finally {
        if (checkedOut.reserved) releaseExportWorker(worker);
    }
}
