// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferGeometry, type BufferGeometry as BufferGeometryType, Float32BufferAttribute } from "three";
import { BASE_REFERENCE_THICKNESS_MM, getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import { medialSign, meshYFromAnatomicalLateral } from "@/lib/geometry/handedness";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import {
    applySinkCutToGeometry,
    applySinkThicknessToGeometry,
    FLOOR_MIN_MM,
    footOutlineFromGeometry,
    meshYToAnatomical,
    SINK_KIND_ORDER,
    SINK_PROFILES,
    SINK_WALL_MIN_MM,
    type SinkSurfaceContext,
    sinkCutMm,
    sinkFrame,
    sinkThicknessMm,
} from "@/lib/geometry/sink";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedSink, Side, SideCorrections } from "@/types";

/**
 * US 9.5 ApexCore, order Robert Cohen a439e704. Left MPJ5.
 * Manufactured top is unsunk Z + T − S, then the 2 mm floor.
 * T is depth + 0.5 mm over 25 mm. At the met head that net is the
 * 0.5 mm clearance, and the 2 mm figure is the cut below the thickened top.
 * A drop of 2 mm below the unsunk right would put this ~2.2 mm shell
 * under the floor.
 */
const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const MPJ5: PlacedSink = { id: "mpj5", kind: "mpj5", depthMm: 2 };
const US_95_SCALE = insoleLayoutForUsMenSize(9.5).scale;
const SECTION = { x: 185, y: 30 };

function zeroCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(side: Side, sinks: PlacedSink[]): HeightFieldParams {
    return {
        side,
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zeroCorrections(),
        elements: [],
        includeElements: false,
        includeSkives: false,
        trimline: null,
        sinks,
    };
}

async function loadTop(): Promise<BufferGeometryType> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

async function exportFoot(top: BufferGeometryType, side: Side, sinks: PlacedSink[]) {
    const raw = side === "right" ? mirrorGeometry(top) : top.clone();
    try {
        return await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side,
            sourceField: field(side, sinks),
            composedTop: true,
            footprintScale: US_95_SCALE,
        });
    } finally {
        raw.dispose();
    }
}

function topCount(geo: BufferGeometryType): number {
    const n = (geo.userData as { topVertexCount?: number }).topVertexCount;
    const count = geo.getAttribute("position").count;
    return n && n > 0 ? Math.min(n, count) : count;
}

function sinkCtx(geo: BufferGeometryType, side: Side, sinks: PlacedSink[]): SinkSurfaceContext {
    const pos = geo.getAttribute("position");
    const n = topCount(geo);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
        minX = Math.min(minX, pos.getX(i));
        maxX = Math.max(maxX, pos.getX(i));
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
    }
    return {
        side,
        lengthMm: Math.max(1e-3, maxX - minX),
        widthMm: Math.max(1e-3, maxY - minY),
        sinks,
        medialYSign: medialSign(side),
        footOutline: footOutlineFromGeometry(geo, 0, 1, n) ?? undefined,
    };
}

function metHead(geo: BufferGeometryType, side: Side, sink: PlacedSink): { x: number; y: number } {
    const frame = sinkFrame(sink, sinkCtx(geo, side, [sink]));
    if (!frame) throw new Error(`no ${side} mpj5 frame`);
    return { x: frame.dx, y: meshYFromAnatomicalLateral(frame.dy, side) };
}

function nearestZ(geo: BufferGeometryType, x: number, y: number): { z: number; i: number; d: number } {
    const pos = geo.getAttribute("position");
    const n = topCount(geo);
    let best = Infinity;
    let z = Number.NaN;
    let i = -1;
    for (let k = 0; k < n; k++) {
        const d = (pos.getX(k) - x) ** 2 + (pos.getY(k) - y) ** 2;
        if (d < best) {
            best = d;
            z = pos.getZ(k);
            i = k;
        }
    }
    return { z, i, d: Math.sqrt(best) };
}

function faceNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] | null {
    const ax = pos[a * 3]!;
    const ay = pos[a * 3 + 1]!;
    const az = pos[a * 3 + 2]!;
    const ux = pos[b * 3]! - ax;
    const uy = pos[b * 3 + 1]! - ay;
    const uz = pos[b * 3 + 2]! - az;
    const vx = pos[c * 3]! - ax;
    const vy = pos[c * 3 + 1]! - ay;
    const vz = pos[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return null;
    return [nx / len, ny / len, nz / len];
}

function worstDihedral(geo: BufferGeometryType): number {
    const pos = geo.getAttribute("position").array as Float32Array;
    const idx = geo.getIndex()!.array as Uint32Array | Uint16Array;
    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = p < q ? `${p},${q}` : `${q},${p}`;
            let faces = edgeFaces.get(k);
            if (!faces) {
                faces = [];
                edgeFaces.set(k, faces);
            }
            faces.push(f);
        }
    }
    let worst = 0;
    for (const [key, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const f1 = faces[0]!;
        const f2 = faces[1]!;
        const [sa, sb] = key.split(",").map(Number) as [number, number];
        const elen = Math.hypot(
            pos[sa * 3]! - pos[sb * 3]!,
            pos[sa * 3 + 1]! - pos[sb * 3 + 1]!,
            pos[sa * 3 + 2]! - pos[sb * 3 + 2]!,
        );
        if (elen < 0.12) continue;
        const n1 = faceNormal(pos, idx[f1]!, idx[f1 + 1]!, idx[f1 + 2]!);
        const n2 = faceNormal(pos, idx[f2]!, idx[f2 + 1]!, idx[f2 + 2]!);
        if (!n1 || !n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        const deg = (Math.acos(dot) * 180) / Math.PI;
        if (deg > worst) worst = deg;
    }
    return worst;
}

describe("MPJ5 composed sink", () => {
    test("floor, preview, met-head cut, and dihedral", async () => {
        const top = await loadTop();
        const leftPlain = await exportFoot(top, "left", []);
        const leftSink = await exportFoot(top, "left", [MPJ5]);
        const rightPlain = await exportFoot(top, "right", []);
        const rightSink = await exportFoot(top, "right", [MPJ5]);
        const allSinks = SINK_KIND_ORDER.map((kind) => ({
            id: kind,
            kind,
            depthMm: SINK_PROFILES[kind].maxDepthMm,
        }));
        const leftAll = await exportFoot(top, "left", allSinks);
        const rightPlainMirrored = mirrorGeometry(rightPlain.geometry);
        try {
            const ctx = sinkCtx(leftPlain.geometry, "left", [MPJ5]);
            const head = metHead(leftPlain.geometry, "left", MPJ5);
            const leftAt = nearestZ(leftSink.geometry, head.x, head.y);
            const rightAt = nearestZ(rightPlainMirrored, head.x, head.y);
            const yAnat = meshYToAnatomical(head.y, "left", ctx.medialYSign);
            const T = sinkThicknessMm(head.x, yAnat, ctx);
            const S = sinkCutMm(head.x, yAnat, ctx).mm;
            const delta = leftAt.z - rightAt.z;
            const dish = rightAt.z + T - leftAt.z;

            const src = leftSink.model.top.meshPositions;
            expect(src, "loft input").toBeTruthy();
            const sheet = new BufferGeometry();
            sheet.setAttribute("position", new Float32BufferAttribute(Float32Array.from(src!), 3));
            const reference = sheet.clone();
            const foot = getBaseFootprintFrame(reference, "left");
            const sourceField = field("left", [MPJ5]);
            applySinkThicknessToGeometry(sheet, reference, sourceField, foot);
            applySinkCutToGeometry(sheet, reference, sourceField, foot);
            const exp = leftSink.geometry.getAttribute("position");
            const view = sheet.getAttribute("position");
            const shared = Math.min(topCount(leftSink.geometry), view.count);
            let sectionI = 0;
            let sectionD = Infinity;
            for (let i = 0; i < shared; i++) {
                const d = (exp.getX(i) - SECTION.x) ** 2 + (exp.getY(i) - SECTION.y) ** 2;
                if (d < sectionD) {
                    sectionD = d;
                    sectionI = i;
                }
            }
            const sectionDelta = Math.abs(exp.getZ(sectionI) - view.getZ(sectionI));

            const plainPos = leftPlain.geometry.getAttribute("position");
            const allPos = leftAll.geometry.getAttribute("position");
            const allCtx = sinkCtx(leftPlain.geometry, "left", allSinks);
            const n = Math.min(topCount(leftPlain.geometry), topCount(leftAll.geometry));
            let minFloor = Infinity;
            let styloidEdge = Infinity;
            let styloidCrest = Number.NaN;
            let styloidPlain = Number.NaN;
            let offRing = 0;
            const cell = 2;
            const bins = new Map<string, Array<{ x: number; y: number; z: number }>>();
            const rn = topCount(rightPlainMirrored);
            for (let i = 0; i < rn; i++) {
                const x = rightPlainMirrored.getAttribute("position").getX(i);
                const y = rightPlainMirrored.getAttribute("position").getY(i);
                const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
                const bucket = bins.get(key);
                const sample = { x, y, z: rightPlainMirrored.getAttribute("position").getZ(i) };
                if (bucket) bucket.push(sample);
                else bins.set(key, [sample]);
            }
            const rightZAt = (x: number, y: number): number => {
                const cx = Math.floor(x / cell);
                const cy = Math.floor(y / cell);
                let best = Infinity;
                let z = 0;
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        const bucket = bins.get(`${cx + dx},${cy + dy}`);
                        if (!bucket) continue;
                        for (const p of bucket) {
                            const d = (p.x - x) ** 2 + (p.y - y) ** 2;
                            if (d < best) {
                                best = d;
                                z = p.z;
                            }
                        }
                    }
                }
                return z;
            };
            for (let i = 0; i < n; i++) {
                const x = plainPos.getX(i);
                const y = plainPos.getY(i);
                const z0 = plainPos.getZ(i);
                const z1 = allPos.getZ(i);
                const yLat = meshYToAnatomical(y, "left", allCtx.medialYSign);
                const cut = sinkCutMm(x, yLat, allCtx);
                if (cut.weight >= 0.5 && z0 >= FLOOR_MIN_MM - 1e-3) {
                    minFloor = Math.min(minFloor, z1);
                }
                if (cut.sinkId === "styloid" && cut.weight >= 0.5 && allCtx.footOutline) {
                    const outline = allCtx.footOutline;
                    let edge = Infinity;
                    for (const p of outline) edge = Math.min(edge, Math.hypot(x - p.x, y - p.y));
                    if (edge < styloidEdge) {
                        styloidEdge = edge;
                        styloidCrest = z1;
                        styloidPlain = z0;
                    }
                }
            }
            const sinkPos = leftSink.geometry.getAttribute("position");
            const sn = topCount(leftSink.geometry);
            let offRingPositive = 0;
            for (let i = 0; i < sn; i++) {
                const x = sinkPos.getX(i);
                const y = sinkPos.getY(i);
                const yLat = meshYToAnatomical(y, "left", ctx.medialYSign);
                const thick = sinkThicknessMm(x, yLat, ctx);
                if (thick >= 0.05) continue;
                const rise = sinkPos.getZ(i) - rightZAt(x, y);
                if (rise > offRingPositive) offRingPositive = rise;
                if (rise > 0.05) offRing++;
            }

            const headR = metHead(rightPlain.geometry, "right", MPJ5);
            const rightOnly =
                nearestZ(rightSink.geometry, headR.x, headR.y).z -
                nearestZ(rightPlain.geometry, headR.x, headR.y).z;
            const fold = worstDihedral(leftSink.geometry);
            const foldAll = worstDihedral(leftAll.geometry);

            const artifactDir = "/opt/cursor/artifacts";
            mkdirSync(artifactDir, { recursive: true });
            writeFileSync(
                resolve(artifactDir, "cohen-a439e704-left.stl"),
                Buffer.from(geometryToBinarySTL(leftSink.geometry)),
            );
            writeFileSync(
                resolve(artifactDir, "cohen-a439e704-right.stl"),
                Buffer.from(geometryToBinarySTL(rightPlain.geometry)),
            );

            console.log(
                "[MPJ5-COMPOSED]",
                JSON.stringify({
                    head,
                    section: { i: sectionI, dMm: Number(Math.sqrt(sectionD).toFixed(3)), sectionDelta },
                    T,
                    S,
                    delta,
                    dish,
                    rightOnly,
                    minFloor,
                    styloidCrest,
                    styloidPlain,
                    styloidEdge,
                    offRingPositive,
                    offRing,
                    fold,
                    foldAll,
                }),
            );

            expect(minFloor, "floor under every sink").toBeGreaterThanOrEqual(FLOOR_MIN_MM - 1e-3);
            expect(styloidEdge, "styloid crest is on the outline").toBeLessThan(12);
            const crestFloor = styloidPlain >= SINK_WALL_MIN_MM - 1e-3 ? SINK_WALL_MIN_MM : styloidPlain;
            expect(styloidCrest, "styloid crest").toBeGreaterThanOrEqual(crestFloor - 1e-3);
            expect(sectionDelta, "preview vs export at x185 y+30").toBeLessThanOrEqual(0.01);
            expect(Math.abs(delta - (T - S)), "met head is z0 + T - S").toBeLessThan(0.2);
            expect(dish, "met head cut below the thickened top").toBeGreaterThan(1.5);
            expect(dish, "met head cut below the thickened top").toBeLessThan(2.6);
            expect(offRingPositive, "no rise off the thickening ring").toBeLessThanOrEqual(0.05);
            expect(rightOnly, "right-only still follows T - S").toBeGreaterThan(-0.2);
            expect(rightOnly, "right-only still follows T - S").toBeLessThan(1);
            expect(fold, "MPJ5 dihedral").toBeLessThanOrEqual(60);
            expect(foldAll, "all-sink dihedral").toBeLessThanOrEqual(60);

            sheet.dispose();
            reference.dispose();
        } finally {
            top.dispose();
            leftPlain.geometry.dispose();
            leftSink.geometry.dispose();
            rightPlain.geometry.dispose();
            rightSink.geometry.dispose();
            leftAll.geometry.dispose();
            rightPlainMirrored.dispose();
        }
    }, 300_000);
});
