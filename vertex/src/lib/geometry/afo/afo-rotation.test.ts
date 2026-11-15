// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { medialSign } from "@/lib/geometry/handedness";
import type { Side } from "@/types";
import {
    type AfoRotationAxes,
    afoFootAxes,
    applyAfoCorrections,
    correctionContextFromAfo,
    measureShankAngles,
} from "./corrections";
import {
    AFO_REAR_ROT_RANGE,
    AFO_SIDE_ROT_RANGE,
    defaultAfoCorrections,
    defaultAfoDesignState,
    writeAfoSideCorrection,
} from "./defaults";
import type { AfoTriMesh, AfoVec3 } from "./types";

/**
 * Plantar frame used by the scan aligner: +X anterior, +Z up, geometric +Y = Z × X.
 * Medial is medialSign(side) along Y. A vertical shank sits on the ankle joint centre.
 */
function plantarFixture(side: Side): { mesh: AfoTriMesh; axes: AfoRotationAxes; headIndex: number } {
    const sign = medialSign(side);
    const ajc = { x: 40, y: 0, z: 80 };
    const positions: number[] = [];
    const push = (p: AfoVec3) => positions.push(p.x, p.y, p.z);
    push({ x: 0, y: 0, z: 0 });
    push({ x: 150, y: 20 * sign, z: 0 });
    push({ x: 150, y: -20 * sign, z: 0 });
    const headIndex = positions.length / 3;
    for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        push({ x: ajc.x + Math.cos(a) * 12, y: ajc.y + Math.sin(a) * 12, z: 180 });
    }
    return {
        mesh: { positions: new Float32Array(positions), indices: new Uint32Array([0, 1, 2]) },
        axes: {
            side,
            anatomical: true,
            medialMal: { x: ajc.x, y: 28 * sign, z: 80 },
            lateralMal: { x: ajc.x, y: -28 * sign, z: 78 },
            heel: { x: 0, y: 0, z: 0 },
            m1: { x: 150, y: 22 * sign, z: 0 },
            m5: { x: 150, y: -22 * sign, z: 0 },
            fibularHead: { x: ajc.x, y: 0, z: 180 },
        },
        headIndex,
    };
}

function turned(partial: { legRearDeg?: number; legSideDeg?: number }) {
    const c = defaultAfoCorrections();
    c.smoothIterations = 0;
    Object.assign(c, partial);
    c.left = { ...c.left, ...partial };
    c.right = { ...c.right, ...partial };
    return c;
}

function headCentroid(mesh: AfoTriMesh, headIndex: number): AfoVec3 {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < 8; i++) {
        const k = headIndex + i;
        x += mesh.positions[k * 3] ?? 0;
        y += mesh.positions[k * 3 + 1] ?? 0;
        z += mesh.positions[k * 3 + 2] ?? 0;
    }
    return { x: x / 8, y: y / 8, z: z / 8 };
}

