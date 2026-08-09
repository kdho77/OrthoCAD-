// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Arch↔heel blend gate:
 *  1) Medial sidewall at the re-loft handoff (u ∈ [0.24, 0.40]) — Gaussian
 *     rim-delta blend + C2 quintic α(u) + unified W(h).
 *  2) Top-view medial planform — heel-width envelope must ease through the
 *     blend (not die at u≈0.28) so the outline does not kink under
 *     arch18 + narrow + proximal apex.
 */
import { describe, expect, test } from "@rstest/core";
import {
    ARCH_WALL_RELOFT_U0,
    ARCH_WALL_RELOFT_U1,
    applyBaseModifiers,
    archWallReloftAlpha,
    PLANTAR_Z_MAX_MM,
    RIM_DELTA_SIGMA_BASE_MM,
    RIM_DELTA_SIGMA_TOP_MM,
    rimDeltaBlendSigmaMm,
} from "@/lib/geometry/base-modifier";
import {
    HEEL_CUP_WIDTH_ENV_CENTER,
    HEEL_CUP_WIDTH_ENV_RADIUS,
    type HeightFieldParams,
    heelCupWidthLongitudinalEnvelope,
} from "@/lib/geometry/height-field";
import { extractOrderedBoundaryLoopWithIndices, submeshByVertexRange } from "@/lib/geometry/mesh-close";
import type { SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";

/** Top medial crest planform: sum of turning angles in the blend band (deg). */
const MAX_PLANFORM_BLEND_TURN_SUM_DEG = 22;
/** Legacy short envelope died at 0.28 — width envelope must still be live there. */
const MIN_WIDTH_ENV_AT_HANDOFF = 0.25;
/** Min outward travel (mm) over an 8 mm height window on the medial wall at the
 * arch↔heel junction — guards "rounded then straight up" after heel narrowing. */
const MIN_JUNCTION_OUTWARD_TRAVEL_MM = 1.2;

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

function makeField(c: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 2,
        corrections: { ...neutralCorrections(), ...c },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

function faceNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] {
    const ax = pos[a * 3]!,
        ay = pos[a * 3 + 1]!,
        az = pos[a * 3 + 2]!;
    const ux = pos[b * 3]! - ax,
        uy = pos[b * 3 + 1]! - ay,
        uz = pos[b * 3 + 2]! - az;
    const vx = pos[c * 3]! - ax,
        vy = pos[c * 3 + 1]! - ay,
        vz = pos[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
}

function dihedralDeg(n1: [number, number, number], n2: [number, number, number]): number {
    return (
        (Math.acos(Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]))) * 180) / Math.PI
    );
}

/** Max edges in the arch↔heel band allowed to worsen ≥5°. */
const MAX_BLEND_BANDED = 6;
const BAND_WORSENING_DEG = 5;
/** Transition band around the re-loft handoff (slightly wider than U0–U1). */
const BLEND_U0 = 0.2;
const BLEND_U1 = 0.42;

