// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, type BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { modifierPerf } from "@/lib/performance/modifier-perf";
import type {
    BaseModifierWorkerRequest,
    BaseModifierWorkerResponse,
    SerializableHeightField,
} from "@/workers/base-modifier.worker";

export interface ApplyRequest {
    baseId: string;
    field: HeightFieldParams;
    smoothingIterations: number;
    skipNormals: boolean;
    /** Stable display geometry to mutate in place. */
    target: BufferGeometry;
    /** Immutable source geometry (full or LOD). */
    source: BufferGeometry;
}

export interface ApplyResult {
    id: number;
    workerMs: number;
    transferMs: number;
    mainThreadMs: number;
    triangleCount: number;
    stale: boolean;
}

type Pending = {
    resolve: (result: ApplyResult) => void;
    reject: (err: Error) => void;
    target: BufferGeometry;
    transferStart: number;
};

/**
 * Worker-backed base modifier with request-ID staleness, transferables, and
 * main-thread fallback when workers are unavailable.
 */
class BaseModifierEngine {
    private worker: Worker | null = null;
    private initFailed = false;
    private nextId = 1;
    private latestApplyId = 0;
    private pending = new Map<number, Pending>();
    private readyBases = new Set<string>();
    private baseVersions = new Map<string, number>();
    /** Reusable transfer buffers (double-buffered) keyed by baseId. */
    private outBuffers = new Map<string, [Float32Array | null, Float32Array | null]>();
    private outBufferIndex = new Map<string, number>();

    private ensureWorker(): Worker | null {
        if (this.initFailed) return null;
        if (this.worker) return this.worker;
        if (typeof Worker === "undefined") return null;
        try {
            this.worker = new Worker(new URL("../../workers/base-modifier.worker.ts", import.meta.url), {
                type: "module",
            });
            this.worker.onmessage = (event: MessageEvent<BaseModifierWorkerResponse>) => {
                const msg = event.data;
                if (msg.type === "ready") {
                    this.readyBases.add(msg.baseId);
                    const req = this.pending.get(msg.id);
                    if (req) {
                        this.pending.delete(msg.id);
                        req.resolve({
                            id: msg.id,
                            workerMs: 0,
                            transferMs: 0,
                            mainThreadMs: 0,
                            triangleCount: 0,
                            stale: false,
                        });
                    }
                    return;
                }
                if (msg.type === "result") {
                    const req = this.pending.get(msg.id);
                    if (!req) {
                        modifierPerf.recordStale();
                        return;
                    }
                    this.pending.delete(msg.id);
                    const transferMs = performance.now() - req.transferStart;
                    modifierPerf.recordTransfer(transferMs);

                    const stale = msg.id !== this.latestApplyId;
                    if (stale) {
                        modifierPerf.recordStale();
                        req.resolve({
                            id: msg.id,
                            workerMs: msg.workerMs,
                            transferMs,
                            mainThreadMs: 0,
                            triangleCount: msg.triangleCount,
                            stale: true,
                        });
                        return;
                    }

                    const tMain = performance.now();
                    const pos = req.target.getAttribute("position") as BufferAttribute;
                    (pos.array as Float32Array).set(msg.positions);
                    pos.needsUpdate = true;
                    if (msg.normals) {
                        const n = req.target.getAttribute("normal");
                        if (n && (n.array as Float32Array).length === msg.normals.length) {
                            (n.array as Float32Array).set(msg.normals);
                            n.needsUpdate = true;
                        } else {
                            req.target.setAttribute("normal", new BufferAttribute(msg.normals, 3));
                        }
                    }
                    const mainThreadMs = performance.now() - tMain;
                    modifierPerf.recordMainThread(mainThreadMs);
                    modifierPerf.recordWorker(msg.workerMs);
                    modifierPerf.sampleHeap();

                    req.resolve({
                        id: msg.id,
                        workerMs: msg.workerMs,
                        transferMs,
                        mainThreadMs,
                        triangleCount: msg.triangleCount,
                        stale: false,
                    });
                    return;
                }
                if (msg.type === "error") {
                    const req = this.pending.get(msg.id);
                    if (req) {
                        this.pending.delete(msg.id);
                        req.reject(new Error(msg.message));
                    }
                }
            };
            this.worker.onerror = () => {
                this.initFailed = true;
                this.worker?.terminate();
                this.worker = null;
                for (const [, req] of this.pending) {
                    req.reject(new Error("Base modifier worker failed"));
                }
                this.pending.clear();
            };
            return this.worker;
        } catch {
            this.initFailed = true;
            return null;
        }
    }

