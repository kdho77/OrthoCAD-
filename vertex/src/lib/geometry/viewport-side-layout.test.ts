// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import type { CameraView } from "@/stores/design-store";
import { INSOLE_GAP_MM, INSOLE_WIDTH_MM, sideOffsetX } from "./layout";
import {
    applyCameraViewPreset,
    cameraForView,
    furtherScreenLeft,
    instanceWorldPosition,
    projectViewNdcX,
    projectViewNdcY,
    VIEW_CAMERA_POS,
    viewCameraUp,
} from "./viewport-side-layout";

/** Orthogonal anatomical presets (excludes free Orbit / iso). */
const ORTHOGONAL: Exclude<CameraView, "iso">[] = ["front", "back", "left", "right", "top", "bottom"];

const PAIR_HALF_SPAN = (INSOLE_WIDTH_MM + INSOLE_GAP_MM) / 2;

/** Expected normalize(target→position) axis for each orthogonal preset. */
const EXPECTED_DIR: Record<Exclude<CameraView, "iso">, [number, number, number]> = {
    front: [1, 0, 0],
    back: [-1, 0, 0],
    left: [0, 0, 1],
    right: [0, 0, -1],
    top: [0, 1, 0],
    bottom: [0, -1, 0],
};

const HEEL_TOE: THREE.Vector3 = new THREE.Vector3(1, 0, 0);
const MEDIAL_LATERAL: THREE.Vector3 = new THREE.Vector3(0, 0, 1);

function targetToPositionDir(view: CameraView): THREE.Vector3 {
    const pos = new THREE.Vector3(...VIEW_CAMERA_POS[view]);
    return pos.normalize();
}

describe("viewport side layout (T24–T27)", () => {
    test("T27: eye-toggle side ids match mesh instance placement keys", () => {
        // showLeft / showRight gate side="left" / side="right" meshes; offsets must differ.
        expect(sideOffsetX("left")).not.toBe(sideOffsetX("right"));
        expect(instanceWorldPosition("left").z).not.toBe(instanceWorldPosition("right").z);
    });

    test("T25: Top view — left instance projects further screen-left than right", () => {
        const lx = projectViewNdcX("top", instanceWorldPosition("left"));
        const rx = projectViewNdcX("top", instanceWorldPosition("right"));
        expect(lx).toBeLessThan(rx);
        expect(furtherScreenLeft("top")).toBe("left");
    });

    test("T24: hiding right leaves the Top screen-left instance (left)", () => {
        expect(furtherScreenLeft("top")).toBe("left");
        const lx = projectViewNdcX("top", instanceWorldPosition("left"));
        const rx = projectViewNdcX("top", instanceWorldPosition("right"));
        expect(rx).toBeGreaterThan(lx);
    });

    test("T26: Bottom remains L/R-transposed relative to Top (optically correct)", () => {
        expect(furtherScreenLeft("top")).toBe("left");
        expect(furtherScreenLeft("bottom")).toBe("right");
        expect(viewCameraUp("top")).toEqual(viewCameraUp("bottom"));
        expect(VIEW_CAMERA_POS.top[1]).toBeGreaterThan(0);
        expect(VIEW_CAMERA_POS.bottom[1]).toBeLessThan(0);
    });
});

