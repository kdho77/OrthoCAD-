// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Derived plantar-clearance thickness datum: labelled thicknessMm must equal the
// measured minimum top-sheet clearance above plantarPlaneZ. Also regresses the
// ground-contact band (pre-change baseline on main 35b38393) and #125 wall-ramp
// shape (normalized adjacent-lift differential).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    PLANTAR_Z_MAX_MM,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    deriveNativeShellThicknessDatum,
    NATIVE_CLEARANCE_PERCENTILE,
} from "@/lib/geometry/native-shell-thickness";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/Default.glb");

/**
 * Pre-change baseline measured on merged main 35b38393 (post #124+#125) before
 * any datum edit. Select plantar verts by RAW base z ≤ PLANTAR_Z_MAX_MM; hash
 * MODIFIED Float32 xyz bytes (LE). Count matches contract's 39352; sha256 prefix
 * does NOT match the PR-#125-tip value cbf9e55c — stated plainly, not reconciled.
 */
const PRECHANGE_GROUND_BAND = {
    sha256: "d2f8a05ef108f53e4f5952227119557cfa66ed96b00f3784a9b44391795b8f1c",
    count: 39352,
    /** max |Δlift| between adjacent bottom wall verts at t=7 on main, absolute. */
    wallRampMaxAdjLiftAt7: 1.7628222703933716,
    /** expectedLift under old (t−3) semantics at t=7 — used to normalize shape. */
    prechangeExpectedLiftAt7: 7 - BASE_REFERENCE_THICKNESS_MM,
} as const;

/** Float32 mesh / softFloor numerical floor; slider step is 0.1 mm. */
const CLEARANCE_TOL_MM = 1e-4;

async function loadRawDefault(): Promise<BufferGeometry> {
    const buf = readFileSync(FIXTURE_PATH);
    const group = await loadGlbFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const merged = extractMergedGeometry(group);
    expect(merged).not.toBeNull();
    return merged!.geometry;
}

