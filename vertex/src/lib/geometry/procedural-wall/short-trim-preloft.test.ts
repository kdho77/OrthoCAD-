// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import { buildFinalizedFootFromSavedDesign } from "@/features/exports/saved-design-finalized-mesh";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { buildTrimPresetCurve } from "@/lib/geometry/trim-presets";
import { extractMeshOutline, serializeTrimlineCurve } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { TrimPresetId } from "@/types";
import { Vector3, type BufferGeometry } from "three";

const originalFetch = globalThis.fetch;
const SAMPLE = resolve("tests/fixtures/SAMPLE_Top.glb");

function sha256(bytes: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function installDesign(design: ReturnType<typeof createDesignWithStockPlaceholder>) {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null });
    useClientStore.setState({ activeClientId: null, clients: [] });
    const font = readFileSync(resolve("vertex/public/fonts/Inter-Bold.ttf"));
    primeTextFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength));
    const bytes = readFileSync(SAMPLE);
    globalThis.fetch = async () => new Response(bytes);
    useDesignStore.setState({
        design,
        viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
    });
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function longestSpan(geometry: BufferGeometry): number {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return 0;
    const size = box.getSize(new Vector3());
    return Math.max(size.x, size.y, size.z);
}

function footprintOf(points: Array<{ x: number; y: number }>) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { lengthMm: maxX - minX, widthMm: maxY - minY };
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
});

describe("short trim manufacturing STL", () => {
    test("met_head and sulcus export a closed shorter solid on both feet", async () => {
        const bytes = readFileSync(SAMPLE);
        const native = await sampleTopFromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        primeSampleTopGeometry(native);
        const leftOutline = extractMeshOutline(native, 64);
        const mirrored = mirrorGeometry(native.clone());
        const rightOutline = extractMeshOutline(mirrored, 64);
        mirrored.dispose();
        if (!leftOutline || !rightOutline) throw new Error("SAMPLE_Top outline missing");
        const leftFoot = footprintOf(leftOutline.points);
        const rightFoot = footprintOf(rightOutline.points);

        const curveFor = (preset: "sulcus" | "met_head", side: "left" | "right") => {
            const base = side === "left" ? leftOutline : rightOutline;
            const foot = side === "left" ? leftFoot : rightFoot;
            return buildTrimPresetCurve(preset, {
                lengthMm: foot.lengthMm,
                widthMm: foot.widthMm,
                baseCurve: base,
                footSide: side,
            });
        };

        const designFor = (preset: TrimPresetId) => {
            const base = createDesignWithStockPlaceholder();
            const marking = {
                ...defaultTextMarking("bottom"),
                text: "ADA",
                addPatientName: true,
                capHeightMm: 4,
                capHeightUserSet: true,
            };
            if (preset === "full") {
                return { ...base, method: "printing_solid" as const };
            }
            return {
                ...base,
                method: "printing_solid" as const,
                textMarking: marking,
                trimPreset: { left: preset, right: preset },
                trimlines: {
                    left: serializeTrimlineCurve(curveFor(preset, "left")),
                    right: serializeTrimlineCurve(curveFor(preset, "right")),
                },
            };
        };

        const solidOf = async (preset: TrimPresetId, side: "left" | "right", includeLeader: boolean) => {
            const design = designFor(preset);
            const sampleTop = installDesign(design);
            const built = await buildPrinterFootManufacturingStl(side, includeLeader);
            const geometry = binaryStlToGeometry(built.stl);
            try {
                return {
                    sampleTop,
                    design,
                    sha: sha256(built.stl),
                    span: longestSpan(geometry),
                    report: validateManifold(geometry),
                    solidTriangles: built.solidTriangles,
                    uploadTriangles: built.uploadTriangles,
                };
            } finally {
                geometry.dispose();
            }
        };

        const fullLeft = await solidOf("full", "left", false);
        const fullRight = await solidOf("full", "right", false);
        for (const full of [fullLeft, fullRight]) {
            expect(full.report.isWatertight).toBe(true);
            expect(full.report.eulerCharacteristic).toBe(2);
            expect(full.report.openEdges).toBe(0);
            expect(full.report.nonManifoldEdges).toBe(0);
            expect(full.uploadTriangles).toBe(full.solidTriangles);
        }

        for (const preset of ["met_head", "sulcus"] as const) {
            for (const side of ["left", "right"] as const) {
                let bare: Awaited<ReturnType<typeof solidOf>>;
                try {
                    bare = await solidOf(preset, side, false);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`${preset} ${side} no-leader: ${message}`, { cause: error });
                }
                const label = `${preset} ${side}`;
                expect(bare.report.isWatertight).toBe(true);
                expect(bare.report.eulerCharacteristic).toBe(2);
                expect(bare.report.openEdges).toBe(0);
                expect(bare.report.nonManifoldEdges).toBe(0);
                const fullSpan = side === "left" ? fullLeft.span : fullRight.span;
                if (!(bare.span < fullSpan - 40)) {
                    throw new Error(`${label} span ${bare.span.toFixed(1)} is not shorter than full ${fullSpan.toFixed(1)}`);
                }

                let led: Awaited<ReturnType<typeof solidOf>>;
                try {
                    led = await solidOf(preset, side, true);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`${preset} ${side} leader: ${message}`, { cause: error });
                }
                // The belt leader is a separate block concatenated onto the solid.
                // The foot itself is the no-leader mesh checked above.
                expect(led.uploadTriangles).toBeGreaterThan(led.solidTriangles);
            }
        }

        const metLeft = designFor("met_head");
        const sampleTop = installDesign(metLeft);
        const ui = await buildPrinterFootManufacturingStl("left", false);
        const headless = await buildFinalizedFootFromSavedDesign({
            design: metLeft,
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: false,
        });
        expect(sha256(headless.stl)).toBe(sha256(ui.stl));
        const headGeom = binaryStlToGeometry(headless.stl);
        try {
            const report = validateManifold(headGeom);
            expect(report.isWatertight).toBe(true);
            expect(report.eulerCharacteristic).toBe(2);
            expect(report.openEdges).toBe(0);
            expect(report.nonManifoldEdges).toBe(0);
            expect(longestSpan(headGeom)).toBeLessThan(fullLeft.span - 40);
        } finally {
            headGeom.dispose();
        }
    }, 400_000);
});
