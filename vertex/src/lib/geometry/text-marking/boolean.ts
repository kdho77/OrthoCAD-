// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TEXT_WELD_MM } from "./constants";
import { TextMarkingError } from "./errors";

type ManifoldWasm = {
    setup: () => void;
    Manifold: {
        new (mesh: unknown): ManifoldHandle;
    };
    Mesh: new (args: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }) => unknown;
};

type ManifoldHandle = {
    add: (other: ManifoldHandle) => ManifoldHandle;
    subtract: (other: ManifoldHandle) => ManifoldHandle;
    getMesh: () => { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number };
    delete: () => void;
};

let wasm: ManifoldWasm | null = null;

async function loadWasm(): Promise<ManifoldWasm> {
    if (wasm) return wasm;
    const Module = (await import("manifold-3d")).default as (opts?: {
        wasmBinary?: Uint8Array;
    }) => Promise<ManifoldWasm>;
    let mod: ManifoldWasm | null = null;
    if (typeof process !== "undefined" && process.versions?.node) {
        const { readFileSync } = await import("node:fs");
        const { createRequire } = await import("node:module");
        const require = createRequire(import.meta.url);
        const wasmPath = require.resolve("manifold-3d/manifold.wasm");
        mod = await Module({ wasmBinary: readFileSync(wasmPath) });
    } else {
        mod = await Module();
    }
    mod.setup();
    wasm = mod;
    return mod;
}

function geometryToManifold(mod: ManifoldWasm, geo: BufferGeometry): ManifoldHandle {
    const pos = geo.getAttribute("position");
    if (!pos) throw new TextMarkingError("boolean", "mesh has no positions");
    let indices = geo.getIndex();
    if (!indices) {
        const tri: number[] = [];
        for (let i = 0; i < pos.count; i++) tri.push(i);
        geo.setIndex(tri);
        indices = geo.getIndex();
    }
    const vertProperties = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        vertProperties[i * 3] = pos.getX(i);
        vertProperties[i * 3 + 1] = pos.getY(i);
        vertProperties[i * 3 + 2] = pos.getZ(i);
    }
    const triVerts = new Uint32Array(indices!.array as ArrayLike<number>);
    const mesh = new mod.Mesh({ numProp: 3, vertProperties, triVerts });
    try {
        return new mod.Manifold(mesh);
    } catch (e) {
        throw new TextMarkingError(
            "boolean",
            `manifold construction failed: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
}

function manifoldToGeometry(handle: ManifoldHandle, userData: unknown): BufferGeometry {
    const mesh = handle.getMesh();
    const nProp = mesh.numProp || 3;
    const nVert = mesh.vertProperties.length / nProp;
    const positions = new Float32Array(nVert * 3);
    for (let i = 0; i < nVert; i++) {
        positions[i * 3] = mesh.vertProperties[i * nProp]!;
        positions[i * 3 + 1] = mesh.vertProperties[i * nProp + 1]!;
        positions[i * 3 + 2] = mesh.vertProperties[i * nProp + 2]!;
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.setIndex(Array.from(mesh.triVerts));
    const welded = mergeVertices(geo, TEXT_WELD_MM);
    if (welded !== geo) geo.dispose();
    welded.computeVertexNormals();
    welded.computeBoundingBox();
    welded.userData = userData ?? {};
    return welded;
}

/** Single manifold-3d WASM boolean. `op` add = emboss, subtract = engrave. */
export async function booleanTextSolid(
    host: BufferGeometry,
    tool: BufferGeometry,
    op: "add" | "subtract",
): Promise<BufferGeometry> {
    const mod = await loadWasm();
    const a = geometryToManifold(mod, host);
    const b = geometryToManifold(mod, tool);
    let result: ManifoldHandle | null = null;
    try {
        result = op === "add" ? a.add(b) : a.subtract(b);
        return manifoldToGeometry(result, host.userData);
    } catch (e) {
        if (e instanceof TextMarkingError) throw e;
        throw new TextMarkingError(
            "boolean",
            `boolean failed: ${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
        result?.delete();
        a.delete();
        b.delete();
        tool.dispose();
    }
}
