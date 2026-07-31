// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Deterministic scan connected-component labeling (Phase 3A/B).
 *
 * STL/OBJ exports are often non-indexed triangle soup. Welding is for ANALYSIS
 * ONLY — extraction always copies original triangles of kept components.
 */

import type { BufferGeometry } from "three";
import * as THREE from "three";
import { FOOT_LENGTH_MM_HI, FOOT_LENGTH_MM_LO, inferScanDisplayScale } from "@/lib/geometry/scan-display";

/** Components at or below this triangle count collapse into one "small fragments" group in UI. */
export const SMALL_FRAGMENT_TRI_FLOOR = 200;

/** Weld tolerance as a fraction of the mesh's longest bbox dimension. */
export const WELD_TOLERANCE_FRAC = 1e-4;

export type ScanComponentStats = {
    id: number;
    triangleCount: number;
    weldedVertexCount: number;
    bboxMin: [number, number, number];
    bboxMax: [number, number, number];
    bboxSize: [number, number, number];
    bboxVolume: number;
    /** Absolute signed volume of the triangle set (0 for planar sheets). */
    componentVolume: number;
    /** componentVolume / bboxVolume (0 when bbox degenerates). */
    fillRatio: number;
    surfaceArea: number;
    closed: boolean;
    boundaryEdgeCount: number;
    rank: number;
    rankScore: number;
    rankReasons: string[];
};

export type ScanComponentLabeling = {
    components: ScanComponentStats[];
    /** Per original triangle index → component id (−1 if degenerate/skipped). */
    triangleComponentOf: Int32Array;
    originalTriangleCount: number;
    degenerateTriangleCount: number;
    weldTolerance: number;
    longestBbox: number;
    elapsedMs: number;
};

class UnionFind {
    parent: Int32Array;
    rank: Uint8Array;

    constructor(n: number) {
        this.parent = new Int32Array(n);
        this.rank = new Uint8Array(n);
        for (let i = 0; i < n; i++) this.parent[i] = i;
    }

    find(a: number): number {
        let x = a;
        while (this.parent[x]! !== x) {
            this.parent[x] = this.parent[this.parent[x]!]!;
            x = this.parent[x]!;
        }
        return x;
    }

    union(a: number, b: number): void {
        let ra = this.find(a);
        let rb = this.find(b);
        if (ra === rb) return;
        if (this.rank[ra]! < this.rank[rb]!) {
            const t = ra;
            ra = rb;
            rb = t;
        }
        this.parent[rb] = ra;
        if (this.rank[ra] === this.rank[rb]) this.rank[ra]!++;
    }
}

function triangleArea(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
): number {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    return 0.5 * Math.hypot(nx, ny, nz);
}

/** Signed tetra volume contribution (relative to origin) × 6. */
function signedVolume6(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
): number {
    return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
}

type TriVerts = {
    ax: number;
    ay: number;
    az: number;
    bx: number;
    by: number;
    bz: number;
    cx: number;
    cy: number;
    cz: number;
};

function readTriangles(geometry: BufferGeometry): { tris: TriVerts[]; originalTriangleCount: number } {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count === 0) return { tris: [], originalTriangleCount: 0 };
    const index = geometry.getIndex();
    const tris: TriVerts[] = [];
    if (index) {
        const n = Math.floor(index.count / 3);
        for (let t = 0; t < n; t++) {
            const ia = index.getX(t * 3)!;
            const ib = index.getX(t * 3 + 1)!;
            const ic = index.getX(t * 3 + 2)!;
            tris.push({
                ax: pos.getX(ia),
                ay: pos.getY(ia),
                az: pos.getZ(ia),
                bx: pos.getX(ib),
                by: pos.getY(ib),
                bz: pos.getZ(ib),
                cx: pos.getX(ic),
                cy: pos.getY(ic),
                cz: pos.getZ(ic),
            });
        }
        return { tris, originalTriangleCount: n };
    }
    const n = Math.floor(pos.count / 3);
    for (let t = 0; t < n; t++) {
        const i = t * 3;
        tris.push({
            ax: pos.getX(i),
            ay: pos.getY(i),
            az: pos.getZ(i),
            bx: pos.getX(i + 1),
            by: pos.getY(i + 1),
            bz: pos.getZ(i + 1),
            cx: pos.getX(i + 2),
            cy: pos.getY(i + 2),
            cz: pos.getZ(i + 2),
        });
    }
    return { tris, originalTriangleCount: n };
}

