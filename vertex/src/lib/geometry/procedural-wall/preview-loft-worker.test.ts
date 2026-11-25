// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { buildExportStl, buildOrderPairGeometry } from "@/lib/geometry/export-geometry";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { handleProceduralWallWorkerRequest } from "@/workers/procedural-wall.worker";
import type { ManufacturingSolidContext } from "./manufacturing-solid-cache";
import {
    MANUFACTURING_SOLID_GEOMETRY_VERSION,
    manufacturingLoftStats,
    manufacturingSolidFingerprint,
    rememberManufacturingSolid,
    resetManufacturingSolidCache,
} from "./manufacturing-solid-cache";
import type { ProceduralWallWorkerRequest } from "./preview-loft-worker";
import {
    buildProceduralExportSolidOffThread,
    buildProceduralViewerPatternInWorker,
    EXPORT_SOLID_WORKER_POOL_SIZE,
    exportSolidWorkerCountForTests,
    terminateExportSolidWorkers,
    terminateProceduralWallWorker,
} from "./preview-loft-worker";
import {
    buildProceduralViewerPattern,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "./sample-top-preview";

const originalWorker = globalThis.Worker;

afterEach(() => {
    terminateExportSolidWorkers();
    globalThis.Worker = originalWorker;
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
});

function tinyTop(): BufferGeometry {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 30, 0, 1, 10, 12, 2]), 3));
    return geo;
}

function tetraPayload(): { positions: Float32Array; indices: Uint32Array } {
    return {
        positions: new Float32Array([0, 0, 0, 20, 0, 0, 10, 20, 0, 10, 8, 12]),
        indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]),
    };
}

function maxVertexDeltaMm(a: ArrayBuffer, b: ArrayBuffer): number {
    const left = binaryStlToGeometry(a);
    const right = binaryStlToGeometry(b);
    try {
        const pa = left.getAttribute("position");
        const pb = right.getAttribute("position");
        expect(pa.count).toBe(pb.count);
        let max = 0;
        for (let i = 0; i < pa.count; i++) {
            max = Math.max(
                max,
                Math.hypot(pa.getX(i) - pb.getX(i), pa.getY(i) - pb.getY(i), pa.getZ(i) - pb.getZ(i)),
            );
        }
        return max;
    } finally {
        left.dispose();
        right.dispose();
    }
}

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");

describe("preview loft worker pattern parity", () => {
    test("worker faired pattern matches main-thread bytes for L and R corrections", async () => {
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const leftGeo = await sampleTopFromArrayBuffer(buf);
        const rightGeo = leftGeo.clone();
        const mainLeft = buildProceduralViewerPattern(leftGeo, "full_contact", { heelCupHeightMm: 0 });
        const mainRight = buildProceduralViewerPattern(rightGeo, "full_contact", {
            heelCupHeightMm: 0,
            forefootWidthMm: 2,
        });
        const workerLeft = await buildProceduralViewerPatternInWorker(leftGeo, "full_contact", {
            heelCupHeightMm: 0,
        });
        const workerRight = await buildProceduralViewerPatternInWorker(rightGeo, "full_contact", {
            heelCupHeightMm: 0,
            forefootWidthMm: 2,
        });
        expect(workerLeft).toEqual(mainLeft);
        expect(workerRight).toEqual(mainRight);
        leftGeo.dispose();
        rightGeo.dispose();
    });
});

