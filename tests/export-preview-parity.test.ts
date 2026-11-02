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
import { insoleLayoutForUsMenSize, scaleFootprintUniform } from "@/lib/geometry/shoe-size";
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

async function loadNative(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe("export / preview parity at defaults", () => {
    afterEach(() => {
        rs.restoreAllMocks();
        resetSampleTopGeometryCache();
    });

    test("US 9 and US 1 preview match the print solid; forefoot default is a no-op; shell is on", async () => {
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

        rs.spyOn(meshClose, "assertClosedSolidAcceptable").mockImplementation(() => undefined);
        rs.spyOn(baseAsset, "loadBaseGeometry").mockImplementation(async () => raw.clone());
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.includes("SAMPLE_Top") || url === SAMPLE_TOP_PUBLIC_PATH) {
                return new Response(readFileSync(SAMPLE), { status: 200 });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;

        const viewer = {
            transparent: false,
            heightmap: false,
            showLeft: true,
            showRight: true,
            showScans: true,
            view: "iso" as const,
            wallModel: "procedural" as const,
            wallStyle: "straight" as const,
        };

        const measureSide = async (side: Side, usMen: number) => {
            const layout = insoleLayoutForUsMenSize(usMen);
            const design = createDesignWithStockPlaceholder({
                ...defaultDesign(),
                sizeSystem: "us",
                usMenSize: layout.usMenSize,
                footLengthMm: layout.footLengthMm,
            });
            useDesignStore.setState({ design, viewer });
            const mesh = side === "left" ? raw.clone() : mirrorGeometry(raw);
            const identity = await reconstructProceduralPreview(mesh, { wallStyle: "straight", side });
            const field = baseModifierFieldAuthoritative(design, side, design.thicknessMm);
            const shared = await reconstructProceduralPreview(
                mesh,
                printSolidOptions({
                    design,
                    side,
                    field,
                    viewer,
                    trimline: null,
                    bottomPattern: null,
                }),
            );
            const { buildExportStl } = await import("@/lib/geometry/export-geometry");
            const stl = await buildExportStl(side);
            const exported = binaryStlToGeometry(stl);
            const preview = shared.geometry;
            const pos = preview.getAttribute("position").array as Float32Array;
            const box = bbox(pos);
            const fold = foldReport(preview);
            const foldAll = foldReport(preview, { wholeInsole: true });
            const sized = preview.clone();
            scaleFootprintUniform(sized, layout.scale);
            const sizedFold = foldReport(sized).worstDeg;
            const sizedWhole = foldReport(sized, { wholeInsole: true }).worstDeg;
            const sizedHash = sha256Stl(sized);
            const exportBox = bbox(exported.getAttribute("position").array as Float32Array);
            const row = {
                usMen,
                side,
                scale: layout.scale,
                identityHash: sha256Stl(identity.geometry),
                sharedHash: sha256Stl(preview),
                sizedHash,
                exportHash: sha256Buf(stl),
                volumeMm3: windingReport(preview).signedVolume,
                minZ: box.minZ,
                maxX: box.maxX,
                spanX: box.spanX,
                outlineOnBMm: outlineExactOnBMm(preview),
                worstDeg: fold.worstDeg,
                wholeInsoleDeg: foldAll.worstDeg,
                sizedWorstDeg: sizedFold,
                sizedWholeInsoleDeg: sizedWhole,
                exportMinZ: exportBox.minZ,
                exportSpanX: exportBox.spanX,
            };
            identity.geometry.dispose();
            sized.dispose();
            preview.dispose();
            exported.dispose();
            mesh.dispose();
            return row;
        };

        const us9Left = await measureSide("left", 9);
        const us9Right = await measureSide("right", 9);
        const us1Left = await measureSide("left", 1);

        const report = {
            shellDz,
            outlineDx,
            stretchDx,
            noSinkShell,
            wedgeShell,
            us9Left,
            us9Right,
            us1Left,
        };
        writeFileSync("/tmp/parity-acceptance.json", JSON.stringify(report, null, 2));

        expect(shellDz).toBeGreaterThan(0.8);
        expect(shellDz).toBeLessThan(1);
        expect(outlineDx).toBeLessThan(0.01);
        expect(stretchDx).toBeCloseTo(5, 2);
        expect(noSinkShell).toBeGreaterThan(0.8);
        expect(wedgeShell).toBeGreaterThan(0.4);

        for (const row of [us9Left, us9Right]) {
            expect(row.identityHash).toBe(row.sharedHash);
            expect(row.sharedHash).toBe(row.exportHash);
            expect(row.sizedHash).toBe(row.exportHash);
            expect(row.outlineOnBMm).toBeLessThan(0.01);
            expect(Math.abs(row.minZ)).toBeLessThan(1e-4);
            expect(Math.abs(row.exportMinZ)).toBeLessThan(1e-4);
            expect(row.worstDeg).toBeLessThanOrEqual(60);
            expect(row.wholeInsoleDeg).toBeLessThanOrEqual(60);
            expect(row.sizedWorstDeg).toBeLessThanOrEqual(60);
        }

        // A pediatric design previews the native loft, then export applies the
        // footprint scale. The scaled preview is the manufacturing solid.
        expect(us1Left.sizedHash).toBe(us1Left.exportHash);
        expect(us1Left.outlineOnBMm).toBeLessThan(0.01);
        expect(Math.abs(us1Left.minZ)).toBeLessThan(1e-4);
        expect(Math.abs(us1Left.exportMinZ)).toBeLessThan(1e-4);
        expect(us1Left.worstDeg).toBeLessThanOrEqual(60);
        expect(us1Left.wholeInsoleDeg).toBeLessThanOrEqual(60);
        expect(us1Left.exportSpanX / us1Left.spanX).toBeCloseTo(us1Left.scale, 4);
        expect(Math.abs(us1Left.maxX - us9Left.maxX)).toBeLessThan(0.01);

        uniform.dispose();
        zonal.dispose();
        stretched.dispose();
        noSinkUniform.dispose();
        noSinkZonal.dispose();
        wedgeUniform.dispose();
        wedgeZonal.dispose();
        raw.dispose();
    }, 900_000);
});
