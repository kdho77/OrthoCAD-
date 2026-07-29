// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Kirby heel skive — Default.glb integration.
 * T1 sign, T10a crease metrics, T10b bottom invariance (both sync branches),
 * T18 orthogonality under rearfoot wedge, R6c location band, export raise.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import { applySkives } from "@/lib/geometry/base-modifier-booleans";
import { oneThirdLineY, SKIVE_U_REF } from "@/lib/geometry/heel-skive";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { heightAt } from "@/lib/geometry/height-field";
import { deriveNativeShellThicknessDatum } from "@/lib/geometry/native-shell-thickness";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");

/** Option C identity thickness (native min clearance) — see synced-bottom-shell-field. */
let identityThicknessMm = 3;

function neu(): SideCorrections {
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

function field(patch: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "right",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: identityThicknessMm,
        corrections: { ...neu(), ...patch },
        elements: [],
        includeSkives: false,
        includeElements: true,
        trimline: null,
    };
}

interface Frame {
    lengthAxis: number;
    widthAxis: number;
    thickAxis: number;
    lenMin: number;
    lenSize: number;
    topN: number;
    count: number;
}

function resolveFrame(geo: BufferGeometry): Frame {
    const arr = geo.getAttribute("position")!.array as Float32Array;
    const count = arr.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let a = 0; a < 3; a++) {
            const c = arr[i * 3 + a]!;
            if (c < min[a]!) min[a] = c;
            if (c > max[a]!) max[a] = c;
        }
    }
    const sizes: [number, number][] = [
        [0, max[0]! - min[0]!],
        [1, max[1]! - min[1]!],
        [2, max[2]! - min[2]!],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    const thickAxis = sizes[0]![0];
    const widthAxis = sizes[1]![0];
    const lengthAxis = sizes[2]![0];
    const topN = (geo.userData as { topVertexCount?: number }).topVertexCount ?? count;
    return {
        thickAxis,
        widthAxis,
        lengthAxis,
        lenMin: min[lengthAxis]!,
        lenSize: max[lengthAxis]! - min[lengthAxis]! || 1,
        topN,
        count,
    };
}

function copyPositions(geo: BufferGeometry): Float32Array {
    return new Float32Array(geo.getAttribute("position")!.array as Float32Array);
}

function maxAbsRange(a: Float32Array, b: Float32Array, start: number, end: number): number {
    let m = 0;
    for (let i = start; i < end; i++) {
        for (let c = 0; c < 3; c++) {
            m = Math.max(m, Math.abs(a[i * 3 + c]! - b[i * 3 + c]!));
        }
    }
    return m;
}

/** Heel-seat samples near u_ref (exclude high rim walls). */
function seatSamples(
    baseArr: Float32Array,
    modArr: Float32Array,
    frame: Frame,
    uTol = 0.025,
): { y: number; raise: number; z0: number }[] {
    const { lengthAxis, widthAxis, thickAxis, lenMin, lenSize, topN } = frame;
    const raw: { y: number; raise: number; z0: number }[] = [];
    for (let i = 0; i < topN; i++) {
        const u = (baseArr[i * 3 + lengthAxis]! - lenMin) / lenSize;
        if (Math.abs(u - SKIVE_U_REF) > uTol) continue;
        raw.push({
            y: baseArr[i * 3 + widthAxis]!,
            raise: modArr[i * 3 + thickAxis]! - baseArr[i * 3 + thickAxis]!,
            z0: baseArr[i * 3 + thickAxis]!,
        });
    }
    const zs = raw.map((p) => p.z0).sort((a, b) => a - b);
    const zCut = zs[Math.floor(zs.length * 0.55)]!;
    return raw.filter((p) => p.z0 <= zCut).sort((a, b) => a.y - b.y);
}