function bboxOfTris(tris: TriVerts[]): {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
    longest: number;
} {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const t of tris) {
        minX = Math.min(minX, t.ax, t.bx, t.cx);
        minY = Math.min(minY, t.ay, t.by, t.cy);
        minZ = Math.min(minZ, t.az, t.bz, t.cz);
        maxX = Math.max(maxX, t.ax, t.bx, t.cx);
        maxY = Math.max(maxY, t.ay, t.by, t.cy);
        maxZ = Math.max(maxZ, t.az, t.bz, t.cz);
    }
    if (!Number.isFinite(minX)) {
        return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], longest: 0 };
    }
    const size: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
    return {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        size,
        longest: Math.max(size[0], size[1], size[2]),
    };
}

/**
 * Weld by spatial hash + union-find over triangles sharing a welded vertex.
 * Preserves the caller's geometry; returns analysis labels only.
 */
export function weldAndLabelComponents(geometry: BufferGeometry): ScanComponentLabeling {
    const t0 = performance.now();
    const { tris, originalTriangleCount } = readTriangles(geometry);
    const triangleComponentOf = new Int32Array(originalTriangleCount);
    triangleComponentOf.fill(-1);

    if (tris.length === 0) {
        return {
            components: [],
            triangleComponentOf,
            originalTriangleCount,
            degenerateTriangleCount: 0,
            weldTolerance: 0,
            longestBbox: 0,
            elapsedMs: performance.now() - t0,
        };
    }

    const globalBbox = bboxOfTris(tris);
    const longestBbox = Math.max(globalBbox.longest, 1e-12);
    const weldTolerance = WELD_TOLERANCE_FRAC * longestBbox;
    const invCell = 1 / weldTolerance;

    // Valid (non-degenerate) triangle indices into `tris`.
    const validTriIdx: number[] = [];
    let degenerateTriangleCount = 0;
    for (let t = 0; t < tris.length; t++) {
        const tr = tris[t]!;
        const area = triangleArea(tr.ax, tr.ay, tr.az, tr.bx, tr.by, tr.bz, tr.cx, tr.cy, tr.cz);
        if (!(area > 1e-18)) {
            degenerateTriangleCount++;
            continue;
        }
        validTriIdx.push(t);
    }

    if (validTriIdx.length === 0) {
        return {
            components: [],
            triangleComponentOf,
            originalTriangleCount,
            degenerateTriangleCount,
            weldTolerance,
            longestBbox,
            elapsedMs: performance.now() - t0,
        };
    }

    // Spatial hash: cell key → first welded vertex id. Each valid tri contributes 3 corners.
    const cellToWeld = new Map<string, number>();
    const weldPositions: number[] = []; // xyz packed
    let weldCount = 0;

    const weldCorner = (x: number, y: number, z: number): number => {
        const ix = Math.floor(x * invCell);
        const iy = Math.floor(y * invCell);
        const iz = Math.floor(z * invCell);
        // Probe the cell and its 26 neighbours for an existing weld within tolerance.
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = `${ix + dx},${iy + dy},${iz + dz}`;
                    const existing = cellToWeld.get(key);
                    if (existing === undefined) continue;
                    const ex = weldPositions[existing * 3]!;
                    const ey = weldPositions[existing * 3 + 1]!;
                    const ez = weldPositions[existing * 3 + 2]!;
                    const ddx = x - ex;
                    const ddy = y - ey;
                    const ddz = z - ez;
                    if (ddx * ddx + ddy * ddy + ddz * ddz <= weldTolerance * weldTolerance) {
                        return existing;
                    }
                }
            }
        }
        const id = weldCount++;
        weldPositions.push(x, y, z);
        cellToWeld.set(`${ix},${iy},${iz}`, id);
        return id;
    };

    const uf = new UnionFind(validTriIdx.length);
    // welded vertex → first valid-local triangle index that touched it
    const weldOwner = new Int32Array(validTriIdx.length * 3 + 8);
    // Grow dynamically via Map for sparse weld ids
    const weldToTri = new Map<number, number>();

    const triWeldVerts: [number, number, number][] = new Array(validTriIdx.length);

    for (let vi = 0; vi < validTriIdx.length; vi++) {
        const tr = tris[validTriIdx[vi]!]!;
        const wa = weldCorner(tr.ax, tr.ay, tr.az);
        const wb = weldCorner(tr.bx, tr.by, tr.bz);
        const wc = weldCorner(tr.cx, tr.cy, tr.cz);
        triWeldVerts[vi] = [wa, wb, wc];
        for (const w of [wa, wb, wc]) {
            const prev = weldToTri.get(w);
            if (prev === undefined) weldToTri.set(w, vi);
            else uf.union(prev, vi);
        }
    }
    void weldOwner;

    // Roots → component id
    const rootToComp = new Map<number, number>();
    let compCount = 0;
    const validLocalComp = new Int32Array(validTriIdx.length);
    for (let vi = 0; vi < validTriIdx.length; vi++) {
        const root = uf.find(vi);
        let cid = rootToComp.get(root);
        if (cid === undefined) {
            cid = compCount++;
            rootToComp.set(root, cid);
        }
        validLocalComp[vi] = cid;
        triangleComponentOf[validTriIdx[vi]!] = cid;
    }

    // Accumulate per-component stats
    type Acc = {
        triCount: number;
        area: number;
        vol6: number;
        minX: number;
        minY: number;
        minZ: number;
        maxX: number;
        maxY: number;
        maxZ: number;
        weldSet: Set<number>;
        edgeCount: Map<string, number>;
    };
    const accs: Acc[] = Array.from({ length: compCount }, () => ({
        triCount: 0,
        area: 0,
        vol6: 0,
        minX: Infinity,
        minY: Infinity,
        minZ: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
        maxZ: -Infinity,
        weldSet: new Set<number>(),
        edgeCount: new Map(),
    }));

    const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

    for (let vi = 0; vi < validTriIdx.length; vi++) {
        const cid = validLocalComp[vi]!;
        const acc = accs[cid]!;
        const tr = tris[validTriIdx[vi]!]!;
        const [wa, wb, wc] = triWeldVerts[vi]!;
        acc.triCount++;
        acc.area += triangleArea(tr.ax, tr.ay, tr.az, tr.bx, tr.by, tr.bz, tr.cx, tr.cy, tr.cz);
        acc.vol6 += signedVolume6(tr.ax, tr.ay, tr.az, tr.bx, tr.by, tr.bz, tr.cx, tr.cy, tr.cz);
        acc.minX = Math.min(acc.minX, tr.ax, tr.bx, tr.cx);
        acc.minY = Math.min(acc.minY, tr.ay, tr.by, tr.cy);
        acc.minZ = Math.min(acc.minZ, tr.az, tr.bz, tr.cz);
        acc.maxX = Math.max(acc.maxX, tr.ax, tr.bx, tr.cx);
        acc.maxY = Math.max(acc.maxY, tr.ay, tr.by, tr.cy);
        acc.maxZ = Math.max(acc.maxZ, tr.az, tr.bz, tr.cz);
        acc.weldSet.add(wa);
        acc.weldSet.add(wb);
        acc.weldSet.add(wc);
        for (const [a, b] of [
            [wa, wb],
            [wb, wc],
            [wc, wa],
        ] as const) {
            const k = edgeKey(a, b);
            acc.edgeCount.set(k, (acc.edgeCount.get(k) ?? 0) + 1);
        }
    }

    const components: ScanComponentStats[] = accs.map((acc, id) => {
        const bboxSize: [number, number, number] = [
            acc.maxX - acc.minX,
            acc.maxY - acc.minY,
            acc.maxZ - acc.minZ,
        ];
        const bboxVolume = Math.max(bboxSize[0], 0) * Math.max(bboxSize[1], 0) * Math.max(bboxSize[2], 0);
        const componentVolume = Math.abs(acc.vol6) / 6;
        const fillRatio = bboxVolume > 1e-18 ? componentVolume / bboxVolume : 0;
        let boundaryEdgeCount = 0;
        for (const c of acc.edgeCount.values()) {
            if (c === 1) boundaryEdgeCount++;
        }
        return {
            id,
            triangleCount: acc.triCount,
            weldedVertexCount: acc.weldSet.size,
            bboxMin: [acc.minX, acc.minY, acc.minZ],
            bboxMax: [acc.maxX, acc.maxY, acc.maxZ],
            bboxSize,
            bboxVolume,
            componentVolume,
            fillRatio,
            surfaceArea: acc.area,
            closed: boundaryEdgeCount === 0,
            boundaryEdgeCount,
            rank: 0,
            rankScore: 0,
            rankReasons: [],
        };
    });

    return {
        components,
        triangleComponentOf,
        originalTriangleCount,
        degenerateTriangleCount,
        weldTolerance,
        longestBbox,
        elapsedMs: performance.now() - t0,
    };
}

