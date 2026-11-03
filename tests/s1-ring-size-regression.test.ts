// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
import { readFileSync } from "node:fs";
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
const SHORT_EDGE_MM = 1e-4;

/** Straight export on main b17aa047. null means that export threw. */
const MAIN_STRAIGHT: Record<string, { minEdgeMm: number; aspectsOver10: number } | null> = {
    "US 1 left": { minEdgeMm: 5.737918455692796e-5, aspectsOver10: 22197 },
    "US 1 right": { minEdgeMm: 5.737918455692796e-5, aspectsOver10: 21313 },
    "US 1.5 left": { minEdgeMm: 6.106495129998063e-5, aspectsOver10: 22254 },
    "US 1.5 right": { minEdgeMm: 6.106495129998063e-5, aspectsOver10: 21373 },
    "US 2 left": { minEdgeMm: 8.7738037109375e-5, aspectsOver10: 22266 },
    "US 2 right": { minEdgeMm: 8.7738037109375e-5, aspectsOver10: 21396 },
    "US 2.5 left": { minEdgeMm: 6.823937919616058e-5, aspectsOver10: 22297 },
    "US 2.5 right": { minEdgeMm: 6.823937919616058e-5, aspectsOver10: 22330 },
    "US 3 left": { minEdgeMm: 6.823937919616058e-5, aspectsOver10: 22338 },
    "US 3 right": { minEdgeMm: 6.823937919616058e-5, aspectsOver10: 22337 },
    "US 3.5 left": null,
    "US 3.5 right": { minEdgeMm: 6.995056465489292e-5, aspectsOver10: 22334 },
    "US 4 left": { minEdgeMm: 9.658042069375735e-5, aspectsOver10: 22337 },
    "US 4 right": { minEdgeMm: 9.658042069375735e-5, aspectsOver10: 22318 },
    "US 4.5 left": { minEdgeMm: 6.662082365636055e-5, aspectsOver10: 22324 },
    "US 4.5 right": { minEdgeMm: 6.662082365636055e-5, aspectsOver10: 22352 },
    "US 5 left": null,
    "US 5 right": { minEdgeMm: 0.00010034901762364126, aspectsOver10: 22342 },
    "US 5.5 left": { minEdgeMm: 7.514082185208209e-5, aspectsOver10: 22373 },
    "US 5.5 right": { minEdgeMm: 7.514082185208209e-5, aspectsOver10: 22390 },
    "US 6 left": { minEdgeMm: 7.864199877963371e-5, aspectsOver10: 22369 },
    "US 6 right": { minEdgeMm: 7.864199877963371e-5, aspectsOver10: 22397 },
    "US 6.5 left": { minEdgeMm: 7.514082185208209e-5, aspectsOver10: 22403 },
    "US 6.5 right": { minEdgeMm: 7.514082185208209e-5, aspectsOver10: 22421 },
    "US 7 left": { minEdgeMm: 7.864199877963371e-5, aspectsOver10: 22407 },
    "US 7 right": { minEdgeMm: 7.864199877963371e-5, aspectsOver10: 22458 },
    "US 7.5 left": { minEdgeMm: 0.00011167359289783055, aspectsOver10: 22446 },
    "US 7.5 right": { minEdgeMm: 0.00011167359289783055, aspectsOver10: 22429 },
    "US 8 left": { minEdgeMm: 8.21710938588639e-5, aspectsOver10: 22455 },
    "US 8 right": { minEdgeMm: 8.21710938588639e-5, aspectsOver10: 22466 },
    "US 8.5 left": { minEdgeMm: 7.864199877963371e-5, aspectsOver10: 22494 },
    "US 8.5 right": null,
    "US 9 left": { minEdgeMm: 8.21710938588639e-5, aspectsOver10: 22496 },
    "US 9 right": { minEdgeMm: 8.21710938588639e-5, aspectsOver10: 22568 },
    "US 9.5 left": { minEdgeMm: 8.572465917298976e-5, aspectsOver10: 22554 },
    "US 9.5 right": { minEdgeMm: 8.572465917298976e-5, aspectsOver10: 22578 },
    "US 10 left": { minEdgeMm: 8.21710938588639e-5, aspectsOver10: 22583 },
    "US 10 right": { minEdgeMm: 8.21710938588639e-5, aspectsOver10: 21990 },
    "US 10.5 left": { minEdgeMm: 9.226521776159533e-5, aspectsOver10: 21986 },
    "US 10.5 right": { minEdgeMm: 9.226521776159533e-5, aspectsOver10: 22002 },
    "US 11 left": { minEdgeMm: 8.572465917298976e-5, aspectsOver10: 21989 },
    "US 11 right": { minEdgeMm: 8.572465917298976e-5, aspectsOver10: 22027 },
    "US 11.5 left": null,
    "US 11.5 right": { minEdgeMm: 8.929977348876668e-5, aspectsOver10: 22048 },
    "US 12 left": { minEdgeMm: 0.00012680641280055741, aspectsOver10: 22156 },
    "US 12 right": { minEdgeMm: 0.00012680641280055741, aspectsOver10: 22198 },
    "US 12.5 left": null,
    "US 12.5 right": null,
    "US 13 left": { minEdgeMm: 9.289394883640992e-5, aspectsOver10: 23191 },
    "US 13 right": { minEdgeMm: 9.289394883640992e-5, aspectsOver10: 22601 },
    "US 13.5 left": { minEdgeMm: 9.8961805504401e-5, aspectsOver10: 24422 },
    "US 13.5 right": { minEdgeMm: 9.8961805504401e-5, aspectsOver10: 23702 },
    "US 14 left": { minEdgeMm: 9.8961805504401e-5, aspectsOver10: 24580 },
    "US 14 right": { minEdgeMm: 9.8961805504401e-5, aspectsOver10: 23753 },
    "US 14.5 left": { minEdgeMm: 9.289394883640992e-5, aspectsOver10: 24627 },
    "US 14.5 right": { minEdgeMm: 9.289394883640992e-5, aspectsOver10: 23774 },
    "US 15 left": { minEdgeMm: 9.650505554713072e-5, aspectsOver10: 24767 },
    "US 15 right": { minEdgeMm: 9.650505554713072e-5, aspectsOver10: 23870 },
};

