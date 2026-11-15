// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { buildFinalizedFootFromSavedDesign } from "@/features/exports/saved-design-finalized-mesh";
import { binaryStlBounds } from "@/lib/geometry/leader-block";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { parseSavedDesignCatalog } from "../../../shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot";

const originalFetch = globalThis.fetch;

function sampleTopBytes(): ArrayBuffer {
    const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    globalThis.fetch = async () => new Response(bytes);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
    useBottomPatternStore.getState().clear();
});

describe("saved-design shell thickness loft", () => {
    test("4 mm shell clearance lifts the solid above the 2 mm default", async () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };
        const thin = buildSavedDesignSnapshot({ stored, catalog: parseSavedDesignCatalog({}) });
        const thick = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ thickness_mm: 4 }),
        });
        expect(thin.design.thicknessMm).toBe(2);
        expect(thick.design.thicknessMm).toBe(4);
        const sampleTop = sampleTopBytes();
        const thinMesh = await buildFinalizedFootFromSavedDesign({
            design: thin.design,
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: false,
        });
        const thickMesh = await buildFinalizedFootFromSavedDesign({
            design: thick.design,
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: false,
        });
        const thinBounds = binaryStlBounds(thinMesh.stl);
        const thickBounds = binaryStlBounds(thickMesh.stl);
        const thinSpan = thinBounds.maxZ - thinBounds.minZ;
        const thickSpan = thickBounds.maxZ - thickBounds.minZ;
        expect(thickSpan).toBeGreaterThan(thinSpan + 1);
        expect(thickMesh.fingerprint).not.toBe(thinMesh.fingerprint);
        expect(thinMesh.uploadTriangles).toBe(thinMesh.solidTriangles);
        expect(thickMesh.uploadTriangles).toBe(thickMesh.solidTriangles);
    }, 180_000);
});
