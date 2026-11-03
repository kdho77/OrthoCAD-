// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, rs, test } from "@rstest/core";
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
        const meta = geometry.userData as { usedSliverFallback?: boolean; sliverMaxAspect?: number };
        return {
            watertight: report.isWatertight,
            euler: report.eulerCharacteristic,
            triangles: report.triangleCount,
            sliverFallback: meta.usedSliverFallback === true,
            sliverAspect: meta.sliverMaxAspect ?? 0,
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
