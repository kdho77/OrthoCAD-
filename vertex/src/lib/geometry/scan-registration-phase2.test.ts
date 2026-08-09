// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import * as THREE from "three";
import { kabschRigid } from "@/lib/geometry/kabsch";
import { INSOLE_LENGTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import {
    clearMarkerFrameRegistry,
    getMarkerFrame,
    mirrorBaseLandmarks,
    registerRawBaseGeometry,
} from "@/lib/geometry/marker-frame";
import { computeScanDeviationAgainstRaw, DEVIATION_LEGEND_MM } from "@/lib/geometry/scan-deviation";
import {
    buildScanDisplayInfo,
    inferScanDisplayScale,
    resolveScanMeshMatrix,
    worldHitToScanLocal,
} from "@/lib/geometry/scan-display";
import { deriveScanDorsal, ScanDorsalError } from "@/lib/geometry/scan-dorsal";
import {
    buildDecimatedPickGeometry,
    intersectRayFullMesh,
    PICK_DECIMATE_TRI_THRESHOLD,
    pickViaProxyThenRefine,
    refineHitOnFullMesh,
    scanNeedsPickProxy,
} from "@/lib/geometry/scan-pick-mesh";
import {
    directKabschMatrix,
    ensureRawBaseRegistered,
    registerScanWithDerivedDorsal,
    rotationAligningDorsalToZ,
    runScanRegistration,
    ScanRegistrationWireError,
    seatHeelLongitudinally,
} from "@/lib/geometry/scan-registration-wire";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { cameraForView } from "@/lib/geometry/viewport-side-layout";
import {
    extractMergedGeometry,
    loadGlbFromBuffer,
    mirrorGeometry,
    reorientToFootprintFrame,
} from "@/lib/library/loaders";
import { useScanStore } from "@/stores/scan-store";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");

let rawLeft: BufferGeometry;

beforeAll(async () => {
    const buf = readFileSync(FIXTURE);
    const group = await loadGlbFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const merged = extractMergedGeometry(group);
    if (!merged) throw new Error("Default.glb produced no geometry");
    rawLeft = reorientToFootprintFrame(merged.geometry);
    merged.geometry.dispose();
});

afterEach(() => {
    clearMarkerFrameRegistry();
    useScanStore.getState().clear();
});

/** Tiny planar patch with outward normals along `outward`. */
function makePlantarPatch(center: THREE.Vector3, outward: THREE.Vector3, size = 4): BufferGeometry {
    const n = outward.clone().normalize();
    const tmp = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(tmp, n).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const p0 = center.clone().addScaledVector(u, -size).addScaledVector(v, -size);
    const p1 = center.clone().addScaledVector(u, size).addScaledVector(v, -size);
    const p2 = center.clone().addScaledVector(u, size).addScaledVector(v, size);
    const p3 = center.clone().addScaledVector(u, -size).addScaledVector(v, size);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array([
        p0.x,
        p0.y,
        p0.z,
        p1.x,
        p1.y,
        p1.z,
        p2.x,
        p2.y,
        p2.z,
        p0.x,
        p0.y,
        p0.z,
        p2.x,
        p2.y,
        p2.z,
        p3.x,
        p3.y,
        p3.z,
    ]);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    // Winding so face normal ≈ outward
    geo.computeVertexNormals();
    // Force normals to outward (computeVertexNormals depends on winding)
    const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < nor.count; i++) {
        nor.setXYZ(i, n.x, n.y, n.z);
    }
    nor.needsUpdate = true;
    return geo;
}

function mergeGeos(geos: BufferGeometry[]): BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    for (const g of geos) {
        const p = g.getAttribute("position");
        const n = g.getAttribute("normal");
        for (let i = 0; i < p.count; i++) {
            positions.push(p.getX(i), p.getY(i), p.getZ(i));
            normals.push(n.getX(i), n.getY(i), n.getZ(i));
        }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    out.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
    return out;
}

function syntheticScanAround(
    markers: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
    plantarOutward: THREE.Vector3,
): BufferGeometry {
    return mergeGeos(markers.map((m) => makePlantarPatch(m, plantarOutward)));
}

