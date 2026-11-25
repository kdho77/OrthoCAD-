// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

// Heel-lift regression: on the Print/export compose path the plantar
// foot-contact sheet under the heel must rise by heelLiftDeltaAt and taper
// to the met heads. The cup (rim z − seat z at the same station) stays put,
// and the print/belt face stays on z = 0.
//
// SHA-256 values were recorded on BASE 8aced4b5042bdafc2d300006fa80802bca1b94b9
// for heelLiftMm = 0 (US M11 medium, full_contact, printing_solid, round walls).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { heelLiftDeltaAt } from "@/lib/geometry/heel-lift";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import { defaultDesign } from "@/stores/design-store";
import type { Side } from "@/types";
import { printSolidOptions } from "./procedural-wall/print-solid-options";
import { reconstructProceduralPreview, sampleTopFromArrayBuffer } from "./procedural-wall/sample-top-preview";

const SAMPLE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

/** Zero-lift STL from BASE. A lift must not change these. */
const BASE_ZERO_LIFT_SHA256: Record<Side, string> = {
    right: "3eb6109ced32cff9db8d19ce6d16e3a54b16d0ed684f86eb23da59671f752e27",
    left: "474e0f99d0ac907682452871fe08e053353962c39d8ac041ff0a827eb4e92797",
};

const SEAT_TOL_MM = 0.2;
const CUP_TOL_MM = 0.2;
const MET_TOL_MM = 0.1;
const BELT_TOL_MM = 0.1;

function sha256(geo: BufferGeometry): string {
    return createHash("sha256")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
}

async function loadSide(side: Side): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE);
    const loaded = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    // Export treats the reoriented SAMPLE_Top as the right foot and mirrors left.
    if (side === "left") {
        const mirrored = mirrorGeometry(loaded);
        loaded.dispose();
        return mirrored;
    }
    return loaded;
}

async function loft(side: Side, heelLiftMm: number) {
    const design = defaultDesign();
    design.usMenSize = 11;
    design.shoeWidth = "medium";
    design.method = "printing_solid";
    design.pattern = "full_contact";
    design.corrections = {
        ...design.corrections,
        [side]: { ...design.corrections[side], heelLiftMm },
    };
    const field = baseModifierField(design, side, design.thicknessMm);
    const raw = await loadSide(side);
    const options = printSolidOptions({
        design,
        side,
        field,
        viewer: { wallStyle: "round" },
        trimline: null,
        bottomPattern: null,
    });
    try {
        return await reconstructProceduralPreview(raw, options);
    } finally {
        raw.dispose();
    }
}

function topXYZ(geo: BufferGeometry): Float32Array {
    const n = (geo.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const pos = geo.getAttribute("position");
    if (!pos || n < 100) throw new Error(`top sheet missing (${n})`);
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        out[i * 3] = pos.getX(i);
        out[i * 3 + 1] = pos.getY(i);
        out[i * 3 + 2] = pos.getZ(i);
    }
    return out;
}

interface Frame {
    minX: number;
    len: number;
    midY: number;
    halfW: number;
}

function frameOf(pos: Float32Array): Frame {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return { minX, len: maxX - minX, midY: (minY + maxY) / 2, halfW: (maxY - minY) / 2 };
}

function uAt(pos: Float32Array, i: number, frame: Frame): number {
    return (pos[i * 3]! - frame.minX) / frame.len;
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return NaN;
    const sorted = values.slice().sort((a, b) => a - b);
    const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
    return sorted[i]!;
}

/** Midline foot-contact verts (narrow Y band). Walls sit off this band. */
function midlineIndices(pos: Float32Array, frame: Frame, u0: number, u1: number): number[] {
    const out: number[] = [];
    const n = pos.length / 3;
    const band = frame.halfW * 0.12;
    for (let i = 0; i < n; i++) {
        const u = uAt(pos, i, frame);
        if (u < u0 || u > u1) continue;
        if (Math.abs(pos[i * 3 + 1]! - frame.midY) > band) continue;
        out.push(i);
    }
    return out;
}

/**
 * Heel-seat floor inside a midline band: verts within 1.5 mm of the low
 * cluster (p05), so the cup wall is not mixed into the seat.
 */