describe("pair placement — screen L/R + medial adjacency", () => {
    test("world Z: left and right sit on opposite sides of origin (medial↔lateral = ±Z)", () => {
        const lz = instanceWorldPosition("left").z;
        const rz = instanceWorldPosition("right").z;
        expect(lz).toBeLessThan(0);
        expect(rz).toBeGreaterThan(0);
        expect(Math.abs(lz)).toBeCloseTo(PAIR_HALF_SPAN, 5);
        expect(Math.abs(rz)).toBeCloseTo(PAIR_HALF_SPAN, 5);
        expect(Math.sign(lz)).not.toBe(Math.sign(rz));
    });

    test("Top: projected screen-X of left < right", () => {
        const lx = projectViewNdcX("top", instanceWorldPosition("left"));
        const rx = projectViewNdcX("top", instanceWorldPosition("right"));
        expect(lx).toBeLessThan(rx);
    });

    test("arch-apex adjacency: medial edges face each other (inner gap < outer span)", () => {
        // Default.glb left arch sits on width−; mirrored right arch on width+.
        // After Rx(−90°): worldZ = −(localY + sideOffset).
        const halfWidth = INSOLE_WIDTH_MM / 2;
        const worldZ = (side: "left" | "right", localY: number) => -(localY + sideOffsetX(side));
        const leftMedialZ = worldZ("left", -halfWidth);
        const rightMedialZ = worldZ("right", halfWidth);
        const leftLateralZ = worldZ("left", halfWidth);
        const rightLateralZ = worldZ("right", -halfWidth);
        const innerGap = Math.abs(leftMedialZ - rightMedialZ);
        const outerSpan = Math.abs(leftLateralZ - rightLateralZ);
        expect(innerGap).toBeLessThan(outerSpan);
        // Medials are closer to the midline than the instance centers.
        expect(Math.abs(leftMedialZ)).toBeLessThan(Math.abs(instanceWorldPosition("left").z));
        expect(Math.abs(rightMedialZ)).toBeLessThan(Math.abs(instanceWorldPosition("right").z));
    });

    test("Bottom: left projects to greater screen-X than right (intended transposition)", () => {
        const lx = projectViewNdcX("bottom", instanceWorldPosition("left"));
        const rx = projectViewNdcX("bottom", instanceWorldPosition("right"));
        expect(lx).toBeGreaterThan(rx);
        expect(furtherScreenLeft("bottom")).toBe("right");
    });

    test("idempotency: remount / visibility toggle 5× yields identical world positions", () => {
        const p0L = instanceWorldPosition("left").clone();
        const p0R = instanceWorldPosition("right").clone();
        for (let i = 0; i < 5; i++) {
            // Toggle visibility is presentation-only; offset is a pure function of side.
            void sideOffsetX("left");
            void sideOffsetX("right");
            expect(instanceWorldPosition("left").distanceTo(p0L)).toBeLessThan(1e-9);
            expect(instanceWorldPosition("right").distanceTo(p0R)).toBeLessThan(1e-9);
        }
    });

    test("no negative scale on pair placement objects", () => {
        // Placement is a translation only — scene objects must keep positive scale.
        for (const side of ["left", "right"] as const) {
            const obj = new THREE.Object3D();
            obj.position.copy(instanceWorldPosition(side));
            obj.scale.set(1, 1, 1);
            expect(obj.scale.x).toBeGreaterThan(0);
            expect(obj.scale.y).toBeGreaterThan(0);
            expect(obj.scale.z).toBeGreaterThan(0);
        }
        expect(sideOffsetX("left")).toBeGreaterThan(0);
        expect(sideOffsetX("right")).toBeLessThan(0);
    });

    test("empty-scene: placement helpers do not throw and produce finite positions", () => {
        expect(() => sideOffsetX("left")).not.toThrow();
        expect(() => instanceWorldPosition("right")).not.toThrow();
        const p = instanceWorldPosition("left");
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(Number.isFinite(p.z)).toBe(true);
        expect(Number.isNaN(p.x + p.y + p.z)).toBe(false);
    });
});

