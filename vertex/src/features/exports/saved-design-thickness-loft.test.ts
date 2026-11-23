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
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
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

function uiDesignAtThicknessMm(thicknessMm: number) {
    const base = createDesignWithStockPlaceholder();
    return createDesignWithStockPlaceholder({
        ...base,
        thicknessMm,
        shellThicknessMode: "zonal",
        paired: base.paired
            ? { ...base.paired, leftThicknessMm: thicknessMm, rightThicknessMm: thicknessMm }
            : base.paired,
    });
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
        const thinBounds = binaryStlBounds(thinMesh.stl);
        const thickBounds = binaryStlBounds(thickMesh.stl);
        const thinSpan = thinBounds.maxZ - thinBounds.minZ;
        const thickSpan = thickBounds.maxZ - thickBounds.minZ;
        expect(thickSpan).toBeGreaterThan(thinSpan + 1);
        expect(thickMesh.fingerprint).not.toBe(thinMesh.fingerprint);
        expect(thinMesh.uploadTriangles).toBe(thinMesh.solidTriangles);
        expect(thickMesh.uploadTriangles).toBe(thickMesh.solidTriangles);
    }, 180_000);

    test("3 mm integration snapshot is uniform and matches the UI thickness slider loft", async () => {
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
        const uiMesh = await buildFinalizedFootFromSavedDesign({
            design: {
                ...uiDesignAtThicknessMm(3),
                shellThicknessMode: "uniform",
            },
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: false,
        });
        expect(integrationMesh.fingerprint).toBe(uiMesh.fingerprint);
    }, 180_000);

    test("3 mm uniform shell increases finalized mesh height over the default snapshot", async () => {
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
        const thinSpan = binaryStlBounds(thinMesh.stl).maxZ - binaryStlBounds(thinMesh.stl).minZ;
        const thickSpan = binaryStlBounds(thickMesh.stl).maxZ - binaryStlBounds(thickMesh.stl).minZ;
        expect(thickSpan).toBeGreaterThan(thinSpan + 0.25);
        expect(thickMesh.fingerprint).not.toBe(thinMesh.fingerprint);
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
        expect(sinkMesh.fingerprint).not.toBe(defaultMesh.fingerprint);
    }, 180_000);

    test("catalog thickness_mm persists uniform mode for manufacturing loft load", () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };
        const snap = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ thickness_mm: 3 }),
        });
        const envelope = settingsEnvelopeForSave(snap.design);
        const loaded = designStateFromSavedSettings(envelope);
        expect(loaded.shellThicknessMode).toBe("uniform");
        expect(loaded.thicknessMm).toBe(3);
    });
});
