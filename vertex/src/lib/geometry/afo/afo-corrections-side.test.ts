// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { applyAfoCorrections, medialWidthXSign } from "./corrections";
import { defaultAfoCorrections } from "./defaults";
import { positionsEqual } from "./mesh-ops";
import type { AfoCorrections, AfoTriMesh, AfoVec3 } from "./types";

/**
 * Correction loop frame: X is width, Y is heel→toe, Z is up.
 * Left medial is +X. Right medial is −X (the mesh is mirrored).
 */
function legacyLeg(side: "left" | "right"): {
    mesh: AfoTriMesh;
    medial: number;
    lateral: number;
    heel: number;
    toe: number;
} {
    const medialX = side === "left" ? 24 : -24;
    const lateralX = -medialX;
    const positions = new Float32Array([
        0,
        0,
        5, // heel
        medialX,
        70,
        8, // medial midfoot
        lateralX,
        70,
        8, // lateral midfoot
        0,
        140,
        5, // toe
        medialX,
        40,
        12, // medial forefoot
        lateralX,
        40,
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
    const medialX = side === "left" ? 35 : -35;
    return {
        side,
        anatomical: false as const,
        medialMal: { x: medialX, y: 40, z: 80 },
        lateralMal: { x: -medialX, y: 40, z: 80 },
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

describe("AFO correction sides in the legacy width frame", () => {
    test("medial arch rises on the medial vertex for a left and a right leg", () => {
        for (const side of ["left", "right"] as const) {
            const leg = legacyLeg(side);
            const out = applyAfoCorrections(leg.mesh, corrections({ medialArchMm: 4 }), axes(side));
            const medialRise = z(out, leg.medial) - z(leg.mesh, leg.medial);
            const lateralRise = z(out, leg.lateral) - z(leg.mesh, leg.lateral);
            expect(medialRise).toBeGreaterThan(2);
            expect(lateralRise).toBe(0);
            expect(medialWidthXSign(axes(side).medialMal, axes(side).lateralMal, side)).toBe(
                side === "left" ? 1 : -1,
            );
        }
    });

    test("medial and lateral foot lifts stay on their own sides for both feet", () => {
        for (const side of ["left", "right"] as const) {
            const leg = legacyLeg(side);
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
            const leg = legacyLeg(side);
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
