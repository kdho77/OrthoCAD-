// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Frozen belt camera for the plantar-face name. Independent of
// vertex/src/lib/geometry/text-marking/belt-print-frame.ts, which scores the
// gantry reading that already looks correct on BASE.

export interface Xyz {
    x: number;
    y: number;
    z: number;
}

export interface Xy {
    x: number;
    y: number;
}

/** VertexSlice `orthocad_base_rotation_z_deg("toe_first")` = 90+180. det +1. */
export const BELT_PREPROCESS_Z_DEG = 270;

/**
 * Locked `BeltTransform::make_forward_transform`.
 * Y_virt = Z_model, Z_virt = Y_model + Z_model, X unchanged. det = −1.
 * Gantry Y = √2·Y_virt, belt Z = Z_virt. The shear comes back out; the mirror stays.
 */
export function beltForward(p: Xyz): Xyz {
    return { x: p.x, y: p.z, z: p.y + p.z };
}

export function rotateZ(p: { x: number; y: number }, deg: number): { x: number; y: number } {
    const rad = (deg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** STL millimetres → part frame the belt deposits. across / height / along. */
export function beltPrintedPoint(p: Xyz): { across: number; height: number; along: number } {
    const spun = rotateZ(p, BELT_PREPROCESS_Z_DEG);
    const virt = beltForward({ x: spun.x, y: spun.y, z: p.z });
    return { across: virt.x, height: virt.y, along: virt.z };
}

/**
 * G-code point for a deposited vertex. X stays the virtual X (part across).
 * Gantry Y = √2·height. Belt Z = along. Translations do not change chirality.
 */
export function beltGcodePoint(p: Xyz): Xyz {
    const part = beltPrintedPoint(p);
    return { x: part.across, y: Math.SQRT2 * part.height, z: part.along };
}

/** Linear det of mesh → deposited part. The belt mirror is −1. */
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

/**
 * Right-handed view of the outside plantar face, looking toward +height
 * (right × up = −height, toward the camera). Toe (+mesh X, −along) is screen-right.
 * Screen-up is +across. At z = 0 this is screen (mesh X, mesh Y).
 *
 * On BASE the beltPrint string is left-to-right and upright here. That is the
 * gantry / from-above reading (looking toward −height in the shop's toolpath
 * view). It is the wrong acceptance camera.
 */
export function gantryFromAboveView(p: Xyz): Xy {
    const part = beltPrintedPoint(p);
    return { x: -part.along, y: part.across };
}

/**
 * Acceptance camera. Flip-the-device-over view of the physical plantar face:
 * the X flip of {@link gantryFromAboveView}. Caps stay screen-up (+across).
 * Screen-right becomes +along, so a string that advances in +mesh X reads
 * right-to-left.
 *
 * Toe toward the viewer is this same mirror rotated 90° ({@link toeTowardViewerView}).
 * A rotation does not un-mirror the name. G1 scores this frame, where "upright"
 * and "left to right" are the cap and the advance.
 */
export function physicalPlantarView(p: Xyz): Xy {
    const gantry = gantryFromAboveView(p);
    return { x: -gantry.x, y: gantry.y };
}

/**
 * Same mirror as {@link physicalPlantarView}, rotated so the toe points at the
 * viewer (screen-down) and the heel is screen-up. Letters then lie on their side.
 * Chirality matches the physical frame; G1 does not treat a sideways pose as a
 * different mirror.
 */
export function toeTowardViewerView(p: Xyz): Xy {
    const face = physicalPlantarView(p);
    return { x: -face.y, y: face.x };
}
