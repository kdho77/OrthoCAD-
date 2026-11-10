// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import * as baseAsset from "@/lib/geometry/base-asset";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import * as meshClose from "@/lib/geometry/mesh-close";
import { foldReport, outlineExactOnBMm, windingReport } from "@/lib/geometry/procedural-wall/metrics";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import { SAMPLE_TOP_PUBLIC_PATH } from "@/lib/geometry/procedural-wall/sample-top-id";
import {
    reconstructProceduralPreview,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize, scaleSourceShapeToFootprint } from "@/lib/geometry/shoe-size";
import { binaryStlToGeometry, geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { Side, SideCorrections } from "@/types";

const SAMPLE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

const previewKernel = {
    name: "three-procedural",
    ready: true,
    tier: "preview" as const,
    buildInsole: buildInsoleGeometry,
    buildInsoleSolid(params: Parameters<typeof buildInsoleGeometry>[0]) {
        const geometry = buildInsoleGeometry(params);
        const mesh = analyzeManifold(geometry);
        return { geometry, manifold: { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight } };
    },
    buildFromBase(base: BufferGeometry) {
        const geometry = base.clone();
        const mesh = analyzeManifold(geometry);
        return { geometry, manifold: { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight } };
    },
    async exportSTL(geometry: BufferGeometry) {
        return geometryToBinarySTL(geometry);
    },
};

rs.mock("@/lib/geometry/geometry-kernel", () => ({
    getKernel: () => previewKernel,
    isAuthoritativeKernel: () => false,
    isKernelInitFailed: () => false,
    ensureKernelReady: async () => false,
}));

function sha256Stl(geo: BufferGeometry): string {
    return createHash("sha256")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
}

function sha256Buf(buf: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(buf)).digest("hex");
}

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

function referenceField(side: Side, corrections: SideCorrections): HeightFieldParams {
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
    };
}

function bbox(pos: ArrayLike<number>) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i] ?? 0;
        const z = pos[i + 2] ?? 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    return { minX, maxX, minZ, maxZ, spanX: maxX - minX };
}

function maxDz(a: ArrayLike<number>, b: ArrayLike<number>): number {
    let dz = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 2; i < n; i += 3) dz = Math.max(dz, (b[i] ?? 0) - (a[i] ?? 0));
    return dz;
}

function maxDx(a: ArrayLike<number>, b: ArrayLike<number>): number {
    let dx = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 3) dx = Math.max(dx, (b[i] ?? 0) - (a[i] ?? 0));
    return dx;
}

const HYBRID_CREASE_X0 = 72;
const HYBRID_CREASE_X1 = 78;

type WallStyle = "straight" | "round" | "hybrid";

function faceNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] | null {
    const ax = pos[a * 3] ?? 0;
    const ay = pos[a * 3 + 1] ?? 0;
    const az = pos[a * 3 + 2] ?? 0;
    const ux = (pos[b * 3] ?? 0) - ax;
    const uy = (pos[b * 3 + 1] ?? 0) - ay;
    const uz = (pos[b * 3 + 2] ?? 0) - az;
    const vx = (pos[c * 3] ?? 0) - ax;
    const vy = (pos[c * 3 + 1] ?? 0) - ay;
    const vz = (pos[c * 3 + 2] ?? 0) - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return null;
    return [nx / len, ny / len, nz / len];
}

function triArea(pos: Float32Array, idx: ArrayLike<number>, f: number): number {
    const a = idx[f] ?? 0;
    const b = idx[f + 1] ?? 0;
    const c = idx[f + 2] ?? 0;
    const ux = (pos[b * 3] ?? 0) - (pos[a * 3] ?? 0);
    const uy = (pos[b * 3 + 1] ?? 0) - (pos[a * 3 + 1] ?? 0);
    const uz = (pos[b * 3 + 2] ?? 0) - (pos[a * 3 + 2] ?? 0);
    const vx = (pos[c * 3] ?? 0) - (pos[a * 3] ?? 0);
    const vy = (pos[c * 3 + 1] ?? 0) - (pos[a * 3 + 1] ?? 0);
    const vz = (pos[c * 3 + 2] ?? 0) - (pos[a * 3 + 2] ?? 0);
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
}

/**
 * All two-face edges, same skip as the sink fold gate. Hybrid's crease is the
 * native X 72–78 band mapped through the footprint scale about the top center.
 */
