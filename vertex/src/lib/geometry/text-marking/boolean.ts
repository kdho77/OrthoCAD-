// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
    TEXT_DEGENERATE_AREA_MM2,
    TEXT_DEGENERATE_MIN_ANGLE_DEG,
    TEXT_HOST_SI_PAD_MM,
    TEXT_HOST_SLIVER_MIN_ANGLE_DEG,
    TEXT_REGION_PAD_MM,
    TEXT_RESULT_MAX_EDGE_MM,
    TEXT_WELD_MM,
} from "./constants";
import { buildTextCutterMesh } from "./cutter";
import { TextMarkingError } from "./errors";
import { refineHostLocally, splitLongRegionEdges } from "./host-refine";
import { distToTextRegion } from "./quality";
import { countSoupSelfIntersections } from "./soup-intersect";
import type { MapTextPoint, TextApplyMeta, TextGlyphGroup, TextHostRepair } from "./types";

type ManifoldMesh = {
    merge: () => boolean;
    tolerance?: number;
};

type ManifoldCtor = {
    new (mesh: unknown): ManifoldHandle;
    reserveIDs?: (n: number) => number;
};

type ManifoldWasm = {
    setup: () => void;
    Manifold: ManifoldCtor;
    Mesh: new (args: {
        numProp: number;
        vertProperties: Float32Array;
        triVerts: Uint32Array;
        faceID?: Uint32Array;
        runIndex?: Uint32Array;
        runOriginalID?: Uint32Array;
        tolerance?: number;
    }) => ManifoldMesh;
};

/** True when the triangle centroid is inside (footprint + pad). */
export type TriBandPred = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
) => boolean;

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
        const nTri = clean.length / 3;
        const firstID = typeof mod.Manifold.reserveIDs === "function" ? mod.Manifold.reserveIDs(nTri) : 1;
        const faceID = new Uint32Array(nTri);
        const runIndex = new Uint32Array(nTri + 1);
        const runOriginalID = new Uint32Array(nTri);
        for (let i = 0; i < nTri; i++) {
            faceID[i] = firstID + i;
            runIndex[i] = i * 3;
            runOriginalID[i] = firstID + i;
        }
        runIndex[nTri] = nTri * 3;
        const mesh = new mod.Mesh({
            numProp: 3,
            vertProperties,
            triVerts: new Uint32Array(clean),
            faceID,
            runIndex,
            runOriginalID,
            tolerance: 0,
        });
        if ("tolerance" in mesh) mesh.tolerance = 0;
        // Unique faceIDs keep coplanar host/cutter triangles from merging.
        // Do not call mesh.merge() or Manifold.asOriginal().
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

