// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Cheap gate in front of POST /v1/slice. Meshes that slice today are returned
// as the same bytes. An oversized watertight mesh is simplified on its flat
// faces only. A mesh that cannot be sliced fails here instead of hanging.

/** Single-name Men's 9 feet land under this. The stalled upload was 134,310. */
export const SLICE_MESH_SIMPLIFY_ABOVE = 132_000;

/** Stop once the upload is back in the range that slices in a few seconds. */
export const SLICE_MESH_TARGET_TRIANGLES = 125_000;

/**
 * Foot length tops out at 320 mm. The manufacturing mesh, including the leader,
 * stays well under this. Anything larger is off the belt plate.
 */
export const SLICE_MESH_PLATE_LIMIT_MM = 500;

const TRI_BYTES = 50;
const HEADER_BYTES = 84;

export class UnsliceableMeshError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UnsliceableMeshError";
    }
}

export interface SliceMeshBBox {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
}

export interface SliceMeshManifold {
    openEdges: number;
    nonManifoldEdges: number;
    /** Closed components. A foot plus its leader is two shells; they are not unioned. */
    shells: number;
    isWatertight: boolean;
}

export interface SliceMeshStats {
    bytes: number;
    triangles: number;
    bbox: SliceMeshBBox | null;
    manifold: SliceMeshManifold | null;
    finite: boolean;
}

interface ParsedStl {
    triangles: number;
    /** xyz, 9 floats per triangle, matching file order. */
    xyz: Float64Array;
}

function unsliceable(detail: string): UnsliceableMeshError {
    return new UnsliceableMeshError(`Manufacturing mesh is not sliceable: ${detail}`);
}

/** Binary STL, or null when the buffer is not one. Callers pass those through. */
export function parseBinaryStl(model: Uint8Array): ParsedStl | null {
    if (model.byteLength < HEADER_BYTES) return null;
    const view = new DataView(model.buffer, model.byteOffset, model.byteLength);
    const triangles = view.getUint32(80, true);
    if (!Number.isInteger(triangles) || triangles < 0) return null;
    if (model.byteLength !== HEADER_BYTES + triangles * TRI_BYTES) return null;
    const xyz = new Float64Array(triangles * 9);
    let offset = HEADER_BYTES;
    let n = 0;
    for (let t = 0; t < triangles; t++) {
        offset += 12;
        for (let k = 0; k < 9; k++) xyz[n++] = view.getFloat32(offset + k * 4, true);
        offset += 36 + 2;
    }
    return { triangles, xyz };
}

function bboxOf(xyz: Float64Array): { bbox: SliceMeshBBox; finite: boolean } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let finite = true;
    for (let i = 0; i < xyz.length; i += 3) {
        const x = xyz[i]!;
        const y = xyz[i + 1]!;
        const z = xyz[i + 2]!;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            finite = false;
            continue;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    if (!finite || !Number.isFinite(minX)) {
        return {
            finite,
            bbox: {
                minX: finite ? minX : Number.NaN,
                maxX: finite ? maxX : Number.NaN,
                minY: finite ? minY : Number.NaN,
                maxY: finite ? maxY : Number.NaN,
                minZ: finite ? minZ : Number.NaN,
                maxZ: finite ? maxZ : Number.NaN,
            },
        };
    }
    return { finite, bbox: { minX, maxX, minY, maxY, minZ, maxZ } };
}

function outsidePlate(bbox: SliceMeshBBox): boolean {
    const limit = SLICE_MESH_PLATE_LIMIT_MM;
    const values = [bbox.minX, bbox.maxX, bbox.minY, bbox.maxY, bbox.minZ, bbox.maxZ];
    return values.some((v) => Math.abs(v) > limit);
}

const QUANT = 1e4;

