// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import {
    buildFinalizedFootFromSavedDesign,
    designStateFromSavedSettings,
} from "@/features/exports/saved-design-finalized-mesh";
import { binaryStlBounds } from "@/lib/geometry/leader-block";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { effectiveInsoleThicknessMm, FLOOR_MIN_MM } from "@/lib/geometry/sink";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { settingsEnvelopeForSave } from "../../../server/src/lib/design-schema";
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

/** Max top-surface Z in a forefoot length band (u along footprint X), not overall part height. */
function maxTopZInLengthBand(stl: ArrayBuffer, uMin: number, uMax: number): number {
    const geo = binaryStlToGeometry(stl);
    try {
        const pos = geo.getAttribute("position");
        const arr = pos.array as Float32Array;
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < pos.count; i++) {
            const x = arr[i * 3]!;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
        }
        const span = Math.max(1e-3, maxX - minX);
        let maxZ = -Infinity;
        for (let i = 0; i < pos.count; i++) {
            const x = arr[i * 3]!;
            const z = arr[i * 3 + 2]!;
            if (z < 0.4) continue;
            const u = (x - minX) / span;
            if (u >= uMin && u <= uMax) maxZ = Math.max(maxZ, z);
        }
        return maxZ;
    } finally {
        geo.dispose();
    }
}

describe("saved-design shell thickness loft", () => {
    test("generate_gcode headless path uses settings.thicknessMm from the envelope", () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };
        const thick = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ thickness_mm: 4 }),
        });
        const envelope = settingsEnvelopeForSave(thick.design);
        expect(designStateFromSavedSettings(envelope).thicknessMm).toBe(4);
        expect(designStateFromSavedSettings(envelope).paired?.leftThicknessMm).toBe(4);
    });

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
        const forefootLift =
            maxTopZInLengthBand(thickMesh.stl, 0.8, 0.9) - maxTopZInLengthBand(thinMesh.stl, 0.8, 0.9);
        expect(forefootLift).toBeGreaterThanOrEqual(1.9);
        expect(forefootLift).toBeLessThanOrEqual(2.1);
        expect(thickMesh.fingerprint).not.toBe(thinMesh.fingerprint);
        expect(thinMesh.uploadTriangles).toBe(thinMesh.solidTriangles);
        expect(thickMesh.uploadTriangles).toBe(thickMesh.solidTriangles);
    }, 180_000);

    test("3 mm catalog thickness is uniform and the loft builds that clearance", async () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };
        const integration = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ thickness_mm: 3 }),
        });
        expect(integration.design.method).toBe("printing_solid");
        expect(integration.design.shellThicknessMode).toBe("uniform");
        expect(integration.design.thicknessMm).toBe(3);

        const sampleTop = sampleTopBytes();
        const integrationMesh = await buildFinalizedFootFromSavedDesign({
            design: integration.design,
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: false,
        });
        const defaultMesh = await buildFinalizedFootFromSavedDesign({
            design: buildSavedDesignSnapshot({ stored, catalog: parseSavedDesignCatalog({}) }).design,
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: false,
        });
        const forefootLift =
            maxTopZInLengthBand(integrationMesh.stl, 0.8, 0.9) -
            maxTopZInLengthBand(defaultMesh.stl, 0.8, 0.9);
        expect(forefootLift).toBeGreaterThanOrEqual(0.9);
        expect(forefootLift).toBeLessThanOrEqual(1.1);
        expect(integrationMesh.uploadTriangles).toBe(integrationMesh.solidTriangles);
    }, 180_000);

    test("3 mm raises forefoot top height by ~1.0 mm between 80–90% length", async () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };
        const thin = buildSavedDesignSnapshot({ stored, catalog: parseSavedDesignCatalog({}) });
        const thick = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ thickness_mm: 3 }),
        });
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
        const forefootLift =
            maxTopZInLengthBand(thickMesh.stl, 0.8, 0.9) - maxTopZInLengthBand(thinMesh.stl, 0.8, 0.9);
        expect(forefootLift).toBeGreaterThanOrEqual(0.9);
        expect(forefootLift).toBeLessThanOrEqual(1.1);
        const thinSpan = binaryStlBounds(thinMesh.stl).maxZ - binaryStlBounds(thinMesh.stl).minZ;
        const thickSpan = binaryStlBounds(thickMesh.stl).maxZ - binaryStlBounds(thickMesh.stl).minZ;
        expect(thickSpan - thinSpan).toBeLessThan(forefootLift + 0.05);
    }, 180_000);

    test("3 mm with a 2 mm mpj1 sink keeps at least 1.0 mm material under the sink", async () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };
        const snap = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({
                thickness_mm: 3,
                sinks: [{ name: "mpj1", side: "left", depth_mm: 2 }],
            }),
        });
        expect(snap.design.shellThicknessMode).toBe("uniform");
        const layout = insoleLayoutForUsMenSize(9);
        const shellMm = effectiveInsoleThicknessMm(3, {
            side: "left",
            lengthMm: layout.lengthMm,
            widthMm: layout.widthMm,
            sinks: snap.design.sinks?.left,
        });
        expect(shellMm).toBeCloseTo(3, 6);
        expect(shellMm - 2).toBeGreaterThanOrEqual(FLOOR_MIN_MM - 1e-3);

        const sampleTop = sampleTopBytes();
        const defaultMesh = await buildFinalizedFootFromSavedDesign({
            design: buildSavedDesignSnapshot({ stored, catalog: parseSavedDesignCatalog({}) }).design,
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: false,
        });
        const sinkMesh = await buildFinalizedFootFromSavedDesign({
            design: snap.design,
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: false,
        });
        const forefootLift =
            maxTopZInLengthBand(sinkMesh.stl, 0.8, 0.9) - maxTopZInLengthBand(defaultMesh.stl, 0.8, 0.9);
        expect(forefootLift).toBeGreaterThanOrEqual(0.9);
    }, 180_000);

    test("uniform catalog thickness is the shell the manufacturing loft reads", () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };
        const snap = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ thickness_mm: 3 }),
        });
        const envelope = settingsEnvelopeForSave(snap.design);
        const design = designStateFromSavedSettings(envelope);
        expect(design.shellThicknessMode).toBe("uniform");
        expect(design.thicknessMm).toBe(3);
        expect(design.paired?.leftThicknessMm).toBe(3);
        expect(design.paired?.rightThicknessMm).toBe(3);
    });
});