describe("cold export solids in parallel workers", () => {
    test("pool has a worker per foot", () => {
        expect(EXPORT_SOLID_WORKER_POOL_SIZE).toBeGreaterThanOrEqual(2);
    });

    test("a 2-foot cold export dispatches Left and Right to independent workers at the same time", async () => {
        class PoolWorker {
            static instances: PoolWorker[] = [];
            static inFlight = 0;
            static maxInFlight = 0;
            static sides: string[] = [];
            onmessage: ((event: MessageEvent) => void) | null = null;
            onerror: ((event: { message?: string }) => void) | null = null;
            terminated = false;
            constructor(_url: URL, _options?: { type?: string }) {
                PoolWorker.instances.push(this);
            }
            postMessage(msg: { id: number; type: string; options?: { side?: string } }): void {
                expect(msg.type).toBe("exportSolid");
                PoolWorker.inFlight += 1;
                PoolWorker.maxInFlight = Math.max(PoolWorker.maxInFlight, PoolWorker.inFlight);
                PoolWorker.sides.push(msg.options?.side ?? "");

                setTimeout(() => {
                    PoolWorker.inFlight -= 1;
                    if (this.terminated) return;
                    this.onmessage?.({
                        data: {
                            id: msg.id,
                            type: "exportSolid",
                            prePayload: tetraPayload(),
                            postPayload: tetraPayload(),
                            preUserData: { wallModel: "procedural" },
                            postUserData: { wallModel: "procedural" },
                        },
                    } as MessageEvent);
                }, 40);
            }
            terminate(): void {
                this.terminated = true;
            }
        }
        PoolWorker.instances = [];
        globalThis.Worker = PoolWorker as unknown as typeof Worker;
        primeSampleTopGeometry(tinyTop());
        resetManufacturingSolidCache();
        useDesignStore.setState({
            design: { ...createDesignWithStockPlaceholder(), method: "printing_solid" },
            viewer: { wallModel: "procedural", wallStyle: "round", deviceType: "functional" },
        });

        const merged = await buildOrderPairGeometry();
        merged.dispose();

        expect(PoolWorker.instances.length).toBeGreaterThanOrEqual(2);
        expect(PoolWorker.maxInFlight).toBeGreaterThanOrEqual(2);
        expect(PoolWorker.sides.slice(0, 2).sort()).toEqual(["left", "right"]);
        expect(PoolWorker.instances[0]).not.toBe(PoolWorker.instances[1]);
    });

    test("undefined Worker stays on the main thread", async () => {
        const cache: ManufacturingSolidContext = {
            side: "left",
            mirrored: false,
            baseAssetId: "sample-top",
            printLoftEpoch: 0,
            productId: "ApexCore",
            machineId: "printing_solid:test",
            geometryVersion: MANUFACTURING_SOLID_GEOMETRY_VERSION,
        };
        const options = { side: "left" as const, thicknessMm: 3.5 };
        const fingerprint = manufacturingSolidFingerprint(options, cache);
        const seeded = tinyTop();
        rememberManufacturingSolid(fingerprint, "left", seeded);
        seeded.dispose();

        // @ts-expect-error headless Node has no Worker
        globalThis.Worker = undefined;
        const warm = await buildProceduralExportSolidOffThread(options, cache);
        expect(warm.geometry.userData.fromManufacturingCache).toBe(true);
        expect(exportSolidWorkerCountForTests()).toBe(0);
        warm.geometry.dispose();

        let constructed = 0;
        globalThis.Worker = class {
            constructor() {
                constructed += 1;
            }
        } as unknown as typeof Worker;
        const again = await buildProceduralExportSolidOffThread(options, cache);
        expect(again.geometry.userData.fromManufacturingCache).toBe(true);
        expect(constructed).toBe(0);
        again.geometry.dispose();
    });

    test("abort and unmount terminate the export workers", async () => {
        class HungWorker {
            static last: HungWorker | null = null;
            onmessage: ((event: MessageEvent) => void) | null = null;
            onerror: ((event: { message?: string }) => void) | null = null;
            terminated = false;
            constructor(_url: URL, _options?: { type?: string }) {
                HungWorker.last = this;
            }
            postMessage(): void {}
            terminate(): void {
                this.terminated = true;
            }
        }
        globalThis.Worker = HungWorker as unknown as typeof Worker;
        primeSampleTopGeometry(tinyTop());
        let abort = false;
        const pending = buildProceduralExportSolidOffThread(
            { side: "left", thicknessMm: 2 },
            null,
            () => abort,
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        abort = true;
        expect(HungWorker.last?.terminated).toBe(true);
        await expect(pending).rejects.toThrow(/cancelled/i);
        expect(exportSolidWorkerCountForTests()).toBe(0);

        const pendingUnmount = buildProceduralExportSolidOffThread({ side: "right", thicknessMm: 2.2 }, null);
        await new Promise((resolve) => setTimeout(resolve, 20));
        terminateProceduralWallWorker();
        expect(HungWorker.last?.terminated).toBe(true);
        await expect(pendingUnmount).rejects.toThrow(/cancelled/i);
        expect(exportSolidWorkerCountForTests()).toBe(0);
    });

    test("worker Left and Right solids match the main-thread STL", async () => {
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        primeSampleTopGeometry(await sampleTopFromArrayBuffer(buf));
        resetManufacturingSolidCache();
        useDesignStore.setState({
            design: { ...createDesignWithStockPlaceholder(), method: "printing_solid" },
            viewer: { wallModel: "procedural", wallStyle: "round", deviceType: "functional" },
            stockBaseLoading: false,
            stockBaseResolutionState: "resolved",
        });

        class HandlerWorker {
            static calls = 0;
            static errors: string[] = [];
            onmessage: ((event: MessageEvent) => void) | null = null;
            onerror: ((event: { message?: string }) => void) | null = null;
            terminated = false;
            constructor(_url: URL, _options?: { type?: string }) {
                void _url;
                void _options;
            }
            postMessage(msg: ProceduralWallWorkerRequest): void {
                HandlerWorker.calls += 1;
                void handleProceduralWallWorkerRequest(msg).then((result) => {
                    if (result.response.type === "error") {
                        HandlerWorker.errors.push(result.response.message ?? "error");
                    }
                    if (!this.terminated) this.onmessage?.({ data: result.response } as MessageEvent);
                });
            }
            terminate(): void {
                this.terminated = true;
            }
        }
        HandlerWorker.calls = 0;
        HandlerWorker.errors = [];
        globalThis.Worker = HandlerWorker as unknown as typeof Worker;

        const workerLeft = await buildExportStl("left", { exportMode: "manufacturing" });
        const workerRight = await buildExportStl("right", { exportMode: "manufacturing" });
        expect(HandlerWorker.errors).toEqual([]);
        expect(HandlerWorker.calls).toBe(2);
        const builtAfterCold = manufacturingLoftStats().built;
        const warmLeft = await buildExportStl("left", { exportMode: "manufacturing" });
        expect(HandlerWorker.calls).toBe(2);
        expect(manufacturingLoftStats().built).toBe(builtAfterCold);
        expect(new Uint8Array(warmLeft)).toEqual(new Uint8Array(workerLeft));

        terminateExportSolidWorkers();
        // @ts-expect-error headless fallback
        globalThis.Worker = undefined;
        resetManufacturingSolidCache();
        const mainLeft = await buildExportStl("left", { exportMode: "manufacturing" });
        const mainRight = await buildExportStl("right", { exportMode: "manufacturing" });

        expect(new Uint8Array(workerLeft)).toEqual(new Uint8Array(mainLeft));
        expect(new Uint8Array(workerRight)).toEqual(new Uint8Array(mainRight));
        expect(maxVertexDeltaMm(workerLeft, mainLeft)).toBe(0);
        expect(maxVertexDeltaMm(workerRight, mainRight)).toBe(0);
        const triangleCounts: number[] = [];
        for (const stl of [workerLeft, workerRight, mainLeft, mainRight]) {
            const geometry = binaryStlToGeometry(stl);
            try {
                const report = validateManifold(geometry);
                expect(report.isWatertight).toBe(true);
                expect(report.eulerCharacteristic).toBe(2);
                expect(report.triangleCount).toBeGreaterThan(0);
                triangleCounts.push(report.triangleCount);
            } finally {
                geometry.dispose();
            }
        }
        expect(triangleCounts[0]).toBe(triangleCounts[2]);
        expect(triangleCounts[1]).toBe(triangleCounts[3]);
    }, 600_000);
});
