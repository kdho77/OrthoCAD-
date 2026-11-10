// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { analyzeManifoldBuffers } from "@/lib/geometry/manifold-core";
import { getAfoState, ingestOrientedScan, useAfoStore } from "@/stores/afo-store";
import { cloneableWorkerOptions } from "./afo-engine";
import { detectTibialCrest } from "./crest";
import {
    AFO_EDGE_MM,
    AFO_FLARE_MM,
    AFO_FOOTPLATE_FLARE_CAP_MM,
    AFO_THICKNESS_MM,
    defaultAfoDesignState,
} from "./defaults";
import { countMeshBodies, duplicateDirectedEdgeCount, meshProjector, meshSignedVolume } from "./mesh-ops";
import { buildAfoShell, trimPolygonForShell } from "./shell";
import { buildClinicalFixtureA, buildLiveFrameLeg, buildUnitSphereMesh } from "./synthetic-leg";
import { AFO_TRIM_NO_MESH, designLandmarkPlacementActive, trimPointerIsClick } from "./trim-preview";
import { balanceBracePins, fitSurfaceSpline, posteriorLeafPins } from "./trim-spline";
import type { AfoTriMesh, AfoVec3 } from "./types";

function dist(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function at(mesh: AfoTriMesh, i: number): AfoVec3 {
    return {
        x: mesh.positions[i * 3] ?? 0,
        y: mesh.positions[i * 3 + 1] ?? 0,
        z: mesh.positions[i * 3 + 2] ?? 0,
    };
}

function pointSegmentDist(p: AfoVec3, a: AfoVec3, b: AfoVec3): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const ab2 = abx * abx + aby * aby + abz * abz || 1;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / ab2));
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}

function distToPolyline(p: AfoVec3, loop: AfoVec3[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++)
        best = Math.min(best, pointSegmentDist(p, loop[i]!, loop[(i + 1) % loop.length]!));
    return best;
}