function zeroCorrections(): SideCorrections {
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

function thicknessField(thicknessMm: number, side: Side): HeightFieldParams {
    return {
        side,
        lengthMm: 266,
        widthMm: 95,
        thicknessMm,
        corrections: zeroCorrections(),
        elements: [],
        includeSkives: false,
        includeElements: true,
        trimline: null,
    };
}

function percentileSorted(sorted: number[], q: number): number {
    if (sorted.length === 0) return NaN;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
    return sorted[i]!;
}

function topClearances(pos: Float32Array, topN: number, thickAxis: number, plantarPlaneZ: number): number[] {
    const c: number[] = [];
    for (let i = 0; i < topN; i++) c.push(pos[i * 3 + thickAxis]! - plantarPlaneZ);
    c.sort((a, b) => a - b);
    return c;
}

function hashGroundBand(
    basePos: Float32Array,
    modPos: Float32Array,
    topN: number,
    total: number,
): { hash: string; count: number } {
    const idxs: number[] = [];
    for (let i = topN; i < total; i++) {
        if (basePos[i * 3 + 2]! > PLANTAR_Z_MAX_MM) continue;
        idxs.push(i);
    }
    const out = new Float32Array(idxs.length * 3);
    for (let k = 0; k < idxs.length; k++) {
        const i = idxs[k]!;
        out[k * 3] = modPos[i * 3]!;
        out[k * 3 + 1] = modPos[i * 3 + 1]!;
        out[k * 3 + 2] = modPos[i * 3 + 2]!;
    }
    const hash = createHash("sha256")
        .update(Buffer.from(out.buffer, out.byteOffset, out.byteLength))
        .digest("hex");
    return { hash, count: idxs.length };
}

describe("thickness datum = derived plantar clearance", () => {
    test("DELIVERED CLEARANCE equals labelled thicknessMm (residuals reported)", async () => {
        const raw = await loadRawDefault();
        const datum = deriveNativeShellThicknessDatum(raw);
        expect(datum).not.toBeNull();
        const topN = (raw.userData as { topVertexCount: number }).topVertexCount;
        const baseArr = raw.getAttribute("position")!.array as Float32Array;
        const la = datum!.lengthAxis;
        let lenMin = Infinity;
        let lenMax = -Infinity;
        for (let i = 0; i < topN; i++) {
            const L = baseArr[i * 3 + la]!;
            if (L < lenMin) lenMin = L;
            if (L > lenMax) lenMax = L;
        }
        const lenSize = lenMax - lenMin || 1;

        const report: {
            side: Side;
            t: number;
            measured: number;
            residual: number;
            heelP01: number;
            heelResidual: number;
            foreP01: number;
            foreResidual: number;
        }[] = [];

        for (const side of ["left", "right"] as const) {
            for (const t of [2.0, 3.0, 5.0, 7.0]) {
                const mod = applyBaseModifiers(raw, thicknessField(t, side), 0);
                const pos = mod.getAttribute("position")!.array as Float32Array;
                const all = topClearances(pos, topN, datum!.thickAxis, datum!.plantarPlaneZ);
                const heel: number[] = [];
                const fore: number[] = [];
                for (let i = 0; i < topN; i++) {
                    const c = pos[i * 3 + datum!.thickAxis]! - datum!.plantarPlaneZ;
                    const u = (baseArr[i * 3 + la]! - lenMin) / lenSize;
                    if (u < 0.25) heel.push(c);
                    if (u > 0.75) fore.push(c);
                }
                heel.sort((a, b) => a - b);
                fore.sort((a, b) => a - b);
                const measured = percentileSorted(all, NATIVE_CLEARANCE_PERCENTILE);
                const heelP01 = percentileSorted(heel, NATIVE_CLEARANCE_PERCENTILE);
                const foreP01 = percentileSorted(fore, NATIVE_CLEARANCE_PERCENTILE);
                report.push({
                    side,
                    t,
                    measured,
                    residual: measured - t,
                    heelP01,
                    heelResidual: heelP01 - t,
                    foreP01,
                    foreResidual: foreP01 - t,
                });
                // Global min clearance must match the label within numerical tol.
                // Do NOT widen this to absorb softFloor error — residual is reported.
                expect(Math.abs(measured - t)).toBeLessThanOrEqual(CLEARANCE_TOL_MM);
                mod.dispose();
            }
        }

        // C2: emit residuals as numbers (not just pass/fail).
        // eslint-disable-next-line no-console
        console.log(
            "DELIVERED_CLEARANCE_RESIDUALS=" +
                JSON.stringify(
                    {
                        nativeMinClearanceMm: datum!.nativeMinClearanceMm,
                        plantarPlaneZ: datum!.plantarPlaneZ,
                        tolMm: CLEARANCE_TOL_MM,
                        rows: report,
                    },
                    null,
                    2,
                ),
        );

        for (const row of report) {
            expect(Number.isFinite(row.residual)).toBe(true);
            expect(Number.isFinite(row.foreResidual)).toBe(true);
            expect(Number.isFinite(row.heelResidual)).toBe(true);
        }
        raw.dispose();
    });

    test("sub-native request clamps to nativeMinClearance and reports clamp", async () => {
        const raw = await loadRawDefault();
        const datum = deriveNativeShellThicknessDatum(raw);
        expect(datum).not.toBeNull();
        const native = datum!.nativeMinClearanceMm;
        const requested = native - 0.5;
        const mod = applyBaseModifiers(raw, thicknessField(requested, "left"), 0);
        const ud = (mod.userData as { thicknessDatum?: { clamped: boolean; flooredThicknessMm: number } })
            .thicknessDatum;
        expect(ud).toBeDefined();
        expect(ud!.clamped).toBe(true);
        expect(ud!.flooredThicknessMm).toBeGreaterThan(requested);
        expect(Math.abs(ud!.flooredThicknessMm - native)).toBeLessThan(1e-12);

        const topN = (raw.userData as { topVertexCount: number }).topVertexCount;
        const pos = mod.getAttribute("position")!.array as Float32Array;
        const measured = percentileSorted(
            topClearances(pos, topN, datum!.thickAxis, datum!.plantarPlaneZ),
            NATIVE_CLEARANCE_PERCENTILE,
        );
        expect(measured).toBeGreaterThanOrEqual(native - CLEARANCE_TOL_MM);
        expect(Math.abs(measured - native)).toBeLessThanOrEqual(CLEARANCE_TOL_MM);
        mod.dispose();
        raw.dispose();
    });

    test("GROUND BAND bit-identical across thickness + matches pre-change baseline", async () => {
        const raw = await loadRawDefault();
        const topN = (raw.userData as { topVertexCount: number }).topVertexCount;
        const total = raw.getAttribute("position").count;
        const basePos = Float32Array.from(raw.getAttribute("position")!.array as Float32Array);
        const hashes: string[] = [];
        for (const t of [2.0, 5.0]) {
            const mod = applyBaseModifiers(raw, thicknessField(t, "left"), 0);
            const a = mod.getAttribute("position")!.array as Float32Array;
            const { hash, count } = hashGroundBand(basePos, a, topN, total);
            expect(count).toBe(PRECHANGE_GROUND_BAND.count);
            expect(hash).toBe(PRECHANGE_GROUND_BAND.sha256);
            hashes.push(hash);
            mod.dispose();
        }
        expect(hashes[0]).toBe(hashes[1]);
        raw.dispose();
    });

    test("WALL RAMP smoothness no worse than pre-change (normalized)", async () => {
        const raw = await loadRawDefault();
        const datum = deriveNativeShellThicknessDatum(raw);
        expect(datum).not.toBeNull();
        const topN = (raw.userData as { topVertexCount: number }).topVertexCount;
        const basePos = Float32Array.from(raw.getAttribute("position")!.array as Float32Array);
        const t = 7;
        const expectedLift = t - datum!.nativeMinClearanceMm;
        const mod = applyBaseModifiers(raw, thicknessField(t, "left"), 0);
        const a = mod.getAttribute("position")!.array as Float32Array;
        const idx = raw.getIndex();
        expect(idx).not.toBeNull();

        // Shape metric (equal strength to thickness-raise): deviation from
        // lift × smoothstep(local height ramp).
        const smoothstep01 = (x: number) => {
            const c = Math.max(0, Math.min(1, x));
            return c * c * (3 - 2 * c);
        };
        let maxDev = 0;
        const total = raw.getAttribute("position").count;
        for (let i = topN; i < total; i++) {
            const z = basePos[i * 3 + 2]!;
            const dz = a[i * 3 + 2]! - basePos[i * 3 + 2]!;
            const hz =
                z <= PLANTAR_Z_MAX_MM ? 0 : Math.min(1, (z - PLANTAR_Z_MAX_MM) / (2.0 - PLANTAR_Z_MAX_MM));
            maxDev = Math.max(maxDev, Math.abs(dz - expectedLift * smoothstep01(hz)));
        }
        expect(maxDev).toBeLessThan(1e-3);

        // Adjacent-wall lift differential, normalized by lift magnitude so a
        // larger clinical offset cannot falsely look "worse".
        let maxAdj = 0;
        for (let tri = 0; tri < idx!.count; tri += 3) {
            const verts = [idx!.getX(tri), idx!.getX(tri + 1), idx!.getX(tri + 2)];
            for (let e = 0; e < 3; e++) {
                const i = verts[e]!;
                const j = verts[(e + 1) % 3]!;
                if (i < topN || j < topN) continue;
                const zi = basePos[i * 3 + 2]!;
                const zj = basePos[j * 3 + 2]!;
                if (zi <= PLANTAR_Z_MAX_MM || zj <= PLANTAR_Z_MAX_MM) continue;
                const li = a[i * 3 + 2]! - basePos[i * 3 + 2]!;
                const lj = a[j * 3 + 2]! - basePos[j * 3 + 2]!;
                maxAdj = Math.max(maxAdj, Math.abs(li - lj));
            }
        }
        const preNorm =
            PRECHANGE_GROUND_BAND.wallRampMaxAdjLiftAt7 / PRECHANGE_GROUND_BAND.prechangeExpectedLiftAt7;
        const postNorm = maxAdj / expectedLift;
        // Equal shape within float64/float32 division noise (≪ 1e-6 relative).
        expect(postNorm).toBeLessThanOrEqual(preNorm + 1e-6);

        mod.dispose();
        raw.dispose();
    });

    test("asymmetric L/R thickness: top submesh bit-identical for same side+field path", async () => {
        // Viewer and export both call applyBaseModifiers(base, baseModifierField(...), …)
        // with the same per-side thickness — bit-parity of top positions.
        const raw = await loadRawDefault();
        const topN = (raw.userData as { topVertexCount: number }).topVertexCount;
        const leftA = applyBaseModifiers(raw, thicknessField(2.0, "left"), 0);
        const leftB = applyBaseModifiers(raw, thicknessField(2.0, "left"), 0);
        const rightA = applyBaseModifiers(raw, thicknessField(5.0, "right"), 0);
        const rightB = applyBaseModifiers(raw, thicknessField(5.0, "right"), 0);
        const la = leftA.getAttribute("position")!.array as Float32Array;
        const lb = leftB.getAttribute("position")!.array as Float32Array;
        const ra = rightA.getAttribute("position")!.array as Float32Array;
        const rb = rightB.getAttribute("position")!.array as Float32Array;
        for (let i = 0; i < topN * 3; i++) {
            expect(Object.is(la[i], lb[i])).toBe(true);
            expect(Object.is(ra[i], rb[i])).toBe(true);
        }
        // Differing thickness must not collapse to the same top sheet.
        let differ = false;
        for (let i = 0; i < topN; i++) {
            if (!Object.is(la[i * 3 + 2], ra[i * 3 + 2])) {
                differ = true;
                break;
            }
        }
        expect(differ).toBe(true);
        leftA.dispose();
        leftB.dispose();
        rightA.dispose();
        rightB.dispose();
        raw.dispose();
    });

    test("thickness does not change achieved skive depth, wedge angle, or heel lift", async () => {
        const raw = await loadRawDefault();
        const topN = (raw.userData as { topVertexCount: number }).topVertexCount;
        const corrections: SideCorrections = {
            ...zeroCorrections(),
            medialSkiveMm: 4,
            skiveAngleDeg: 15,
            skiveLocationPct: 50,
            rearfootWedge: { side: "medial", value: 3, unit: "mm" },
            heelLiftMm: 6,
        };

        const fieldAt = (t: number): HeightFieldParams => ({
            side: "left",
            lengthMm: 266,
            widthMm: 95,
            thicknessMm: t,
            corrections,
            elements: [],
            includeSkives: false,
            includeElements: true,
            trimline: null,
        });

        // Compare relative top deltas (corrections-only) across thickness by
        // subtracting the thickness-only raise at the same verts.
        const baseAt = (t: number) => applyBaseModifiers(raw, thicknessField(t, "left"), 0);
        const corrAt = (t: number) => applyBaseModifiers(raw, fieldAt(t), 0);

        const tA = 3.0;
        const tB = 5.0;
        const plainA = baseAt(tA);
        const plainB = baseAt(tB);
        const fullA = corrAt(tA);
        const fullB = corrAt(tB);
        // Apply skive post-path: applyBaseModifiers already applies Kirby when
        // includeSkives false strips from F then raises post-sync — field has
        // includeSkives false; skive raise still runs from field.corrections.
        const pA = plainA.getAttribute("position")!.array as Float32Array;
        const pB = plainB.getAttribute("position")!.array as Float32Array;
        const fA = fullA.getAttribute("position")!.array as Float32Array;
        const fB = fullB.getAttribute("position")!.array as Float32Array;

        let maxCorrDeltaDiff = 0;
        for (let i = 0; i < topN; i++) {
            const corrLiftA = fA[i * 3 + 2]! - pA[i * 3 + 2]!;
            const corrLiftB = fB[i * 3 + 2]! - pB[i * 3 + 2]!;
            maxCorrDeltaDiff = Math.max(maxCorrDeltaDiff, Math.abs(corrLiftA - corrLiftB));
        }
        // Corrections contribution must be thickness-invariant within numerical noise.
        expect(maxCorrDeltaDiff).toBeLessThan(1e-3);

        plainA.dispose();
        plainB.dispose();
        fullA.dispose();
        fullB.dispose();
        raw.dispose();
    });
});
