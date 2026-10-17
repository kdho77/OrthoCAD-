// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { sampleDrop } from "./drop-cutter";
import { bboxOf, distToPoly, ensureCw, offsetClosed, pointInPoly, resampleClosed } from "./polygon";
import { stepoverMm } from "./profile";
import type { Heightmap, MillingProfile, Point, ToolType } from "./types";

export interface XyPoint {
    x: number;
    y: number;
}

function rasterFill(ring: Point[], stepover: number, sample: number): XyPoint[] {
    if (ring.length < 4) return [];
    const bb = bboxOf(ring);
    const pts: XyPoint[] = [];
    let even = true;
    for (let y = bb.minY + stepover * 0.5; y <= bb.maxY; y += stepover) {
        const xs: number[] = [];
        for (let x = bb.minX; x <= bb.maxX; x += sample) {
            if (pointInPoly(x, y, ring)) xs.push(x);
        }
        if (xs.length < 2) continue;
        if (!even) xs.reverse();
        for (const x of xs) pts.push({ x, y });
        even = !even;
    }
    return pts;
}

export function spiralXy(outline: Point[], profile: MillingProfile, toolType: ToolType): XyPoint[] {
    const step = stepoverMm(profile, toolType);
    const spacing = Math.max(0.8, step);
    // Offset every ring from a resampled source. Chained 0.01 mm clipper offsets explode
    // vertex count on SAMPLE_Top and miss the 10 s export gate.
    const chord = Math.max(0.2, profile.chordTolMm);
    const source = resampleClosed(outline, spacing);
    const rings: Point[][] = [];
    for (let k = 0; k < 80; k++) {
        const next = offsetClosed(source, profile.topOffsetMm - k * step, chord);
        if (next.length < 8) break;
        const bb = bboxOf(next);
        if (bb.maxX - bb.minX < step * 2 || bb.maxY - bb.minY < step * 2) break;
        rings.push(ensureCw(resampleClosed(next, spacing)));
    }
    if (rings.length === 0) return [];
    const nAlign = Math.min(480, Math.max(...rings.map((r) => r.length)));
    const aligned = rings.map((r) => resampleClosed(r, perimeterSafe(r) / nAlign));
    const path: XyPoint[] = [];
    for (let i = 0; i < aligned.length - 1; i++) {
        const a = aligned[i]!;
        const b = aligned[i + 1]!;
        const n = Math.min(a.length, b.length);
        for (let k = 0; k < n; k++) {
            const t = k / n;
            const p = a[k]!;
            const q = b[k]!;
            path.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        }
    }
    if (aligned.length) {
        const last = aligned[aligned.length - 1]!;
        path.push(...last.map((p) => ({ x: p.x, y: p.y })));
        path.push(...rasterFill(last, step, spacing));
    }
    return path;
}

function perimeterSafe(pts: Point[]): number {
    let l = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        l += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return Math.max(1, l);
}

export function zigzagXy(outline: Point[], profile: MillingProfile, toolType: ToolType): XyPoint[] {
    const step = stepoverMm(profile, toolType);
    const region = offsetClosed(outline, profile.topOffsetMm, profile.chordTolMm);
    if (region.length < 4) return [];
    const bb = bboxOf(region);
    const sample = Math.max(profile.sampleMm, 0.25);
    const pts: XyPoint[] = [];
    let even = true;
    for (let y = bb.minY; y <= bb.maxY; y += step) {
        const xs: number[] = [];
        for (let x = bb.minX; x <= bb.maxX; x += sample) {
            if (pointInPoly(x, y, region) || distToPoly(x, y, outline) <= profile.topOffsetMm) xs.push(x);
        }
        if (xs.length < 2) continue;
        if (!even) xs.reverse();
        for (const x of xs) pts.push({ x, y });
        even = !even;
    }
    return pts;
}

export function surfacePath(
    outline: Point[],
    profile: MillingProfile,
    dropMap: Heightmap,
    toolType: ToolType,
    levelZ: number,
    skin: number,
): Point[] {
    const xy =
        profile.strategy === "zigzag"
            ? zigzagXy(outline, profile, toolType)
            : spiralXy(outline, profile, toolType);
    const out: Point[] = [];
    for (const p of xy) {
        const drop = sampleDrop(dropMap, p.x, p.y);
        if (!Number.isFinite(drop)) continue;
        out.push({ x: p.x, y: p.y, z: Math.max(drop, levelZ, skin) });
    }
    return out;
}

export function waterlineLevels(profile: MillingProfile, zMin: number): number[] {
    const step = Math.max(0.1, profile.layeredEnabled ? profile.layeredMm : profile.materialHeightMm);
    const levels: number[] = [];
    for (let z = profile.materialHeightMm - step; z > zMin + 1e-6; z -= step) levels.push(z);
    return levels;
}
