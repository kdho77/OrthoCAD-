// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

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
    effectiveInsoleThicknessMm,
    FLOOR_MIN_MM,
    FOREFOOT_THICKNESS_CLEARANCE_MM,
    SINK_KIND_ORDER,
    SINK_PROFILES,
} from "@/lib/geometry/sink";
import type { PlacedSink } from "@/types";
import { parseSavedDesignCatalog } from "../vertex/shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../vertex/shared/saved-design-snapshot";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const THICKNESS_MM = [2, 2.5, 3] as const;

function loadSampleTopBytes(): ArrayBuffer {
    const bytes = readFileSync(SAMPLE_TOP_PATH);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Lowest Z of a vertex the sink moved down. Plantar vertices that stay put are not the floor. */
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

describe("catalog thickness_mm readback", () => {
    test("a set thickness is uniform and the thickness that was asked for", () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };
        const omitted = buildSavedDesignSnapshot({ stored, catalog: parseSavedDesignCatalog({}) });
        const set = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ thickness_mm: 3 }),
        });
        expect(omitted.design.thicknessMm).toBe(2);
        expect(omitted.design.shellThicknessMode).toBe("zonal");
        expect(set.design.thicknessMm).toBe(3);
        expect(set.design.shellThicknessMode).toBe("uniform");
        expect(set.design.paired?.leftThicknessMm).toBe(3);
        expect(set.design.paired?.rightThicknessMm).toBe(3);
        expect(set.paths).toContain("settings.shellThicknessMode");
    });
});

describe("sink floor at catalog thickness", () => {
    test("every sink kind at 2, 2.5, and 3 mm keeps the guaranteed floor through max depth", async () => {
        expect(FLOOR_MIN_MM).toBe(FOREFOOT_THICKNESS_CLEARANCE_MM);
        const bytes = loadSampleTopBytes();
        const origFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(bytes);
        resetSampleTopGeometryCache();
        const raw = await sampleTopFromArrayBuffer(bytes);
        const layout = insoleLayoutForUsMenSize(9);
        const failures: string[] = [];
        try {
            for (const thickness of THICKNESS_MM) {
                for (const kind of SINK_KIND_ORDER) {
                    const depth = SINK_PROFILES[kind].maxDepthMm;
                    const sink: PlacedSink = { id: kind, kind, depthMm: depth };
                    const shell = effectiveInsoleThicknessMm(thickness, {
                        side: "left",
                        lengthMm: layout.lengthMm,
                        widthMm: layout.widthMm,
                        sinks: [sink],
                    });
                    const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };
                    const snap = buildSavedDesignSnapshot({
                        stored,
                        catalog: parseSavedDesignCatalog({
                            thickness_mm: thickness,
                            sinks: [{ name: kind, side: "left", depth_mm: depth }],
                        }),
                    });
                    const requested = baseModifierField(snap.design, "left", thickness);
                    const sunkField: HeightFieldParams = { ...requested, sinks: [sink] };
                    const plainField: HeightFieldParams = {
                        ...requested,
                        thicknessMm: shell,
                        sinks: undefined,
                    };
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
                    if (floor.n < 10 || !(floor.z >= FLOOR_MIN_MM - 1e-3)) {
                        failures.push(
                            `${kind} ${thickness} mm depth ${depth}: floor ${floor.z.toFixed(3)} n ${floor.n}`,
                        );
                    }
                }
            }
        } finally {
            raw.dispose();
            resetSampleTopGeometryCache();
            globalThis.fetch = origFetch;
        }
        expect(failures).toEqual([]);
    }, 420_000);
});