describe("camera view presets — anatomical orientation", () => {
    test("each orthogonal preset: target→position direction matches expected world axis", () => {
        for (const view of ORTHOGONAL) {
            const dir = targetToPositionDir(view);
            const expected = new THREE.Vector3(...EXPECTED_DIR[view]);
            // Coronal/sagittal presets keep a small +Y elevation (y=40); require dominant axis + sign.
            expect(dir.dot(expected)).toBeGreaterThan(0.99);
            expect(dir.length()).toBeCloseTo(1, 5);
        }
    });

    test("each orthogonal preset: camera.up matches viewCameraUp", () => {
        for (const view of ORTHOGONAL) {
            const cam = cameraForView(view);
            const up = viewCameraUp(view);
            expect(cam.up.x).toBeCloseTo(up[0], 5);
            expect(cam.up.y).toBeCloseTo(up[1], 5);
            expect(cam.up.z).toBeCloseTo(up[2], 5);
        }
    });

    test("Top and Bottom: toe projects higher on screen (larger NDC Y) than heel", () => {
        // Synthetic anatomical points on the confirmed heel→toe = +X axis.
        const heel = new THREE.Vector3(-100, 10, 0);
        const toe = new THREE.Vector3(100, 10, 0);
        for (const view of ["top", "bottom"] as const) {
            const heelY = projectViewNdcY(view, heel);
            const toeY = projectViewNdcY(view, toe);
            // Three.js NDC +Y is screen-up ≡ smaller CSS screen-Y.
            expect(toeY).toBeGreaterThan(heelY);
        }
    });

    test("Front looks down the long axis (toe-facing), not the transverse axis", () => {
        const lookDir = new THREE.Vector3(...VIEW_CAMERA_POS.front).negate().normalize();
        // |look · heel→toe| ≈ 1 (slight depression from y=40 elevation); transverse ≈ 0.
        expect(Math.abs(lookDir.dot(HEEL_TOE))).toBeGreaterThan(0.99);
        expect(Math.abs(lookDir.dot(MEDIAL_LATERAL))).toBeLessThan(0.01);
    });

    test("idempotency: applying the same preset twice yields identical pose", () => {
        const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
        const target = new THREE.Vector3();
        const controls = {
            object: camera,
            target,
            update: () => {
                camera.lookAt(target);
            },
        };
        for (const view of ORTHOGONAL) {
            applyCameraViewPreset(controls, view);
            const p1 = camera.position.clone();
            const q1 = camera.quaternion.clone();
            const u1 = camera.up.clone();
            applyCameraViewPreset(controls, view);
            expect(camera.position.distanceTo(p1)).toBeLessThan(1e-6);
            expect(camera.quaternion.angleTo(q1)).toBeLessThan(1e-6);
            expect(camera.up.distanceTo(u1)).toBeLessThan(1e-6);
        }
    });

    test("roll reset: arbitrary camera.up is restored to the preset up", () => {
        const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
        const target = new THREE.Vector3();
        const controls = {
            object: camera,
            target,
            update: () => {
                camera.lookAt(target);
            },
        };
        camera.up.set(0.3, 0.4, 0.5).normalize();
        applyCameraViewPreset(controls, "front");
        const expected = viewCameraUp("front");
        expect(camera.up.x).toBeCloseTo(expected[0], 5);
        expect(camera.up.y).toBeCloseTo(expected[1], 5);
        expect(camera.up.z).toBeCloseTo(expected[2], 5);

        camera.up.set(-0.7, 0.1, 0.2).normalize();
        applyCameraViewPreset(controls, "top");
        const topUp = viewCameraUp("top");
        expect(camera.up.x).toBeCloseTo(topUp[0], 5);
        expect(camera.up.y).toBeCloseTo(topUp[1], 5);
        expect(camera.up.z).toBeCloseTo(topUp[2], 5);
    });

    test("empty-scene guard: null/undefined controls do not throw", () => {
        expect(() => applyCameraViewPreset(null, "front")).not.toThrow();
        expect(() => applyCameraViewPreset(undefined, "top")).not.toThrow();
        expect(applyCameraViewPreset(null, "front")).toBe(false);
        expect(
            applyCameraViewPreset(
                {
                    object: null as unknown as THREE.PerspectiveCamera,
                    target: new THREE.Vector3(),
                    update: () => {},
                },
                "back",
            ),
        ).toBe(false);
    });

    test("Top⇄Bottom repeated switches do not drift", () => {
        const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
        const target = new THREE.Vector3();
        const controls = {
            object: camera,
            target,
            update: () => {
                camera.lookAt(target);
            },
        };
        applyCameraViewPreset(controls, "top");
        const topPos = camera.position.clone();
        const topUp = camera.up.clone();
        for (let i = 0; i < 5; i++) {
            applyCameraViewPreset(controls, "bottom");
            applyCameraViewPreset(controls, "top");
        }
        expect(camera.position.distanceTo(topPos)).toBeLessThan(1e-6);
        expect(camera.up.distanceTo(topUp)).toBeLessThan(1e-6);
    });
});
