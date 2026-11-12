// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { designSettingsEnvelope, readStoredDesignSettings } from "../../../../shared/design-settings";
import { applyAfoCorrections } from "./corrections";
import {
    AFO_ARCH_RANGE,
    AFO_BRACE_HEIGHT_RANGE,
    AFO_HEEL_LIFT_RANGE,
    AFO_SMOOTH_RANGE,
    AFO_TOE_RISE_RANGE,
    AFO_VOLUME_FEATHER_MM,
    defaultAfoCorrections,
    defaultAfoDesignState,
} from "./defaults";
import type { AfoCorrections, AfoTriMesh } from "./types";

function sheet(): AfoTriMesh {
    const positions = new Float32Array([
        0,
        0,
        5, // heel
        18,
        70,
        5, // medial arch
        180,
        0,
        5, // toe, anterior on +X
        -10,
        40,
        5,
    ]);
    const indices = new Uint32Array([0, 1, 3, 1, 2, 3]);
    return { positions, indices };
}

function run(partial: Partial<AfoCorrections>): AfoTriMesh {
    const c = defaultAfoCorrections();
    c.smoothIterations = 0;
    c.volumeRegions = [];
    Object.assign(c, partial);
    c.left = { ...c.left, ...partial };
    c.right = { ...c.right, ...partial };
    return applyAfoCorrections(sheet(), c, {
        navicular: { x: 18, y: 70, z: 5 },
        side: "left",
        anatomical: false,
    });
}

function zAt(mesh: AfoTriMesh, index: number): number {
    return mesh.positions[index * 3 + 2] ?? 0;
}

describe("signed AFO displacement corrections", () => {
    test("slider ranges accept a negative medial arch, heel lift, and toe rise", () => {
        expect(AFO_ARCH_RANGE[0]).toBeLessThan(0);
        expect(AFO_ARCH_RANGE[1]).toBeGreaterThan(0);
        expect(AFO_HEEL_LIFT_RANGE[0]).toBeLessThan(0);
        expect(AFO_TOE_RISE_RANGE[0]).toBeLessThan(0);
        expect(AFO_BRACE_HEIGHT_RANGE[0]).toBeGreaterThan(0);
        expect(AFO_SMOOTH_RANGE[0]).toBe(0);
        expect(AFO_VOLUME_FEATHER_MM[0]).toBeGreaterThan(0);
    });

    test("negative medial arch lowers the arch and does not snap to zero", () => {
        const zero = zAt(run({}), 1);
        const raised = zAt(run({ medialArchMm: 3 }), 1);
        const lowered = zAt(run({ medialArchMm: -3 }), 1);
        expect(raised).toBeGreaterThan(zero + 2);
        expect(lowered).toBeLessThan(zero - 2);
        expect(lowered).not.toBe(zero);
    });

    test("heel lift and toe rise already move as signed offsets", () => {
        const heelUp = zAt(run({ heelLiftMm: 4 }), 0);
        const heelDown = zAt(run({ heelLiftMm: -4 }), 0);
        expect(heelUp).toBeGreaterThan(5);
        expect(heelDown).toBeLessThan(5);

        const toeUp = zAt(run({ toeRiseMm: 4 }), 2);
        const toeDown = zAt(run({ toeRiseMm: -4 }), 2);
        expect(toeUp).toBeGreaterThan(5);
        expect(toeDown).toBeLessThan(5);
    });

    test("settingsJson keeps a typed negative medial arch", () => {
        const afo = defaultAfoDesignState("left");
        afo.corrections.medialArchMm = -4;
        afo.corrections.heelLiftMm = -6;
        afo.corrections.toeRiseMm = -2;
        afo.corrections.left = {
            ...afo.corrections.left,
            medialArchMm: -4,
            heelLiftMm: -6,
            toeRiseMm: -2,
        };
        const back = readStoredDesignSettings(designSettingsEnvelope({ productType: "afo", afo })) as {
            afo: typeof afo;
        };
        expect(back.afo.corrections.medialArchMm).toBe(-4);
        expect(back.afo.corrections.left.medialArchMm).toBe(-4);
        expect(back.afo.corrections.left.heelLiftMm).toBe(-6);
        expect(back.afo.corrections.left.toeRiseMm).toBe(-2);
    });
});
