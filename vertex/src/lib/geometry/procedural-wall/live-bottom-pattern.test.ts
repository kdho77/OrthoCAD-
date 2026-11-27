// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { buildTrimPresetCurve } from "@/lib/geometry/trim-presets";
import { extractMeshOutline, type TrimlineCurve } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import {
    hashLiveBottomPattern,
    livePatternMarksSolidStale,
    resolveLiveBottomPattern,
} from "./live-bottom-pattern";
import { hashPatternPoints, proceduralLoftReuseKey } from "./preview-loft-ui";
import { buildProceduralViewerPattern, sampleTopFromArrayBuffer } from "./sample-top-preview";

describe("live bottom pattern at Print generate", () => {
    test("Print reads the live stored curve, not a load/Base snapshot key", () => {
        const stored = {
            points: [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(80, 12, 0),
                new THREE.Vector3(160, 0, 0),
                new THREE.Vector3(80, -10, 0),
            ],
        };
        const live = resolveLiveBottomPattern({ draft: null, stored });
        expect(live).toHaveLength(4);
        expect(live?.[1]?.y).toBe(12);
        const snapshotKey = "sample-top:p:full_contact:hw0.00:wmedium";
        expect(hashLiveBottomPattern(live)).not.toBe(snapshotKey);
    });

    test("manual Edit-bottom-pattern draft wins over the stored curve", () => {
        const stored = {
            points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 8, 0)],
        };
        const draft = {
            points: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(10, 2, 0), new THREE.Vector3(10, 9, 0)],
        };
        const live = resolveLiveBottomPattern({ draft, stored });
        expect(live?.[0]?.y).toBe(1);
        expect(live?.[1]?.y).toBe(2);
    });

    test("editing the pattern after a solid was built marks the solid stale", () => {
        const built = [
            { x: 0, y: 0, z: 0 },
            { x: 40, y: 8, z: 0 },
            { x: 80, y: 0, z: 0 },
        ];
        const builtHash = hashPatternPoints(built);
        const edited = built.map((p, i) => (i === 1 ? { ...p, y: p.y + 3.5 } : p));
        expect(livePatternMarksSolidStale(builtHash, edited)).toBe(true);
        expect(livePatternMarksSolidStale(builtHash, built)).toBe(false);
        const keyA = proceduralLoftReuseKey({
            side: "left",
            wallStyle: "straight",
            deviceType: "functional",
            thicknessMm: 3,
            correctionsJson: "{}",
            scanPattern: "full_contact",
            patternKind: "live",
            patternHash: hashLiveBottomPattern(built),
            flanges: "0:40:10",
        });
        const keyB = proceduralLoftReuseKey({
            side: "left",
            wallStyle: "straight",
            deviceType: "functional",
            thicknessMm: 3,
            correctionsJson: "{}",
            scanPattern: "full_contact",
            patternKind: "live",
            patternHash: hashLiveBottomPattern(edited),
            flanges: "0:40:10",
        });
        expect(keyA).not.toBe(keyB);
    });
});

function lengthOf(points: Array<{ x: number; y: number }>) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    if (maxX - minX >= maxY - minY) {
        return { heel: minX, toe: maxX, of: (p: { x: number; y: number }) => p.x };
    }
    return { heel: minY, toe: maxY, of: (p: { x: number; y: number }) => p.y };
}

function pointInPolygon(x: number, y: number, poly: Array<{ x: number; y: number }>): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i]!.x;
        const yi = poly[i]!.y;
        const xj = poly[j]!.x;
        const yj = poly[j]!.y;
        const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersects) inside = !inside;
    }
    return inside;
}

function distToPolyline(p: { x: number; y: number }, poly: Array<{ x: number; y: number }>): number {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const lenSq = abx * abx + aby * aby;
        const t =
            lenSq < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
        best = Math.min(best, Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t)));
    }
    return best;
}

function segmentsCross(
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
    d: { x: number; y: number },
): boolean {
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-10) return false;
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

function selfIntersects(poly: Array<{ x: number; y: number }>): boolean {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % n]!;
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            if (segmentsCross(a, b, poly[j]!, poly[(j + 1) % n]!)) return true;
        }
    }
    return false;
}

describe("sulcus and 3/4 shorten the live bottom pattern with the top", () => {
    test("anterior bound matches the trimmed outline on both feet; full is unchanged", async () => {
        const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
        const native = await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        const mirrored = mirrorGeometry(native.clone());
        try {
            for (const side of ["left", "right"] as const) {
                const mesh = side === "left" ? native : mirrored;
                const outline = extractMeshOutline(mesh, 64);
                expect(outline, `${side} outline`).toBeTruthy();
                const patternPts = buildProceduralViewerPattern(mesh, "full_contact");
                const stored: TrimlineCurve = {
                    points: patternPts.map((p) => new THREE.Vector3(p.x, p.y, p.z ?? 0)),
                };
                const foot = lengthOf(outline!.points);
                const presetOpts = {
                    lengthMm: foot.toe - foot.heel,
                    widthMm: 95,
                    baseCurve: outline!,
                    footSide: side,
                };
                const full = buildTrimPresetCurve("full", presetOpts);
                const uncut = resolveLiveBottomPattern({ draft: null, stored, trim: full });
                expect(uncut).toHaveLength(stored.points.length);
                for (let i = 0; i < stored.points.length; i++) {
                    expect(uncut?.[i]?.x).toBe(stored.points[i]!.x);
                    expect(uncut?.[i]?.y).toBe(stored.points[i]!.y);
                }
                const open = resolveLiveBottomPattern({ draft: null, stored, trim: null });
                expect(open?.[0]?.x).toBe(stored.points[0]!.x);
                expect(open).toHaveLength(stored.points.length);

                const patternFrame = lengthOf(patternPts);
                for (const preset of ["sulcus", "met_head"] as const) {
                    const trim = buildTrimPresetCurve(preset, presetOpts);
                    const ended = resolveLiveBottomPattern({ draft: null, stored, trim });
                    expect(ended && ended.length > 8, `${preset} ${side}`).toBe(true);
                    const endedFrame = lengthOf(ended!);
                    const trimFrame = lengthOf(trim.points);
                    const label = `${preset} ${side}`;
                    expect(Math.abs(endedFrame.toe - trimFrame.toe), label).toBeLessThan(1.5);
                    expect(endedFrame.toe, label).toBeLessThan(patternFrame.toe - 40);
                    expect(Math.abs(endedFrame.heel - patternFrame.heel), label).toBeLessThan(0.05);
                    expect(selfIntersects(ended!), label).toBe(false);
                    const proximal = stored.points.filter((p) => {
                        const u =
                            (patternFrame.of(p) - patternFrame.heel) / (patternFrame.toe - patternFrame.heel);
                        return u < 0.35;
                    });
                    expect(proximal.length, label).toBeGreaterThan(8);
                    for (const p of proximal) {
                        const kept = ended!.some((q) => q.x === p.x && q.y === p.y);
                        expect(kept, label).toBe(true);
                    }
                    for (const p of ended!) {
                        const on =
                            pointInPolygon(p.x, p.y, trim.points) || distToPolyline(p, trim.points) < 0.75;
                        expect(on, label).toBe(true);
                    }
                    const cap = ended!.filter((p) => trimFrame.of(p) > trimFrame.toe - 12);
                    expect(cap.length, label).toBeGreaterThan(3);
                    for (const p of cap) {
                        expect(distToPolyline(p, trim.points), label).toBeLessThan(1.25);
                    }
                }
            }
        } finally {
            mirrored.dispose();
            native.dispose();
        }
    });
});
