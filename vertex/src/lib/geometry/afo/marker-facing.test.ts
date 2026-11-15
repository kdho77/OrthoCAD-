// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { Euler, Matrix4, Vector3 } from "three";
import {
    AFO_FAR_MARKER_COLOR,
    afoCameraProximity,
    afoCastBodyStyle,
    afoMarkerDisplayCue,
    afoMarkerOnCameraSide,
    afoPointBrightness,
    afoScanDrawMode,
    afoTriangleStats,
} from "@/features/afo/afo-scan-ui";
import { medialSign } from "@/lib/geometry/handedness";
import { cameraForView, projectViewNdcX, VIEW_CAMERA_POS } from "@/lib/geometry/viewport-side-layout";
import type { CameraView } from "@/stores/design-store";
import type { Side } from "@/types";
import { alignScanToPlantarFrame, PlantarFrameError, transformAfoPoint } from "./landmark-frame";
import { afoViewerWorld, cameraViewForAfoMarkerId } from "./marker-side";
import { meshCentroid } from "./mesh-ops";
import type { AfoTriMesh, AfoVec3 } from "./types";

/**
 * Anatomical build space, before the scanner pose:
 * +X anterior, +Z up, medial = medialSign along Y (left medial is −Y).
 * A rigid scanner pose then tumbles the whole scan. Alignment has to recover
 * the build axes from the plantar clicks and the mesh, not from this space.
 */
function anatomicalMarkers(side: Side): Record<string, AfoVec3> {
    const med = medialSign(side);
    const lat = -med;
    const at = (x: number, y: number, z: number): AfoVec3 => ({ x, y, z });
    return {
        heel: at(0, 0, 0),
        m1p: at(190, 28 * med, 1),
        m5p: at(172, 36 * lat, 1),
        distal: at(210, 4 * med, 2),
        posterior_calcaneus: at(-28, 0, 28),
        post_calcaneus: at(-26, 1 * med, 30),
        m1_mpj: at(186, 34 * med, 24),
        m5_mpj: at(168, 40 * lat, 20),
        navicular: at(100, 38 * med, 32),
        fifth_met_base: at(118, 42 * lat, 24),
        medial_malleolus: at(12, 36 * med, 78),
        lateral_malleolus: at(2, 38 * lat, 66),
        malleolus_medial: at(14, 34 * med, 80),
        malleolus_lateral: at(0, 36 * lat, 64),
        fibular_head: at(6, 40 * lat, 360),
        proximal_medial: at(4, 38 * med, 400),
        proximal_lateral: at(4, 40 * lat, 400),
        tibial_tuberosity: at(42, 2 * med, 300),
        distal_crest: at(40, 1 * med, 180),
    };
}

function pushCylinder(
    positions: number[],
    indices: number[],
    opts: {
        x0: number;
        x1: number;
        z0: number;
        z1: number;
        radius: number;
        stacks: number;
        slices: number;
    },
): void {
    const base = positions.length / 3;
    const { x0, x1, z0, z1, radius, stacks, slices } = opts;
    for (let i = 0; i <= stacks; i++) {
        const t = i / stacks;
        const z = z0 + (z1 - z0) * t;
        const cx = x0 + (x1 - x0) * t;
        for (let j = 0; j < slices; j++) {
            const a = (j / slices) * Math.PI * 2;
            positions.push(cx + radius * Math.cos(a), radius * Math.sin(a), z);
        }
    }
    for (let i = 0; i < stacks; i++) {
        for (let j = 0; j < slices; j++) {
            const a = base + i * slices + j;
            const b = base + i * slices + ((j + 1) % slices);
            const c = a + slices;
            const d = b + slices;
            indices.push(a, c, b, b, c, d);
        }
    }
}

function pushEllipsoid(
    positions: number[],
    indices: number[],
    center: AfoVec3,
    radius: AfoVec3,
    stacks: number,
    slices: number,
): void {
    const base = positions.length / 3;
    for (let i = 0; i <= stacks; i++) {
        const phi = (i / stacks) * Math.PI;
        const sp = Math.sin(phi);
        const cp = Math.cos(phi);
        for (let j = 0; j < slices; j++) {
            const theta = (j / slices) * Math.PI * 2;
            positions.push(
                center.x + radius.x * sp * Math.cos(theta),
                center.y + radius.y * sp * Math.sin(theta),
                center.z + radius.z * cp,
            );
        }
    }
    for (let i = 0; i < stacks; i++) {
        for (let j = 0; j < slices; j++) {
            const a = base + i * slices + j;
            const b = base + i * slices + ((j + 1) % slices);
            const c = a + slices;
            const d = b + slices;
            indices.push(a, c, b, b, c, d);
        }
    }
}

