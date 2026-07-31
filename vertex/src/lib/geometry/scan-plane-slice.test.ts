// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import {
    applyScanSlicePlanes,
    cuttingPlaneFromViewLine,
    keepPositiveTowardPoint,
    planeWorldToLocal,
    scanSliceFromPlane,
    sliceBufferGeometryByPlane,
} from "@/lib/geometry/scan-plane-slice";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { useScanStore } from "@/stores/scan-store";

function boxSoup(sx: number, sy: number, sz: number, ox = 0, oy = 0, oz = 0): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(ox, oy, oz);
    const non = g.toNonIndexed();
    g.dispose();
    return non;
}

describe("scan plane slice", () => {
    test("S1 — plane removes triangles entirely on discard side", () => {
        // Unit cube centred at origin, extent 1.
        const geo = boxSoup(2, 2, 2, 0, 0, 0);
        const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0); // keep x >= 0
        const sliced = sliceBufferGeometryByPlane(geo, plane, true);
        const pos = sliced.getAttribute("position");
        expect(pos.count).toBeGreaterThan(0);
        for (let i = 0; i < pos.count; i++) {
            expect(pos.getX(i)).toBeGreaterThanOrEqual(-1e-6);
        }
        // Discard side removed: no vertex remains deep in x < 0.
        let deepNeg = 0;
        for (let i = 0; i < pos.count; i++) {
            if (pos.getX(i) < -0.25) deepNeg++;
        }
        expect(deepNeg).toBe(0);
        sliced.computeBoundingBox();
        expect(sliced.boundingBox!.min.x).toBeGreaterThanOrEqual(-1e-6);
        expect(sliced.boundingBox!.max.x).toBeGreaterThan(0.5);
        geo.dispose();
        sliced.dispose();
    });

    test("S2 — straddling triangles are clipped (intersection on plane)", () => {
        const geo = boxSoup(2, 2, 2, 0, 0, 0);
        const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
        const sliced = sliceBufferGeometryByPlane(geo, plane, true);
        const pos = sliced.getAttribute("position");
        let onPlane = 0;
        for (let i = 0; i < pos.count; i++) {
            if (Math.abs(pos.getX(i)) < 1e-5) onPlane++;
        }
        expect(onPlane).toBeGreaterThan(0);
        geo.dispose();
        sliced.dispose();
    });

    test("S3 — flip keep side keeps the opposite half", () => {
        const geo = boxSoup(2, 2, 2, 0, 0, 0);
        const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
        const pos = sliceBufferGeometryByPlane(geo, plane, false);
        for (let i = 0; i < pos.getAttribute("position").count; i++) {
            expect(pos.getAttribute("position").getX(i)).toBeLessThanOrEqual(1e-6);
        }
        geo.dispose();
        pos.dispose();
    });

    test("S4 — view-line cutting plane is parallel to viewDir", () => {
        const p0 = new THREE.Vector3(0, 0, 0);
        const p1 = new THREE.Vector3(10, 0, 0);
        const view = new THREE.Vector3(0, 0, -1);
        const plane = cuttingPlaneFromViewLine(p0, p1, view)!;
        expect(Math.abs(plane.normal.dot(view))).toBeLessThan(1e-9);
        expect(Math.abs(plane.normal.dot(new THREE.Vector3(1, 0, 0)))).toBeLessThan(1e-9);
    });

    test("S5 — world plane converts to local via matrixWorld", () => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        mesh.position.set(10, 0, 0);
        mesh.updateMatrixWorld(true);
        const worldPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -10); // through mesh origin
        const local = planeWorldToLocal(worldPlane, mesh.matrixWorld);
        expect(Math.abs(local.distanceToPoint(new THREE.Vector3(0, 0, 0)))).toBeLessThan(1e-6);
    });

    test("S6 — store apply / undo / restore is non-destructive to raw", () => {
        const raw = boxSoup(2, 2, 2, 0, 0, 0);
        const rawPos = Array.from(raw.getAttribute("position").array as ArrayLike<number>);
        useScanStore.getState().clear();
        useScanStore.getState().addScan({
            id: "s6",
            name: "s6.stl",
            side: "left",
            format: "stl",
            triangleCount: 12,
            geometry: raw.clone(),
            rawGeometry: raw,
            manifold: {
                isWatertight: true,
                openEdges: 0,
                triangleCount: 12,
                vertexCount: 8,
                nonManifoldEdges: 0,
            },
        });

        const plane = scanSliceFromPlane(
            new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
            keepPositiveTowardPoint(
                new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
                new THREE.Vector3(1, 0, 0),
            ),
        );
        const applied = useScanStore.getState().applySlicePlane("s6", plane);
        expect(applied.ok).toBe(true);
        const after = useScanStore.getState().scans[0]!;
        expect(after.slicePlanes.length).toBe(1);
        after.geometry.computeBoundingBox();
        expect(after.geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(-1e-6);

        useScanStore.getState().undoLastSlice("s6");
        expect(useScanStore.getState().scans[0]!.slicePlanes.length).toBe(0);
        useScanStore.getState().scans[0]!.geometry.computeBoundingBox();
        expect(useScanStore.getState().scans[0]!.geometry.boundingBox!.min.x).toBeLessThan(-0.5);

        useScanStore.getState().applySlicePlane("s6", plane);
        useScanStore.getState().restoreAllComponents("s6");
        const restored = useScanStore.getState().scans[0]!;
        expect(restored.slicePlanes.length).toBe(0);
        const arr = restored.rawGeometry.getAttribute("position").array as ArrayLike<number>;
        for (let i = 0; i < rawPos.length; i++) expect(arr[i]).toBe(rawPos[i]);

        useScanStore.getState().clear();
    });

    test("S7 — markers invalidated on slice", () => {
        const raw = boxSoup(2, 2, 2, 0, 0, 0);
        useScanStore.getState().clear();
        useScanStore.getState().addScan({
            id: "s7",
            name: "s7.stl",
            side: "left",
            format: "stl",
            triangleCount: 12,
            geometry: raw.clone(),
            rawGeometry: raw,
            manifold: {
                isWatertight: true,
                openEdges: 0,
                triangleCount: 12,
                vertexCount: 8,
                nonManifoldEdges: 0,
            },
        });
        useScanStore.getState().setMarker("s7", "M1", new THREE.Vector3(0, 0, 0));
        expect(useScanStore.getState().markersByScanId["s7"]!.M1).not.toBeNull();
        useScanStore
            .getState()
            .applySlicePlane("s7", scanSliceFromPlane(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), true));
        expect(useScanStore.getState().markersByScanId["s7"]!.M1).toBeNull();
        expect(useScanStore.getState().scans[0]!.cleanupMessage).toMatch(/plane slice/i);
        useScanStore.getState().clear();
    });

    test("S8 — empty-scan slice blocked", () => {
        const raw = boxSoup(1, 1, 1, 5, 0, 0); // entirely at x>0
        useScanStore.getState().clear();
        useScanStore.getState().addScan({
            id: "s8",
            name: "s8.stl",
            side: "left",
            format: "stl",
            triangleCount: 12,
            geometry: raw.clone(),
            rawGeometry: raw,
            manifold: {
                isWatertight: true,
                openEdges: 0,
                triangleCount: 12,
                vertexCount: 8,
                nonManifoldEdges: 0,
            },
        });
        // Keep x <= 0 → removes everything.
        const result = useScanStore
            .getState()
            .applySlicePlane("s8", scanSliceFromPlane(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), false));
        expect(result.ok).toBe(false);
        expect(useScanStore.getState().scans[0]!.slicePlanes.length).toBe(0);
        useScanStore.getState().clear();
    });

    test("S9 — export byte-identical after slice path (insole untouched)", () => {
        const sourceBase = new THREE.BoxGeometry(260, 90, 8);
        const before = geometryToBinarySTL(sourceBase);
        const raw = boxSoup(2, 2, 2, 0, 0, 0);
        useScanStore.getState().clear();
        useScanStore.getState().addScan({
            id: "s9",
            name: "s9.stl",
            side: "left",
            format: "stl",
            triangleCount: 12,
            geometry: raw.clone(),
            rawGeometry: raw,
            manifold: {
                isWatertight: true,
                openEdges: 0,
                triangleCount: 12,
                vertexCount: 8,
                nonManifoldEdges: 0,
            },
        });
        useScanStore
            .getState()
            .applySlicePlane("s9", scanSliceFromPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), true));
        const after = geometryToBinarySTL(sourceBase);
        expect(after.byteLength).toBe(before.byteLength);
        const a = new Uint8Array(before);
        const b = new Uint8Array(after);
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) throw new Error(`S9 HARD STOP: export byte mismatch at ${i}`);
        }
        useScanStore.getState().clear();
        sourceBase.dispose();
    });

    test("S10 — applyScanSlicePlanes stacks multiple cuts", () => {
        const geo = boxSoup(4, 4, 4, 0, 0, 0);
        const planes = [
            scanSliceFromPlane(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), true),
            scanSliceFromPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), true),
        ];
        const out = applyScanSlicePlanes(geo, planes);
        const pos = out.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
            expect(pos.getX(i)).toBeGreaterThanOrEqual(-1e-6);
            expect(pos.getY(i)).toBeGreaterThanOrEqual(-1e-6);
        }
        geo.dispose();
        out.dispose();
    });
});
