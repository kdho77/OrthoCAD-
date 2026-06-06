// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { payloadToGeometry } from "@/lib/geometry/geometry-buffer";
import type { InsoleParams } from "@/lib/geometry/insole";
import type { OcctWorkerRequest, OcctWorkerResponse } from "@/workers/occt.worker";

interface PendingBuild {
    resolve: (geometry: BufferGeometry) => void;
    reject: (err: Error) => void;
}

/** Offloads heavy OCCT solid tessellation to a dedicated worker thread. */
class OcctWorkerEngine {
    private worker: Worker | null = null;
    private nextId = 1;
    private pending = new Map<number, PendingBuild>();
    private initFailed = false;

    private ensureWorker(): Worker | null {
        if (this.initFailed) return null;
        if (this.worker) return this.worker;
        if (typeof Worker === "undefined") return null;
        try {
            this.worker = new Worker(new URL("../../workers/occt.worker.ts", import.meta.url), { type: "module" });
            this.worker.onmessage = (event: MessageEvent<OcctWorkerResponse>) => {
                const msg = event.data;
                if (msg.type === "geometry") {
                    const req = this.pending.get(msg.id);
                    if (req) {
                        this.pending.delete(msg.id);
                        req.resolve(payloadToGeometry(msg.payload));
                    }
                } else if (msg.type === "error") {
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
                for (const [, req] of this.pending) req.reject(new Error("OCCT worker failed"));
                this.pending.clear();
            };
            return this.worker;
        } catch {
            this.initFailed = true;
            return null;
        }
    }

    buildInsole(params: InsoleParams): Promise<BufferGeometry> {
        const worker = this.ensureWorker();
        const requestId = ++this.nextId;
        if (!worker) {
            return Promise.reject(new Error("OCCT worker unavailable"));
        }
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            const msg: OcctWorkerRequest = {
                id: requestId,
                type: "build",
                params,
                wasmUrl: `${import.meta.env.BASE_URL}chili-wasm/chili-wasm.wasm`.replace(/\/+/g, "/"),
            };
            worker.postMessage(msg);
        });
    }

    dispose(): void {
        this.worker?.terminate();
        this.worker = null;
        this.pending.clear();
    }
}

export const occtWorkerEngine = new OcctWorkerEngine();
