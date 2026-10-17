// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AFO_C_MM,
    AFO_CREST_BAND_MM,
    AFO_FEATHER_MIN_MM,
    AFO_FEATHER_SLOPE,
    AFO_SLOPE_LIMIT,
    defaultAfoReliefs,
} from "./defaults";
import { geodesicDistanceField } from "./geodesic";
import { cloneMesh, computeVertexNormals, nearestVertex, vertexCount } from "./mesh-ops";
import type {
    AfoClinicalMarker,
    AfoCrestState,
    AfoDesignState,
    AfoLandmark,
    AfoReliefs,
    AfoTriMesh,
    AfoVec3,
} from "./types";

export interface OffsetField {
    c: Float32Array;
    T: Float32Array;
    B: Float32Array;
    W: Float32Array;
    featherMm: number;
    maxGrad: number;
    meshable: boolean;
    estimatedNavicular: boolean;
}

export interface OffsetFieldInput {
    mesh: AfoTriMesh;
    cCast: number;
    cShin: number;
    insensate: boolean;
    braceHeightMm: number;
    reliefs: AfoReliefs;
    crest: AfoCrestState;
    clinicalMarkers: AfoClinicalMarker[];
    landmarks: AfoLandmark[];
    medialMal?: AfoVec3;
    lateralMal?: AfoVec3;
    featherMm?: number;
}

export function clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
    if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

/** Polynomial smooth-min (deepest / most negative). */
export function smoothMin(a: number, b: number, k = 0.5): number {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
}

export function dist3(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function footMetrics(mesh: AfoTriMesh): { minY: number; maxY: number; fl: number; maxX: number } {
    const n = vertexCount(mesh);
    let minY = Infinity;
    let maxY = -Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < n; i++) {
        const y = mesh.positions[i * 3 + 1] ?? 0;
        const x = mesh.positions[i * 3] ?? 0;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > maxX) maxX = x;
    }
    const fl = Math.max(1, maxY - minY);
    return { minY, maxY, fl, maxX };
}

export function estimatedNavicularPoint(mesh: AfoTriMesh): AfoVec3 {
    const { minY, fl, maxX } = footMetrics(mesh);
    return { x: maxX, y: minY + 0.45 * fl, z: 35 };
}

function diskMask(d: number, radius: number, feather: number): number {
    if (d <= radius) return 1;
    return 1 - smoothstep(radius, radius + feather, d);
}

function distToSpline(p: AfoVec3, spline: AfoVec3[]): number {
    if (spline.length === 0) return Number.POSITIVE_INFINITY;
    let best = dist3(p, spline[0]!);
    for (let i = 1; i < spline.length; i++) {
        const a = spline[i - 1]!;
        const b = spline[i]!;
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abz = b.z - a.z;
        const apx = p.x - a.x;
        const apy = p.y - a.y;
        const apz = p.z - a.z;
        const ab2 = abx * abx + aby * aby + abz * abz || 1;
        const t = clamp01((apx * abx + apy * aby + apz * abz) / ab2);
        const dx = p.x - (a.x + abx * t);
        const dy = p.y - (a.y + aby * t);
        const dz = p.z - (a.z + abz * t);
        const d = Math.hypot(dx, dy, dz);
        if (d < best) best = d;
    }
    return best;
}

function markerPoint(
    id: string,
    clinical: AfoClinicalMarker[],
    landmarks: AfoLandmark[],
): AfoVec3 | undefined {
    const c = clinical.find((m) => m.id === id);
    if (c) return c.point;
    const lm = landmarks.find((m) => m.id === id);
    return lm?.point;
}

function phiFromGeodesic(dist: number, core: number, feather: number): number {
    if (!Number.isFinite(dist)) return 0;
    if (dist <= core) return 1;
    return 1 - smoothstep(core, core + feather, dist);
}

export function reliefPhiCore(id: "malleoli" | "fibularHead" | "other"): number {
    if (id === "malleoli" || id === "fibularHead") return 12;
    return 8;
}

