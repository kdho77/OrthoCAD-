// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import * as THREE from "three";
import {
    clearMarkerFrameRegistry,
    getMarkerFrame,
    mirrorBaseLandmarks,
    registerRawBaseGeometry,
} from "@/lib/geometry/marker-frame";
import { computeScanDeviationAgainstRaw, DEVIATION_LEGEND_MM } from "@/lib/geometry/scan-deviation";
import { deriveScanDorsal, ScanDorsalError } from "@/lib/geometry/scan-dorsal";
import {
    buildDecimatedPickGeometry,
    PICK_DECIMATE_TRI_THRESHOLD,
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
} from "@/lib/geometry/scan-registration-wire";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
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
        useScanStore.getState().setDeviationOverlay(true);
        const reg = useScanStore.getState().registrationByScanId["t9-scan"];
        expect(reg?.error).toBeNull();
        expect(reg?.matrixElements).not.toBeNull();

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
