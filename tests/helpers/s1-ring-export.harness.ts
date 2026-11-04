// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rs } from "@rstest/core";
import type { BufferGeometry } from "three";
import { buildValidatedExportGeometry } from "@/lib/geometry/export-geometry";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { PlacedSink, Side } from "@/types";

const sampleBytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));

export const WALLS = ["straight", "round", "hybrid"] as const;
export const SIDES = ["left", "right"] as const;

export function installSampleTopFetch(): void {
    globalThis.fetch = rs.fn(async () => new Response(sampleBytes));
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
}

export function shellQuality(
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

export async function exportClosed(
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
