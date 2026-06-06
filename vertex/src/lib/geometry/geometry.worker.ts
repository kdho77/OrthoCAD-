// Web Worker: heavy insole geometry (procedural + OCCT booleans, manifold checks).

import { geometryToBuffers, buffersToGeometry, type MeshBuffers } from "@/lib/geometry/geometry-buffers";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { buildInsoleGeometry, type InsoleParams } from "@/lib/geometry/insole";
import { buildOcctInsoleSolid } from "@/lib/geometry/occt-insole";
import { validateSolid, type SolidValidation } from "@/lib/geometry/repair";
import { shapeToBufferGeometry } from "@/lib/geometry/mesh-bridge";

export type BuildQuality = "preview" | "full";

export interface WorkerBuildRequest {
    id: number;
    type: "build";
    params: InsoleParams;
    quality: BuildQuality;
    withManifold: boolean;
    occtAvailable: boolean;
}

export interface WorkerBuildResponse {
    id: number;
    buffers?: MeshBuffers;
    manifold?: SolidValidation;
    error?: string;
}

const PREVIEW_SEGMENTS = { segmentsX: 36, segmentsY: 18 };
const FULL_PROCEDURAL_SEGMENTS = { segmentsX: 72, segmentsY: 36 };

let wasmInit: Promise<boolean> | null = null;

async function ensureOcct(): Promise<boolean> {
    if (wasmInit) return wasmInit;
    wasmInit = (async () => {
        try {
            const wasmUrl = `${self.location.origin}/chili-wasm/chili-wasm.wasm`;
            const wasmBinary = await fetch(wasmUrl).then((r) => r.arrayBuffer());
            const { initWasm } = await import("@chili3d/wasm");
            await initWasm({ wasmBinary });
            return true;
        } catch {
            return false;
        }
    })();
    return wasmInit;
}

function buildProcedural(params: InsoleParams, quality: BuildQuality): MeshBuffers {
    const segments = quality === "preview" ? PREVIEW_SEGMENTS : FULL_PROCEDURAL_SEGMENTS;
    const geometry = buildInsoleGeometry({ ...params, ...segments });
    try {
        return geometryToBuffers(geometry);
    } finally {
        geometry.dispose();
    }
}

function meshManifold(buffers: MeshBuffers): SolidValidation {
    const geometry = buffersToGeometry(buffers);
    try {
        const mesh = analyzeManifold(geometry);
        return { ...mesh, occtClosed: false, isWatertight: mesh.isWatertight };
    } finally {
        geometry.dispose();
    }
}

async function buildFull(
    params: InsoleParams,
    occtAvailable: boolean,
    withManifold: boolean,
): Promise<{ buffers: MeshBuffers; manifold?: SolidValidation }> {
    if (occtAvailable && (await ensureOcct())) {
        try {
            const { ShapeFactory } = await import("@chili3d/wasm");
            const factory = new ShapeFactory();
            const solid = buildOcctInsoleSolid(factory, params);
            const geometry = shapeToBufferGeometry(solid);
            try {
                const buffers = geometryToBuffers(geometry);
                const manifold = withManifold ? validateSolid(solid, geometry) : undefined;
                return { buffers, manifold };
            } finally {
                geometry.dispose();
            }
        } catch {
            // Fall through to procedural.
        }
    }
    const buffers = buildProcedural(params, "full");
    return { buffers, manifold: withManifold ? meshManifold(buffers) : undefined };
}

async function handleBuild(req: WorkerBuildRequest): Promise<WorkerBuildResponse> {
    const { params, quality, withManifold, occtAvailable } = req;

    if (quality === "preview") {
        const buffers = buildProcedural(params, "preview");
        return {
            id: req.id,
            buffers,
            manifold: withManifold ? meshManifold(buffers) : undefined,
        };
    }

    const { buffers, manifold } = await buildFull(params, occtAvailable, withManifold);
    return { id: req.id, buffers, manifold };
}

self.onmessage = (event: MessageEvent<WorkerBuildRequest>) => {
    const req = event.data;
    if (req.type !== "build") return;

    void handleBuild(req)
        .then((response) => {
            const transfer: Transferable[] = [];
            if (response.buffers) {
                transfer.push(response.buffers.position.buffer, response.buffers.index.buffer);
            }
            self.postMessage(response, transfer.length > 0 ? { transfer } : undefined);
        })
        .catch((error: unknown) => {
            self.postMessage({
                id: req.id,
                error: error instanceof Error ? error.message : String(error),
            } satisfies WorkerBuildResponse);
        });
};
