// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Place the production sacrificial leader on an uploaded insole.
 *
 * The block itself is `applySacrificialLeaderBlock` (15 mm neck, 3 mm thick,
 * far end 30 mm, embed into the toe). This module only turns the upload into
 * the frame that function already requires: toe at max X, sole on Z = 0.
 * The insole is then turned back, so the file keeps the orientation the
 * slicer already sends to the belt and the leader sticks out of the toe.
 *
 * Uploads do not carry a known toe or sole. When the long axis, the thickness
 * axis, or a flat sole is not obvious, this refuses instead of guessing.
 */

import {
    applySacrificialLeaderBlock,
    LeaderBlockOrientationError,
} from "../../src/lib/geometry/leader-block";
import type { VertexSlicePrintDirection } from "../vertexslice/contract";

export const LEADER_UNCERTAIN_DIRECTION =
    "Can't tell which way this insole points. Turn the leader off to slice the file unchanged.";
export const LEADER_UNCERTAIN_BOTTOM =
    "Can't find a flat sole. Turn the leader off, or switch Toe first / Heel first if the marked end is the heel.";
export const LEADER_NOT_THINNER_TOE =
    "That end is not the thinner toe. Switch Toe first / Heel first, or turn the leader off.";
export const LEADER_NEEDS_STL = "The sacrificial leader needs an STL. Turn it off to slice this file.";
export const LEADER_INCHES =
    "Treat as inches only rescales the preview. Upload a millimeter STL before adding the leader, or turn it off.";
export const LEADER_NOT_MILLIMETERS =
    "This file doesn't look like a millimeter insole. Turn the leader off to slice it unchanged.";
export const LEADER_FAILED =
    "The leader could not be fused to this toe. Switch Toe first / Heel first, or turn the leader off.";

const LENGTH_WIDTH_RATIO = 1.45;
const WIDTH_HEIGHT_RATIO = 2.2;
const MIN_LENGTH_MM = 120;
const MAX_LENGTH_MM = 420;
const MIN_HEIGHT_MM = 2;
const MAX_HEIGHT_MM = 40;
const SOLE_STD_MM = 0.85;
const SOLE_COUNT_RATIO = 1.35;

type Axis = 0 | 1 | 2;
type Vec3 = [number, number, number];

export interface PositionBounds {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
}

export type LeaderAttachResult =
    | { ok: true; bytes: Uint8Array; positions: Float32Array; bounds: PositionBounds }
    | { ok: false; message: string };

interface Frame {
    toeAxis: Vec3;
    sideAxis: Vec3;
    upAxis: Vec3;
    zShift: number;
}

export function slicerLengthAxis(size: readonly [number, number, number]): Axis {
    let axis: Axis = 0;
    if (size[1] > size[axis]) axis = 1;
    if (size[2] > size[axis]) axis = 2;
    return axis;
}

/** Toe end the preview marks. Toe first keeps today's max-of-the-longest-axis end. */
export function slicerToeCoordinate(
    bounds: PositionBounds,
    printDirection: VertexSlicePrintDirection,
): { axis: Axis; at: number } {
    const axis = slicerLengthAxis(bounds.size);
    const at = printDirection === "heel_first" ? bounds.min[axis] : bounds.max[axis];
    return { axis, at };
}

export function attachSacrificialLeader(
    bytes: Uint8Array,
    printDirection: VertexSlicePrintDirection,
): LeaderAttachResult {
    const positions = positionsFromStl(bytes);
    if (!positions) return { ok: false, message: LEADER_NEEDS_STL };
    return attachPositions(positions, printDirection, bytes);
}

export function attachLeaderToPositions(
    positions: Float32Array,
    printDirection: VertexSlicePrintDirection,
): LeaderAttachResult {
    if (positions.length < 9 || positions.length % 9 !== 0) {
        return { ok: false, message: LEADER_NEEDS_STL };
    }
    return attachPositions(positions, printDirection, null);
}

function attachPositions(
    positions: Float32Array,
    printDirection: VertexSlicePrintDirection,
    originalBytes: Uint8Array | null,
): LeaderAttachResult {
    const bounds = positionBounds(positions);
    const frame = frameForUpload(positions, bounds, printDirection);
    if (!frame.ok) return frame;
    try {
        const cadPositions = isIdentityFrame(frame.frame)
            ? null
            : mapPositions(positions, (p) => toCad(p, frame.frame));
        const cadBytes = cadPositions
            ? writeBinaryStl(cadPositions).buffer
            : stlBytes(originalBytes, positions);
        const withLeader = applySacrificialLeaderBlock(cadBytes);
        const leaderPositions = isIdentityFrame(frame.frame)
            ? positionsFromBinary(withLeader)
            : mapPositions(positionsFromBinary(withLeader), (p) => fromCad(p, frame.frame));
        const outBytes = isIdentityFrame(frame.frame)
            ? new Uint8Array(withLeader)
            : writeBinaryStl(leaderPositions);
        return {
            ok: true,
            bytes: outBytes,
            positions: leaderPositions,
            bounds: positionBounds(leaderPositions),
        };
    } catch (err) {
        if (err instanceof LeaderBlockOrientationError) {
            return { ok: false, message: LEADER_NOT_THINNER_TOE };
        }
        return { ok: false, message: LEADER_FAILED };
    }
}

