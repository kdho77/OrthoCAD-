// Frozen rigid heel-lift cup-depth gates.
// The seat sample is the lowest point of the heel seat (the cup center).
// Do not edit after the gates pull request is opened.

import {
    BELT_FACE_MIN_COUNT,
    BELT_FACE_Z_MM,
    BELT_TOL_MM,
    BELT_U_MAX,
    CENTER_ABS_V_MAX,
    CUP_DEPTH_TOL_MM,
    HEEL_CUP_ABS_V_MAX,
    HEEL_CUP_U_MAX,
    HEEL_CUP_U_MIN,
    MET_HEAD_TOL_MM,
    MET_HEAD_U,
    MET_HEAD_U_HI,
    MONOTONE_SLACK_MM,
    RIM_DU_MAX,
    SEAT_TOL_MM,
    STATION_DU,
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
    met: number[];
}

export interface BeltSample {
    count: number;
    minZ: number;
    maxZ: number;
}

export interface PlateSample {
    meshMinZ: number;
    plantarAbsMaxZ: number;
    zeroMeshMinZ: number;
    zeroPlantarAbsMaxZ: number;
}

export interface LiftComparison {
    seatU: number;
    seatV: number;
    seatZ0: number;
    rimU: number;
    rimZ0: number;
    cupDepth0: number;
    dSeat: number;
    dRim: number;
    dCup: number;
    dMetMin: number;
    dMetMax: number;
    stations: { u: number; added: number }[];
    belt: BeltSample;
    plate: PlateSample;
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
        const x = pos[i * 3] ?? Number.NaN;
        const y = pos[i * 3 + 1] ?? Number.NaN;
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
    const x = pos[i * 3] ?? Number.NaN;
    const y = pos[i * 3 + 1] ?? Number.NaN;
    return {
        i,
        u: (x - frame.lenMin) / frame.lenSize,
        v: (y - frame.widCenter) / frame.halfW,
        z: pos[i * 3 + 2] ?? Number.NaN,
    };
}

function inHeelCup(p: IndexedPoint): boolean {
    return p.u >= HEEL_CUP_U_MIN && p.u <= HEEL_CUP_U_MAX && Math.abs(p.v) <= HEEL_CUP_ABS_V_MAX;
}

/**
 * Lowest point of the heel seat. Equal z (1e-6 mm) prefers the width center,
 * which is the cup center. A higher vertex is never selected.
 */
export function selectLowestHeelSeat(candidates: readonly IndexedPoint[]): IndexedPoint {
    let seat: IndexedPoint | null = null;
    for (const p of candidates) {
        if (
            !seat ||
            p.z < seat.z - 1e-6 ||
            (Math.abs(p.z - seat.z) <= 1e-6 && Math.abs(p.v) < Math.abs(seat.v))
        ) {
            seat = p;
        }
    }
    if (!seat) throw new Error("heel seat sample missing");
    if (seat.u <= HEEL_CUP_U_MIN + 0.005 || seat.u >= HEEL_CUP_U_MAX - 0.005) {
        throw new Error(
            `heel seat u=${seat.u.toFixed(4)} is on the cup-window boundary; the window is clipping the lowest point`,
        );
    }
    if (Math.abs(seat.v) >= HEEL_CUP_ABS_V_MAX - 0.02) {
        throw new Error(
            `heel seat |v|=${Math.abs(seat.v).toFixed(4)} is on the cup-window boundary; the lowest point is not the cup center`,
        );
    }
    return seat;
}

/** Heel-cup interior vertices, lowest z first. Rim vertices are excluded. */
export function heelCupCandidates(pos: Float32Array, rimLocal: readonly number[]): IndexedPoint[] {
    const frame = frameOf(pos);
    const rim = new Set(rimLocal);
    const out: IndexedPoint[] = [];
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
        if (rim.has(i)) continue;
        const p = pointAt(pos, i, frame);
        if (!inHeelCup(p)) continue;
        out.push(p);
    }
    out.sort((a, b) => a.z - b.z || Math.abs(a.v) - Math.abs(b.v));
    return out;
}

