// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { buildAfoShell, equatorialLoop } from "@/lib/geometry/afo/shell";
import { buildUnitSphereMesh } from "@/lib/geometry/afo/synthetic-leg";
import type { AfoTriMesh } from "@/lib/geometry/afo/types";
import {
    afoViewerDisplayTransform,
    bakeDisplayTransform,
    boxMesh,
    bufferGeometryFromMesh,
    exportedStlBounds,
    overallPrintSize,
    parallelWall,
    probeThickness,
    publishMeasureSolid,
    undoDisplayMesh,
} from "@/lib/geometry/measure";
import { afoMeasureSolidId, afoMeasureTarget } from "@/lib/geometry/measure/afo-target";
import { nearestSurfacePoint } from "@/lib/geometry/measure/mesh-ops";
import type { MeasureTriangleMesh, MeasureVec3 } from "@/lib/geometry/measure/types";
import { useMeasureStore } from "@/stores/measure-store";

function shellMesh(positions: Float32Array, indices: Uint32Array): MeasureTriangleMesh {
    return { positions, indices };
}

function vertexAt(mesh: MeasureTriangleMesh, index: number): MeasureVec3 {
    return {
        x: mesh.positions[index * 3] ?? 0,
        y: mesh.positions[index * 3 + 1] ?? 0,
        z: mesh.positions[index * 3 + 2] ?? 0,
    };
}

/** +X trim vertex on the source loop. The shell edge is measured at this tag. */
function taggedRimIndex(sphere: AfoTriMesh, loop: number[]): number {
    let tag = loop[0] ?? 0;
    let bestX = -Infinity;
    for (const index of loop) {
        const x = sphere.positions[index * 3] ?? 0;
        if (x > bestX) {
            bestX = x;
            tag = index;
        }
    }
    return tag;
}

/**
 * Outer wall at the shell's tagged rim. `rimFaceStart` marks the ruled rim;
 * the vertex just inside that band, paired with its inner twin, is the edge.
 */
function probeTaggedRim(shell: AfoTriMesh, tag: MeasureVec3): number | null {
    const mesh = shellMesh(shell.positions, shell.indices);
    const rimStart = shell.rimFaceStart;
    if (rimStart == null) return null;
    let maxWall = 0;
    for (let t = 0; t < rimStart; t++) {
        for (let k = 0; k < 3; k++) maxWall = Math.max(maxWall, shell.indices[t * 3 + k] ?? 0);
    }
    const n = (maxWall + 1) / 2;
    if (!Number.isInteger(n) || n < 2) return null;
    let pair = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
        const inner = vertexAt(mesh, i);
        const outer = vertexAt(mesh, n + i);
        const span = Math.hypot(outer.x - inner.x, outer.y - inner.y, outer.z - inner.z);
        if (Math.abs(span - 2.5) > 0.05) continue;
        const d = Math.hypot(outer.x - tag.x, outer.y - tag.y, outer.z - tag.z);
        if (d < best) {
            best = d;
            pair = i;
        }
    }
    if (pair < 0) return null;
    const inner = vertexAt(mesh, pair);
    const outer = vertexAt(mesh, n + pair);
    const inward = {
        x: inner.x - outer.x,
        y: inner.y - outer.y,
        z: inner.z - outer.z,
    };
    const len = Math.hypot(inward.x, inward.y, inward.z) || 1;
    const outside = {
        x: outer.x - (inward.x / len) * 0.4,
        y: outer.y - (inward.y / len) * 0.4,
        z: outer.z - (inward.z / len) * 0.4,
    };
    const snapped = nearestSurfacePoint(mesh, outside);
    if (!snapped) return null;
    return probeThickness(mesh, snapped.point, inward);
}

/** Land on the surface, then measure along the inward face normal. */
function probeWall(mesh: MeasureTriangleMesh, sample: MeasureVec3): number | null {
    const near = nearestSurfacePoint(mesh, sample);
    if (!near) return null;
    return probeThickness(mesh, near.point, {
        x: -near.normal.x,
        y: -near.normal.y,
        z: -near.normal.z,
    });
}

function mirrorX(mesh: MeasureTriangleMesh): MeasureTriangleMesh {
    const positions = mesh.positions.slice();
    for (let i = 0; i < positions.length; i += 3) positions[i] = -(positions[i] ?? 0);
    const indices = mesh.indices.slice();
    for (let i = 0; i + 2 < indices.length; i += 3) {
        const tmp = indices[i + 1] ?? 0;
        indices[i + 1] = indices[i + 2] ?? 0;
        indices[i + 2] = tmp;
    }
    return { positions, indices };
}

