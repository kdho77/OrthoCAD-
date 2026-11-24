// Frozen heel-lift cup-depth gates.
// Pure grader: no mesh I/O. Do not edit after the gates pull request is opened.

import { heelLiftDeltaAt } from "@/lib/geometry/heel-lift";
import {
    BELT_TOL_MM,
    CUP_DEPTH_TOL_MM,
    MET_HEAD_TOL_MM,
    MET_HEAD_U,
    MONOTONE_SLACK_MM,
    SEAT_TOL_MM,
    STATION_U,
} from "./thresholds";

export interface IndexedPoint {
    i: number;
    u: number;
    v: number;
    z: number;
}

export interface SheetSample {
    seat: IndexedPoint;
    rim: IndexedPoint;
    stations: IndexedPoint[];
}

export interface BeltSample {
    count: number;
    minZ: number;
    maxZ: number;
}

export interface LiftComparison {
    seatU: number;
    rimU: number;
    dSeat: number;
    dRim: number;
    dCup: number;
    stations: { u: number; added: number }[];
    belt: BeltSample;
}

export interface GradeResult {
    pass: boolean;
    failures: string[];
}

interface Frame {
    lenMin: number;
    lenSize: number;
    widCenter: number;
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
    const lenSize = maxX - minX;
    const widSize = maxY - minY;
    return {
        lenMin: minX,
        lenSize: lenSize > 1e-6 ? lenSize : 1,
        widCenter: (minY + maxY) / 2,
        halfW: widSize > 1e-6 ? widSize / 2 : 1,
    };
}

function pointAt(pos: Float32Array, i: number, frame: Frame): IndexedPoint {
    const x = pos[i * 3]!;
    const y = pos[i * 3 + 1]!;
    return {
        i,
        u: (x - frame.lenMin) / frame.lenSize,
        v: (y - frame.widCenter) / frame.halfW,
        z: pos[i * 3 + 2]!,
    };
}

/**
 * Posterior heel floor: lowest interior vertex in the cup, near the centerline.
 * The rim sample is the wall top at that same station so a full-strength
 * heelLiftDeltaAt keeps rim z − seat z.
 */
export function sampleSheet(pos: Float32Array, rimLocal: readonly number[]): SheetSample {
    const frame = frameOf(pos);
    const rim = new Set(rimLocal);
    const n = pos.length / 3;
    let seat: IndexedPoint | null = null;
    for (let i = 0; i < n; i++) {
        if (rim.has(i)) continue;
        const p = pointAt(pos, i, frame);
        if (p.u < 0.05 || p.u > 0.22 || Math.abs(p.v) > 0.35) continue;
        if (
            !seat ||
            p.z < seat.z - 1e-6 ||
            (Math.abs(p.z - seat.z) <= 1e-6 && Math.abs(p.v) < Math.abs(seat.v))
        ) {
            seat = p;
        }
    }
    if (!seat) throw new Error("heel seat sample missing");

    let rimPt: IndexedPoint | null = null;
    for (const i of rim) {
        const p = pointAt(pos, i, frame);
        const du = Math.abs(p.u - seat.u);
        if (!rimPt || du < Math.abs(rimPt.u - seat.u) - 1e-9) rimPt = p;
    }
    if (!rimPt) throw new Error("heel rim sample missing");

    const stations: IndexedPoint[] = [];
    for (const target of STATION_U) {
        let best: IndexedPoint | null = null;
        for (let i = 0; i < n; i++) {
            if (rim.has(i)) continue;
            const p = pointAt(pos, i, frame);
            if (Math.abs(p.u - target) > 0.02 || Math.abs(p.v) > 0.35) continue;
            if (!best || p.z < best.z - 1e-6) best = p;
        }
        if (!best) throw new Error(`foot-contact sample missing at u=${target}`);
        stations.push({ ...best, u: target });
    }
    return { seat, rim: rimPt, stations };
}

function zOf(pos: Float32Array, i: number): number {
    return pos[i * 3 + 2]!;
}