export function combineOffsetFormula(args: {
    B: number;
    T: number;
    W: number;
    cCast: number;
    cShin: number;
    cRel: number;
    insensate: boolean;
}): number {
    const tissue = Math.max(0, args.cCast) * args.T + Math.max(0, args.cShin) * args.W * args.T;
    const cPos = args.insensate ? 0 : (1 - args.B) * tissue;
    const cNeg = Math.min(0, args.cCast) + Math.min(0, args.cShin) * args.W;
    return cPos + cNeg + args.cRel;
}

export function evaluateOffsetField(input: OffsetFieldInput): OffsetField {
    const mesh = input.mesh;
    const n = vertexCount(mesh);
    const brace = input.braceHeightMm;
    const C = AFO_C_MM;
    const reliefMin = Math.min(
        input.reliefs.malleoli.mm,
        input.reliefs.navicular.mm,
        input.reliefs.fifthMetBase.mm,
        input.reliefs.postCalcaneus.mm,
        input.reliefs.fibularHead.mm,
        0,
    );
    const cHi = input.insensate ? 0 : Math.max(0, input.cCast) + Math.max(0, input.cShin);
    const cLo = Math.min(0, input.cCast) + Math.min(0, input.cShin) + reliefMin;
    const dc = Math.max(cHi - cLo, Math.abs(input.cCast), Math.abs(input.cShin), Math.abs(reliefMin));
    let feather = Math.max(AFO_FEATHER_MIN_MM, input.featherMm ?? 0, AFO_FEATHER_SLOPE * dc);

    const { minY, fl } = footMetrics(mesh);
    const navicularPlaced = Boolean(markerPoint("navicular", input.clinicalMarkers, input.landmarks));
    const navicular =
        markerPoint("navicular", input.clinicalMarkers, input.landmarks) ?? estimatedNavicularPoint(mesh);
    const fifth = markerPoint("fifth_met_base", input.clinicalMarkers, input.landmarks);
    const calc = markerPoint("post_calcaneus", input.clinicalMarkers, input.landmarks);
    const fib = markerPoint("fibular_head", input.clinicalMarkers, input.landmarks);
    const med = input.medialMal ??
        markerPoint("malleolus_medial", input.clinicalMarkers, input.landmarks) ?? {
            x: 35,
            y: 40,
            z: 80,
        };
    const lat = input.lateralMal ??
        markerPoint("malleolus_lateral", input.clinicalMarkers, input.landmarks) ?? {
            x: -35,
            y: 40,
            z: 80,
        };

    const crestPts = input.crest.points;
    const reliefs = input.insensate
        ? {
              malleoli: { mm: input.reliefs.malleoli.mm, on: true },
              navicular: { mm: input.reliefs.navicular.mm, on: true },
              fifthMetBase: { mm: input.reliefs.fifthMetBase.mm, on: true },
              postCalcaneus: { mm: input.reliefs.postCalcaneus.mm, on: true },
              fibularHead: { mm: input.reliefs.fibularHead.mm, on: true },
          }
        : input.reliefs;

    const geoSrc = (p: AfoVec3 | undefined): number[] => {
        if (!p) return [];
        return [nearestVertex(mesh, p).index];
    };
    const geoMal = geodesicDistanceField(mesh, [
        nearestVertex(mesh, med).index,
        nearestVertex(mesh, lat).index,
    ]);
    const geoNav = geodesicDistanceField(mesh, geoSrc(navicular));
    const geoFifth = geodesicDistanceField(mesh, geoSrc(fifth));
    const geoCalc = geodesicDistanceField(mesh, geoSrc(calc));
    const geoFib = geodesicDistanceField(mesh, geoSrc(fib));

    const T = new Float32Array(n);
    const B = new Float32Array(n);
    const W = new Float32Array(n);
    const c = new Float32Array(n);

    const build = (featherMm: number) => {
        for (let i = 0; i < n; i++) {
            const p: AfoVec3 = {
                x: mesh.positions[i * 3] ?? 0,
                y: mesh.positions[i * 3 + 1] ?? 0,
                z: mesh.positions[i * 3 + 2] ?? 0,
            };
            const shinCx = 0;
            const shinCy = 35;
            const rx = p.x - shinCx;
            const ry = p.y - shinCy;
            const r = Math.hypot(rx, ry) || 1;
            // Posterior = −Y. Angle 0 at posterior, + toward medial (+X).
            const angPost = Math.atan2(rx, -ry);
            const halfCalf = (120 * Math.PI) / 360;
            const dArcCalf = (Math.abs(angPost) - halfCalf) * r;
            const zCalf =
                smoothstep(C + 80 - featherMm, C + 80, p.z) *
                (1 - smoothstep(brace - 10, brace - 10 + featherMm, p.z));
            const calf = (1 - smoothstep(0, featherMm, dArcCalf)) * zCalf;

            const dCrest = distToSpline(p, crestPts);
            const crestBand = diskMask(dCrest, AFO_CREST_BAND_MM, featherMm);
            const lateral = p.x < 0 ? 1 : 1 - smoothstep(0, featherMm, p.x);
            const zAnt =
                smoothstep(C + 60 - featherMm, C + 60, p.z) *
                (1 - smoothstep(brace - 10, brace - 10 + featherMm, p.z));
            const antShin = (1 - crestBand) * lateral * zAnt;

            const yNorm = (p.y - minY) / fl;
            const archY = smoothstep(0.25 - 0.02, 0.25, yNorm) * (1 - smoothstep(0.65, 0.67, yNorm));
            const archZ = 1 - smoothstep(25, 25 + featherMm, p.z);
            const archMed = p.x > 0 ? 1 : 1 - smoothstep(0, featherMm, -p.x);
            const arch = archY * archZ * archMed;

            let tRaw = Math.max(calf, antShin, arch);
            const bDisk =
                Math.max(
                    diskMask(dist3(p, med), 15, featherMm),
                    diskMask(dist3(p, lat), 15, featherMm),
                    diskMask(dist3(p, navicular), navicularPlaced ? 10 : 15, featherMm),
                    fifth ? diskMask(dist3(p, fifth), 10, featherMm) : 0,
                    calc ? diskMask(dist3(p, calc), 10, featherMm) : 0,
                    fib ? diskMask(dist3(p, fib), 15, featherMm) : 0,
                    crestBand,
                ) || 0;
            B[i] = clamp01(bDisk);
            tRaw *= 1 - smoothstep(0.25, 0.5, B[i]!);
            T[i] = clamp01(tRaw);
            W[i] = smoothstep(C + 20, C + 60, p.z);

            const ch: number[] = [];
            if (reliefs.malleoli.on) {
                ch.push(
                    reliefs.malleoli.mm * phiFromGeodesic(geoMal[i]!, reliefPhiCore("malleoli"), featherMm),
                );
            }
            if (reliefs.navicular.on) {
                ch.push(
                    reliefs.navicular.mm * phiFromGeodesic(geoNav[i]!, reliefPhiCore("other"), featherMm),
                );
            }
            if (reliefs.fifthMetBase.on && fifth) {
                ch.push(
                    reliefs.fifthMetBase.mm *
                        phiFromGeodesic(geoFifth[i]!, reliefPhiCore("other"), featherMm),
                );
            }
            if (reliefs.postCalcaneus.on && calc) {
                ch.push(
                    reliefs.postCalcaneus.mm *
                        phiFromGeodesic(geoCalc[i]!, reliefPhiCore("other"), featherMm),
                );
            }
            if (reliefs.fibularHead.on && fib) {
                ch.push(
                    reliefs.fibularHead.mm *
                        phiFromGeodesic(geoFib[i]!, reliefPhiCore("fibularHead"), featherMm),
                );
            }
            let cRel = 0;
            if (ch.length > 0) {
                cRel = ch[0]!;
                for (let k = 1; k < ch.length; k++) cRel = smoothMin(cRel, ch[k]!);
            }
            c[i] = combineOffsetFormula({
                B: B[i]!,
                T: T[i]!,
                W: W[i]!,
                cCast: input.cCast,
                cShin: input.cShin,
                cRel,
                insensate: input.insensate,
            });
        }
    };

    const maxGradOf = (): number => {
        let g = 0;
        const t = (mesh.indices.length / 3) | 0;
        for (let i = 0; i < t; i++) {
            const ia = mesh.indices[i * 3] ?? 0;
            const ib = mesh.indices[i * 3 + 1] ?? 0;
            const ic = mesh.indices[i * 3 + 2] ?? 0;
            const edges: [number, number][] = [
                [ia, ib],
                [ib, ic],
                [ic, ia],
            ];
            for (const [a, b] of edges) {
                const dx = (mesh.positions[a * 3] ?? 0) - (mesh.positions[b * 3] ?? 0);
                const dy = (mesh.positions[a * 3 + 1] ?? 0) - (mesh.positions[b * 3 + 1] ?? 0);
                const dz = (mesh.positions[a * 3 + 2] ?? 0) - (mesh.positions[b * 3 + 2] ?? 0);
                const len = Math.hypot(dx, dy, dz);
                if (len < 0.75) continue;
                const grad = Math.abs((c[a] ?? 0) - (c[b] ?? 0)) / len;
                if (grad > g) g = grad;
            }
        }
        return g;
    };

    build(feather);
    let maxGrad = maxGradOf();
    for (let iter = 0; iter < 6 && maxGrad > AFO_SLOPE_LIMIT + 1e-4; iter++) {
        feather = Math.max(feather * 1.2, AFO_FEATHER_SLOPE * dc, AFO_FEATHER_MIN_MM);
        build(feather);
        maxGrad = maxGradOf();
    }

    return {
        c,
        T,
        B,
        W,
        featherMm: feather,
        maxGrad,
        meshable: maxGrad <= AFO_SLOPE_LIMIT + 1e-3,
        estimatedNavicular: !navicularPlaced,
    };
}

