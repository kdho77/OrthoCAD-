// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, rs, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { buildValidatedExportGeometry } from "@/lib/geometry/export-geometry";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { SINK_DEFAULT_DEPTH_MM, SINK_KIND_ORDER, SINK_PROFILES } from "@/lib/geometry/sink";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { PlacedSink, Side } from "@/types";

const originalFetch = globalThis.fetch;
const sampleBytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
});

function installSampleTopFetch(): void {
    globalThis.fetch = rs.fn(async () => new Response(sampleBytes));
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
}

const WALLS = ["straight", "round", "hybrid"] as const;
const SIDES = ["left", "right"] as const;

/**
 * Triangle quality on the exported shell.
 * Dihedral matches the export-parity gate: the angle between normals of two
 * faces that share an edge, skipping faces under 0.001 mm² and edges under
 * 0.12 mm. Aspect is longest edge / shortest edge.
 */
function shellQuality(
    geometry: BufferGeometry,
    topVertexCount = -1,
): {
    minEdgeMm: number;
    maxAspect: number;
    aspectsOver10: number;
    topOver10: number;
    generatedOver10: number;
    over20: number;
    over100: number;
    over1000: number;
    worstDihedralDeg: number;
    upwardBottomFaces: number;
    minEdgeA: number;
    minEdgeB: number;
} {
    const posAttr = geometry.getAttribute("position");
    const pos = posAttr?.array as Float32Array | undefined;
    const idx = geometry.getIndex()?.array;
    if (!pos || !idx || posAttr.count < 3) {
        return {
            minEdgeMm: 0,
            maxAspect: Infinity,
            aspectsOver10: 0,
            topOver10: 0,
            generatedOver10: 0,
            over20: 0,
            over100: 0,
            over1000: 0,
            worstDihedralDeg: 0,
            upwardBottomFaces: 0,
            minEdgeA: -1,
            minEdgeB: -1,
        };
    }
    const edgeLen = (i: number, j: number): number =>
        Math.hypot(
            pos[i * 3]! - pos[j * 3]!,
            pos[i * 3 + 1]! - pos[j * 3 + 1]!,
            pos[i * 3 + 2]! - pos[j * 3 + 2]!,
        );
    const areaOf = (f: number): number => {
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
    };
    const normalOf = (f: number): [number, number, number] | null => {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        const ux = pos[b * 3]! - pos[a * 3]!;
        const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
        const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
        const vx = pos[c * 3]! - pos[a * 3]!;
        const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
        const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-12) return null;
        return [nx / len, ny / len, nz / len];
    };

    let upwardBottomFaces = 0;
    let minEdgeMm = Infinity;
    let maxAspect = 0;
    let aspectsOver10 = 0;
    let topOver10 = 0;
    let generatedOver10 = 0;
    let over20 = 0;
    let over100 = 0;
    let over1000 = 0;
    let minEdgeA = -1;
    let minEdgeB = -1;
    for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        if (
            [a, b, c].every((v) => Math.abs(pos[v * 3 + 2]!) <= 1e-4) &&
            areaOf(f) > 1e-6 &&
            (normalOf(f)?.[2] ?? 0) > 0
        ) {
            upwardBottomFaces++;
        }
        const ab = edgeLen(a, b);
        const bc = edgeLen(b, c);
        const ca = edgeLen(c, a);
        const short = Math.min(ab, bc, ca);
        const long = Math.max(ab, bc, ca);
        if (short < minEdgeMm) {
            minEdgeMm = short;
            if (ab <= bc && ab <= ca) {
                minEdgeA = a;
                minEdgeB = b;
            } else if (bc <= ca) {
                minEdgeA = b;
                minEdgeB = c;
            } else {
                minEdgeA = c;
                minEdgeB = a;
            }
        }
        const aspect = short < 1e-12 ? Infinity : long / short;
        if (aspect > maxAspect) maxAspect = aspect;
        if (aspect > 10) {
            aspectsOver10 += 1;
            const inTop =
                topVertexCount > 0 && a < topVertexCount && b < topVertexCount && c < topVertexCount;
            if (inTop) topOver10 += 1;
            else generatedOver10 += 1;
        }
        if (aspect > 20) over20 += 1;
        if (aspect > 100) over100 += 1;
        if (aspect > 1000) over1000 += 1;
    }

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
            const faces = edgeFaces.get(k);
            if (faces) faces.push(f);
            else edgeFaces.set(k, [f]);
        }
    }
    let worstDihedralDeg = 0;
    for (const [key, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const f1 = faces[0]!;
        const f2 = faces[1]!;
        if (areaOf(f1) < 1e-3 || areaOf(f2) < 1e-3) continue;
        const parts = key.split(",");
        const sa = Number(parts[0]);
        const sb = Number(parts[1]);
        if (edgeLen(sa, sb) < 0.12) continue;
        const n1 = normalOf(f1);
        const n2 = normalOf(f2);
        if (!n1 || !n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        const deg = (Math.acos(dot) * 180) / Math.PI;
        if (deg > worstDihedralDeg) worstDihedralDeg = deg;
    }
    return {
        minEdgeMm: Number.isFinite(minEdgeMm) ? minEdgeMm : 0,
        maxAspect,
        aspectsOver10,
        topOver10,
        generatedOver10,
        over20,
        over100,
        over1000,
        worstDihedralDeg,
        upwardBottomFaces,
        minEdgeA,
        minEdgeB,
    };
}

async function exportClosed(
    usMen: number,
    side: Side,
    wall: (typeof WALLS)[number],
    text: string,
    sinks?: { left?: PlacedSink[]; right?: PlacedSink[] },
): Promise<{
    watertight: boolean;
    euler: number;
    triangles: number;
    sliverFallback: boolean;
    sliverAspect: number;
    minEdgeMm: number;
    maxAspect: number;
    aspectsOver10: number;
    topOver10: number;
    generatedOver10: number;
    over20: number;
    over100: number;
    over1000: number;
    worstDihedralDeg: number;
    upwardBottomFaces: number;
    minEdgeA: number;
    minEdgeB: number;
    topVertexCount: number;
}> {
    installSampleTopFetch();
    const layout = insoleLayoutForUsMenSize(usMen);
    const design = createDesignWithStockPlaceholder({
        ...defaultDesign(),
        sizeSystem: "us",
        usMenSize: layout.usMenSize,
        footLengthMm: layout.footLengthMm,
        textMarking: { ...defaultTextMarking("bottom"), text },
        ...(sinks ? { sinks } : {}),
    });
    useDesignStore.setState({
        design,
        viewer: {
            transparent: false,
            heightmap: false,
            showLeft: true,
            showRight: true,
            showScans: true,
            view: "iso",
            wallModel: "procedural",
            wallStyle: wall,
        },
    });
    const geometry = await buildValidatedExportGeometry(side);
    try {
        const report = validateManifold(geometry);
        const meta = geometry.userData as {
            usedSliverFallback?: boolean;
            sliverMaxAspect?: number;
            topVertexCount?: number;
        };
        const quality = shellQuality(geometry, meta.topVertexCount ?? -1);
        return {
            watertight: report.isWatertight,
            euler: report.eulerCharacteristic,
            triangles: report.triangleCount,
            sliverFallback: meta.usedSliverFallback === true,
            sliverAspect: meta.sliverMaxAspect ?? 0,
            topVertexCount: meta.topVertexCount ?? -1,
            ...quality,
        };
    } finally {
        geometry.dispose();
    }
}

describe("S1 ring size regression", () => {
    for (const [usMen, side] of [
        [2, "right"],
        [2, "left"],
        [1.5, "right"],
        [2.5, "right"],
    ] as const) {
        test(`US ${usMen} ${side} straight has no folded plantar faces`, async () => {
            const solid = await exportClosed(usMen, side, "straight", "");
            expect(solid.watertight).toBe(true);
            expect(solid.euler).toBe(2);
            expect(solid.upwardBottomFaces).toBe(0);
            expect(solid.worstDihedralDeg).toBeLessThanOrEqual(60);
            expect(solid.sliverAspect).toBeLessThanOrEqual(20);
        }, 600_000);
    }

    test("US 5 left straight exports without a boundary sliver", async () => {
        const solid = await exportClosed(5, "left", "straight", "");
        expect(solid.watertight).toBe(true);
        expect(solid.euler).toBe(2);
        expect(solid.sliverAspect).toBeGreaterThan(0);
        expect(solid.sliverAspect).toBeLessThanOrEqual(20);
        expect(solid.worstDihedralDeg).toBeLessThanOrEqual(60);
    }, 600_000);

    for (const [usMen, side] of [
        [4.5, "left"],
        [5, "right"],
        [5.5, "left"],
    ] as const) {
        test(`US ${usMen} ${side} straight remains watertight beside the US 5 fix`, async () => {
            const solid = await exportClosed(usMen, side, "straight", "");
            expect(solid.watertight).toBe(true);
            expect(solid.euler).toBe(2);
            expect(solid.sliverFallback).toBe(false);
            expect(solid.sliverAspect).toBeLessThanOrEqual(20);
        }, 600_000);
    }

    for (const usMen of [7, 7.5, 8, 12, 12.5] as const) {
        for (const side of SIDES) {
            for (const wall of WALLS) {
                test(`US ${usMen} ${side} ${wall} with bottom name text is watertight`, async () => {
                    const solid = await exportClosed(usMen, side, wall, "DAVIS");
                    expect(solid.watertight).toBe(true);
                    expect(solid.euler).toBe(2);
                    expect(solid.triangles).toBeGreaterThan(1000);
                    // Straight replaces the recovered disk with the refined B-ring
                    // triangulation, so the exported cap is not the fallback.
                    // Round and hybrid keep that disk; US 12.5 needs it.
                    if (wall === "straight") expect(solid.sliverFallback).toBe(false);
                }, 180_000);
            }
        }
    }

    test("US 11.5 left straight does not use the sliver fallback", async () => {
        const solid = await exportClosed(11.5, "left", "straight", "");
        expect(solid.watertight).toBe(true);
        expect(solid.euler).toBe(2);
        expect(solid.sliverFallback).toBe(false);
    }, 180_000);

    for (const wall of ["round", "hybrid"] as const) {
        test(`US 11.5 left ${wall} is watertight`, async () => {
            const solid = await exportClosed(11.5, "left", wall, "SIMS");
            expect(solid.watertight).toBe(true);
            expect(solid.euler).toBe(2);
            expect(solid.triangles).toBeGreaterThan(1000);
        }, 180_000);
    }

    test("US 11.5 right straight is watertight", async () => {
        const solid = await exportClosed(11.5, "right", "straight", "");
        expect(solid.watertight).toBe(true);
        expect(solid.euler).toBe(2);
    }, 180_000);

    test("US 11.5 left with sinks stays watertight", async () => {
        const sinks = {
            left: SINK_KIND_ORDER.map((kind) => {
                const profile = SINK_PROFILES[kind];
                return {
                    id: kind,
                    kind,
                    depthMm: Math.min(
                        profile.maxDepthMm,
                        Math.max(SINK_DEFAULT_DEPTH_MM, profile.defaultDepthMm),
                    ),
                    u: profile.u,
                    v: profile.v,
                } satisfies PlacedSink;
            }),
        };
        const solid = await exportClosed(11.5, "left", "straight", "SIMS", sinks);
        expect(solid.watertight).toBe(true);
        expect(solid.euler).toBe(2);
        expect(solid.triangles).toBeGreaterThan(1000);
    }, 180_000);
});

/** Men's US catalog from 1 through 15, half sizes included. */
const US_MEN_1_TO_15 = Array.from({ length: 29 }, (_, i) => 1 + i * 0.5);

function reportsDihedral(usMen: number, side: Side): boolean {
    return usMen === 7.5 || usMen === 12 || (usMen === 11.5 && side === "left");
}

describe("S1 shell quality", () => {
    test("US 1-15 L/R straight shells keep min edge, aspect, and the named dihedrals", async () => {
        const priority = new Set([7.5, 9, 11.5, 12]);
        const order = [
            ...US_MEN_1_TO_15.filter((us) => priority.has(us)),
            ...US_MEN_1_TO_15.filter((us) => !priority.has(us)),
        ];
        const failures: string[] = [];
        const dihedral: Array<{ usMen: number; side: Side; worstDihedralDeg: number }> = [];
        for (const usMen of order) {
            for (const side of SIDES) {
                const label = `US ${usMen} ${side}`;
                let solid: Awaited<ReturnType<typeof exportClosed>>;
                try {
                    solid = await exportClosed(usMen, side, "straight", "");
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    failures.push(`${label} export threw ${message}`);
                    appendFileSync("/tmp/s1-quality.jsonl", `${JSON.stringify({ label, error: message })}\n`);
                    continue;
                }
                const row = {
                    label,
                    watertight: solid.watertight,
                    euler: solid.euler,
                    triangles: solid.triangles,
                    minEdgeMm: solid.minEdgeMm,
                    maxAspect: solid.maxAspect,
                    aspectsOver10: solid.aspectsOver10,
                    topOver10: solid.topOver10,
                    generatedOver10: solid.generatedOver10,
                    over20: solid.over20,
                    over100: solid.over100,
                    over1000: solid.over1000,
                    worstDihedralDeg: solid.worstDihedralDeg,
                    minEdgeA: solid.minEdgeA,
                    minEdgeB: solid.minEdgeB,
                    topVertexCount: solid.topVertexCount,
                    shortInTop:
                        solid.topVertexCount > 0 &&
                        solid.minEdgeA < solid.topVertexCount &&
                        solid.minEdgeB < solid.topVertexCount,
                };
                appendFileSync("/tmp/s1-quality.jsonl", `${JSON.stringify(row)}\n`);
                if (!solid.watertight || solid.euler !== 2) {
                    failures.push(`${label} watertight=${solid.watertight} euler=${solid.euler}`);
                }
                if (!(solid.minEdgeMm > 1e-4)) {
                    failures.push(`${label} min edge ${solid.minEdgeMm} mm`);
                }
                if (solid.maxAspect > 10) {
                    failures.push(`${label} aspect ${solid.maxAspect}`);
                }
                if (reportsDihedral(usMen, side)) {
                    dihedral.push({
                        usMen,
                        side,
                        worstDihedralDeg: solid.worstDihedralDeg,
                    });
                    if (solid.worstDihedralDeg > 60) {
                        failures.push(`${label} dihedral ${solid.worstDihedralDeg.toFixed(3)} deg`);
                    }
                }
            }
        }
        console.log(`S1_DIHEDRAL_REPORT ${JSON.stringify(dihedral)}`);
        expect(failures, failures.join("\n")).toEqual([]);
    }, 5_400_000);
});
