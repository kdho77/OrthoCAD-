// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

// Heel-lift regression: on the Print/export compose path the lowest point of
// the heel seat (the cup center) rises by the full heelLiftMm. The cup
// (rim z − seat z at that station) stays put because the seat, walls, and
// rim move together, the raise tapers to the met heads, and the print/belt
// face stays on z = 0.
//
// SHA-256 values were recorded on BASE 8aced4b5042bdafc2d300006fa80802bca1b94b9
// for heelLiftMm = 0 (US M11 medium, full_contact, printing_solid, round walls)
// and still match current main: a zero lift must stay byte-identical.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
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

const SEAT_TOL_MM = 0.3;
const CUP_TOL_MM = 0.3;
const MET_TOL_MM = 0.1;
const BELT_TOL_MM = 0.1;
const MONOTONE_SLACK_MM = 0.05;
const LIFT_MM = [6, 10, 12] as const;

/** Posterior heel-cup window. The lowest point inside it is the cup center. */
const HEEL_CUP_U_MAX = 0.3;
const HEEL_CUP_ABS_V_MAX = 0.5;
const CENTER_ABS_V_MAX = 0.2;
const STATION_DU = 0.02;
const RIM_DU_MAX = 0.02;
const STATION_U = [0.05, 0.15, 0.3, 0.45, 0.6] as const;
const MET_HEAD_U = 0.75;
const MET_HEAD_U_HI = 0.78;
const BELT_U_MAX = 0.2;
const BELT_FACE_Z_MM = 0.02;
const BELT_FACE_MIN_COUNT = 500;

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
    if (!options.sourceField || options.composedTop !== true || options.wallStyle !== "round") {
        throw new Error("production compose path was not selected");
    }
    try {
        return await reconstructProceduralPreview(raw, options);
    } finally {
        raw.dispose();
    }
}

interface SheetPoint {
    i: number;
    u: number;
    v: number;
    z: number;
}

interface SheetFrame {
    lenMin: number;
    lenSize: number;
    widCenter: number;
    halfW: number;
}

function frameOf(pos: Float32Array): SheetFrame {
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
    return {
        lenMin: minX,
        lenSize: Math.max(1e-6, maxX - minX),
        widCenter: (minY + maxY) / 2,
        halfW: Math.max(1e-6, (maxY - minY) / 2),
    };
}

function pointAt(pos: Float32Array, i: number, frame: SheetFrame): SheetPoint {
    const x = pos[i * 3]!;
    const y = pos[i * 3 + 1]!;
    return {
        i,
        u: (x - frame.lenMin) / frame.lenSize,
        v: (y - frame.widCenter) / frame.halfW,
        z: pos[i * 3 + 2]!,
    };
}

/** Lowest heel-cup vertex. Equal z prefers the width center (the cup center). */
function lowestHeelSeat(pos: Float32Array, rimLocal: readonly number[]): SheetPoint {
    const frame = frameOf(pos);
    const rim = new Set(rimLocal);
    let seat: SheetPoint | null = null;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
        if (rim.has(i)) continue;
        const p = pointAt(pos, i, frame);
        if (p.u < 0 || p.u > HEEL_CUP_U_MAX || Math.abs(p.v) > HEEL_CUP_ABS_V_MAX) continue;
        if (
            !seat ||
            p.z < seat.z - 1e-6 ||
            (Math.abs(p.z - seat.z) <= 1e-6 && Math.abs(p.v) < Math.abs(seat.v))
        ) {
            seat = p;
        }
    }
    if (!seat) throw new Error("heel seat sample missing");
    return seat;
}

/** Heel-rim vertex nearest the seat station. Cup depth is rim z − seat z there. */
function rimAtSeat(pos: Float32Array, rimLocal: readonly number[], seat: SheetPoint): SheetPoint {
    const frame = frameOf(pos);
    let rimPt: SheetPoint | null = null;
    for (const i of rimLocal) {
        if (i < 0 || i >= pos.length / 3) continue;
        const p = pointAt(pos, i, frame);
        if (p.u > HEEL_CUP_U_MAX + 0.05) continue;
        const du = Math.abs(p.u - seat.u);
        const bestDu = rimPt ? Math.abs(rimPt.u - seat.u) : Infinity;
        if (!rimPt || du < bestDu - 1e-9 || (Math.abs(du - bestDu) <= 1e-9 && p.z > rimPt.z)) {
            rimPt = p;
        }
    }
    if (!rimPt) throw new Error("heel rim sample missing");
    return rimPt;
}