function stlBytes(original: Uint8Array | null, positions: Float32Array): ArrayBuffer {
    if (original && isBinaryStl(original)) {
        return original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength);
    }
    return writeBinaryStl(positions).buffer;
}

function frameForUpload(
    positions: Float32Array,
    bounds: PositionBounds,
    printDirection: VertexSlicePrintDirection,
): { ok: true; frame: Frame } | { ok: false; message: string } {
    const ranked = [0, 1, 2].sort((a, b) => bounds.size[b] - bounds.size[a]) as [Axis, Axis, Axis];
    const lengthAxis = ranked[0];
    const widthAxis = ranked[1];
    const heightAxis = ranked[2];
    const length = bounds.size[lengthAxis];
    const width = bounds.size[widthAxis];
    const height = bounds.size[heightAxis];
    if (!(length > 0) || length / Math.max(width, 1e-6) < LENGTH_WIDTH_RATIO) {
        return { ok: false, message: LEADER_UNCERTAIN_DIRECTION };
    }
    if (width / Math.max(height, 1e-6) < WIDTH_HEIGHT_RATIO) {
        return { ok: false, message: LEADER_UNCERTAIN_BOTTOM };
    }
    if (
        length < MIN_LENGTH_MM ||
        length > MAX_LENGTH_MM ||
        height < MIN_HEIGHT_MM ||
        height > MAX_HEIGHT_MM
    ) {
        return { ok: false, message: LEADER_NOT_MILLIMETERS };
    }
    const sole = soleEnd(positions, heightAxis, bounds.min[heightAxis], bounds.max[heightAxis], height);
    if (!sole) return { ok: false, message: LEADER_UNCERTAIN_BOTTOM };
    const toeSign = printDirection === "heel_first" ? -1 : 1;
    const upSign = sole === "min" ? 1 : -1;
    const toeAxis = axisVector(lengthAxis, toeSign);
    const upAxis = axisVector(heightAxis, upSign);
    const sideAxis = cross(upAxis, toeAxis);
    let zShift = Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const z = positions[i] * upAxis[0] + positions[i + 1] * upAxis[1] + positions[i + 2] * upAxis[2];
        if (z < zShift) zShift = z;
    }
    if (!Number.isFinite(zShift)) return { ok: false, message: LEADER_UNCERTAIN_BOTTOM };
    return { ok: true, frame: { toeAxis, sideAxis, upAxis, zShift } };
}

function soleEnd(
    positions: Float32Array,
    axis: Axis,
    min: number,
    max: number,
    height: number,
): "min" | "max" | null {
    const band = Math.max(0.75, height * 0.06);
    const low = faceStats(positions, axis, (v) => v <= min + band);
    const high = faceStats(positions, axis, (v) => v >= max - band);
    if (low.count < 12 && high.count < 12) return null;
    const lowFlat = low.std <= SOLE_STD_MM;
    const highFlat = high.std <= SOLE_STD_MM;
    if (lowFlat && highFlat) {
        if (low.count >= high.count * SOLE_COUNT_RATIO) return "min";
        if (high.count >= low.count * SOLE_COUNT_RATIO) return "max";
        return null;
    }
    if (lowFlat && low.count >= 12 && (!highFlat || low.count >= high.count)) return "min";
    if (highFlat && high.count >= 12) return "max";
    return null;
}

function faceStats(
    positions: Float32Array,
    axis: Axis,
    near: (value: number) => boolean,
): { count: number; std: number } {
    let count = 0;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < positions.length; i += 3) {
        const value = positions[i + axis] ?? 0;
        if (!near(value)) continue;
        count += 1;
        sum += value;
        sumSq += value * value;
    }
    if (count === 0) return { count: 0, std: Infinity };
    const mean = sum / count;
    return { count, std: Math.sqrt(Math.max(0, sumSq / count - mean * mean)) };
}