function nearestCenter(
    pos: Float32Array,
    frame: Frame,
    rim: ReadonlySet<number>,
    targetU: number,
): IndexedPoint {
    const n = pos.length / 3;
    let best: IndexedPoint | null = null;
    for (let i = 0; i < n; i++) {
        if (rim.has(i)) continue;
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

function metIndices(pos: Float32Array, frame: Frame, rim: ReadonlySet<number>): number[] {
    const n = pos.length / 3;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
        if (rim.has(i)) continue;
        const p = pointAt(pos, i, frame);
        if (Math.abs(p.v) > CENTER_ABS_V_MAX) continue;
        if (p.u < MET_HEAD_U || p.u > MET_HEAD_U_HI) continue;
        out.push(i);
    }
    return out;
}

/**
 * Foot-contact sheet of one composed top.
 * The seat is the lowest heel-cup vertex. The rim is the heel-rim vertex
 * nearest that station, so cup depth is rim z − seat z at the cup center.
 */
export function sampleSheet(pos: Float32Array, rimLocal: readonly number[]): SheetSample {
    const frame = frameOf(pos);
    const rim = new Set(rimLocal);
    const seat = selectLowestHeelSeat(heelCupCandidates(pos, rimLocal));

    let rimPt: IndexedPoint | null = null;
    for (const i of rim) {
        const p = pointAt(pos, i, frame);
        if (p.u > HEEL_CUP_U_MAX + 0.05) continue;
        const du = Math.abs(p.u - seat.u);
        const bestDu = rimPt ? Math.abs(rimPt.u - seat.u) : Infinity;
        if (!rimPt || du < bestDu - 1e-9 || (Math.abs(du - bestDu) <= 1e-9 && p.z > rimPt.z)) {
            rimPt = p;
        }
    }
    if (!rimPt) throw new Error("heel rim sample missing");
    if (Math.abs(rimPt.u - seat.u) > RIM_DU_MAX) {
        throw new Error(
            `heel rim u=${rimPt.u.toFixed(4)} is ${Math.abs(rimPt.u - seat.u).toFixed(4)} from the seat; cup rim not at the seat station`,
        );
    }

    const stations = STATION_U.map((target) => nearestCenter(pos, frame, rim, target));
    const met = metIndices(pos, frame, rim);
    if (met.length < 5) throw new Error(`met-head sample has ${met.length} vertices at u=${MET_HEAD_U}`);
    return { seat, rim: rimPt, stations, met };
}

/** Reject a seat index that is not the lowest heel-seat point. */
export function assertIsLowestHeelSeat(
    pos: Float32Array,
    rimLocal: readonly number[],
    seatIndex: number,
): void {
    const seat = selectLowestHeelSeat(heelCupCandidates(pos, rimLocal));
    if (seat.i !== seatIndex) {
        throw new Error(
            `seat index ${seatIndex} is not the lowest heel-seat point ${seat.i} (u=${seat.u.toFixed(4)} z=${seat.z.toFixed(3)})`,
        );
    }
}

function zOf(pos: Float32Array, i: number): number {
    return pos[i * 3 + 2] ?? Number.NaN;
}

/** Added height of the lift-0 samples, read at the same vertex indices. */
export function compareLift(
    zero: SheetSample,
    zeroPos: Float32Array,
    liftPos: Float32Array,
    belt: BeltSample,
    plate: PlateSample,
): LiftComparison {
    if (liftPos.length < zeroPos.length) {
        throw new Error(`lift mesh has ${liftPos.length / 3} vertices, lift 0 has ${zeroPos.length / 3}`);
    }
    const read = (i: number) => zOf(liftPos, i) - zOf(zeroPos, i);
    const dSeat = read(zero.seat.i);
    const dRim = read(zero.rim.i);
    let dMetMin = Infinity;
    let dMetMax = -Infinity;
    for (const i of zero.met) {
        const dz = read(i);
        if (dz < dMetMin) dMetMin = dz;
        if (dz > dMetMax) dMetMax = dz;
    }
    return {
        seatU: zero.seat.u,
        seatV: zero.seat.v,
        seatZ0: zero.seat.z,
        rimU: zero.rim.u,
        rimZ0: zero.rim.z,
        cupDepth0: zero.rim.z - zero.seat.z,
        dSeat,
        dRim,
        dCup: dRim - dSeat,
        dMetMin,
        dMetMax,
        stations: zero.stations.map((s) => ({ u: s.u, added: read(s.i) })),
        belt,
        plate,
    };
}

/**
 * Print/belt face under the posterior heel (u ≤ 0.20).
 * `count` is vertices within 0.02 mm of z = 0. `minZ` is the lowest heel vertex.
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
        const along = pos[i * 3 + lengthAxis] ?? Number.NaN;
        const u = (along - lenMin) / span;
        if (u > BELT_U_MAX) continue;
        const z = pos[i * 3 + thickAxis] ?? Number.NaN;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
        if (Math.abs(z) <= BELT_FACE_Z_MM) count++;
    }
    if (!Number.isFinite(minZ)) return { count: 0, minZ: Number.NaN, maxZ: Number.NaN };
    return { count, minZ, maxZ };
}

export function gradeHeelLift(H: number, row: LiftComparison): GradeResult {
    const failures: string[] = [];
    if (!(Math.abs(row.dSeat - H) <= SEAT_TOL_MM)) {
        failures.push(
            `seat rise ${row.dSeat.toFixed(3)} mm at the lowest heel-seat point u=${row.seatU.toFixed(3)} v=${row.seatV.toFixed(3)} is outside ${H} ± ${SEAT_TOL_MM}`,
        );
    }
    if (Math.abs(row.dCup) > CUP_DEPTH_TOL_MM) {
        failures.push(
            `cup depth change ${row.dCup.toFixed(3)} mm (rim z − seat z; dRim ${row.dRim.toFixed(3)}, dSeat ${row.dSeat.toFixed(3)}) exceeds ± ${CUP_DEPTH_TOL_MM}`,
        );
    }
    const ordered = [
        ...row.stations,
        { u: row.seatU, added: row.dSeat },
        { u: MET_HEAD_U, added: row.dMetMax },
    ];
    ordered.sort((a, b) => a.u - b.u);
    for (let i = 1; i < ordered.length; i++) {
        const prev = ordered[i - 1];
        const next = ordered[i];
        if (!prev || !next) continue;
        if (next.added > prev.added + MONOTONE_SLACK_MM) {
            failures.push(
                `added height rises from u=${prev.u.toFixed(3)} (${prev.added.toFixed(3)} mm) to u=${next.u.toFixed(3)} (${next.added.toFixed(3)} mm)`,
            );
        }
    }
    if (!Number.isFinite(row.dMetMin) || !Number.isFinite(row.dMetMax)) {
        failures.push(`met-head station u=${MET_HEAD_U} missing`);
    } else if (row.dMetMax > MET_HEAD_TOL_MM || row.dMetMin < -MET_HEAD_TOL_MM) {
        failures.push(
            `met-head added height ${row.dMetMin.toFixed(3)}..${row.dMetMax.toFixed(3)} mm at u=${MET_HEAD_U} exceeds ± ${MET_HEAD_TOL_MM}`,
        );
    }
    if (row.belt.count < BELT_FACE_MIN_COUNT) {
        failures.push(
            `print/belt face under the heel has ${row.belt.count} vertices within ${BELT_FACE_Z_MM} mm of z=0 (need ≥ ${BELT_FACE_MIN_COUNT})`,
        );
    } else if (row.belt.minZ < -BELT_TOL_MM || row.belt.minZ > BELT_TOL_MM) {
        failures.push(
            `print/belt min z under the heel is ${row.belt.minZ.toFixed(3)} mm, need 0 ± ${BELT_TOL_MM}`,
        );
    }
    const dMesh = Math.abs(row.plate.meshMinZ - row.plate.zeroMeshMinZ);
    const dPlant = Math.abs(row.plate.plantarAbsMaxZ - row.plate.zeroPlantarAbsMaxZ);
    if (dMesh > BELT_TOL_MM || Math.abs(row.plate.meshMinZ) > BELT_TOL_MM) {
        failures.push(
            `meshMinZ ${row.plate.meshMinZ.toFixed(3)} changed from lift 0 ${row.plate.zeroMeshMinZ.toFixed(3)} by more than ${BELT_TOL_MM} or left z=0`,
        );
    }
    if (dPlant > BELT_TOL_MM || row.plate.plantarAbsMaxZ > BELT_TOL_MM) {
        failures.push(
            `plantarAbsMaxZ ${row.plate.plantarAbsMaxZ.toFixed(3)} changed from lift 0 ${row.plate.zeroPlantarAbsMaxZ.toFixed(3)} by more than ${BELT_TOL_MM}`,
        );
    }
    return { pass: failures.length === 0, failures };
}
