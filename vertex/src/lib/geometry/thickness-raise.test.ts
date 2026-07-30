// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Shell-thickness slider regression suite.
//
// Contract (derived plantar datum): thicknessMm is the minimum material
// clearance of the top sheet above the plantar plane. Lift magnitude is
// (thicknessMm − nativeMinClearance), while BASE_REFERENCE_THICKNESS_MM remains
// the neutral-field zero for correction deltas only. Plantar bottom stays fixed;
// the shell wall stretches via #125's local height ramp.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers, PLANTAR_Z_MAX_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import { closeGlbInsoleToSolid, validateManifold } from "@/lib/geometry/mesh-close";
import { deriveNativeShellThicknessDatum } from "@/lib/geometry/native-shell-thickness";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { DesignState, SideCorrections } from "@/types";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/Default.glb");

async function loadRawDefault(): Promise<BufferGeometry> {
    const buf = readFileSync(FIXTURE_PATH);
    const group = await loadGlbFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const merged = extractMergedGeometry(group);
    expect(merged).not.toBeNull();
    return merged!.geometry;
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

function thicknessField(thicknessMm: number): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm,
        corrections: neutralCorrections(),
        elements: [],
        includeSkives: false,
        includeElements: true,
        trimline: null,
    };
}

describe("shell thickness raises the top mesh (bottom-anchored)", () => {
    test("labelled 3.0 mm lifts by (3 − nativeMinClearance), not a no-op", async () => {
        // FINDING (C5): old expectation "reference thickness is a no-op" encoded
        // defective (t − 3) semantics. Labelled 3.0 mm must deliver 3.0 mm clearance,
        // so the top lifts by 3.0 − nativeMinClearance (~1.039 mm on Default.glb).
        const raw = await loadRawDefault();
        const datum = deriveNativeShellThicknessDatum(raw);
        expect(datum).not.toBeNull();
        const expectedLift = 3 - datum!.nativeMinClearanceMm;
        const topN = (raw.userData as { topVertexCount: number }).topVertexCount;
        const modified = applyBaseModifiers(raw, thicknessField(3), 0);
        const a = raw.getAttribute("position")!.array as Float32Array;
        const b = modified.getAttribute("position")!.array as Float32Array;
        let minTop = Infinity;
        let maxTop = -Infinity;
        let sumTop = 0;
        for (let i = 0; i < topN; i++) {
            const dz = b[i * 3 + 2]! - a[i * 3 + 2]!;
            if (dz < minTop) minTop = dz;
            if (dz > maxTop) maxTop = dz;
            sumTop += dz;
        }
        const meanTop = sumTop / topN;
        // Equal strength to prior lift bounds (was expectedLift=0 / maxDelta<1e-4 no-op).
        expect(maxTop).toBeLessThanOrEqual(expectedLift + 1e-3);
        expect(minTop).toBeGreaterThan(expectedLift - 1.0);
        expect(meanTop).toBeGreaterThan(expectedLift - 0.1);
        modified.dispose();
        raw.dispose();
    });

    test("7mm lifts every top vertex by ≈(7 − native); plantar bottom stays fixed", async () => {
        const raw = await loadRawDefault();
        const datum = deriveNativeShellThicknessDatum(raw);
        expect(datum).not.toBeNull();
        const topN = (raw.userData as { topVertexCount: number }).topVertexCount;
        const total = raw.getAttribute("position").count;
        expect(topN).toBeGreaterThan(0);

        const t = 7;
        // OLD expectedLift = t - BASE_REFERENCE_THICKNESS_MM = 4
        // NEW expectedLift = t - nativeMinClearanceMm ≈ 5.03855
        const expectedLift = t - datum!.nativeMinClearanceMm;
        const modified = applyBaseModifiers(raw, thicknessField(t), 0);
        const a = raw.getAttribute("position")!.array as Float32Array;
        const b = modified.getAttribute("position")!.array as Float32Array;

        let minTop = Infinity;
        let maxTop = -Infinity;
        let sumTop = 0;
        for (let i = 0; i < topN; i++) {
            const dz = b[i * 3 + 2]! - a[i * 3 + 2]!;
            if (dz < minTop) minTop = dz;
            if (dz > maxTop) maxTop = dz;
            sumTop += dz;
        }
        const meanTop = sumTop / topN;
        // Equal strength to prior bounds (same absolute tolerances vs new expectedLift).
        expect(maxTop).toBeLessThanOrEqual(expectedLift + 1e-3);
        expect(minTop).toBeGreaterThan(expectedLift - 1.0);
        expect(meanTop).toBeGreaterThan(expectedLift - 0.1);

        // Plantar bottom sheet (z ≤ PLANTAR_Z_MAX_MM): fully anchored — equal strength.
        let maxPlantar = 0;
        let plantarCount = 0;
        for (let i = topN; i < total; i++) {
            if (a[i * 3 + 2]! > PLANTAR_Z_MAX_MM) continue;
            plantarCount++;
            maxPlantar = Math.max(maxPlantar, Math.abs(b[i * 3 + 2]! - a[i * 3 + 2]!));
        }
        expect(plantarCount).toBeGreaterThan(1000);
        expect(maxPlantar).toBeLessThan(1e-3);

        modified.dispose();
        raw.dispose();
    });

    test("wall lift is a smooth local ramp of base height — no nearest-rim-seed noise", async () => {
        const raw = await loadRawDefault();
        const datum = deriveNativeShellThicknessDatum(raw);
        expect(datum).not.toBeNull();
        const topN = (raw.userData as { topVertexCount: number }).topVertexCount;
        const total = raw.getAttribute("position").count;

        const t = 7;
        // OLD expectedLift = 4; NEW = t − nativeMinClearance
        const expectedLift = t - datum!.nativeMinClearanceMm;
        const modified = applyBaseModifiers(raw, thicknessField(t), 0);
        const a = raw.getAttribute("position")!.array as Float32Array;
        const b = modified.getAttribute("position")!.array as Float32Array;

        const smoothstep01 = (x: number) => {
            const c = Math.max(0, Math.min(1, x));
            return c * c * (3 - 2 * c);
        };
        let maxDev = 0;
        let wallTopCount = 0;
        let minWallTopLift = Infinity;
        for (let i = topN; i < total; i++) {
            const z = a[i * 3 + 2]!;
            const dz = b[i * 3 + 2]! - a[i * 3 + 2]!;
            const hz =
                z <= PLANTAR_Z_MAX_MM ? 0 : Math.min(1, (z - PLANTAR_Z_MAX_MM) / (2.0 - PLANTAR_Z_MAX_MM));
            const expected = expectedLift * smoothstep01(hz);
            maxDev = Math.max(maxDev, Math.abs(dz - expected));
            if (z >= 2.0) {
                wallTopCount++;
                minWallTopLift = Math.min(minWallTopLift, dz);
            }
        }
        // Equal strength: maxDev < 1e-3 unchanged; wall-top full-lift bound unchanged.
        expect(maxDev).toBeLessThan(1e-3);
        expect(wallTopCount).toBeGreaterThan(100);
        expect(minWallTopLift).toBeGreaterThan(expectedLift - 1e-3);

        modified.dispose();
        raw.dispose();
    });

    test("closed solid stays edge-manifold at 7mm", async () => {
        const raw = await loadRawDefault();
        const modified = applyBaseModifiers(raw, thicknessField(7), 0);
        const closed = closeGlbInsoleToSolid(modified);
        const report = validateManifold(closed);
        // Equal strength: openEdges/nonManifoldEdges still exactly 0.
        expect(report.openEdges).toBe(0);
        expect(report.nonManifoldEdges).toBe(0);
        closed.dispose();
        modified.dispose();
        raw.dispose();
    });
});

