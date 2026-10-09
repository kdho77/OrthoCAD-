// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    correctionDeltaAt,
} from "@/lib/geometry/base-modifier";
import { type HeightFieldParams, heelCupWidthScaleFactor } from "@/lib/geometry/height-field";
import { analyzeManifold } from "@/lib/geometry/manifold";
import type { SideCorrections } from "@/types";
import { cdtPlanarBand, DISH_BAND_MM, minDistToLoopXY, pointInPoly } from "./cdt-band";
import { ensureCcw, type PolyPoint, startAtPosteriorHeel } from "./curves";
import {
    type DeviceTypePreset,
    LATERAL_FLANGE_BOUNDS,
    snapToStep,
    type WallRegionDefaults,
} from "./defaults";
import { extractTopSheet, sampleUvField } from "./extract";
import { buildXyHeightIndex, sampleXyHeight, type XyHeightIndex } from "./height-xy";
import { buildHermiteStations, loftHermiteWall } from "./loft";
import { defaultsFromStockCurves } from "./measure";
import { type ProceduralModifierInput, plantarZDelta } from "./modifiers";
import { countPlanViewChordCrossings, offsetClosedInward, pairAtNativeTop } from "./stations";
import type { StockWallModel, UvHeightField } from "./types";

export interface ReconstructOptions extends ProceduralModifierInput {
    n?: number;
    wallLayers?: number;
    /** Unmodified stock mesh — used to steal today's top (±0.01 mm). */
    sourceGeometry?: BufferGeometry;
    sourceField?: HeightFieldParams;
}

function zeroCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function hasCurveOrTopModifiers(input: ReconstructOptions): boolean {
    const c = input.corrections;
    if (!c) return (input.thicknessMm ?? 0) !== (input.stockThicknessMm ?? input.thicknessMm ?? 0);
    return (
        c.heelCupWidthMm !== 0 ||
        c.heelCupDepthMm > 0 ||
        c.heelLiftMm > 0 ||
        c.archHeightMm !== 0 ||
        c.archFillMm !== 0 ||
        c.heelCupHeightMm !== 0 ||
        c.forefootPostingDeg !== 0 ||
        c.rearfootPostingDeg !== 0 ||
        (input.thicknessMm ?? 0) !== (input.stockThicknessMm ?? input.thicknessMm ?? 0)
    );
}

function sampleZ(
    field: UvHeightField,
    height: XyHeightIndex | null,
    x: number,
    y: number,
    fallback: number,
    prefer: "min" | "max" = "max",
): number {
    if (height) {
        const z = sampleXyHeight(height, x, y, prefer);
        if (z != null) return z;
    }
    return sampleUvField(field, x, y) ?? fallback;
}

