// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Export-solid regression for heel cup depth: closeGlbInsoleToSolid must stay
// within the measured depth=0 baseline (Euler + heel-bridge self-intersections)
// as depth increases. Separate from heel-cup-depth.realmesh.test.ts (deformation
// metrics only) — this file exercises the mesh-close / STL export gate.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    assertClosedSolidAcceptable,
    type ClosedSolidBaseline,
    closeGlbInsoleToSolid,
    countHeelBridgeSelfIntersections,
    DEFAULT_GLB_CLOSED_BASELINE,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/Default.glb");

/** Depth samples exercised against the live depth=0 baseline. */
const DEPTH_SAMPLES_MM = [0, 3, 8, 15] as const;

/** Sanity pin: live depth=0 self-intersections may drift slightly from the pinned 249. */
const BASELINE_SI_EPSILON = 30;

function neutralCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function correctionField(side: Side, patch: Partial<SideCorrections> = {}): HeightFieldParams {
    return {
        side,
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections: { ...neutralCorrections(), ...patch },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

function maxBottomDriftMm(base: BufferGeometry, mod: BufferGeometry): number {
    const topN = (base.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const baseArr = base.getAttribute("position")!.array as Float32Array;
    const modArr = mod.getAttribute("position")!.array as Float32Array;
    let max = 0;
    for (let i = topN; i < baseArr.length / 3; i++) {
        const dx = modArr[i * 3]! - baseArr[i * 3]!;
        const dy = modArr[i * 3 + 1]! - baseArr[i * 3 + 1]!;
        const dz = modArr[i * 3 + 2]! - baseArr[i * 3 + 2]!;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > max) max = d;
    }
    return max;
}

function measureClosedBaseline(raw: BufferGeometry): ClosedSolidBaseline {
    const closed = closeGlbInsoleToSolid(raw.clone());
    try {
        const topN = (closed.userData as { topVertexCount?: number }).topVertexCount ?? 0;
        const report = validateManifold(closed);
        const si = countHeelBridgeSelfIntersections(closed, topN);
        return {
            eulerCharacteristic: report.eulerCharacteristic,
            heelBridgeSelfIntersections: si,
        };
    } finally {
        closed.dispose();
    }
}

describe("heel-cup-depth export solid (Default.glb)", () => {
    let rawRight: BufferGeometry;
    let rawLeft: BufferGeometry;

    beforeAll(async () => {
        expect(existsSync(FIXTURE_PATH)).toBe(true);
        const buf = readFileSync(FIXTURE_PATH).buffer.slice(0);
        const group = await loadGlbFromBuffer(buf);
        const merged = extractMergedGeometry(group);
        expect(merged).not.toBeNull();
        rawRight = merged!.geometry;
        // Left side uses the same stock mesh mirrored by applyBaseModifiers when side=left.
        rawLeft = rawRight.clone();
        if (rawRight.userData) rawLeft.userData = { ...rawRight.userData };
    });

    for (const side of ["right", "left"] as const) {
        describe(`side=${side}`, () => {
            let liveBaseline: ClosedSolidBaseline;
            let baseGeo: BufferGeometry;

            beforeAll(() => {
                baseGeo = side === "right" ? rawRight : rawLeft;
                const depth0 = applyBaseModifiers(baseGeo, correctionField(side, { heelCupDepthMm: 0 }), 0);
                try {
                    liveBaseline = measureClosedBaseline(depth0);
                } finally {
                    depth0.dispose();
                }

                // Sanity-pin against the committed constant; self-correct once if SI drifts.
                expect(liveBaseline.eulerCharacteristic).toBe(
                    DEFAULT_GLB_CLOSED_BASELINE.eulerCharacteristic,
                );
                const pinned = DEFAULT_GLB_CLOSED_BASELINE.heelBridgeSelfIntersections;
                if (Math.abs(liveBaseline.heelBridgeSelfIntersections - pinned) > BASELINE_SI_EPSILON) {
                    throw new Error(
                        `depth=0 heelBridgeSelfIntersections=${liveBaseline.heelBridgeSelfIntersections} ` +
                            `drifts more than ±${BASELINE_SI_EPSILON} from pinned ${pinned}`,
                    );
                }
                if (liveBaseline.heelBridgeSelfIntersections !== pinned) {
                    DEFAULT_GLB_CLOSED_BASELINE.heelBridgeSelfIntersections =
                        liveBaseline.heelBridgeSelfIntersections;
                }
            });

            for (const depthMm of DEPTH_SAMPLES_MM) {
                test(`depth=${depthMm}mm stays within live baseline + HC-1`, () => {
                    const mod = applyBaseModifiers(
                        baseGeo,
                        correctionField(side, { heelCupDepthMm: depthMm }),
                        0,
                    );
                    try {
                        expect(maxBottomDriftMm(baseGeo, mod)).toBeLessThan(1e-6);

                        const solid = closeGlbInsoleToSolid(mod);
                        try {
                            const topN = (solid.userData as { topVertexCount?: number }).topVertexCount ?? 0;
                            expect(() =>
                                assertClosedSolidAcceptable(solid, topN, liveBaseline),
                            ).not.toThrow();
                        } finally {
                            solid.dispose();
                        }
                    } finally {
                        mod.dispose();
                    }
                });
            }

            test("combined width=5 + depth=5 stays within live baseline + HC-1", () => {
                const mod = applyBaseModifiers(
                    baseGeo,
                    correctionField(side, { heelCupDepthMm: 5, heelCupWidthMm: 5 }),
                    0,
                );
                try {
                    expect(maxBottomDriftMm(baseGeo, mod)).toBeLessThan(1e-6);

                    const solid = closeGlbInsoleToSolid(mod);
                    try {
                        const topN = (solid.userData as { topVertexCount?: number }).topVertexCount ?? 0;
                        expect(() => assertClosedSolidAcceptable(solid, topN, liveBaseline)).not.toThrow();
                    } finally {
                        solid.dispose();
                    }
                } finally {
                    mod.dispose();
                }
            });
        });
    }
});
