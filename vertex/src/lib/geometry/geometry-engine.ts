import { type BufferGeometry, Vector3 } from "three";
import { geometryToPayload, payloadToGeometry } from "@/lib/geometry/geometry-buffer";
import type { SolidValidation } from "@/lib/geometry/geometry-kernel";
import type { InsoleParams } from "@/lib/geometry/insole";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { analyzeManifold, type ManifoldReport } from "@/lib/geometry/manifold";
import type { TrimLine } from "@/lib/geometry/mesh-edit";
import { applyTrimLines, applyVertexOverrides } from "@/lib/geometry/mesh-edit";
import { serializeTrimLines, serializeVertexOverrides } from "@/lib/geometry/mesh-edit-serialize";
import { type GeometryQuality, segmentsForQuality } from "@/lib/geometry/quality";
import { serializeTrimlineCurve, type TrimlineCurve } from "@/lib/geometry/trimline";
import { buildTrimlineInsoleMesh, type TrimlineMeshOptions } from "@/lib/geometry/trimline-mesh";
import type { WorkerRequest, WorkerResponse } from "@/workers/geometry.worker";

export interface BuildInsoleOptions {
    params: InsoleParams;
    quality?: GeometryQuality;
    trimLines?: TrimLine[];
    vertexOverrides?: Map<number, { x: number; y: number; z: number }>;
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
    private manifoldPending = new Map<
        number,
        { resolve: (r: ManifoldReport) => void; reject: (e: Error) => void }
    >();
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
        const { params, quality = "full", trimLines = [], vertexOverrides = new Map() } = options;
        const segments = segmentsForQuality(quality);
        const fullParams: InsoleParams = { ...params, ...segments };
        const hasEdits = trimLines.length > 0 || vertexOverrides.size > 0;

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

    /**
     * Build a watertight tapered insole mesh (top + bottom + side walls) from a
     * trimline curve. Heavy mesh generation is offloaded to the Web Worker when
     * available; otherwise we fall back to a synchronous main-thread build so
     * the caller always gets a usable geometry.
     */
    async buildTrimlineMesh(
        options: Omit<TrimlineMeshOptions, "trimline"> & { trimline: TrimlineCurve },
    ): Promise<BufferGeometry> {
        const worker = this.ensureWorker();
        const requestId = ++this.nextId;

        if (worker) {
            return new Promise<BufferGeometry>((resolve, reject) => {
                this.pending.set(requestId, {
                    resolve,
                    reject,
                });
                const msg: WorkerRequest = {
                    id: requestId,
                    type: "buildTrimlineMesh",
                    payload: {
                        trimline: serializeTrimlineCurve(options.trimline),
                        field: { ...options.field, trimline: null },
                        perimeterSamples: options.perimeterSamples,
                        topRings: options.topRings,
                        bottomRings: options.bottomRings,
                        bottomInsetMm: options.bottomInsetMm,
                        minWallThicknessMm: options.minWallThicknessMm,
                        bottomZ: options.bottomZ,
                    },
                };
                worker.postMessage(msg);
            });
        }

        return buildTrimlineInsoleMesh({
            ...options,
            field: { ...options.field, trimline: options.trimline },
        });
    }

    /** Validates a production solid from the procedural mesh. */
    async validateProductionSolid(params: InsoleParams): Promise<SolidValidation> {
        const geometry = await this.buildInsole({ params, quality: "full" });
        const mesh = await this.analyzeManifold(geometry);
        return { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight };
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
