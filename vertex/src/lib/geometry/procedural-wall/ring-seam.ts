// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { lowCurvatureStartIndex, type PolyPoint, rotateClosed } from "./curves";
import type { HermiteStation } from "./loft";

export const RING_WRAP_MIN_MM = 1e-4;

export function rotateStationRing(
    stations: HermiteStation[],
    rimLocal: number[],
    bounds?: { minX: number; maxX: number },
): number {
    const n = Math.min(stations.length, rimLocal.length);
    if (n < 3) return 0;
    const start = lowCurvatureStartIndex(
        stations.slice(0, n).map((s) => s.rim),
        bounds,
    );
    if (start === 0) return 0;
    const nextSt = rotateClosed(stations.slice(0, n), start);
    const nextRim = rotateClosed(rimLocal.slice(0, n), start);
    stations.length = 0;
    for (const s of nextSt) stations.push(s);
    rimLocal.length = 0;
    for (const r of nextRim) rimLocal.push(r);
    return start;
}

/** First/last are distinct; every consecutive pair including the wrap is a real edge. */
export function assertClosedStationRing(
    stations: Array<{ rim: PolyPoint; outline: PolyPoint }>,
    rimLocal: number[],
): void {
    const n = Math.min(stations.length, rimLocal.length);
    if (n < 3) {
        throw new Error(`[S1-RING] station ring has ${n} stations`);
    }
    if (rimLocal[0] === rimLocal[n - 1]) {
        throw new Error(`[S1-RING] duplicate wrap rim index ${rimLocal[0]}`);
    }
    const r0 = stations[0]!.rim;
    const r1 = stations[n - 1]!.rim;
    const b0 = stations[0]!.outline;
    const b1 = stations[n - 1]!.outline;
    const dR = Math.hypot(r0.x - r1.x, r0.y - r1.y, r0.z - r1.z);
    const dB = Math.hypot(b0.x - b1.x, b0.y - b1.y);
    if (dR < RING_WRAP_MIN_MM) {
        throw new Error(`[S1-RING] duplicate first/last R (${dR.toFixed(5)} mm)`);
    }
    if (dB < RING_WRAP_MIN_MM) {
        throw new Error(`[S1-RING] duplicate first/last B (${dB.toFixed(5)} mm)`);
    }
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (rimLocal[i] === rimLocal[j]) {
            throw new Error(`[S1-RING] consecutive stations ${i}/${j} share rim index ${rimLocal[i]}`);
        }
    }
}

/** Closing quad strip i=nS-1 uses stations nS-1 and 0 (shared edges with station 0). */
export function assertPeriodicQuadStrip(
    nS: number,
    nJ: number,
    vert: (j: number, i: number) => number,
): void {
    if (nS < 3 || nJ < 2) {
        throw new Error(`[S1-RING] quad strip nS=${nS} nJ=${nJ}`);
    }
    for (let j = 0; j < nJ; j++) {
        if (vert(j, nS) !== vert(j, 0)) {
            throw new Error(`[S1-RING] row ${j}: vert(nS) != vert(0)`);
        }
        if (vert(j, -1) !== vert(j, nS - 1)) {
            throw new Error(`[S1-RING] row ${j}: vert(-1) != vert(nS-1)`);
        }
    }
    const a = vert(0, nS - 1);
    const b = vert(0, 0);
    const c = vert(1, 0);
    const d = vert(1, nS - 1);
    if (a === b || b === c || c === d || d === a) {
        throw new Error(`[S1-RING] closing strip degenerates: ${a},${b},${c},${d}`);
    }
}