/** Closed foot + shin shell. Vertex count is in the range of a small scan. */
function buildAnatomicalScan(side: Side): { mesh: AfoTriMesh; markers: Record<string, AfoVec3> } {
    const markers = anatomicalMarkers(side);
    const positions: number[] = [];
    const indices: number[] = [];
    pushCylinder(positions, indices, {
        x0: 8,
        x1: 12,
        z0: 36,
        z1: 430,
        radius: 42,
        stacks: 42,
        slices: 28,
    });
    pushEllipsoid(positions, indices, { x: 108, y: 0, z: 24 }, { x: 118, y: 48, z: 30 }, 16, 28);
    pushEllipsoid(positions, indices, { x: -4, y: 0, z: 26 }, { x: 42, y: 40, z: 34 }, 12, 24);
    for (const point of Object.values(markers)) positions.push(point.x, point.y, point.z);
    return {
        mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices) },
        markers,
    };
}

function applyScannerPose(
    mesh: AfoTriMesh,
    markers: Record<string, AfoVec3>,
    euler: Euler,
    translation: Vector3,
) {
    const matrix = new Matrix4().makeRotationFromEuler(euler);
    matrix.setPosition(translation);
    const mapPoint = (point: AfoVec3): AfoVec3 => {
        const moved = new Vector3(point.x, point.y, point.z).applyMatrix4(matrix);
        return { x: moved.x, y: moved.y, z: moved.z };
    };
    const positions = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
        const moved = mapPoint({
            x: mesh.positions[i] ?? 0,
            y: mesh.positions[i + 1] ?? 0,
            z: mesh.positions[i + 2] ?? 0,
        });
        positions[i] = moved.x;
        positions[i + 1] = moved.y;
        positions[i + 2] = moved.z;
    }
    const posed: Record<string, AfoVec3> = {};
    for (const [id, point] of Object.entries(markers)) posed[id] = mapPoint(point);
    return { mesh: { positions, indices: mesh.indices }, markers: posed };
}

function cameraSpaceZ(view: CameraView, world: Vector3): number {
    return world.clone().applyMatrix4(cameraForView(view).matrixWorldInverse).z;
}

/** Three.js camera looks down −Z, so a nearer point has the greater (less negative) view Z. */
function nearer(view: CameraView, target: Vector3, other: Vector3): boolean {
    return cameraSpaceZ(view, target) > cameraSpaceZ(view, other);
}

const SIDE_PAIRS: { id: string; opposite: string }[] = [
    { id: "m1_mpj", opposite: "m5_mpj" },
    { id: "m5_mpj", opposite: "m1_mpj" },
    { id: "navicular", opposite: "fifth_met_base" },
    { id: "fifth_met_base", opposite: "navicular" },
    { id: "medial_malleolus", opposite: "lateral_malleolus" },
    { id: "lateral_malleolus", opposite: "medial_malleolus" },
    { id: "malleolus_medial", opposite: "malleolus_lateral" },
    { id: "malleolus_lateral", opposite: "malleolus_medial" },
    { id: "proximal_medial", opposite: "proximal_lateral" },
    { id: "proximal_lateral", opposite: "proximal_medial" },
    { id: "fibular_head", opposite: "proximal_medial" },
];

const SAGITTAL: { id: string; opposite: string }[] = [
    { id: "posterior_calcaneus", opposite: "tibial_tuberosity" },
    { id: "post_calcaneus", opposite: "tibial_tuberosity" },
    { id: "tibial_tuberosity", opposite: "posterior_calcaneus" },
    { id: "distal_crest", opposite: "posterior_calcaneus" },
];

const PLANTAR: { id: string; opposite: string }[] = [
    { id: "heel", opposite: "medial_malleolus" },
    { id: "m1p", opposite: "m1_mpj" },
    { id: "m5p", opposite: "m5_mpj" },
    { id: "distal", opposite: "tibial_tuberosity" },
];

