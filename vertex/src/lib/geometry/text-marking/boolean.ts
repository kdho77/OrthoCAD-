// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TEXT_WELD_MM } from "./constants";
import { TextMarkingError } from "./errors";
import type { MapTextPoint } from "./solid";
import type { TextGlyphGroup } from "./types";

type ManifoldMesh = {
    merge: () => boolean;
};

type ManifoldWasm = {
    setup: () => void;
    Manifold: {
        new (mesh: unknown): ManifoldHandle;
    };
    Mesh: new (args: {
        numProp: number;
        vertProperties: Float32Array;
        triVerts: Uint32Array;
    }) => ManifoldMesh;
    CrossSection: new (
        contours: Array<Array<[number, number]>>,
        fillRule?: string,
    ) => {
        extrude: (height: number) => ManifoldHandle;
    };
};

type ManifoldHandle = {
    add: (other: ManifoldHandle) => ManifoldHandle;
    subtract: (other: ManifoldHandle) => ManifoldHandle;
    warp: (fn: (vert: [number, number, number]) => void) => ManifoldHandle;
    simplify: (tolerance?: number) => ManifoldHandle;
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

function weldedIndexed(geo: BufferGeometry): BufferGeometry {
    const clone = geo.clone();
    if (!clone.getIndex()) {
        const n = clone.getAttribute("position").count;
        const tri: number[] = [];
        for (let i = 0; i < n; i++) tri.push(i);
        clone.setIndex(tri);
    }
    const welded = mergeVertices(clone, TEXT_WELD_MM);
    if (welded !== clone) clone.dispose();
    return welded;
}

function textGroupsToManifold(
    mod: ManifoldWasm,
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
): ManifoldHandle {
    const contours: Array<Array<[number, number]>> = [];
    for (const g of groups) {
        if (g.outer.length >= 3) contours.push(g.outer.map((p) => [p.x, p.y]));
        for (const hole of g.holes) {
            if (hole.length < 3) continue;
            contours.push(
                hole
                    .slice()
                    .reverse()
                    .map((p) => [p.x, p.y]),
            );
        }
    }
    if (!contours.length) throw new TextMarkingError("boolean", "text produced no contours");
    let solid: ManifoldHandle;
    try {
        const cs = new mod.CrossSection(contours, "NonZero");
        const extruded = cs.extrude(1);
        solid = extruded.warp((vert) => {
            const mapped = mapPoint({ x: vert[0], y: vert[1] }, vert[2]);
            vert[0] = mapped.x;
            vert[1] = mapped.y;
            vert[2] = mapped.z;
        });
        if (solid !== extruded) extruded.delete();
    } catch (e) {
        throw new TextMarkingError(
            "boolean",
            `text solid failed: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    return solid;
}

function geometryToManifold(mod: ManifoldWasm, geo: BufferGeometry, label: string): ManifoldHandle {
    const welded = weldedIndexed(geo);
    try {
        const pos = welded.getAttribute("position");
        if (!pos) throw new TextMarkingError("boolean", `${label} mesh has no positions`);
        const indices = welded.getIndex();
        if (!indices) throw new TextMarkingError("boolean", `${label} mesh has no index`);
        const vertProperties = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
            vertProperties[i * 3] = pos.getX(i);
            vertProperties[i * 3 + 1] = pos.getY(i);
            vertProperties[i * 3 + 2] = pos.getZ(i);
        }
        const src = indices.array as ArrayLike<number>;
        const clean: number[] = [];
        for (let t = 0; t + 2 < indices.count; t += 3) {
            const i0 = src[t]!;
            const i1 = src[t + 1]!;
            const i2 = src[t + 2]!;
            if (i0 === i1 || i1 === i2 || i2 === i0) continue;
            const ax = pos.getX(i0);
            const ay = pos.getY(i0);
            const az = pos.getZ(i0);
            const bx = pos.getX(i1);
            const by = pos.getY(i1);
            const bz = pos.getZ(i1);
            const cx = pos.getX(i2);
            const cy = pos.getY(i2);
            const cz = pos.getZ(i2);
            const abx = bx - ax;
            const aby = by - ay;
            const abz = bz - az;
            const acx = cx - ax;
            const acy = cy - ay;
            const acz = cz - az;
            const nx = aby * acz - abz * acy;
            const ny = abz * acx - abx * acz;
            const nz = abx * acy - aby * acx;
            if (nx * nx + ny * ny + nz * nz < 1e-18) continue;
            clean.push(i0, i1, i2);
        }
        if (clean.length < 9) {
            throw new TextMarkingError("boolean", `${label} mesh has no usable triangles`);
        }
        const mesh = new mod.Mesh({
            numProp: 3,
            vertProperties,
            triVerts: new Uint32Array(clean),
        });
        mesh.merge();
        try {
            return new mod.Manifold(mesh);
        } catch (e) {
            throw new TextMarkingError(
                "boolean",
                `${label} manifold construction failed: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    } finally {
        welded.dispose();
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
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.userData = userData ?? {};
    return geo;
}

/** Single manifold-3d WASM boolean. `op` add = emboss, subtract = engrave. */
export async function booleanTextSolid(
    host: BufferGeometry,
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
    op: "add" | "subtract",
): Promise<BufferGeometry> {
    const mod = await loadWasm();
    const a = geometryToManifold(mod, host, "host");
    const b = textGroupsToManifold(mod, groups, mapPoint);
    let result: ManifoldHandle | null = null;
    try {
        result = op === "add" ? a.add(b) : a.subtract(b);
        // Collapse boolean-cut slivers; 0.02 mm << 0.8 mm pocket and 0.05 mm depth spec.
        const cleaned = result.simplify(0.02);
        if (cleaned !== result) {
            result.delete();
            result = cleaned;
        }
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
    }
}