describe("paired workspace thickness plumbing", () => {
    function pairedDesign(leftT: number, rightT: number): DesignState {
        return {
            pattern: "full_contact",
            method: "printing_solid",
            thicknessMm: leftT,
            corrections: {
                unit: "mm",
                linked: true,
                left: neutralCorrections(),
                right: neutralCorrections(),
            },
            elements: [],
            paired: {
                leftThicknessMm: leftT,
                rightThicknessMm: rightT,
                leftMethod: "printing_solid",
                rightMethod: "printing_solid",
                linked: true,
            },
        } as unknown as DesignState;
    }

    test("insoleParamsFromDesign reads per-side paired thickness", () => {
        const design = pairedDesign(5, 7);
        expect(insoleParamsFromDesign(design, "left").thicknessMm).toBe(5);
        expect(insoleParamsFromDesign(design, "right").thicknessMm).toBe(7);
    });

    test("setThickness updates paired per-side thickness without throwing", async () => {
        const { useDesignStore } = await import("@/stores/design-store");
        const store = useDesignStore.getState();
        useDesignStore.setState({ design: pairedDesign(3, 3) });

        store.setThickness(7);

        const d = useDesignStore.getState().design;
        expect(d.paired?.leftThicknessMm).toBe(7);
        expect(d.paired?.rightThicknessMm).toBe(7);
        expect(d.thicknessMm).toBe(7);
    });
});
