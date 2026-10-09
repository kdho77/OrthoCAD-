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
import { ensureCcw, type PolyPoint, startAtPosteriorHeel } from "./curves";
import {
    type DeviceTypePreset,
    LATERAL_FLANGE_BOUNDS,
    snapToStep,
    type WallRegionDefaults,
} from "./defaults";
import { densifyHeelForefootStations } from "./densify-stations";
import { extractTopSheet } from "./extract";
import { buildDishZIndex, buildXyHeightIndex, sampleXyHeight } from "./height-xy";
import { buildHermiteStations } from "./loft";
import { defaultsFromStockCurves } from "./measure";
import { type ProceduralModifierInput, plantarZDelta } from "./modifiers";
import { applyOutlineClean } from "./outline-clean";
import { buildQuadGrid, rimJunctions, STATION_MERGE_MM } from "./quad-grid";
import { countPlanViewChordCrossings, pairAtNativeTop } from "./stations";
import type { StockWallModel } from "./types";

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
        if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < STATION_MERGE_MM) {
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
    for (let i = 0; i < out.length; i++) indices.push(out[i]!);
    return { zeroArea, duplicates };
}

function meshMinZOf(positions: number[]): number {
    let minZ = Infinity;
    for (let i = 2; i < positions.length; i += 3) {
        if (positions[i]! < minZ) minZ = positions[i]!;
    }
    return Number.isFinite(minZ) ? minZ : 0;
}

