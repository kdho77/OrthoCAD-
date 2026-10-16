// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TEXT_DEGENERATE_AREA_MM2, TEXT_DEGENERATE_MIN_ANGLE_DEG, TEXT_WELD_MM } from "./constants";
import { buildTextCutterMesh } from "./cutter";
import { TextMarkingError } from "./errors";
import { refineHostLocally } from "./host-refine";
import { countSoupSelfIntersections } from "./soup-intersect";
import type { MapTextPoint, TextGlyphGroup } from "./types";

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
};

type ManifoldHandle = {
    add: (other: ManifoldHandle) => ManifoldHandle;
    subtract: (other: ManifoldHandle) => ManifoldHandle;
    warp: (fn: (vert: [number, number, number]) => void) => ManifoldHandle;
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
    sidewallRings?: number,
): ManifoldHandle {
    let cutter: BufferGeometry | null = null;
    try {
        cutter = buildTextCutterMesh(groups, mapPoint, sidewallRings);
        const cleaned = collapseDegenerateThenWeld(cutter);
        if (cleaned !== cutter) {
            cutter.dispose();
            cutter = cleaned;
        }
        return geometryToManifold(mod, cutter, "text cutter");
    } catch (e) {
        throw new TextMarkingError(
            "boolean",
            `text solid failed: ${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
        cutter?.dispose();
    }
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
export function collapseDegenerateThenWeld(geo: BufferGeometry, forceWeldMm = 0): BufferGeometry {
    const minAng = (TEXT_DEGENERATE_MIN_ANGLE_DEG * Math.PI) / 180;
    const srcIndex = geo.getIndex();
    const srcPos = geo.getAttribute("position");
    if (!srcIndex || !srcPos) return geo;
    const src = srcIndex.array as ArrayLike<number>;
    let found = false;
    for (let t = 0; t + 2 < srcIndex.count; t += 3) {
        const i0 = src[t] ?? 0;
        const i1 = src[t + 1] ?? 0;
        const i2 = src[t + 2] ?? 0;
        const m = triMetrics(
            srcPos.getX(i0),
            srcPos.getY(i0),
            srcPos.getZ(i0),
            srcPos.getX(i1),
            srcPos.getY(i1),
            srcPos.getZ(i1),
            srcPos.getX(i2),
            srcPos.getY(i2),
            srcPos.getZ(i2),
        );
        if (m.area < TEXT_DEGENERATE_AREA_MM2 || m.minAng < minAng) {
            found = true;
            break;
        }
    }
    if (!found && forceWeldMm <= 0) return geo;

    const work = geo.clone();
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
            while (parent[x] !== x) x = parent[x] ?? x;
            let y = i;
            while (y !== x) {
                const n = parent[y] ?? y;
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
        const idx = index.array as ArrayLike<number>;
        let collapsed = 0;
        for (let t = 0; t + 2 < index.count; t += 3) {
            const i0 = idx[t] ?? 0;
            const i1 = idx[t + 1] ?? 0;
            const i2 = idx[t + 2] ?? 0;
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
            const a = find(idx[t] ?? 0);
            const b = find(idx[t + 1] ?? 0);
            const c = find(idx[t + 2] ?? 0);
            // Skip tris that collapsed to a line. Do not drop leftover needles —
            // that opens the surface. Another pass unions their short edges.
            if (a === b || b === c || c === a) continue;
            nextIndex.push(a, b, c);
        }
        if (nextIndex.length < 9) break;
        work.setIndex(nextIndex);
    }
    work.computeVertexNormals();
    work.computeBoundingBox();
    work.userData = userData ?? {};
    // Re-weld only when the snap stays a 2-manifold. A global mergeVertices on
    // Manifold-3d CSG output otherwise creates nm edges.
    const originalWatertight = indexedWatertight(geo);
    const tryWeld = (src: BufferGeometry, mm: number): BufferGeometry | null => {
        const welded = mergeVertices(src, mm);
        welded.computeVertexNormals();
        welded.computeBoundingBox();
        welded.userData = userData ?? {};
        if (indexedWatertight(welded)) {
            if (welded !== src) src.dispose();
            return welded;
        }
        if (welded !== src) welded.dispose();
        return null;
    };
    if (forceWeldMm > 0) {
        const snapped = tryWeld(work, forceWeldMm);
        if (snapped) return snapped;
    }
    const welded = tryWeld(work, TEXT_WELD_MM);
    if (welded) return welded;
    if (indexedWatertight(work) || !originalWatertight) return work;
    work.dispose();
    return geo;
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

function csgOnce(
    mod: ManifoldWasm,
    hostMesh: BufferGeometry,
    groups: TextGlyphGroup[],
    mapped: MapTextPoint,
    op: "add" | "subtract",
    userData: unknown,
    sidewallRings?: number,
): BufferGeometry {
    const a = geometryToManifold(mod, hostMesh, "host");
    const b = textGroupsToManifold(mod, groups, mapped, sidewallRings);
    let result: ManifoldHandle | null = null;
    try {
        result = op === "add" ? a.add(b) : a.subtract(b);
        const geo = manifoldToGeometry(result, userData);
        const cleaned = collapseDegenerateThenWeld(geo);
        if (cleaned !== geo) geo.dispose();
        return cleaned;
    } finally {
        result?.delete();
        a.delete();
        b.delete();
    }
}

function soupRealHits(geo: BufferGeometry): number {
    return countSoupSelfIntersections(geo, TEXT_WELD_MM).real;
}

function restoreOutsideVerts(result: BufferGeometry, host: BufferGeometry): void {
    const hostPos = host.getAttribute("position");
    const resPos = result.getAttribute("position");
    if (!hostPos || !resPos) return;
    const cell = 0.25;
    const grid = new Map<string, number[]>();
    const keyOf = (x: number, y: number, z: number) =>
        `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;
    for (let i = 0; i < resPos.count; i++) {
        const k = keyOf(resPos.getX(i), resPos.getY(i), resPos.getZ(i));
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
    }
    const claimed = new Set<number>();
    for (let hi = 0; hi < hostPos.count; hi++) {
        const hx = hostPos.getX(hi);
        const hy = hostPos.getY(hi);
        const hz = hostPos.getZ(hi);
        let best = 0.2;
        let bestI = -1;
        const ix = Math.floor(hx / cell);
        const iy = Math.floor(hy / cell);
        const iz = Math.floor(hz / cell);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const list = grid.get(`${ix + dx}|${iy + dy}|${iz + dz}`);
                    if (!list) continue;
                    for (const ri of list) {
                        if (claimed.has(ri)) continue;
                        const d = Math.hypot(
                            hx - resPos.getX(ri),
                            hy - resPos.getY(ri),
                            hz - resPos.getZ(ri),
                        );
                        if (d < best) {
                            best = d;
                            bestI = ri;
                        }
                    }
                }
            }
        }
        if (bestI >= 0 && best > 1e-4) {
            resPos.setXYZ(bestI, hx, hy, hz);
            claimed.add(bestI);
        }
    }
    resPos.needsUpdate = true;
}

