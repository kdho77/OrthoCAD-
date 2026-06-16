// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { extractMergedGeometry } from "@/lib/library/loaders";
import {
    alignLoopWindingXZ,
    buildBridgeStrip,
    closeMeshPerimeter,
    resampleLoop,
    resampleLoopToCount,
    validateManifold,
} from "@/lib/geometry/mesh-close";

function makeTopBottomGroup(): THREE.Group {
    const group = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(90, 260, 5), new THREE.MeshStandardMaterial());
    top.name = "Top";
    top.position.set(0, 0, 10);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(90, 260, 5), new THREE.MeshStandardMaterial());
    bottom.name = "Bottom";
    bottom.position.set(0, 0, 0);
    group.add(top, bottom);
    return group;
}

describe("mesh-close — perimeter stitching", () => {
    test("merged Top+Bottom GLB is a false-positive watertight (euler != 2)", () => {
        const merged = extractMergedGeometry(makeTopBottomGroup());
        expect(merged).not.toBeNull();
        const pre = validateManifold(merged!.geometry);
        // Each shell is closed, so openEdges=0 — but the two shells are not bridged.
        expect(pre.openEdges).toBe(0);
        expect(pre.eulerCharacteristic).not.toBe(2);
    });

    test("closeMeshPerimeter produces watertight mesh with Euler=2", () => {
        const merged = extractMergedGeometry(makeTopBottomGroup())!;
        (merged.geometry.userData as { isMultiMeshBase?: boolean }).isMultiMeshBase = true;

        const result = closeMeshPerimeter(merged.geometry);
        expect(result.report.isWatertight).toBe(true);
        expect(result.report.openEdges).toBe(0);
        expect(result.report.nonManifoldEdges).toBe(0);
        expect(result.report.eulerCharacteristic).toBe(2);
        expect(result.bridgeTriangleCount).toBeGreaterThan(0);
        expect(result.rimHeightsMm.length).toBe(8);
    });

    test("resampleLoopToCount preserves loop count and closes evenly", () => {
        const loop = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(10, 0, 0),
            new THREE.Vector3(10, 10, 0),
            new THREE.Vector3(0, 10, 0),
        ];
        const resampled = resampleLoopToCount(loop, 8);
        expect(resampled.length).toBe(8);
        expect(resampled[0]!.distanceTo(resampled[7]!)).toBeGreaterThan(0);
    });

    test("resampleLoop equal count returns same square corners", () => {
        const loop = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(10, 0, 0),
            new THREE.Vector3(10, 0, 10),
            new THREE.Vector3(0, 0, 10),
        ];
        const out = resampleLoop(loop, 4);
        expect(out.length).toBe(4);
        for (let i = 0; i < 4; i++) {
            expect(out[i]!.distanceTo(loop[i]!)).toBeLessThan(1e-6);
        }
    });

    test("resampleLoop upsamples square to edge midpoints", () => {
        const loop = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(10, 0, 0),
            new THREE.Vector3(10, 0, 10),
            new THREE.Vector3(0, 0, 10),
        ];
        const out = resampleLoop(loop, 8);
        expect(out.length).toBe(8);
        expect(out[1]!.distanceTo(new THREE.Vector3(5, 0, 0))).toBeLessThan(1e-6);
    });

    test("resampleLoop handles unequal source counts via targetN", () => {
        const topLoop = Array.from({ length: 400 }, (_, i) => {
            const t = (i / 400) * Math.PI * 2;
            return new THREE.Vector3(Math.cos(t) * 50, 0, Math.sin(t) * 30);
        });
        const botLoop = Array.from({ length: 446 }, (_, i) => {
            const t = (i / 446) * Math.PI * 2;
            return new THREE.Vector3(Math.cos(t) * 50, 0, Math.sin(t) * 28);
        });
        const targetN = Math.max(topLoop.length, botLoop.length);
        expect(resampleLoop(topLoop, targetN).length).toBe(446);
        expect(resampleLoop(botLoop, targetN).length).toBe(446);
    });

    test("buildBridgeStrip produces 2N triangles without degenerates", () => {
        const loop10 = Array.from({ length: 10 }, (_, i) => {
            const t = (i / 10) * Math.PI * 2;
            return new THREE.Vector3(Math.cos(t) * 20, 0, Math.sin(t) * 10);
        });
        const bridge = buildBridgeStrip(loop10, loop10.map((p) => p.clone().setY(0).setZ(p.z - 3)));
        expect(bridge.triangleCount).toBe(20);
        for (let t = 0; t < bridge.indices.length; t += 3) {
            const a = bridge.indices[t]!;
            const b = bridge.indices[t + 1]!;
            const c = bridge.indices[t + 2]!;
            const ax = bridge.positions[a * 3]!;
            const ay = bridge.positions[a * 3 + 1]!;
            const az = bridge.positions[a * 3 + 2]!;
            const bx = bridge.positions[b * 3]!;
            const by = bridge.positions[b * 3 + 1]!;
            const bz = bridge.positions[b * 3 + 2]!;
            const cx = bridge.positions[c * 3]!;
            const cy = bridge.positions[c * 3 + 1]!;
            const cz = bridge.positions[c * 3 + 2]!;
            const abx = bx - ax;
            const aby = by - ay;
            const abz = bz - az;
            const acx = cx - ax;
            const acy = cy - ay;
            const acz = cz - az;
            const crossLen = Math.hypot(
                aby * acz - abz * acy,
                abz * acx - abx * acz,
                abx * acy - aby * acx,
            );
            expect(crossLen).toBeGreaterThan(1e-9);
        }
    });

    test("alignLoopWindingXZ reverses mismatched bottom winding", () => {
        const topLoop = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(10, 0, 0),
            new THREE.Vector3(10, 0, 10),
            new THREE.Vector3(0, 0, 10),
        ];
        const botLoop = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, 10),
            new THREE.Vector3(10, 0, 10),
            new THREE.Vector3(10, 0, 0),
        ];
        const aligned = alignLoopWindingXZ(topLoop, botLoop);
        expect(aligned.windingAligned).toBe(false);
        const topArea = aligned.topLoop.reduce((s, p, i, arr) => {
            const b = arr[(i + 1) % arr.length]!;
            return s + p.x * b.z - b.x * p.z;
        }, 0);
        const botArea = aligned.botLoop.reduce((s, p, i, arr) => {
            const b = arr[(i + 1) % arr.length]!;
            return s + p.x * b.z - b.x * p.z;
        }, 0);
        expect(topArea * botArea).toBeGreaterThan(0);
    });
});
