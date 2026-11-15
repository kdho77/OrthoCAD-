// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { Euler, Matrix4, Vector3 } from "three";
import { medialSign } from "@/lib/geometry/handedness";
import type { Side } from "@/types";
import { type AfoRotationAxes, applyAfoCorrections, measureShankAngles } from "./corrections";
import { defaultAfoCorrections } from "./defaults";
import { alignScanToPlantarFrame, transformAfoPoint } from "./landmark-frame";
import type { AfoTriMesh, AfoVec3 } from "./types";

/**
 * Vertical shin on a plantar foot, then an arbitrary scanner pose.
 * +X anterior, +Z up, medial = medialSign along Y, before the tumble.
 */
function marksFor(side: Side): Record<string, AfoVec3> {
    const med = medialSign(side);
    const lat = -med;
    const at = (x: number, y: number, z: number): AfoVec3 => ({ x, y, z });
    return {
        heel: at(0, 0, 0),
        m1p: at(190, 28 * med, 1),
        m5p: at(172, 36 * lat, 1),
        medial_malleolus: at(12, 36 * med, 78),
        lateral_malleolus: at(2, 38 * lat, 66),
        fibular_head: at(8, 6 * lat, 340),
    };
}

function buildScan(side: Side): { mesh: AfoTriMesh; marks: Record<string, AfoVec3> } {
    const marks = marksFor(side);
    const positions: number[] = [];
    const indices: number[] = [];
    const slices = 16;
    const stacks = 24;
    for (let i = 0; i <= stacks; i++) {
        const z = 40 + (i / stacks) * 360;
        for (let j = 0; j < slices; j++) {
            const a = (j / slices) * Math.PI * 2;
            positions.push(10 + 36 * Math.cos(a), 36 * Math.sin(a), z);
        }
    }
    for (let i = 0; i < stacks; i++) {
        for (let j = 0; j < slices; j++) {
            const a = i * slices + j;
            const b = i * slices + ((j + 1) % slices);
            indices.push(a, a + slices, b, b, a + slices, b + slices);
        }
    }
    for (const point of Object.values(marks)) positions.push(point.x, point.y, point.z);
    return { mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices) }, marks };
}

function tumble(mesh: AfoTriMesh, marks: Record<string, AfoVec3>) {
    const matrix = new Matrix4().makeRotationFromEuler(new Euler(1.1, -0.6, 1.7));
    matrix.setPosition(new Vector3(80, -40, 30));
    const map = (point: AfoVec3): AfoVec3 => {
        const moved = new Vector3(point.x, point.y, point.z).applyMatrix4(matrix);
        return { x: moved.x, y: moved.y, z: moved.z };
    };
    const positions = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
        const moved = map({
            x: mesh.positions[i] ?? 0,
            y: mesh.positions[i + 1] ?? 0,
            z: mesh.positions[i + 2] ?? 0,
        });
        positions[i] = moved.x;
        positions[i + 1] = moved.y;
        positions[i + 2] = moved.z;
    }
    const posed: Record<string, AfoVec3> = {};
    for (const [id, point] of Object.entries(marks)) posed[id] = map(point);
    return { mesh: { positions, indices: mesh.indices }, marks: posed };
}

function pointOf(marks: Record<string, AfoVec3>, id: string): AfoVec3 {
    const point = marks[id];
    if (!point) throw new Error(`missing ${id}`);
    return point;
}

function corrections(partial: { legRearDeg?: number; legSideDeg?: number }) {
    const c = defaultAfoCorrections();
    c.smoothIterations = 0;
    c.volumeRegions = [];
    c.smoothRegions = [];
    c.text = null;
    c.braceHeightMm = 2000;
    c.left = { ...c.left, braceHeightMm: 2000, ...partial };
    c.right = { ...c.right, braceHeightMm: 2000, ...partial };
    Object.assign(c, partial, { braceHeightMm: 2000 });
    return c;
}

function section(mesh: AfoTriMesh, z: number): AfoVec3 {
    let x = 0;
    let y = 0;
    let zz = 0;
    let n = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
        const pz = mesh.positions[i + 2] ?? 0;
        if (Math.abs(pz - z) > 14) continue;
        x += mesh.positions[i] ?? 0;
        y += mesh.positions[i + 1] ?? 0;
        zz += pz;
        n++;
    }
    if (n === 0) return { x: 0, y: 0, z };
    return { x: x / n, y: y / n, z: zz / n };
}

function alignedLeg(side: Side) {
    const built = buildScan(side);
    const scanned = tumble(built.mesh, built.marks);
    const aligned = alignScanToPlantarFrame(
        scanned.mesh,
        {
            heel: pointOf(scanned.marks, "heel"),
            m1p: pointOf(scanned.marks, "m1p"),
            m5p: pointOf(scanned.marks, "m5p"),
        },
        side,
    );
    const orient = (id: string) => transformAfoPoint(pointOf(scanned.marks, id), aligned.matrixElements);
    const axes: AfoRotationAxes = {
        side,
        anatomical: true,
        medialMal: orient("medial_malleolus"),
        lateralMal: orient("lateral_malleolus"),
        heel: orient("heel"),
        m1: orient("m1p"),
        m5: orient("m5p"),
        fibularHead: orient("fibular_head"),
    };
    return { mesh: aligned.mesh, axes, orient };
}

describe("AFO rotate controls on an aligned left and right leg", () => {
    test("+10 rear is varus, +10 side is dorsiflexion, and the readout matches", () => {
        for (const side of ["left", "right"] as const) {
            for (const anatomical of [true, false]) {
                const { mesh, axes, orient } = alignedLeg(side);
                const withFlag = { ...axes, anatomical };
                const before = measureShankAngles(mesh, withFlag);
                const headZ = orient("fibular_head").z;
                const headBefore = section(mesh, headZ);
                const rearMesh = applyAfoCorrections(mesh, corrections({ legRearDeg: 10 }), withFlag);
                const sideMesh = applyAfoCorrections(mesh, corrections({ legSideDeg: 10 }), withFlag);
                const backMesh = applyAfoCorrections(mesh, corrections({ legSideDeg: -10 }), withFlag);
                const rear = measureShankAngles(rearMesh, withFlag);
                const flexed = measureShankAngles(sideMesh, withFlag);
                const back = measureShankAngles(backMesh, withFlag);
                const headRear = section(rearMesh, headZ);
                const headSide = section(sideMesh, headZ);
                const headBack = section(backMesh, headZ);

                expect(rear.frontalDeg - before.frontalDeg, `${side} rear ${anatomical}`).toBeGreaterThan(9);
                expect(rear.frontalDeg - before.frontalDeg, `${side} rear mag`).toBeLessThan(11);
                expect(Math.abs(rear.sagittalDeg - before.sagittalDeg)).toBeLessThan(1.5);
                expect((headRear.y - headBefore.y) * medialSign(side), `${side} varus`).toBeGreaterThan(8);

                expect(flexed.sagittalDeg - before.sagittalDeg, `${side} side`).toBeGreaterThan(9);
                expect(flexed.sagittalDeg - before.sagittalDeg).toBeLessThan(11);
                expect(Math.abs(flexed.frontalDeg - before.frontalDeg)).toBeLessThan(1.5);
                expect(headSide.x - headBefore.x, `${side} dorsiflexion`).toBeGreaterThan(8);

                expect(back.sagittalDeg - before.sagittalDeg, `${side} posterior`).toBeLessThan(-9);
                expect(headBack.x - headBefore.x, `${side} backward`).toBeLessThan(-8);
            }
        }
    });
});