/** Single manifold-3d WASM boolean. `op` add = emboss, subtract = engrave. */
export async function booleanTextSolid(
    host: BufferGeometry,
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
    op: "add" | "subtract",
    rebind?: (geo: BufferGeometry) => MapTextPoint,
    sidewallRings?: number,
): Promise<BufferGeometry> {
    const mod = await loadWasm();
    const refined = refineHostLocally(host, groups, mapPoint);
    const prepped = collapseDegenerateThenWeld(refined);
    if (prepped !== refined && refined !== host) {
        // Keep `refined` if collapse was a no-op; otherwise the clone can go.
        if (prepped !== host) refined.dispose();
    }
    const refinedOk = prepped !== host && indexedWatertight(prepped);
    const mappedRefined = rebind && refinedOk ? rebind(prepped) : mapPoint;
    const mappedOrig = rebind ? rebind(host) : mapPoint;
    try {
        let geo: BufferGeometry;
        try {
            geo = csgOnce(mod, host, groups, mappedOrig, op, host.userData, sidewallRings);
            if (refinedOk && soupRealHits(geo) > 0) {
                geo.dispose();
                geo = csgOnce(mod, prepped, groups, mappedRefined, op, host.userData, sidewallRings);
            }
        } catch (e) {
            if (refinedOk) {
                geo = csgOnce(mod, prepped, groups, mappedRefined, op, host.userData, sidewallRings);
            } else if (e instanceof TextMarkingError) {
                throw e;
            } else {
                throw new TextMarkingError(
                    "boolean",
                    `boolean failed: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
        const cleaned = collapseDegenerateThenWeld(geo);
        if (cleaned !== geo) geo.dispose();
        restoreOutsideVerts(cleaned, host);
        return cleaned;
    } catch (e) {
        if (e instanceof TextMarkingError) throw e;
        throw new TextMarkingError(
            "boolean",
            `boolean failed: ${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
        if (prepped !== host) prepped.dispose();
    }
}