function longestOf(size: [number, number, number]): number {
    return Math.max(size[0], size[1], size[2]);
}

function plausibleFootLongest(longestRaw: number): { ok: boolean; mm: number; scale: number } {
    const { displayScale } = inferScanDisplayScale(longestRaw);
    const mm = longestRaw * displayScale;
    const ok = mm >= FOOT_LENGTH_MM_LO * 0.5 && mm <= FOOT_LENGTH_MM_HI * 2;
    return { ok, mm, scale: displayScale };
}

/**
 * Rank components for foot auto-selection.
 * Discriminators in order: triangle count, fill ratio, plausible foot length.
 */
export function rankComponents(components: ScanComponentStats[]): ScanComponentStats[] {
    const ranked = components.map((c) => ({ ...c, rankReasons: [] as string[] }));
    ranked.sort((a, b) => {
        if (b.triangleCount !== a.triangleCount) return b.triangleCount - a.triangleCount;
        if (b.fillRatio !== a.fillRatio) return b.fillRatio - a.fillRatio;
        return longestOf(b.bboxSize) - longestOf(a.bboxSize);
    });

    // Soft penalty: components an order of magnitude off a plausible foot length sink.
    ranked.sort((a, b) => {
        const pa = plausibleFootLongest(longestOf(a.bboxSize));
        const pb = plausibleFootLongest(longestOf(b.bboxSize));
        if (pa.ok !== pb.ok) return pa.ok ? -1 : 1;
        if (b.triangleCount !== a.triangleCount) return b.triangleCount - a.triangleCount;
        if (b.fillRatio !== a.fillRatio) return b.fillRatio - a.fillRatio;
        return longestOf(b.bboxSize) - longestOf(a.bboxSize);
    });

    for (let i = 0; i < ranked.length; i++) {
        const c = ranked[i]!;
        c.rank = i + 1;
        const foot = plausibleFootLongest(longestOf(c.bboxSize));
        c.rankReasons = [
            `triangles=${c.triangleCount}`,
            `fillRatio=${c.fillRatio.toFixed(4)} (vol=${c.componentVolume.toFixed(6)} / bbox=${c.bboxVolume.toFixed(6)})`,
            `longest=${longestOf(c.bboxSize).toFixed(4)} → ~${foot.mm.toFixed(1)}mm (scale×${foot.scale}${foot.ok ? "" : ", outside foot band"})`,
            c.closed ? "closed" : `open, boundaryEdges=${c.boundaryEdgeCount}`,
        ];
        // Composite score for UI: primarily tri count, then fill.
        c.rankScore = c.triangleCount * 1e6 + c.fillRatio * 1e3 + longestOf(c.bboxSize);
    }
    return ranked;
}