describe("Phase 2 — scan registration wiring", () => {
    test("T1 — registerRawBaseGeometry once per load; getMarkerFrame returns frame", () => {
        expect(getMarkerFrame("asset-a")).toBeNull();
        ensureRawBaseRegistered({
            assetId: "asset-a",
            geometry: rawLeft,
            mirrored: false,
            primarySide: "left",
        });
        const f1 = getMarkerFrame("asset-a");
        expect(f1).not.toBeNull();
        // Second call is a no-op when already registered
        ensureRawBaseRegistered({
            assetId: "asset-a",
            geometry: rawLeft,
            mirrored: false,
            primarySide: "left",
        });
        expect(getMarkerFrame("asset-a")).toBe(f1);
    });

    test("T7 — right-only mirrored load derives once; landmarks match left mirror", () => {
        const left = registerRawBaseGeometry("src-left", rawLeft, { primarySide: "left" });
        clearMarkerFrameRegistry();

        const mirrored = mirrorGeometry(rawLeft);
        ensureRawBaseRegistered({
            assetId: "src-left",
            geometry: mirrored,
            mirrored: true,
            mirroredFrom: "src-left",
            primarySide: "left",
        });
        const frame = getMarkerFrame("src-left");
        expect(frame).not.toBeNull();
        const expected = mirrorBaseLandmarks(left.landmarks);
        // Frame stores unmirrored source landmarks
        expect(frame!.landmarks.B1.distanceTo(left.landmarks.B1)).toBeLessThan(1e-6);
        expect(frame!.landmarks.B2.distanceTo(left.landmarks.B2)).toBeLessThan(1e-6);
        expect(frame!.landmarks.B3.distanceTo(left.landmarks.B3)).toBeLessThan(1e-6);
        // Right-slot display landmarks are the exact mirror
        const rightDisplay = mirrorBaseLandmarks(frame!.landmarks);
        expect(rightDisplay.B1.distanceTo(expected.B1)).toBeLessThan(1e-6);
        expect(rightDisplay.B2.distanceTo(expected.B2)).toBeLessThan(1e-6);
        expect(rightDisplay.B3.distanceTo(expected.B3)).toBeLessThan(1e-6);
        mirrored.dispose();
    });

    test("T2 — correct left markers register with residual < 0.01mm and identify LEFT", () => {
        const frame = registerRawBaseGeometry("t2", rawLeft, { primarySide: "left" });
        const base: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        // Rigid offset of markers (scan space ≈ base space for this synthetic)
        const t = new THREE.Vector3(2, -1, 0.5);
        const markers = base.map((p) => p.clone().add(t)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
        // Plantar outward = −Z so dorsal = +Z
        const scan = syntheticScanAround(markers, new THREE.Vector3(0, 0, -1));
        const result = runScanRegistration({
            scanGeometry: scan,
            scanMarkersM1M2M3: markers,
            assignedSide: "left",
            sourceAssetId: "t2",
        });
        expect(result.residualRmsMm).toBeLessThan(0.01);
        expect(result.identifiedSide).toBe("left");
        scan.dispose();
    });

    test("T3 — swapped M1/M2 triggers opposite-foot / side mismatch; scan does not move", () => {
        const frame = registerRawBaseGeometry("t3", rawLeft, { primarySide: "left" });
        const markers: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B2.clone(), // swapped
            frame.landmarks.B1.clone(),
            frame.landmarks.B3.clone(),
        ];
        const scan = syntheticScanAround(markers, new THREE.Vector3(0, 0, -1));
        expect(() =>
            runScanRegistration({
                scanGeometry: scan,
                scanMarkersM1M2M3: markers,
                assignedSide: "left",
                sourceAssetId: "t3",
            }),
        ).toThrowError(ScanRegistrationWireError);
        try {
            runScanRegistration({
                scanGeometry: scan,
                scanMarkersM1M2M3: markers,
                assignedSide: "left",
                sourceAssetId: "t3",
            });
        } catch (e) {
            const err = e as ScanRegistrationWireError;
            // Swapped M1/M2 flips chirality → identified opposite of assigned (J5 path).
            expect(["wrong_foot_marker_order", "side_assignment_mismatch"]).toContain(err.code);
            expect(err.message).toMatch(/opposite foot/i);
        }
        scan.dispose();
    });

    test("T4 — dorsal from surface normals ignores inverted file axes", () => {
        const frame = registerRawBaseGeometry("t4", rawLeft, { primarySide: "left" });
        const base: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        // Proper rotation Rx(90°): file +Z ≠ anatomical dorsal, chirality preserved.
        const Rx = new THREE.Matrix4().makeRotationX(Math.PI / 2);
        const markers = base.map((p) => p.clone().applyMatrix4(Rx)) as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
        ];
        // Anatomical plantar outward −Z → file +Y after Rx(90°)
        const plantarOutwardFile = new THREE.Vector3(0, 1, 0);
        const scan = syntheticScanAround(markers, plantarOutwardFile);
        const dorsal = deriveScanDorsal(scan, markers);
        // Must not trust file +Z; dorsal = −plantarOutward = −Y
        expect(Math.abs(dorsal.y + 1)).toBeLessThan(1e-6);
        expect(Math.abs(dorsal.z)).toBeLessThan(1e-6);

        const result = registerScanWithDerivedDorsal(scan, markers, base);
        expect(result.residualRmsMm).toBeLessThan(0.01);
        scan.dispose();
    });

    test("T5 — neighbourhood normals disagree >90° → named typed error", () => {
        const m1 = new THREE.Vector3(0, 0, 0);
        const m2 = new THREE.Vector3(20, 0, 0);
        const m3 = new THREE.Vector3(0, 20, 0);
        // Opposite outward normals at different markers
        const g = mergeGeos([
            makePlantarPatch(m1, new THREE.Vector3(0, 0, -1)),
            makePlantarPatch(m2, new THREE.Vector3(0, 0, 1)),
            makePlantarPatch(m3, new THREE.Vector3(0, 0, -1)),
        ]);
        expect(() => deriveScanDorsal(g, [m1, m2, m3])).toThrowError(ScanDorsalError);
        try {
            deriveScanDorsal(g, [m1, m2, m3]);
        } catch (e) {
            expect((e as ScanDorsalError).code).toBe("plantar_normal_disagreement");
        }
        g.dispose();
    });

    test("T6 — registration is rigid; raw SCAN and raw BASE vertices unmutated", () => {
        const sourceBase = rawLeft.clone();
        const baseBefore = (sourceBase.getAttribute("position") as THREE.BufferAttribute).array.slice(0);
        const frame = registerRawBaseGeometry("t6", sourceBase, { primarySide: "left" });
        const base: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        const markers = base.map((p) => p.clone().add(new THREE.Vector3(1, 2, 3))) as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
        ];
        const scan = syntheticScanAround(markers, new THREE.Vector3(0, 0, -1));
        const scanBefore = (scan.getAttribute("position") as THREE.BufferAttribute).array.slice(0);
        const d01 = markers[0].distanceTo(markers[1]);
        const d02 = markers[0].distanceTo(markers[2]);
        const d12 = markers[1].distanceTo(markers[2]);

        const result = registerScanWithDerivedDorsal(scan, markers, base);
        const mapped = markers.map((m) => m.clone().applyMatrix4(result.matrix));
        expect(mapped[0]!.distanceTo(mapped[1]!)).toBeCloseTo(d01, 6);
        expect(mapped[0]!.distanceTo(mapped[2]!)).toBeCloseTo(d02, 6);
        expect(mapped[1]!.distanceTo(mapped[2]!)).toBeCloseTo(d12, 6);

        const mirrored = mirrorGeometry(sourceBase);
        ensureRawBaseRegistered({
            assetId: "t6-src",
            geometry: mirrored,
            mirrored: true,
            mirroredFrom: "t6-src",
            primarySide: "left",
        });

        const scanAfter = (scan.getAttribute("position") as THREE.BufferAttribute).array;
        const baseAfter = (sourceBase.getAttribute("position") as THREE.BufferAttribute).array;
        for (let i = 0; i < scanBefore.length; i++) expect(scanAfter[i]).toBe(scanBefore[i]);
        for (let i = 0; i < baseBefore.length; i++) expect(baseAfter[i]).toBe(baseBefore[i]);
        scan.dispose();
        mirrored.dispose();
        sourceBase.dispose();
    });

    test("T8 — deviation measured against RAW; legend fixed ±5; unchanged by correction concept", () => {
        const frame = registerRawBaseGeometry("t8", rawLeft, { primarySide: "left" });
        const base: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        const markers = base.map((p) => p.clone()) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
        const scan = syntheticScanAround(markers, new THREE.Vector3(0, 0, -1));
        const reg = registerScanWithDerivedDorsal(scan, markers, base);

        const raw = rawLeft.clone();
        const d1 = computeScanDeviationAgainstRaw(scan, reg.matrix, raw);
        expect(d1.legendMinMm).toBe(-DEVIATION_LEGEND_MM);
        expect(d1.legendMaxMm).toBe(DEVIATION_LEGEND_MM);

        const corrected = raw.clone();
        const pos = corrected.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + 3);
        pos.needsUpdate = true;

        const d2 = computeScanDeviationAgainstRaw(scan, reg.matrix, raw);
        for (let i = 0; i < d1.perVertexMm.length; i++) {
            expect(d2.perVertexMm[i]).toBeCloseTo(d1.perVertexMm[i]!, 6);
        }
        const dWrong = computeScanDeviationAgainstRaw(scan, reg.matrix, corrected);
        let changed = false;
        for (let i = 0; i < d1.perVertexMm.length; i++) {
            if (Math.abs(dWrong.perVertexMm[i]! - d1.perVertexMm[i]!) > 0.1) changed = true;
        }
        expect(changed).toBe(true);
        scan.dispose();
        raw.dispose();
        corrected.dispose();
    });

    test("T9 — export buffer byte-identical with vs without registered scan", () => {
        const sourceBase = rawLeft.clone();
        const exportBuffer = () => geometryToBinarySTL(sourceBase);
        const bufBefore = exportBuffer();

        const frame = registerRawBaseGeometry("t9", sourceBase, { primarySide: "left" });
        const basePts: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        const markers = basePts.map((p) => p.clone().add(new THREE.Vector3(0.4, -0.2, 0.1))) as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
        ];
        const scan = syntheticScanAround(markers, new THREE.Vector3(0, 0, -1));

        useScanStore.getState().setLandmarkSourceAssetId("t9");
        useScanStore.getState().setRawBaseGeometry("t9", sourceBase);
        useScanStore.getState().addScan({
            id: "t9-scan",
            name: "foot.stl",
            side: "left",
            format: "stl",
            triangleCount: 2,
            geometry: scan,
            manifold: {
                isWatertight: false,
                openEdges: 1,
                triangleCount: 2,
                vertexCount: scan.getAttribute("position")!.count,
                nonManifoldEdges: 0,
            },
        });
        useScanStore.getState().setMarker("t9-scan", "M1", markers[0]);
        useScanStore.getState().setMarker("t9-scan", "M2", markers[1]);
        useScanStore.getState().setMarker("t9-scan", "M3", markers[2]);
        // Registration is gated on ARCH as well as M1–M3.
        useScanStore.getState().setMarker(
            "t9-scan",
            "ARCH",
            markers[0]!
                .clone()
                .lerp(markers[2]!, 0.4)
                .add(new THREE.Vector3(0, 5, 0)),
        );
        useScanStore.getState().setDeviationOverlay(true);
        const reg = useScanStore.getState().registrationByScanId["t9-scan"];
        expect(reg?.error).toBeNull();
        expect(reg?.matrixElements).not.toBeNull();
        // Successful seating requests automatic size/arch/heel match.
        expect(useScanStore.getState().pendingClinicalMatchScanId).toBe("t9-scan");

        const matrix = new THREE.Matrix4().fromArray(reg!.matrixElements!);
        computeScanDeviationAgainstRaw(scan, matrix, sourceBase);

        const mirrored = mirrorGeometry(sourceBase);
        ensureRawBaseRegistered({
            assetId: "t9",
            geometry: mirrored,
            mirrored: true,
            mirroredFrom: "t9",
            primarySide: "left",
        });

        const bufAfter = exportBuffer();
        expect(bufAfter.byteLength).toBe(bufBefore.byteLength);
        const a = new Uint8Array(bufBefore);
        const b = new Uint8Array(bufAfter);
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                throw new Error(`T9 HARD STOP: export byte mismatch at offset ${i}`);
            }
        }
        mirrored.dispose();
        sourceBase.dispose();
    });

    test("T9b — export modules have zero scan-store references (tripwire)", () => {
        const exportService = readFileSync(
            resolve(process.cwd(), "vertex/src/features/exports/export-service.ts"),
            "utf8",
        );
        const exportGeometry = readFileSync(
            resolve(process.cwd(), "vertex/src/lib/geometry/export-geometry.ts"),
            "utf8",
        );
        expect(exportService).not.toMatch(/useScanStore|scan-store/);
        expect(exportGeometry).not.toMatch(/useScanStore|scan-store/);
    });

    test("T10 — re-importing a scan clears previous markers", () => {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        useScanStore.getState().addScan({
            id: "s1",
            name: "a.stl",
            side: "left",
            format: "stl",
            triangleCount: 12,
            geometry: geo,
            manifold: {
                isWatertight: true,
                openEdges: 0,
                triangleCount: 12,
                vertexCount: 8,
                nonManifoldEdges: 0,
            },
        });
        useScanStore.getState().setMarker("s1", "M1", new THREE.Vector3(1, 2, 3));
        expect(useScanStore.getState().markersByScanId.s1?.M1).not.toBeNull();
        useScanStore.getState().removeScan("s1");
        const geo2 = new THREE.BoxGeometry(1, 1, 1);
        useScanStore.getState().addScan({
            id: "s2",
            name: "a.stl",
            side: "left",
            format: "stl",
            triangleCount: 12,
            geometry: geo2,
            manifold: {
                isWatertight: true,
                openEdges: 0,
                triangleCount: 12,
                vertexCount: 8,
                nonManifoldEdges: 0,
            },
        });
        expect(useScanStore.getState().markersByScanId.s1).toBeUndefined();
        expect(useScanStore.getState().markersByScanId.s2?.M1).toBeNull();
    });

    test("registration waits for ARCH after M1–M3", () => {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        useScanStore.getState().addScan({
            id: "arch-prompt",
            name: "foot.stl",
            side: "left",
            format: "stl",
            triangleCount: 12,
            geometry: geo,
            manifold: {
                isWatertight: true,
                openEdges: 0,
                triangleCount: 12,
                vertexCount: 8,
                nonManifoldEdges: 0,
            },
        });
        useScanStore.getState().enterPlacement("arch-prompt");
        expect(useScanStore.getState().placementMode).toEqual({ scanId: "arch-prompt", next: "M1" });

        useScanStore.getState().setMarker("arch-prompt", "M1", new THREE.Vector3(1, 0, 0));
        expect(useScanStore.getState().placementMode?.next).toBe("M2");
        useScanStore.getState().setMarker("arch-prompt", "M2", new THREE.Vector3(0, 1, 0));
        expect(useScanStore.getState().placementMode?.next).toBe("M3");
        useScanStore.getState().setMarker("arch-prompt", "M3", new THREE.Vector3(0, 0, 1));
        // Still placing ARCH — scan must not seat on the insole yet.
        expect(useScanStore.getState().placementMode).toEqual({ scanId: "arch-prompt", next: "ARCH" });
        expect(useScanStore.getState().registrationByScanId["arch-prompt"]?.incomplete).toBe(true);
        expect(useScanStore.getState().registrationByScanId["arch-prompt"]?.matrixElements).toBeNull();
        expect(useScanStore.getState().pendingClinicalMatchScanId).toBeNull();

        // Esc/cancel must not clear the ARCH requirement — re-open prompts ARCH.
        useScanStore.getState().exitPlacement();
        expect(useScanStore.getState().placementMode).toBeNull();
        useScanStore.getState().setMarker("arch-prompt", "M3", new THREE.Vector3(0, 0, 1.1));
        expect(useScanStore.getState().placementMode).toEqual({ scanId: "arch-prompt", next: "ARCH" });

        useScanStore.getState().setMarker("arch-prompt", "ARCH", new THREE.Vector3(-1, 0.5, 0));
        expect(useScanStore.getState().placementMode).toBeNull();
        expect(useScanStore.getState().markersByScanId["arch-prompt"]?.ARCH).not.toBeNull();
        // Without a loaded base, registration is attempted but errors — not incomplete-for-markers.
        const reg = useScanStore.getState().registrationByScanId["arch-prompt"];
        expect(reg?.incomplete).toBe(false);
        expect(reg?.error?.code).toBe("no_base_landmarks");
        expect(useScanStore.getState().pendingClinicalMatchScanId).toBeNull();
    });

    test("T13 — R_dorsalToZ is geometrically inert (twist freedom must not leak)", () => {
        const frame = registerRawBaseGeometry("t13", rawLeft, { primarySide: "left" });
        const base: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        const markers = base.map((p) => p.clone().add(new THREE.Vector3(0.5, -0.3, 0.2))) as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
        ];
        const scan = syntheticScanAround(markers, new THREE.Vector3(0, 0, -1));
        const direct = directKabschMatrix(markers, base);
        const composed0 = registerScanWithDerivedDorsal(scan, markers, base, { dorsalTwistRad: 0 });
        const composedTwist = registerScanWithDerivedDorsal(scan, markers, base, {
            dorsalTwistRad: 1.234,
        });
        for (let i = 0; i < 16; i++) {
            expect(Math.abs(composed0.matrix.elements[i]! - direct.elements[i]!)).toBeLessThan(1e-9);
            expect(Math.abs(composedTwist.matrix.elements[i]! - direct.elements[i]!)).toBeLessThan(1e-9);
        }
        const R0 = rotationAligningDorsalToZ(new THREE.Vector3(0, 0, 1), 0);
        const R1 = rotationAligningDorsalToZ(new THREE.Vector3(0, 0, 1), 1.234);
        expect(Math.abs(R0.elements[0]! - R1.elements[0]!)).toBeGreaterThan(1e-6);
        scan.dispose();
    });

    test("heel seat — shorter foot lands M3.x on B3.x; ML (Y) unchanged vs Kabsch", () => {
        const frame = registerRawBaseGeometry("heel-seat", rawLeft, { primarySide: "left" });
        const base: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        // Compress length about the marker centroid so Kabsch alone leaves the heel forward.
        const c = new THREE.Vector3()
            .add(base[0]!)
            .add(base[1]!)
            .add(base[2]!)
            .multiplyScalar(1 / 3);
        const short = base.map((p) => {
            const q = p.clone().sub(c);
            q.x *= 0.8;
            return q.add(c);
        }) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];

        const kabschOnly = kabschRigid(short, base);
        const m3Kabsch = short[2]!.clone().applyMatrix3(kabschOnly.rotation).add(kabschOnly.translation);
        expect(Math.abs(m3Kabsch.x - base[2]!.x)).toBeGreaterThan(1);

        const seated = seatHeelLongitudinally(kabschOnly, short, base);
        const m3Seated = short[2]!.clone().applyMatrix3(seated.rotation).add(seated.translation);
        expect(Math.abs(m3Seated.x - base[2]!.x)).toBeLessThan(1e-9);
        // ML centering from Kabsch preserved.
        expect(Math.abs(seated.translation.y - kabschOnly.translation.y)).toBeLessThan(1e-12);
        expect(Math.abs(seated.translation.z - kabschOnly.translation.z)).toBeLessThan(1e-12);

        const scan = syntheticScanAround(short, new THREE.Vector3(0, 0, -1));
        const wired = registerScanWithDerivedDorsal(scan, short, base);
        const m3Wired = short[2]!.clone().applyMatrix4(wired.matrix);
        expect(Math.abs(m3Wired.x - base[2]!.x)).toBeLessThan(1e-6);
        scan.dispose();
    });

    test("J5 — identified side ≠ assigned side surfaces mismatch; no matrix", () => {
        const frame = registerRawBaseGeometry("j5", rawLeft, { primarySide: "left" });
        const markers: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        const scan = syntheticScanAround(markers, new THREE.Vector3(0, 0, -1));
        expect(() =>
            runScanRegistration({
                scanGeometry: scan,
                scanMarkersM1M2M3: markers,
                assignedSide: "right",
                sourceAssetId: "j5",
            }),
        ).toThrowError(ScanRegistrationWireError);
        try {
            runScanRegistration({
                scanGeometry: scan,
                scanMarkersM1M2M3: markers,
                assignedSide: "right",
                sourceAssetId: "j5",
            });
        } catch (e) {
            expect((e as ScanRegistrationWireError).code).toBe("side_assignment_mismatch");
            expect((e as ScanRegistrationWireError).message).toMatch(/opposite foot/i);
            expect((e as ScanRegistrationWireError).message).toMatch(/right/);
            expect((e as ScanRegistrationWireError).message).toMatch(/left/);
        }
        scan.dispose();
    });

    test("J6 — scan store is not wired into vertex-design-session persist", () => {
        const designStoreSrc = readFileSync(
            resolve(process.cwd(), "vertex/src/stores/design-store.ts"),
            "utf8",
        );
        const scanStoreSrc = readFileSync(resolve(process.cwd(), "vertex/src/stores/scan-store.ts"), "utf8");
        expect(designStoreSrc).toMatch(/vertex-design-session/);
        expect(designStoreSrc).not.toMatch(/useScanStore|scan-store|markersByScanId/);
        expect(scanStoreSrc).not.toMatch(/persist\(|partialize|localStorage|vertex-design-session/);
    });
});