function isIdentityFrame(frame: Frame): boolean {
    return (
        sameVec(frame.toeAxis, [1, 0, 0]) &&
        sameVec(frame.sideAxis, [0, 1, 0]) &&
        sameVec(frame.upAxis, [0, 0, 1]) &&
        Math.abs(frame.zShift) < 1e-3
    );
}

function toCad(p: Vec3, frame: Frame): Vec3 {
    return [dot(p, frame.toeAxis), dot(p, frame.sideAxis), dot(p, frame.upAxis) - frame.zShift];
}

function fromCad(p: Vec3, frame: Frame): Vec3 {
    const z = p[2] + frame.zShift;
    return [
        frame.toeAxis[0] * p[0] + frame.sideAxis[0] * p[1] + frame.upAxis[0] * z,
        frame.toeAxis[1] * p[0] + frame.sideAxis[1] * p[1] + frame.upAxis[1] * z,
        frame.toeAxis[2] * p[0] + frame.sideAxis[2] * p[1] + frame.upAxis[2] * z,
    ];
}

function mapPositions(positions: Float32Array, map: (p: Vec3) => Vec3): Float32Array {
    const out = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
        const next = map([positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0]);
        out[i] = next[0];
        out[i + 1] = next[1];
        out[i + 2] = next[2];
    }
    return out;
}

export function positionBounds(positions: Float32Array): PositionBounds {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
        for (let axis = 0; axis < 3; axis++) {
            const value = positions[i + axis] ?? 0;
            if (value < min[axis]) min[axis] = value;
            if (value > max[axis]) max[axis] = value;
        }
    }
    return {
        min,
        max,
        size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    };
}

function positionsFromStl(bytes: Uint8Array): Float32Array | null {
    if (isBinaryStl(bytes))
        return positionsFromBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (isAsciiStl(bytes)) return positionsFromAscii(bytes);
    return null;
}

function isBinaryStl(bytes: Uint8Array): boolean {
    if (bytes.byteLength < 84) return false;
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    return count > 0 && 84 + count * 50 <= bytes.byteLength;
}

function isAsciiStl(bytes: Uint8Array): boolean {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(
        bytes.subarray(0, Math.min(bytes.byteLength, 256)),
    );
    return /^\s*solid/i.test(head);
}

function positionsFromBinary(buffer: ArrayBuffer): Float32Array {
    const view = new DataView(buffer);
    const count = view.getUint32(80, true);
    const positions = new Float32Array(count * 9);
    let o = 0;
    for (let tri = 0; tri < count; tri++) {
        const base = 84 + tri * 50 + 12;
        for (let k = 0; k < 9; k++) positions[o++] = view.getFloat32(base + k * 4, true);
    }
    return positions;
}

function positionsFromAscii(bytes: Uint8Array): Float32Array | null {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const verts: number[] = [];
    const re = /vertex\s+([-+eE.\d]+)\s+([-+eE.\d]+)\s+([-+eE.\d]+)/g;
    let match = re.exec(text);
    while (match) {
        verts.push(Number(match[1]), Number(match[2]), Number(match[3]));
        match = re.exec(text);
    }
    if (verts.length < 9 || verts.length % 9 !== 0) return null;
    return Float32Array.from(verts);
}

function writeBinaryStl(positions: Float32Array): Uint8Array {
    const count = positions.length / 9;
    const buffer = new ArrayBuffer(84 + count * 50);
    const view = new DataView(buffer);
    view.setUint32(80, count, true);
    let offset = 84;
    for (let i = 0; i < positions.length; i += 9) {
        const ax = positions[i] ?? 0;
        const ay = positions[i + 1] ?? 0;
        const az = positions[i + 2] ?? 0;
        const bx = positions[i + 3] ?? 0;
        const by = positions[i + 4] ?? 0;
        const bz = positions[i + 5] ?? 0;
        const cx = positions[i + 6] ?? 0;
        const cy = positions[i + 7] ?? 0;
        const cz = positions[i + 8] ?? 0;
        const n = triangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
        view.setFloat32(offset, n[0], true);
        view.setFloat32(offset + 4, n[1], true);
        view.setFloat32(offset + 8, n[2], true);
        offset += 12;
        for (const value of [ax, ay, az, bx, by, bz, cx, cy, cz]) {
            view.setFloat32(offset, value, true);
            offset += 4;
        }
        view.setUint16(offset, 0, true);
        offset += 2;
    }
    return new Uint8Array(buffer);
}

function triangleNormal(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
): Vec3 {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
}

function axisVector(axis: Axis, sign: 1 | -1): Vec3 {
    const v: Vec3 = [0, 0, 0];
    v[axis] = sign;
    return v;
}

function cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sameVec(a: Vec3, b: Vec3): boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