describe("AFO rear and side rotation", () => {
    test("slider span is at least ±30° on both axes", () => {
        expect(AFO_REAR_ROT_RANGE[0]).toBeLessThanOrEqual(-30);
        expect(AFO_REAR_ROT_RANGE[1]).toBeGreaterThanOrEqual(30);
        expect(AFO_SIDE_ROT_RANGE[0]).toBeLessThanOrEqual(-30);
        expect(AFO_SIDE_ROT_RANGE[1]).toBeGreaterThanOrEqual(30);
    });

    test("rear rotates in the frontal plane and side in the sagittal plane", () => {
        const { mesh, axes, headIndex } = plantarFixture("right");
        const frame = afoFootAxes(axes);
        expect(Math.abs(frame.anterior.x)).toBeGreaterThan(0.9);
        expect(Math.abs(frame.anterior.y)).toBeLessThan(0.1);
        expect(Math.abs(frame.lateral.y)).toBeGreaterThan(0.9);
        expect(Math.abs(frame.lateral.x)).toBeLessThan(0.1);

        const before = headCentroid(mesh, headIndex);
        const rear = applyAfoCorrections(mesh, turned({ legRearDeg: 10 }), axes);
        const side = applyAfoCorrections(mesh, turned({ legSideDeg: 10 }), axes);
        const rearHead = headCentroid(rear, headIndex);
        const sideHead = headCentroid(side, headIndex);

        expect(Math.abs(rearHead.x - before.x)).toBeLessThan(1.5);
        expect(Math.abs(rearHead.y - before.y)).toBeGreaterThan(8);
        expect(Math.abs(sideHead.y - before.y)).toBeLessThan(1.5);
        expect(Math.abs(sideHead.x - before.x)).toBeGreaterThan(8);
        expect(Math.hypot(rearHead.x - 40, rearHead.y, rearHead.z - 80)).toBeGreaterThan(90);
    });

    test("positive rear is varus and positive side is dorsiflexion", () => {
        for (const side of ["left", "right"] as const) {
            const { mesh, axes, headIndex } = plantarFixture(side);
            const before = headCentroid(mesh, headIndex);
            const rear = headCentroid(applyAfoCorrections(mesh, turned({ legRearDeg: 10 }), axes), headIndex);
            const flexed = headCentroid(
                applyAfoCorrections(mesh, turned({ legSideDeg: 10 }), axes),
                headIndex,
            );
            expect((rear.y - before.y) * medialSign(side)).toBeGreaterThan(8);
            expect(flexed.x - before.x).toBeGreaterThan(8);
        }
    });

    test("a tilted cast changes by the slider value, starting from that baseline", () => {
        const { mesh, axes } = plantarFixture("right");
        const shift = 100 * Math.sin((8 * Math.PI) / 180);
        for (let i = 3; i < 11; i++) mesh.positions[i * 3] = (mesh.positions[i * 3] ?? 0) + shift;
        const baseline = measureShankAngles(mesh, axes);
        expect(baseline.sagittalDeg).toBeGreaterThan(6);
        const after = measureShankAngles(applyAfoCorrections(mesh, turned({ legSideDeg: 10 }), axes), axes);
        expect(after.sagittalDeg - baseline.sagittalDeg).toBeCloseTo(10, 0);
    });

    test("readout round-trips 0 and +X on each axis and on both together", () => {
        const { mesh, axes } = plantarFixture("left");
        const baseline = measureShankAngles(mesh, axes);
        const zero = applyAfoCorrections(mesh, turned({}), axes);
        const still = measureShankAngles(zero, axes);
        expect(still.sagittalDeg).toBeCloseTo(baseline.sagittalDeg, 5);
        expect(still.frontalDeg).toBeCloseTo(baseline.frontalDeg, 5);

        for (const amount of [10, -12, 30]) {
            const rearOnly = measureShankAngles(
                applyAfoCorrections(mesh, turned({ legRearDeg: amount }), axes),
                axes,
            );
            const sideOnly = measureShankAngles(
                applyAfoCorrections(mesh, turned({ legSideDeg: amount }), axes),
                axes,
            );
            expect(rearOnly.frontalDeg - baseline.frontalDeg).toBeCloseTo(amount, 0);
            expect(rearOnly.sagittalDeg - baseline.sagittalDeg).toBeCloseTo(0, 0);
            expect(sideOnly.sagittalDeg - baseline.sagittalDeg).toBeCloseTo(amount, 0);
            expect(sideOnly.frontalDeg - baseline.frontalDeg).toBeCloseTo(0, 0);
        }

        const both = measureShankAngles(
            applyAfoCorrections(mesh, turned({ legRearDeg: 10, legSideDeg: 10 }), axes),
            axes,
        );
        expect(both.frontalDeg - baseline.frontalDeg).toBeCloseTo(10, 0);
        expect(both.sagittalDeg - baseline.sagittalDeg).toBeCloseTo(10, 0);
    });

    test("the same clinical varus mirrors across left and right", () => {
        const right = plantarFixture("right");
        const left = plantarFixture("left");
        const rightHead = headCentroid(
            applyAfoCorrections(right.mesh, turned({ legRearDeg: 10 }), right.axes),
            right.headIndex,
        );
        const leftHead = headCentroid(
            applyAfoCorrections(left.mesh, turned({ legRearDeg: 10 }), left.axes),
            left.headIndex,
        );
        const rightBefore = headCentroid(right.mesh, right.headIndex);
        const leftBefore = headCentroid(left.mesh, left.headIndex);
        expect(rightHead.y - rightBefore.y).toBeGreaterThan(8);
        expect(leftHead.y - leftBefore.y).toBeLessThan(-8);
        expect(
            Math.abs(Math.abs(rightHead.y - rightBefore.y) - Math.abs(leftHead.y - leftBefore.y)),
        ).toBeLessThan(0.5);
    });

    test("Both (linked) writes the clinical angle to each side, and each side applies it medially", () => {
        const base = defaultAfoCorrections();
        base.smoothIterations = 0;
        base.left = { ...base.left, heelLiftMm: 4, legRearDeg: 1 };
        base.right = { ...base.right, heelLiftMm: -2, legRearDeg: -3 };
        const linked = writeAfoSideCorrection(
            base,
            "left",
            { legRearDeg: 10, legSideDeg: 8 },
            {
                linked: true,
                promote: true,
            },
        );
        expect(linked.left.legRearDeg).toBe(10);
        expect(linked.right.legRearDeg).toBe(10);
        expect(linked.left.legSideDeg).toBe(8);
        expect(linked.right.legSideDeg).toBe(8);
        expect(linked.left.heelLiftMm).toBe(4);
        expect(linked.right.heelLiftMm).toBe(-2);
        expect(linked.legRearDeg).toBe(10);

        const alone = writeAfoSideCorrection(
            base,
            "left",
            { legRearDeg: 10 },
            { linked: false, promote: false },
        );
        expect(alone.left.legRearDeg).toBe(10);
        expect(alone.right.legRearDeg).toBe(-3);
        expect(alone.legRearDeg).toBe(base.legRearDeg);

        for (const side of ["left", "right"] as const) {
            const fx = plantarFixture(side);
            const out = applyAfoCorrections(
                fx.mesh,
                { ...linked, ...linked[side], smoothIterations: 0 },
                fx.axes,
            );
            const before = measureShankAngles(fx.mesh, fx.axes);
            const after = measureShankAngles(out, fx.axes);
            expect(after.frontalDeg - before.frontalDeg).toBeCloseTo(10, 0);
            expect(after.sagittalDeg - before.sagittalDeg).toBeCloseTo(8, 0);
        }
    });

    test("scan-workflow malleoli and the fibular head are read in the oriented frame", () => {
        const afo = defaultAfoDesignState("right");
        afo.scanWorkflow.alignmentApplied = true;
        afo.scanWorkflow.matrixElements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1];
        afo.scanWorkflow.landmarks = {
            medial_malleolus: { x: 40, y: 28, z: 80 },
            lateral_malleolus: { x: 40, y: -28, z: 78 },
            fibular_head: { x: 40, y: 0, z: 180 },
        };
        afo.scanWorkflow.plantar = {
            heel: { x: 0, y: 0, z: 0 },
            m1p: { x: 150, y: 22, z: 0 },
            m5p: { x: 150, y: -22, z: 0 },
        };
        const ctx = correctionContextFromAfo(afo);
        expect(ctx.anatomical).toBe(true);
        expect(ctx.medialMal.x).toBeCloseTo(140, 5);
        expect(ctx.lateralMal.x).toBeCloseTo(140, 5);
        expect(ctx.fibularHead?.x).toBeCloseTo(140, 5);
        expect(ctx.heel?.x).toBeCloseTo(100, 5);
        expect(ctx.side).toBe("right");
    });
});