/** Added height of the lift-0 samples, read at the same vertex indices. */
export function compareLift(
    zero: SheetSample,
    zeroPos: Float32Array,
    liftPos: Float32Array,
    belt: BeltSample,
): LiftComparison {
    if (liftPos.length < zeroPos.length) {
        throw new Error(`lift mesh has ${liftPos.length / 3} vertices, lift 0 has ${zeroPos.length / 3}`);
    }
    const read = (i: number) => zOf(liftPos, i) - zOf(zeroPos, i);
    const dSeat = read(zero.seat.i);
    const dRim = read(zero.rim.i);
    return {
        seatU: zero.seat.u,
        rimU: zero.rim.u,
        dSeat,
        dRim,
        dCup: dRim - dSeat,
        stations: zero.stations.map((s) => ({ u: s.u, added: read(s.i) })),
        belt,
    };
}

/**
 * Print/belt face under the posterior heel (u ≤ 0.20).
 * `count` is vertices within 0.02 mm of z = 0 (the bed face; BASE has about 2500).
 * `minZ` / `maxZ` are the heel-region extremes. A belt raised off the bed loses
 * the z = 0 face and moves minZ with it.
 */
export function sampleBelt(
    pos: Float32Array,
    lengthAxis: number,
    thickAxis: number,
    lenMin: number,
    lenSize: number,
): BeltSample {
    let count = 0;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const n = pos.length / 3;
    const span = lenSize > 1e-6 ? lenSize : 1;
    for (let i = 0; i < n; i++) {
        const u = (pos[i * 3 + lengthAxis]! - lenMin) / span;
        if (u > 0.2) continue;
        const z = pos[i * 3 + thickAxis]!;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
        if (Math.abs(z) <= 0.02) count++;
    }
    if (!Number.isFinite(minZ)) return { count: 0, minZ: Number.NaN, maxZ: Number.NaN };
    return { count, minZ, maxZ };
}

export function gradeHeelLift(H: number, row: LiftComparison): GradeResult {
    const failures: string[] = [];
    const curve = heelLiftDeltaAt(row.seatU, H);
    const seatOk = Math.abs(row.dSeat - H) <= SEAT_TOL_MM || Math.abs(row.dSeat - curve) <= SEAT_TOL_MM;
    if (!seatOk) {
        failures.push(
            `seat rise ${row.dSeat.toFixed(3)} mm at u=${row.seatU.toFixed(3)} is outside ${H} ± ${SEAT_TOL_MM} and heelLiftDeltaAt ${curve.toFixed(3)} ± ${SEAT_TOL_MM}`,
        );
    }
    if (Math.abs(row.dCup) > CUP_DEPTH_TOL_MM) {
        failures.push(
            `cup depth change ${row.dCup.toFixed(3)} mm (dRim ${row.dRim.toFixed(3)}, dSeat ${row.dSeat.toFixed(3)}) exceeds ± ${CUP_DEPTH_TOL_MM}`,
        );
    }
    const ordered = [...row.stations].sort((a, b) => a.u - b.u);
    for (let i = 1; i < ordered.length; i++) {
        const prev = ordered[i - 1]!;
        const next = ordered[i]!;
        if (next.added > prev.added + MONOTONE_SLACK_MM) {
            failures.push(
                `added height rises from u=${prev.u} (${prev.added.toFixed(3)} mm) to u=${next.u} (${next.added.toFixed(3)} mm)`,
            );
        }
    }
    const met = ordered.find((s) => s.u === MET_HEAD_U);
    if (!met) {
        failures.push(`met-head station u=${MET_HEAD_U} missing`);
    } else if (met.added > MET_HEAD_TOL_MM || met.added < -MET_HEAD_TOL_MM) {
        failures.push(
            `met-head added height ${met.added.toFixed(3)} mm at u=${MET_HEAD_U} exceeds ± ${MET_HEAD_TOL_MM}`,
        );
    }
    if (row.belt.count < 500) {
        failures.push(
            `print/belt face under the heel has ${row.belt.count} vertices within 0.02 mm of z=0 (need ≥ 500)`,
        );
    } else if (row.belt.minZ < -BELT_TOL_MM || row.belt.minZ > BELT_TOL_MM) {
        failures.push(
            `print/belt min z under the heel is ${row.belt.minZ.toFixed(3)} mm, need 0 ± ${BELT_TOL_MM}`,
        );
    }
    return { pass: failures.length === 0, failures };
}
