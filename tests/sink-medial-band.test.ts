// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { BASE_REFERENCE_THICKNESS_MM, getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    composePrintSolidTop,
    composeViewerPrintSolidTop,
} from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import {
    applyFloorGuard,
    applySinkCutToGeometry,
    applySinkThicknessToGeometry,
    footOutlineFromGeometry,
    meshYToAnatomical,
    SINK_KIND_ORDER,
    SINK_PROFILES,
    type SinkOutlinePoint,
    sinkCutMm,
    sinkThicknessMm,
} from "@/lib/geometry/sink";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, PlacedSink, Side, SideCorrections, SinkKind } from "@/types";

/**
 * SHA-256 of geometryToBinarySTL(reconstructProceduralPreview) on the rebased
 * head before the medial-fade change. Straight Men's 9, left foot.
 */
const PARITY_SHA256: Record<string, string> = {
    "no-sink": "22e79065d8ddfcea62036660ef9272d33aa018f03915365ffeeb6fe395c28cae",
    wedges: "25b16994ed440fe176efda099829ec9b28d33f1f7e3ca1b4eef070c1eb50f98d",
    "regional-wedge": "cc2c14d7dced00b9c459c1d03172f65942e3e18de4ccc1b4e0366ac8623e6622",
    "met-pad": "4bfbef1bb093d56d015408b73a16f75fd0a5f1584918caf690160c5d2c15ba14",
    width: "890b39682b193a2750c521c7084cf1e1aa72b13d0fb928a0743732c35965736c",
    "full-length-wedge": "b217e3b6a099beff8c1fdec69722459a9122d6bb81a9804c478b9637ee652056",
};

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const HYBRID_X0 = 72;
const HYBRID_X1 = 78;
const EDGE_LIMIT_DEG = 60;
const U0 = 0.64;
const U1 = 0.72;
const MEDIAL_BAND_MM = 12;

type WallStyle = "straight" | "round" | "hybrid";

function blank(patch: Partial<SideCorrections> = {}): SideCorrections {
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
        ...patch,
    };
}

function field(
    side: Side,
    corrections: SideCorrections,
    extra: Partial<HeightFieldParams> = {},
): HeightFieldParams {
    return {
        side,
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections,
        elements: [],
        includeElements: false,
        includeSkives: false,
        trimline: null,
        ...extra,
    };
}

function sha256Stl(geo: BufferGeometry): string {
    return createHash("sha256")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
}

async function loadPair(): Promise<{ left: BufferGeometry; right: BufferGeometry }> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    const left = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    return { left, right: mirrorGeometry(left) };
}

