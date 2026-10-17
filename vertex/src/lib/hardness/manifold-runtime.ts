// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { TriangleMesh } from "./mesh";
import { emptyMesh } from "./mesh";

type ManifoldCtor = (new (
    mesh: unknown,
) => ManifoldHandle) & {
    cube?: (size?: number | readonly [number, number, number], center?: boolean) => ManifoldHandle;
    compose?: (manifolds: readonly ManifoldHandle[]) => ManifoldHandle;
};
type MeshCtor = new (params: {
    numProp: number;
    vertProperties: Float32Array;
    triVerts: Uint32Array;
}) => unknown;

export interface ManifoldHandle {
    subtract: (other: ManifoldHandle) => ManifoldHandle;
    add: (other: ManifoldHandle) => ManifoldHandle;
    intersect: (other: ManifoldHandle) => ManifoldHandle;
    getMesh: () => { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number };
    volume?: () => number;
    getProperties?: () => { volume: number; surfaceArea: number };
    isEmpty?: () => boolean;
    delete?: () => void;
    simplify?: (eps: number) => ManifoldHandle;
}

export interface ManifoldApi {
    Manifold: ManifoldCtor;
    Mesh: MeshCtor;
}

let apiPromise: Promise<ManifoldApi> | null = null;

/** Happy-DOM/rstest rewrite wasm URLs; inject bytes from disk when Node can read them. */
async function readManifoldWasm(): Promise<Uint8Array | undefined> {
    if (typeof process === "undefined" || !process.versions?.node) return undefined;
    try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const candidates = [
            path.join(process.cwd(), "vertex/node_modules/manifold-3d/manifold.wasm"),
            path.join(process.cwd(), "node_modules/manifold-3d/manifold.wasm"),
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) return new Uint8Array(fs.readFileSync(p));
        }
    } catch {
        return undefined;
    }
    return undefined;
}

export async function loadManifoldApi(): Promise<ManifoldApi> {
    if (!apiPromise) {
        apiPromise = (async () => {
            const mod = (await import("manifold-3d")) as {
                default?: ((opts?: { wasmBinary?: Uint8Array }) => Promise<ManifoldApi>) | ManifoldApi;
                setup?: () => void;
                Manifold?: ManifoldCtor;
                Mesh?: MeshCtor;
            };
            const factory = mod.default ?? mod;
            let wasm: ManifoldApi & { setup?: () => void };
            if (typeof factory === "function") {
                const wasmBinary = await readManifoldWasm();
                wasm = (await factory(wasmBinary ? { wasmBinary } : {})) as ManifoldApi & {
                    setup?: () => void;
                };
            } else {
                wasm = factory as ManifoldApi & { setup?: () => void };
            }
            if (typeof wasm.setup === "function") wasm.setup();
            if (!wasm.Manifold || !wasm.Mesh) {
                throw new Error("manifold-3d did not expose Manifold/Mesh");
            }
            return wasm;
        })();
    }
    return apiPromise;
}

/** Empty solid — Manifold's constructor requires a Mesh, so use cube(0). */
export function emptyManifold(api: ManifoldApi): ManifoldHandle {
    if (typeof api.Manifold.cube === "function") {
        return api.Manifold.cube([0, 0, 0]);
    }
    if (typeof api.Manifold.compose === "function") {
        return api.Manifold.compose([]);
    }
    throw new Error("manifold-3d cannot construct an empty solid");
}

export function meshToManifold(api: ManifoldApi, mesh: TriangleMesh): ManifoldHandle {
    if (mesh.indices.length === 0) return emptyManifold(api);
    const packed = new api.Mesh({
        numProp: 3,
        vertProperties: mesh.positions,
        triVerts: mesh.indices,
    });
    return new api.Manifold(packed);
}

export function manifoldToMesh(handle: ManifoldHandle): TriangleMesh {
    if (handle.isEmpty?.()) return emptyMesh();
    const raw = handle.getMesh();
    const stride = raw.numProp || 3;
    const nVerts = raw.vertProperties.length / stride;
    const positions = new Float32Array(nVerts * 3);
    for (let i = 0; i < nVerts; i++) {
        positions[i * 3] = raw.vertProperties[i * stride]!;
        positions[i * 3 + 1] = raw.vertProperties[i * stride + 1]!;
        positions[i * 3 + 2] = raw.vertProperties[i * stride + 2]!;
    }
    return { positions, indices: new Uint32Array(raw.triVerts) };
}

export function manifoldVolume(handle: ManifoldHandle): number {
    if (typeof handle.volume === "function") return Math.abs(handle.volume());
    const props = handle.getProperties?.();
    if (props) return Math.abs(props.volume);
    return 0;
}
