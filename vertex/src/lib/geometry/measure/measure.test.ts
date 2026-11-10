// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferGeometry, Group, Mesh, Vector3 } from "three";
import { sideOffsetX } from "@/lib/geometry/layout";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
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
        const source = boxMesh({ x: -15, y: 0, z: 0 }, { x: 30, y: 200, z: 180 });
        const xf = afoViewerDisplayTransform();
        const overall = overallPrintSize(undoDisplayMesh(bakeDisplayTransform(source, xf), xf), "afo");
        nearly(overall.lengthMm, 200);
        nearly(overall.heightMm, 180);
        nearly(overall.widthMm, 30);
        const stl = exportedStlBounds(source);
        expect(Math.abs(overall.lengthMm - (stl.maxY - stl.minY))).toBeLessThanOrEqual(0.05);
        expect(Math.abs(overall.heightMm - (stl.maxZ - stl.minZ))).toBeLessThanOrEqual(0.05);
        expect(Math.abs(overall.widthMm - (stl.maxX - stl.minX))).toBeLessThanOrEqual(0.05);
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

    test("SAMPLE_Top Men's 9 length and width match the export STL", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const right = await reconstructProceduralPreview(raw, { side: "right", footprintScale: 1 });
        const mirrored = mirrorGeometry(right.geometry);
        try {
            for (const [label, geometry] of [
                ["right", right.geometry],
                ["left", mirrored],
            ] as const) {
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
                const stl = exportedStlBounds(mesh);
                const lengthDelta = Math.abs(overall.lengthMm - (stl.maxX - stl.minX));
                const widthDelta = Math.abs(overall.widthMm - (stl.maxY - stl.minY));
                expect(
                    lengthDelta,
                    `${label} length ${overall.lengthMm.toFixed(3)} vs stl`,
                ).toBeLessThanOrEqual(0.05);
                expect(widthDelta).toBeLessThanOrEqual(0.05);
                // Live SAMPLE_Top Men's 9 closed solid. The one-click baseline
                // records this X span as 273.1 mm. 275.0 is not this STL.
                expect(
                    Math.abs(overall.lengthMm - 273.1),
                    `${label} L=${overall.lengthMm.toFixed(3)} W=${overall.widthMm.toFixed(3)} H=${overall.heightMm.toFixed(3)}`,
                ).toBeLessThanOrEqual(0.1);
                expect(
                    Math.abs(overall.widthMm - 92.7),
                    `${label} width ${overall.widthMm.toFixed(3)}`,
                ).toBeLessThanOrEqual(0.1);
            }
        } finally {
            mirrored.dispose();
            right.geometry.dispose();
            raw.dispose();
        }
    }, 180_000);
});
