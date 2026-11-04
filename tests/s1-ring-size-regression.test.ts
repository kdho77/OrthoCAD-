// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { SINK_DEFAULT_DEPTH_MM, SINK_KIND_ORDER, SINK_PROFILES } from "@/lib/geometry/sink";
import type { PlacedSink } from "@/types";
import { exportClosed, SIDES, WALLS } from "./helpers/s1-ring-export.harness";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
});

describe("S1 ring size regression", () => {
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
