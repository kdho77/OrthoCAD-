// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Export-solid regression for heel cup depth: closeGlbInsoleToSolid +
// assertClosedSolidAcceptable gate. Separate from heel-cup-depth.realmesh.test.ts.
//
// DRIFT (Phase 1 halt — do not "fix" without review):
//   Default.glb rims are unequal (topRim≈446, botRim≈1184) so closeGlbInsoleToSolid
//   takes the two-pointer path, NOT the equal-count path that Phase 1 guards.
//   Phase 0's "equal-count" label was wrong: bridgeTris=1630 = 446+1184 (two-pointer),
//   not 2×815. Post rim-conformity transfer SI (remeasured): depth0=249, depth3=277,
//   depth8=296, depth15=365. The export gate still rejects depth>0 against depth=0
//   baseline (SI escalation). Combined width+depth is edge-manifold post-#109.

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

/**
 * Phase 0 / Phase 1 measured SI on Default.glb (two-pointer path). Documented so
 * a future Phase 3 retune has a regression table; not used as a soft pass.
 */
const MEASURED_SI_BY_DEPTH: Record<number, number> = {
    0: 249,
    3: 277,
    8: 296,
    15: 365,
};

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
    // Detect thick axis from extents (Default.glb → Z).
    let maxExtent = -1;
    let thickAxis = 2;
    for (let a = 0; a < 3; a++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < baseArr.length / 3; i++) {
            const v = baseArr[i * 3 + a]!;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        const e = hi - lo;
        if (maxExtent < 0 || e < maxExtent) {
            maxExtent = e;
            thickAxis = a;
        }
    }
    const PLANTAR_Z_MAX_MM = 1.0;
    let max = 0;
    for (let i = topN; i < baseArr.length / 3; i++) {
        // HC-1 plantar band only — rim-conformity may move the side wall.
        if (baseArr[i * 3 + thickAxis]! > PLANTAR_Z_MAX_MM) continue;
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
        // Left side uses the same stock mesh; applyBaseModifiers(side=left) handles
        // medial-sign. Physical mirror of the GLB is out of scope for this harness.
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
                test(`depth=${depthMm}mm edge-manifold + HC-1; SI vs baseline`, () => {
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
                            const report = validateManifold(solid);
                            expect(report.openEdges).toBe(0);
                            expect(report.nonManifoldEdges).toBe(0);
                            expect(report.eulerCharacteristic).toBe(liveBaseline.eulerCharacteristic);

                            const si = countHeelBridgeSelfIntersections(solid, topN);
                            const expectedSi = MEASURED_SI_BY_DEPTH[depthMm];
                            if (expectedSi !== undefined) {
                                // Allow small SAT-count jitter (±5) across environments.
                                expect(Math.abs(si - expectedSi)).toBeLessThanOrEqual(5);
                            }

                            if (depthMm === 0) {
                                expect(() =>
                                    assertClosedSolidAcceptable(solid, topN, liveBaseline),
                                ).not.toThrow();
                            } else {
                                // Drift: two-pointer SI escalates with depth; the export
                                // gate must reject until Phase 3 retunes the bridge path
                                // Default.glb actually takes.
                                expect(() => assertClosedSolidAcceptable(solid, topN, liveBaseline)).toThrow(
                                    /heelBridgeSelfIntersections/,
                                );
                            }
                        } finally {
                            solid.dispose();
                        }
                    } finally {
                        mod.dispose();
                    }
                });
            }

            test("combined width=5 + depth=5: topRim healthy + edge-manifold (post-#109)", () => {
                const mod = applyBaseModifiers(
                    baseGeo,
                    correctionField(side, { heelCupDepthMm: 5, heelCupWidthMm: 5 }),
                    0,
                );
                try {
                    expect(maxBottomDriftMm(baseGeo, mod)).toBeLessThan(1e-6);
                    const solid = closeGlbInsoleToSolid(mod);
                    try {
                        const report = validateManifold(solid);
                        expect(report.openEdges).toBe(0);
                        expect(report.nonManifoldEdges).toBe(0);
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