function nearestCenter(pos: Float32Array, targetU: number): SheetPoint {
    const frame = frameOf(pos);
    let best: SheetPoint | null = null;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
        const p = pointAt(pos, i, frame);
        if (Math.abs(p.v) > CENTER_ABS_V_MAX || Math.abs(p.u - targetU) > STATION_DU) continue;
        const du = Math.abs(p.u - targetU);
        const bestDu = best ? Math.abs(best.u - targetU) : Infinity;
        if (
            !best ||
            du < bestDu - 1e-9 ||
            (Math.abs(du - bestDu) <= 1e-9 && Math.abs(p.v) < Math.abs(best.v))
        ) {
            best = p;
        }
    }
    if (!best) throw new Error(`foot-contact sample missing at u=${targetU}`);
    return best;
}

function metIndices(pos: Float32Array): number[] {
    const frame = frameOf(pos);
    const out: number[] = [];
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
        const p = pointAt(pos, i, frame);
        if (Math.abs(p.v) > CENTER_ABS_V_MAX) continue;
        if (p.u < MET_HEAD_U || p.u > MET_HEAD_U_HI) continue;
        out.push(i);
    }
    return out;
}

function composedTop(preview: Awaited<ReturnType<typeof loft>>): { pos: Float32Array; rim: number[] } {
    const pos = preview.model.top.meshPositions;
    const rim = preview.model.top.rimLocal ?? [];
    if (!pos || rim.length < 8) throw new Error("composed top sheet missing");
    return { pos, rim };
}

function beltMinZ(geo: BufferGeometry, side: Side): { count: number; minZ: number } {
    const frame = getBaseFootprintFrame(geo, side);
    const pos = geo.getAttribute("position");
    if (!pos) throw new Error("solid positions missing");
    const array = pos.array as Float32Array;
    let count = 0;
    let minZ = Infinity;
    const n = array.length / 3;
    for (let i = 0; i < n; i++) {
        const along = array[i * 3 + frame.lengthAxis]!;
        const u = (along - frame.lenMin) / frame.lenSize;
        if (u > BELT_U_MAX) continue;
        const z = array[i * 3 + frame.thickAxis]!;
        if (z < minZ) minZ = z;
        if (Math.abs(z) <= BELT_FACE_Z_MM) count++;
    }
    return { count, minZ };
}

