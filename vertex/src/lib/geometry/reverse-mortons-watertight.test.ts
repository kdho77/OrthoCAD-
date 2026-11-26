// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

// Reverse Morton's must loft a watertight solid on both feet.
// Headless Export rebuilds from the saved design, engraves the patient name,
// then the manifold guard. US M9 is the size that threw
// MeshNotWatertightError (heelBridgeSelfIntersections=5) on main.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { buildFinalizedFootFromSavedDesign } from "@/features/exports/saved-design-finalized-mesh";
import { getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import { applyElementsToTopMeshLast } from "@/lib/geometry/element-assets/apply-elements";
import { defaultElementPose, elementHeightAt, REMAINING_MATERIAL_MM } from "@/lib/geometry/elements";
import { heightFieldYFromMeshY } from "@/lib/geometry/handedness";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClientStore } from "@/stores/client-store";
import type { PlacedElement, Side, SideCorrections } from "@/types";
import type { ClientRow } from "../../../shared/client-files";
import { parseSavedDesignCatalog } from "../../../shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot";

const CORRECTIONS: SideCorrections = {
    forefootPostingDeg: 0,
    rearfootPostingDeg: 0,
    medialSkiveMm: 0,
    lateralSkiveMm: 0,
    archFillMm: 0,
    archHeightMm: 0,
    archEaseMm: 0,
    heelCupDepthMm: 0,
    heelCupHeightMm: 0,
    heelCupWidthMm: 0,
    heelLiftMm: 0,
    apexMoveMm: 0,
    medialFlangeMm: 0,
    lateralFlangeMm: 0,
};

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
    useClientStore.setState({ activeClientId: null, clients: [] });
});

function installPatient(): void {
    const row = {
        id: "reverse-mortons-patient",
        firstName: "Alex",
        lastName: "Latino",
        displayName: "Alex Latino",
    } as ClientRow;
    useClientStore.setState({ activeClientId: row.id, clients: [row] });
}

/** Vertices on a once-used edge. Same loop the loft uses as the wall rim. */
function boundaryVertexIndices(geometry: BufferGeometry): Set<number> {
    const index = geometry.getIndex();
    const out = new Set<number>();
    if (!index) return out;
    const uses = new Map<string, number>();
    const ends = new Map<string, [number, number]>();
    for (let t = 0; t < index.count; t += 3) {
        const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        for (let k = 0; k < 3; k++) {
            const a = tri[k] ?? 0;
            const b = tri[(k + 1) % 3] ?? 0;
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            uses.set(key, (uses.get(key) ?? 0) + 1);
            ends.set(key, a < b ? [a, b] : [b, a]);
        }
    }
    for (const [key, count] of uses) {
        if (count !== 1) continue;
        const pair = ends.get(key);
        if (!pair) continue;
        out.add(pair[0]);
        out.add(pair[1]);
    }
    return out;
}

async function exportFoot(thicknessMm: number, heightMm: number, side: Side) {
    installPatient();
    const snap = buildSavedDesignSnapshot({
        stored: { system: "US_M", size: 9, left: null, right: null, width: null },
        catalog: parseSavedDesignCatalog({
            thickness_mm: thicknessMm,
            elements: [
                { name: "reverse_mortons", side: "left", height_mm: heightMm },
                { name: "reverse_mortons", side: "right", height_mm: heightMm },
            ],
        }),
    });
    const foot = await buildFinalizedFootFromSavedDesign({
        design: snap.design,
        side,
        sampleTopBytes: sampleTopBytes(),
        includeLeader: false,
    });
    const geometry = binaryStlToGeometry(foot.stl);
    try {
        const report = validateManifold(geometry);
        return {
            watertight: report.isWatertight && report.openEdges === 0 && report.nonManifoldEdges === 0,
            euler: report.eulerCharacteristic,
            openEdges: report.openEdges,
            nonManifold: report.nonManifoldEdges,
        };
    } finally {
        geometry.dispose();
    }
}

