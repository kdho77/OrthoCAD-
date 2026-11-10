// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferGeometry, Group, Mesh, Vector3 } from "three";
import { buildExportStl, buildValidatedExportGeometry } from "@/lib/geometry/export-geometry";
import { sideOffsetX } from "@/lib/geometry/layout";
import { binaryStlBounds } from "@/lib/geometry/leader-block";
import { nearestSurfacePoint } from "@/lib/geometry/measure/mesh-ops";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import {
    afoViewerDisplayTransform,
    bakeDisplayTransform,
    boxMesh,
    displayPointToExportMm,
    exportedStlBounds,
    exportPointToDisplayMm,
    insoleViewerDisplayTransform,
    overallPrintSize,
    parallelWall,
    pickFrontFace,
    pointToPoint,
    probeThickness,
    undoDisplayMesh,
} from "./index";
import type { MeasureDisplayTransform, MeasureTriangleMesh, MeasureVec3 } from "./types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function nearly(actual: number, expected: number, tol = 1e-4): void {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

/** XY size of the top-sheet vertices [0, topVertexCount). Not the solid bbox. */
function topSheetPrintSize(geometry: BufferGeometry): {
    topVertexCount: number;
    lengthMm: number;
    widthMm: number;
} {
    const topVertexCount = (geometry.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const pos = geometry.getAttribute("position");
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const n = Math.min(topVertexCount, pos?.count ?? 0);
    for (let i = 0; i < n; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return {
        topVertexCount,
        lengthMm: Number.isFinite(minX) ? maxX - minX : Number.NaN,
        widthMm: Number.isFinite(minY) ? maxY - minY : Number.NaN,
    };
}

function mergeMeshes(a: MeasureTriangleMesh, b: MeasureTriangleMesh): MeasureTriangleMesh {
    const positions = new Float32Array(a.positions.length + b.positions.length);
    positions.set(a.positions, 0);
    positions.set(b.positions, a.positions.length);
    const indices = new Uint32Array(a.indices.length + b.indices.length);
    indices.set(a.indices, 0);
    const shift = a.positions.length / 3;
    for (let i = 0; i < b.indices.length; i++) indices[a.indices.length + i] = (b.indices[i] ?? 0) + shift;
    return { positions, indices };
}

describe("export-frame measurements", () => {
    test("known box with display transform returns true millimetres", () => {
        const source = boxMesh({ x: 0, y: 0, z: 0 }, { x: 80, y: 40, z: 12 });
        const xf: MeasureDisplayTransform = {
            scale: { x: 0.5, y: 0.5, z: 0.5 },
            translation: { x: -130, y: 62.5, z: 3 },
            rotationEuler: { x: -Math.PI / 2, y: 0.2, z: -0.1 },
            mirror: { axis: 1, center: 20 },
        };
        const baked = bakeDisplayTransform(source, xf);
        const undone = undoDisplayMesh(baked, xf);
        const overall = overallPrintSize(undone, "insole");
        nearly(overall.lengthMm, 80);
        nearly(overall.widthMm, 40);
        nearly(overall.heightMm, 12);

        const corner = displayPointToExportMm(exportPointToDisplayMm({ x: 80, y: 40, z: 12 }, xf), xf);
        nearly(corner.x, 80);
        nearly(corner.y, 40);
        nearly(corner.z, 12);

        const segment = pointToPoint(
            displayPointToExportMm(exportPointToDisplayMm({ x: 0, y: 0, z: 0 }, xf), xf),
            corner,
        );
        nearly(segment.dx, 80);
        nearly(segment.dy, 40);
        nearly(segment.dz, 12);
        nearly(segment.distanceMm, Math.hypot(80, 40, 12));
    });

    test("overall size matches the exported STL bounds within 0.05 mm", () => {
        const source = boxMesh({ x: 1.25, y: -4, z: 0 }, { x: 275, y: 92.7, z: 18.4 });
        const xf = insoleViewerDisplayTransform("left", 260, 95);
        const undone = undoDisplayMesh(bakeDisplayTransform(source, xf), xf);
        const overall = overallPrintSize(undone, "insole");
        const stl = exportedStlBounds(undone);
        expect(Math.abs(overall.lengthMm - (stl.maxX - stl.minX))).toBeLessThanOrEqual(0.05);
        expect(Math.abs(overall.widthMm - (stl.maxY - stl.minY))).toBeLessThanOrEqual(0.05);
        expect(Math.abs(overall.heightMm - (stl.maxZ - stl.minZ))).toBeLessThanOrEqual(0.05);
        nearly(overall.lengthMm, 275, 0.05);
        nearly(overall.widthMm, 92.7, 0.05);
    });

    test("left and right viewer poses undo to the same export point", () => {
        const local: MeasureVec3 = { x: 10, y: 3, z: 4 };
        for (const side of ["left", "right"] as const) {
            const xf = insoleViewerDisplayTransform(side, 260, 95);
            const group = new Group();
            group.rotation.x = xf.rotationEuler.x;
            const mesh = new Mesh(new BufferGeometry());
            mesh.position.set(xf.translation.x, xf.translation.y, xf.translation.z);
            mesh.scale.set(xf.scale.x, xf.scale.y, xf.scale.z);
            group.add(mesh);
            group.updateMatrixWorld(true);

            const world = new Vector3(local.x, local.y, local.z);
            mesh.localToWorld(world);
            const displayed = exportPointToDisplayMm(local, xf);
            nearly(displayed.x, world.x, 1e-4);
            nearly(displayed.y, world.y, 1e-4);
            nearly(displayed.z, world.z, 1e-4);

            const back = mesh.worldToLocal(world.clone());
            const undone = displayPointToExportMm({ x: world.x, y: world.y, z: world.z }, xf);
            nearly(back.x, local.x, 1e-4);
            nearly(undone.x, local.x, 1e-4);
            nearly(undone.y, local.y, 1e-4);
            nearly(undone.z, local.z, 1e-4);
            expect(Math.sign(sideOffsetX(side, 95)) === 0 || xf.translation.y === sideOffsetX(side, 95)).toBe(
                true,
            );
        }
        expect(insoleViewerDisplayTransform("left", 260, 95).translation.y).toBeGreaterThan(0);
        expect(insoleViewerDisplayTransform("right", 260, 95).translation.y).toBeLessThan(0);
    });

    test("fit scale on the object undoes to true millimetres", () => {
        const xf: MeasureDisplayTransform = {
            ...insoleViewerDisplayTransform("right", 260, 95),
            scale: { x: 2, y: 2, z: 2 },
        };
        const group = new Group();
        group.rotation.x = xf.rotationEuler.x;
        const mesh = new Mesh(new BufferGeometry());
        mesh.position.set(xf.translation.x, xf.translation.y, xf.translation.z);
        mesh.scale.set(2, 2, 2);
        group.add(mesh);
        group.updateMatrixWorld(true);
        const world = new Vector3(10, 3, 4);
        mesh.localToWorld(world);
        const undone = displayPointToExportMm({ x: world.x, y: world.y, z: world.z }, xf);
        nearly(undone.x, 10, 1e-4);
        nearly(undone.y, 3, 1e-4);
        nearly(undone.z, 4, 1e-4);
    });

    test("AFO display rotation undoes and overall is footplate × height × width", () => {
        const source = boxMesh({ x: 0, y: -15, z: 0 }, { x: 200, y: 30, z: 180 });
        const xf = afoViewerDisplayTransform();
        const overall = overallPrintSize(undoDisplayMesh(bakeDisplayTransform(source, xf), xf), "afo");
        nearly(overall.lengthMm, 200);
        nearly(overall.heightMm, 180);
        nearly(overall.widthMm, 30);
        const stl = exportedStlBounds(source);
        expect(Math.abs(overall.lengthMm - (stl.maxX - stl.minX))).toBeLessThanOrEqual(0.05);
        expect(Math.abs(overall.heightMm - (stl.maxZ - stl.minZ))).toBeLessThanOrEqual(0.05);
        expect(Math.abs(overall.widthMm - (stl.maxY - stl.minY))).toBeLessThanOrEqual(0.05);
    });

    test("front-face pick ignores back faces and empty meshes", () => {
        const box = boxMesh({ x: 0, y: 0, z: 0 }, { x: 80, y: 40, z: 12 });
        const front = pickFrontFace(box, { x: 40, y: 20, z: 100 }, { x: 0, y: 0, z: -1 });
        expect(front).not.toBeNull();
        nearly(front!.point.z, 12, 1e-3);
        const inside = pickFrontFace(box, { x: 40, y: 20, z: 6 }, { x: 0, y: 0, z: -1 });
        expect(inside).toBeNull();
        const cloud = pickFrontFace(
            { positions: box.positions, indices: new Uint32Array() },
            { x: 40, y: 20, z: 100 },
            { x: 0, y: 0, z: -1 },
        );
        expect(cloud).toBeNull();
    });

    test("optional 1 mm vertex snap", () => {
        const box = boxMesh({ x: 0, y: 0, z: 0 }, { x: 80, y: 40, z: 12 });
        const hit = pickFrontFace(box, { x: 0.4, y: 0.3, z: 40 }, { x: 0, y: 0, z: -1 }, { snapMm: 1 });
        expect(hit?.snapped).toBe(true);
        nearly(hit!.point.x, 0, 1e-6);
        nearly(hit!.point.y, 0, 1e-6);
        const free = pickFrontFace(box, { x: 20, y: 10, z: 40 }, { x: 0, y: 0, z: -1 }, { snapMm: 1 });
        expect(free?.snapped).toBe(false);
        nearly(free!.point.x, 20, 1e-3);
    });

    test("thickness probe reads 4.0 mm body and 2.5 mm edge walls", () => {
        const body = probeThickness(parallelWall(4), { x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: -1 });
        const edge = probeThickness(parallelWall(2.5), { x: 0, y: 0, z: 2.5 }, { x: 0, y: 0, z: -1 });
        expect(body).not.toBeNull();
        expect(edge).not.toBeNull();
        expect(Math.abs(body! - 4)).toBeLessThanOrEqual(0.1);
        expect(Math.abs(edge! - 2.5)).toBeLessThanOrEqual(0.1);
    });

    test("leader block is excluded unless the toggle is on", () => {
        const heel = boxMesh({ x: 0, y: -20, z: 0 }, { x: 20, y: 40, z: 30 });
        const toe = boxMesh({ x: 180, y: -5, z: 0 }, { x: 20, y: 10, z: 3 });
        const mesh = mergeMeshes(heel, toe);
        const bare = overallPrintSize(mesh, "insole", false);
        const withLeader = overallPrintSize(mesh, "insole", true);
        expect(bare.includedLeader).toBe(false);
        nearly(bare.lengthMm, 200, 0.05);
        expect(withLeader.includedLeader).toBe(true);
        expect(withLeader.lengthMm).toBeGreaterThan(bare.lengthMm + 10);
    });

    test("a viewer hit snaps onto the export solid", () => {
        const exported = boxMesh({ x: 0, y: 0, z: 0 }, { x: 80, y: 40, z: 12 });
        const hit = { x: 20, y: 10, z: 14 };
        const snapped = nearestSurfacePoint(exported, hit);
        expect(snapped).not.toBeNull();
        nearly(snapped!.point.z, 12, 1e-4);
        expect(snapped!.distance).toBeGreaterThan(1);
        expect(snapped!.distance).toBeLessThan(3);
    });

    test("SAMPLE_Top Men's 9 export STL is 275.0 mm long and about 92.73 wide", async () => {
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response(bytes)) as typeof fetch;
        resetSampleTopGeometryCache();
        useDesignStore.setState({ design: createDesignWithStockPlaceholder() });
        try {
            for (const side of ["left", "right"] as const) {
                const geometry = await buildValidatedExportGeometry(side);
                const stl = await buildExportStl(side);
                try {
                    const mesh = {
                        positions: new Float32Array(geometry.getAttribute("position").count * 3),
                        indices: new Uint32Array(
                            geometry.getIndex()?.count ?? geometry.getAttribute("position").count,
                        ),
                    };
                    const pos = geometry.getAttribute("position");
                    for (let i = 0; i < pos.count; i++) {
                        mesh.positions[i * 3] = pos.getX(i);
                        mesh.positions[i * 3 + 1] = pos.getY(i);
                        mesh.positions[i * 3 + 2] = pos.getZ(i);
                    }
                    const index = geometry.getIndex();
                    if (index) {
                        for (let i = 0; i < index.count; i++) mesh.indices[i] = index.getX(i);
                    } else {
                        for (let i = 0; i < pos.count; i++) mesh.indices[i] = i;
                    }
                    const overall = overallPrintSize(mesh, "insole", false);
                    const stlBox = binaryStlBounds(stl);
                    const detail = `${side} L=${overall.lengthMm.toFixed(3)} W=${overall.widthMm.toFixed(3)}`;
                    expect(
                        Math.abs(overall.lengthMm - (stlBox.maxX - stlBox.minX)),
                        detail,
                    ).toBeLessThanOrEqual(0.05);
                    expect(Math.abs(overall.widthMm - (stlBox.maxY - stlBox.minY))).toBeLessThanOrEqual(0.05);
                    // Men's 9 gate is the TOP sheet [0, topVertexCount), not the solid bbox.
                    // Kendon 10/23: scale SAMPLE_Top evenly in XY by 275/271.9346 = 1.011273.
                    // At the lock the solid reads about 276.18 × 93.73; the sheet is 275.0 × 92.73.
                    const top = topSheetPrintSize(geometry);
                    const topDetail = `${side} topVertexCount=${top.topVertexCount} L=${top.lengthMm.toFixed(3)} W=${top.widthMm.toFixed(3)}`;
                    expect(top.topVertexCount, topDetail).toBeGreaterThan(0);
                    expect(top.topVertexCount, topDetail).toBeLessThan(pos.count);
                    expect(Math.abs(top.lengthMm - 275.0), topDetail).toBeLessThanOrEqual(0.05);
                    expect(Math.abs(top.widthMm - 92.73), topDetail).toBeLessThanOrEqual(0.05);
                } finally {
                    geometry.dispose();
                }
            }
        } finally {
            globalThis.fetch = originalFetch;
            resetSampleTopGeometryCache();
        }
    }, 180_000);
});