    /** Upload (or replace) a base mesh in the worker. Safe to call repeatedly. */
    async setBase(baseId: string, source: BufferGeometry): Promise<void> {
        const worker = this.ensureWorker();
        const pos = source.getAttribute("position");
        if (!pos) return;
        const positions = new Float32Array(pos.array as Float32Array);
        const index = source.getIndex();
        const indices = index ? new Uint32Array(index.array as ArrayLike<number>) : null;
        const version = (this.baseVersions.get(baseId) ?? 0) + 1;
        this.baseVersions.set(baseId, version);
        this.readyBases.delete(baseId);

        if (!worker) return; // main-thread fallback uses source directly

        const id = ++this.nextId;
        const transfer: Transferable[] = [positions.buffer];
        if (indices) transfer.push(indices.buffer);
        const msg: BaseModifierWorkerRequest = {
            type: "setBase",
            id,
            baseId,
            positions,
            indices,
            userData: { ...source.userData },
        };
        await new Promise<void>((resolve, reject) => {
            this.pending.set(id, {
                resolve: () => resolve(),
                reject,
                target: source,
                transferStart: performance.now(),
            });
            worker.postMessage(msg, transfer);
        });
    }

    /** Apply modifiers; mutates `target` in place. Discards stale responses. */
    apply(request: ApplyRequest): Promise<ApplyResult> {
        const id = ++this.nextId;
        this.latestApplyId = id;
        const worker = this.ensureWorker();

        if (!worker || !this.readyBases.has(request.baseId)) {
            return Promise.resolve(this.applyMainThread(id, request));
        }

        const pos = request.source.getAttribute("position");
        const floatCount = pos ? (pos.array as Float32Array).length : 0;
        const outPositions = floatCount > 0 ? this.acquireOutBuffer(request.baseId, floatCount) : undefined;

        const field = toSerializableField(request.field);
        const msg: BaseModifierWorkerRequest = {
            type: "apply",
            id,
            baseId: request.baseId,
            field,
            smoothingIterations: request.smoothingIterations,
            skipNormals: request.skipNormals,
            outPositions,
        };

        return new Promise<ApplyResult>((resolve, reject) => {
            this.pending.set(id, {
                resolve,
                reject,
                target: request.target,
                transferStart: performance.now(),
            });
            const transfer: Transferable[] = outPositions ? [outPositions.buffer] : [];
            worker.postMessage(msg, transfer);
        });
    }

    private acquireOutBuffer(baseId: string, length: number): Float32Array {
        let pair = this.outBuffers.get(baseId);
        if (!pair) {
            pair = [null, null];
            this.outBuffers.set(baseId, pair);
        }
        const idx = this.outBufferIndex.get(baseId) ?? 0;
        const next = (idx + 1) % 2;
        this.outBufferIndex.set(baseId, next);
        let buf = pair[next];
        // After transfer the buffer is detached — recreate when needed.
        if (!buf || buf.length !== length || buf.buffer.byteLength === 0) {
            buf = new Float32Array(length);
            pair[next] = buf;
        }
        return buf;
    }

    private applyMainThread(id: number, request: ApplyRequest): ApplyResult {
        const t0 = performance.now();
        applyBaseModifiers(request.source, request.field, request.smoothingIterations, {
            target: request.target,
            skipNormals: request.skipNormals,
        });
        const mainThreadMs = performance.now() - t0;
        modifierPerf.recordMainThread(mainThreadMs);
        modifierPerf.recordWorker(0);
        modifierPerf.sampleHeap();
        const index = request.target.getIndex();
        const pos = request.target.getAttribute("position");
        const triangleCount = index ? index.count / 3 : (pos?.count ?? 0) / 3;
        return {
            id,
            workerMs: 0,
            transferMs: 0,
            mainThreadMs,
            triangleCount,
            stale: id !== this.latestApplyId,
        };
    }

    disposeBase(baseId: string): void {
        this.readyBases.delete(baseId);
        this.outBuffers.delete(baseId);
        this.outBufferIndex.delete(baseId);
        this.worker?.postMessage({
            type: "dispose",
            id: ++this.nextId,
            baseId,
        } satisfies BaseModifierWorkerRequest);
    }

    dispose(): void {
        for (const [, req] of this.pending) {
            req.reject(new Error("BaseModifierEngine disposed"));
        }
        this.pending.clear();
        this.readyBases.clear();
        this.outBuffers.clear();
        this.outBufferIndex.clear();
        this.worker?.terminate();
        this.worker = null;
    }
}

function toSerializableField(field: HeightFieldParams): SerializableHeightField {
    const { topEdgeAvProfile: _profile, graph: _graph, ...rest } = field;
    return { ...rest, graph: null };
}

export const baseModifierEngine = new BaseModifierEngine();
