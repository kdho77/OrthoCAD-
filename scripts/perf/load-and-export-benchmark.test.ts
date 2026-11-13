// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Read-only perf probe: SAMPLE_Top load path + procedural manufacturing export.
// Does not assert geometry hashes; prints structured timings for the audit doc.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { binaryStlTriangleCount } from "@/lib/geometry/leader-block";
import { assertClosedSolidAcceptable, closeGlbInsoleToSolid } from "@/lib/geometry/mesh-close";
import {
    manufacturingSolidFingerprint,
    rememberManufacturingSolid,
    resetManufacturingSolidCache,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { manufacturingCacheContext } from "@/lib/geometry/procedural-wall/manufacturing-solid-context";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    buildProceduralExportSolid,
    buildProceduralViewerPattern,
    loadSampleTopGeometry,
    reconstructProceduralPreview,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { parseBinaryStl } from "@/lib/hardness/mesh";
import { extractMergedGeometry, loadGlbFromBuffer, reorientToFootprintFrame } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { DesignState } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const WARMUP = 1;
const REPS = 3;

function median(nums: number[]): number {
    const sorted = [...nums].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function timeMedian(label: string, fn: () => Promise<void> | void, reps = REPS): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < WARMUP + reps; i++) {
        const t0 = performance.now();
        await fn();
        if (i >= WARMUP) samples.push(performance.now() - t0);
    }
    return median(samples);
}