/**
 * One closed quad grid: native TopSheet + Bezier wall R→F + fillet F→B +
 * generated plantar. Native rim and outline endpoints never move.
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

    const outlineLoop = startAtPosteriorHeel(ensureCcw(model.outline.spline.controls.map((p) => ({ ...p }))));
    let pairing = pairAtNativeTop(outlineLoop, rimPts);
    const collapsed = mergeCollapsedStations(pairing, rimLocal, indices);
    pairing = collapsed.pairing;
    rimLocal = collapsed.rimLocal;
    pairing.chordCrossings = countPlanViewChordCrossings(pairing.plantar, pairing.top);

    const dish =
        model.outline.meshPositions && model.outline.meshIndices
            ? buildDishZIndex(model.outline.meshPositions, model.outline.meshIndices)
            : null;
    const zDelta = (x: number, y: number) => plantarZDelta(x, y, model.bounds, options);
    const outlineZ: PolyPoint[] = pairing.plantar.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
    }));
    pairing.plantar = outlineZ;

    const originalTopCount = topPos.length / 3;
    const stations = buildHermiteStations(pairing.plantar, pairing.top, model.bounds);
    for (let i = 0; i < stations.length; i++) {
        const nn = pairing.normals[i];
        if (nn) stations[i]!.n = nn;
        stations[i]!.outline = outlineZ[i]!;
        stations[i]!.rim = pairing.top[i]!;
    }
    densifyHeelForefootStations(stations, rimLocal, positions, indices, outlineLoop, model.bounds);
    applyOutlineClean(stations, rimLocal, indices);
    const rimPtsLive: PolyPoint[] = rimLocal.map((i) => ({
        x: positions[i * 3]!,
        y: positions[i * 3 + 1]!,
        z: positions[i * 3 + 2]!,
    }));

    const junctions = rimJunctions(
        positions,
        indices,
        rimLocal,
        stations.map((s) => s.n),
    );
    const topHeight = buildXyHeightIndex(Float32Array.from(positions), indices);
    const topZ = (x: number, y: number) => sampleXyHeight(topHeight, x, y, "max");

    const grid = buildQuadGrid({
        stations,
        junctions,
        defaults,
        rimLoop: rimPtsLive,
        dish,
        plantarField: model.outline.plantarZ,
        zDelta,
        topZ,
        nWall: options.wallLayers ?? 16,
        refineGrind: (options.archGrindDepthMm ?? 0) > 0,
        flangeHeightMm: flangeH,
        flangeLengthMm: flangeLen,
        flangeAngleDeg: flangeAng,
        footLengthMm: Math.max(1e-3, model.bounds.maxX - model.bounds.minX),
    });

    const nS = grid.nS;
    const nJ = grid.nJ;
    const generatedStart = positions.length / 3;
    for (let k = 0; k < grid.body.length; k++) positions.push(grid.body[k]!);
    const plantarStart = positions.length / 3;
    const nBoundary = grid.plantar.boundaryCount;
    for (let i = nBoundary; i < grid.plantar.points.length; i++) {
        const p = grid.plantar.points[i]!;
        positions.push(p.x, p.y, p.z);
    }
    const gridVert = (j: number, i: number): number => {
        const s = ((i % nS) + nS) % nS;
        if (j <= 0) return rimLocal[s]!;
        return generatedStart + (j - 1) * nS + s;
    };
    const plantarVert = (local: number): number => {
        if (local < nBoundary) return gridVert(grid.innerRow, local);
        return plantarStart + (local - nBoundary);
    };
    const pushTri = (a: number, b: number, c: number): void => {
        if (a === b || b === c || c === a) return;
        indices.push(a, b, c);
    };
    for (let j = 0; j < nJ - 1; j++) {
        for (let i = 0; i < nS; i++) {
            const a = gridVert(j, i);
            const b = gridVert(j, i + 1);
            const c = gridVert(j + 1, i + 1);
            const d = gridVert(j + 1, i);
            pushTri(a, b, c);
            pushTri(a, c, d);
        }
    }
    for (const f of grid.plantar.faces) {
        pushTri(plantarVert(f[0]!), plantarVert(f[1]!), plantarVert(f[2]!));
    }

    const hygiene = sanitizeMesh(positions, indices);
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
        junctionRewrite: "planar-bezier",
        planReversals: grid.planReversals,
        maxFrameAngleDeg: grid.maxFrameAngleDeg,
        maxOffPlaneMm: grid.maxOffPlaneMm,
        nJ: grid.nJ,
        filletRowStart: Math.max(0, grid.outlineRow - 3),
        wallFrames: grid.frames.map((f) => ({
            u: f.u,
            overhangMm: f.overhangMm,
            heightMm: f.heightMm,
            sheetSlopeDeg: (f.sheetSlopeRad * 180) / Math.PI,
            t0TiltDeg: (f.t0TiltRad * 180) / Math.PI,
            sheetSlopeValid: f.sheetSlopeValid,
            plantarSlopeDeg: (f.plantarSlopeRad * 180) / Math.PI,
            rFillet: f.rFillet,
            bandZ: f.bandZ,
            bandInsetMm: f.bandInsetMm,
            arcEndZ: f.arcEndZ,
            Bz: f.B.z,
        })),
        t0Log: grid.frames.map((f) => ({
            u: Number(f.u.toFixed(4)),
            sheet_h: Number(((f.sheetSlopeRad * 180) / Math.PI).toFixed(3)),
            T0: Number(((f.t0TiltRad * 180) / Math.PI).toFixed(3)),
        })),
        minWallClamps: grid.minWallClamps,
        plantarOpenEdges: grid.plantar.openEdges,
        plantarMissingBoundary: grid.plantar.missingBoundary,
        filletRing: grid.frames.map((f) => ({ ...f.F })),
        zeroAreaFaces: hygiene.zeroArea,
        duplicateFaces: hygiene.duplicates,
        meshMinZ: meshMinZOf(positions),
        generatedStart,
        generatedCount: positions.length / 3 - generatedStart,
        plantarStart,
        outlineRow: grid.outlineRow,
        innerRow: grid.innerRow,
        fieldsBeforeBF: grid.fieldsBeforeBF,
        outlineRing: grid.outlineRing,
        outlineVertexStart: generatedStart + Math.max(0, grid.outlineRow - 1) * nS,
        outlineVertexCount: nS,
        bandTiltDegMax: grid.bandTiltDegMax,
        masterMinRadiusMm: pairing.masterMinRadiusMm,
        waistMinRadiusMm: pairing.waistMinRadiusMm,
        maxSepMm: pairing.maxSepMm,
        dishLost: Boolean(model.outline.dishLost),
        floodFaceCount: model.outline.floodFaceCount,
        floodZSpanMm: model.outline.floodZSpanMm,
        interiorFaceCount: model.outline.interiorFaceCount,
        topVertexCount: generatedStart,
        originalTopVertexCount: originalTopCount,
        plantarVertexCount: grid.plantar.steinerCount,
        stitchVertexCount: nS,
        stationCount: nS,
        filletImpliedSeamDeg: grid.impliedSeamDeg,
        chordCrossings: pairing.chordCrossings,
        loftChordCrossings: pairing.chordCrossings,
        windowCrossings: 0,
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