export function makeFootprintBand(
    groups: TextGlyphGroup[],
    mapped: MapTextPoint,
    padMm: number,
): TriBandPred {
    const cell = 0.5;
    const grid = new Map<string, Array<{ x: number; y: number; z: number }>>();
    const keyOf = (x: number, y: number, z: number) =>
        `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;
    const push = (p: { x: number; y: number; z: number }) => {
        const k = keyOf(p.x, p.y, p.z);
        const list = grid.get(k);
        if (list) list.push(p);
        else grid.set(k, [p]);
    };
    for (const g of groups) {
        for (const t of [0, 0.5, 1]) {
            for (const p of g.outer) push(mapped(p, t));
            for (const hole of g.holes) for (const p of hole) push(mapped(p, t));
        }
    }
    const nearest = (x: number, y: number, z: number, maxMm: number): number => {
        let best = Infinity;
        const r = Math.ceil(maxMm / cell);
        const ix = Math.floor(x / cell);
        const iy = Math.floor(y / cell);
        const iz = Math.floor(z / cell);
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dz = -r; dz <= r; dz++) {
                    const list = grid.get(`${ix + dx}|${iy + dy}|${iz + dz}`);
                    if (!list) continue;
                    for (const q of list) {
                        const d = Math.hypot(x - q.x, y - q.y, z - q.z);
                        if (d < best) best = d;
                    }
                }
            }
        }
        return best;
    };
    return (ax, ay, az, bx, by, bz, cx, cy, cz) => {
        const mx = (ax + bx + cx) / 3;
        const my = (ay + by + cy) / 3;
        const mz = (az + bz + cz) / 3;
        const long = Math.max(
            Math.hypot(bx - ax, by - ay, bz - az),
            Math.hypot(cx - bx, cy - by, cz - bz),
            Math.hypot(ax - cx, ay - cy, az - cz),
        );
        const reach = padMm + long;
        return nearest(mx, my, mz, reach) <= reach;
    };
}

/**
 * Collapse needles (area < 1e-6 mm² or min angle < threshold) by welding the
 * shortest edge. When `band` is set, only triangles inside that band collapse.
 */
export function collapseDegenerateThenWeld(
    geo: BufferGeometry,
    forceWeldMm = 0,
    band?: TriBandPred,
    minAngleDeg = TEXT_DEGENERATE_MIN_ANGLE_DEG,
): BufferGeometry {
    const minAng = (minAngleDeg * Math.PI) / 180;
    const srcIndex = geo.getIndex();
    const srcPos = geo.getAttribute("position");
    if (!srcIndex || !srcPos) return geo;
    const src = srcIndex.array as ArrayLike<number>;
    const inBand = (
        i0: number,
        i1: number,
        i2: number,
        pos: { getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number },
    ) =>
        !band ||
        band(
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
    let found = false;
    for (let t = 0; t + 2 < srcIndex.count; t += 3) {
        const i0 = src[t] ?? 0;
        const i1 = src[t + 1] ?? 0;
        const i2 = src[t + 2] ?? 0;
        if (!inBand(i0, i1, i2, srcPos)) continue;
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
            if (!inBand(i0, i1, i2, pos)) continue;
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
    band?: TriBandPred,
): BufferGeometry {
    const a = geometryToManifold(mod, hostMesh, "host");
    const b = textGroupsToManifold(mod, groups, mapped, sidewallRings);
    let result: ManifoldHandle | null = null;
    try {
        result = op === "add" ? a.add(b) : a.subtract(b);
        const geo = manifoldToGeometry(result, userData);
        const cleaned = collapseDegenerateThenWeld(geo, 0, band);
        if (cleaned !== geo) geo.dispose();
        return cleaned;
    } finally {
        result?.delete();
        a.delete();
        b.delete();
    }
}

function soupHitsInBand(
    geo: BufferGeometry,
    groups: TextGlyphGroup[],
    mapped: MapTextPoint,
    padMm: number,
): ReturnType<typeof countSoupSelfIntersections> {
    const all = countSoupSelfIntersections(geo, TEXT_WELD_MM);
    const band = makeFootprintBand(groups, mapped, padMm);
    const pairs = all.pairs.filter((p) => {
        const c = p.centroid;
        const a = p.a[0]!;
        const b = p.a[1]!;
        const d = p.a[2]!;
        return (
            band(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z) ||
            band(
                p.b[0]!.x,
                p.b[0]!.y,
                p.b[0]!.z,
                p.b[1]!.x,
                p.b[1]!.y,
                p.b[1]!.z,
                p.b[2]!.x,
                p.b[2]!.y,
                p.b[2]!.z,
            ) ||
            Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z) < padMm
        );
    });
    return { real: pairs.length, coplanar: all.coplanar, pairs };
}

/** Repair pre-existing slivers / SI (min angle < 1°) inside footprint + pad only. */
export function repairHostBand(
    host: BufferGeometry,
    groups: TextGlyphGroup[],
    mapped: MapTextPoint,
    padMm = TEXT_HOST_SI_PAD_MM,
): { geo: BufferGeometry; report: TextHostRepair } {
    const band = makeFootprintBand(groups, mapped, padMm);
    const before = soupHitsInBand(host, groups, mapped, padMm);
    const repaired = collapseDegenerateThenWeld(host, 0, band, TEXT_HOST_SLIVER_MIN_ANGLE_DEG);
    const after = soupHitsInBand(repaired, groups, mapped, padMm);
    const src = host.getIndex();
    const dst = repaired.getIndex();
    const collapsed = Math.max(0, ((src?.count ?? 0) - (dst?.count ?? 0)) / 3);
    return {
        geo: repaired,
        report: { collapsed, siBefore: before.real, siAfter: after.real },
    };
}

function soupRealHits(geo: BufferGeometry): number {
    return countSoupSelfIntersections(geo, TEXT_WELD_MM).real;
}

function restoreOutsideVerts(
    result: BufferGeometry,
    host: BufferGeometry,
    groups: TextGlyphGroup[],
    mapped: MapTextPoint,
): void {
    const hostPos = host.getAttribute("position");
    const resPos = result.getAttribute("position");
    if (!hostPos || !resPos) return;
    const outlineWorld = groups.map((g) => ({
        outer: g.outer.map((p) => mapped(p, 0.5)),
        holes: g.holes.map((h) => h.map((p) => mapped(p, 0.5))),
    }));
    const outline = outlineWorld.flatMap((g) => [g.outer, ...g.holes].flat());
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const p of outline) {
        if (p.z < zMin) zMin = p.z;
        if (p.z > zMax) zMax = p.z;
    }
    const meta = {
        surface: zMax - zMin < 2 ? "bottom" : "wall",
        outlineWorld,
        centroids: [],
        mode: "engrave",
        depthMm: 0.8,
        heightMm: 0,
        capHeightMm: 6,
        advanceMm: 0,
        mappedWidthMm: 0,
    } as TextApplyMeta;
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
        if (distToTextRegion({ x: hx, y: hy, z: hz }, meta, outline) <= TEXT_REGION_PAD_MM) continue;
        let best = TEXT_WELD_MM;
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
    const mappedOrig = rebind ? rebind(host) : mapPoint;
    const hostFix = repairHostBand(host, groups, mappedOrig, TEXT_HOST_SI_PAD_MM);
    const hostWork = hostFix.geo;
    const regionBand = makeFootprintBand(groups, mappedOrig, TEXT_REGION_PAD_MM);
    const refined = refineHostLocally(hostWork, groups, mappedOrig, TEXT_REGION_PAD_MM);
    const prepped = collapseDegenerateThenWeld(refined, 0, regionBand);
    if (prepped !== refined && refined !== hostWork && refined !== host) {
        if (prepped !== host && prepped !== hostWork) refined.dispose();
    }
    const refinedOk = prepped !== host && prepped !== hostWork && indexedWatertight(prepped);
    const mappedRefined = rebind && refinedOk ? rebind(prepped) : mappedOrig;
    const finish = (geo: BufferGeometry): BufferGeometry => {
        geo.userData = { ...geo.userData, textHostRepair: hostFix.report };
        return geo;
    };
    try {
        let geo: BufferGeometry;
        let usedMap = mappedOrig;
        try {
            if (refinedOk) {
                geo = csgOnce(
                    mod,
                    prepped,
                    groups,
                    mappedRefined,
                    op,
                    host.userData,
                    sidewallRings,
                    regionBand,
                );
                usedMap = mappedRefined;
                if (soupRealHits(geo) > 0) {
                    const orig = csgOnce(
                        mod,
                        hostWork,
                        groups,
                        mappedOrig,
                        op,
                        host.userData,
                        sidewallRings,
                        regionBand,
                    );
                    if (soupRealHits(orig) === 0) {
                        geo.dispose();
                        geo = orig;
                        usedMap = mappedOrig;
                    } else {
                        orig.dispose();
                    }
                }
            } else {
                geo = csgOnce(
                    mod,
                    hostWork,
                    groups,
                    mappedOrig,
                    op,
                    host.userData,
                    sidewallRings,
                    regionBand,
                );
            }
        } catch (e) {
            if (refinedOk) {
                geo = csgOnce(
                    mod,
                    hostWork,
                    groups,
                    mappedOrig,
                    op,
                    host.userData,
                    sidewallRings,
                    regionBand,
                );
                usedMap = mappedOrig;
            } else if (e instanceof TextMarkingError) {
                throw e;
            } else {
                throw new TextMarkingError(
                    "boolean",
                    `boolean failed: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
        const cleaned = collapseDegenerateThenWeld(geo, 0, regionBand);
        if (cleaned !== geo) geo.dispose();
        restoreOutsideVerts(cleaned, host, groups, mappedOrig);
        const hits = countSoupSelfIntersections(cleaned, TEXT_WELD_MM);
        if (hits.real > 0 && hostFix.report.siAfter === 0) {
            const p = hits.pairs[0];
            throw new TextMarkingError(
                "stl-gate",
                    `text boolean self-intersects after a clean host ` +
                    `(hostRepair collapsed=${hostFix.report.collapsed} siBefore=${hostFix.report.siBefore}): ` +
                    `triA#${p?.triA}=${JSON.stringify(p?.a)} triB#${p?.triB}=${JSON.stringify(p?.b)} ` +
                    `centroid=${JSON.stringify(p?.centroid)}`,
            );
        }
        const nClean = (cleaned.getIndex()?.count ?? cleaned.getAttribute("position").count) / 3;
        if (nClean > 115_000) return finish(cleaned);
        const split = splitLongRegionEdges(
            cleaned,
            groups,
            usedMap,
            TEXT_REGION_PAD_MM,
            TEXT_RESULT_MAX_EDGE_MM,
            0,
        );
        if (split === cleaned) return finish(cleaned);
        const nSplit = (split.getIndex()?.count ?? split.getAttribute("position").count) / 3;
        if (nSplit > 120_000) {
            split.dispose();
            return finish(cleaned);
        }
        cleaned.dispose();
        return finish(split);
    } catch (e) {
        if (e instanceof TextMarkingError) throw e;
        throw new TextMarkingError(
            "boolean",
            `boolean failed: ${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
        if (prepped !== host && prepped !== hostWork) prepped.dispose();
        if (hostWork !== host && hostWork !== prepped) hostWork.dispose();
    }
}