function ySpanAt(points: SinkOutlinePoint[], x: number): { lo: number; hi: number } | null {
    const ys: number[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        const dx = b.x - a.x;
        if (Math.abs(dx) < 1e-8) {
            if (Math.abs(a.x - x) <= 1e-3) ys.push(a.y, b.y);
            continue;
        }
        const t = (x - a.x) / dx;
        if (t < -1e-4 || t > 1 + 1e-4) continue;
        const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
        ys.push(a.y + clamped * (b.y - a.y));
    }
    if (ys.length === 0) return null;
    let lo = ys[0]!;
    let hi = ys[0]!;
    for (const y of ys) {
        if (y < lo) lo = y;
        if (y > hi) hi = y;
    }
    return { lo, hi };
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

function triArea(pos: Float32Array, idx: ArrayLike<number>, f: number): number {
    const a = idx[f]!;
    const b = idx[f + 1]!;
    const c = idx[f + 2]!;
    const ux = pos[b * 3]! - pos[a * 3]!;
    const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!;
    const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
    const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
}

interface EdgeHit {
    deg: number;
    x: number;
}

/** Every two-face edge longer than 0.12 mm. Shorter edges are degenerate. */
function twoFaceEdges(geo: BufferGeometry): Map<string, EdgeHit> {
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
    const out = new Map<string, EdgeHit>();
    for (const [key, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const f1 = faces[0]!;
        const f2 = faces[1]!;
        if (triArea(pos, idx, f1) < 1e-8 || triArea(pos, idx, f2) < 1e-8) continue;
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
        out.set(key, { deg, x: 0.5 * (pos[sa * 3]! + pos[sb * 3]!) });
    }
    return out;
}

/**
 * Dihedral of every two-face edge outside Hybrid's x 72–78 crease.
 * An edge that is already steeper than 60° on the unsunk solid is the stock
 * crease (the mirrored right hybrid crease sits at x 71.74). It must not get
 * sharper. Every other edge stays at or under 60°.
 */
function foldAgainstPlain(
    plain: BufferGeometry,
    sunk: BufferGeometry,
    wall: WallStyle,
): { worst: number; checked: number; stock: number; sharpened: number; worstX: number } {
    const before = twoFaceEdges(plain);
    const after = twoFaceEdges(sunk);
    let worst = 0;
    let worstX = 0;
    let checked = 0;
    let stock = 0;
    let sharpened = 0;
    for (const [key, edge] of after) {
        if (wall === "hybrid" && edge.x >= HYBRID_X0 && edge.x <= HYBRID_X1) continue;
        const prior = before.get(key);
        if (prior && prior.deg > EDGE_LIMIT_DEG) {
            stock++;
            if (edge.deg > prior.deg + 0.5) sharpened++;
            continue;
        }
        checked++;
        if (edge.deg > worst) {
            worst = edge.deg;
            worstX = edge.x;
        }
    }
    return { worst, checked, stock, sharpened, worstX };
}

function maxSink(kind: SinkKind): PlacedSink {
    return { id: kind, kind, depthMm: SINK_PROFILES[kind].maxDepthMm };
}

describe("1st MPJ medial fade", () => {
    test("top stays above plain inside 12 mm, slope stays under 0.3, and every edge is at most 60", async () => {
        const pair = await loadPair();
        const sections: Array<Record<string, unknown>> = [];
        try {
            for (const side of ["left", "right"] as const) {
                const raw = pair[side];
                for (const wall of ["straight", "round", "hybrid"] as const) {
                    const plain = await reconstructProceduralPreview(raw, { wallStyle: wall, side });
                    const plainUd = plain.geometry.userData as {
                        topVertexCount?: number;
                        loftN?: number;
                        medialYSign?: 1 | -1;
                    };
                    const topN = plainUd.topVertexCount ?? 0;
                    const loftBefore = plainUd.loftN ?? 0;
                    const medialYSign = (plainUd.medialYSign ?? 1) as 1 | -1;
                    const outline = footOutlineFromGeometry(plain.geometry, 0, 1, topN);
                    expect(outline, `${side} ${wall} outline`).toBeTruthy();
                    const a = plain.geometry.getAttribute("position");
                    let minX = Infinity;
                    let maxX = -Infinity;
                    let minY = Infinity;
                    let maxY = -Infinity;
                    for (let i = 0; i < topN; i++) {
                        minX = Math.min(minX, a.getX(i));
                        maxX = Math.max(maxX, a.getX(i));
                        minY = Math.min(minY, a.getY(i));
                        maxY = Math.max(maxY, a.getY(i));
                    }
                    const lengthMm = Math.max(1e-3, maxX - minX);
                    const cases: Array<{ name: string; sinks: PlacedSink[]; trench: boolean }> = [
                        { name: "mpj1-2", sinks: [{ id: "mpj1", kind: "mpj1", depthMm: 2 }], trench: true },
                        { name: "mpj1-4", sinks: [{ id: "mpj1", kind: "mpj1", depthMm: 4 }], trench: true },
                        {
                            name: "all-max",
                            sinks: SINK_KIND_ORDER.map((kind) => maxSink(kind)),
                            trench: false,
                        },
                    ];
                    for (const c of cases) {
                        const sunk = await reconstructProceduralPreview(raw, {
                            wallStyle: wall,
                            side,
                            sinks: c.sinks,
                        });
                        const sunkUd = sunk.geometry.userData as { loftN?: number; topVertexCount?: number };
                        const loftAfter = sunkUd.loftN ?? 0;
                        const fold = foldAgainstPlain(plain.geometry, sunk.geometry, wall);
                        sections.push({
                            side,
                            wall,
                            sink: c.name,
                            loftNBefore: loftBefore,
                            loftNAfter: loftAfter,
                            topN,
                            edges: fold.checked,
                            stockCrease: fold.stock,
                            outsideDeg: Number(fold.worst.toFixed(2)),
                            worstX: Number(fold.worstX.toFixed(2)),
                        });
                        console.log("[SINK-FOLD]", JSON.stringify(sections[sections.length - 1]));
                        expect(loftAfter, `${side} ${wall} ${c.name} sections`).toBe(loftBefore);
                        expect(fold.checked, `${side} ${wall} ${c.name} edges`).toBeGreaterThan(1000);
                        expect(fold.sharpened, `${side} ${wall} ${c.name} stock crease`).toBe(0);
                        expect(fold.worst, `${side} ${wall} ${c.name}`).toBeLessThanOrEqual(EDGE_LIMIT_DEG);

                        if (c.trench) {
                            const b = sunk.geometry.getAttribute("position");
                            const ctx = {
                                side,
                                lengthMm,
                                widthMm: Math.max(1e-3, maxY - minY),
                                sinks: c.sinks,
                                medialYSign,
                                footOutline: outline,
                            };
                            let band = 0;
                            let below = 0;
                            let worstBelow = 0;
                            let floorHits = 0;
                            let slope = 0;
                            let slopeAt = { dist: 0, dx: 0, dy: 0, dz: 0 };
                            const columns = new Map<number, Array<{ dist: number; net: number }>>();
                            const idx = plain.geometry.getIndex()!.array as Uint32Array | Uint16Array;
                            const inBand: boolean[] = [];
                            const limit = Math.min(topN, a.count, b.count);
                            for (let i = 0; i < limit; i++) {
                                const x = a.getX(i);
                                const y = a.getY(i);
                                const u = (x - minX) / lengthMm;
                                const span = ySpanAt(outline!, x);
                                const medialY = span ? (medialYSign > 0 ? span.hi : span.lo) : y;
                                const dist = Math.abs(y - medialY);
                                const hit = u >= U0 && u <= U1 && dist <= MEDIAL_BAND_MM + 1e-6;
                                inBand[i] = hit;
                                if (!hit) continue;
                                band++;
                                const z0 = a.getZ(i);
                                const z1 = b.getZ(i);
                                const drop = z0 - z1;
                                if (drop > worstBelow) worstBelow = drop;
                                if (z1 < z0 - 1e-3) below++;
                                const yAnat = meshYToAnatomical(y, side, medialYSign);
                                const cut = sinkCutMm(x, yAnat, ctx);
                                const thick = sinkThicknessMm(x, yAnat, ctx);
                                const guarded = applyFloorGuard(z0 + thick, cut.mm, cut.sinkId);
                                if (guarded.cutMm < cut.mm - 1e-6) floorHits++;
                                const key = Math.round(x);
                                const col = columns.get(key);
                                const sample = { dist, net: z1 - z0 };
                                if (col) col.push(sample);
                                else columns.set(key, [sample]);
                            }
                            let stationSlope = 0;
                            for (const col of columns.values()) {
                                col.sort((p, q) => p.dist - q.dist);
                                for (let k = 1; k < col.length; k++) {
                                    const dd = col[k]!.dist - col[k - 1]!.dist;
                                    if (dd < 0.2) continue;
                                    stationSlope = Math.max(
                                        stationSlope,
                                        Math.abs(col[k]!.net - col[k - 1]!.net) / dd,
                                    );
                                }
                            }
                            for (let f = 0; f < idx.length; f += 3) {
                                const tri = [idx[f]!, idx[f + 1]!, idx[f + 2]!];
                                if (tri.some((v) => v >= limit)) continue;
                                for (const [p, q] of [
                                    [tri[0]!, tri[1]!],
                                    [tri[1]!, tri[2]!],
                                    [tri[2]!, tri[0]!],
                                ] as const) {
                                    if (!inBand[p] || !inBand[q]) continue;
                                    const dx = a.getX(q) - a.getX(p);
                                    const dy = a.getY(q) - a.getY(p);
                                    if (Math.abs(dy) < 0.2 || Math.abs(dy) < Math.abs(dx)) continue;
                                    const dz = b.getZ(q) - a.getZ(q) - (b.getZ(p) - a.getZ(p));
                                    if (Math.abs(dx) > 0.35) continue;
                                    const rise = Math.abs(dz) / Math.abs(dy);
                                    if (rise > slope) {
                                        const mx = 0.5 * (a.getX(p) + a.getX(q));
                                        const my = 0.5 * (a.getY(p) + a.getY(q));
                                        const span = ySpanAt(outline!, mx);
                                        const medialY = span ? (medialYSign > 0 ? span.hi : span.lo) : my;
                                        slope = rise;
                                        slopeAt = {
                                            dist: Math.abs(my - medialY),
                                            dx: Math.abs(dx),
                                            dy: Math.abs(dy),
                                            dz: Math.abs(dz),
                                        };
                                    }
                                }
                            }
                            console.log(
                                "[SINK-MEDIAL]",
                                JSON.stringify({
                                    side,
                                    wall,
                                    sink: c.name,
                                    band,
                                    below,
                                    worstBelowMm: Number(worstBelow.toFixed(3)),
                                    floorHits,
                                    slope: Number(slope.toFixed(4)),
                                    stationSlope: Number(stationSlope.toFixed(4)),
                                    slopeAt,
                                    loftNBefore: loftBefore,
                                    loftNAfter: loftAfter,
                                }),
                            );
                            expect(band, `${side} ${wall} ${c.name} band`).toBeGreaterThan(10);
                            expect(below, `${side} ${wall} ${c.name} below plain`).toBe(0);
                            expect(floorHits, `${side} ${wall} ${c.name} floor`).toBe(0);
                            expect(stationSlope, `${side} ${wall} ${c.name} slope`).toBeLessThan(0.3);
                            expect(slope, `${side} ${wall} ${c.name} edge slope`).toBeLessThan(0.3);

                            if (wall === "straight") {
                                const sourceField = field(side, blank(), { sinks: c.sinks });
                                const viewer = await composeViewerPrintSolidTop({ raw, sourceField });
                                const printed = await composePrintSolidTop(raw, { sourceField });
                                expect(sha256Stl(viewer), `${side} ${c.name} entry`).toBe(sha256Stl(printed));
                                const exported = await reconstructProceduralPreview(raw, {
                                    wallStyle: "straight",
                                    side,
                                    sourceField,
                                    composedTop: true,
                                });
                                const src = exported.model.top.meshPositions;
                                expect(src, `${side} ${c.name} loft input`).toBeTruthy();
                                const sheet = new BufferGeometry();
                                sheet.setAttribute(
                                    "position",
                                    new Float32BufferAttribute(Float32Array.from(src!), 3),
                                );
                                const reference = sheet.clone();
                                const foot = getBaseFootprintFrame(reference, side);
                                applySinkThicknessToGeometry(sheet, reference, sourceField, foot);
                                applySinkCutToGeometry(sheet, reference, sourceField, foot);
                                const exp = exported.geometry.getAttribute("position");
                                const view = sheet.getAttribute("position");
                                const expTop =
                                    (exported.geometry.userData as { topVertexCount?: number })
                                        .topVertexCount ?? exp.count;
                                const n = Math.min(expTop, (src!.length / 3) | 0, exp.count, view.count);
                                let delta = 0;
                                for (let i = 0; i < n; i++) {
                                    delta = Math.max(
                                        delta,
                                        Math.hypot(
                                            exp.getX(i) - view.getX(i),
                                            exp.getY(i) - view.getY(i),
                                            exp.getZ(i) - view.getZ(i),
                                        ),
                                    );
                                }
                                console.log(
                                    "[SINK-VIEWPORT]",
                                    JSON.stringify({
                                        side,
                                        sink: c.name,
                                        deltaMm: Number(delta.toFixed(4)),
                                        n,
                                        loftN: (exported.geometry.userData as { loftN?: number }).loftN ?? 0,
                                    }),
                                );
                                expect(delta, `${side} ${c.name} viewport`).toBeLessThanOrEqual(0.05);
                                viewer.dispose();
                                printed.dispose();
                                sheet.dispose();
                                reference.dispose();
                                exported.geometry.dispose();
                            }
                        }
                        sunk.geometry.dispose();
                    }
                    plain.geometry.dispose();
                }
            }
        } finally {
            pair.left.dispose();
            pair.right.dispose();
        }
        console.log("[SINK-SECTION]", JSON.stringify(sections));
    }, 1_200_000);
});

describe("sink-free export hash parity", () => {
    test("no-sink, wedges, regional wedge, met pad, width, and full-length wedge match the pre-change head", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const pad: PlacedElement = {
            id: "met-1",
            kind: "met_pad",
            side: "left",
            position: { x: 40, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 5,
        };
        const cases: Array<{
            name: string;
            corrections: SideCorrections;
            extra?: Partial<HeightFieldParams>;
        }> = [
            { name: "no-sink", corrections: blank() },
            {
                name: "wedges",
                corrections: blank({
                    rearfootWedge: { side: "medial", value: 3, unit: "mm" },
                    forefootWedge: { side: "lateral", value: 4, unit: "mm" },
                }),
            },
            {
                name: "regional-wedge",
                corrections: blank({ forefootWedge: { side: "lateral", value: 4, unit: "deg" } }),
            },
            {
                name: "met-pad",
                corrections: blank(),
                extra: { elements: [pad], includeElements: true },
            },
            { name: "width", corrections: blank({ forefootWidthMm: 5 }) },
            {
                name: "full-length-wedge",
                corrections: blank({ fullLengthWedge: { side: "lateral", value: 5, unit: "deg" } }),
            },
        ];
        const hashes: Record<string, string> = {};
        try {
            for (const c of cases) {
                const sourceField = field("left", c.corrections, c.extra);
                const built = await reconstructProceduralPreview(raw, {
                    wallStyle: "straight",
                    side: "left",
                    corrections: c.corrections,
                    sourceField,
                    composedTop: true,
                });
                hashes[c.name] = sha256Stl(built.geometry);
                built.geometry.dispose();
            }
        } finally {
            raw.dispose();
        }
        console.log("[SINK-PARITY]", JSON.stringify(hashes));
        expect(hashes).toEqual(PARITY_SHA256);
    }, 900_000);
});