describe("reverse Morton's holds the loft rim", () => {
    test("boundary stays put and the interior cut stops at the material floor", async () => {
        const bytes = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
        const raw = await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        try {
            for (const side of ["left", "right"] as const) {
                const base = side === "right" ? mirrorGeometry(raw) : raw.clone();
                const frame = getBaseFootprintFrame(base, side);
                const length = frame.lenSize;
                const width = frame.widSize;
                const pose = defaultElementPose("reverse_mortons", side, length, width);
                const el: PlacedElement = {
                    id: `reverse-${side}`,
                    kind: "reverse_mortons",
                    side,
                    ...pose,
                    heightMm: 2,
                };
                const field: HeightFieldParams = {
                    side,
                    lengthMm: length,
                    widthMm: width,
                    thicknessMm: 3,
                    corrections: CORRECTIONS,
                    elements: [el],
                    includeElements: true,
                    includeSkives: false,
                    trimline: null,
                };
                const composed = base.clone();
                await applyElementsToTopMeshLast(composed, base, field, { subdivide: false });
                const before = base.getAttribute("position");
                const after = composed.getAttribute("position");
                const rim = boundaryVertexIndices(base);
                const ta = frame.thickAxis;
                let heldCut = 0;
                let interiorDrop = 0;
                let maxDrop = 0;
                const afterRim = boundaryVertexIndices(composed);
                expect(afterRim.size, `${side} rim vertex count`).toBe(rim.size);
                for (const i of rim) expect(afterRim.has(i), `${side} rim ${i}`).toBe(true);
                expect(after.count, `${side} interior split`).toBeGreaterThan(before.count);
                for (let i = 0; i < before.count; i++) {
                    const z0 = before.getComponent(i, ta);
                    const z1 = after.getComponent(i, ta);
                    const xFromHeel =
                        ((before.getComponent(i, frame.lengthAxis) - frame.lenMin) / frame.lenSize) * length;
                    const yMm = heightFieldYFromMeshY(before.getComponent(i, frame.widthAxis) - frame.widCenter);
                    const h = elementHeightAt([el], xFromHeel, yMm, length, width);
                    if (rim.has(i)) {
                        expect(z1, `${side} rim z ${i}`).toBeCloseTo(z0, 5);
                        if (h < -0.5) heldCut += 1;
                        continue;
                    }
                    if (z1 < z0 - 1e-4) {
                        interiorDrop += 1;
                        maxDrop = Math.max(maxDrop, z0 - z1);
                        expect(z1, `${side} floor ${i}`).toBeGreaterThanOrEqual(REMAINING_MATERIAL_MM - 1e-4);
                    }
                }
                for (let i = before.count; i < after.count; i++) {
                    const z1 = after.getComponent(i, ta);
                    expect(z1, `${side} split floor ${i}`).toBeGreaterThanOrEqual(REMAINING_MATERIAL_MM - 1e-4);
                }
                expect(heldCut, `${side} rim vertices inside the cut`).toBeGreaterThan(0);
                expect(interiorDrop, `${side} interior vertices lowered`).toBeGreaterThan(0);
                expect(maxDrop, `${side} cut depth`).toBeGreaterThan(0.4);
                composed.dispose();
                base.dispose();
            }
        } finally {
            raw.dispose();
        }
    });
});

describe("reverse Morton's export is watertight", () => {
    for (const thicknessMm of [2, 3] as const) {
        for (const heightMm of [1, 2, 3] as const) {
            for (const side of ["left", "right"] as const) {
                test(`US M9 ${side} thickness ${thicknessMm} reverse Morton's ${heightMm} mm`, async () => {
                    const solid = await exportFoot(thicknessMm, heightMm, side);
                    expect(
                        solid.openEdges,
                        `${side} t=${thicknessMm} h=${heightMm} nonManifold=${solid.nonManifold} euler=${solid.euler}`,
                    ).toBe(0);
                    expect(solid.nonManifold).toBe(0);
                    expect(solid.watertight).toBe(true);
                    expect(solid.euler).toBe(2);
                }, 180_000);
            }
        }
    }
});
