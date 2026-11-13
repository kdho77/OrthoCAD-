// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { AFO_TRIM_DISPLAY_NORMAL_MM, AFO_TRIM_DRAW_OFFSET_MM } from "./defaults";
import { meshProjector } from "./mesh-ops";
import { trimDisplayPoints } from "./trim-spline";
import type { AfoTriMesh, AfoVec3 } from "./types";

function creaseMesh(): AfoTriMesh {
    const positions = [-10, 0, 0, 10, 0, 0, -10, 20, 0, 10, 20, 0, -10, 0, 20, 10, 0, 20];
    const indices = [0, 1, 2, 1, 3, 2, 0, 4, 1, 1, 5, 4];
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function curve(): AfoVec3[] {
    const points: AfoVec3[] = [];
    for (let x = -8; x <= 8; x += 1) {
        if (x < 0) points.push({ x, y: 0.4, z: 0 });
        else points.push({ x, y: 0, z: 0.4 });
    }
    return points;
}

function angleBetween(a: AfoVec3, b: AfoVec3): number {
    const al = Math.hypot(a.x, a.y, a.z) || 1;
    const bl = Math.hypot(b.x, b.y, b.z) || 1;
    const c = Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y + a.z * b.z) / (al * bl)));
    return (Math.acos(c) * 180) / Math.PI;
}

function maxStepAngle(points: AfoVec3[], lifted: AfoVec3[]): number {
    let max = 0;
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        const prevLift = lifted[i - 1];
        const curLift = lifted[i];
        if (!prev || !cur || !prevLift || !curLift) continue;
        max = Math.max(
            max,
            angleBetween(
                { x: prevLift.x - prev.x, y: prevLift.y - prev.y, z: prevLift.z - prev.z },
                { x: curLift.x - cur.x, y: curLift.y - cur.y, z: curLift.z - cur.z },
            ),
        );
    }
    return max;
}

describe("AFO trim display offset", () => {
    test("the yellow stroke lifts along a 4 mm averaged normal, not the raw face normal", () => {
        expect(AFO_TRIM_DISPLAY_NORMAL_MM).toBe(4);
        const mesh = creaseMesh();
        const points = curve();
        const projector = meshProjector(mesh);
        const raw = points.map((point) => {
            const normal = projector.closest(point).normal;
            return {
                x: point.x + normal.x * AFO_TRIM_DRAW_OFFSET_MM,
                y: point.y + normal.y * AFO_TRIM_DRAW_OFFSET_MM,
                z: point.z + normal.z * AFO_TRIM_DRAW_OFFSET_MM,
            };
        });
        const averaged = trimDisplayPoints(mesh, points);
        expect(averaged.length).toBe(points.length);
        const rawTurn = maxStepAngle(points, raw);
        const smoothTurn = maxStepAngle(points, averaged);
        expect(rawTurn).toBeGreaterThan(45);
        expect(smoothTurn).toBeLessThan(rawTurn);
        const moved = averaged.some((point, index) => {
            const source = points[index];
            if (!source) return false;
            return Math.hypot(point.x - source.x, point.y - source.y, point.z - source.z) > 0.05;
        });
        expect(moved).toBe(true);
    });
});
