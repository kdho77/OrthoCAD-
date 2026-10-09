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
import {
    ensureCcw,
    type PolyPoint,
    polylineArcLengths,
    resamplePolyline,
    startAtPosteriorHeel,
} from "./curves";
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
import { applyCurveModifiers, type ProceduralModifierInput, plantarZDelta } from "./modifiers";
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

function matchOutlineToRim(outline: PolyPoint[], rim: PolyPoint[]): PolyPoint[] {
    if (outline.length < 3) return rim.map((r) => ({ ...r, z: 0 }));
    const src = startAtPosteriorHeel(ensureCcw(outline.map((p) => ({ ...p }))));
    if (src.length === rim.length) return src;
    const dense = resamplePolyline(src, Math.max(src.length, rim.length * 4));
    const c = { x: 0, y: 0 };
    for (const p of dense) {
        c.x += p.x;
        c.y += p.y;
    }
    c.x /= dense.length;
    c.y /= dense.length;
    const ns = dense.map((_, i) => {
        const prev = dense[(i + dense.length - 1) % dense.length]!;
        const next = dense[(i + 1) % dense.length]!;
        const tx = next.x - prev.x;
        const ty = next.y - prev.y;
        const len = Math.hypot(tx, ty) || 1;
        let nx = ty / len;
        let ny = -tx / len;
        if (nx * (dense[i]!.x - c.x) + ny * (dense[i]!.y - c.y) < 0) {
            nx = -nx;
            ny = -ny;
        }
        return { x: nx, y: ny };
    });
    const out: PolyPoint[] = [];
    let last = 0;
    const m = dense.length;
    for (const r of rim) {
        let bestI = last;
        let best = Infinity;
        const window = Math.floor(m / 6);
        for (let k = 0; k <= window; k++) {
            const i = (last + k) % m;
            const p = dense[i]!;
            const n = ns[i]!;
            const dx = r.x - p.x;
            const dy = r.y - p.y;
            const along = dx * n.x + dy * n.y;
            const tang = dx * -n.y + dy * n.x;
            const score = Math.abs(tang) + Math.max(0, -along) * 4 + Math.abs(along) * 0.05;
            if (score < best) {
                best = score;
                bestI = i;
            }
        }
        last = bestI;
        out.push({ ...dense[bestI]! });
    }
    return out;
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

    const curves = applyCurveModifiers(model, options);
    const outlineMatched = matchOutlineToRim(curves.outline, rimPts);
    const plantarHeight =
        model.outline.meshPositions && model.outline.meshIndices
            ? buildXyHeightIndex(model.outline.meshPositions, model.outline.meshIndices)
            : null;
    for (const p of outlineMatched) {
        p.z = sampleZ(model.outline.plantarZ, plantarHeight, p.x, p.y, p.z, "min");
        p.z += plantarZDelta(p.x, p.y, model.bounds, options);
    }

    const stations = buildHermiteStations(outlineMatched, rimPts, model.bounds);
    const grid = loftHermiteWall({
        stations,
        defaults,
        nT: options.wallLayers ?? 16,
        footLengthMm: Math.max(1e-3, model.bounds.maxX - model.bounds.minX),
        flangeHeightMm: flangeH,
        flangeLengthMm: flangeLen,
        flangeAngleDeg: flangeAng,
    });

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

    const plantarRim = appendStockPlantar(model, options, positions, outlineMatched, push, pushTri);
    const outlineIdx = plantarRim;
    const outlineStart = outlineIdx[0] ?? positions.length / 3;

    const nT = grid.nT;
    const nS = grid.nS;
    const wallStart = positions.length / 3;
    for (let ti = 1; ti < nT - 1; ti++) {
        for (let si = 0; si < nS; si++) {
            const o = (ti * nS + si) * 3;
            positions.push(grid.positions[o]!, grid.positions[o + 1]!, grid.positions[o + 2]!);
        }
    }
    const wallVert = (ti: number, si: number): number => {
        const s = ((si % nS) + nS) % nS;
        if (ti <= 0) return outlineIdx[s] ?? outlineStart + s;
        if (ti >= nT - 1) return rimLocal[s]!;
        return wallStart + (ti - 1) * nS + s;
    };
    // Interior wall quads from the first rising ring to the top rim.
    for (let ti = 1; ti < nT - 1; ti++) {
        for (let si = 0; si < nS; si++) {
            const a = wallVert(ti, si);
            const b = wallVert(ti, si + 1);
            const c = wallVert(ti + 1, si + 1);
            const d = wallVert(ti + 1, si);
            pushTri(a, b, c);
            pushTri(a, c, d);
        }
    }
    // Bottom stitch: every plantar-boundary vert ↔ first wall ring (natural tangent).
    const firstRing: number[] = [];
    for (let si = 0; si < nS; si++) firstRing.push(wallVert(1, si));
    zipClosedLoops(outlineIdx, firstRing, positions, pushTri);

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData = {
        wallModel: "procedural",
        stockId: model.id,
        loftN: n,
        topVertexCount: topPos.length / 3,
        outlineVertexCount: n,
        deviceType: preset,
        lateralFlangeHeightMm: flangeH,
        measuredVsBound: defaults.report,
        flareDiagnostics: defaults.flareDiagnostics,
        manifoldHint: analyzeManifold(geo),
    };
    return geo;
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
        const map = new Map<number, number>();
        const remap = (i: number): number => {
            let ni = map.get(i);
            if (ni == null) {
                const p = transformPlantarVertex(
                    srcPos[i * 3]!,
                    srcPos[i * 3 + 1]!,
                    srcPos[i * 3 + 2]!,
                    model.bounds,
                    options,
                );
                ni = push(p);
                map.set(i, ni);
            }
            return ni;
        };
        for (let t = 0; t < srcIdx.length; t += 3) {
            pushTri(remap(srcIdx[t]!), remap(srcIdx[t + 1]!), remap(srcIdx[t + 2]!));
        }
        const rim = srcRim.map((i) => remap(i));
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

function zipClosedLoops(
    aIdx: number[],
    bIdx: number[],
    positions: number[],
    pushTri: (a: number, b: number, c: number, flip?: boolean) => void,
): void {
    const nA = aIdx.length;
    const nB = bIdx.length;
    if (nA < 2 || nB < 2) return;
    const asPts = (ids: number[]): PolyPoint[] =>
        ids.map((i) => ({ x: positions[i * 3]!, y: positions[i * 3 + 1]!, z: positions[i * 3 + 2]! }));
    const sA = polylineArcLengths(asPts(aIdx));
    const sB = polylineArcLengths(asPts(bIdx));
    const totA = sA.total || 1;
    const totB = sB.total || 1;
    let i = 0;
    let j = 0;
    for (let step = 0; step < nA + nB; step++) {
        const a0 = aIdx[i % nA]!;
        const b0 = bIdx[j % nB]!;
        const aDone = i >= nA;
        const bDone = j >= nB;
        if (aDone && bDone) break;
        const nextA = sA.cum[Math.min(i + 1, nA)]! / totA;
        const nextB = sB.cum[Math.min(j + 1, nB)]! / totB;
        if (!aDone && (bDone || nextA <= nextB)) {
            pushTri(a0, aIdx[(i + 1) % nA]!, b0);
            i++;
        } else {
            pushTri(a0, bIdx[(j + 1) % nB]!, b0);
            j++;
        }
    }
}
