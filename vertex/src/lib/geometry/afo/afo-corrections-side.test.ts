// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { medialSign } from "@/lib/geometry/handedness";
import { applyAfoCorrections, medialWidthSign } from "./corrections";
import { defaultAfoCorrections } from "./defaults";
import { positionsEqual } from "./mesh-ops";
import type { AfoCorrections, AfoTriMesh, AfoVec3 } from "./types";

/**
 * Aligned plantar frame: +X heel→toe, +Y medial-signed, +Z up.
 */
function liveLeg(side: "left" | "right"): {
    mesh: AfoTriMesh;
    medial: number;
    lateral: number;
    heel: number;
    toe: number;
} {
    const medialY = 24 * medialSign(side);
    const lateralY = -medialY;
    const positions = new Float32Array([
        0,
        0,
        5, // heel
        70,
        medialY,
        8, // medial midfoot
        70,
        lateralY,
        8, // lateral midfoot
        180,
        0,
        5, // toe
        50,
        medialY,
        12, // medial forefoot
        50,
        lateralY,
        12, // lateral forefoot
    ]);
    return {
        mesh: { positions, indices: new Uint32Array([0, 1, 2, 1, 2, 3, 4, 5, 1]) },
        medial: 1,
        lateral: 2,
        heel: 0,
        toe: 3,
    };
}

function axes(side: "left" | "right", navicular?: AfoVec3) {
    const medialY = 30 * medialSign(side);
    return {
        side,
        anatomical: false as const,
        medialMal: { x: 20, y: medialY, z: 80 },
        lateralMal: { x: 12, y: -medialY, z: 72 },
        navicular: navicular ?? null,
    };
}

function corrections(partial: Partial<AfoCorrections>): AfoCorrections {
    const c = defaultAfoCorrections();
    c.smoothIterations = 0;
    c.volumeRegions = [];
    c.smoothRegions = [];
    c.text = null;
    Object.assign(c, partial);
    c.left = { ...c.left, ...partial };
    c.right = { ...c.right, ...partial };
    return c;
}

function z(mesh: AfoTriMesh, index: number): number {
    return mesh.positions[index * 3 + 2] ?? 0;
}

describe("AFO correction sides in the aligned plantar frame", () => {
    test("medial arch rises on the medial vertex for a left and a right leg", () => {
        for (const side of ["left", "right"] as const) {
            const leg = liveLeg(side);
            const out = applyAfoCorrections(leg.mesh, corrections({ medialArchMm: 4 }), axes(side));
            const medialRise = z(out, leg.medial) - z(leg.mesh, leg.medial);
            const lateralRise = z(out, leg.lateral) - z(leg.mesh, leg.lateral);
            expect(medialRise).toBeGreaterThan(2);
            expect(lateralRise).toBe(0);
            expect(medialWidthSign(side)).toBe(medialSign(side));
        }
    });

    test("medial and lateral foot lifts stay on their own sides for both feet", () => {
        for (const side of ["left", "right"] as const) {
            const leg = liveLeg(side);
            const med = applyAfoCorrections(leg.mesh, corrections({ footLiftMedMm: 3 }), axes(side));
            expect(z(med, 4) - z(leg.mesh, 4)).toBeGreaterThan(1);
            expect(z(med, 5) - z(leg.mesh, 5)).toBe(0);
            const lat = applyAfoCorrections(leg.mesh, corrections({ footLiftLatMm: 3 }), axes(side));
            expect(z(lat, 5) - z(leg.mesh, 5)).toBeGreaterThan(1);
            expect(z(lat, 4) - z(leg.mesh, 4)).toBe(0);
        }
    });

    test("with no medial or lateral correction the mesh is unchanged", () => {
        for (const side of ["left", "right"] as const) {
            const leg = liveLeg(side);
            const out = applyAfoCorrections(leg.mesh, corrections({}), axes(side));
            expect(positionsEqual(leg.mesh.positions, out.positions)).toBe(true);
            const heelOnly = applyAfoCorrections(leg.mesh, corrections({ heelLiftMm: 4 }), axes(side));
            expect(z(heelOnly, leg.heel)).toBeGreaterThan(z(leg.mesh, leg.heel));
            const medialRise = z(heelOnly, leg.medial) - z(leg.mesh, leg.medial);
            const lateralRise = z(heelOnly, leg.lateral) - z(leg.mesh, leg.lateral);
            expect(medialRise).toBeCloseTo(lateralRise, 6);
        }
    });
});