function manifoldOf(xyz: Float64Array): SliceMeshManifold {
    const edgeCount = new Map<string, number>();
    const parent = new Map<string, string>();
    const key = (x: number, y: number, z: number) =>
        `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`;
    const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const find = (id: string): string => {
        let root = id;
        while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
        let cursor = id;
        while (cursor !== root) {
            const next = parent.get(cursor) ?? cursor;
            parent.set(cursor, root);
            cursor = next;
        }
        return root;
    };
    const unite = (a: string, b: string) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    };
    const verts = new Set<string>();
    const n = xyz.length / 9;
    for (let t = 0; t < n; t++) {
        const o = t * 9;
        const ka = key(xyz[o]!, xyz[o + 1]!, xyz[o + 2]!);
        const kb = key(xyz[o + 3]!, xyz[o + 4]!, xyz[o + 5]!);
        const kc = key(xyz[o + 6]!, xyz[o + 7]!, xyz[o + 8]!);
        verts.add(ka);
        verts.add(kb);
        verts.add(kc);
        unite(ka, kb);
        unite(kb, kc);
        for (const [a, b] of [
            [ka, kb],
            [kb, kc],
            [kc, ka],
        ] as const) {
            const e = edgeKey(a, b);
            edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
        }
    }
    let openEdges = 0;
    let nonManifoldEdges = 0;
    for (const count of edgeCount.values()) {
        if (count === 1) openEdges++;
        else if (count > 2) nonManifoldEdges++;
    }
    const roots = new Set<string>();
    for (const v of verts) roots.add(find(v));
    return {
        openEdges,
        nonManifoldEdges,
        shells: roots.size,
        isWatertight: openEdges === 0 && nonManifoldEdges === 0,
    };
}

export function sliceMeshStats(model: Uint8Array): SliceMeshStats {
    const parsed = parseBinaryStl(model);
    if (!parsed || parsed.triangles === 0) {
        return {
            bytes: model.byteLength,
            triangles: parsed?.triangles ?? 0,
            bbox: null,
            manifold: null,
            finite: false,
        };
    }
    const { bbox, finite } = bboxOf(parsed.xyz);
    return {
        bytes: model.byteLength,
        triangles: parsed.triangles,
        bbox: finite ? bbox : null,
        manifold: finite ? manifoldOf(parsed.xyz) : null,
        finite,
    };
}

function formatBox(bbox: SliceMeshBBox): string {
    const n = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "nan");
    return `X[${n(bbox.minX)},${n(bbox.maxX)}] Y[${n(bbox.minY)},${n(bbox.maxY)}] Z[${n(bbox.minZ)},${n(bbox.maxZ)}]`;
}

interface Indexed {
    pos: Float64Array;
    tris: Int32Array;
}

function weld(xyz: Float64Array, cell: number): Indexed {
    const nTri = xyz.length / 9;
    const map = new Map<string, number>();
    const coords: number[] = [];
    const tris = new Int32Array(nTri * 3);
    const idOf = (x: number, y: number, z: number): number => {
        const ix = Math.round(x / cell);
        const iy = Math.round(y / cell);
        const iz = Math.round(z / cell);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const k = `${ix + dx}|${iy + dy}|${iz + dz}`;
                    const hit = map.get(k);
                    if (hit == null) continue;
                    const px = coords[hit * 3]!;
                    const py = coords[hit * 3 + 1]!;
                    const pz = coords[hit * 3 + 2]!;
                    if ((px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2 <= cell * cell) return hit;
                }
            }
        }
        const id = coords.length / 3;
        coords.push(x, y, z);
        map.set(`${ix}|${iy}|${iz}`, id);
        return id;
    };
    let w = 0;
    for (let i = 0; i < xyz.length; i += 3) {
        tris[w++] = idOf(xyz[i]!, xyz[i + 1]!, xyz[i + 2]!);
    }
    return { pos: Float64Array.from(coords), tris };
}