const POSES: { euler: Euler; translation: Vector3 }[] = [
    { euler: new Euler(1.15, -0.72, 2.05), translation: new Vector3(140, -65, 48) },
    { euler: new Euler(-2.05, 0.55, -1.25), translation: new Vector3(-30, 90, -70) },
];

function markerAt(markers: Record<string, AfoVec3>, id: string): AfoVec3 {
    const point = markers[id];
    if (!point) throw new Error(`missing marker ${id}`);
    return point;
}

function cameraPoint(view: CameraView): AfoVec3 {
    const position = VIEW_CAMERA_POS[view];
    return { x: position[0], y: position[1], z: position[2] };
}

describe("AFO marker cameras on a tumbled foot+leg scan", () => {
    test("every marker faces its anatomical side for a left leg and a right leg", () => {
        for (const side of ["left", "right"] as const) {
            const built = buildAnatomicalScan(side);
            const vertexCount = built.mesh.positions.length / 3;
            expect(vertexCount).toBeGreaterThan(1500);
            for (const pose of POSES) {
                const scanned = applyScannerPose(built.mesh, built.markers, pose.euler, pose.translation);
                const aligned = alignScanToPlantarFrame(
                    scanned.mesh,
                    {
                        heel: markerAt(scanned.markers, "heel"),
                        m1p: markerAt(scanned.markers, "m1p"),
                        m5p: markerAt(scanned.markers, "m5p"),
                    },
                    side,
                );
                expect(new Matrix4().fromArray(aligned.matrixElements).determinant()).toBeCloseTo(1, 4);
                const orient = (id: string) =>
                    transformAfoPoint(markerAt(scanned.markers, id), aligned.matrixElements);
                const world = (id: string) => afoViewerWorld(orient(id));
                const sign = medialSign(side);

                expect(orient("tibial_tuberosity").x).toBeGreaterThan(orient("posterior_calcaneus").x + 30);
                expect(orient("fibular_head").z).toBeGreaterThan(orient("heel").z + 150);
                expect(sign * orient("medial_malleolus").y).toBeGreaterThan(
                    sign * orient("lateral_malleolus").y,
                );
                expect(orient("m1_mpj").x).toBeGreaterThan(orient("posterior_calcaneus").x);

                const placed = { medial: orient("m1p"), lateral: orient("m5p") };
                const center = afoViewerWorld(meshCentroid(aligned.mesh));
                const onSide = (id: string, view: CameraView) =>
                    afoMarkerOnCameraSide(world(id), cameraPoint(view), center);
                expect(nearer("back", world("posterior_calcaneus"), world("tibial_tuberosity"))).toBe(true);
                expect(nearer("back", world("heel"), world("m1_mpj"))).toBe(true);
                expect(nearer("front", world("tibial_tuberosity"), world("posterior_calcaneus"))).toBe(true);
                expect(nearer("front", world("distal_crest"), world("posterior_calcaneus"))).toBe(true);

                for (const pair of [...SIDE_PAIRS, ...SAGITTAL, ...PLANTAR]) {
                    const view = cameraViewForAfoMarkerId(pair.id, side, placed);
                    expect(
                        nearer(view, world(pair.id), world(pair.opposite)),
                        `${side} ${pair.id} via ${view} should be nearer than ${pair.opposite}`,
                    ).toBe(true);
                }

                const medialView = cameraViewForAfoMarkerId("navicular", side, placed);
                const lateralView = cameraViewForAfoMarkerId("fibular_head", side, placed);
                expect(medialView === "left" || medialView === "right").toBe(true);
                expect(lateralView === "left" || lateralView === "right").toBe(true);
                if (medialView !== "left" && medialView !== "right") continue;
                if (lateralView !== "left" && lateralView !== "right") continue;
                const medialSpread =
                    projectViewNdcX(medialView, world("navicular")) -
                    projectViewNdcX(medialView, world("fibular_head"));
                const lateralSpread =
                    projectViewNdcX(lateralView, world("navicular")) -
                    projectViewNdcX(lateralView, world("fibular_head"));
                expect(Math.sign(medialSpread)).toBe(-Math.sign(lateralSpread));
                expect(cameraSpaceZ(medialView, world("navicular"))).toBeGreaterThan(
                    cameraSpaceZ(medialView, world("fibular_head")),
                );

                expect(onSide("posterior_calcaneus", "back")).toBe(true);
                expect(onSide("heel", "back")).toBe(true);
                expect(onSide("tibial_tuberosity", "back")).toBe(false);
                expect(onSide("m1_mpj", "back")).toBe(false);
                expect(onSide("tibial_tuberosity", "front")).toBe(true);
                expect(onSide("distal_crest", "front")).toBe(true);
                expect(onSide("posterior_calcaneus", "front")).toBe(false);
                expect(onSide("heel", "bottom")).toBe(true);
                expect(onSide("m1p", "bottom")).toBe(true);
                expect(onSide("fibular_head", "bottom")).toBe(false);
                for (const pair of [...SIDE_PAIRS, ...SAGITTAL]) {
                    const view = cameraViewForAfoMarkerId(pair.id, side, placed);
                    expect(onSide(pair.id, view), `${side} ${pair.id} on ${view}`).toBe(true);
                    expect(onSide(pair.opposite, view), `${side} ${pair.opposite} off ${view}`).toBe(false);
                }
                const far = afoMarkerDisplayCue({ drawMode: "points", facesCamera: false });
                const nearCue = afoMarkerDisplayCue({ drawMode: "points", facesCamera: true });
                expect(far.occluded).toBe(true);
                expect(far.dimmed).toBe(true);
                expect(far.depthTest).toBe(true);
                expect(far.opacity).toBeLessThan(nearCue.opacity * 0.5);
                expect(far.color).toBe(AFO_FAR_MARKER_COLOR);
                expect(nearCue.occluded).toBe(false);
                expect(nearCue.facesCamera).toBe(true);
                expect(far.facesCamera).toBe(false);
                const degenerate = afoTriangleStats(aligned.mesh.positions, new Uint32Array([0, 0, 0]));
                expect(afoScanDrawMode(degenerate.triangles, degenerate.degenerateRatio)).toBe("points");
                const pointStyle = afoCastBodyStyle({
                    transparentOn: false,
                    heightmap: false,
                    triangleCount: degenerate.triangles,
                    degenerateRatio: degenerate.degenerateRatio,
                });
                expect(pointStyle.drawMode).toBe("points");
                expect(pointStyle.pointDistanceShade).toBe(true);
                expect(pointStyle.pointDepthWrite).toBe(true);
                expect(pointStyle.pointDepthSplatScale).toBeGreaterThan(1);
                expect(pointStyle.markerDepthTest).toBe(true);
                expect(afoPointBrightness(afoCameraProximity(120, 80, 500))).toBeGreaterThan(
                    afoPointBrightness(afoCameraProximity(460, 80, 500)) + 0.2,
                );
            }
        }
    });

    test("a side label that disagrees with M1p and M5p is rejected", () => {
        const built = buildAnatomicalScan("left");
        const pose = POSES[0];
        if (!pose) throw new Error("missing scanner pose");
        const scanned = applyScannerPose(built.mesh, built.markers, pose.euler, pose.translation);
        expect(() =>
            alignScanToPlantarFrame(
                scanned.mesh,
                {
                    heel: markerAt(scanned.markers, "heel"),
                    m1p: markerAt(scanned.markers, "m1p"),
                    m5p: markerAt(scanned.markers, "m5p"),
                },
                "right",
            ),
        ).toThrow(PlantarFrameError);
    });

    test("camera presets sit on the viewer axes the markers use", () => {
        expect(VIEW_CAMERA_POS.back[0]).toBeLessThan(0);
        expect(VIEW_CAMERA_POS.front[0]).toBeGreaterThan(0);
        expect(VIEW_CAMERA_POS.left[2]).toBeGreaterThan(0);
        expect(VIEW_CAMERA_POS.right[2]).toBeLessThan(0);
        const anterior = afoViewerWorld({ x: 80, y: 0, z: 0 });
        const up = afoViewerWorld({ x: 0, y: 0, z: 80 });
        const meshPositiveY = afoViewerWorld({ x: 0, y: 80, z: 0 });
        expect(anterior.x).toBeGreaterThan(40);
        expect(up.y).toBeGreaterThan(40);
        expect(meshPositiveY.z).toBeLessThan(-40);
    });
});