function seatFloor(pos: Float32Array, frame: Frame, u0: number, u1: number): number[] {
    const band = midlineIndices(pos, frame, u0, u1);
    const zs = band.map((i) => pos[i * 3 + 2]!);
    const floor = percentile(zs, 0.05);
    return band.filter((i) => pos[i * 3 + 2]! <= floor + 1.5);
}

function mean(values: number[]): number {
    if (values.length === 0) return NaN;
    return values.reduce((s, v) => s + v, 0) / values.length;
}

describe("heel lift raises the plantar seat on the composed SAMPLE_Top sheet", () => {
    test("US M11 medium, both feet, 6 mm and 12 mm, belt stays at z=0", async () => {
        const layout = insoleLayoutForUsMenSize(11);
        expect(layout.scale).toBeCloseTo(1.0645, 4);
        expect(layout.lengthMm).toBeCloseTo(276.77, 2);
        expect(layout.widthMm).toBeCloseTo(101.13, 2);

        for (const side of ["right", "left"] as const) {
            const zero = await loft(side, 0);
            const zeroSha = sha256(zero.geometry);
            expect(zeroSha, `${side} heelLiftMm=0 STL`).toBe(BASE_ZERO_LIFT_SHA256[side]);

            const zPos = topXYZ(zero.geometry);
            const frame = frameOf(zPos);
            const zeroUd = zero.geometry.userData as { meshMinZ?: number; plantarAbsMaxZ?: number };
            const rim0 = zero.model.top.rimLocal ?? [];

            for (const heel of [6, 12] as const) {
                const lifted = await loft(side, heel);
                const hPos = topXYZ(lifted.geometry);
                expect(hPos.length).toBe(zPos.length);
                const rim1 = lifted.model.top.rimLocal ?? [];

                const floor = seatFloor(zPos, frame, 0.08, 0.18);
                expect(floor.length, `${side} ${heel} seat samples`).toBeGreaterThan(20);
                const dzs = floor.map((i) => hPos[i * 3 + 2]! - zPos[i * 3 + 2]!);
                const us = floor.map((i) => uAt(zPos, i, frame));
                const dSeat = mean(dzs);
                const uSeat = mean(us);
                const expected = heelLiftDeltaAt(uSeat, heel);
                expect(
                    Math.abs(dSeat - expected),
                    `${side} H=${heel} seat rise ${dSeat.toFixed(3)} at u=${uSeat.toFixed(3)} vs heelLiftDeltaAt ${expected.toFixed(3)}`,
                ).toBeLessThanOrEqual(SEAT_TOL_MM);

                // Posterior heel, as close to u=0 as the seat floor exists.
                let posterior = seatFloor(zPos, frame, 0, 0.08);
                if (posterior.length < 8) posterior = seatFloor(zPos, frame, 0, 0.12);
                expect(posterior.length, `${side} ${heel} posterior seat`).toBeGreaterThan(5);
                const postDz = posterior.map((i) => hPos[i * 3 + 2]! - zPos[i * 3 + 2]!);
                const postU = mean(posterior.map((i) => uAt(zPos, i, frame)));
                const postExpected = heelLiftDeltaAt(postU, heel);
                expect(
                    Math.abs(mean(postDz) - postExpected),
                    `${side} H=${heel} posterior seat ${mean(postDz).toFixed(3)} at u=${postU.toFixed(3)} vs ${postExpected.toFixed(3)}`,
                ).toBeLessThanOrEqual(SEAT_TOL_MM);

                // Same-station cup: rim z − seat z. Pair each posterior rim
                // vertex with the midline seat at the same u. Both take
                // heelLiftDeltaAt(u), so the depth stays within 0.2 mm.
                const heelFloor = seatFloor(zPos, frame, 0, 0.25);
                const cupErrors: number[] = [];
                let rimChecked = 0;
                for (const ri of rim0) {
                    if (ri >= zPos.length / 3) continue;
                    const u = uAt(zPos, ri, frame);
                    if (u > 0.25) continue;
                    let best = -1;
                    let bestDu = Infinity;
                    for (const si of heelFloor) {
                        const du = Math.abs(uAt(zPos, si, frame) - u);
                        if (du < bestDu) {
                            bestDu = du;
                            best = si;
                        }
                    }
                    if (best < 0 || bestDu > 0.01) continue;
                    const dRim = hPos[ri * 3 + 2]! - zPos[ri * 3 + 2]!;
                    const dSeatAt = hPos[best * 3 + 2]! - zPos[best * 3 + 2]!;
                    cupErrors.push(dRim - dSeatAt);
                    rimChecked++;
                    expect(
                        Math.abs(dRim - heelLiftDeltaAt(u, heel)),
                        `${side} H=${heel} rim dz at u=${u.toFixed(3)}`,
                    ).toBeLessThanOrEqual(SEAT_TOL_MM);
                }
                expect(rimChecked, `${side} ${heel} paired rim/seat stations`).toBeGreaterThan(4);
                const worstCup = Math.max(...cupErrors.map((v) => Math.abs(v)));
                expect(
                    worstCup,
                    `${side} H=${heel} cup depth change ${worstCup.toFixed(3)}`,
                ).toBeLessThanOrEqual(CUP_TOL_MM);
                expect(rim1.length).toBeGreaterThan(8);

                // Met heads: added height at the default taper end (u = 0.75) is ~0.
                // The window starts at the endpoint; u just behind it still carries
                // the last of the ramp (12 mm × 0.01/0.75 = 0.16 mm at u = 0.74).
                const met = midlineIndices(zPos, frame, 0.75, 0.77);
                expect(met.length).toBeGreaterThan(5);
                const metDz = Math.max(...met.map((i) => hPos[i * 3 + 2]! - zPos[i * 3 + 2]!));
                expect(metDz, `${side} H=${heel} met-head rise`).toBeLessThanOrEqual(MET_TOL_MM);

                const stations = [0.05, 0.15, 0.3, 0.45, 0.6, 0.75];
                const stationDz = stations.map((u) => {
                    const idx = midlineIndices(zPos, frame, u - 0.03, u + 0.03);
                    const lows = idx
                        .map((i) => ({ i, z: zPos[i * 3 + 2]! }))
                        .sort((a, b) => a.z - b.z)
                        .slice(0, Math.max(3, Math.floor(idx.length * 0.5)));
                    return mean(lows.map(({ i }) => hPos[i * 3 + 2]! - zPos[i * 3 + 2]!));
                });
                for (let s = 1; s < stationDz.length; s++) {
                    expect(
                        stationDz[s]!,
                        `${side} H=${heel} monotone u=${stations[s]} dz=${stationDz[s]!.toFixed(3)} after ${stationDz[s - 1]!.toFixed(3)}`,
                    ).toBeLessThanOrEqual(stationDz[s - 1]! + 0.05);
                }
                expect(stationDz[0]!).toBeGreaterThan(stationDz[stationDz.length - 1]! + heel * 0.5);

                const ud = lifted.geometry.userData as { meshMinZ?: number; plantarAbsMaxZ?: number };
                expect(ud.plantarAbsMaxZ ?? 1, `${side} H=${heel} plantarAbsMaxZ`).toBeLessThanOrEqual(
                    BELT_TOL_MM,
                );
                expect(Math.abs(ud.meshMinZ ?? 1), `${side} H=${heel} meshMinZ`).toBeLessThanOrEqual(
                    BELT_TOL_MM,
                );
                expect(
                    Math.abs((ud.meshMinZ ?? 1) - (zeroUd.meshMinZ ?? 0)),
                    `${side} H=${heel} meshMinZ vs lift 0`,
                ).toBeLessThanOrEqual(BELT_TOL_MM);

                lifted.geometry.dispose();
            }
            zero.geometry.dispose();
        }
    }, 900_000);

    test("left heelLiftMm=12 leaves the right foot byte-identical to BASE", async () => {
        const right = await loft("right", 0);
        const left = await loft("left", 12);
        expect(sha256(right.geometry)).toBe(BASE_ZERO_LIFT_SHA256.right);
        const pos = topXYZ(left.geometry);
        const frame = frameOf(pos);
        const floor = seatFloor(pos, frame, 0.08, 0.18);
        expect(floor.length).toBeGreaterThan(20);
        // The left sheet did receive the lift; the right hash above is the
        // untouched foot from the same pair of calls.
        const rise = mean(floor.map((i) => pos[i * 3 + 2]!));
        expect(rise).toBeGreaterThan(8);
        right.geometry.dispose();
        left.geometry.dispose();
    }, 300_000);
});