/** Build a dense triangular terrain with ≥ minVerts vertices over the base footprint. */
function buildLargeScanOverBase(minVerts: number, base: BufferGeometry): THREE.BufferGeometry {
    const pos = base.getAttribute("position")!;
    const topN = (base.userData as { topVertexCount?: number }).topVertexCount ?? pos.count;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < topN; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const cols = Math.ceil(Math.sqrt(minVerts / 6)) + 1;
    const rows = cols;
    const patches: THREE.BufferGeometry[] = [];
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            const u = i / (rows - 1);
            const v = j / (cols - 1);
            const cx = minX + u * (maxX - minX);
            const cy = minY + v * (maxY - minY);
            const cz = 4 + Math.sin(u * 8) * Math.cos(v * 6);
            patches.push(makePlantarPatch(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(0, 0, -1), 1.2));
        }
    }
    return mergeGeos(patches);
}

describe("Amendment K — realistic scale", () => {
    test("K3 — deviation + raycast at ≥150k vertices; pick proxy if needed", () => {
        const frame = registerRawBaseGeometry("k3", rawLeft, { primarySide: "left" });
        const base: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        const markers = base.map((p) => p.clone()) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
        const large = buildLargeScanOverBase(150_000, rawLeft);
        const scanVerts = large.getAttribute("position")!.count;
        expect(scanVerts).toBeGreaterThanOrEqual(150_000);

        const tiny = syntheticScanAround(markers, new THREE.Vector3(0, 0, -1));
        const reg = registerScanWithDerivedDorsal(tiny, markers, base);
        const d = computeScanDeviationAgainstRaw(large, reg.matrix, rawLeft);

        const mesh = new THREE.Mesh(large);
        mesh.updateMatrixWorld(true);
        const raycaster = new THREE.Raycaster();
        const origin = new THREE.Vector3(80, 0, 200);
        const times: number[] = [];
        for (let i = 0; i < 30; i++) {
            const dir = new THREE.Vector3(60 + i * 2, -10 + i, 0).sub(origin).normalize();
            raycaster.set(origin, dir);
            const t0 = performance.now();
            raycaster.intersectObject(mesh, false);
            times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        const medianFull = times[Math.floor(times.length / 2)]!;

        let medianPick = medianFull;
        let usedProxy = false;
        // Pre-authorised: ship pick proxy when full-mesh drag is not comfortable (>16ms).
        if (medianFull > 16 || scanNeedsPickProxy(large)) {
            usedProxy = true;
            const pickGeo = buildDecimatedPickGeometry(large);
            const pickMesh = new THREE.Mesh(pickGeo);
            pickMesh.updateMatrixWorld(true);
            const pickTimes: number[] = [];
            for (let i = 0; i < 30; i++) {
                const dir = new THREE.Vector3(60 + i * 2, -10 + i, 0).sub(origin).normalize();
                raycaster.set(origin, dir);
                const t0 = performance.now();
                const hits = raycaster.intersectObject(pickMesh, false);
                if (hits[0]) {
                    refineHitOnFullMesh(raycaster.ray.clone(), large, hits[0].point);
                }
                pickTimes.push(performance.now() - t0);
            }
            pickTimes.sort((a, b) => a - b);
            medianPick = pickTimes[Math.floor(pickTimes.length / 2)]!;
            pickGeo.dispose();
        }

        const report = {
            scanVerts,
            baseTopN: (rawLeft.userData as { topVertexCount: number }).topVertexCount,
            deviationMs: d.elapsedMs,
            raycastFullMedianMs: medianFull,
            raycastPickMedianMs: medianPick,
            usedProxy,
            threshold: PICK_DECIMATE_TRI_THRESHOLD,
        };
        writeFileSync("/tmp/phase2-k3-perf.json", JSON.stringify(report, null, 2));
        expect(d.elapsedMs).toBeLessThan(2000);
        expect(medianPick).toBeLessThan(50);
        large.dispose();
        tiny.dispose();
    });
});

/**
 * Amendment L1 — clinical-scale STL-soup fixture.
 * Non-indexed triangle soup: bufferVertexCount === 3 × triangleCount.
 * Heel-cup shape: posterior wall rises into a cup; anterior stays plantar.
 */
function buildClinicalScaleHeelCupFixture(minTriangles: number): {
    geometry: THREE.BufferGeometry;
    triangleCount: number;
    bufferVertexCount: number;
} {
    const nx = Math.ceil(Math.sqrt(minTriangles / 2));
    const ny = nx;
    const triangleCount = nx * ny * 2;
    const bufferVertexCount = triangleCount * 3;
    const positions = new Float32Array(bufferVertexCount * 3);
    const normals = new Float32Array(bufferVertexCount * 3);

    const minX = 0;
    const maxX = 250;
    const minY = -42;
    const maxY = 42;

    const heightAt = (u: number, v: number): number => {
        // u: 0 = heel, 1 = toe; v: 0..1 across width.
        const plantar = 2 + 0.4 * Math.sin(u * Math.PI) * Math.cos(v * Math.PI * 2);
        const wallMask = Math.max(0, 1 - u * 2.8); // strong at heel
        const edge = Math.abs(v - 0.5) * 2; // 0 centre → 1 medial/lateral
        const wall = wallMask * edge * edge * 28; // heel-cup wall up to ~28 mm
        return plantar + wall;
    };

    const writeVert = (
        slot: number,
        x: number,
        y: number,
        z: number,
        nxv: number,
        nyv: number,
        nzv: number,
    ) => {
        const o = slot * 3;
        positions[o] = x;
        positions[o + 1] = y;
        positions[o + 2] = z;
        normals[o] = nxv;
        normals[o + 1] = nyv;
        normals[o + 2] = nzv;
    };

    let slot = 0;
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const u0 = i / nx;
            const u1 = (i + 1) / nx;
            const v0 = j / ny;
            const v1 = (j + 1) / ny;
            const x00 = minX + u0 * (maxX - minX);
            const x10 = minX + u1 * (maxX - minX);
            const x01 = x00;
            const x11 = x10;
            const y00 = minY + v0 * (maxY - minY);
            const y10 = y00;
            const y01 = minY + v1 * (maxY - minY);
            const y11 = y01;
            const z00 = heightAt(u0, v0);
            const z10 = heightAt(u1, v0);
            const z01 = heightAt(u0, v1);
            const z11 = heightAt(u1, v1);

            // Two triangles (non-indexed soup). Normals ≈ +Z for plantar pick from above.
            const e1x = x10 - x00;
            const e1y = y10 - y00;
            const e1z = z10 - z00;
            const e2x = x01 - x00;
            const e2y = y01 - y00;
            const e2z = z01 - z00;
            let nxv = e1y * e2z - e1z * e2y;
            let nyv = e1z * e2x - e1x * e2z;
            let nzv = e1x * e2y - e1y * e2x;
            const len = Math.hypot(nxv, nyv, nzv) || 1;
            nxv /= len;
            nyv /= len;
            nzv /= len;
            if (nzv < 0) {
                nxv = -nxv;
                nyv = -nyv;
                nzv = -nzv;
            }

            writeVert(slot++, x00, y00, z00, nxv, nyv, nzv);
            writeVert(slot++, x10, y10, z10, nxv, nyv, nzv);
            writeVert(slot++, x11, y11, z11, nxv, nyv, nzv);

            writeVert(slot++, x00, y00, z00, nxv, nyv, nzv);
            writeVert(slot++, x11, y11, z11, nxv, nyv, nzv);
            writeVert(slot++, x01, y01, z01, nxv, nyv, nzv);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();
    return { geometry, triangleCount, bufferVertexCount };
}

/** Clinical tol: refined pick vs direct full-mesh hit (Amendment L2). */
const L2_CLINICAL_TOL_MM = 0.2;

describe("Amendment L — clinical scale + pick proxy active", () => {
    let clinicalFixture: {
        geometry: THREE.BufferGeometry;
        triangleCount: number;
        bufferVertexCount: number;
    };
    let clinicalDeviationMs = 0;

    beforeAll(() => {
        clinicalFixture = buildClinicalScaleHeelCupFixture(300_000);
        const frame = registerRawBaseGeometry("l-shared", rawLeft, { primarySide: "left" });
        const base: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        const markers = base.map((p) => p.clone()) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
        const tiny = syntheticScanAround(markers, new THREE.Vector3(0, 0, -1));
        const reg = registerScanWithDerivedDorsal(tiny, markers, base);
        clinicalDeviationMs = computeScanDeviationAgainstRaw(
            clinicalFixture.geometry,
            reg.matrix,
            rawLeft,
        ).elapsedMs;
        tiny.dispose();
        clearMarkerFrameRegistry();
    });

    afterAll(() => {
        clinicalFixture?.geometry.dispose();
    });

    test("L1 — ≥300k-triangle soup: deviation, raycast p50/p95, proxy active", () => {
        const { geometry: large, triangleCount, bufferVertexCount } = clinicalFixture;
        expect(triangleCount).toBeGreaterThanOrEqual(300_000);
        expect(bufferVertexCount).toBe(triangleCount * 3);
        expect(scanNeedsPickProxy(large)).toBe(true);
        expect(clinicalDeviationMs).toBeGreaterThan(250);

        const pickGeo = buildDecimatedPickGeometry(large);
        const pickMesh = new THREE.Mesh(pickGeo);
        pickMesh.updateMatrixWorld(true);
        const raycaster = new THREE.Raycaster();
        const origin = new THREE.Vector3(125, 0, 200);
        const times: number[] = [];
        for (let i = 0; i < 40; i++) {
            const target = new THREE.Vector3(40 + i * 4, -20 + (i % 10) * 4, 5);
            raycaster.set(origin, target.clone().sub(origin).normalize());
            const t0 = performance.now();
            const hits = raycaster.intersectObject(pickMesh, false);
            if (hits[0]) {
                refineHitOnFullMesh(raycaster.ray.clone(), large, hits[0].point);
            }
            times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        const median = times[Math.floor(times.length / 2)]!;
        const p95 = times[Math.floor(times.length * 0.95)]!;

        const report = {
            triangleCount,
            bufferVertexCount,
            deviationMs: clinicalDeviationMs,
            raycastProxyMedianMs: median,
            raycastProxyP95Ms: p95,
            usedProxy: true,
            threshold: PICK_DECIMATE_TRI_THRESHOLD,
            busyThresholdMs: 250,
            busyEngaged: clinicalDeviationMs > 250,
        };
        writeFileSync("/tmp/phase2-l1-perf.json", JSON.stringify(report, null, 2));

        expect(median).toBeLessThan(50);
        expect(p95).toBeLessThan(80);
        pickGeo.dispose();
    });

    test("L2 — pick proxy forced active: hit/miss/refine ≤0.20mm + curvature drag", () => {
        const { geometry: full, triangleCount } = clinicalFixture;
        expect(triangleCount).toBeGreaterThanOrEqual(PICK_DECIMATE_TRI_THRESHOLD);
        expect(scanNeedsPickProxy(full)).toBe(true);

        const proxy = buildDecimatedPickGeometry(full);
        const origin = new THREE.Vector3(125, 0, 120);

        const hitTargets = [
            new THREE.Vector3(180, 0, 3),
            new THREE.Vector3(120, 10, 4),
            new THREE.Vector3(30, 0, 8),
            new THREE.Vector3(20, 30, 20),
            new THREE.Vector3(25, -28, 18),
        ];
        let maxRefineErr = 0;
        let compared = 0;
        let casesWhereProxyDiffered = 0;
        for (const target of hitTargets) {
            const dir = target.clone().sub(origin).normalize();
            const ray = new THREE.Ray(origin.clone(), dir);
            const direct = intersectRayFullMesh(ray, full);
            expect(direct).not.toBeNull();
            const { refined, coarse } = pickViaProxyThenRefine(ray, full, proxy);
            expect(refined).not.toBeNull();
            expect(coarse).not.toBeNull();
            const err = refined!.distanceTo(direct!);
            maxRefineErr = Math.max(maxRefineErr, err);
            if (coarse!.distanceTo(direct!) > L2_CLINICAL_TOL_MM) {
                casesWhereProxyDiffered++;
                expect(refined!.distanceTo(coarse!)).toBeGreaterThan(1e-6);
            }
            compared++;
        }
        writeFileSync(
            "/tmp/phase2-l2-pick-accuracy.json",
            JSON.stringify(
                {
                    compared,
                    maxRefineErrMm: maxRefineErr,
                    casesWhereProxyDiffered,
                    clinicalTolMm: L2_CLINICAL_TOL_MM,
                    triangleCount,
                    proxyActivated: true,
                },
                null,
                2,
            ),
        );
        expect(maxRefineErr).toBeLessThanOrEqual(L2_CLINICAL_TOL_MM);

        const missRay = new THREE.Ray(
            new THREE.Vector3(125, 0, 120),
            new THREE.Vector3(0, 1, 0.05).normalize(),
        );
        expect(intersectRayFullMesh(missRay, full)).toBeNull();
        const missPick = pickViaProxyThenRefine(missRay, full, proxy);
        expect(missPick.coarse).toBeNull();
        expect(missPick.refined).toBeNull();

        const dragHits: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
            const t = i / 24;
            const target = new THREE.Vector3(22 + t * 40, 32 - t * 32, 22 - t * 18);
            const ray = new THREE.Ray(origin.clone(), target.clone().sub(origin).normalize());
            const { refined } = pickViaProxyThenRefine(ray, full, proxy);
            if (refined) dragHits.push(refined);
        }
        expect(dragHits.length).toBeGreaterThan(16);
        let maxStep = 0;
        for (let i = 1; i < dragHits.length; i++) {
            maxStep = Math.max(maxStep, dragHits[i]!.distanceTo(dragHits[i - 1]!));
        }
        expect(maxStep).toBeLessThan(12);

        proxy.dispose();
    });

    test("L3 — deviation busy engages at true scale; toggle cannot double-fire", () => {
        expect(clinicalDeviationMs).toBeGreaterThan(250);

        useScanStore.getState().clear();
        useScanStore.getState().setDeviationOverlay(true);
        expect(useScanStore.getState().deviationOverlay).toBe(true);
        expect(useScanStore.getState().deviationBusy).toBe(true);
        useScanStore.getState().setDeviationBusy(true);
        useScanStore.getState().setDeviationOverlay(true);
        expect(useScanStore.getState().deviationOverlay).toBe(true);
        expect(useScanStore.getState().deviationBusy).toBe(true);
        useScanStore.getState().setDeviationOverlay(false);
        expect(useScanStore.getState().deviationOverlay).toBe(false);
        expect(useScanStore.getState().deviationBusy).toBe(false);

        const importSrc = readFileSync(
            resolve(process.cwd(), "vertex/src/features/scans/ScanImport.tsx"),
            "utf8",
        );
        expect(importSrc).toMatch(/disabled=\{deviationBusy\}/);
        const meshesSrc = readFileSync(
            resolve(process.cwd(), "vertex/src/components/viewer/ScanMeshes.tsx"),
            "utf8",
        );
        expect(meshesSrc).toMatch(/deviationGenRef/);
        expect(meshesSrc).toMatch(/setTimeout/);

        writeFileSync(
            "/tmp/phase2-l3-busy.json",
            JSON.stringify(
                {
                    deviationMs: clinicalDeviationMs,
                    busyThresholdMs: 250,
                    busyEngaged: clinicalDeviationMs > 250,
                    triangleCount: clinicalFixture.triangleCount,
                    bufferVertexCount: clinicalFixture.bufferVertexCount,
                },
                null,
                2,
            ),
        );
    });
});

/** Meter-scale foot with a large raw origin offset — the clinical invisible-scan case. */
function buildMeterScaleFootScan(): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(0.27, 0.04, 0.1);
    g.translate(2.4, -1.1, 0.85);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
}