function triangulatePlantar(
    ring: PolyPoint[],
    ringIdx: number[],
    field: UvHeightField,
    height: XyHeightIndex | null,
    push: (p: PolyPoint) => number,
    pushTri: (a: number, b: number, c: number, flip?: boolean) => void,
    zDelta: (x: number, y: number) => number,
): void {
    const n = ring.length;
    if (n < 3) return;
    const pos = ring.map((p) => ({ ...p }));
    const ids = ringIdx.slice();
    const live: number[] = Array.from({ length: n }, (_, i) => i);
    const cross = (i: number, j: number, k: number) => {
        const a = pos[i]!;
        const b = pos[j]!;
        const c = pos[k]!;
        return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    };
    const insideTri = (p: PolyPoint, a: number, b: number, c: number) => {
        const s1 = (pos[b]!.x - pos[a]!.x) * (p.y - pos[a]!.y) - (pos[b]!.y - pos[a]!.y) * (p.x - pos[a]!.x);
        const s2 = (pos[c]!.x - pos[b]!.x) * (p.y - pos[b]!.y) - (pos[c]!.y - pos[b]!.y) * (p.x - pos[b]!.x);
        const s3 = (pos[a]!.x - pos[c]!.x) * (p.y - pos[c]!.y) - (pos[a]!.y - pos[c]!.y) * (p.x - pos[c]!.x);
        return (s1 >= -1e-9 && s2 >= -1e-9 && s3 >= -1e-9) || (s1 <= 1e-9 && s2 <= 1e-9 && s3 <= 1e-9);
    };
    type Face = [number, number, number];
    const faces: Face[] = [];
    let guard = 0;
    while (live.length > 3 && guard++ < n * n) {
        let clipped = false;
        for (let i = 0; i < live.length; i++) {
            const i0 = live[(i + live.length - 1) % live.length]!;
            const i1 = live[i]!;
            const i2 = live[(i + 1) % live.length]!;
            if (cross(i0, i1, i2) <= 0) continue;
            let has = false;
            for (const j of live) {
                if (j === i0 || j === i1 || j === i2) continue;
                if (insideTri(pos[j]!, i0, i1, i2)) {
                    has = true;
                    break;
                }
            }
            if (has) continue;
            faces.push([i0, i1, i2]);
            live.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped) break;
    }
    if (live.length === 3) faces.push([live[0]!, live[1]!, live[2]!]);
    else if (live.length > 3) {
        let cx = 0;
        let cy = 0;
        for (const i of live) {
            cx += pos[i]!.x;
            cy += pos[i]!.y;
        }
        cx /= live.length;
        cy /= live.length;
        const cz = sampleZ(field, height, cx, cy, pos[live[0]!]!.z, "min") + zDelta(cx, cy);
        const cid = pos.length;
        pos.push({ x: cx, y: cy, z: cz });
        ids.push(push({ x: cx, y: cy, z: cz }));
        for (let i = 0; i < live.length; i++) {
            faces.push([live[i]!, live[(i + 1) % live.length]!, cid]);
        }
    }

    for (let pass = 0; pass < 3; pass++) {
        const next: Face[] = [];
        let splits = 0;
        for (const [a, b, c] of faces) {
            const pa = pos[a]!;
            const pb = pos[b]!;
            const pc = pos[c]!;
            const area = Math.abs((pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x)) * 0.5;
            if (area < 8) {
                next.push([a, b, c]);
                continue;
            }
            const x = (pa.x + pb.x + pc.x) / 3;
            const y = (pa.y + pb.y + pc.y) / 3;
            const z = sampleZ(field, height, x, y, (pa.z + pb.z + pc.z) / 3, "min") + zDelta(x, y);
            const id = pos.length;
            pos.push({ x, y, z });
            ids.push(push({ x, y, z }));
            next.push([a, b, id], [b, c, id], [c, a, id]);
            splits++;
        }
        faces.length = 0;
        faces.push(...next);
        if (splits === 0) break;
    }
    for (const [a, b, c] of faces) pushTri(ids[a]!, ids[b]!, ids[c]!, true);
}

function orderRimLocal(pos: Float32Array, rimLocal: number[]): number[] {
    const pts = rimLocal.map((i) => ({
        x: pos[i * 3]!,
        y: pos[i * 3 + 1]!,
        z: pos[i * 3 + 2]!,
        i,
    }));
    const ccw = ensureCcw(pts);
    const started = startAtPosteriorHeel(ccw);
    return started.map((p) => (p as { i: number }).i);
}