/** Inward normal displacement `p' = p − n c`. Identity when every c is 0. */
export function applyOffsetField(mesh: AfoTriMesh, field: OffsetField): AfoTriMesh {
    const n = vertexCount(mesh);
    let any = false;
    for (let i = 0; i < n; i++) {
        if (Math.abs(field.c[i] ?? 0) > 1e-12) {
            any = true;
            break;
        }
    }
    if (!any) return cloneMesh(mesh);
    const out = cloneMesh(mesh);
    const nrm = computeVertexNormals(mesh);
    for (let i = 0; i < n; i++) {
        const k = field.c[i] ?? 0;
        out.positions[i * 3] = (mesh.positions[i * 3] ?? 0) - (nrm[i * 3] ?? 0) * k;
        out.positions[i * 3 + 1] = (mesh.positions[i * 3 + 1] ?? 0) - (nrm[i * 3 + 1] ?? 0) * k;
        out.positions[i * 3 + 2] = (mesh.positions[i * 3 + 2] ?? 0) - (nrm[i * 3 + 2] ?? 0) * k;
    }
    return out;
}

export function inwardDispAt(
    original: AfoTriMesh,
    offset: AfoTriMesh,
    i: number,
    normals: Float32Array,
): number {
    const dx = (original.positions[i * 3] ?? 0) - (offset.positions[i * 3] ?? 0);
    const dy = (original.positions[i * 3 + 1] ?? 0) - (offset.positions[i * 3 + 1] ?? 0);
    const dz = (original.positions[i * 3 + 2] ?? 0) - (offset.positions[i * 3 + 2] ?? 0);
    return dx * (normals[i * 3] ?? 0) + dy * (normals[i * 3 + 1] ?? 0) + dz * (normals[i * 3 + 2] ?? 0);
}

export function offsetInputFromDesign(
    mesh: AfoTriMesh,
    afo: AfoDesignState,
    extras?: { medialMal?: AfoVec3; lateralMal?: AfoVec3 },
): OffsetFieldInput {
    return {
        mesh,
        cCast: afo.cast.removeCastMm,
        cShin: afo.cast.shinOffsetMm,
        insensate: afo.cast.insensate,
        braceHeightMm: afo.corrections.braceHeightMm,
        reliefs: afo.reliefs ?? defaultAfoReliefs(),
        crest: afo.crest,
        clinicalMarkers: afo.clinicalMarkers,
        landmarks: afo.landmarks,
        medialMal: extras?.medialMal,
        lateralMal: extras?.lateralMal,
        featherMm: afo.effectiveFeatherMm,
    };
}