describe("AFO shell measurements", () => {
    test("before a shell, the cast or corrected positive is measured, not the scan", () => {
        expect(afoMeasureTarget({ shell: null, corrected: null, cast: "cast" })).toBe("cast");
        expect(afoMeasureTarget({ shell: null, corrected: "corrected", cast: "cast" })).toBe("corrected");
        expect(afoMeasureTarget({ shell: "shell", corrected: "corrected", cast: "cast" })).toBe("shell");
        expect(afoMeasureTarget({ shell: null, corrected: null, cast: null })).toBeNull();
    });

    test("footplate length is the +X axis", () => {
        const mesh = shellMesh(
            new Float32Array([0, 0, 0, 200, 0, 0, 0, 30, 0, 0, 0, 80]),
            new Uint32Array([0, 1, 2, 0, 2, 3]),
        );
        const overall = overallPrintSize(mesh, "afo");
        expect(overall.lengthMm).toBeCloseTo(200, 4);
        expect(overall.widthMm).toBeCloseTo(30, 4);
        expect(overall.heightMm).toBeCloseTo(80, 4);
    });

    test("4 / 2.5 / 2.5 shell probes about 4.03 mm in the body and 2.50 mm at the edge", () => {
        const sphere = buildUnitSphereMesh(30, 14);
        const loop = equatorialLoop(sphere);
        const shell = buildAfoShell(sphere, loop, {
            thicknessMm: 4,
            edgeMm: 2.5,
            flareMm: 2.5,
        });
        const mesh = shellMesh(shell.positions, shell.indices);
        const tagIndex = taggedRimIndex(sphere, loop);
        const tag = vertexAt(shellMesh(sphere.positions, sphere.indices), tagIndex);
        const bodyMm = probeWall(mesh, { x: 0, y: 0, z: -80 });
        const edgeMm = probeTaggedRim(shell, tag);
        expect(bodyMm, `body ${bodyMm}`).not.toBeNull();
        expect(edgeMm, `edge ${edgeMm}`).not.toBeNull();
        expect(Math.abs((bodyMm ?? 0) - 4.0), `body ${bodyMm}`).toBeLessThanOrEqual(0.1);
        expect(Math.abs((edgeMm ?? 0) - 2.5), `edge ${edgeMm}`).toBeLessThanOrEqual(0.1);

        const mirrored = mirrorX(mesh);
        const mirroredBody = probeWall(mirrored, { x: 0, y: 0, z: -80 });
        expect(Math.abs((mirroredBody ?? 0) - 4.0), `mirrored body ${mirroredBody}`).toBeLessThanOrEqual(0.1);

        const undone = undoDisplayMesh(
            bakeDisplayTransform(mesh, afoViewerDisplayTransform()),
            afoViewerDisplayTransform(),
        );
        const overall = overallPrintSize(undone, "afo");
        const stl = exportedStlBounds(undone);
        expect(Math.abs(overall.lengthMm - (stl.maxX - stl.minX))).toBeLessThanOrEqual(0.05);
        expect(Math.abs(overall.heightMm - (stl.maxZ - stl.minZ))).toBeLessThanOrEqual(0.05);
        expect(Math.abs(overall.widthMm - (stl.maxY - stl.minY))).toBeLessThanOrEqual(0.05);
    });

    test("thickness returns no reading above about 15 mm or on rim faces", () => {
        const across = probeThickness(parallelWall(49.6), { x: 0, y: 0, z: 49.6 }, { x: 0, y: 0, z: -1 });
        expect(across).toBeNull();
        const wall = probeThickness(parallelWall(10), { x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -1 });
        expect(wall).toBeCloseTo(10, 4);

        const box = boxMesh({ x: 0, y: 0, z: 0 }, { x: 49.6, y: 20, z: 4 });
        const throughWall = probeThickness(box, { x: 20, y: 10, z: 4 }, { x: 0, y: 0, z: -1 });
        expect(throughWall).not.toBeNull();
        expect(Math.abs((throughWall ?? 0) - 4)).toBeLessThanOrEqual(0.1);
        const endCap = probeThickness(box, { x: 49.6, y: 10, z: 2 }, { x: -1, y: 0, z: 0 });
        expect(endCap).toBeNull();

        const sphere = buildUnitSphereMesh(30, 14);
        const shell = buildAfoShell(sphere, equatorialLoop(sphere), {
            thicknessMm: 4,
            edgeMm: 2.5,
            flareMm: 2.5,
        });
        const mesh = shellMesh(shell.positions, shell.indices);
        let maxZ = -Infinity;
        const count = (mesh.positions.length / 3) | 0;
        for (let i = 0; i < count; i++) maxZ = Math.max(maxZ, mesh.positions[i * 3 + 2] ?? 0);
        let rimFaces = 0;
        const triangles = (mesh.indices.length / 3) | 0;
        for (let t = 0; t < triangles; t++) {
            const i0 = mesh.indices[t * 3] ?? 0;
            const i1 = mesh.indices[t * 3 + 1] ?? 0;
            const i2 = mesh.indices[t * 3 + 2] ?? 0;
            const at = (index: number) => ({
                x: mesh.positions[index * 3] ?? 0,
                y: mesh.positions[index * 3 + 1] ?? 0,
                z: mesh.positions[index * 3 + 2] ?? 0,
            });
            const a = at(i0);
            const b = at(i1);
            const c = at(i2);
            const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
            const e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
            const cross = {
                x: e1.y * e2.z - e1.z * e2.y,
                y: e1.z * e2.x - e1.x * e2.z,
                z: e1.x * e2.y - e1.y * e2.x,
            };
            const len = Math.hypot(cross.x, cross.y, cross.z) || 1;
            const normal = { x: cross.x / len, y: cross.y / len, z: cross.z / len };
            const origin = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 };
            if (origin.z < maxZ - 3 || normal.z < 0.85) continue;
            rimFaces += 1;
            const reading = probeThickness(mesh, origin, { x: -normal.x, y: -normal.y, z: -normal.z });
            expect(reading, `rim face z=${origin.z.toFixed(2)}`).toBeNull();
        }
        expect(rimFaces).toBeGreaterThan(0);
    });

    test("picks use the registry id, so reprojection does not store afo-body", () => {
        expect(afoMeasureSolidId({ shell: null, corrected: null, cast: {} })).toBe("afo-cast");
        expect(afoMeasureSolidId({ shell: null, corrected: {}, cast: {} })).toBe("afo-corrected");
        expect(afoMeasureSolidId({ shell: {}, corrected: {}, cast: {} })).toBe("afo-shell");
        expect(afoMeasureSolidId({ shell: null, corrected: null, cast: null })).toBeNull();
        for (const id of ["afo-cast", "afo-corrected", "afo-shell"] as const) {
            expect(id).not.toBe("afo-body");
        }

        const point = {
            solidId: "afo-cast",
            export: { x: 10, y: 10, z: 12 },
            world: { x: 10, y: 10, z: 12 },
            normal: { x: 0, y: 0, z: 1 },
        };
        const stale = { ...point, solidId: "afo-body", export: { x: 4, y: 4, z: 4 } };
        useMeasureStore.setState({
            points: [],
            thickness: null,
            thicknessMm: null,
            notice: null,
        });
        const first = bufferGeometryFromMesh(boxMesh({ x: 0, y: 0, z: 0 }, { x: 40, y: 20, z: 12 }));
        const releaseFirst = publishMeasureSolid({
            id: "afo-cast",
            product: "afo",
            side: "afo",
            geometry: first,
        });
        useMeasureStore.setState({
            points: [point, stale],
            thickness: null,
            thicknessMm: null,
            notice: null,
        });
        const second = bufferGeometryFromMesh(boxMesh({ x: 0, y: 0, z: 0 }, { x: 40, y: 20, z: 10 }));
        const releaseSecond = publishMeasureSolid({
            id: "afo-cast",
            product: "afo",
            side: "afo",
            geometry: second,
        });
        const stored = useMeasureStore.getState().points.find((item) => item.solidId === "afo-cast");
        expect(stored?.solidId).toBe("afo-cast");
        expect(stored?.solidId).not.toBe("afo-body");
        expect(stored?.export.z).toBeCloseTo(10, 3);
        const untouched = useMeasureStore.getState().points.find((item) => item.export.x === 4);
        expect(untouched?.solidId).toBe("afo-body");
        expect(
            useMeasureStore
                .getState()
                .points.some((item) => item.solidId === "afo-body" && item.export.z === 10),
        ).toBe(false);
        releaseSecond();
        releaseFirst();
        first.dispose();
        second.dispose();
        useMeasureStore.setState({ points: [], thickness: null, thicknessMm: null, notice: null });
    });
});