/** Skin-side opening loops: boundaries of the faces that still lie on the source. */
function innerRimLoops(shell: AfoTriMesh, source: AfoTriMesh): AfoVec3[][] {
    const projector = meshProjector(source);
    const nAll = (shell.positions.length / 3) | 0;
    const err: number[] = [];
    for (let i = 0; i < nAll; i++) err.push(projector.closest(at(shell, i)).errorMm);
    let n = 0;
    while (n < nAll && (err[n] ?? 1) < 0.2) n++;
    const onSkin: boolean[] = err.map((e) => e < 0.12);
    const t = (shell.indices.length / 3) | 0;
    const edgeCount = new Map<string, { a: number; b: number; n: number }>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [shell.indices[i * 3] ?? 0, shell.indices[i * 3 + 1] ?? 0, shell.indices[i * 3 + 2] ?? 0];
        if (!vs.every((v) => onSkin[v])) continue;
        for (let e = 0; e < 3; e++) {
            const a = vs[e]!;
            const b = vs[(e + 1) % 3]!;
            const k = key(a, b);
            const prev = edgeCount.get(k);
            if (prev) prev.n += 1;
            else edgeCount.set(k, { a, b, n: 1 });
        }
    }
    const next = new Map<number, number[]>();
    const unused = new Set<string>();
    for (const e of edgeCount.values()) {
        if (e.n !== 1) continue;
        (next.get(e.a) ?? next.set(e.a, []).get(e.a)!).push(e.b);
        (next.get(e.b) ?? next.set(e.b, []).get(e.b)!).push(e.a);
        unused.add(e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`);
    }
    const loops: AfoVec3[][] = [];
    for (const start of next.keys()) {
        const open = (next.get(start) ?? []).some((b) =>
            unused.has(start < b ? `${start}|${b}` : `${b}|${start}`),
        );
        if (!open) continue;
        const ids = [start];
        const seen = new Set<number>([start]);
        let cur = start;
        for (let guard = 0; guard < nAll; guard++) {
            const nxt = (next.get(cur) ?? []).find((v) =>
                unused.has(cur < v ? `${cur}|${v}` : `${v}|${cur}`),
            );
            if (nxt == null) break;
            unused.delete(cur < nxt ? `${cur}|${nxt}` : `${nxt}|${cur}`);
            if (seen.has(nxt)) break;
            ids.push(nxt);
            seen.add(nxt);
            cur = nxt;
        }
        if (ids.length >= 3) loops.push(ids.map((i) => at(shell, i)));
    }
    return loops;
}

function rimDihedralDeg(shell: AfoTriMesh): { deg: number; x: number; y: number; z: number } {
    const face0 = shell.rimFaceStart ?? (shell.indices.length / 3) | 0;
    const t = (shell.indices.length / 3) | 0;
    const normals: AfoVec3[] = [];
    const rim = new Uint8Array(t);
    for (let i = 0; i < t; i++) {
        const vs = [shell.indices[i * 3] ?? 0, shell.indices[i * 3 + 1] ?? 0, shell.indices[i * 3 + 2] ?? 0];
        if (i >= face0) rim[i] = 1;
        const a = at(shell, vs[0]!);
        const b = at(shell, vs[1]!);
        const c = at(shell, vs[2]!);
        const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
        const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-6) rim[i] = 0;
        normals.push({
            x: nx / (len || 1),
            y: ny / (len || 1),
            z: nz / (len || 1),
        });
    }
    const edgeFaces = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [shell.indices[i * 3] ?? 0, shell.indices[i * 3 + 1] ?? 0, shell.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = edgeFaces.get(k);
            if (list) list.push(i);
            else edgeFaces.set(k, [i]);
        }
    }
    let worst = 0;
    let where = { x: 0, y: 0, z: 0 };
    for (const faces of edgeFaces.values()) {
        if (faces.length !== 2) continue;
        if (!rim[faces[0]!] || !rim[faces[1]!]) continue;
        const va = [0, 1, 2].map((k) => shell.indices[faces[0]! * 3 + k] ?? 0);
        const vb = [0, 1, 2].map((k) => shell.indices[faces[1]! * 3 + k] ?? 0);
        const shared = va.filter((v) => vb.includes(v));
        if (shared.length !== 2) continue;
        const pa = at(shell, shared[0]!);
        const pb = at(shell, shared[1]!);
        if (dist(pa, pb) < 0.05) continue;
        const n0 = normals[faces[0]!]!;
        const n1 = normals[faces[1]!]!;
        const c = Math.min(1, Math.max(-1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
        const deg = (Math.acos(c) * 180) / Math.PI;
        if (deg > worst) {
            worst = deg;
            where = { x: (pa.x + pb.x) * 0.5, y: (pa.y + pb.y) * 0.5, z: (pa.z + pb.z) * 0.5 };
        }
    }
    return { deg: worst, ...where };
}

/** Skin-skin edges near the opening. The rim-to-skin junction is left out; it is meant to be about 90°. */
function nearOpeningFold(
    shell: AfoTriMesh,
    opening: AfoVec3[],
): { count: number; deg: number; x: number; y: number; z: number } {
    const face0 = shell.rimFaceStart ?? (shell.indices.length / 3) | 0;
    const t = (shell.indices.length / 3) | 0;
    const normals: AfoVec3[] = [];
    const areas: number[] = [];
    for (let i = 0; i < t; i++) {
        const ia = shell.indices[i * 3] ?? 0;
        const ib = shell.indices[i * 3 + 1] ?? 0;
        const ic = shell.indices[i * 3 + 2] ?? 0;
        const a = at(shell, ia);
        const b = at(shell, ib);
        const c = at(shell, ic);
        const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
        const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const len = Math.hypot(nx, ny, nz);
        areas.push(len * 0.5);
        normals.push({ x: nx / (len || 1), y: ny / (len || 1), z: nz / (len || 1) });
    }
    const edgeFaces = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [shell.indices[i * 3] ?? 0, shell.indices[i * 3 + 1] ?? 0, shell.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = edgeFaces.get(k);
            if (list) list.push(i);
            else edgeFaces.set(k, [i]);
        }
    }
    let count = 0;
    let worst = 0;
    let worstArea = 0;
    let worstSide = "";
    let worstLen = 0;
    let where: { x: number; y: number; z: number; tag?: string } = { x: 0, y: 0, z: 0 };
    for (const [k, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const f0 = faces[0]!;
        const f1 = faces[1]!;
        if (f0 >= face0 || f1 >= face0) continue;
        const [sa, sb] = k.split("|").map(Number);
        const pa = at(shell, sa!);
        const pb = at(shell, sb!);
        if (dist(pa, pb) < 0.05) continue;
        const mid = { x: (pa.x + pb.x) * 0.5, y: (pa.y + pb.y) * 0.5, z: (pa.z + pb.z) * 0.5 };
        if ((areas[f0] ?? 0) < 0.01 || (areas[f1] ?? 0) < 0.01) continue;
        const n0 = normals[f0]!;
        const n1 = normals[f1]!;
        const dotN = Math.min(1, Math.max(-1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
        const deg = (Math.acos(dotN) * 180) / Math.PI;
        if (deg > 60) {
            count++;
            if (deg > worst) {
                worst = deg;
                worstArea = Math.min(areas[f0] ?? 0, areas[f1] ?? 0);
                const n0v = shell.outerVertex0 ?? 0;
                const small = (areas[f0] ?? 0) <= (areas[f1] ?? 0) ? f0 : f1;
                const sv = [
                    shell.indices[small * 3] ?? 0,
                    shell.indices[small * 3 + 1] ?? 0,
                    shell.indices[small * 3 + 2] ?? 0,
                ];
                worstSide = sv.every((v) => v < n0v)
                    ? "inner"
                    : sv.every((v) => v >= n0v && v < n0v * 2)
                      ? "outer"
                      : "other";
                worstLen = dist(pa, pb);
                where = mid;
                const dv = sv.map((v) => distToPolyline(at(shell, v), opening).toFixed(2)).join(",");
                where = { ...where, tag: dv };
            }
        }
    }
    return { count, deg: worst, area: worstArea, side: worstSide, len: worstLen, ...where };
}

const BUILDER_FOLD_CAP: Record<string, { plain: number; flared: number; d: number }> = {
    "left balance-brace": { plain: 27, flared: 74, d: 30 },
    "left posterior-leaf": { plain: 27, flared: 74, d: 47 },
    "right balance-brace": { plain: 27, flared: 74, d: 34 },
    "right posterior-leaf": { plain: 27, flared: 74, d: 48 },
};

/** Leg edges whose faces meet at more than 30°. Inherited shell folds map back onto these. */
function legCreases(leg: AfoTriMesh): { a: AfoVec3; b: AfoVec3 }[] {
    const t = (leg.indices.length / 3) | 0;
    const normals: AfoVec3[] = [];
    const areas: number[] = [];
    for (let i = 0; i < t; i++) {
        const a = at(leg, leg.indices[i * 3] ?? 0);
        const b = at(leg, leg.indices[i * 3 + 1] ?? 0);
        const c = at(leg, leg.indices[i * 3 + 2] ?? 0);
        const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
        const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const len = Math.hypot(nx, ny, nz);
        areas.push(len * 0.5);
        normals.push({ x: nx / (len || 1), y: ny / (len || 1), z: nz / (len || 1) });
    }
    const edgeFaces = new Map<string, number[]>();
    const ends = new Map<string, [number, number]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [leg.indices[i * 3] ?? 0, leg.indices[i * 3 + 1] ?? 0, leg.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = edgeFaces.get(k) ?? [];
            list.push(i);
            edgeFaces.set(k, list);
            ends.set(k, [vs[e]!, vs[(e + 1) % 3]!]);
        }
    }
    const creases: { a: AfoVec3; b: AfoVec3 }[] = [];
    for (const [k, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        if ((areas[faces[0]!] ?? 0) < 1e-4 || (areas[faces[1]!] ?? 0) < 1e-4) continue;
        const n0 = normals[faces[0]!]!;
        const n1 = normals[faces[1]!]!;
        const dotN = Math.min(1, Math.max(-1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
        const deg = (Math.acos(dotN) * 180) / Math.PI;
        if (deg <= 30) continue;
        const [sa, sb] = ends.get(k)!;
        creases.push({ a: at(leg, sa), b: at(leg, sb) });
    }
    return creases;
}

/**
 * Builder folds are skin-skin dihedrals over 60° on faces of at least 0.01 mm².
 * Class a sits on a leg crease (>30°) within 1.5 mm after mapping back through
 * the thickness. Class c is a rim-to-rim fold. The rim-to-skin junction is not
 * counted. Class d is a flare/cap move. The rest are offset folds, class b.
 */
function classifyBuilderFolds(
    shell: AfoTriMesh,
    leg: AfoTriMesh,
    creases: { a: AfoVec3; b: AfoVec3 }[],
    plain: AfoTriMesh | null,
): { a: number; b: number; c: number; d: number } {
    const n = shell.outerVertex0 ?? 0;
    const face0 = shell.rimFaceStart ?? 0;
    const t = (shell.indices.length / 3) | 0;
    const normals: AfoVec3[] = [];
    const areas: number[] = [];
    for (let i = 0; i < t; i++) {
        const a = at(shell, shell.indices[i * 3] ?? 0);
        const b = at(shell, shell.indices[i * 3 + 1] ?? 0);
        const c = at(shell, shell.indices[i * 3 + 2] ?? 0);
        const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
        const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const len = Math.hypot(nx, ny, nz);
        areas.push(len * 0.5);
        normals.push({ x: nx / (len || 1), y: ny / (len || 1), z: nz / (len || 1) });
    }
    const edgeFaces = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < face0; i++) {
        const vs = [shell.indices[i * 3] ?? 0, shell.indices[i * 3 + 1] ?? 0, shell.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = edgeFaces.get(k) ?? [];
            list.push(i);
            edgeFaces.set(k, list);
        }
    }
    const legProj = meshProjector(leg);
    const counts = { a: 0, b: 0, c: 0, d: 0 };
    for (const [k, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const f0 = faces[0]!;
        const f1 = faces[1]!;
        if ((areas[f0] ?? 0) < 0.01 || (areas[f1] ?? 0) < 0.01) continue;
        const n0 = normals[f0]!;
        const n1 = normals[f1]!;
        const dotN = Math.min(1, Math.max(-1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
        const deg = (Math.acos(dotN) * 180) / Math.PI;
        if (deg <= 60) continue;
        const [sa, sb] = k.split("|").map(Number);
        const toInner = (v: number) => (v < n ? v : v < n * 2 ? v - n : -1);
        const ia = toInner(sa!);
        const ib = toInner(sb!);
        const source = plain ?? shell;
        const pa = ia >= 0 ? at(source, ia) : at(shell, sa!);
        const pb = ib >= 0 ? at(source, ib) : at(shell, sb!);
        const mid = { x: (pa.x + pb.x) * 0.5, y: (pa.y + pb.y) * 0.5, z: (pa.z + pb.z) * 0.5 };
        const onLeg = legProj.closest(mid).point;
        let inherited = false;
        for (const crease of creases) {
            if (pointSegmentDist(onLeg, crease.a, crease.b) <= 1.5) {
                inherited = true;
                break;
            }
        }
        if (inherited) {
            counts.a++;
            continue;
        }
        const moved = (v: number) => {
            if (plain == null || v < 0) return 0;
            return dist(at(shell, v), at(plain, v));
        };
        if (Math.max(moved(ia), moved(ib)) > 0.3) counts.d++;
        else counts.b++;
    }
    // Rim-to-rim folds are the trim/rim class. The rim-to-skin junction is
    // excluded: that edge is meant to turn about 90°.
    const rimEdge = new Map<string, number[]>();
    for (let i = face0; i < t; i++) {
        const vs = [shell.indices[i * 3] ?? 0, shell.indices[i * 3 + 1] ?? 0, shell.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = rimEdge.get(k) ?? [];
            list.push(i);
            rimEdge.set(k, list);
        }
    }
    for (const faces of rimEdge.values()) {
        if (faces.length !== 2) continue;
        const f0 = faces[0]!;
        const f1 = faces[1]!;
        if ((areas[f0] ?? 0) < 0.01 || (areas[f1] ?? 0) < 0.01) continue;
        const n0 = normals[f0]!;
        const n1 = normals[f1]!;
        const dotN = Math.min(1, Math.max(-1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
        const deg = (Math.acos(dotN) * 180) / Math.PI;
        if (deg > 60) counts.c++;
    }
    return counts;
}

function minFace(shell: AfoTriMesh): { area: number; altitude: number } {
    const t = (shell.indices.length / 3) | 0;
    let area = Infinity;
    let altitude = Infinity;
    for (let i = 0; i < t; i++) {
        const a = at(shell, shell.indices[i * 3] ?? 0);
        const b = at(shell, shell.indices[i * 3 + 1] ?? 0);
        const c = at(shell, shell.indices[i * 3 + 2] ?? 0);
        const ab = dist(a, b);
        const bc = dist(b, c);
        const ca = dist(c, a);
        const longest = Math.max(ab, bc, ca);
        const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
        const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const face = Math.hypot(nx, ny, nz) * 0.5;
        if (face <= 0 || longest < 1e-8) continue;
        if (face < area) area = face;
        const alt = (2 * face) / longest;
        if (alt < altitude) altitude = alt;
    }
    return { area, altitude };
}

function sliverWhy(shell: AfoTriMesh): string {
    const n = shell.outerVertex0 ?? 0;
    const face0 = shell.rimFaceStart ?? 0;
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const count = new Map<string, number>();
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (!vs.every((v) => v < n) && !vs.every((v) => v >= n && v < n * 2)) continue;
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            count.set(k, (count.get(k) ?? 0) + 1);
        }
    }
    const next = new Map<number, number[]>();
    for (const [k, nUse] of count) {
        if (nUse !== 1) continue;
        const [a, b] = k.split("|").map(Number);
        (next.get(a!) ?? next.set(a!, []).get(a)!).push(b!);
        (next.get(b!) ?? next.set(b!, []).get(b)!).push(a!);
    }
    const turnOf = (v: number) => {
        const nb = next.get(v) ?? [];
        if (nb.length !== 2) return null;
        const a = at(shell, nb[0]!);
        const b = at(shell, v);
        const c = at(shell, nb[1]!);
        const va = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
        const vc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
        const la = Math.hypot(va.x, va.y, va.z);
        const lc = Math.hypot(vc.x, vc.y, vc.z);
        const cos = Math.min(1, Math.max(-1, (va.x * vc.x + va.y * vc.y + va.z * vc.z) / (la * lc || 1)));
        const turn = ((Math.PI - Math.acos(cos)) * 180) / Math.PI;
        const chord = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        const ab2 = chord.x * chord.x + chord.y * chord.y + chord.z * chord.z || 1;
        const t = Math.min(
            1,
            Math.max(0, ((b.x - a.x) * chord.x + (b.y - a.y) * chord.y + (b.z - a.z) * chord.z) / ab2),
        );
        const foot = { x: a.x + chord.x * t, y: a.y + chord.y * t, z: a.z + chord.z * t };
        const dist = Math.hypot(b.x - foot.x, b.y - foot.y, b.z - foot.z);
        return { turn, dist };
    };
    const bits: string[] = [];
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        const inner = vs.every((v) => v < n);
        const outer = vs.every((v) => v >= n && v < n * 2);
        if (!inner && !outer) continue;
        let onLoop = false;
        for (let e = 0; e < 3; e++) if ((count.get(key(vs[e]!, vs[(e + 1) % 3]!)) ?? 0) === 1) onLoop = true;
        if (!onLoop) continue;
        const p = vs.map((v) => at(shell, v));
        const area =
            Math.hypot(
                (p[1]!.y - p[0]!.y) * (p[2]!.z - p[0]!.z) - (p[1]!.z - p[0]!.z) * (p[2]!.y - p[0]!.y),
                (p[1]!.z - p[0]!.z) * (p[2]!.x - p[0]!.x) - (p[1]!.x - p[0]!.x) * (p[2]!.z - p[0]!.z),
                (p[1]!.x - p[0]!.x) * (p[2]!.y - p[0]!.y) - (p[1]!.y - p[0]!.y) * (p[2]!.x - p[0]!.x),
            ) * 0.5;
        if (area >= 0.001) continue;
        const lens = [0, 1, 2].map((e) => dist(p[e]!, p[(e + 1) % 3]!));
        const longE = lens.indexOf(Math.max(...lens));
        const apex = vs[(longE + 2) % 3]!;
        const here = turnOf(apex);
        const mate = inner ? apex + n : apex - n;
        const there = mate >= 0 && mate < n * 2 ? turnOf(mate) : null;
        const why =
            here == null
                ? "boundary degree is not 2"
                : here.turn > 2
                  ? `turn ${here.turn.toFixed(2)}° over 2°`
                  : here.dist > 0.01
                    ? `chord distance ${here.dist.toFixed(4)} mm over 0.01`
                    : there == null
                      ? "mate is not a paired boundary vertex"
                      : there.turn > 2
                        ? `mate turn ${there.turn.toFixed(2)}° over 2°, collapsing it would move that loop`
                        : there.dist > 0.01
                          ? `mate chord distance ${there.dist.toFixed(4)} mm over 0.01`
                          : "paired collapse was rejected: a neighbour would invert or fall under 0.01 mm², or the rim arc is not collinear";
        const cx = (p[0]!.x + p[1]!.x + p[2]!.x) / 3;
        const cy = (p[0]!.y + p[1]!.y + p[2]!.y) / 3;
        const cz = (p[0]!.z + p[1]!.z + p[2]!.z) / 3;
        bits.push(`${area.toFixed(4)} mm² at (${cx.toFixed(1)}, ${cy.toFixed(1)}, ${cz.toFixed(1)}): ${why}`);
    }
    return bits.join("; ");
}

function loopSlivers(shell: AfoTriMesh): { count: number; area: number; x: number; y: number; z: number } {
    const n = shell.outerVertex0 ?? 0;
    const face0 = shell.rimFaceStart ?? 0;
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const count = new Map<string, number>();
    const facesOf = new Map<string, number[]>();
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        const inner = vs.every((v) => v < n);
        const outer = vs.every((v) => v >= n && v < n * 2);
        if (!inner && !outer) continue;
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            count.set(k, (count.get(k) ?? 0) + 1);
            const list = facesOf.get(k) ?? [];
            list.push(f);
            facesOf.set(k, list);
        }
    }
    const loopFace = new Set<number>();
    for (const [k, nUse] of count) if (nUse === 1) for (const f of facesOf.get(k) ?? []) loopFace.add(f);
    let found = 0;
    let area = Infinity;
    let where = { x: 0, y: 0, z: 0 };
    for (const f of loopFace) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        const p = vs.map((v) => at(shell, v));
        const ux = p[1]!.x - p[0]!.x;
        const uy = p[1]!.y - p[0]!.y;
        const uz = p[1]!.z - p[0]!.z;
        const vx = p[2]!.x - p[0]!.x;
        const vy = p[2]!.y - p[0]!.y;
        const vz = p[2]!.z - p[0]!.z;
        const a = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
        if (a >= 0.001) continue;
        found++;
        if (a < area) {
            area = a;
            where = {
                x: (p[0]!.x + p[1]!.x + p[2]!.x) / 3,
                y: (p[0]!.y + p[1]!.y + p[2]!.y) / 3,
                z: (p[0]!.z + p[1]!.z + p[2]!.z) / 3,
            };
        }
    }
    return { count: found, area, ...where };
}

function shellOpening(shell: AfoTriMesh): AfoVec3[] {
    const n = shell.outerVertex0 ?? 0;
    const face0 = shell.rimFaceStart ?? 0;
    const count = new Map<string, { a: number; b: number; n: number }>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (!vs.every((v) => v < n)) continue;
        for (let e = 0; e < 3; e++) {
            const a = vs[e]!;
            const b = vs[(e + 1) % 3]!;
            const k = key(a, b);
            const prev = count.get(k);
            if (prev) prev.n += 1;
            else count.set(k, { a, b, n: 1 });
        }
    }
    const next = new Map<number, number[]>();
    for (const e of count.values()) {
        if (e.n !== 1) continue;
        const ab = next.get(e.a) ?? [];
        ab.push(e.b);
        next.set(e.a, ab);
        const ba = next.get(e.b) ?? [];
        ba.push(e.a);
        next.set(e.b, ba);
    }
    const start = next.keys().next().value as number | undefined;
    if (start == null) return [];
    const loop = [start];
    const seen = new Set<number>([start]);
    let cur = start;
    for (let guard = 0; guard < n + 2; guard++) {
        const nxt = (next.get(cur) ?? []).find((v) => !seen.has(v));
        if (nxt == null) break;
        loop.push(nxt);
        seen.add(nxt);
        cur = nxt;
    }
    return loop.map((i) => at(shell, i));
}

function minInteriorWall(shell: AfoTriMesh, opening: AfoVec3[]): number {
    const n = shell.outerVertex0 ?? 0;
    const face0 = shell.rimFaceStart ?? 0;
    const innerIdx: number[] = [];
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (!vs.every((v) => v < n)) continue;
        innerIdx.push(vs[0]!, vs[1]!, vs[2]!);
    }
    const proj = meshProjector({
        positions: shell.positions.subarray(0, n * 3),
        indices: new Uint32Array(innerIdx),
    });
    let min = Infinity;
    for (let i = 0; i < n; i++) {
        const p = at(shell, i);
        if (distToPolyline(p, opening) < 10) continue;
        const outer = at(shell, n + i);
        min = Math.min(min, proj.closest(outer).errorMm);
    }
    return min;
}

/** Closest-point thickness of the outer skin against the inner skin. */
function shellClearance(
    shell: AfoTriMesh,
    opening: AfoVec3[],
): {
    farOut: number;
    farLo: number;
    farHi: number;
    edgeOut: number;
    edgeLo: number;
    edgeHi: number;
    blendOut: number;
} {
    const n = shell.outerVertex0 ?? 0;
    const face0 = shell.rimFaceStart ?? 0;
    const innerIdx: number[] = [];
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (!vs.every((v) => v < n)) continue;
        innerIdx.push(vs[0]!, vs[1]!, vs[2]!);
    }
    const proj = meshProjector({
        positions: shell.positions.subarray(0, n * 3),
        indices: new Uint32Array(innerIdx),
    });
    let farOut = 0;
    let farLo = Infinity;
    let farHi = 0;
    let edgeOut = 0;
    let edgeLo = Infinity;
    let edgeHi = 0;
    let blendOut = 0;
    for (let i = 0; i < n; i++) {
        const p = at(shell, i);
        const dOpen = distToPolyline(p, opening);
        const gap = proj.closest(at(shell, n + i)).errorMm;
        if (dOpen <= 0.4) {
            edgeLo = Math.min(edgeLo, gap);
            edgeHi = Math.max(edgeHi, gap);
            if (gap < AFO_EDGE_MM - 0.1 || gap > AFO_EDGE_MM + 0.1) edgeOut++;
        } else if (dOpen >= 10) {
            farLo = Math.min(farLo, gap);
            farHi = Math.max(farHi, gap);
            if (gap < AFO_THICKNESS_MM - 0.1 || gap > AFO_THICKNESS_MM + 0.1) farOut++;
        } else {
            const linear = AFO_EDGE_MM + (AFO_THICKNESS_MM - AFO_EDGE_MM) * (dOpen / 10);
            if (gap < linear - 0.1) blendOut++;
        }
    }
    return { farOut, farLo, farHi, edgeOut, edgeLo, edgeHi, blendOut };
}

describe("AFO trim acceptance", () => {
    test("shell defaults match the Windows app and the footplate cap is named", () => {
        expect(AFO_THICKNESS_MM).toBe(4);
        expect(AFO_EDGE_MM).toBe(2.5);
        expect(AFO_FLARE_MM).toBe(2.5);
        expect(AFO_FOOTPLATE_FLARE_CAP_MM).toBe(1);
    });

    test("fixture and live-frame legs have no directed edge twice", () => {
        expect(duplicateDirectedEdgeCount(buildClinicalFixtureA().mesh)).toBe(0);
        expect(duplicateDirectedEdgeCount(buildLiveFrameLeg("left"))).toBe(0);
        expect(duplicateDirectedEdgeCount(buildLiveFrameLeg("right"))).toBe(0);
        expect(meshSignedVolume(buildClinicalFixtureA().mesh)).toBeGreaterThan(0);
    });

    test("ingestOrientedScan repairs reversed winding", () => {
        const sphere = buildUnitSphereMesh(30, 8);
        const flipped: AfoTriMesh = {
            positions: sphere.positions,
            indices: new Uint32Array(sphere.indices),
        };
        for (let i = 0; i < flipped.indices.length; i += 3) {
            const tmp = flipped.indices[i + 1] ?? 0;
            flipped.indices[i + 1] = flipped.indices[i + 2] ?? 0;
            flipped.indices[i + 2] = tmp;
        }
        expect(meshSignedVolume(flipped)).toBeLessThan(0);
        useAfoStore.getState().resetSession();
        ingestOrientedScan(flipped);
        const stored = useAfoStore.getState().sourceMesh;
        expect(stored).not.toBeNull();
        expect(duplicateDirectedEdgeCount(stored!)).toBe(0);
        expect(meshSignedVolume(stored!)).toBeGreaterThan(0);
        const afo = getAfoState();
        const fromOriented = detectTibialCrest(stored!, afo.corrections.braceHeightMm, afo.clinicalMarkers);
        expect(afo.crest.points).toEqual(fromOriented.points);
    });

    test("a pin is a click, not an orbit drag, and landmark mode is exclusive", () => {
        expect(trimPointerIsClick(0, false)).toBe(true);
        expect(trimPointerIsClick(4, false)).toBe(true);
        expect(trimPointerIsClick(4.1, false)).toBe(false);
        expect(trimPointerIsClick(1, true)).toBe(false);
        expect(AFO_TRIM_NO_MESH.length).toBeGreaterThan(10);
        expect(
            designLandmarkPlacementActive({
                placingTrim: false,
                placingClinical: false,
                placingDesignLandmarks: true,
            }),
        ).toBe(true);
        expect(
            designLandmarkPlacementActive({
                placingTrim: true,
                placingClinical: false,
                placingDesignLandmarks: true,
            }),
        ).toBe(false);
        expect(
            designLandmarkPlacementActive({
                placingTrim: false,
                placingClinical: true,
                placingDesignLandmarks: true,
            }),
        ).toBe(false);
        expect(
            designLandmarkPlacementActive({
                placingTrim: false,
                placingClinical: false,
                placingDesignLandmarks: false,
            }),
        ).toBe(false);
        expect(
            designLandmarkPlacementActive({
                placingTrim: false,
                placingClinical: false,
                placingDesignLandmarks: true,
                measuring: true,
            }),
        ).toBe(false);
    });

    test("worker shell options clone without the progress callback", () => {
        const safe = cloneableWorkerOptions({
            thicknessMm: 4,
            edgeMm: 2.5,
            flareMm: 2.5,
            onProgress: () => undefined,
            trimPolygon: [{ x: 1, y: 2, z: 3 }],
        });
        expect(safe).not.toHaveProperty("onProgress");
        expect(() => structuredClone(safe)).not.toThrow();
        expect(safe.trimPolygon).toEqual([{ x: 1, y: 2, z: 3 }]);
    });

    test("a sharp pin corner is exempt and the spans stay within 25 degrees", () => {
        const quad: AfoTriMesh = {
            positions: new Float32Array([-40, -30, 0, 40, -30, 0, 40, 30, 0, -40, 30, 0]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        };
        const pins = [
            { x: -20, y: -8, z: 0 },
            { x: 0, y: -8, z: 0 },
            { x: 6, y: 10, z: 0 },
            { x: 20, y: -8, z: 0 },
            { x: 8, y: 12, z: 0 },
            { x: -8, y: 12, z: 0 },
        ];
        const fit = fitSurfaceSpline(quad, pins, { closed: true, spacingMm: 1 });
        expect(fit.reasons.join(" | ")).toBe("");
        expect(fit.ok).toBe(true);
        expect(fit.maxTurnDeg).toBeLessThanOrEqual(25);
    });

    test("a smooth sphere rim stays under 60 degrees", () => {
        const sphere = buildUnitSphereMesh(36, 14);
        const pins: AfoVec3[] = [];
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            pins.push({ x: Math.cos(a) * 26, y: Math.sin(a) * 26, z: 10 });
        }
        const fit = fitSurfaceSpline(sphere, pins, { closed: true, spacingMm: 1, quick: true });
        const shell = buildAfoShell(sphere, [0, 1, 2], {
            thicknessMm: 4,
            edgeMm: 2.5,
            flareMm: 0,
            trimPolygon: trimPolygonForShell(fit.curve, true)!,
            heelSeed: { x: 0, y: 0, z: -36 },
        });
        const report = analyzeManifoldBuffers(shell.positions, shell.indices);
        expect(report.openEdges).toBe(0);
        expect(report.nonManifoldEdges).toBe(0);
        const bend = rimDihedralDeg(shell);
        expect(shell.rimFaceStart).toBeGreaterThan(0);
        expect(
            bend.deg,
            `sphere dihedral at ${bend.x.toFixed(1)},${bend.y.toFixed(1)},${bend.z.toFixed(1)}`,
        ).toBeLessThanOrEqual(60);
    });

    test("balance-brace and posterior-leaf shells are watertight, on the curve, and flared", () => {
        const failures: string[] = [];
        const note = (name: string, ok: boolean, detail: string) => {
            if (!ok) failures.push(`${name}: ${detail}`);
        };
        for (const side of ["left", "right"] as const) {
            const leg = buildLiveFrameLeg(side, 32);
            const afo = defaultAfoDesignState(side);
            const presets = [
                ["balance-brace", balanceBracePins(leg, afo)],
                ["posterior-leaf", posteriorLeafPins(leg, afo)],
            ] as const;
            for (const [preset, placed] of presets) {
                const name = `${side} ${preset}`;
                const fit = fitSurfaceSpline(leg, placed.pins, { closed: true });
                note(name, fit.ok, fit.ok ? "spline ok" : fit.reasons.join(" | "));
                if (!fit.ok) continue;
                const polygon = trimPolygonForShell(fit.curve, true)!;
                const plainStarted = performance.now();
                const plain = buildAfoShell(leg, [0, 1, 2], {
                    thicknessMm: AFO_THICKNESS_MM,
                    edgeMm: AFO_EDGE_MM,
                    flareMm: 0,
                    trimPolygon: polygon,
                    heelSeed: { x: leg.positions[0] ?? 0, y: 0, z: -10 },
                });
                note(
                    name,
                    (performance.now() - plainStarted) / 1000 < 1.2,
                    `plain build ${((performance.now() - plainStarted) / 1000).toFixed(2)} s`,
                );
                const gateShell = (label: string, shell: AfoTriMesh) => {
                    const report = analyzeManifoldBuffers(shell.positions, shell.indices);
                    const dup = duplicateDirectedEdgeCount(shell);
                    note(name, dup === 0, `${label} duplicate directed edges ${dup}`);
                    note(name, report.openEdges === 0, `${label} open edges ${report.openEdges}`);
                    note(
                        name,
                        report.nonManifoldEdges === 0,
                        `${label} non-manifold edges ${report.nonManifoldEdges}`,
                    );
                    note(name, countMeshBodies(shell) === 1, `${label} bodies ${countMeshBodies(shell)}`);
                    note(
                        name,
                        shell.rimFaceStart != null && shell.rimFaceStart > 0,
                        `${label} rim tagged at face ${shell.rimFaceStart ?? "missing"}`,
                    );
                    const dihedral = rimDihedralDeg(shell);
                    const where = `(${dihedral.x.toFixed(1)}, ${dihedral.y.toFixed(1)}, ${dihedral.z.toFixed(1)})`;
                    note(
                        name,
                        dihedral.deg <= 60,
                        `${label} dihedral ${dihedral.deg.toFixed(2)}° at ${where}`,
                    );
                    return dihedral;
                };
                gateShell("plain", plain);
                const rims = innerRimLoops(plain, leg);
                const boundary = rims[0] ?? shellOpening(plain);
                let curveToEdge = 0;
                let edgeToCurve = 0;
                for (const p of polygon) curveToEdge = Math.max(curveToEdge, distToPolyline(p, boundary));
                for (let i = 0; i < boundary.length; i++) {
                    const a = boundary[i]!;
                    const b = boundary[(i + 1) % boundary.length]!;
                    edgeToCurve = Math.max(edgeToCurve, distToPolyline(a, polygon));
                    edgeToCurve = Math.max(
                        edgeToCurve,
                        distToPolyline(
                            { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 },
                            polygon,
                        ),
                    );
                }
                note(
                    name,
                    rims.length === 1 && curveToEdge <= 0.1 && edgeToCurve <= 0.1,
                    `curve Hausdorff ${Math.max(curveToEdge, edgeToCurve).toFixed(3)} mm (${curveToEdge.toFixed(3)} / ${edgeToCurve.toFixed(3)}), loops ${rims.length}`,
                );
                const plainOpen = shellOpening(plain);
                const creases = legCreases(leg);
                const plainTiny = minFace(plain);
                const plainClass = classifyBuilderFolds(plain, leg, creases, null);
                const plainCap = BUILDER_FOLD_CAP[name] ?? { plain: 27, flared: 74, d: 0 };
                note(
                    name,
                    plainTiny.area >= 1e-6,
                    `plain min face ${plainTiny.area.toExponential(2)} mm² altitude ${plainTiny.altitude.toExponential(2)} mm`,
                );
                note(
                    name,
                    plainClass.c === 0 &&
                        plainClass.d === 0 &&
                        plainClass.b + plainClass.c + plainClass.d <= plainCap.plain,
                    `plain folds a ${plainClass.a} b ${plainClass.b} c ${plainClass.c} d ${plainClass.d} (builder ${plainClass.b + plainClass.c + plainClass.d} ≤ ${plainCap.plain})`,
                );
                const plainWall = minInteriorWall(plain, plainOpen);
                const plainClear = shellClearance(plain, plainOpen);
                note(
                    name,
                    plainClear.farOut === 0,
                    `plain far wall ${plainClear.farLo.toFixed(2)}–${plainClear.farHi.toFixed(2)} mm, ${plainClear.farOut} outside 4±0.1`,
                );
                note(
                    name,
                    plainClear.edgeOut === 0,
                    `plain edge ${plainClear.edgeLo.toFixed(2)}–${plainClear.edgeHi.toFixed(2)} mm, ${plainClear.edgeOut} outside 2.5±0.1`,
                );
                note(
                    name,
                    plainClear.blendOut === 0,
                    `plain blend thinner than linear−0.1 at ${plainClear.blendOut} verts`,
                );
                note(
                    name,
                    plainWall >= AFO_THICKNESS_MM - 0.1 && plainWall <= AFO_THICKNESS_MM + 0.1,
                    `plain min wall ${plainWall.toFixed(3)} mm`,
                );
                const projector = meshProjector(leg);
                let nInner = 0;
                while (
                    nInner < plain.positions.length / 3 &&
                    projector.closest(at(plain, nInner)).errorMm < 0.2
                ) {
                    nInner++;
                }
                let edgeErr = 0;
                for (let i = 0; i < nInner; i++) {
                    const v = at(plain, i);
                    if (distToPolyline(v, polygon) > 0.15) continue;
                    const outer = at(plain, i + nInner);
                    const thickness = dist(v, outer);
                    edgeErr = Math.max(edgeErr, Math.abs(thickness - AFO_EDGE_MM));
                }
                // Pair spacing is not the edge gate. Closest-point E is checked below.
                const flaredStarted = performance.now();
                const flared = buildAfoShell(leg, [0, 1, 2], {
                    thicknessMm: AFO_THICKNESS_MM,
                    edgeMm: AFO_EDGE_MM,
                    flareMm: AFO_FLARE_MM,
                    trimPolygon: polygon,
                    heelSeed: { x: 0, y: 0, z: -10 },
                });
                note(
                    name,
                    (performance.now() - flaredStarted) / 1000 < 1.2,
                    `flared build ${((performance.now() - flaredStarted) / 1000).toFixed(2)} s`,
                );
                note(
                    name,
                    flared.positions.length === plain.positions.length,
                    `flare vertex count ${flared.positions.length} vs ${plain.positions.length}`,
                );
                gateShell("flared", flared);
                const flaredOpen = shellOpening(flared);
                const flaredTiny = minFace(flared);
                const flaredClass = classifyBuilderFolds(flared, leg, creases, plain);
                const flaredCap = BUILDER_FOLD_CAP[name] ?? { plain: 27, flared: 74, d: 48 };
                note(
                    name,
                    flaredTiny.area >= 1e-6,
                    `flared min face ${flaredTiny.area.toExponential(2)} mm² altitude ${flaredTiny.altitude.toExponential(2)} mm`,
                );
                note(
                    name,
                    flaredClass.c === 0 &&
                        flaredClass.d <= flaredCap.d &&
                        flaredClass.b + flaredClass.c + flaredClass.d <= flaredCap.flared,
                    `flared folds a ${flaredClass.a} b ${flaredClass.b} c ${flaredClass.c} d ${flaredClass.d} (d ≤ ${flaredCap.d}, builder ${flaredClass.b + flaredClass.c + flaredClass.d} ≤ ${flaredCap.flared})`,
                );
                const flaredWall = minInteriorWall(flared, flaredOpen);
                const flaredClear = shellClearance(flared, flaredOpen);
                note(
                    name,
                    flaredClear.farOut === 0,
                    `flared far wall ${flaredClear.farLo.toFixed(2)}–${flaredClear.farHi.toFixed(2)} mm, ${flaredClear.farOut} outside 4±0.1`,
                );
                note(
                    name,
                    flaredClear.edgeOut === 0,
                    `flared edge ${flaredClear.edgeLo.toFixed(2)}–${flaredClear.edgeHi.toFixed(2)} mm, ${flaredClear.edgeOut} outside 2.5±0.1`,
                );
                note(
                    name,
                    flaredClear.blendOut === 0,
                    `flared blend thinner than linear−0.1 at ${flaredClear.blendOut} verts`,
                );
                let legMinZ = Infinity;
                for (let i = 2; i < leg.positions.length; i += 3)
                    legMinZ = Math.min(legMinZ, leg.positions[i] ?? 0);
                let below = 0;
                let shellMinZ = Infinity;
                const innerN = flared.outerVertex0 ?? 0;
                for (let i = 0; i < innerN; i++) {
                    const z = flared.positions[i * 3 + 2] ?? 0;
                    shellMinZ = Math.min(shellMinZ, z);
                    if (z < legMinZ - 0.001) below++;
                }
                let contact = 0;
                let contactMoved = 0;
                let contactMax = 0;
                const pairN = plain.outerVertex0 ?? 0;
                for (let i = 0; i < pairN; i++) {
                    const p = at(plain, i);
                    if (p.z > legMinZ + 2 || distToPolyline(p, polygon) < 0.5) continue;
                    const hit = projector.closest(p);
                    if (hit.normal.z >= -0.65) continue;
                    contact++;
                    const moved = dist(p, at(flared, i));
                    contactMax = Math.max(contactMax, moved);
                    if (moved > 0.01) contactMoved++;
                }
                note(
                    name,
                    below === 0,
                    `flared vertices below cast min z ${below}, shell min ${shellMinZ.toFixed(2)}`,
                );
                note(
                    name,
                    contactMoved === 0,
                    `plantar contact moved ${contactMoved}/${contact}, max ${contactMax.toFixed(3)} mm`,
                );
                note(
                    name,
                    flaredWall >= AFO_THICKNESS_MM - 0.1 && flaredWall <= AFO_THICKNESS_MM + 0.1,
                    `flared min wall ${flaredWall.toFixed(3)} mm`,
                );
                let minZ = Infinity;
                for (let i = 0; i < leg.positions.length; i += 3)
                    minZ = Math.min(minZ, leg.positions[i + 2] ?? 0);
                let wallErr = 0;
                let footErr = 0;
                let walls = 0;
                let feet = 0;
                let footOff = 0;
                const footMoves: number[] = [];
                const samples: string[] = [];
                const limit = Math.min(plain.positions.length, flared.positions.length) / 3;
                const footAt: AfoVec3[] = [];
                for (let i = 0; i < limit; i++) {
                    const p = at(plain, i);
                    if (distToPolyline(p, polygon) > 0.12) continue;
                    const hit = projector.closest(p);
                    if (hit.normal.z < -0.65 && p.z < minZ + 8) footAt.push(p);
                }
                for (let i = 0; i < limit; i++) {
                    const p = at(plain, i);
                    if (distToPolyline(p, polygon) > 0.12) continue;
                    const q = at(flared, i);
                    const d = dist(p, q);
                    const hit = projector.closest(p);
                    const foot = hit.normal.z < -0.65 && p.z < minZ + 8;
                    if (foot) {
                        feet++;
                        footMoves.push(d);
                        if (Math.abs(d - AFO_FOOTPLATE_FLARE_CAP_MM) > 0.05) {
                            footOff++;
                            if (name === "left balance-brace" && footOff <= 8) {
                                const n0 = plain.outerVertex0 ?? 0;
                                samples.push(
                                    `${i < n0 ? "in" : i < n0 * 2 ? "out" : "rim"}${i} d=${d.toFixed(2)} z=${p.z.toFixed(2)}`,
                                );
                            }
                        }
                        footErr = Math.max(footErr, Math.abs(d - AFO_FOOTPLATE_FLARE_CAP_MM));
                        continue;
                    }
                    // The cap ramps to the full flare over 8 mm. Opening vertices
                    // in that band are neither a 1 mm sole nor a 2.5 mm wall.
                    let nearCap = false;
                    for (const f of footAt) {
                        if (dist(p, f) < 10) {
                            nearCap = true;
                            break;
                        }
                    }
                    if (nearCap) continue;
                    walls++;
                    wallErr = Math.max(wallErr, Math.abs(d - AFO_FLARE_MM));
                }
                note(
                    name,
                    walls > 0 && wallErr <= 0.2,
                    `flare error ${wallErr.toFixed(3)} mm on ${walls} wall verts`,
                );
                note(
                    name,
                    feet === 0 || footErr <= 0.05,
                    `footplate error ${footErr.toFixed(3)} mm on ${feet} verts, ${footOff} outside 1±0.05, move ${footMoves.length ? Math.min(...footMoves).toFixed(2) : "n/a"}–${footMoves.length ? Math.max(...footMoves).toFixed(2) : "n/a"} ${samples.join("; ")}`,
                );
            }
        }
        expect(failures, failures.join("\n")).toEqual([]);
    });

    test("a 100k-triangle shell builds in under 5 seconds", () => {
        const sphere = buildUnitSphereMesh(40, 165);
        const tris = sphere.indices.length / 3;
        expect(tris).toBeGreaterThan(100_000);
        const pins: AfoVec3[] = [];
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            pins.push({ x: Math.cos(a) * 28, y: Math.sin(a) * 28, z: 12 });
        }
        const fit = fitSurfaceSpline(sphere, pins, { closed: true, spacingMm: 1, quick: true });
        expect(fit.ok).toBe(true);
        const started = performance.now();
        const shell = buildAfoShell(sphere, [0, 1, 2], {
            thicknessMm: 4,
            edgeMm: 2.5,
            flareMm: 0,
            trimPolygon: trimPolygonForShell(fit.curve, true)!,
            heelSeed: { x: 0, y: 0, z: -40 },
        });
        const seconds = (performance.now() - started) / 1000;
        expect(shell.indices.length).toBeGreaterThan(1000);
        expect(seconds).toBeLessThan(4);
    });
});