function applyAnalyticTopDeltas(
    pos: Float32Array,
    bounds: StockWallModel["bounds"],
    input: ReconstructOptions,
): void {
    const c = input.corrections ?? zeroCorrections();
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const width = Math.max(1e-3, bounds.maxY - bounds.minY);
    const field: HeightFieldParams = {
        side: "left",
        lengthMm: length,
        widthMm: width,
        thicknessMm: input.thicknessMm ?? BASE_REFERENCE_THICKNESS_MM,
        corrections: c,
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
    const neutral: HeightFieldParams = {
        ...field,
        thicknessMm: input.stockThicknessMm ?? BASE_REFERENCE_THICKNESS_MM,
        corrections: zeroCorrections(),
    };
    const minX = bounds.minX;
    const widCenter = (bounds.minY + bounds.maxY) * 0.5;
    const halfW = width * 0.5;
    const count = pos.length / 3;
    for (let i = 0; i < count; i++) {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        const u = Math.max(0, Math.min(1, (x - minX) / length));
        const vSigned = Math.max(-1, Math.min(1, (y - widCenter) / halfW));
        pos[i * 3 + 2]! += correctionDeltaAt(u, vSigned, field, neutral);
        if (c.heelCupWidthMm !== 0) {
            const scale = heelCupWidthScaleFactor(u, c.heelCupWidthMm);
            pos[i * 3 + 1] = widCenter + (y - widCenter) * scale;
        }
    }
}

function defaultsFromModel(model: StockWallModel, _preset: DeviceTypePreset): WallRegionDefaults {
    const base = defaultsFromStockCurves(
        model.trim.spline.controls,
        model.outline.spline.controls,
        model.bounds,
    );
    const diag = model.flareDiagnostics;
    if (!diag?.length) return base;
    const flareCurvature = { ...base.flareCurvature };
    for (const d of diag) {
        flareCurvature[d.region] = d.kind === "curved" ? d.curvature : 0;
    }
    return { ...base, flareCurvature, flareDiagnostics: diag };
}

/**
 * Parametric reconstruction: exact TopSheet + Hermite wall + PlantarSheet.
 * Wall top row IS the TopSheet rim; wall bottom row IS the plantar outline.
 * Reverse-fit profiles are not used.
 */
export function reconstructProceduralWalls(
    model: StockWallModel,
    options: ReconstructOptions = {},
): BufferGeometry {
    const preset = options.deviceType ?? "functional";
    const defaults = defaultsFromModel(model, preset);
    const flangeH = snapToStep(options.lateralFlange?.heightMm ?? 0, LATERAL_FLANGE_BOUNDS.heightMm);
    const flangeLen = snapToStep(
        options.lateralFlange?.lengthMm ?? defaults.lateralFlangeLengthMm,
        LATERAL_FLANGE_BOUNDS.lengthMm,
    );
    const flangeAng = snapToStep(
        options.lateralFlange?.angleDeg ?? defaults.lateralFlangeAngleDeg,
        LATERAL_FLANGE_BOUNDS.angleDeg,
    );

    let topPos: Float32Array;
    let topIdx: Uint32Array;
    let rimLocal: number[];

    if (options.sourceGeometry && hasCurveOrTopModifiers(options) && options.sourceField) {
        const modified = applyBaseModifiers(options.sourceGeometry, options.sourceField, 0);
        const sheet = extractTopSheet(modified);
        modified.dispose();
        if (!sheet.meshPositions || !sheet.meshIndices || !sheet.rimLocal) {
            throw new Error("procedural reconstruct: modified top sheet missing");
        }
        topPos = sheet.meshPositions;
        topIdx = sheet.meshIndices;
        rimLocal = sheet.rimLocal;
    } else if (model.top.meshPositions && model.top.meshIndices && model.top.rimLocal) {
        topPos = model.top.meshPositions.slice();
        topIdx = model.top.meshIndices;
        rimLocal = model.top.rimLocal.slice();
        if (hasCurveOrTopModifiers(options)) {
            applyAnalyticTopDeltas(topPos, model.bounds, options);
        }
    } else {
        throw new Error("procedural reconstruct: TopSheet required (exact stock top mesh)");
    }

    rimLocal = orderRimLocal(topPos, rimLocal);
    const n = rimLocal.length;
    const rimPts: PolyPoint[] = rimLocal.map((i) => ({
        x: topPos[i * 3]!,
        y: topPos[i * 3 + 1]!,
        z: topPos[i * 3 + 2]!,
    }));

    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < topPos.length; i++) positions.push(topPos[i]!);
    for (let i = 0; i < topIdx.length; i += 3) {
        indices.push(topIdx[i]!, topIdx[i + 1]!, topIdx[i + 2]!);
    }

    const push = (p: PolyPoint): number => {
        const i = positions.length / 3;
        positions.push(p.x, p.y, p.z);
        return i;
    };
    const pushTri = (a: number, b: number, c: number, flip = false): void => {
        if (flip) indices.push(a, c, b);
        else indices.push(a, b, c);
    };

    const plantarStart = positions.length / 3;
    const plantarFaceBegin = indices.length;
    const plantarRim = appendStockPlantar(model, options, positions, rimPts, push, pushTri);
    const nativePlantarIdx = plantarRim;
    const plantarCount = positions.length / 3 - plantarStart;
    if (shouldReanchorPlantar(options)) {
        reanchorPlantarMinZ(positions, plantarStart, plantarCount);
    }
    const plantarPts: PolyPoint[] = nativePlantarIdx.map((i) => ({
        x: positions[i * 3]!,
        y: positions[i * 3 + 1]!,
        z: positions[i * 3 + 2]!,
    }));
    let pairing = pairAtNativeTop(plantarPts, rimPts);
    const collapsed = mergeCollapsedStations(pairing, rimLocal, indices);
    pairing = collapsed.pairing;
    rimLocal = collapsed.rimLocal;
    pairing.chordCrossings = countPlanViewChordCrossings(pairing.plantar, pairing.top);
    const dishHeight = buildXyHeightIndex(new Float32Array(positions), indices);
    const stationBot: number[] = [];
    const stationBotPts: PolyPoint[] = [];
    for (const p of pairing.plantar) {
        const z = sampleXyHeight(dishHeight, p.x, p.y, "min") ?? p.z;
        const pt = { x: p.x, y: p.y, z };
        stationBotPts.push(pt);
        stationBot.push(push(pt));
    }
    pairing.plantar = stationBotPts;
    dropPlantarBandFaces(indices, positions, plantarFaceBegin, nativePlantarIdx, stationBotPts);
    const holeIdx = extractLongestInteriorHole(indices, plantarFaceBegin, positions, stationBotPts);
    const innerPts =
        holeIdx.length >= 3
            ? holeIdx.map((i) => ({
                  x: positions[i * 3]!,
                  y: positions[i * 3 + 1]!,
                  z: positions[i * 3 + 2]!,
              }))
            : offsetClosedInward(stationBotPts, DISH_BAND_MM);
    const innerIds = holeIdx.length >= 3 ? holeIdx : innerPts.map((p) => push(p));
    const steinerIds: number[] = [];
    const steinerPts: PolyPoint[] = [];
    const holeSet = new Set(innerIds);
    const botSet = new Set(stationBot);
    const rimSet = new Set(nativePlantarIdx);
    for (let i = plantarStart; i < plantarStart + plantarCount; i++) {
        if (holeSet.has(i) || botSet.has(i) || rimSet.has(i)) continue;
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        const d = minDistToLoopXY(x, y, stationBotPts);
        if (d < 0.25 || d > DISH_BAND_MM) continue;
        if (!pointInPoly(x, y, stationBotPts)) continue;
        steinerIds.push(i);
        steinerPts.push({ x, y, z: positions[i * 3 + 2]! });
    }
    const cdt = cdtPlanarBand(stationBotPts, innerPts, steinerPts);
    const nMapped = stationBot.length + innerIds.length + steinerIds.length;
    const cdtId = (li: number): number => {
        if (li < stationBot.length) return stationBot[li]!;
        if (li < stationBot.length + innerIds.length) return innerIds[li - stationBot.length]!;
        if (li < nMapped) return steinerIds[li - stationBot.length - innerIds.length]!;
        const p = cdt.points[li]!;
        return push(p);
    };
    const cdtMeshIds: number[] = [];
    for (let i = 0; i < cdt.points.length; i++) cdtMeshIds.push(cdtId(i));
    for (const [a, b, c] of cdt.faces) {
        pushTri(cdtMeshIds[a]!, cdtMeshIds[b]!, cdtMeshIds[c]!, true);
    }
    const stations = buildHermiteStations(pairing.plantar, pairing.top, model.bounds);
    for (let i = 0; i < stations.length; i++) {
        const nn = pairing.normals[i];
        if (nn) stations[i]!.n = nn;
    }
    applyBoundaryTangents(stations, positions, indices, stationBot, "t0");
    const grid = loftHermiteWall({
        stations,
        defaults,
        nT: options.wallLayers ?? 16,
        footLengthMm: Math.max(1e-3, model.bounds.maxX - model.bounds.minX),
        flangeHeightMm: flangeH,
        flangeLengthMm: flangeLen,
        flangeAngleDeg: flangeAng,
    });

    const nT = grid.nT;
    const nS = grid.nS;
    const wallStart = positions.length / 3;
    // Rows 1..nT-2 only. Row 0 IS stationBot; row nT-1 IS the native rim.
    for (let ti = 1; ti < nT - 1; ti++) {
        for (let si = 0; si < nS; si++) {
            const o = (ti * nS + si) * 3;
            positions.push(grid.positions[o]!, grid.positions[o + 1]!, grid.positions[o + 2]!);
        }
    }
    const wallVert = (ti: number, si: number): number => {
        const s = ((si % nS) + nS) % nS;
        if (ti <= 0) return stationBot[s]!;
        if (ti >= nT - 1) return rimLocal[s]!;
        return wallStart + (ti - 1) * nS + s;
    };
    for (let ti = 0; ti < nT - 1; ti++) {
        for (let si = 0; si < nS; si++) {
            const a = wallVert(ti, si);
            const b = wallVert(ti, si + 1);
            const c = wallVert(ti + 1, si + 1);
            const d = wallVert(ti + 1, si);
            pushTri(a, b, c);
            pushTri(a, c, d);
        }
    }
    const hygiene = sanitizeMesh(positions, indices);
    const junctionSlivers = countJunctionSlivers(positions, indices, stationBot, rimLocal);
    const bandTiltDegMax = nonSliverBandTilt(positions, indices, stationBot);

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData = {
        wallModel: "procedural",
        stockId: model.id,
        loftN: nS,
        pairingMethod: pairing.method ?? "harmonic",
        junctionRewrite: "cdt-band",
        planReversals: grid.planReversals ?? 0,
        zeroAreaFaces: hygiene.zeroArea,
        duplicateFaces: hygiene.duplicates,
        junctionSlivers,
        bandTiltDegMax,
        meshMinZ: meshMinZOf(positions),
        masterMinRadiusMm: pairing.masterMinRadiusMm,
        waistMinRadiusMm: pairing.waistMinRadiusMm,
        maxSepMm: pairing.maxSepMm,
        dishLost: Boolean(model.outline.dishLost),
        floodFaceCount: model.outline.floodFaceCount,
        floodZSpanMm: model.outline.floodZSpanMm,
        interiorFaceCount: model.outline.interiorFaceCount,
        topVertexCount: topPos.length / 3,
        outlineVertexCount: model.outline.meshPositions ? model.outline.meshPositions.length / 3 : n,
        plantarVertexCount: model.outline.meshPositions ? model.outline.meshPositions.length / 3 : 0,
        stitchVertexCount: nativePlantarIdx.length,
        stationCount: nS,
        filletImpliedSeamDeg: stations.map((s) => s.impliedSeamDeg ?? 0),
        chordCrossings: pairing.chordCrossings,
        loftChordCrossings: grid.chordCrossings ?? pairing.chordCrossings,
        windowCrossings: grid.windowCrossings ?? 0,
        maxSidewaysSkewMm: pairing.maxSkewMm,
        sidewaysSkewMm: pairing.sidewaysSkewMm,
        pairingMonotonic: pairing.monotonic,
        missedRays: pairing.missedRays,
        flareCapReport: grid.flareCapReport,
        flareDeg: grid.flareDeg,
        deviceType: preset,
        lateralFlangeHeightMm: flangeH,
        measuredVsBound: defaults.report,
        flareDiagnostics: defaults.flareDiagnostics,
        manifoldHint: analyzeManifold(geo),
    };
    return geo;
}