/** Extract ORIGINAL triangles for the kept component ids (never welded). */
export function extractKeptGeometry(
    raw: BufferGeometry,
    labeling: ScanComponentLabeling,
    keptIds: Iterable<number>,
): BufferGeometry {
    const kept = new Set(keptIds);
    const { tris } = readTriangles(raw);
    const positions: number[] = [];
    for (let t = 0; t < tris.length; t++) {
        const cid = labeling.triangleComponentOf[t]!;
        if (!kept.has(cid)) continue;
        const tr = tris[t]!;
        positions.push(tr.ax, tr.ay, tr.az, tr.bx, tr.by, tr.bz, tr.cx, tr.cy, tr.cz);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
}

export type ComponentListGrouping = {
    /** Components shown as individual rows (above floor, or sole component). */
    listed: ScanComponentStats[];
    /** Tiny fragments collapsed into one UI toggle. */
    smallFragments: ScanComponentStats[];
    smallFragmentTriTotal: number;
};

export function groupSmallFragments(
    ranked: ScanComponentStats[],
    floor = SMALL_FRAGMENT_TRI_FLOOR,
): ComponentListGrouping {
    if (ranked.length <= 1) {
        return { listed: ranked, smallFragments: [], smallFragmentTriTotal: 0 };
    }
    const listed: ScanComponentStats[] = [];
    const smallFragments: ScanComponentStats[] = [];
    for (const c of ranked) {
        if (c.triangleCount <= floor && c.rank !== 1) smallFragments.push(c);
        else listed.push(c);
    }
    // Never hide the top-ranked foot inside the fragment bucket.
    if (listed.length === 0 && smallFragments.length > 0) {
        listed.push(smallFragments.shift()!);
    }
    let smallFragmentTriTotal = 0;
    for (const c of smallFragments) smallFragmentTriTotal += c.triangleCount;
    return { listed, smallFragments, smallFragmentTriTotal };
}

/** Bbox of the union of selected components (for unit inference / provisional orient). */
export function selectedComponentsBBox(
    components: ScanComponentStats[],
    keptIds: Iterable<number>,
): {
    min: THREE.Vector3;
    max: THREE.Vector3;
} | null {
    const kept = new Set(keptIds);
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let any = false;
    for (const c of components) {
        if (!kept.has(c.id)) continue;
        any = true;
        minX = Math.min(minX, c.bboxMin[0]);
        minY = Math.min(minY, c.bboxMin[1]);
        minZ = Math.min(minZ, c.bboxMin[2]);
        maxX = Math.max(maxX, c.bboxMax[0]);
        maxY = Math.max(maxY, c.bboxMax[1]);
        maxZ = Math.max(maxZ, c.bboxMax[2]);
    }
    if (!any) return null;
    return {
        min: new THREE.Vector3(minX, minY, minZ),
        max: new THREE.Vector3(maxX, maxY, maxZ),
    };
}
