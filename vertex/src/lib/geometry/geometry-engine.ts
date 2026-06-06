import { BufferGeometry, Vector3 } from "three";
import { getKernel } from "@/lib/chili3d/kernel";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { applyTrimLines, applyVertexOverrides } from "@/lib/geometry/mesh-edit";
import { geometryToPayload, payloadToGeometry } from "@/lib/geometry/geometry-buffer";
import { analyzeManifold, type ManifoldReport } from "@/lib/geometry/manifold";
import { isOcctKernelActive, scheduleMainThread } from "@/lib/geometry/kernel-build";
import { occtWorkerEngine } from "@/lib/geometry/occt-worker-engine";
import type { SolidValidation } from "@/lib/geometry/repair";
import { segmentsForQuality, type GeometryQuality } from "@/lib/geometry/quality";
import { serializeTrimLines, serializeVertexOverrides } from "@/lib/geometry/mesh-edit-serialize";
import type { TrimLine } from "@/lib/geometry/mesh-edit";
import type { InsoleParams } from "@/lib/geometry/insole";
import type { WorkerRequest, WorkerResponse } from "@/workers/geometry.worker";

export interface BuildInsoleOptions {
    params: InsoleParams;
    quality?: GeometryQuality;
    trimLines?: TrimLine[];
    vertexOverrides?: Map<number, { x: number; y: number; z: number }>;
    /** When true and OCCT is loaded, build on main thread via IGeometryKernel. */
    preferKernel?: boolean;
}

interface PendingRequest {
    resolve: (geometry: BufferGeometry) => void;
    reject: (err: Error) => void;
}

/**
 * Offloads insole geometry builds and manifold checks to a dedicated Web Worker.
 * Falls back to synchronous main-thread builds when workers are unavailable.
 */
class GeometryEngine {
    private worker: Worker | null = null;
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();
    private manifoldPending = new Map<number, { resolve: (r: ManifoldReport) => void; reject: (e: Error) => void }>();
    private latestBuildId = 0;

    private ensureWorker(): Worker | null {
        if (this.worker) return this.worker;
        if (typeof Worker === "undefined") return null;
        try {
            this.worker = new Worker(new URL("../../workers/geometry.worker.ts", import.meta.url), {
                type: "module",
            });
            this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                const msg = event.data;
                if (msg.type === "geometry") {
                    const req = this.pending.get(msg.id);
                    if (req) {
                        this.pending.delete(msg.id);
                        req.resolve(payloadToGeometry(msg.payload));
                    }
                } else if (msg.type === "manifold") {
                    const req = this.manifoldPending.get(msg.id);
                    if (req) {
                        this.manifoldPending.delete(msg.id);
                        req.resolve(msg.report);
                    }
                } else if (msg.type === "error") {
                    const req = this.pending.get(msg.id) ?? this.manifoldPending.get(msg.id);
                    if (req) {
                        this.pending.delete(msg.id);
                        this.manifoldPending.delete(msg.id);
                        req.reject(new Error(msg.message));
                    }
                }
            };
            this.worker.onerror = () => {
                this.worker?.terminate();
                this.worker = null;
            };
            return this.worker;
        } catch {
            return null;
        }
    }

    /** Cancel stale builds — only the latest request matters during rapid edits. */
    cancelStaleBuilds(): void {
        this.latestBuildId++;
    }

    async buildInsole(options: BuildInsoleOptions): Promise<BufferGeometry> {
        const {
            params,
            quality = "full",
            trimLines = [],
            vertexOverrides = new Map(),
            preferKernel = false,
        } = options;
        const segments = segmentsForQuality(quality);
        const fullParams: InsoleParams = { ...params, ...segments };
        const hasEdits = trimLines.length > 0 || vertexOverrides.size > 0;

        // OCCT production path — worker when available, else rAF main thread.
        if (preferKernel && isOcctKernelActive() && quality === "full") {
            try {
                let geometry = await occtWorkerEngine.buildInsole(fullParams);
                if (hasEdits) {
                    geometry = applyTrimLines(geometry, trimLines);
                    const vecMap = new Map<number, Vector3>();
                    for (const [idx, v] of vertexOverrides) vecMap.set(idx, new Vector3(v.x, v.y, v.z));
                    geometry = applyVertexOverrides(geometry, vecMap);
                }
                return geometry;
            } catch (workerErr) {
                console.warn("[geometry-engine] OCCT worker failed, using main thread:", workerErr);
                return scheduleMainThread(() => {
                    let geometry = getKernel().buildInsole(fullParams);
                    if (hasEdits) {
                        geometry = applyTrimLines(geometry, trimLines);
                        const vecMap = new Map<number, Vector3>();
                        for (const [idx, v] of vertexOverrides) vecMap.set(idx, new Vector3(v.x, v.y, v.z));
                        geometry = applyVertexOverrides(geometry, vecMap);
                    }
                    return geometry;
                });
            }
        }

        const requestId = ++this.nextId;
        const buildGeneration = ++this.latestBuildId;

        const worker = this.ensureWorker();

        if (worker) {
            return new Promise((resolve, reject) => {
                this.pending.set(requestId, {
                    resolve: (geo) => {
                        if (buildGeneration !== this.latestBuildId) {
                            geo.dispose();
                            return;
                        }
                        resolve(geo);
                    },
                    reject,
                });

                const msg: WorkerRequest = hasEdits
                    ? {
                          id: requestId,
                          type: "buildWithEdits",
                          params: fullParams,
                          trimLines: serializeTrimLines(trimLines),
                          vertexOverrides: serializeVertexOverrides(vertexOverrides),
                      }
                    : { id: requestId, type: "build", params: fullParams };

                worker.postMessage(msg);
            });
        }

        // Main-thread procedural fallback.
        let geometry = buildInsoleGeometry(fullParams);
        if (hasEdits) {
            geometry = applyTrimLines(geometry, trimLines);
            const vecMap = new Map<number, Vector3>();
            for (const [idx, v] of vertexOverrides) vecMap.set(idx, new Vector3(v.x, v.y, v.z));
            geometry = applyVertexOverrides(geometry, vecMap);
        }
        return geometry;
    }

    /** Validates a production solid — uses OCCT topology when the kernel provides it. */
    async validateProductionSolid(params: InsoleParams): Promise<SolidValidation> {
        if (isOcctKernelActive()) {
            const result = await scheduleMainThread(() => getKernel().buildInsoleSolid(params));
            return result.manifold;
        }
        const geometry = await this.buildInsole({ params, quality: "full", preferKernel: false });
        const mesh = await this.analyzeManifold(geometry);
        return { ...mesh, occtClosed: false, isWatertight: mesh.isWatertight };
    }

    async analyzeManifold(geometry: BufferGeometry): Promise<ManifoldReport> {
        const payload = geometryToPayload(geometry.clone());
        const worker = this.ensureWorker();
        const requestId = ++this.nextId;

        if (worker) {
            return new Promise((resolve, reject) => {
                this.manifoldPending.set(requestId, { resolve, reject });
                const transfer: Transferable[] = [payload.positions.buffer as ArrayBuffer];
                if (payload.indices) transfer.push(payload.indices.buffer as ArrayBuffer);
                worker.postMessage(
                    {
                        id: requestId,
                        type: "manifold",
                        positions: payload.positions,
                        indices: payload.indices,
                    } satisfies WorkerRequest,
                    transfer,
                );
            });
        }

        return analyzeManifold(geometry);
    }

    dispose(): void {
        this.worker?.terminate();
        this.worker = null;
        this.pending.clear();
        this.manifoldPending.clear();
    }
}

export const geometryEngine = new GeometryEngine();