const COLLAPSED_STATION_MM = 1e-4;

function shouldReanchorPlantar(input: ReconstructOptions): boolean {
    const c = input.corrections;
    if (!c) return (input.archGrindDepthMm ?? 0) > 0;
    return c.rearfootPostingDeg !== 0 || c.forefootPostingDeg !== 0 || (input.archGrindDepthMm ?? 0) > 0;
}

function reanchorPlantarMinZ(positions: number[], start: number, count: number): void {
    if (count <= 0) return;
    let minZ = Infinity;
    for (let i = 0; i < count; i++) {
        const z = positions[(start + i) * 3 + 2]!;
        if (z < minZ) minZ = z;
    }
    if (!Number.isFinite(minZ) || minZ >= 0) return;
    const lift = -minZ;
    for (let i = 0; i < count; i++) positions[(start + i) * 3 + 2]! += lift;
}

function mergeCollapsedStations(
    pairing: ReturnType<typeof pairAtNativeTop>,
    rimLocal: number[],
    indices: number[],
): { pairing: ReturnType<typeof pairAtNativeTop>; rimLocal: number[] } {
    const n = Math.min(pairing.top.length, rimLocal.length, pairing.plantar.length);
    if (n < 3) return { pairing, rimLocal };
    const keep: number[] = [];
    for (let i = 0; i < n; i++) {
        if (keep.length === 0) {
            keep.push(i);
            continue;
        }
        const prev = keep[keep.length - 1]!;
        const a = pairing.top[prev]!;
        const b = pairing.top[i]!;
        const pa = pairing.plantar[prev]!;
        const pb = pairing.plantar[i]!;
        const dt = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const dp = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
        if (dt < COLLAPSED_STATION_MM && dp < COLLAPSED_STATION_MM) {
            const from = rimLocal[i]!;
            const to = rimLocal[prev]!;
            if (from !== to) {
                for (let k = 0; k < indices.length; k++) {
                    if (indices[k] === from) indices[k] = to;
                }
            }
            continue;
        }
        keep.push(i);
    }
    if (keep.length < 3 || keep.length === n) return { pairing, rimLocal };
    const last = keep[keep.length - 1]!;
    const first = keep[0]!;
    const a = pairing.top[last]!;
    const b = pairing.top[first]!;
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < COLLAPSED_STATION_MM && keep.length > 3) {
        keep.pop();
    }
    const pick = <T>(arr: T[]): T[] => keep.map((i) => arr[i]!);
    return {
        pairing: {
            ...pairing,
            plantar: pick(pairing.plantar),
            top: pick(pairing.top),
            normals: pick(pairing.normals),
            s01: pick(pairing.s01),
            sidewaysSkewMm: pick(pairing.sidewaysSkewMm),
        },
        rimLocal: pick(rimLocal),
    };
}