describe("Kirby heel skive — Default.glb", () => {
    let baseGeo: BufferGeometry;
    let frame: Frame;

    beforeAll(async () => {
        expect(existsSync(FIXTURE)).toBe(true);
        const buf = readFileSync(FIXTURE);
        const group = await loadGlbFromBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const merged = extractMergedGeometry(group);
        expect(merged).not.toBeNull();
        baseGeo = merged!.geometry;
        frame = resolveFrame(baseGeo);
        identityThicknessMm = deriveNativeShellThicknessDatum(baseGeo)!.nativeMinClearanceMm;
        expect(frame.topN).toBeGreaterThan(1000);
    });

    test("T1: medial skive RAISES medial heel seat (+Z); never lowers", () => {
        const baseArr = copyPositions(baseGeo);
        const mod = applyBaseModifiers(baseGeo, field({ medialSkiveMm: 4, skiveAngleDeg: 15 }));
        const modArr = copyPositions(mod);
        const seat = seatSamples(baseArr, modArr, frame, 0.03);
        expect(seat.length).toBeGreaterThan(20);

        let maxRaise = 0;
        let minRaise = Infinity;
        for (const p of seat) {
            if (p.raise > maxRaise) maxRaise = p.raise;
            if (p.raise < minRaise) minRaise = p.raise;
        }
        expect(maxRaise).toBeGreaterThan(1.5);
        expect(minRaise).toBeGreaterThanOrEqual(-0.05);

        const mid = seat[Math.floor(seat.length / 2)]!.y;
        const avg = (arr: typeof seat) => arr.reduce((s, p) => s + p.raise, 0) / arr.length;
        const aLo = avg(seat.filter((p) => p.y <= mid));
        const aHi = avg(seat.filter((p) => p.y > mid));
        expect(Math.max(aLo, aHi)).toBeGreaterThan(Math.min(aLo, aHi) + 0.5);
        mod.dispose();
    });

    test("T10b: bottom mesh invariant under skive — shell sync ACTIVE (width=0)", () => {
        const a = applyBaseModifiers(baseGeo, field({ archHeightMm: 8 }));
        const b = applyBaseModifiers(
            baseGeo,
            field({ archHeightMm: 8, medialSkiveMm: 4, skiveAngleDeg: 15 }),
        );
        expect(maxAbsRange(copyPositions(a), copyPositions(b), frame.topN, frame.count)).toBeLessThanOrEqual(
            1e-6,
        );
        a.dispose();
        b.dispose();
    });

    test("T10b: bottom mesh invariant under skive — legacy rim path ACTIVE (width>0)", () => {
        const a = applyBaseModifiers(baseGeo, field({ heelCupWidthMm: 5, archHeightMm: 6 }));
        const b = applyBaseModifiers(
            baseGeo,
            field({
                heelCupWidthMm: 5,
                archHeightMm: 6,
                medialSkiveMm: 4,
                skiveAngleDeg: 15,
            }),
        );
        expect(maxAbsRange(copyPositions(a), copyPositions(b), frame.topN, frame.count)).toBeLessThanOrEqual(
            1e-6,
        );
        a.dispose();
        b.dispose();
    });

    test("T10a: report crease edge length / plan-view deviation under 4mm medial skive", () => {
        const baseArr = copyPositions(baseGeo);
        const mod = applyBaseModifiers(baseGeo, field({ medialSkiveMm: 4, skiveAngleDeg: 15 }));
        const modArr = copyPositions(mod);
        const { lengthAxis, widthAxis, thickAxis, lenMin, lenSize, topN } = frame;

        const stations = 24;
        const crease: { x: number; y: number }[] = [];
        for (let s = 0; s < stations; s++) {
            const u0 = (s / stations) * 0.28;
            const u1 = ((s + 1) / stations) * 0.28;
            const pts: { y: number; raise: number; x: number }[] = [];
            for (let i = 0; i < topN; i++) {
                const u = (baseArr[i * 3 + lengthAxis]! - lenMin) / lenSize;
                if (u < u0 || u >= u1) continue;
                pts.push({
                    x: baseArr[i * 3 + lengthAxis]!,
                    y: baseArr[i * 3 + widthAxis]!,
                    raise: modArr[i * 3 + thickAxis]! - baseArr[i * 3 + thickAxis]!,
                });
            }
            if (pts.length < 8) continue;
            pts.sort((a, b) => a.y - b.y);
            const avgRaiseLo = pts.slice(0, 3).reduce((a, p) => a + p.raise, 0) / 3;
            const avgRaiseHi = pts.slice(-3).reduce((a, p) => a + p.raise, 0) / 3;
            const ordered = avgRaiseLo >= avgRaiseHi ? pts : [...pts].reverse();
            for (let i = 1; i < ordered.length; i++) {
                if (ordered[i - 1]!.raise >= 0.3 && ordered[i]!.raise < 0.3) {
                    crease.push({ x: ordered[i]!.x, y: ordered[i]!.y });
                    break;
                }
            }
        }
        expect(crease.length).toBeGreaterThan(5);
        crease.sort((a, b) => a.x - b.x);
        let maxEdge = 0;
        for (let i = 1; i < crease.length; i++) {
            maxEdge = Math.max(
                maxEdge,
                Math.hypot(crease[i]!.x - crease[i - 1]!.x, crease[i]!.y - crease[i - 1]!.y),
            );
        }
        const n = crease.length;
        let sX = 0;
        let sY = 0;
        let sXX = 0;
        let sXY = 0;
        for (const p of crease) {
            sX += p.x;
            sY += p.y;
            sXX += p.x * p.x;
            sXY += p.x * p.y;
        }
        const denom = n * sXX - sX * sX || 1;
        const bCoef = (n * sXY - sX * sY) / denom;
        const aCoef = (sY - bCoef * sX) / n;
        let maxDev = 0;
        for (const p of crease) maxDev = Math.max(maxDev, Math.abs(p.y - (aCoef + bCoef * p.x)));
        console.log(
            `[T10a] creaseStations=${n} maxCreaseEdgeMm=${maxEdge.toFixed(3)} maxPlanViewDevMm=${maxDev.toFixed(3)}`,
        );
        expect(maxEdge).toBeLessThan(40);
        expect(maxDev).toBeLessThan(25);
        mod.dispose();
    });

    test("R6c: 3mm medial @ 15° → measured locationPct in 45–65%", () => {
        const mod = applyBaseModifiers(baseGeo, field({ medialSkiveMm: 3, skiveAngleDeg: 15 }));
        const seat = seatSamples(copyPositions(baseGeo), copyPositions(mod), frame);
        expect(seat.length).toBeGreaterThan(20);
        const yMin = seat[0]!.y;
        const yMax = seat[seat.length - 1]!.y;
        const W = yMax - yMin;
        const bins = 32;
        const avgR = new Array(bins).fill(0);
        const cnt = new Array(bins).fill(0);
        for (const s of seat) {
            const b = Math.min(bins - 1, Math.floor(((s.y - yMin) / W) * bins));
            avgR[b] += s.raise;
            cnt[b]++;
        }
        for (let b = 0; b < bins; b++) if (cnt[b]) avgR[b] /= cnt[b];
        let peakB = 0;
        for (let b = 1; b < bins; b++) if (avgR[b]! > avgR[peakB]!) peakB = b;
        const dir = peakB < bins / 2 ? 1 : -1;
        let crossB = peakB;
        for (let b = peakB; b >= 0 && b < bins; b += dir) {
            if (cnt[b] && avgR[b]! <= 0.15) {
                crossB = b;
                break;
            }
            crossB = b;
        }
        const yMed = dir === 1 ? yMin : yMax;
        const yCross = yMin + ((crossB + 0.5) / bins) * W;
        const locationPct = (Math.abs(yCross - yMed) / W) * 100;
        console.log(
            `[R6c] locationPct=${locationPct.toFixed(1)} W=${W.toFixed(2)} peakB=${peakB} crossB=${crossB} peakRaise=${avgR[peakB]!.toFixed(2)}`,
        );
        expect(locationPct).toBeGreaterThanOrEqual(45);
        expect(locationPct).toBeLessThanOrEqual(65);
        mod.dispose();
    });

    test("T18: skive relative to seat invariant under rearfoot wedge 0/5/10°", () => {
        const depthsAtThird: number[] = [];
        const relAngles: number[] = [];

        for (const wDeg of [0, 5, 10]) {
            const patch: Partial<SideCorrections> = {
                medialSkiveMm: 4,
                skiveAngleDeg: 15,
            };
            if (wDeg > 0) patch.rearfootWedge = { side: "medial", value: wDeg, unit: "deg" };

            const pre = applyBaseModifiers(baseGeo, field({ ...patch, medialSkiveMm: 0 }));
            const post = applyBaseModifiers(baseGeo, field(patch));
            const preArr = copyPositions(pre);
            const postArr = copyPositions(post);
            const { lengthAxis, widthAxis, thickAxis, lenMin, lenSize, topN } = frame;

            const raw: { y: number; zPre: number; zPost: number }[] = [];
            for (let i = 0; i < topN; i++) {
                const u = (preArr[i * 3 + lengthAxis]! - lenMin) / lenSize;
                if (Math.abs(u - SKIVE_U_REF) > 0.025) continue;
                raw.push({
                    y: preArr[i * 3 + widthAxis]!,
                    zPre: preArr[i * 3 + thickAxis]!,
                    zPost: postArr[i * 3 + thickAxis]!,
                });
            }
            // Outline edges for W / one-third line (stable under wedge). Seat
            // filter only for relative-tilt regression fit.
            raw.sort((a, b) => a.y - b.y);
            const yMin = raw[0]!.y;
            const yMax = raw[raw.length - 1]!.y;
            const W = yMax - yMin;

            const raiseAt = (y: number, pool: typeof raw) => {
                let best = pool[0]!;
                let bestD = Infinity;
                for (const s of pool) {
                    const d = Math.abs(s.y - y);
                    if (d < bestD) {
                        bestD = d;
                        best = s;
                    }
                }
                return best.zPost - best.zPre;
            };
            const rLo = raiseAt(yMin + 0.15 * W, raw);
            const rHi = raiseAt(yMax - 0.15 * W, raw);
            const medialIsLo = rLo >= rHi;
            const yMed = medialIsLo ? yMin : yMax;
            const yLat = medialIsLo ? yMax : yMin;
            const depthMeas = raiseAt(oneThirdLineY(yMed, yLat, "medial"), raw);
            depthsAtThird.push(depthMeas);

            const zs = raw.map((p) => p.zPre).sort((a, b) => a - b);
            const zCut = zs[Math.floor(zs.length * 0.55)]!;
            const seat = raw.filter((p) => p.zPre <= zCut);
            let sY = 0;
            let sR = 0;
            let sYY = 0;
            let sYR = 0;
            let n = 0;
            for (const s of seat) {
                const r = s.zPost - s.zPre;
                sY += s.y;
                sR += r;
                sYY += s.y * s.y;
                sYR += s.y * r;
                n++;
            }
            const slope = (n * sYR - sY * sR) / (n * sYY - sY * sY || 1);
            const relTilt = Math.abs((Math.atan(slope) * 180) / Math.PI);
            relAngles.push(relTilt);
            console.log(
                `[T18] wedge=${wDeg}° depthAtThird=${depthMeas.toFixed(3)} relTiltDeg=${relTilt.toFixed(2)} rLo=${rLo.toFixed(2)} rHi=${rHi.toFixed(2)}`,
            );
            pre.dispose();
            post.dispose();
        }

        // Orthogonality: depth at outline 1/3-line and seat-relative tilt stable.
        for (const d of depthsAtThird) {
            expect(d).toBeGreaterThan(2.0);
            expect(Math.abs(d - depthsAtThird[0]!)).toBeLessThan(0.75);
        }
        for (const a of relAngles) {
            expect(a).toBeGreaterThan(5);
            expect(Math.abs(a - relAngles[0]!)).toBeLessThan(2.0);
        }
    });

    test("G4: applySkives boolean is a no-op (export cannot cut the raise)", () => {
        const solid = { marker: "solid" } as unknown as import("@chili3d/core").ISolid;
        const out = applySkives(
            {} as never,
            solid,
            { ...neu(), medialSkiveMm: 4 },
            { lengthMm: 266, widthMm: 95, side: "right" },
        );
        expect(out).toBe(solid);
    });

    test("export/parametric path carries RAISE not cut (heightAt includeSkives)", () => {
        const baseParams: HeightFieldParams = {
            side: "right",
            lengthMm: 266,
            widthMm: 95,
            thicknessMm: 3,
            corrections: neu(),
            includeSkives: true,
        };
        const skiveParams: HeightFieldParams = {
            ...baseParams,
            corrections: { ...neu(), medialSkiveMm: 4, skiveAngleDeg: 15 },
        };
        const h0 = heightAt(SKIVE_U_REF, -1, baseParams);
        const h1 = heightAt(SKIVE_U_REF, -1, skiveParams);
        expect(h1 - h0).toBeGreaterThan(1.0);
        const h0L = heightAt(SKIVE_U_REF, 1, baseParams);
        const h1L = heightAt(SKIVE_U_REF, 1, skiveParams);
        expect(h1 - h0).toBeGreaterThan(h1L - h0L);
    });

    test("vertex count / topology unchanged (H1 guard)", () => {
        const mod = applyBaseModifiers(baseGeo, field({ medialSkiveMm: 4, skiveAngleDeg: 15 }));
        expect(mod.getAttribute("position")!.count).toBe(frame.count);
        expect(mod.getIndex()?.count).toBe(baseGeo.getIndex()?.count);
        mod.dispose();
    });
});
