// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { medialSign } from "@/lib/geometry/handedness";
import type { Side } from "@/types";
import { type AfoRotationAxes, applyAfoCorrections } from "./corrections";
import { defaultAfoCorrections } from "./defaults";
import type { AfoCorrections, AfoTriMesh } from "./types";

/**
 * Aligned plantar frame: +X heel→toe, +Y medial-signed, +Z up.
 * The heel sits at high Y and the toes at low Y so a Y-length warp
 * lifts the wrong end.
 */
function plantarFoot(side: Side): { mesh: AfoTriMesh; axes: AfoRotationAxes; heel: number; toe: number } {
    const med = medialSign(side);
    const positions = new Float32Array([
        0,
        100,
        8, // heel, posterior
        210,
        0,
        8, // toes, anterior
        40,
        36 * med,
        12,
        40,
        -36 * med,
        12,
    ]);
    return {
        mesh: { positions, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) },
        axes: {
            side,
            anatomical: true,
            heel: { x: 0, y: 0, z: 0 },
            m1: { x: 190, y: 24 * med, z: 1 },
            m5: { x: 180, y: -28 * med, z: 1 },
            medialMal: { x: 20, y: 30 * med, z: 70 },
            lateralMal: { x: 12, y: -32 * med, z: 64 },
        },
        heel: 0,
        toe: 1,
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

function z(mesh: AfoTriMesh, index: number): number {
    return mesh.positions[index * 3 + 2] ?? 0;
}

describe("Heel Lift and Toe Rise on the aligned plantar frame", () => {
    test("positive heel lift raises the heel more than the toes on both feet", () => {
        for (const side of ["left", "right"] as const) {
            const foot = plantarFoot(side);
            const out = applyAfoCorrections(foot.mesh, corrections({ heelLiftMm: 6 }), foot.axes);
            const heelRise = z(out, foot.heel) - z(foot.mesh, foot.heel);
            const toeRise = z(out, foot.toe) - z(foot.mesh, foot.toe);
            expect(heelRise, side).toBeGreaterThan(4);
            expect(heelRise, side).toBeGreaterThan(toeRise + 3);
        }
    });

    test("positive toe rise raises the toes more than the heel on both feet", () => {
        for (const side of ["left", "right"] as const) {
            const foot = plantarFoot(side);
            const out = applyAfoCorrections(foot.mesh, corrections({ toeRiseMm: 6 }), foot.axes);
            const heelRise = z(out, foot.heel) - z(foot.mesh, foot.heel);
            const toeRise = z(out, foot.toe) - z(foot.mesh, foot.toe);
            expect(toeRise, side).toBeGreaterThan(4);
            expect(toeRise, side).toBeGreaterThan(heelRise + 3);
        }
    });
});
