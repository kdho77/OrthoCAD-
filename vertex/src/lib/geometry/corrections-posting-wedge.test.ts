// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    correctionDeltaAt,
    getBaseFootprintFrame,
    neutralField as neutralHeightField,
    validateBaseResult,
    vertexFootprintAt,
    wedgeMmAtBaseVertex,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { heightAt } from "@/lib/geometry/height-field";
import { deriveNativeShellThicknessDatum } from "@/lib/geometry/native-shell-thickness";
import { generatedMinWallMm } from "@/lib/geometry/procedural-wall/metrics";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { effectiveOutlineHalfWidth } from "@/lib/geometry/trimline";
import { getForefootFactor, wedgeDeltaAt } from "@/lib/geometry/wedge";
import { mirrorGeometry } from "@/lib/library/loaders";
import { defaultDesign } from "@/stores/design-store";
import type { Side, SideCorrections } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const WEDGE_LIFT_TOL_MM = 0.01;
const SLOPE_RATIO_SLACK = 0.15;
const FOREFOOT_RAMP_BORDER_SLOPE_MAX = 0.36;

function zeroCorrections(): SideCorrections {
    return {
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
}

function fieldFromSampleTop(
    raw: BufferGeometry,
    side: Side,
    corrections: SideCorrections,
): HeightFieldParams {
    const frame = getBaseFootprintFrame(raw, side);
    return {
        side,
        lengthMm: frame.lenSize,
        widthMm: frame.widSize,
        thicknessMm: 3,
        corrections,
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

function wedgeSlopeAndFlips(
    geo: BufferGeometry,
    base: BufferGeometry,
    thickAxis: number,
): { maxRatio: number; flippedNormals: number } {
    const posAttr = geo.getAttribute("position");
    const baseAttr = base.getAttribute("position");
    const index = geo.getIndex();
    if (!posAttr || !baseAttr || !index) {
        return { maxRatio: 0, flippedNormals: 0 };
    }
    const p = posAttr.array as Float32Array;
    const b = baseAttr.array as Float32Array;
    const idx = index.array;
    let maxRatio = 0;
    let flippedNormals = 0;
    const normalOf = (arr: Float32Array, f: number): [number, number, number] => {
        const v = [idx[f]!, idx[f + 1]!, idx[f + 2]!];
        const A = v[0]!;
        const B = v[1]!;
        const C = v[2]!;
        const ux = arr[B * 3]! - arr[A * 3]!;
        const uy = arr[B * 3 + 1]! - arr[A * 3 + 1]!;
        const uz = arr[B * 3 + 2]! - arr[A * 3 + 2]!;
        const vx = arr[C * 3]! - arr[A * 3]!;
        const vy = arr[C * 3 + 1]! - arr[A * 3 + 1]!;
        const vz = arr[C * 3 + 2]! - arr[A * 3 + 2]!;
        return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    };
    for (let t = 0; t < idx.length; t += 3) {
        const n0 = normalOf(b, t);
        const n1 = normalOf(p, t);
        if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < 0) flippedNormals++;
        const verts = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
        for (let k = 0; k < 3; k++) {
            const a = verts[k]!;
            const c = verts[(k + 1) % 3]!;
            const ex = b[a * 3]! - b[c * 3]!;
            const ey = b[a * 3 + 1]! - b[c * 3 + 1]!;
            const ez = b[a * 3 + 2]! - b[c * 3 + 2]!;
            const len = Math.hypot(ex, ey, ez);
            if (len < 1e-6) continue;
            const dz = Math.abs(p[a * 3 + thickAxis]! - p[c * 3 + thickAxis]!);
            maxRatio = Math.max(maxRatio, dz / len);
        }
    }
    return { maxRatio, flippedNormals };
}

function baseParams(side: Side, corrections: SideCorrections): HeightFieldParams {
    return {
        side,
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections,
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

function maxForefootLateralBorderLiftMm(
    raw: BufferGeometry,
    composed: BufferGeometry,
    neutral: BufferGeometry,
    side: Side,
    field: HeightFieldParams,
    targetU = 0.88,
): number {
    const frame = getBaseFootprintFrame(raw, side);
    const basePos = raw.getAttribute("position")?.array as Float32Array;
    const pos = composed.getAttribute("position")?.array as Float32Array;
    const neu = neutral.getAttribute("position")?.array as Float32Array;
    if (!basePos || !pos || !neu) return 0;
    const ta = frame.thickAxis;
    const n = basePos.length / 3;
    const lateralV = side === "right" ? 0.98 : -0.98;
    let bestLift = 0;
    for (let vi = 0; vi < n; vi++) {
        const { u, vSigned } = vertexFootprintAt(frame, basePos, vi);
        if (u < targetU - 0.04 || u > targetU + 0.04) continue;
        if (Math.abs(vSigned - lateralV) > 0.12) continue;
        const expected = wedgeMmAtBaseVertex(raw, field, vi);
        if (expected < 0.01) continue;
        const lift = pos[vi * 3 + ta]! - neu[vi * 3 + ta]!;
        expect(Math.abs(lift - expected)).toBeLessThanOrEqual(0.1);
        bestLift = Math.max(bestLift, lift);
    }
    return bestLift;
}

/** Border lift at the mesh vertex closest to (targetU, lateral rim v). */
function forefootLateralBorderLiftNearest(
    raw: BufferGeometry,
    composed: BufferGeometry,
    neutral: BufferGeometry,
    side: Side,
    field: HeightFieldParams,
    targetU = 0.88,
    targetV = side === "right" ? 0.98 : -0.98,
): number {
    const frame = getBaseFootprintFrame(raw, side);
    const basePos = raw.getAttribute("position")?.array as Float32Array;
    const pos = composed.getAttribute("position")?.array as Float32Array;
    const neu = neutral.getAttribute("position")?.array as Float32Array;
    if (!basePos || !pos || !neu) return 0;
    const ta = frame.thickAxis;
    const n = basePos.length / 3;
    let bestVi = -1;
    let bestDist = Infinity;
    for (let vi = 0; vi < n; vi++) {
        const { u, vSigned } = vertexFootprintAt(frame, basePos, vi);
        const dist = (u - targetU) ** 2 + (vSigned - targetV) ** 2;
        if (dist < bestDist) {
            bestDist = dist;
            bestVi = vi;
        }
    }
    if (bestVi < 0) return 0;
    const expected = wedgeMmAtBaseVertex(raw, field, bestVi);
    const lift = pos[bestVi * 3 + ta]! - neu[bestVi * 3 + ta]!;
    expect(Math.abs(lift - expected)).toBeLessThanOrEqual(0.1);
    return lift;
}

function maxSlopeRatioInUBand(
    geo: BufferGeometry,
    base: BufferGeometry,
    frame: ReturnType<typeof getBaseFootprintFrame>,
    thickAxis: number,
    uMin: number,
    uMax: number,
): number {
    const posAttr = geo.getAttribute("position");
    const baseAttr = base.getAttribute("position");
    const index = geo.getIndex();
    if (!posAttr || !baseAttr || !index) return 0;
    const p = posAttr.array as Float32Array;
    const b = baseAttr.array as Float32Array;
    const idx = index.array;
    const seen = new Set<string>();
    let maxRatio = 0;
    for (let t = 0; t < idx.length; t += 3) {
        const pairs = [
            [idx[t]!, idx[t + 1]!],
            [idx[t + 1]!, idx[t + 2]!],
            [idx[t + 2]!, idx[t]!],
        ];
        for (const [a, c] of pairs) {
            const key = a < c ? `${a},${c}` : `${c},${a}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const ua = vertexFootprintAt(frame, b, a).u;
            const uc = vertexFootprintAt(frame, b, c).u;
            if (ua < uMin || ua > uMax || uc < uMin || uc > uMax) continue;
            const ex = b[a * 3]! - b[c * 3]!;
            const ey = b[a * 3 + 1]! - b[c * 3 + 1]!;
            const ez = b[a * 3 + 2]! - b[c * 3 + 2]!;
            const len = Math.hypot(ex, ey, ez);
            if (len < 1e-6) continue;
            const dz = Math.abs(p[a * 3 + thickAxis]! - p[c * 3 + thickAxis]!);
            maxRatio = Math.max(maxRatio, dz / len);
        }
    }
    return maxRatio;
}

function maxForefootBorderLiftSlopeMmPerMm(
    field: HeightFieldParams,
    side: Side,
    uMin: number,
    uMax: number,
): number {
    const vLat = side === "right" ? 0.98 : -0.98;
    const params = {
        lengthMm: field.lengthMm,
        widthMm: field.widthMm,
        trimline: field.trimline ?? null,
    };
    const steps = 160;
    let maxSlope = 0;
    let prevU = uMin;
    let prevLift = wedgeDeltaAt(prevU, vLat, side, field.corrections, params);
    for (let i = 1; i <= steps; i++) {
        const u = uMin + (i / steps) * (uMax - uMin);
        const lift = wedgeDeltaAt(u, vLat, side, field.corrections, params);
        const ds = (u - prevU) * field.lengthMm;
        if (ds > 1e-6) {
            maxSlope = Math.max(maxSlope, Math.abs(lift - prevLift) / ds);
        }
        prevU = u;
        prevLift = lift;
    }
    return maxSlope;
}

/** GLB-style layout: [top sheet][bottom sheet] in one buffer (test fixture). */
function makeMultiMeshWedgeBase(lengthMm = 260, widthMm = 90, thickMm = 20): BufferGeometry {
    const nx = 32;
    const ny = 12;
    const positions: number[] = [];
    const thickAxis = 2;
    const lengthAxis = 1;
    const widthAxis = 0;
    for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
            const u = i / nx;
            const v = (j / ny - 0.5) * 2;
            const coords = [0, 0, 0];
            coords[lengthAxis] = u * lengthMm;
            coords[widthAxis] = v * (widthMm / 2);
            coords[thickAxis] = thickMm * (0.2 + 0.8 * (1 - v * v * 0.3));
            positions.push(coords[0]!, coords[1]!, coords[2]!);
        }
    }
    const topCount = positions.length / 3;
    const topPositions = new Float32Array(positions);
    const bottomPositions = new Float32Array(topCount * 3);
    for (let i = 0; i < topCount; i++) {
        bottomPositions[i * 3] = topPositions[i * 3]!;
        bottomPositions[i * 3 + 1] = topPositions[i * 3 + 1]!;
        bottomPositions[i * 3 + 2] = topPositions[i * 3 + 2]!;
        bottomPositions[i * 3 + thickAxis] = 0;
    }
    const combined = new Float32Array(topCount * 6);
    combined.set(topPositions, 0);
    combined.set(bottomPositions, topCount * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(combined, 3));
    geometry.userData = { isMultiMeshBase: true, topVertexCount: topCount };
    geometry.computeVertexNormals();
    return geometry;
}

async function runForefootTearChecks(
    raw: BufferGeometry,
    field: HeightFieldParams,
    side: Side,
    rampU0 = 0.3,
    rampU1 = 0.58,
): Promise<number> {
    const neutralField = baseParams(side, zeroCorrections());
    const composed = await composePrintSolidTop(raw, { sourceField: field });
    const neutral = await composePrintSolidTop(raw, { sourceField: neutralField });
    const fw = field.corrections.forefootWedge;
    let borderLiftDeg = 0;
    if (fw && fw.unit === "deg" && fw.value > 0) {
        borderLiftDeg = forefootLateralBorderLiftNearest(raw, composed, neutral, side, field, 0.88);
        borderLiftDeg = Math.max(
            borderLiftDeg,
            maxForefootLateralBorderLiftMm(raw, composed, neutral, side, field, 0.88),
        );
    }
    const frame = getBaseFootprintFrame(raw, side);
    const ta = frame.thickAxis;
    const basePos = raw.getAttribute("position")!.array as Float32Array;
    const pos = composed.getAttribute("position")!.array as Float32Array;
    const neu = neutral.getAttribute("position")!.array as Float32Array;
    const n = basePos.length / 3;
    let worstLiftErr = 0;
    for (let i = 0; i < n; i++) {
        const expected = wedgeMmAtBaseVertex(raw, field, i);
        const lift = pos[i * 3 + ta]! - neu[i * 3 + ta]!;
        worstLiftErr = Math.max(worstLiftErr, Math.abs(lift - expected));
    }
    const wedgedSlope = wedgeSlopeAndFlips(composed, raw, ta);
    const neutralSlope = wedgeSlopeAndFlips(neutral, raw, ta);
    const rampWedged = maxSlopeRatioInUBand(composed, raw, frame, ta, rampU0, rampU1);
    const rampNeutral = maxSlopeRatioInUBand(neutral, raw, frame, ta, rampU0, rampU1);
    composed.dispose();
    neutral.dispose();
    expect(worstLiftErr).toBeLessThanOrEqual(WEDGE_LIFT_TOL_MM);
    expect(wedgedSlope.maxRatio).toBeLessThanOrEqual(neutralSlope.maxRatio + SLOPE_RATIO_SLACK);
    expect(rampWedged).toBeLessThanOrEqual(rampNeutral + SLOPE_RATIO_SLACK);
    expect(wedgedSlope.flippedNormals).toBe(0);
    return borderLiftDeg;
}

describe("posting wedge (design viewer height field)", () => {
    test("forefoot wedge envelope — C1 smoothstep 0.30..0.58", () => {
        expect(getForefootFactor(0.3)).toBeCloseTo(0, 6);
        expect(getForefootFactor(0.29)).toBeCloseTo(0, 6);
        expect(Math.abs(getForefootFactor(0.44) - 0.5)).toBeLessThanOrEqual(0.01);
        for (const u of [0.58, 0.62, 0.72, 0.9]) {
            expect(getForefootFactor(u)).toBeCloseTo(1, 6);
        }
    });

    test("forefoot lateral 10° — border ramp slope ≤0.36 mm/mm on u 0.30–0.58 (both feet)", () => {
        const wedge = { side: "lateral" as const, value: 10, unit: "deg" as const };
        for (const side of ["left", "right"] as Side[]) {
            const field = baseParams(side, { ...zeroCorrections(), forefootWedge: wedge });
            const slope = maxForefootBorderLiftSlopeMmPerMm(field, side, 0.3, 0.58);
            expect(slope).toBeLessThanOrEqual(FOREFOOT_RAMP_BORDER_SLOPE_MAX);
        }
    });

    test("STEP 0: rearfoot lateral 10 mm z lift at heel (right)", () => {
        const wedge = { side: "lateral" as const, value: 10, unit: "mm" as const };
        const p = baseParams("right", { ...zeroCorrections(), rearfootWedge: wedge });
        const p0 = baseParams("right", zeroCorrections());
        const u = 0.1;
        const lateralEdge = 0.98;
        const medialEdge = -0.98;

        const delta = (v: number) => heightAt(u, v, p) - heightAt(u, v, p0);
        const dLat = delta(lateralEdge);
        const dMed = delta(medialEdge);
        const dLatHeel = delta(0.5);
        const dMedHeel = delta(-0.5);

        expect(dLat).toBeCloseTo(10, 0.5);
        expect(dMed).toBeCloseTo(0, 0.5);
        expect(dLatHeel).toBeCloseTo(7.5, 1.0);
        expect(dMedHeel).toBeCloseTo(2.5, 1.0);
    });

    test("rearfoot lateral 10 mm — left foot border +10, low edge 0", () => {
        const wedge = { side: "lateral" as const, value: 10, unit: "mm" as const };
        const p = baseParams("left", { ...zeroCorrections(), rearfootWedge: wedge });
        const p0 = baseParams("left", zeroCorrections());
        const u = 0.1;
        const dLat = heightAt(u, -0.98, p) - heightAt(u, -0.98, p0);
        const dMedEdge = heightAt(u, 0.98, p) - heightAt(u, 0.98, p0);
        expect(dLat).toBeCloseTo(10, 0.5);
        expect(dMedEdge).toBeCloseTo(0, 0.5);
    });

    test("forefoot lateral 5.5 mm raises lateral border (right)", () => {
        const wedge = { side: "lateral" as const, value: 5.5, unit: "mm" as const };
        const p = baseParams("right", { ...zeroCorrections(), forefootWedge: wedge });
        const p0 = baseParams("right", zeroCorrections());
        const u = 0.88;
        const dLat = heightAt(u, 0.98, p) - heightAt(u, 0.98, p0);
        const dMed = heightAt(u, -0.98, p) - heightAt(u, -0.98, p0);
        expect(dLat).toBeGreaterThan(4.5);
        expect(dMed).toBeLessThan(0.2);
    });

    test("forefoot 10° — border height and slope match tan(10°)", () => {
        const wedge = { side: "lateral" as const, value: 10, unit: "deg" as const };
        const p = baseParams("right", { ...zeroCorrections(), forefootWedge: wedge });
        const vLat = 0.98;
        const vMed = -0.98;
        const tan10 = Math.tan((10 * Math.PI) / 180);
        for (const u of [0.62, 0.9]) {
            const zone = getForefootFactor(u);
            expect(zone).toBeCloseTo(1, 5);
            const hw = effectiveOutlineHalfWidth(u, p.lengthMm, p.widthMm, null);
            const localFullWidth = 2 * hw * (p.widthMm / 2);
            const borderRaise = wedgeDeltaAt(u, vLat, "right", p.corrections, p);
            expect(borderRaise).toBeGreaterThan(localFullWidth * tan10 - 0.1);
            expect(borderRaise).toBeLessThan(localFullWidth * tan10 + 0.1);
        }
        const u = 0.88;
        const zone = getForefootFactor(u);
        const hw = effectiveOutlineHalfWidth(u, p.lengthMm, p.widthMm, null);
        const localFullWidth = 2 * hw * (p.widthMm / 2);
        const borderRaise = wedgeDeltaAt(u, vLat, "right", p.corrections, p);
        expect(borderRaise).toBeCloseTo(localFullWidth * tan10 * zone, 0.1);
        const slope =
            (wedgeDeltaAt(u, vLat, "right", p.corrections, p) -
                wedgeDeltaAt(u, vMed, "right", p.corrections, p)) /
            (localFullWidth * 0.98 * 2 * zone);
        expect(slope).toBeCloseTo(tan10, 0.005);
    });

    test("arch height −10 and +14 mm at apex", () => {
        const low = baseParams("right", { ...zeroCorrections(), archHeightMm: -10 });
        const high = baseParams("right", { ...zeroCorrections(), archHeightMm: 14 });
        const neutral = baseParams("right", zeroCorrections());
        let apexZ = 0;
        let apexU = 0.42;
        let apexV = -0.55;
        for (let ui = 0.3; ui <= 0.55; ui += 0.02) {
            for (let vi = -0.9; vi <= -0.2; vi += 0.05) {
                const z = heightAt(ui, vi, high);
                if (z > apexZ) {
                    apexZ = z;
                    apexU = ui;
                    apexV = vi;
                }
            }
        }
        const apexNeutral = heightAt(apexU, apexV, neutral);
        expect(apexZ - apexNeutral).toBeGreaterThan(13);
        expect(apexZ - apexNeutral).toBeLessThan(15);
        expect(apexZ).toBeGreaterThan(30);
        expect(heightAt(apexU, apexV, low)).toBeLessThan(apexNeutral);
    });

    test("arch ease is zero at the medial trim rim (right foot v=-0.98)", () => {
        const ease = baseParams("right", { ...zeroCorrections(), archEaseMm: 6 });
        const plain = baseParams("right", zeroCorrections());
        const u = 0.42;
        const medialRimV = -0.98;
        expect(heightAt(u, medialRimV, ease) - heightAt(u, medialRimV, plain)).toBeLessThan(0.05);
        const interior = heightAt(u, -0.35, ease) - heightAt(u, -0.35, plain);
        expect(interior).toBeLessThan(-1);
    });

    test("arch ease lowers medial arch in heightAt and composePrintSolidTop", async () => {
        const u = 0.42;
        const v = -0.35;
        const withEase = baseParams("right", { ...zeroCorrections(), archHeightMm: 8, archEaseMm: 3 });
        const plain = baseParams("right", { ...zeroCorrections(), archHeightMm: 8 });
        expect(heightAt(u, v, withEase)).toBeLessThan(heightAt(u, v, plain) - 0.5);

        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const field = baseParams("right", { ...zeroCorrections(), archEaseMm: 3 });
        const composed = await composePrintSolidTop(raw, { sourceField: field });
        const neutral = await composePrintSolidTop(raw, {
            sourceField: baseParams("right", zeroCorrections()),
        });
        const pos = composed.getAttribute("position");
        const neuPos = neutral.getAttribute("position");
        let maxDrop = 0;
        if (pos && neuPos) {
            for (let i = 0; i < pos.count; i++) {
                maxDrop = Math.max(maxDrop, neuPos.getZ(i) - pos.getZ(i));
            }
        }
        composed.dispose();
        neutral.dispose();
        raw.dispose();
        expect(maxDrop).toBeGreaterThan(0.5);
    });

    test("composePrintSolidTop forefoot lateral 5.5 mm border rise (F02)", async () => {
        const wedge = { side: "lateral" as const, value: 5.5, unit: "mm" as const };
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const field = baseParams("right", { ...zeroCorrections(), forefootWedge: wedge });
        const neutralFieldParams = baseParams("right", zeroCorrections());
        const frame = getBaseFootprintFrame(raw, "right");
        raw.computeBoundingBox();
        const bb = raw.boundingBox!;
        const composed = await composePrintSolidTop(raw, { sourceField: field });
        const neutralGeo = await composePrintSolidTop(raw, { sourceField: neutralFieldParams });
        const basePos = raw.getAttribute("position")?.array as Float32Array;
        const pos = composed.getAttribute("position")?.array as Float32Array;
        const neu = neutralGeo.getAttribute("position")?.array as Float32Array;
        const ta = frame.thickAxis;
        const wedgeMm = field.corrections.forefootWedge?.value ?? 5.5;
        const neutralH = neutralHeightField(field);
        let maxBorderLift = 0;
        let maxWedgeMm = 0;
        for (let vi = 0; vi < (basePos?.length ?? 0) / 3; vi++) {
            const wmm = wedgeMmAtBaseVertex(raw, field, vi);
            if (wmm > maxWedgeMm) maxWedgeMm = wmm;
            if (wmm < wedgeMm * 0.85) continue;
            const lift = pos![vi * 3 + ta]! - neu![vi * 3 + ta]!;
            maxBorderLift = Math.max(maxBorderLift, lift);
        }
        const analyticBorder = heightAt(0.88, 0.98, field) - heightAt(0.88, 0.98, neutralFieldParams);
        composed.dispose();
        neutralGeo.dispose();
        raw.dispose();
        expect(
            maxBorderLift,
            `borderLift=${maxBorderLift} maxWedgeMm=${maxWedgeMm} analytic=${analyticBorder}`,
        ).toBeGreaterThan(5.4);
        expect(maxBorderLift).toBeLessThan(5.6);
    });

    test("forefoot lateral 6.5 mm via design store field matches border lift", async () => {
        const wedge = { side: "lateral" as const, value: 6.5, unit: "mm" as const };
        const design = defaultDesign();
        design.corrections.right = { ...design.corrections.right, forefootWedge: wedge };
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const field = baseModifierField(design, "right", design.thicknessMm);
        const neutralField = baseModifierField(
            { ...design, corrections: { ...design.corrections, right: zeroCorrections() } },
            "right",
            design.thicknessMm,
        );
        const composed = await composePrintSolidTop(raw, { sourceField: field });
        const neutral = await composePrintSolidTop(raw, { sourceField: neutralField });
        const frame = getBaseFootprintFrame(raw, "right");
        const basePos = raw.getAttribute("position")?.array as Float32Array;
        const pos = composed.getAttribute("position")?.array as Float32Array;
        const neu = neutral.getAttribute("position")?.array as Float32Array;
        const ta = frame.thickAxis;
        let maxWedgeLift = 0;
        for (let vi = 0; vi < (basePos?.length ?? 0) / 3; vi++) {
            const wmm = wedgeMmAtBaseVertex(raw, field, vi);
            if (wmm < 6.5 * 0.85) continue;
            const lift = pos![vi * 3 + ta]! - neu![vi * 3 + ta]!;
            maxWedgeLift = Math.max(maxWedgeLift, lift);
        }
        composed.dispose();
        neutral.dispose();
        raw.dispose();
        expect(maxWedgeLift).toBeGreaterThan(6.4);
        expect(maxWedgeLift).toBeLessThan(6.6);
    });

    test("archHeight -10 with ease 6 — walled preview S1 min-wall + wall-top gates", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const field = baseParams("right", {
            ...zeroCorrections(),
            archHeightMm: -10,
            archEaseMm: 6,
        });
        const preview = await reconstructProceduralPreview(raw, {
            sourceField: field,
            composedTop: true,
            corrections: field.corrections,
            wallStyle: "straight",
            scanPattern: "full_contact",
        });
        const ud = preview.geometry.userData as {
            loftN?: number;
            minLastRowHeightMm?: number;
            maxChordRiseDeg?: number;
        };
        expect(ud.loftN ?? 0).toBeGreaterThan(3);
        expect(preview.geometry.getAttribute("position")?.count ?? 0).toBeGreaterThan(1000);
        expect(ud.maxChordRiseDeg ?? 90).toBeLessThanOrEqual(6.5);
        expect(generatedMinWallMm(preview.geometry)).toBeGreaterThanOrEqual(0.75);
        expect(ud.maxChordRiseDeg ?? 0).toBeLessThanOrEqual(6);
        preview.geometry.dispose();
        raw.dispose();
    }, 180_000);

    for (const wedgeSpec of [
        { value: 6.5, unit: "deg" as const },
        { value: 10, unit: "mm" as const },
    ]) {
        for (const side of ["left", "right"] as Side[]) {
            test(`forefoot lateral ${wedgeSpec.value}${wedgeSpec.unit} ${side} — wedge lift, slope, normals`, async () => {
                const wedge = {
                    side: "lateral" as const,
                    value: wedgeSpec.value,
                    unit: wedgeSpec.unit,
                };
                const buf = readFileSync(SAMPLE_TOP_PATH);
                let raw = await sampleTopFromArrayBuffer(
                    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
                );
                if (side === "left") {
                    const mirrored = mirrorGeometry(raw);
                    raw.dispose();
                    raw = mirrored;
                }
                const field = baseParams(side, { ...zeroCorrections(), forefootWedge: wedge });
                const borderLift = await runForefootTearChecks(raw, field, side);
                if (wedgeSpec.unit === "deg" && wedgeSpec.value === 6.5) {
                    // Border lift vs wedgeMmAtBaseVertex (≤0.1 mm) is checked in runForefootTearChecks.
                    expect(borderLift).toBeGreaterThan(0.2);
                }
                raw.dispose();
            }, 180_000);
        }
    }

    const combinedWedgeCases = [
        {
            label: "rearfoot lateral 10 mm + forefoot lateral 10°",
            rearfootWedge: { side: "lateral" as const, value: 10, unit: "mm" as const },
            forefootWedge: { side: "lateral" as const, value: 10, unit: "deg" as const },
        },
        {
            label: "rearfoot medial 10 mm + forefoot lateral 10°",
            rearfootWedge: { side: "medial" as const, value: 10, unit: "mm" as const },
            forefootWedge: { side: "lateral" as const, value: 10, unit: "deg" as const },
        },
    ];

    for (const combo of combinedWedgeCases) {
        for (const side of ["left", "right"] as Side[]) {
            test(`combined wedges ${side} — ${combo.label}`, async () => {
                const corrections: SideCorrections = {
                    ...zeroCorrections(),
                    rearfootWedge: combo.rearfootWedge,
                    forefootWedge: combo.forefootWedge,
                };
                const buf = readFileSync(SAMPLE_TOP_PATH);
                let raw = await sampleTopFromArrayBuffer(
                    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
                );
                if (side === "left") {
                    const mirrored = mirrorGeometry(raw);
                    raw.dispose();
                    raw = mirrored;
                }
                const field = baseParams(side, corrections);
                const fieldRearOnly: HeightFieldParams = {
                    ...field,
                    corrections: { ...corrections, forefootWedge: undefined },
                };
                const fieldForeOnly: HeightFieldParams = {
                    ...field,
                    corrections: { ...corrections, rearfootWedge: undefined },
                };
                const basePos = raw.getAttribute("position")!.array as Float32Array;
                const n = basePos.length / 3;
                for (let i = 0; i < n; i++) {
                    const total = wedgeMmAtBaseVertex(raw, field, i);
                    const rear = wedgeMmAtBaseVertex(raw, fieldRearOnly, i);
                    const fore = wedgeMmAtBaseVertex(raw, fieldForeOnly, i);
                    expect(Math.abs(total - (rear + fore))).toBeLessThanOrEqual(WEDGE_LIFT_TOL_MM);
                }

                await runForefootTearChecks(raw, field, side);

                const multiBase = makeMultiMeshWedgeBase();
                const multiField = {
                    ...field,
                    thicknessMm:
                        deriveNativeShellThicknessDatum(multiBase)?.nativeMinClearanceMm ??
                        BASE_REFERENCE_THICKNESS_MM,
                };
                const modified = applyBaseModifiers(multiBase, multiField, 0);
                const report = validateBaseResult(multiBase, modified);
                expect(report.maxBottomDeltaMm).toBeLessThan(0.05);
                multiBase.dispose();
                modified.dispose();
                raw.dispose();
            }, 180_000);
        }
    }
});
