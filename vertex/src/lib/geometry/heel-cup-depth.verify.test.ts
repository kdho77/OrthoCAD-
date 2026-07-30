// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import type { Box3 } from "three";
import {
    applyBaseModifiers,
    BASE_BOTTOM_DELTA_TOLERANCE_MM,
    correctionDeltaAt,
} from "@/lib/geometry/base-modifier";
import { bump, type HeightFieldParams, heelCupDepthBowlDelta, smoothstep } from "@/lib/geometry/height-field";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";
import { DEFAULT_GLB_FIXTURE_PATH } from "../../../../tests/helpers/load-production-default-glb";

/** Regression ceiling from PR #105 stress analysis (proven default ~79.6, legacy ~105.7). */
const FOLD_LOCUS_MAX_GRADIENT_CEILING = 85;

const DEPTH_TEST_MM = 5;
const CLEAN_ZONE_REL_TOLERANCE = 0.15;

async function loadDefaultGlbBuffer(): Promise<ArrayBuffer> {
    const buf = readFileSync(DEFAULT_GLB_FIXTURE_PATH);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

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

function depthField(heelCupDepthMm: number): HeightFieldParams {
    return {
        side: "right",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections: { ...neutralCorrections(), heelCupDepthMm, heelCupWidthMm: 0 },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

function neutralField(): HeightFieldParams {
    return depthField(0);
}

/** Pre-PR#105 three additive depth terms (original knees) for clean-zone comparison. */
function legacyHeelCupDepthShaped(u: number, av: number, depthMm: number): number {
    if (depthMm <= 0) return 0;
    const heel = bump(u, 0.1, 0.18);
    const sideWall = smoothstep(0.55, 0.92, av);
    const posteriorWall = smoothstep(0.07, 0.0, u) * (1 - smoothstep(0.7, 0.95, av));
    const floorSeat = bump(u, 0.13, 0.12);
    const floorCenter = 1 - smoothstep(0.35, 0.75, av);
    return (
        depthMm * heel * sideWall * 0.65 +
        depthMm * posteriorWall * 0.85 -
        depthMm * 0.35 * floorSeat * floorCenter
    );
}

function maxFoldLocusGradient(depthMm: number): number {
    const u0 = 0.01;
    const u1 = 0.07;
    const av0 = 0;
    const av1 = 0.34;
    const du = 1e-4;
    const dav = 1e-4;
    const nu = 200;
    const nav = 140;
    let maxCombined = 0;

    for (let iu = 0; iu <= nu; iu++) {
        const u = u0 + (iu / nu) * (u1 - u0);
        for (let ia = 0; ia <= nav; ia++) {
            const av = av0 + (ia / nav) * (av1 - av0);
            const fu =
                (heelCupDepthBowlDelta(u + du, av, depthMm) - heelCupDepthBowlDelta(u - du, av, depthMm)) /
                (2 * du);
            const fa =
                (heelCupDepthBowlDelta(u, av + dav, depthMm) - heelCupDepthBowlDelta(u, av - dav, depthMm)) /
                (2 * dav);
            maxCombined = Math.max(maxCombined, Math.hypot(fu, fa));
        }
    }
    return maxCombined;
}

function detectAxes(box: Box3): { thickAxis: number } {
    const sizes: [number, number][] = [
        [0, box.max.x - box.min.x],
        [1, box.max.y - box.min.y],
        [2, box.max.z - box.min.z],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    return { thickAxis: sizes[0]![0] };
}

describe("heel cup depth — bowl profile verification", () => {
    test("property 1: depth=0 → zero correction delta in heel zone", () => {
        const neutral = neutralField();
        const samples: [number, number][] = [
            [0.05, 0.2],
            [0.1, 0.8],
            [0.13, 0.2],
            [0.03, 0.5],
        ];
        for (const [u, av] of samples) {
            expect(heelCupDepthBowlDelta(u, av, 0)).toBe(0);
            expect(correctionDeltaAt(u, av, depthField(0), neutral)).toBe(0);
        }
    });

    test("fold-locus gradient stays below regression ceiling", () => {
        const maxGrad = maxFoldLocusGradient(DEPTH_TEST_MM);
        console.log("[HC-DEPTH-VERIFY] foldLocusMaxGrad", {
            depthMm: DEPTH_TEST_MM,
            maxGrad,
            ceiling: FOLD_LOCUS_MAX_GRADIENT_CEILING,
        });
        expect(maxGrad).toBeLessThan(FOLD_LOCUS_MAX_GRADIENT_CEILING);
    });

    test("av=0.20 meridian is monotonically non-increasing at depth=5", () => {
        const av = 0.2;
        const uSamples = [0.01, 0.03, 0.05, 0.07, 0.09, 0.11, 0.13];
        const values = uSamples.map((u) => heelCupDepthBowlDelta(u, av, DEPTH_TEST_MM));

        console.log("[HC-DEPTH-VERIFY] meridian@av0.2", {
            depthMm: DEPTH_TEST_MM,
            samples: uSamples.map((u, i) => ({ u, val: values[i] })),
        });

        for (let i = 1; i < values.length; i++) {
            expect(values[i]!).toBeLessThanOrEqual(values[i - 1]! + 1e-9);
        }

        // Proven pattern anchors (±0.15 mm) — guards cancellation-band regression
        expect(values[0]!).toBeCloseTo(4.15, 0);
        expect(values[2]!).toBeCloseTo(1.98, 0);
        expect(values[3]!).toBeCloseTo(0.4, 0);
        expect(values[6]!).toBeCloseTo(-1.75, 1);
    });

    test("property 5: clean-zone shape preserved vs legacy three-term", () => {
        const cleanPoints: [string, number, number][] = [
            ["lateral rim", 0.1, 0.8],
            ["central seat", 0.13, 0.2],
        ];
        const rows: Record<string, number> = {};
        for (const [name, u, av] of cleanPoints) {
            const neu = heelCupDepthBowlDelta(u, av, DEPTH_TEST_MM);
            const leg = legacyHeelCupDepthShaped(u, av, DEPTH_TEST_MM);
            rows[name] = neu;
            if (Math.abs(leg) > 0.01) {
                expect(Math.abs(neu - leg) / Math.abs(leg)).toBeLessThan(CLEAN_ZONE_REL_TOLERANCE);
            } else {
                expect(Math.abs(neu - leg)).toBeLessThan(0.2);
            }
        }
        console.log("[HC-DEPTH-VERIFY] cleanZone", { depthMm: DEPTH_TEST_MM, ...rows });
    });

    test("HC-1 + HC-2: Default.glb depth-only applyBaseModifiers", async () => {
        const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
        const merged = extractMergedGeometry(group);
        expect(merged).not.toBeNull();
        const raw = merged!.geometry;
        const field = depthField(DEPTH_TEST_MM);
        const basePos = raw.getAttribute("position")!.array as Float32Array;
        const topN = (raw.userData as { topVertexCount?: number }).topVertexCount ?? basePos.length / 3;
        raw.computeBoundingBox();
        const { thickAxis } = detectAxes(raw.boundingBox!);
        const modified = applyBaseModifiers(raw, field, 0);
        const modPos = modified.getAttribute("position")!.array as Float32Array;

        let maxBottomThickDrift = 0;
        let maxTopThickDrift = 0;
        const PLANTAR_Z_MAX_MM = 1.0;
        for (let i = 0; i < modPos.length / 3; i++) {
            const dThick = Math.abs(modPos[i * 3 + thickAxis]! - basePos[i * 3 + thickAxis]!);
            if (i >= topN) {
                // HC-1 plantar band only — rim-conformity may move the side wall.
                if (basePos[i * 3 + thickAxis]! <= PLANTAR_Z_MAX_MM) {
                    maxBottomThickDrift = Math.max(maxBottomThickDrift, dThick);
                }
            } else maxTopThickDrift = Math.max(maxTopThickDrift, dThick);
        }

        console.log("[HC-DEPTH-VERIFY] Default.glb depth=5", {
            thickAxis,
            topVertexCount: topN,
            maxBottomThickDrift,
            maxTopThickDrift,
        });

        expect(maxBottomThickDrift).toBeLessThan(BASE_BOTTOM_DELTA_TOLERANCE_MM);
        expect(maxTopThickDrift).toBeGreaterThan(0.1);

        modified.dispose();
        raw.dispose();
    });
});
