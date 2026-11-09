// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { defaultAfoScanWorkflow } from "@/lib/geometry/afo/defaults";
import { afoViewportPlacementLayer } from "./afo-scan-markers";
import {
    AFO_CAST_SURFACE,
    AFO_MARKER_DEPTH_TEST,
    afoCastBodyStyle,
    afoHeightColors,
    afoScanAutoFrameAllowed,
    afoTriangleStats,
    afoUploadedScanMaterial,
    cameraViewForAfoMarker,
} from "./afo-scan-ui";

describe("afo scan ui", () => {
    test("auto-frame is disabled during Stage 1 plantar alignment", () => {
        expect(afoScanAutoFrameAllowed(defaultAfoScanWorkflow())).toBe(false);
        expect(afoScanAutoFrameAllowed({ ...defaultAfoScanWorkflow(), alignmentApplied: true })).toBe(true);
    });

    test("the uploaded scan stays opaque for every landmark and when Transparent is off", () => {
        expect(afoUploadedScanMaterial({ transparentOn: true, placingLandmarks: true })).toEqual({
            opacity: 1,
            transparent: false,
            grey: true,
        });
        expect(afoUploadedScanMaterial({ transparentOn: false, placingLandmarks: false })).toEqual({
            opacity: 1,
            transparent: false,
            grey: false,
        });
        expect(afoUploadedScanMaterial({ transparentOn: true, placingLandmarks: false })).toEqual({
            opacity: 0.45,
            transparent: true,
            grey: false,
        });
    });

    test("Design trim clicks are not stolen by a leftover scan-marker session", () => {
        expect(afoViewportPlacementLayer("design", true, false, true)).toBe("afo-design");
        expect(afoViewportPlacementLayer("scan", true, false, true)).toBe("afo-scan");
        expect(afoViewportPlacementLayer("corrections", true, false, false)).toBe("afo-design");
    });

    test("Cast scan defaults to an opaque shaded surface, not points", () => {
        const positions = [0, 0, 0, 4, 0, 0, 0, 6, 1, 4, 6, 2];
        const indices = [0, 1, 2, 1, 3, 2];
        const stats = afoTriangleStats(positions, indices);
        const style = afoCastBodyStyle({
            transparentOn: false,
            heightmap: false,
            triangleCount: stats.triangles,
            degenerateRatio: stats.degenerateRatio,
        });
        expect(stats.degenerateRatio).toBe(0);
        expect(style.drawMode).toBe("surface");
        expect(style.shaded).toBe(true);
        expect(style.color).toBe(AFO_CAST_SURFACE);
        expect(style.opacity).toBe(1);
        expect(style.transparent).toBe(false);
        expect(style.vertexColors).toBe(false);
        expect(style.roughness).toBeGreaterThan(0);
        expect(style.roughness).toBeLessThan(1);
        expect(style.markerDepthTest).toBe(AFO_MARKER_DEPTH_TEST);
        expect(style.markerDepthTest).toBe(false);
        expect(style.markerRenderOrder).toBeGreaterThan(1);
    });

    test("Transparent and Heightmap still change the Cast surface", () => {
        const clear = afoCastBodyStyle({
            transparentOn: true,
            heightmap: false,
            triangleCount: 2,
            degenerateRatio: 0,
        });
        expect(clear.transparent).toBe(true);
        expect(clear.opacity).toBe(0.45);
        expect(clear.shaded).toBe(true);
        const mapped = afoCastBodyStyle({
            transparentOn: false,
            heightmap: true,
            triangleCount: 2,
            degenerateRatio: 0,
        });
        expect(mapped.vertexColors).toBe(true);
        expect(mapped.color).toBe("#ffffff");
        expect(mapped.shaded).toBe(true);
        const colors = afoHeightColors([0, 0, 0, 0, 0, 10]);
        expect(colors[2]).toBeGreaterThan(0.5);
        expect(colors[5]).toBeGreaterThan(colors[2] ?? 0);
    });

    test("a scan with no usable faces draws as dense points", () => {
        const positions = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        const indices = [0, 1, 2];
        const stats = afoTriangleStats(positions, indices);
        const style = afoCastBodyStyle({
            transparentOn: false,
            heightmap: true,
            triangleCount: stats.triangles,
            degenerateRatio: stats.degenerateRatio,
        });
        expect(stats.degenerateRatio).toBe(1);
        expect(style.drawMode).toBe("points");
        expect(style.shaded).toBe(false);
        expect(style.pointSizeMm).toBeGreaterThan(1);
        expect(style.vertexColors).toBe(true);
        const empty = afoCastBodyStyle({
            transparentOn: false,
            heightmap: false,
            triangleCount: 0,
            degenerateRatio: 1,
        });
        expect(empty.drawMode).toBe("points");
    });

    test("medial and lateral views flip with foot side", () => {
        expect(cameraViewForAfoMarker("navicular", "left")).toBe("right");
        expect(cameraViewForAfoMarker("fibular_head", "left")).toBe("left");
        expect(cameraViewForAfoMarker("navicular", "right")).toBe("left");
        expect(cameraViewForAfoMarker("fibular_head", "right")).toBe("right");
    });
});