/**
 * Head is worse when main built a shell and this head either fails to export,
 * introduces a shorter edge under 0.0001 mm, or has more triangles over aspect 10.
 * A size main does not build is not a regression.
 */
function worseThanMain(
    label: string,
    head: { minEdgeMm: number; aspectsOver10: number } | null,
    main: { minEdgeMm: number; aspectsOver10: number } | null,
): string | null {
    if (main == null) return null;
    if (head == null) return `${label} export failed`;
    const notes: string[] = [];
    if (head.minEdgeMm < SHORT_EDGE_MM && head.minEdgeMm < main.minEdgeMm - 1e-9) {
        notes.push(`new edge ${head.minEdgeMm} mm under ${SHORT_EDGE_MM} mm (main ${main.minEdgeMm} mm)`);
    }
    if (head.aspectsOver10 > main.aspectsOver10) {
        notes.push(`aspect>10 ${head.aspectsOver10} > main ${main.aspectsOver10}`);
    }
    return notes.length ? `${label} ${notes.join("; ")}` : null;
}

describe("S1 shell quality", () => {
    test("US 1-15 L/R straight shells are no worse than main", async () => {
        const failures: string[] = [];
        for (const usMen of US_MEN_1_TO_15) {
            for (const side of SIDES) {
                const label = `US ${usMen} ${side}`;
                const main = MAIN_STRAIGHT[label];
                if (main === undefined) failures.push(`${label} missing main baseline`);
                let head: { minEdgeMm: number; aspectsOver10: number } | null = null;
                try {
                    const solid = await exportClosed(usMen, side, "straight", "");
                    head = { minEdgeMm: solid.minEdgeMm, aspectsOver10: solid.aspectsOver10 };
                } catch {
                    head = null;
                }
                const worse = worseThanMain(label, head, main ?? null);
                if (worse) failures.push(worse);
            }
        }
        expect(failures, failures.join("\n")).toEqual([]);
    }, 5_400_000);
});