function dropPlantarBandFaces(
    indices: number[],
    positions: number[],
    plantarFaceBegin: number,
    nativeRim: number[],
    stationBot: PolyPoint[],
): void {
    const rimSet = new Set(nativeRim);
    const keep = indices.slice(0, plantarFaceBegin);
    for (let t = plantarFaceBegin; t < indices.length; t += 3) {
        const a = indices[t]!;
        const b = indices[t + 1]!;
        const c = indices[t + 2]!;
        const onRim = rimSet.has(a) || rimSet.has(b) || rimSet.has(c);
        const cx = (positions[a * 3]! + positions[b * 3]! + positions[c * 3]!) / 3;
        const cy = (positions[a * 3 + 1]! + positions[b * 3 + 1]! + positions[c * 3 + 1]!) / 3;
        const inBand = minDistToLoopXY(cx, cy, stationBot) < DISH_BAND_MM;
        if (onRim || inBand) continue;
        keep.push(a, b, c);
    }
    indices.length = 0;
    indices.push(...keep);
}

function extractLongestInteriorHole(
    indices: number[],
    faceBegin: number,
    positions: number[],
    outer: PolyPoint[],
): number[] {
    const use = new Map<string, { a: number; b: number; n: number }>();
    const add = (a: number, b: number) => {
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        const e = use.get(k);
        if (e) e.n++;
        else use.set(k, { a, b, n: 1 });
    };
    for (let t = faceBegin; t < indices.length; t += 3) {
        add(indices[t]!, indices[t + 1]!);
        add(indices[t + 1]!, indices[t + 2]!);
        add(indices[t + 2]!, indices[t]!);
    }
    const adj = new Map<number, number[]>();
    for (const e of use.values()) {
        if (e.n !== 1) continue;
        let la = adj.get(e.a);
        if (!la) {
            la = [];
            adj.set(e.a, la);
        }
        la.push(e.b);
        let lb = adj.get(e.b);
        if (!lb) {
            lb = [];
            adj.set(e.b, lb);
        }
        lb.push(e.a);
    }
    const used = new Set<string>();
    const loops: number[][] = [];
    const ek = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
    for (const [start, nbrs] of adj) {
        for (const first of nbrs) {
            const k0 = ek(start, first);
            if (used.has(k0)) continue;
            const loop = [start];
            let prev = start;
            let cur = first;
            used.add(k0);
            let guard = 0;
            while (cur !== start && guard++ < adj.size + 2) {
                loop.push(cur);
                const nexts = adj.get(cur) ?? [];
                let nxt = -1;
                for (const cand of nexts) {
                    if (cand === prev) continue;
                    const ck = ek(cur, cand);
                    if (used.has(ck)) continue;
                    nxt = cand;
                    break;
                }
                if (nxt < 0) break;
                used.add(ek(cur, nxt));
                prev = cur;
                cur = nxt;
            }
            if (loop.length >= 3 && cur === start) loops.push(loop);
        }
    }
    let best: number[] = [];
    for (const loop of loops) {
        let cx = 0;
        let cy = 0;
        for (const i of loop) {
            cx += positions[i * 3]!;
            cy += positions[i * 3 + 1]!;
        }
        cx /= loop.length;
        cy /= loop.length;
        if (!pointInPoly(cx, cy, outer)) continue;
        if (loop.length > best.length) best = loop;
    }
    if (best.length < 3) {
        for (const loop of loops) {
            if (loop.length > best.length) best = loop;
        }
    }
    if (best.length < 3) return [];
    const pts = best.map((i) => ({
        x: positions[i * 3]!,
        y: positions[i * 3 + 1]!,
        z: positions[i * 3 + 2]!,
        i,
    }));
    const ordered = ensureCcw(pts) as Array<PolyPoint & { i: number }>;
    return ordered.map((p) => p.i);
}