function triNormal(
    pos: Float64Array,
    a: number,
    b: number,
    c: number,
): { x: number; y: number; z: number; len: number } | null {
    const ax = pos[a * 3]!;
    const ay = pos[a * 3 + 1]!;
    const az = pos[a * 3 + 2]!;
    const bx = pos[b * 3]! - ax;
    const by = pos[b * 3 + 1]! - ay;
    const bz = pos[b * 3 + 2]! - az;
    const cx = pos[c * 3]! - ax;
    const cy = pos[c * 3 + 1]! - ay;
    const cz = pos[c * 3 + 2]! - az;
    const x = by * cz - bz * cy;
    const y = bz * cx - bx * cz;
    const z = bx * cy - by * cx;
    const len = Math.hypot(x, y, z);
    if (len < 1e-12) return null;
    return { x, y, z, len };
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Collapse interior edges of flat regions. Curved loft triangles are not
 * coplanar, so a Men's 9 shell that is already under the cap is never rewritten
 * and a dense text floor can be. The leader's edges are centimetres long.
 */
function simplifyFlatFaces(indexed: Indexed, target: number): Indexed {
    const pos = indexed.pos;
    let tris = indexed.tris;
    const limits = [0.35, 0.6, 0.9];
    for (const limit of limits) {
        for (let pass = 0; pass < 12 && tris.length / 3 > target; pass++) {
            const nTri = tris.length / 3;
            const nV = pos.length / 3;
            const vertTris: number[][] = Array.from({ length: nV }, () => []);
            const edgeFaces = new Map<string, number[]>();
            const normals: Array<{ x: number; y: number; z: number; len: number } | null> = [];
            for (let t = 0; t < nTri; t++) {
                const a = tris[t * 3]!;
                const b = tris[t * 3 + 1]!;
                const c = tris[t * 3 + 2]!;
                vertTris[a]!.push(t);
                vertTris[b]!.push(t);
                vertTris[c]!.push(t);
                normals.push(triNormal(pos, a, b, c));
                for (const [u, v] of [
                    [a, b],
                    [b, c],
                    [c, a],
                ] as const) {
                    const k = edgeKey(u, v);
                    let list = edgeFaces.get(k);
                    if (!list) {
                        list = [];
                        edgeFaces.set(k, list);
                    }
                    list.push(t);
                }
            }
            const flatFan = (v: number, ref: { x: number; y: number; z: number; len: number }): boolean => {
                for (const t of vertTris[v]!) {
                    const n = normals[t];
                    if (!n) return false;
                    const dot = (n.x * ref.x + n.y * ref.y + n.z * ref.z) / (n.len * ref.len);
                    if (dot < 0.999) return false;
                }
                return vertTris[v]!.length > 0;
            };
            const candidates: Array<{ u: number; v: number; len: number }> = [];
            for (const [k, faces] of edgeFaces) {
                if (faces.length !== 2) continue;
                const n0 = normals[faces[0]!]!;
                const n1 = normals[faces[1]!]!;
                if (!n0 || !n1) continue;
                const dot = (n0.x * n1.x + n0.y * n1.y + n0.z * n1.z) / (n0.len * n1.len);
                if (dot < 0.999) continue;
                const [us, vs] = k.split("|");
                const u = Number(us);
                const v = Number(vs);
                const len = Math.hypot(
                    pos[u * 3]! - pos[v * 3]!,
                    pos[u * 3 + 1]! - pos[v * 3 + 1]!,
                    pos[u * 3 + 2]! - pos[v * 3 + 2]!,
                );
                if (len > limit || len < 1e-12) continue;
                if (!flatFan(u, n0) || !flatFan(v, n0)) continue;
                candidates.push({ u, v, len });
            }
            candidates.sort((a, b) => a.len - b.len || a.u - b.u || a.v - b.v);
            const neighbors = (v: number): Set<number> => {
                const out = new Set<number>();
                for (const t of vertTris[v]!) {
                    const a = tris[t * 3]!;
                    const b = tris[t * 3 + 1]!;
                    const c = tris[t * 3 + 2]!;
                    if (a !== v) out.add(a);
                    if (b !== v) out.add(b);
                    if (c !== v) out.add(c);
                }
                return out;
            };
            const used = new Set<number>();
            const collapses: Array<{ u: number; v: number }> = [];
            for (const e of candidates) {
                if (used.has(e.u) || used.has(e.v)) continue;
                const faces = edgeFaces.get(edgeKey(e.u, e.v))!;
                const apexes: number[] = [];
                for (const t of faces) {
                    const ids = [tris[t * 3]!, tris[t * 3 + 1]!, tris[t * 3 + 2]!];
                    const apex = ids.find((id) => id !== e.u && id !== e.v);
                    if (apex == null) {
                        apexes.length = 0;
                        break;
                    }
                    apexes.push(apex);
                }
                if (apexes.length !== 2) continue;
                const nu = neighbors(e.u);
                const nv = neighbors(e.v);
                let linkOk = true;
                for (const n of nv) {
                    if (n === e.u) continue;
                    if (nu.has(n) && n !== apexes[0] && n !== apexes[1]) {
                        linkOk = false;
                        break;
                    }
                }
                if (!linkOk) continue;
                let flip = false;
                for (const t of vertTris[e.v]!) {
                    const ids = [tris[t * 3]!, tris[t * 3 + 1]!, tris[t * 3 + 2]!];
                    if (ids.includes(e.u)) continue;
                    const replaced = ids.map((id) => (id === e.v ? e.u : id)) as [number, number, number];
                    if (
                        replaced[0] === replaced[1] ||
                        replaced[1] === replaced[2] ||
                        replaced[2] === replaced[0]
                    ) {
                        continue;
                    }
                    const next = triNormal(pos, replaced[0], replaced[1], replaced[2]);
                    const prev = normals[t];
                    if (!next || !prev) {
                        flip = true;
                        break;
                    }
                    const d = (next.x * prev.x + next.y * prev.y + next.z * prev.z) / (next.len * prev.len);
                    if (d < 0.5) {
                        flip = true;
                        break;
                    }
                }
                if (flip) continue;
                // Lock the 1-ring so one pass cannot collapse two edges that share a face.
                used.add(e.u);
                used.add(e.v);
                for (const n of nu) used.add(n);
                for (const n of nv) used.add(n);
                collapses.push({ u: e.u, v: e.v });
                if (nTri - collapses.length * 2 <= target) break;
            }
            if (!collapses.length) break;
            const remap = new Int32Array(nV);
            for (let i = 0; i < nV; i++) remap[i] = i;
            for (const c of collapses) remap[c.v] = c.u;
            const next: number[] = [];
            for (let t = 0; t < nTri; t++) {
                const a = remap[tris[t * 3]!]!;
                const b = remap[tris[t * 3 + 1]!]!;
                const c = remap[tris[t * 3 + 2]!]!;
                if (a === b || b === c || c === a) continue;
                next.push(a, b, c);
            }
            tris = Int32Array.from(next);
        }
        if (tris.length / 3 <= target) break;
    }
    return { pos, tris };
}

function writeBinaryStl(header: Uint8Array, indexed: Indexed, leaderXyz: Float64Array | null): Uint8Array {
    const body = indexed.tris.length / 3;
    const leader = leaderXyz ? leaderXyz.length / 9 : 0;
    const triangles = body + leader;
    const out = new Uint8Array(HEADER_BYTES + triangles * TRI_BYTES);
    out.set(header.subarray(0, 80), 0);
    const view = new DataView(out.buffer);
    view.setUint32(80, triangles, true);
    let offset = HEADER_BYTES;
    const put = (x: number, y: number, z: number) => {
        view.setFloat32(offset, x, true);
        offset += 4;
        view.setFloat32(offset, y, true);
        offset += 4;
        view.setFloat32(offset, z, true);
        offset += 4;
    };
    const pos = indexed.pos;
    for (let t = 0; t < body; t++) {
        const a = indexed.tris[t * 3]!;
        const b = indexed.tris[t * 3 + 1]!;
        const c = indexed.tris[t * 3 + 2]!;
        const n = triNormal(pos, a, b, c);
        const nx = n ? n.x / n.len : 0;
        const ny = n ? n.y / n.len : 0;
        const nz = n ? n.z / n.len : 0;
        put(nx, ny, nz);
        put(pos[a * 3]!, pos[a * 3 + 1]!, pos[a * 3 + 2]!);
        put(pos[b * 3]!, pos[b * 3 + 1]!, pos[b * 3 + 2]!);
        put(pos[c * 3]!, pos[c * 3 + 1]!, pos[c * 3 + 2]!);
        offset += 2;
    }
    if (leaderXyz) {
        for (let i = 0; i < leaderXyz.length; i += 9) {
            const ax = leaderXyz[i]!;
            const ay = leaderXyz[i + 1]!;
            const az = leaderXyz[i + 2]!;
            const bx = leaderXyz[i + 3]!;
            const by = leaderXyz[i + 4]!;
            const bz = leaderXyz[i + 5]!;
            const cx = leaderXyz[i + 6]!;
            const cy = leaderXyz[i + 7]!;
            const cz = leaderXyz[i + 8]!;
            const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
            const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
            const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
            const nl = Math.hypot(nx, ny, nz) || 1;
            put(nx / nl, ny / nl, nz / nl);
            put(ax, ay, az);
            put(bx, by, bz);
            put(cx, cy, cz);
            offset += 2;
        }
    }
    return out;
}

/** Last 24 triangles are the leader when they sit past the tall part of the foot. */
function splitLeader(xyz: Float64Array): { body: Float64Array; leader: Float64Array | null } {
    const n = xyz.length / 9;
    const leaderN = 24;
    if (n <= leaderN) return { body: xyz, leader: null };
    let tallMaxX = -Infinity;
    for (let t = 0; t < n - leaderN; t++) {
        for (let k = 0; k < 3; k++) {
            const o = t * 9 + k * 3;
            if (xyz[o + 2]! > 12) tallMaxX = Math.max(tallMaxX, xyz[o]!);
        }
    }
    if (!Number.isFinite(tallMaxX)) return { body: xyz, leader: null };
    let leaderMaxX = -Infinity;
    let leaderMaxZ = -Infinity;
    for (let t = n - leaderN; t < n; t++) {
        for (let k = 0; k < 3; k++) {
            const o = t * 9 + k * 3;
            leaderMaxX = Math.max(leaderMaxX, xyz[o]!);
            leaderMaxZ = Math.max(leaderMaxZ, xyz[o + 2]!);
        }
    }
    if (leaderMaxZ > 10.01 || leaderMaxX < tallMaxX + 10) return { body: xyz, leader: null };
    return { body: xyz.subarray(0, (n - leaderN) * 9), leader: xyz.subarray((n - leaderN) * 9) };
}

/**
 * Same bytes when the mesh is in the range that slices today.
 * Oversized watertight meshes lose only interior triangles of flat faces.
 */
export function prepareManufacturingMeshForSlice(model: Uint8Array): Uint8Array {
    const parsed = parseBinaryStl(model);
    if (!parsed || parsed.triangles === 0) return model;
    const { bbox, finite } = bboxOf(parsed.xyz);
    if (!finite) throw unsliceable("a coordinate is not finite");
    if (outsidePlate(bbox)) {
        throw unsliceable(`bounding box ${formatBox(bbox)} is outside the belt plate`);
    }
    if (parsed.triangles <= SLICE_MESH_SIMPLIFY_ABOVE) return model;

    const { body, leader } = splitLeader(parsed.xyz);
    const welded = weld(body, 1e-4);
    const simplified = simplifyFlatFaces(welded, SLICE_MESH_TARGET_TRIANGLES - (leader ? 24 : 0));
    const written = writeBinaryStl(model, simplified, leader);
    const after = sliceMeshStats(written);
    if (!after.manifold?.isWatertight) {
        const open = after.manifold?.openEdges ?? -1;
        const nm = after.manifold?.nonManifoldEdges ?? -1;
        throw unsliceable(
            `simplification from ${parsed.triangles} to ${after.triangles} triangles broke the shell (open=${open} nonManifold=${nm})`,
        );
    }
    if (after.triangles > SLICE_MESH_SIMPLIFY_ABOVE) {
        throw unsliceable(
            `${parsed.triangles} triangles could not be simplified below ${SLICE_MESH_SIMPLIFY_ABOVE} (still ${after.triangles})`,
        );
    }
    console.log("[vertexslice] simplified manufacturing mesh before slice", {
        before: parsed.triangles,
        after: after.triangles,
        bbox: formatBox(bbox),
    });
    return written;
}
