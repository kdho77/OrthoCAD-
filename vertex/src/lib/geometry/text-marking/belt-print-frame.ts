// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { TextXy } from "./types";

/**
 * VertexSlice headless placement for an OrthoCAD insole (`belt_insole_place`
 * defaults on). `orthocad_base_rotation_z_deg("toe_first")` is 90+180.
 * Rigid, det +1. Width lands on model +X, the toe on model Y min.
 */
export const BELT_PREPROCESS_Z_DEG = 270;

/**
 * Locked `BeltTransform::make_forward_transform` (VertexSlice BeltTransform.cpp).
 * Y_virt = Z_model, Z_virt = Y_model + Z_model, X unchanged.
 * det = −1. Slicing is on Y+Z = const. The gcode inverse reproduces this
 * virtual mesh on the belt (gantry Y = √2·Y_virt, belt Z = layer Z_virt),
 * so the deposited part is this reflection of the STL, not the STL.
 */
export function beltForward(p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return { x: p.x, y: p.z, z: p.y + p.z };
}

export function rotateZ(p: { x: number; y: number }, deg: number): { x: number; y: number } {
    const rad = (deg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** STL point → part frame the belt deposits. Translations do not change chirality. */
export function beltPrintedPoint(p: { x: number; y: number; z: number }): {
    across: number;
    height: number;
    along: number;
} {
    const spun = rotateZ(p, BELT_PREPROCESS_Z_DEG);
    const virt = beltForward({ x: spun.x, y: spun.y, z: p.z });
    return { across: virt.x, height: virt.y, along: virt.z };
}

/**
 * Machine point the belt deposits. G-code is this frame: X across, Y height
 * off the belt, Z along. Inverse of `BeltTransform::inverse_transform_point`
 * (Y_mach = √2·Z_model, Z_mach = Y_model). Live preprocess is Rz only — the
 * rejected Y-negate overlay is not applied.
 */
export function beltMachinePoint(
    p: { x: number; y: number; z: number },
    rotateDeg = BELT_PREPROCESS_Z_DEG,
): { x: number; y: number; z: number } {
    const spun = rotateZ(p, rotateDeg);
    const model = { x: spun.x, y: spun.y, z: p.z };
    return { x: model.x, y: Math.SQRT2 * model.z, z: model.y };
}

/**
 * Sole, from below. Look direction is +height toward the belt contact (Z = 0
 * in the part frame). Toe (+mesh X) is screen-right and screen-up is −mesh Y,
 * the same camera as the flat bed. Matches `physicalReadingView` on the
 * machine point (toe-first: screen (−zt, −X)).
 */
export function printedPlantarView(
    p: TextXy & { z?: number },
    printDirection: "toe_first" | "heel_first" = "toe_first",
): TextXy {
    const heelFirst = printDirection === "heel_first";
    const mach = beltMachinePoint({ x: p.x, y: p.y, z: p.z ?? 0 }, heelFirst ? 90 : BELT_PREPROCESS_Z_DEG);
    const zt = mach.z - mach.y;
    const sign = heelFirst ? 1 : -1;
    return { x: sign * zt, y: sign * mach.x };
}

/** Flat-bed sole. No belt rotation. Same from-below camera: screen (X, −Y). */
export function flatBedSoleView(p: TextXy): TextXy {
    return { x: p.x, y: -p.y };
}

/** Linear det of model → printed part. −1 is the mirror. */
export function beltPrintFrameDet(): number {
    const o = beltPrintedPoint({ x: 0, y: 0, z: 0 });
    const ex = beltPrintedPoint({ x: 1, y: 0, z: 0 });
    const ey = beltPrintedPoint({ x: 0, y: 1, z: 0 });
    const ez = beltPrintedPoint({ x: 0, y: 0, z: 1 });
    const cx = { x: ex.across - o.across, y: ex.height - o.height, z: ex.along - o.along };
    const cy = { x: ey.across - o.across, y: ey.height - o.height, z: ey.along - o.along };
    const cz = { x: ez.across - o.across, y: ez.height - o.height, z: ez.along - o.along };
    const cross = {
        x: cy.y * cz.z - cy.z * cz.y,
        y: cy.z * cz.x - cy.x * cz.z,
        z: cy.x * cz.y - cy.y * cz.x,
    };
    return cx.x * cross.x + cx.y * cross.y + cx.z * cross.z;
}