function sanitizeMesh(positions: number[], indices: number[]): { zeroArea: number; duplicates: number } {
    const seen = new Set<string>();
    const out: number[] = [];
    let zeroArea = 0;
    let duplicates = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t]!;
        const b = indices[t + 1]!;
        const c = indices[t + 2]!;
        if (a === b || b === c || c === a) {
            zeroArea++;
            continue;
        }
        const ax = positions[a * 3]!;
        const ay = positions[a * 3 + 1]!;
        const az = positions[a * 3 + 2]!;
        const ux = positions[b * 3]! - ax;
        const uy = positions[b * 3 + 1]! - ay;
        const uz = positions[b * 3 + 2]! - az;
        const vx = positions[c * 3]! - ax;
        const vy = positions[c * 3 + 1]! - ay;
        const vz = positions[c * 3 + 2]! - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        if (nx * nx + ny * ny + nz * nz < 1e-20) {
            zeroArea++;
            continue;
        }
        const canon = [a, b, c]
            .slice()
            .sort((x, y) => x - y)
            .join(",");
        if (seen.has(canon)) {
            duplicates++;
            continue;
        }
        seen.add(canon);
        out.push(a, b, c);
    }
    indices.length = 0;
    indices.push(...out);
    return { zeroArea, duplicates };
}