/** Scene graph matching ScanMeshes placement for an unregistered scan. */
function buildUnregisteredScanScene(
    geometry: THREE.BufferGeometry,
    side: "left" | "right",
    display: ReturnType<typeof buildScanDisplayInfo>,
): { root: THREE.Group; mesh: THREE.Mesh; matrixWorld: THREE.Matrix4 } {
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    const slot = new THREE.Group();
    slot.position.set(-INSOLE_LENGTH_MM / 2, sideOffsetX(side), 0);
    root.add(slot);
    const mesh = new THREE.Mesh(geometry);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(resolveScanMeshMatrix(display, null));
    mesh.matrixWorldNeedsUpdate = true;
    mesh.userData = { isScanMesh: true, isProvisionalDisplay: true };
    slot.add(mesh);
    root.updateMatrixWorld(true);
    return { root, mesh, matrixWorld: mesh.matrixWorld.clone() };
}

describe("Amendment M — provisional display + deadlock guard", () => {
    test("M1/M3 — meter-scale raw bbox infers m and display ×1000", () => {
        const geo = buildMeterScaleFootScan();
        const info = buildScanDisplayInfo(geo);
        expect(info.rawLongest).toBeGreaterThan(0.2);
        expect(info.rawLongest).toBeLessThan(1);
        expect(inferScanDisplayScale(info.rawLongest).inferredUnit).toBe("m");
        expect(info.inferredUnit).toBe("m");
        expect(info.displayScale).toBe(1000);
        // Display longest ≈ clinical foot length band.
        expect(info.rawLongest * info.displayScale).toBeGreaterThan(120);
        expect(info.rawLongest * info.displayScale).toBeLessThan(400);
        geo.dispose();
    });

    test("M2 — provisional is display-only; world hit → scan-local before Kabsch", () => {
        const geo = buildMeterScaleFootScan();
        const display = buildScanDisplayInfo(geo);
        const { matrixWorld } = buildUnregisteredScanScene(geo, "left", display);

        // A known geometry-local point (near box centre before translate: translate baked in).
        const localKnown = new THREE.Vector3(2.4, -1.1, 0.85); // box centre in raw coords
        const world = localKnown.clone().applyMatrix4(matrixWorld);
        const recovered = worldHitToScanLocal(world, matrixWorld);
        expect(recovered.distanceTo(localKnown)).toBeLessThan(1e-6);

        // Provisional matrix must NOT equal a registration and must not be identity.
        const P = resolveScanMeshMatrix(display, null);
        expect(P.equals(new THREE.Matrix4().identity())).toBe(false);

        // Kabsch consumes scan-local markers only — feeding display-space would blow residual.
        const frame = registerRawBaseGeometry("m2", rawLeft, { primarySide: "left" });
        const base: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        // Synthesize a small plantar patch scan in mm around base landmarks (already local).
        const markers = base.map((p) => p.clone()) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
        const mmScan = syntheticScanAround(markers, new THREE.Vector3(0, 0, -1));
        const ok = registerScanWithDerivedDorsal(mmScan, markers, base);
        expect(ok.residualRmsMm).toBeLessThan(0.01);

        // Assert helper is what ScanMarkerPlacement uses (tripwire).
        const placementSrc = readFileSync(
            resolve(process.cwd(), "vertex/src/components/viewer/ScanMarkerPlacement.tsx"),
            "utf8",
        );
        expect(placementSrc).toMatch(/worldHitToScanLocal/);
        expect(placementSrc).not.toMatch(/reg\.clone\(\)\.invert\(\)/);

        mmScan.dispose();
        geo.dispose();
    });

    test("M2b — discrete unitScale maps meter-local markers onto mm base landmarks", () => {
        const frame = registerRawBaseGeometry("m2b", rawLeft, { primarySide: "left" });
        const base: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
            frame.landmarks.B1.clone(),
            frame.landmarks.B2.clone(),
            frame.landmarks.B3.clone(),
        ];
        // Meter-space markers that correspond 1:1 to base landmarks after ×1000.
        const meterMarkers = base.map((p) => p.clone().multiplyScalar(0.001)) as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
        ];
        const meterScan = syntheticScanAround(meterMarkers, new THREE.Vector3(0, 0, -1));
        const withoutScale = registerScanWithDerivedDorsal(meterScan, meterMarkers, base);
        expect(withoutScale.residualRmsMm).toBeGreaterThan(10);

        const withScale = registerScanWithDerivedDorsal(meterScan, meterMarkers, base, {
            unitScale: 1000,
        });
        expect(withScale.residualRmsMm).toBeLessThan(0.05);
        // Composed matrix must carry the discrete scale (not identity scale).
        const sx = new THREE.Vector3();
        const sy = new THREE.Vector3();
        const sz = new THREE.Vector3();
        withScale.matrix.extractBasis(sx, sy, sz);
        expect(sx.length()).toBeGreaterThan(500);

        meterScan.dispose();
    });

    test("M4 — freshly imported scan is visible, in frustum, raycast-hittable with null registration", () => {
        const geo = buildMeterScaleFootScan();
        useScanStore.getState().addScan({
            id: "m4-scan",
            name: "patient-L.obj",
            side: "left",
            format: "obj",
            triangleCount: 12,
            geometry: geo,
            manifold: {
                isWatertight: false,
                openEdges: 802,
                triangleCount: 12,
                vertexCount: geo.getAttribute("position")!.count,
                nonManifoldEdges: 0,
            },
        });
        const stored = useScanStore.getState().scans.find((s) => s.id === "m4-scan");
        expect(stored).toBeTruthy();
        expect(stored!.visible).toBe(true);
        const reg = useScanStore.getState().registrationByScanId["m4-scan"];
        expect(reg?.matrixElements).toBeNull();
        expect(reg?.incomplete).toBe(true);
        expect(stored!.display.displayScale).toBe(1000);

        const { mesh, matrixWorld } = buildUnregisteredScanScene(geo, "left", stored!.display);
        expect(mesh.userData.isProvisionalDisplay).toBe(true);

        // World AABB after provisional framing.
        geo.computeBoundingBox();
        const localBox = geo.boundingBox!.clone();
        const worldBox = localBox.clone().applyMatrix4(matrixWorld);
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        worldBox.getCenter(center);
        worldBox.getSize(size);
        expect(size.length()).toBeGreaterThan(50); // mm-scale presence, not sub-pixel

        const cam = cameraForView("iso");
        cam.aspect = 1.5;
        cam.updateProjectionMatrix();
        const frustum = new THREE.Frustum();
        frustum.setFromProjectionMatrix(
            new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
        );
        const sphere = new THREE.Sphere(center, size.length() * 0.5);
        expect(frustum.intersectsSphere(sphere)).toBe(true);

        // Projected size: NDC extent of bbox corners must be clinically clickable.
        const corners = [
            new THREE.Vector3(worldBox.min.x, worldBox.min.y, worldBox.min.z),
            new THREE.Vector3(worldBox.max.x, worldBox.max.y, worldBox.max.z),
        ].map((p) => p.project(cam));
        const ndcSpan = Math.hypot(corners[0]!.x - corners[1]!.x, corners[0]!.y - corners[1]!.y);
        expect(ndcSpan).toBeGreaterThan(0.05);

        // Ray from camera through bbox centre must hit the mesh.
        const dir = center.clone().sub(cam.position).normalize();
        const raycaster = new THREE.Raycaster(cam.position.clone(), dir);
        const hits = raycaster.intersectObject(mesh, false);
        expect(hits.length).toBeGreaterThan(0);

        // Hit converts to scan-local (geometry space), not display space.
        const local = worldHitToScanLocal(hits[0]!.point, matrixWorld);
        const directLocal = intersectRayFullMesh(
            new THREE.Ray(cam.position.clone(), dir).applyMatrix4(matrixWorld.clone().invert()),
            geo,
        );
        // Local pick lies on the raw surface.
        expect(local.length()).toBeGreaterThan(0);
        if (directLocal) {
            expect(local.distanceTo(directLocal)).toBeLessThan(1);
        }

        writeFileSync(
            "/tmp/phase2-m4-deadlock.json",
            JSON.stringify(
                {
                    rawLongest: stored!.display.rawLongest,
                    inferredUnit: stored!.display.inferredUnit,
                    displayScale: stored!.display.displayScale,
                    worldSize: size.toArray(),
                    ndcSpan,
                    inFrustum: true,
                    rayHits: hits.length,
                    registrationNull: true,
                },
                null,
                2,
            ),
        );
    });

    test("M5 — provisional matrix does not bake into geometry (T6 companion)", () => {
        const geo = buildMeterScaleFootScan();
        const before = (geo.getAttribute("position") as THREE.BufferAttribute).array.slice(0);
        const display = buildScanDisplayInfo(geo);
        const P = resolveScanMeshMatrix(display, null);
        // Apply as mesh matrix only — geometry untouched.
        const mesh = new THREE.Mesh(geo);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(P);
        const after = (geo.getAttribute("position") as THREE.BufferAttribute).array;
        for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
        expect(P.elements.some((e, i) => e !== (i % 5 === 0 ? 1 : 0))).toBe(true);
        geo.dispose();
    });
});
