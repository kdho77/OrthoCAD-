// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "@rstest/core";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import {
    buildFinalizedFootFromSavedDesign,
    publishProceduralSampleTopOutlines,
} from "@/features/exports/saved-design-finalized-mesh";
import { activePatientDisplayName } from "@/lib/clinical/patient-display-name";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { endPatternOnTrim } from "@/lib/geometry/trim-presets";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { curveForTrimPreset, resolveActiveTrimline, useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState } from "@/types";
import { parseSavedDesignCatalog } from "../../../shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot";

const originalFetch = globalThis.fetch;

function sha256(bytes: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function designForLength(length?: string): DesignState {
    const snap = buildSavedDesignSnapshot({
        stored: { system: "US_M", size: 9, left: null, right: null, width: "medium" },
        catalog: parseSavedDesignCatalog(length ? { length } : {}),
    });
    return createDesignWithStockPlaceholder(snap.design);
}

function requireCurve(curve: TrimlineCurve | null, label: string): TrimlineCurve {
    if (!curve || curve.points.length < 4) throw new Error(`missing ${label}`);
    return curve;
}

function sameCurve(actual: TrimlineCurve | null, expected: TrimlineCurve | null): void {
    const left = requireCurve(actual, "actual curve");
    const right = requireCurve(expected, "expected curve");
    expect(left.points.length).toBe(right.points.length);
    for (let i = 0; i < left.points.length; i += 1) {
        const a = left.points[i];
        const b = right.points[i];
        if (!a || !b) throw new Error("missing curve point");
        expect(a.x).toBe(b.x);
        expect(a.y).toBe(b.y);
        expect(a.z).toBe(b.z);
    }
}

function curveMaxX(curve: TrimlineCurve): number {
    return curve.points.reduce((max, point) => Math.max(max, point.x), -Infinity);
}

async function publishOutlines(design: DesignState): Promise<ArrayBuffer> {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    useBaseOutlineStore.setState({ outlines: {} });
    const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    const sampleTop = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    globalThis.fetch = async () => new Response(bytes);
    useDesignStore.setState({
        design,
        viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
    });
    const native = await sampleTopFromArrayBuffer(sampleTop);
    publishProceduralSampleTopOutlines(native, design);
    native.dispose();
    return sampleTop;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
});

beforeAll(() => {
    useClientStore.getState().addClient({
        firstName: "Kingston",
        lastName: "f1939235",
        shoeSizeUs: 9,
    });
});

describe("saved design length uses the #364 trim presets", () => {
    test("3/4 and Sulcus rebuild the UI curve on both feet; Full stays uncut", async () => {
        const met = designForLength("3/4");
        expect(met.trimPreset).toEqual({ left: "met_head", right: "met_head" });
        expect(met.trimlines).toBeUndefined();
        expect(met.textMarking).toMatchObject({
            surface: "bottom",
            mode: "engrave",
            addPatientName: true,
            feet: "both",
        });
        await publishOutlines(met);
        expect(activePatientDisplayName()).toContain("Kingston");
        for (const side of ["left", "right"] as const) {
            const preset = "met_head" as const;
            const rebuilt = resolveActiveTrimline(side, met);
            sameCurve(rebuilt, curveForTrimPreset(side, preset));
            const outline = requireCurve(curveForTrimPreset(side, "full"), "outline");
            const ended = endPatternOnTrim(outline, rebuilt);
            sameCurve(ended, endPatternOnTrim(outline, curveForTrimPreset(side, preset)));
            expect(curveMaxX(ended)).toBeLessThan(curveMaxX(outline) - 10);
        }

        const sulcus = designForLength("Sulcus");
        await publishOutlines(sulcus);
        for (const side of ["left", "right"] as const) {
            sameCurve(resolveActiveTrimline(side, sulcus), curveForTrimPreset(side, "sulcus"));
        }

        const omitted = designForLength();
        await publishOutlines(omitted);
        expect(resolveActiveTrimline("left", omitted)).toBeNull();
        expect(resolveActiveTrimline("right", omitted)).toBeNull();

        const full = designForLength("Full");
        expect(full.trimPreset).toEqual({ left: "full", right: "full" });
        await publishOutlines(full);
        expect(resolveActiveTrimline("left", full)).toBeNull();
        expect(resolveActiveTrimline("right", full)).toBeNull();
    });

    test("Full export bytes match an omitted length on both feet", async () => {
        const omitted = designForLength();
        const full = designForLength("Full");
        for (const side of ["left", "right"] as const) {
            await publishOutlines(omitted);
            const omittedStl = await buildExportStl(side);
            const omittedGeo = binaryStlToGeometry(omittedStl);
            try {
                const check = validateManifold(omittedGeo);
                expect(check.isWatertight).toBe(true);
                expect(check.eulerCharacteristic).toBe(2);
            } finally {
                omittedGeo.dispose();
            }
            await publishOutlines(full);
            const fullStl = await buildExportStl(side);
            expect(sha256(fullStl)).toBe(sha256(omittedStl));

            const sampleTop = await publishOutlines(omitted);
            const ui = await buildPrinterFootManufacturingStl(side, true);
            const headless = await buildFinalizedFootFromSavedDesign({
                design: omitted,
                side,
                sampleTopBytes: sampleTop,
                includeLeader: true,
            });
            expect(sha256(headless.stl)).toBe(sha256(ui.stl));
        }
    }, 600_000);
});
