// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import {
    BASE_EDGE_VERTEX_LIMIT,
    proceduralViewerStockGate,
    shouldExtractBaseEdges,
    shouldHideBaseMesh,
} from "./sample-top-display";

describe("SAMPLE_Top viewer remount policy", () => {
    test("procedural stock gate is stable when login flips resolution flags", () => {
        const before = proceduralViewerStockGate("procedural", false, "idle");
        const duringLogin = proceduralViewerStockGate("procedural", true, "loading");
        const afterResolved = proceduralViewerStockGate("procedural", false, "resolved");
        expect(before).toBe("procedural");
        expect(duringLogin).toBe(before);
        expect(afterResolved).toBe(before);
    });

    test("legacy stock gate still remounts when the server URL arrives", () => {
        expect(proceduralViewerStockGate("legacy", true, "loading")).toBe("1:loading");
        expect(proceduralViewerStockGate("legacy", false, "resolved")).toBe("0:resolved");
        expect(proceduralViewerStockGate("legacy", true, "loading")).not.toBe(
            proceduralViewerStockGate("legacy", false, "resolved"),
        );
    });

    test("last good top mesh stays visible while a reload is in flight", () => {
        expect(shouldHideBaseMesh(true, true)).toBe(false);
        expect(shouldHideBaseMesh(true, false)).toBe(false);
        expect(shouldHideBaseMesh(false, true)).toBe(true);
        expect(shouldHideBaseMesh(false, false)).toBe(true);
    });

    test("skip EdgesGeometry on SAMPLE_Top-sized meshes", () => {
        expect(BASE_EDGE_VERTEX_LIMIT).toBe(10_000);
        expect(shouldExtractBaseEdges(42134, false)).toBe(false);
        expect(shouldExtractBaseEdges(800, false)).toBe(true);
        expect(shouldExtractBaseEdges(800, true)).toBe(false);
        expect(shouldExtractBaseEdges(0, false)).toBe(false);
    });
});