function edgeFold(
    geo: BufferGeometry,
    wall: WallStyle,
    band: { x0: number; x1: number },
): { maxDeg: number; outsideDeg: number; worstX: number; worstZ: number; over60: number } {
    const pos = geo.getAttribute("position").array as Float32Array;
    const idx = geo.getIndex()?.array;
    if (!idx) return { maxDeg: 0, outsideDeg: 0, worstX: 0, worstZ: 0, over60: 0 };
    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f] ?? 0;
        const b = idx[f + 1] ?? 0;
        const c = idx[f + 2] ?? 0;
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
    let maxDeg = 0;
    let outsideDeg = 0;
    let worstX = 0;
    let worstZ = 0;
    let over60 = 0;
    for (const [key, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const f1 = faces[0] ?? 0;
        const f2 = faces[1] ?? 0;
        if (triArea(pos, idx, f1) < 1e-3 || triArea(pos, idx, f2) < 1e-3) continue;
        const parts = key.split(",").map(Number);
        const sa = parts[0] ?? 0;
        const sb = parts[1] ?? 0;
        const elen = Math.hypot(
            (pos[sa * 3] ?? 0) - (pos[sb * 3] ?? 0),
            (pos[sa * 3 + 1] ?? 0) - (pos[sb * 3 + 1] ?? 0),
            (pos[sa * 3 + 2] ?? 0) - (pos[sb * 3 + 2] ?? 0),
        );
        if (elen < 0.12) continue;
        const n1 = faceNormal(pos, idx[f1] ?? 0, idx[f1 + 1] ?? 0, idx[f1 + 2] ?? 0);
        const n2 = faceNormal(pos, idx[f2] ?? 0, idx[f2 + 1] ?? 0, idx[f2 + 2] ?? 0);
        if (!n1 || !n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        const deg = (Math.acos(dot) * 180) / Math.PI;
        const x = 0.5 * ((pos[sa * 3] ?? 0) + (pos[sb * 3] ?? 0));
        const z = 0.5 * ((pos[sa * 3 + 2] ?? 0) + (pos[sb * 3 + 2] ?? 0));
        if (deg > maxDeg) maxDeg = deg;
        const inHybridBand = wall === "hybrid" && x >= band.x0 && x <= band.x1;
        if (!inHybridBand && deg > outsideDeg) {
            outsideDeg = deg;
            worstX = x;
            worstZ = z;
        }
        if (!inHybridBand && deg > 60) over60 += 1;
    }
    return { maxDeg, outsideDeg, worstX, worstZ, over60 };
}

function hybridBand(rawMinX: number, rawMaxX: number, scale: number): { x0: number; x1: number } {
    const cx = (rawMinX + rawMaxX) / 2;
    const a = cx + (HYBRID_CREASE_X0 - cx) * scale;
    const b = cx + (HYBRID_CREASE_X1 - cx) * scale;
    return { x0: Math.min(a, b) - 1, x1: Math.max(a, b) + 1 };
}

async function loadNative(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe("export / preview parity at defaults", () => {
    afterEach(() => {
        rs.restoreAllMocks();
        resetSampleTopGeometryCache();
    });

    test("print preview matches export; forefoot default is a no-op; shell is on", async () => {
        const raw = await loadNative();
        const design9 = createDesignWithStockPlaceholder(defaultDesign());
        const field9 = baseModifierFieldAuthoritative(design9, "left", design9.thicknessMm);
        const uniform = await composePrintSolidTop(raw.clone(), {
            sourceField: { ...field9, shellThicknessMode: "uniform" },
        });
        const zonal = await composePrintSolidTop(raw.clone(), { sourceField: field9 });
        const stretched = await composePrintSolidTop(raw.clone(), {
            sourceField: {
                ...field9,
                shapeFinish: {
                    topCoverAccommodateMm: field9.shapeFinish?.topCoverAccommodateMm ?? 1.25,
                    trimmableForefoot: true,
                    trimmableForefootExtraMm: 5,
                    archGrindDepthMm: field9.shapeFinish?.archGrindDepthMm ?? 0,
                    archSkiveMm: field9.shapeFinish?.archSkiveMm ?? 0,
                    archSkiveSide: field9.shapeFinish?.archSkiveSide ?? "medial",
                },
            },
        });
        const rawPos = raw.getAttribute("position").array as Float32Array;
        const uniformPos = uniform.getAttribute("position").array as Float32Array;
        const zonalPos = zonal.getAttribute("position").array as Float32Array;
        const stretchPos = stretched.getAttribute("position").array as Float32Array;
        const shellDz = maxDz(uniformPos, zonalPos);
        const outlineDx = Math.abs(bbox(zonalPos).maxX - bbox(uniformPos).maxX);
        const stretchDx = maxDx(rawPos, stretchPos);

        const noSink = referenceField("left", blank());
        const noSinkUniform = await composePrintSolidTop(raw.clone(), {
            sourceField: { ...noSink, shellThicknessMode: "uniform" },
        });
        const noSinkZonal = await composePrintSolidTop(raw.clone(), { sourceField: noSink });
        const wedge = referenceField(
            "left",
            blank({ forefootWedge: { side: "lateral", value: 4, unit: "deg" } }),
        );
        const wedgeUniform = await composePrintSolidTop(raw.clone(), {
            sourceField: { ...wedge, shellThicknessMode: "uniform" },
        });
        const wedgeZonal = await composePrintSolidTop(raw.clone(), { sourceField: wedge });
        const noSinkShell = maxDz(
            noSinkUniform.getAttribute("position").array as Float32Array,
            noSinkZonal.getAttribute("position").array as Float32Array,
        );
        const wedgeShell = maxDz(
            wedgeUniform.getAttribute("position").array as Float32Array,
            wedgeZonal.getAttribute("position").array as Float32Array,
        );

        const layout1 = insoleLayoutForUsMenSize(1);
        const scaledTop = raw.clone();
        scaleSourceShapeToFootprint(scaledTop, layout1.scale, BASE_REFERENCE_THICKNESS_MM);
        const design1 = createDesignWithStockPlaceholder({
            ...defaultDesign(),
            sizeSystem: "us",
            usMenSize: layout1.usMenSize,
            footLengthMm: layout1.footLengthMm,
        });
        const field1 = baseModifierFieldAuthoritative(design1, "left", design1.thicknessMm);
        const pedUniform = await composePrintSolidTop(scaledTop.clone(), {
            sourceField: { ...field1, shellThicknessMode: "uniform" },
        });
        const pedZonal = await composePrintSolidTop(scaledTop.clone(), { sourceField: field1 });
        const pedShell = maxDz(
            pedUniform.getAttribute("position").array as Float32Array,
            pedZonal.getAttribute("position").array as Float32Array,
        );
        const pedOutlineDx = Math.abs(
            bbox(pedZonal.getAttribute("position").array as Float32Array).maxX -
                bbox(scaledTop.getAttribute("position").array as Float32Array).maxX,
        );

        rs.spyOn(meshClose, "assertClosedSolidAcceptable").mockImplementation(() => undefined);
        rs.spyOn(baseAsset, "loadBaseGeometry").mockImplementation(async () => raw.clone());
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.includes("SAMPLE_Top") || url === SAMPLE_TOP_PUBLIC_PATH) {
                return new Response(readFileSync(SAMPLE), { status: 200 });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;

        const cases: Array<{ usMen: number; side: Side; wall: WallStyle; identity: boolean }> = [
            // Men's 9 layout.scale is 1. The print solid still applies the XY
            // anchor, so a bare native loft is not that sheet.
            { usMen: 9, side: "left", wall: "straight", identity: false },
            { usMen: 9, side: "left", wall: "round", identity: false },
            { usMen: 9, side: "left", wall: "hybrid", identity: false },
            { usMen: 1, side: "left", wall: "straight", identity: false },
            { usMen: 1, side: "left", wall: "round", identity: false },
            { usMen: 1, side: "left", wall: "hybrid", identity: false },
            { usMen: 9, side: "right", wall: "straight", identity: false },
            { usMen: 1, side: "right", wall: "straight", identity: false },
            { usMen: 8, side: "left", wall: "straight", identity: false },
            { usMen: 8, side: "right", wall: "straight", identity: false },
            { usMen: 10, side: "left", wall: "straight", identity: false },
            { usMen: 10, side: "right", wall: "straight", identity: false },
            { usMen: 11, side: "left", wall: "straight", identity: false },
            { usMen: 11, side: "right", wall: "straight", identity: false },
        ];

        const measure = async (spec: (typeof cases)[number]) => {
            const layout = insoleLayoutForUsMenSize(spec.usMen);
            const design = createDesignWithStockPlaceholder({
                ...defaultDesign(),
                sizeSystem: "us",
                usMenSize: layout.usMenSize,
                footLengthMm: layout.footLengthMm,
            });
            const viewer = {
                transparent: false,
                heightmap: false,
                showLeft: true,
                showRight: true,
                showScans: true,
                view: "iso" as const,
                wallModel: "procedural" as const,
                wallStyle: spec.wall,
            };
            useDesignStore.setState({ design, viewer });
            const mesh = spec.side === "left" ? raw.clone() : mirrorGeometry(raw);
            const meshBox = bbox(mesh.getAttribute("position").array as Float32Array);
            const identity = spec.identity
                ? await reconstructProceduralPreview(mesh, { wallStyle: spec.wall, side: spec.side })
                : null;
            const field = baseModifierFieldAuthoritative(design, spec.side, design.thicknessMm);
            const shared = await reconstructProceduralPreview(
                mesh,
                printSolidOptions({
                    design,
                    side: spec.side,
                    field,
                    viewer,
                    trimline: null,
                    bottomPattern: null,
                }),
            );
            const { buildExportStl } = await import("@/lib/geometry/export-geometry");
            const stl = await buildExportStl(spec.side);
            const exported = binaryStlToGeometry(stl);
            const preview = shared.geometry;
            const box = bbox(preview.getAttribute("position").array as Float32Array);
            const edges = edgeFold(preview, spec.wall, hybridBand(meshBox.minX, meshBox.maxX, layout.scale));
            const fold = foldReport(preview);
            const foldAll = foldReport(preview, { wholeInsole: true });
            const exportBox = bbox(exported.getAttribute("position").array as Float32Array);
            const row = {
                usMen: spec.usMen,
                side: spec.side,
                wall: spec.wall,
                scale: layout.scale,
                identityHash: identity ? sha256Stl(identity.geometry) : null,
                sharedHash: sha256Stl(preview),
                exportHash: sha256Buf(stl),
                volumeMm3: windingReport(preview).signedVolume,
                minZ: box.minZ,
                maxZ: box.maxZ,
                maxX: box.maxX,
                spanX: box.spanX,
                outlineOnBMm: outlineExactOnBMm(preview),
                edgeMaxDeg: edges.maxDeg,
                edgeOutsideDeg: edges.outsideDeg,
                edgeWorstX: edges.worstX,
                edgeWorstZ: edges.worstZ,
                edgeOver60: edges.over60,
                worstDeg: fold.worstDeg,
                wholeInsoleDeg: foldAll.worstDeg,
                exportMinZ: exportBox.minZ,
                exportSpanX: exportBox.spanX,
            };
            identity?.geometry.dispose();
            preview.dispose();
            exported.dispose();
            mesh.dispose();
            return row;
        };

        const rows = [];
        for (const spec of cases) rows.push(await measure(spec));

        const report = {
            shellDz,
            outlineDx,
            stretchDx,
            noSinkShell,
            wedgeShell,
            pedShell,
            pedOutlineDx,
            pedScale: layout1.scale,
            rows,
        };
        writeFileSync("/tmp/parity-acceptance.json", JSON.stringify(report, null, 2));

        expect(shellDz).toBeGreaterThan(0.8);
        expect(shellDz).toBeLessThan(1);
        expect(outlineDx).toBeLessThan(0.01);
        expect(stretchDx).toBeCloseTo(5, 2);
        expect(noSinkShell).toBeGreaterThan(0.8);
        expect(wedgeShell).toBeGreaterThan(0.4);
        expect(pedShell).toBeGreaterThan(0.8);
        expect(pedShell).toBeLessThan(1.05);
        expect(pedOutlineDx).toBeLessThan(0.01);

        for (const row of rows) {
            const label = `US ${row.usMen} ${row.side} ${row.wall}`;
            if (row.identityHash != null) expect(row.identityHash, label).toBe(row.sharedHash);
            expect(row.sharedHash, label).toBe(row.exportHash);
            expect(row.outlineOnBMm, label).toBeLessThan(0.01);
            expect(Math.abs(row.minZ), label).toBeLessThan(1e-4);
            expect(Math.abs(row.exportMinZ), label).toBeLessThan(1e-4);
            expect(row.exportSpanX, label).toBeCloseTo(row.spanX, 3);
            // All edges of all three walls. Hybrid's in-band crease is exempt.
            // Default solids have no wedge, so nothing is allowed up to 66.
            expect(row.edgeOutsideDeg, label).toBeLessThanOrEqual(60);
        }

        uniform.dispose();
        zonal.dispose();
        stretched.dispose();
        noSinkUniform.dispose();
        noSinkZonal.dispose();
        wedgeUniform.dispose();
        wedgeZonal.dispose();
        pedUniform.dispose();
        pedZonal.dispose();
        scaledTop.dispose();
        raw.dispose();
    }, 2_400_000);
});
