// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TEXT_DEGENERATE_AREA_MM2, TEXT_DEGENERATE_MIN_ANGLE_DEG, TEXT_WELD_MM } from "./constants";
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

function triMetrics(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
): { area: number; minAng: number; short: 0 | 1 | 2 } {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const bcx = cx - bx;
    const bcy = cy - by;
    const bcz = cz - bz;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const area = 0.5 * Math.hypot(nx, ny, nz);
    const lab = Math.hypot(abx, aby, abz);
    const lac = Math.hypot(acx, acy, acz);
    const lbc = Math.hypot(bcx, bcy, bcz);
    const ang = (opp: number, a: number, b: number) => {
        const den = 2 * a * b;
        if (den < 1e-18) return 0;
        const cos = Math.max(-1, Math.min(1, (a * a + b * b - opp * opp) / den));
        return Math.acos(cos);
    };
    const minAng = Math.min(ang(lbc, lab, lac), ang(lac, lab, lbc), ang(lab, lac, lbc));
    let short: 0 | 1 | 2 = 0;
    let shortL = lab;
    if (lbc < shortL) {
        short = 1;
        shortL = lbc;
    }
    if (lac < shortL) short = 2;
    return { area, minAng, short };
}

function indexedWatertight(geo: BufferGeometry): boolean {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!pos || !index) return false;
    const triCount = index.count / 3;
    const edgeCount = new Map<string, number>();
    const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let t = 0; t < triCount; t++) {
        const a = index.getX(t * 3);
        const b = index.getX(t * 3 + 1);
        const c = index.getX(t * 3 + 2);
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const e = edgeKey(u, v);
            edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
        }
    }
    for (const count of edgeCount.values()) {
        if (count !== 2) return false;
    }
    return true;
}

/**
 * Collapse needles (area < 1e-6 mm² or min angle < 0.5°) by welding the
 * shortest edge, then re-weld at TEXT_WELD_MM.
 */
export function collapseDegenerateThenWeld(geo: BufferGeometry): BufferGeometry {
    const minAng = (TEXT_DEGENERATE_MIN_ANGLE_DEG * Math.PI) / 180;
    const work = geo.index ? geo.clone() : weldedIndexed(geo);
    const userData = geo.userData;
    for (let pass = 0; pass < 4; pass++) {
        const pos = work.getAttribute("position");
        const index = work.getIndex();
        if (!pos || !index) break;
        const nVert = pos.count;
        const parent = new Uint32Array(nVert);
        for (let i = 0; i < nVert; i++) parent[i] = i;
        const find = (i: number): number => {
            let x = i;
            while (parent[x] !== x) x = parent[x]!;
            let y = i;
            while (y !== x) {
                const n = parent[y]!;
                parent[y] = x;
                y = n;
            }
            return x;
        };
        const union = (a: number, b: number) => {
            const pa = find(a);
            const pb = find(b);
            if (pa !== pb) parent[pb] = pa;
        };
        const src = index.array as ArrayLike<number>;
        let collapsed = 0;
        for (let t = 0; t + 2 < index.count; t += 3) {
            const i0 = src[t]!;
            const i1 = src[t + 1]!;
            const i2 = src[t + 2]!;
            const m = triMetrics(
                pos.getX(i0),
                pos.getY(i0),
                pos.getZ(i0),
                pos.getX(i1),
                pos.getY(i1),
                pos.getZ(i1),
                pos.getX(i2),
                pos.getY(i2),
                pos.getZ(i2),
            );
            if (m.area >= TEXT_DEGENERATE_AREA_MM2 && m.minAng >= minAng) continue;
            collapsed++;
            if (m.short === 0) union(i0, i1);
            else if (m.short === 1) union(i1, i2);
            else union(i2, i0);
        }
        if (!collapsed) break;
        const nextIndex: number[] = [];
        for (let t = 0; t + 2 < index.count; t += 3) {
            const a = find(src[t]!);
            const b = find(src[t + 1]!);
            const c = find(src[t + 2]!);
            if (a === b || b === c || c === a) continue;
            const m = triMetrics(
                pos.getX(a),
                pos.getY(a),
                pos.getZ(a),
                pos.getX(b),
                pos.getY(b),
                pos.getZ(b),
                pos.getX(c),
                pos.getY(c),
                pos.getZ(c),
            );
            if (m.area < TEXT_DEGENERATE_AREA_MM2 || m.minAng < minAng) continue;
            nextIndex.push(a, b, c);
        }
        if (nextIndex.length < 9) break;
        work.setIndex(nextIndex);
    }
    work.computeVertexNormals();
    work.computeBoundingBox();
    work.userData = userData ?? {};
    const welded = mergeVertices(work, TEXT_WELD_MM);
    welded.computeVertexNormals();
    welded.computeBoundingBox();
    welded.userData = userData ?? {};
    if (welded !== work) {
        if (indexedWatertight(welded) || !indexedWatertight(work)) {
            work.dispose();
            return welded;
        }
        welded.dispose();
        return work;
    }
    return welded;
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
    simplifyMm = 0,
): Promise<BufferGeometry> {
    const mod = await loadWasm();
    const a = geometryToManifold(mod, host, "host");
    const b = textGroupsToManifold(mod, groups, mapPoint);
    let result: ManifoldHandle | null = null;
    try {
        result = op === "add" ? a.add(b) : a.subtract(b);
        if (simplifyMm > 0) {
            const cleaned = result.simplify(simplifyMm);
            if (cleaned !== result) {
                result.delete();
                result = cleaned;
            }
        }
        const geo = manifoldToGeometry(result, host.userData);
        const cleaned = collapseDegenerateThenWeld(geo);
        if (cleaned !== geo) geo.dispose();
        return cleaned;
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
