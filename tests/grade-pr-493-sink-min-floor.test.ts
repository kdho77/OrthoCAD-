// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Independent grader for PR #493 — criteria from the sink-min-floor brief.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    reconstructProceduralPreview,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import {
    applyFloorGuard,
    effectiveInsoleThicknessMm,
    FLOOR_MIN_MM,
    FOREFOOT_THICKNESS_CLEARANCE_MM,
} from "@/lib/geometry/sink";
import type { PlacedSink } from "@/types";
import { parseSavedDesignCatalog } from "../vertex/shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../vertex/shared/saved-design-snapshot";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function lowestLoweredZ(plain: BufferGeometry, sunk: BufferGeometry): { z: number; n: number } {
    const a = plain.getAttribute("position");
    const b = sunk.getAttribute("position");
    const n = Math.min(a.count, b.count);
    let z = Infinity;
    let moved = 0;
    for (let i = 0; i < n; i++) {
        const drop = a.getZ(i) - b.getZ(i);
        if (drop <= 0.02) continue;
        moved++;
        if (b.getZ(i) < z) z = b.getZ(i);
    }
    return { z, n: moved };
}

describe("PR #493 grader: guaranteed floor constant", () => {
    test("FLOOR_MIN_MM is the existing forefoot clearance, not a new clinical number", () => {
        expect(FOREFOOT_THICKNESS_CLEARANCE_MM).toBe(1.0);
        expect(FLOOR_MIN_MM).toBe(FOREFOOT_THICKNESS_CLEARANCE_MM);
    });

    test("applyFloorGuard never allows a cut that leaves less than FLOOR_MIN_MM", () => {
        const held = applyFloorGuard(2.5, 2.0, "mpj5");
        expect(held.cutMm).toBeCloseTo(1.5, 6);
        expect(2.5 - held.cutMm).toBeGreaterThanOrEqual(FLOOR_MIN_MM - 1e-9);
        const ok = applyFloorGuard(5, 2, "mpj1");
        expect(ok.cutMm).toBe(2);
        expect(ok.warning).toBeUndefined();
    });
});

describe("PR #493 grader: thickness_mm readback", () => {
    test("catalog thickness_mm stores uniform mode and the requested mm on both feet", () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };
        const zonal = buildSavedDesignSnapshot({ stored, catalog: parseSavedDesignCatalog({}) });
        const uniform = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ thickness_mm: 3 }),
        });
        expect(zonal.design.shellThicknessMode).toBe("zonal");
        expect(zonal.design.thicknessMm).toBe(2);
        expect(uniform.design.shellThicknessMode).toBe("uniform");
        expect(uniform.design.thicknessMm).toBe(3);
        expect(uniform.design.paired?.leftThicknessMm).toBe(3);
        expect(uniform.design.paired?.rightThicknessMm).toBe(3);
    });
});

describe("PR #493 grader: Escobar mpj5 regression", () => {
    test("mpj5 at thickness 3 mm and depth 2 mm keeps lowered wall at or above FLOOR_MIN_MM", async () => {
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const origFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(buf);
        resetSampleTopGeometryCache();
        const raw = await sampleTopFromArrayBuffer(buf);
        const layout = insoleLayoutForUsMenSize(9);
        const thickness = 3;
        const depth = 2;
        const kind = "mpj5" as const;
        const sink: PlacedSink = { id: kind, kind, depthMm: depth };
        const shell = effectiveInsoleThicknessMm(thickness, {
            side: "left",
            lengthMm: layout.lengthMm,
            widthMm: layout.widthMm,
            sinks: [sink],
        });
        const snap = buildSavedDesignSnapshot({
            stored: { system: "US_M" as const, size: 9, left: null, right: null, width: null },
            catalog: parseSavedDesignCatalog({
                thickness_mm: thickness,
                sinks: [{ name: kind, side: "left", depth_mm: depth }],
            }),
        });
        expect(snap.design.shellThicknessMode).toBe("uniform");
        const requested = baseModifierField(snap.design, "left", thickness);
        const sunkField: HeightFieldParams = { ...requested, sinks: [sink] };
        const plainField: HeightFieldParams = {
            ...requested,
            thicknessMm: shell,
            sinks: undefined,
        };
        try {
            const plain = await reconstructProceduralPreview(raw.clone(), {
                side: "left",
                sourceField: plainField,
                thicknessMm: shell,
                stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
                wallStyle: "straight",
                footprintScale: layout.scale,
            });
            const sunk = await reconstructProceduralPreview(raw.clone(), {
                side: "left",
                sourceField: sunkField,
                thicknessMm: thickness,
                stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
                wallStyle: "straight",
                footprintScale: layout.scale,
            });
            const floor = lowestLoweredZ(plain.geometry, sunk.geometry);
            plain.geometry.dispose();
            sunk.geometry.dispose();
            expect(floor.n).toBeGreaterThanOrEqual(10);
            expect(floor.z).toBeGreaterThanOrEqual(FLOOR_MIN_MM - 1e-3);
        } finally {
            raw.dispose();
            resetSampleTopGeometryCache();
            globalThis.fetch = origFetch;
        }
    }, 120_000);
});

describe("PR #493 grader: MCP thickness_mm documentation", () => {
    test("create_saved_design tool text describes uniform shell mode when thickness_mm is set", () => {
        const schemasPath = resolve(process.cwd(), "packages/mcp/src/tools/schemas.ts");
        const text = readFileSync(schemasPath, "utf8");
        expect(text).toMatch(/uniform shell mode so the loft uses the shell-thickness slider/);
        expect(text).toMatch(/thickness_mm is the labelled shell\/base clearance/);
    });
});