describe("arch↔heel blend — Gaussian rim-delta + C2 quintic", () => {
    test("helpers: σ depth grade + C2 α knees", () => {
        expect(rimDeltaBlendSigmaMm(0)).toBeCloseTo(RIM_DELTA_SIGMA_BASE_MM, 6);
        expect(rimDeltaBlendSigmaMm(1)).toBeCloseTo(RIM_DELTA_SIGMA_TOP_MM, 6);
        const mid = rimDeltaBlendSigmaMm(0.5);
        expect(mid).toBeGreaterThan(RIM_DELTA_SIGMA_TOP_MM);
        expect(mid).toBeLessThan(RIM_DELTA_SIGMA_BASE_MM);

        expect(archWallReloftAlpha(ARCH_WALL_RELOFT_U0)).toBeCloseTo(0, 6);
        expect(archWallReloftAlpha(ARCH_WALL_RELOFT_U1)).toBeCloseTo(1, 6);
        // Midpoint of a quintic is 0.5; C2 flatness ⇒ derivative≈0 near knees.
        expect(archWallReloftAlpha((ARCH_WALL_RELOFT_U0 + ARCH_WALL_RELOFT_U1) / 2)).toBeCloseTo(0.5, 3);
        const eps = 1e-4;
        const d0 =
            (archWallReloftAlpha(ARCH_WALL_RELOFT_U0 + eps) - archWallReloftAlpha(ARCH_WALL_RELOFT_U0)) / eps;
        const d1 =
            (archWallReloftAlpha(ARCH_WALL_RELOFT_U1) - archWallReloftAlpha(ARCH_WALL_RELOFT_U1 - eps)) / eps;
        expect(Math.abs(d0)).toBeLessThan(0.05);
        expect(Math.abs(d1)).toBeLessThan(0.05);
    });

    test("scan-match / arch-only: no hard crease in medial arch↔heel band", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const basePos = Float32Array.from(raw.getAttribute("position")!.array as Float32Array);
        const index = raw.index!.array as Uint32Array | Uint16Array;
        raw.computeBoundingBox();
        const box = raw.boundingBox!;
        const sizes: [number, number][] = [
            [0, box.max.x - box.min.x],
            [1, box.max.y - box.min.y],
            [2, box.max.z - box.min.z],
        ];
        sizes.sort((a, b) => b[1]! - a[1]!);
        const lengthAxis = sizes[0]![0]!;
        const lenMin = box.min.getComponent(lengthAxis);
        const lenSize = sizes[0]![1]! || 1;

        const edgeFaces = new Map<string, number[]>();
        for (let f = 0; f < index.length; f += 3) {
            const a = index[f]!,
                b = index[f + 1]!,
                c = index[f + 2]!;
            for (const [i1, i2] of [
                [a, b],
                [b, c],
                [c, a],
            ] as const) {
                const lo = Math.min(i1, i2),
                    hi = Math.max(i1, i2);
                const k = `${lo},${hi}`;
                let arr = edgeFaces.get(k);
                if (!arr) {
                    arr = [];
                    edgeFaces.set(k, arr);
                }
                arr.push(f);
            }
        }

        const scenarios: [string, Partial<SideCorrections>][] = [
            // Matches the clinical screenshot: arch 18 + heel narrow ~−5.6
            ["arch18-narrow5.6", { archHeightMm: 18, heelCupWidthMm: -5.6, apexMoveMm: -12 }],
            ["scanmatch", { heelCupWidthMm: -5.1, archHeightMm: 13.3, apexMoveMm: -12 }],
            ["arch-only", { archHeightMm: 18 }],
        ];

        for (const [name, c] of scenarios) {
            const mod = applyBaseModifiers(raw, makeField(c), 1);
            const pos = mod.getAttribute("position")!.array as Float32Array;

            let banded = 0;
            let maxWorse = 0;
            let bandEdges = 0;
            for (const [key, faces] of edgeFaces) {
                if (faces.length !== 2) continue;
                const [loS, hiS] = key.split(",");
                const lo = Number(loS);
                const hi = Number(hiS);
                const uLo = (basePos[lo * 3 + lengthAxis]! - lenMin) / lenSize;
                const uHi = (basePos[hi * 3 + lengthAxis]! - lenMin) / lenSize;
                const u = 0.5 * (uLo + uHi);
                if (u < BLEND_U0 || u > BLEND_U1) continue;
                bandEdges++;

                const f1 = faces[0]!,
                    f2 = faces[1]!;
                const bn1 = faceNormal(basePos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
                const bn2 = faceNormal(basePos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
                const mn1 = faceNormal(pos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
                const mn2 = faceNormal(pos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
                const worse = dihedralDeg(mn1, mn2) - dihedralDeg(bn1, bn2);
                if (worse > maxWorse) maxWorse = worse;
                if (worse >= BAND_WORSENING_DEG) banded++;
            }
            console.log(
                `[ARCH-HEEL-BLEND ${name}]`,
                JSON.stringify({ bandEdges, banded, maxWorse: +maxWorse.toFixed(3) }),
            );
            expect(bandEdges).toBeGreaterThan(100);
            expect(banded).toBeLessThanOrEqual(MAX_BLEND_BANDED);
            mod.dispose();
        }
        raw.dispose();
    });

    test("width envelope stays live through arch↔heel handoff", () => {
        expect(HEEL_CUP_WIDTH_ENV_CENTER + HEEL_CUP_WIDTH_ENV_RADIUS).toBeGreaterThan(0.38);
        expect(heelCupWidthLongitudinalEnvelope(0.28)).toBeGreaterThan(MIN_WIDTH_ENV_AT_HANDOFF);
        expect(heelCupWidthLongitudinalEnvelope(0.36)).toBeGreaterThan(0.02);
        expect(heelCupWidthLongitudinalEnvelope(0.42)).toBeLessThan(0.02);
    });

    test("Top-view medial planform: no outline kink under clinical arch+narrow", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const topN = (raw.userData as { topVertexCount?: number }).topVertexCount!;
        raw.computeBoundingBox();
        const box = raw.boundingBox!;
        const sizes: [number, number][] = [
            [0, box.max.x - box.min.x],
            [1, box.max.y - box.min.y],
            [2, box.max.z - box.min.z],
        ];
        sizes.sort((a, b) => b[1]! - a[1]!);
        const lengthAxis = sizes[0]![0]!;
        const widthAxis = sizes[1]![0]!;
        const lenMin = box.min.getComponent(lengthAxis);
        const lenSize = sizes[0]![1]! || 1;
        const widCenter = (box.min.getComponent(widthAxis) + box.max.getComponent(widthAxis)) / 2;

        const clinical = {
            archHeightMm: 18,
            heelCupWidthMm: -5.7,
            apexMoveMm: -12,
        } as const;
        const mod = applyBaseModifiers(raw, makeField(clinical), 1);
        const top = submeshByVertexRange(mod, 0, topN);
        try {
            const loop = extractOrderedBoundaryLoopWithIndices(top);
            const coords = loop.positions.map((p) => [p.x, p.y, p.z]);

            // Medial crest for left: width side with more extreme |wid| toward arch
            // (pick the side whose mean |wid−center| in u∈[0.3,0.45] is larger).
            let posExt = 0,
                negExt = 0,
                posN = 0,
                negN = 0;
            for (const p of coords) {
                const u = (p[lengthAxis]! - lenMin) / lenSize;
                if (u < 0.3 || u > 0.45) continue;
                const d = p[widthAxis]! - widCenter;
                if (d >= 0) {
                    posExt += Math.abs(d);
                    posN++;
                } else {
                    negExt += Math.abs(d);
                    negN++;
                }
            }
            const medialSign = posExt / Math.max(1, posN) >= negExt / Math.max(1, negN) ? 1 : -1;

            let sumTurn = 0;
            let maxTurn = 0;
            let samples = 0;
            for (let i = 1; i < coords.length - 1; i++) {
                const a = coords[i - 1]!;
                const b = coords[i]!;
                const c = coords[i + 1]!;
                const u = (b[lengthAxis]! - lenMin) / lenSize;
                if (u < BLEND_U0 || u > BLEND_U1) continue;
                if (Math.sign(b[widthAxis]! - widCenter) !== medialSign && b[widthAxis]! !== widCenter) {
                    continue;
                }
                const ux = b[0]! - a[0]!,
                    uy = b[1]! - a[1]!,
                    uz = b[2]! - a[2]!;
                const vx = c[0]! - b[0]!,
                    vy = c[1]! - b[1]!,
                    vz = c[2]! - b[2]!;
                const ul = Math.hypot(ux, uy, uz) || 1;
                const vl = Math.hypot(vx, vy, vz) || 1;
                const turn =
                    (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (ul * vl)))) * 180) /
                    Math.PI;
                sumTurn += turn;
                if (turn > maxTurn) maxTurn = turn;
                samples++;
            }
            console.log(
                "[ARCH-HEEL-PLANFORM]",
                JSON.stringify({
                    samples,
                    sumTurn: +sumTurn.toFixed(3),
                    maxTurn: +maxTurn.toFixed(3),
                    medialSign,
                }),
            );
            expect(samples).toBeGreaterThan(10);
            expect(sumTurn).toBeLessThan(MAX_PLANFORM_BLEND_TURN_SUM_DEG);
        } finally {
            top.dispose();
            mod.dispose();
            raw.dispose();
        }
    });

    test("medial wall at arch↔heel junction stays rounded (no vertical band) under clinical narrow", async () => {
        // Early re-loft α(u) (U0=0.16→U1=0.32) must put u≈0.28 under full W(h)
        // loft so the wall flares outward over every 8 mm height window — not
        // "rounded then straight up" from a half-α corridor/re-loft mix.
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const basePos = Float32Array.from(raw.getAttribute("position")!.array as Float32Array);
        const topN = (raw.userData as { topVertexCount?: number }).topVertexCount!;
        raw.computeBoundingBox();
        const box = raw.boundingBox!;
        const sizes: [number, number][] = [
            [0, box.max.x - box.min.x],
            [1, box.max.y - box.min.y],
            [2, box.max.z - box.min.z],
        ];
        sizes.sort((a, b) => b[1]! - a[1]!);
        const lengthAxis = sizes[0]![0]!;
        const widthAxis = sizes[1]![0]!;
        const thickAxis = sizes[2]![0]!;
        const lenMin = box.min.getComponent(lengthAxis);
        const lenSize = sizes[0]![1]! || 1;
        const widCenter = (box.min.getComponent(widthAxis) + box.max.getComponent(widthAxis)) / 2;

        expect(archWallReloftAlpha(0.28)).toBeGreaterThan(0.85);

        const mod = applyBaseModifiers(
            raw,
            makeField({ archHeightMm: 18, heelCupWidthMm: -5.7, apexMoveMm: -12 }),
            1,
        );
        const pos = mod.getAttribute("position")!.array as Float32Array;
        const BIN = 1;
        const u0 = 0.28;
        const silNeg = new Map<number, number>();
        const silPos = new Map<number, number>();
        for (let i = topN; i < pos.length / 3; i++) {
            const u = (basePos[i * 3 + lengthAxis]! - lenMin) / lenSize;
            if (Math.abs(u - u0) > 0.012) continue;
            const z = pos[i * 3 + thickAxis]!;
            if (z <= PLANTAR_Z_MAX_MM) continue;
            const y = pos[i * 3 + widthAxis]! - widCenter;
            const bin = Math.round(z / BIN);
            if (y < 0) {
                const cur = silNeg.get(bin);
                if (cur === undefined || y < cur) silNeg.set(bin, y);
            } else {
                const cur = silPos.get(bin);
                if (cur === undefined || y > cur) silPos.set(bin, y);
            }
        }
        const neg = [...silNeg.entries()];
        const posB = [...silPos.entries()];
        const negMax = Math.max(0, ...neg.map((e) => Math.abs(e[1]!)));
        const posMax = Math.max(0, ...posB.map((e) => Math.abs(e[1]!)));
        const bins = (negMax >= posMax ? neg : posB).sort((a, b) => a[0]! - b[0]!);
        expect(bins.length).toBeGreaterThan(8);

        const WINDOW = 8;
        let minTravel = Infinity;
        for (let k = 0; k < bins.length; k++) {
            const [z0, y0] = bins[k]!;
            for (let m = k + 1; m < bins.length; m++) {
                const [z1, y1] = bins[m]!;
                const dz = (z1! - z0!) * BIN;
                if (dz < WINDOW) continue;
                if (dz > WINDOW + 2) break;
                minTravel = Math.min(minTravel, Math.abs(y1! - y0!));
            }
        }
        console.log(
            "[ARCH-HEEL-WALL]",
            JSON.stringify({ bins: bins.length, minTravel: +minTravel.toFixed(3) }),
        );
        expect(minTravel).toBeGreaterThan(MIN_JUNCTION_OUTWARD_TRAVEL_MM);
        mod.dispose();
        raw.dispose();
    });
});