function countJunctionSlivers(
    positions: number[],
    indices: number[],
    stationBot: number[],
    rim: number[],
): number {
    const band = new Set<number>([...stationBot, ...rim]);
    let n = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t]!;
        const b = indices[t + 1]!;
        const c = indices[t + 2]!;
        if (!band.has(a) && !band.has(b) && !band.has(c)) continue;
        const e1 = Math.hypot(
            positions[b * 3]! - positions[a * 3]!,
            positions[b * 3 + 1]! - positions[a * 3 + 1]!,
            positions[b * 3 + 2]! - positions[a * 3 + 2]!,
        );
        const e2 = Math.hypot(
            positions[c * 3]! - positions[b * 3]!,
            positions[c * 3 + 1]! - positions[b * 3 + 1]!,
            positions[c * 3 + 2]! - positions[b * 3 + 2]!,
        );
        const e3 = Math.hypot(
            positions[a * 3]! - positions[c * 3]!,
            positions[a * 3 + 1]! - positions[c * 3 + 1]!,
            positions[a * 3 + 2]! - positions[c * 3 + 2]!,
        );
        const short = Math.min(e1, e2, e3);
        const long = Math.max(e1, e2, e3);
        if (short < 1e-9 || long / short > 20) n++;
    }
    return n;
}

function nonSliverBandTilt(positions: number[], indices: number[], ring: number[]): number {
    const band = new Set(ring);
    let maxTilt = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t]!;
        const b = indices[t + 1]!;
        const c = indices[t + 2]!;
        if (!band.has(a) && !band.has(b) && !band.has(c)) continue;
        const e1 = Math.hypot(
            positions[b * 3]! - positions[a * 3]!,
            positions[b * 3 + 1]! - positions[a * 3 + 1]!,
            positions[b * 3 + 2]! - positions[a * 3 + 2]!,
        );
        const e2 = Math.hypot(
            positions[c * 3]! - positions[b * 3]!,
            positions[c * 3 + 1]! - positions[b * 3 + 1]!,
            positions[c * 3 + 2]! - positions[b * 3 + 2]!,
        );
        const e3 = Math.hypot(
            positions[a * 3]! - positions[c * 3]!,
            positions[a * 3 + 1]! - positions[c * 3 + 1]!,
            positions[a * 3 + 2]! - positions[c * 3 + 2]!,
        );
        const short = Math.min(e1, e2, e3);
        const long = Math.max(e1, e2, e3);
        if (short < 1e-9 || long / short > 20) continue;
        const ax = positions[a * 3]!;
        const ay = positions[a * 3 + 1]!;
        const az = positions[a * 3 + 2]!;
        const ux = positions[b * 3]! - ax;
        const uy = positions[b * 3 + 1]! - ay;
        const uz = positions[b * 3 + 2]! - az;
        const vx = positions[c * 3]! - ax;
        const vy = positions[c * 3 + 1]! - ay;
        const vz = positions[c * 3 + 2]! - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-12) continue;
        const tilt = (Math.acos(Math.max(-1, Math.min(1, Math.abs(nz / len)))) * 180) / Math.PI;
        if (tilt > maxTilt) maxTilt = tilt;
    }
    return maxTilt;
}

function meshMinZOf(positions: number[]): number {
    let minZ = Infinity;
    for (let i = 2; i < positions.length; i += 3) {
        if (positions[i]! < minZ) minZ = positions[i]!;
    }
    return Number.isFinite(minZ) ? minZ : 0;
}