function installSampleTopDesign(extra?: Partial<DesignState>): void {
    const base = createDesignWithStockPlaceholder();
    useDesignStore.setState({
        design: { ...base, method: "printing_solid", ...extra },
        viewer: { wallModel: "procedural", wallStyle: "round", deviceType: "desktop" },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
}

describe("load-and-export benchmark (SAMPLE_Top)", () => {
    beforeEach(() => {
        resetSampleTopGeometryCache();
        resetManufacturingSolidCache();
    });

    afterEach(() => {
        resetSampleTopGeometryCache();
        resetManufacturingSolidCache();
    });

    test("emit stage timings", async () => {
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        const glbBytes = bytes.byteLength;

        const diskReadMs = await timeMedian(
            "diskRead",
            () => {
                readFileSync(SAMPLE_TOP_PATH);
            },
            5,
        );

        const glbParseMs = await timeMedian("glbParse", async () => {
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const group = await loadGlbFromBuffer(buf);
            group.clear();
        });

        const extractMergeMs = await timeMedian("extractMerge", async () => {
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const group = await loadGlbFromBuffer(buf);
            const merged = extractMergedGeometry(group);
            merged?.geometry.dispose();
            group.clear();
        });

        const reorientMs = await timeMedian("reorient", async () => {
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const group = await loadGlbFromBuffer(buf);
            const merged = extractMergedGeometry(group);
            if (merged) {
                const g = reorientToFootprintFrame(merged.geometry, { preserveAuthorZ: true });
                g.dispose();
                merged.geometry.dispose();
            }
            group.clear();
        });

        const sampleTopPipelineMs = await timeMedian("sampleTopPipeline", async () => {
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const g = await sampleTopFromArrayBuffer(buf);
            g.dispose();
        });

        resetSampleTopGeometryCache();
        {
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const g = await sampleTopFromArrayBuffer(buf);
            const { primeSampleTopGeometry } = await import(
                "@/lib/geometry/procedural-wall/sample-top-preview"
            );
            primeSampleTopGeometry(g);
        }

        const cachedCloneMs = await timeMedian(
            "loadSampleTopCached",
            async () => {
                const g = await loadSampleTopGeometry();
                g.dispose();
            },
            5,
        );

        let viewerPatternMs = 0;
        {
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const geo = await sampleTopFromArrayBuffer(buf);
            viewerPatternMs = await timeMedian(
                "viewerPattern",
                () => {
                    buildProceduralViewerPattern(geo, "full_contact");
                },
                5,
            );
            geo.dispose();
        }

        installSampleTopDesign();
        const layoutM9 = insoleLayoutFromDesign(useDesignStore.getState().design);
        expect(layoutM9.usMenSize).toBe(9);

        installSampleTopDesign({
            sizeSystem: "mm",
            footLengthMm: 275,
        });
        const layout275 = insoleLayoutFromDesign(useDesignStore.getState().design);

        const loftM9Ms = await timeMedian("proceduralLoftM9", async () => {
            resetManufacturingSolidCache();
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const geo = await sampleTopFromArrayBuffer(buf);
            const design = useDesignStore.getState().design;
            const field = (await import("@/lib/geometry/base-asset")).baseModifierFieldAuthoritative(
                { ...defaultDesign(), ...design, usMenSize: 9, sizeSystem: "us" },
                "left",
                design.thicknessMm,
            );
            const preview = await reconstructProceduralPreview(geo, {
                wallStyle: "round",
                scanPattern: "full_contact",
                sourceField: field,
                composedTop: true,
                footprintScale: layoutM9.scale,
            });
            preview.geometry.dispose();
            geo.dispose();
        });

        const loft275Ms = await timeMedian("proceduralLoft275mm", async () => {
            resetManufacturingSolidCache();
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const geo = await sampleTopFromArrayBuffer(buf);
            const design = useDesignStore.getState().design;
            const field = (await import("@/lib/geometry/base-asset")).baseModifierFieldAuthoritative(
                design,
                "left",
                design.thicknessMm,
            );
            const preview = await reconstructProceduralPreview(geo, {
                wallStyle: "round",
                scanPattern: "full_contact",
                sourceField: field,
                composedTop: true,
                footprintScale: layout275.scale,
            });
            preview.geometry.dispose();
            geo.dispose();
        });

        installSampleTopDesign();
        const design = useDesignStore.getState().design;
        const solidOptions = printSolidOptions({
            design,
            side: "left",
            field: (await import("@/lib/geometry/base-asset")).baseModifierFieldAuthoritative(
                design,
                "left",
                design.thicknessMm,
            ),
            viewer: useDesignStore.getState().viewer ?? {},
            trimline: null,
            bottomPattern: undefined,
        });
        const cache = manufacturingCacheContext({
            design,
            side: "left",
            baseAssetId: design.base?.assetId ?? "sample-top",
            mirrored: false,
        });

        const exportLoftColdMs = await timeMedian("exportLoftCold", async () => {
            resetManufacturingSolidCache();
            const { geometry } = await buildProceduralExportSolid(solidOptions, cache);
            geometry.dispose();
        });

        const { geometry: lofted } = await buildProceduralExportSolid(solidOptions, cache);
        rememberManufacturingSolid(manufacturingSolidFingerprint(solidOptions, cache), "left", lofted);

        const exportLoftWarmMs = await timeMedian(
            "exportLoftWarm",
            async () => {
                const { geometry } = await buildProceduralExportSolid(solidOptions, cache);
                geometry.dispose();
            },
            5,
        );

        const meshCloseMs = await timeMedian("meshClose", () => {
            const closed = closeGlbInsoleToSolid(lofted.clone());
            closed.dispose();
        });

        const validateMs = await timeMedian("watertightValidate", () => {
            const closed = closeGlbInsoleToSolid(lofted.clone());
            const topN = (closed.userData as { topVertexCount?: number }).topVertexCount ?? 0;
            assertClosedSolidAcceptable(closed, topN, {
                eulerCharacteristic: 2,
                heelBridgeSelfIntersections: 0,
            });
            closed.dispose();
        });

        const stlSerializeMs = await timeMedian("stlSerialize", () => {
            const closed = closeGlbInsoleToSolid(lofted.clone());
            const stl = geometryToBinarySTL(closed);
            closed.dispose();
            expect(stl.byteLength).toBeGreaterThan(10_000);
        });

        const closed = closeGlbInsoleToSolid(lofted.clone());
        const stl = geometryToBinarySTL(closed);
        const stlBytes = stl.byteLength;
        const triangles = binaryStlTriangleCount(stl);
        const mesh = parseBinaryStl(stl);
        closed.dispose();
        lofted.dispose();

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        installSampleTopDesign();
        const fullExportColdMs = await timeMedian("buildExportStlCold", async () => {
            resetManufacturingSolidCache();
            resetSampleTopGeometryCache();
            globalThis.fetch = rs.fn(async () => {
                return new Response(bytes, {
                    status: 200,
                    headers: { "Content-Type": "model/gltf-binary" },
                });
            }) as typeof fetch;
            const buf = await buildExportStl("left", { exportMode: "manufacturing" });
            expect(buf.byteLength).toBeGreaterThan(10_000);
        });

        const fullExportWarmMs = await timeMedian(
            "buildExportStlWarm",
            async () => {
                const buf = await buildExportStl("left", { exportMode: "manufacturing" });
                expect(buf.byteLength).toBeGreaterThan(10_000);
            },
            5,
        );

        const report = {
            fixture: "SAMPLE_Top.glb",
            glbBytes,
            cacheHeaders: "Templates/* not covered by /assets immutable header (SPA rewrite only)",
            layoutM9: {
                footLengthMm: layoutM9.footLengthMm,
                lengthMm: Math.round(layoutM9.lengthMm * 1000) / 1000,
                widthMm: Math.round(layoutM9.widthMm * 1000) / 1000,
                scale: layoutM9.scale,
            },
            layout275Foot: {
                footLengthMm: layout275.footLengthMm,
                lengthMm: Math.round(layout275.lengthMm * 1000) / 1000,
                widthMm: Math.round(layout275.widthMm * 1000) / 1000,
                scale: layout275.scale,
            },
            stl: { bytes: stlBytes, triangles, vertices: mesh.positions.length / 3 },
            ms: {
                diskRead: Math.round(diskReadMs),
                glbParse: Math.round(glbParseMs),
                extractMergeWelding: Math.round(extractMergeMs),
                reorientFootprint: Math.round(reorientMs),
                sampleTopPipeline: Math.round(sampleTopPipelineMs),
                loadSampleTopCachedClone: Math.round(cachedCloneMs),
                viewerPatternOnly: Math.round(viewerPatternMs),
                proceduralLoftM9: Math.round(loftM9Ms),
                proceduralLoftFoot275: Math.round(loft275Ms),
                exportLoftCold: Math.round(exportLoftColdMs),
                exportLoftManufacturingCacheWarm: Math.round(exportLoftWarmMs),
                meshClose: Math.round(meshCloseMs),
                watertightValidate: Math.round(validateMs),
                stlSerialize: Math.round(stlSerializeMs),
                buildExportStlCold: Math.round(fullExportColdMs),
                buildExportStlWarm: Math.round(fullExportWarmMs),
            },
            host: {
                node: process.version,
                platform: process.platform,
                cwd: process.cwd(),
            },
            measuredAt: new Date().toISOString(),
        };

        // eslint-disable-next-line no-console
        console.log("\n=== ORTHOCAD_LOAD_EXPORT_BENCHMARK ===\n" + JSON.stringify(report, null, 2));

        if (process.env.BENCHMARK_JSON === "1") {
            const { writeFileSync } = await import("node:fs");
            writeFileSync(
                resolve(process.cwd(), "scripts/perf/load-and-export-benchmark.last.json"),
                `${JSON.stringify(report, null, 2)}\n`,
            );
        }

        expect(report.ms.proceduralLoftM9).toBeGreaterThan(0);
    }, 600_000);
});