describe("heel lift raises the plantar seat on the composed SAMPLE_Top sheet", () => {
    test("US M11 medium, both feet, H=6, 10, and 12, belt stays at z=0", async () => {
        const layout = insoleLayoutForUsMenSize(11);
        expect(layout.scale).toBeCloseTo(1.0645, 4);
        expect(layout.lengthMm).toBeCloseTo(276.77, 2);
        expect(layout.widthMm).toBeCloseTo(101.13, 2);

        for (const side of ["right", "left"] as const) {
            const zero = await loft(side, 0);
            expect(zero.geometry.userData.composedTop, `${side} composedTop`).toBe(true);
            const zeroSha = sha256(zero.geometry);
            expect(zeroSha, `${side} heelLiftMm=0 STL`).toBe(BASE_ZERO_LIFT_SHA256[side]);

            const zSheet = composedTop(zero);
            const seat = lowestHeelSeat(zSheet.pos, zSheet.rim);
            const rim = rimAtSeat(zSheet.pos, zSheet.rim, seat);
            expect(Math.abs(rim.u - seat.u), `${side} rim station`).toBeLessThanOrEqual(RIM_DU_MAX);
            expect(seat.u, `${side} seat is inside the heel cup`).toBeGreaterThan(0.02);
            expect(seat.u, `${side} seat is inside the heel cup`).toBeLessThan(HEEL_CUP_U_MAX - 0.02);
            const stations = STATION_U.map((u) => nearestCenter(zSheet.pos, u));
            const met = metIndices(zSheet.pos);
            expect(met.length, `${side} met-head samples`).toBeGreaterThan(5);
            const zeroUd = zero.geometry.userData as { meshMinZ?: number; plantarAbsMaxZ?: number };
            const zeroBelt = beltMinZ(zero.geometry, side);

            for (const heel of LIFT_MM) {
                const lifted = await loft(side, heel);
                const hSheet = composedTop(lifted);
                expect(hSheet.pos.length, `${side} H=${heel} vertex count`).toBe(zSheet.pos.length);

                const dz = (i: number) => hSheet.pos[i * 3 + 2]! - zSheet.pos[i * 3 + 2]!;
                const dSeat = dz(seat.i);
                const dRim = dz(rim.i);
                const dCup = dRim - dSeat;
                expect(
                    Math.abs(dSeat - heel),
                    `${side} H=${heel} seat rise ${dSeat.toFixed(3)} at lowest heel-seat u=${seat.u.toFixed(3)} v=${seat.v.toFixed(3)}`,
                ).toBeLessThanOrEqual(SEAT_TOL_MM);
                expect(
                    Math.abs(dCup),
                    `${side} H=${heel} cup depth change ${dCup.toFixed(3)} (dRim ${dRim.toFixed(3)}, dSeat ${dSeat.toFixed(3)})`,
                ).toBeLessThanOrEqual(CUP_TOL_MM);

                let dMetMin = Infinity;
                let dMetMax = -Infinity;
                for (const i of met) {
                    const added = dz(i);
                    if (added < dMetMin) dMetMin = added;
                    if (added > dMetMax) dMetMax = added;
                }
                expect(
                    dMetMax,
                    `${side} H=${heel} met-head added height ${dMetMin.toFixed(3)}..${dMetMax.toFixed(3)}`,
                ).toBeLessThanOrEqual(MET_TOL_MM);
                expect(dMetMin, `${side} H=${heel} met-head drop`).toBeGreaterThanOrEqual(-MET_TOL_MM);

                const ordered = [
                    ...stations.map((s) => ({ u: s.u, added: dz(s.i) })),
                    { u: seat.u, added: dSeat },
                    { u: MET_HEAD_U, added: dMetMax },
                ].sort((a, b) => a.u - b.u);
                for (let s = 1; s < ordered.length; s++) {
                    const prev = ordered[s - 1]!;
                    const next = ordered[s]!;
                    expect(
                        next.added,
                        `${side} H=${heel} taper rises from u=${prev.u.toFixed(3)} (${prev.added.toFixed(3)}) to u=${next.u.toFixed(3)} (${next.added.toFixed(3)})`,
                    ).toBeLessThanOrEqual(prev.added + MONOTONE_SLACK_MM);
                }
                expect(ordered[0]!.added).toBeGreaterThan(ordered[ordered.length - 1]!.added + heel * 0.5);

                const belt = beltMinZ(lifted.geometry, side);
                expect(belt.count, `${side} H=${heel} belt face count`).toBeGreaterThanOrEqual(
                    BELT_FACE_MIN_COUNT,
                );
                expect(Math.abs(belt.minZ), `${side} H=${heel} belt min z`).toBeLessThanOrEqual(BELT_TOL_MM);
                expect(
                    Math.abs(belt.minZ - zeroBelt.minZ),
                    `${side} H=${heel} belt min z vs lift 0`,
                ).toBeLessThanOrEqual(BELT_TOL_MM);

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
                expect(
                    Math.abs((ud.plantarAbsMaxZ ?? 1) - (zeroUd.plantarAbsMaxZ ?? 0)),
                    `${side} H=${heel} plantarAbsMaxZ vs lift 0`,
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
        const sheet = composedTop(left);
        const seat = lowestHeelSeat(sheet.pos, sheet.rim);
        // The left sheet did receive the full lift; the right hash above is the
        // untouched foot from the same pair of calls.
        expect(seat.z).toBeGreaterThan(10);
        right.geometry.dispose();
        left.geometry.dispose();
    }, 300_000);
});