function applyBoundaryTangents(
    stations: ReturnType<typeof buildHermiteStations>,
    pos: number[] | Float32Array,
    indices: number[],
    rim: number[],
    slot: "t0" | "t1",
): void {
    if (rim.length < 3) return;
    const nPos = pos.length / 3;
    const vfaces = new Map<number, number[]>();
    for (let t = 0; t < indices.length; t += 3) {
        for (const v of [indices[t]!, indices[t + 1]!, indices[t + 2]!]) {
            let list = vfaces.get(v);
            if (!list) {
                list = [];
                vfaces.set(v, list);
            }
            list.push(t);
        }
    }
    for (const st of stations) {
        let bestI = 0;
        let bestD = Infinity;
        const tx = slot === "t0" ? st.outline.x : st.rim.x;
        const ty = slot === "t0" ? st.outline.y : st.rim.y;
        for (let i = 0; i < rim.length; i++) {
            const vi = rim[i]!;
            if (vi < 0 || vi >= nPos) continue;
            const d = (pos[vi * 3]! - tx) ** 2 + (pos[vi * 3 + 1]! - ty) ** 2;
            if (d < bestD) {
                bestD = d;
                bestI = i;
            }
        }
        const vi = rim[bestI]!;
        let tn = 0.5;
        let tzN = slot === "t0" ? 1 : -1;
        let bestScore = slot === "t0" ? 1 : -1;
        for (const f of vfaces.get(vi) ?? []) {
            const ia = indices[f]!;
            const ib = indices[f + 1]!;
            const ic = indices[f + 2]!;
            const ax = pos[ia * 3]!;
            const ay = pos[ia * 3 + 1]!;
            const az = pos[ia * 3 + 2]!;
            const ux = pos[ib * 3]! - ax;
            const uy = pos[ib * 3 + 1]! - ay;
            const uz = pos[ib * 3 + 2]! - az;
            const vx = pos[ic * 3]! - ax;
            const vy = pos[ic * 3 + 1]! - ay;
            const vz = pos[ic * 3 + 2]! - az;
            const nx = uy * vz - uz * vy;
            const ny = uz * vx - ux * vz;
            const nz = ux * vy - uy * vx;
            const len = Math.hypot(nx, ny, nz);
            if (len < 1e-12) continue;
            const Nz = nz / len;
            if (slot === "t0" && Nz > bestScore) continue;
            if (slot === "t1" && Nz < bestScore) continue;
            bestScore = Nz;
            const nnx = nx / len;
            const nny = ny / len;
            const ox = st.n.x;
            const oy = st.n.y;
            const dnN = ox * nnx + oy * nny;
            const dx = ox - dnN * nnx;
            const dy = oy - dnN * nny;
            tn = dx * ox + dy * oy;
            tzN = -dnN * Nz;
        }
        const mag = Math.hypot(tn, tzN);
        const H = Math.max(st.rim.z - st.outline.z, 1);
        if (mag < 1e-6) {
            if (slot === "t0") st.t0 = { n: H, z: 0 };
            else st.t1 = { n: H, z: -H };
            continue;
        }
        const tan = { n: (tn / mag) * H, z: (tzN / mag) * H };
        if (slot === "t0") st.t0 = tan;
        else st.t1 = tan;
    }
}

function transformPlantarVertex(
    x: number,
    y: number,
    z: number,
    bounds: StockWallModel["bounds"],
    input: ReconstructOptions,
): PolyPoint {
    const c = input.corrections;
    const minX = bounds.minX;
    const length = Math.max(1e-3, bounds.maxX - minX);
    const widCenter = (bounds.minY + bounds.maxY) * 0.5;
    let yy = y;
    if (c && c.heelCupWidthMm !== 0) {
        const u = Math.max(0, Math.min(1, (x - minX) / length));
        yy = widCenter + (y - widCenter) * heelCupWidthScaleFactor(u, c.heelCupWidthMm);
    }
    return { x, y: yy, z: z + plantarZDelta(x, yy, bounds, input) };
}

function appendStockPlantar(
    model: StockWallModel,
    options: ReconstructOptions,
    positions: number[],
    outlineMatched: PolyPoint[],
    push: (p: PolyPoint) => number,
    pushTri: (a: number, b: number, c: number, flip?: boolean) => void,
): number[] {
    const srcPos = model.outline.meshPositions;
    const srcIdx = model.outline.meshIndices;
    const srcRim = model.outline.rimLocal;
    if (srcPos && srcIdx && srcRim && srcRim.length >= 3) {
        const base = positions.length / 3;
        const nVerts = srcPos.length / 3;
        for (let i = 0; i < nVerts; i++) {
            const p = transformPlantarVertex(
                srcPos[i * 3]!,
                srcPos[i * 3 + 1]!,
                srcPos[i * 3 + 2]!,
                model.bounds,
                options,
            );
            push(p);
        }
        for (let t = 0; t < srcIdx.length; t += 3) {
            pushTri(base + srcIdx[t]!, base + srcIdx[t + 1]!, base + srcIdx[t + 2]!);
        }
        const rim = srcRim.map((i) => base + i);
        const rimPts = rim.map((i) => ({
            x: positions[i * 3]!,
            y: positions[i * 3 + 1]!,
            z: positions[i * 3 + 2]!,
            i,
        }));
        const ordered = startAtPosteriorHeel(ensureCcw(rimPts)) as Array<PolyPoint & { i: number }>;
        return ordered.map((p) => p.i);
    }

    const outlineIdx: number[] = [];
    for (const p of outlineMatched) outlineIdx.push(push(p));
    const plantarHeight =
        model.outline.meshPositions && model.outline.meshIndices
            ? buildXyHeightIndex(model.outline.meshPositions, model.outline.meshIndices)
            : null;
    triangulatePlantar(
        outlineMatched,
        outlineIdx,
        model.outline.plantarZ,
        plantarHeight,
        push,
        pushTri,
        (x, y) => plantarZDelta(x, y, model.bounds, options),
    );
    return outlineIdx;
}
