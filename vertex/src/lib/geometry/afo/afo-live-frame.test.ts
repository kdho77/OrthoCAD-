// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { medialSign } from "@/lib/geometry/handedness";
import type { Side } from "@/types";
import { type AfoRotationAxes, applyAfoCorrections, medialWidthSign } from "./corrections";
import { defaultAfoCorrections } from "./defaults";
import type { AfoCorrections, AfoTriMesh, AfoVec3 } from "./types";

/**
 * Live aligned frame. Medial malleolus is 8.4 mm anterior of the lateral one,
 * so a width-from-X helper would return +1 for both feet.
 */
function liveFoot(side: Side): {
    mesh: AfoTriMesh;
    axes: AfoRotationAxes;
    at: Record<string, number>;
} {
    const sign = medialSign(side);
    const medialY = 28 * sign;
    const lateralY = -medialY;
    const points: Record<string, AfoVec3> = {
        heel: { x: 0, y: 0, z: 6 },
        toe: { x: 200, y: 0, z: 6 },
        medial: { x: 50, y: medialY, z: 10 },
        lateral: { x: 50, y: lateralY, z: 10 },
        medialMid: { x: 70, y: medialY, z: 10 },
        lateralMid: { x: 70, y: lateralY, z: 10 },
        anteriorMed: { x: 190, y: medialY, z: 10 },
        heelWide: { x: 0, y: 18 * sign, z: 8 },
        toeWide: { x: 200, y: 18 * sign, z: 8 },
    };
    const names = Object.keys(points);
    const positions: number[] = [];
    for (const name of names) {
        const p = points[name];
        if (!p) continue;
        positions.push(p.x, p.y, p.z);
    }
    const at: Record<string, number> = {};
    names.forEach((name, index) => {
        at[name] = index;
    });
    return {
        mesh: { positions: new Float32Array(positions), indices: new Uint32Array([0, 1, 2]) },
        axes: {
            side,
            anatomical: true,
            heel: { x: 0, y: 0, z: 0 },
            m1: { x: 190, y: 22 * sign, z: 1 },
            m5: { x: 182, y: -24 * sign, z: 1 },
            medialMal: { x: 20, y: medialY, z: 78 },
            lateralMal: { x: 11.6, y: lateralY, z: 66 },
        },
        at,
    };
}

function corrections(partial: Partial<AfoCorrections>): AfoCorrections {
    const c = defaultAfoCorrections();
    c.smoothIterations = 0;
    c.volumeRegions = [];
    c.smoothRegions = [];
    c.text = null;
    c.braceHeightMm = 2000;
    Object.assign(c, partial, { braceHeightMm: 2000 });
    c.left = { ...c.left, braceHeightMm: 2000, ...partial };
    c.right = { ...c.right, braceHeightMm: 2000, ...partial };
    return c;
}

function dz(before: AfoTriMesh, after: AfoTriMesh, index: number): number {
    return (after.positions[index * 3 + 2] ?? 0) - (before.positions[index * 3 + 2] ?? 0);
}

function coord(mesh: AfoTriMesh, index: number, axis: 0 | 1): number {
    return mesh.positions[index * 3 + axis] ?? 0;
}

describe("live plantar frame corrections", () => {
    test("an anterior malleolar offset is not a width sign", () => {
        for (const side of ["left", "right"] as const) {
            const foot = liveFoot(side);
            const dx = foot.axes.medialMal.x - foot.axes.lateralMal.x;
            expect(dx).toBeCloseTo(8.4, 5);
            expect(medialWidthSign(side)).toBe(medialSign(side));
            expect(Math.sign(foot.axes.medialMal.y)).toBe(medialSign(side));
        }
    });

    test("heel lift, toe rise, side lifts, arch, and heel width follow X length and Y width", () => {
        for (const side of ["left", "right"] as const) {
            const foot = liveFoot(side);
            const heel = applyAfoCorrections(foot.mesh, corrections({ heelLiftMm: 6 }), foot.axes);
            const heelRise = dz(foot.mesh, heel, foot.at.heel ?? 0);
            const toeFromHeel = dz(foot.mesh, heel, foot.at.toe ?? 0);
            expect(heelRise, `${side} heel`).toBeGreaterThan(4);
            expect(heelRise, `${side} heel vs toe`).toBeGreaterThan(toeFromHeel + 3);

            const toes = applyAfoCorrections(foot.mesh, corrections({ toeRiseMm: 6 }), foot.axes);
            const toeRise = dz(foot.mesh, toes, foot.at.toe ?? 0);
            const heelFromToe = dz(foot.mesh, toes, foot.at.heel ?? 0);
            expect(toeRise, `${side} toe`).toBeGreaterThan(4);
            expect(toeRise, `${side} toe vs heel`).toBeGreaterThan(heelFromToe + 3);

            const med = applyAfoCorrections(foot.mesh, corrections({ footLiftMedMm: 4 }), foot.axes);
            const medSide = dz(foot.mesh, med, foot.at.medial ?? 0);
            const latSide = dz(foot.mesh, med, foot.at.lateral ?? 0);
            const anterior = dz(foot.mesh, med, foot.at.toe ?? 0);
            expect(medSide, `${side} medial lift`).toBeGreaterThan(1);
            expect(latSide, `${side} medial lift spares lateral`).toBe(0);
            expect(anterior, `${side} medial lift spares the toe`).toBe(0);

            const lat = applyAfoCorrections(foot.mesh, corrections({ footLiftLatMm: 4 }), foot.axes);
            expect(dz(foot.mesh, lat, foot.at.lateral ?? 0), `${side} lateral lift`).toBeGreaterThan(1);
            expect(dz(foot.mesh, lat, foot.at.medial ?? 0), `${side} lateral lift spares medial`).toBe(0);

            const arch = applyAfoCorrections(foot.mesh, corrections({ medialArchMm: 4 }), foot.axes);
            const mid = dz(foot.mesh, arch, foot.at.medialMid ?? 0);
            const front = dz(foot.mesh, arch, foot.at.anteriorMed ?? 0);
            const rear = dz(foot.mesh, arch, foot.at.heel ?? 0);
            const opposite = dz(foot.mesh, arch, foot.at.lateralMid ?? 0);
            expect(mid, `${side} arch`).toBeGreaterThan(2);
            expect(mid, `${side} arch vs front`).toBeGreaterThan(front + 1);
            expect(mid, `${side} arch vs heel`).toBeGreaterThan(rear + 1);
            expect(opposite, `${side} arch spares lateral`).toBe(0);

            const wide = applyAfoCorrections(foot.mesh, corrections({ heelWidthMm: 4 }), foot.axes);
            const heelIndex = foot.at.heelWide ?? 0;
            const toeIndex = foot.at.toeWide ?? 0;
            const heelDy = Math.abs(coord(wide, heelIndex, 1) - coord(foot.mesh, heelIndex, 1));
            const toeDy = Math.abs(coord(wide, toeIndex, 1) - coord(foot.mesh, toeIndex, 1));
            const heelDx = Math.abs(coord(wide, heelIndex, 0) - coord(foot.mesh, heelIndex, 0));
            expect(heelDy, `${side} heel width Y`).toBeGreaterThan(1);
            expect(heelDy, `${side} heel vs toe width`).toBeGreaterThan(toeDy + 0.5);
            expect(heelDx, `${side} heel width not along X`).toBe(0);
        }
    });
});
