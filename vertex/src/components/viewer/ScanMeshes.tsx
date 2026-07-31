// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { INSOLE_LENGTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import { getMarkerFrame, mirrorBaseLandmarks } from "@/lib/geometry/marker-frame";
import {
    computeScanDeviationAgainstRaw,
    DEVIATION_LEGEND_MM,
    deviationColor,
} from "@/lib/geometry/scan-deviation";
import { buildDecimatedPickGeometry, scanNeedsPickProxy } from "@/lib/geometry/scan-pick-mesh";
import { getScanRegistrationMatrix, useScanStore } from "@/stores/scan-store";

const CLINICIAN_MARKER_COLOR = "#f59e0b";
const BASE_LANDMARK_COLOR = "#22d3ee";

function MarkerSphere({
    position,
    color,
    radius = 2.2,
}: {
    position: THREE.Vector3;
    color: string;
    radius?: number;
}) {
    return (
        <mesh position={position.toArray() as [number, number, number]} renderOrder={20}>
            <sphereGeometry args={[radius, 16, 12]} />
            <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
    );
}

function RegisteredScanMesh({
    scanId,
    geometry,
    side,
    transparent,
    matrix,
}: {
    scanId: string;
    geometry: THREE.BufferGeometry;
    side: "left" | "right";
    transparent: boolean;
    matrix: THREE.Matrix4 | null;
}) {
    const deviationOverlay = useScanStore((s) => s.deviationOverlay);
    const setDeviationBusy = useScanStore((s) => s.setDeviationBusy);
    const landmarkSourceAssetId = useScanStore((s) => s.landmarkSourceAssetId);
    const rawBase = useScanStore((s) =>
        landmarkSourceAssetId ? s.rawBaseBySourceId[landmarkSourceAssetId] : undefined,
    );
    const markers = useScanStore((s) => s.markersByScanId[scanId]);
    const leftFrame = landmarkSourceAssetId ? getMarkerFrame(landmarkSourceAssetId) : null;

    const [coloredGeo, setColoredGeo] = useState<THREE.BufferGeometry | null>(null);

    // K3 — deviation can exceed ~250ms on large scans; show busy, compute async.
    useEffect(() => {
        if (!deviationOverlay || !matrix || !rawBase) {
            setColoredGeo((prev) => {
                prev?.dispose();
                return null;
            });
            setDeviationBusy(false);
            return;
        }
        let cancelled = false;
        setDeviationBusy(true);
        const handle = window.setTimeout(() => {
            const t0 = performance.now();
            const dev = computeScanDeviationAgainstRaw(geometry, matrix, rawBase);
            if (cancelled) return;
            const g = geometry.clone();
            const colors = new Float32Array(dev.perVertexMm.length * 3);
            const c = new THREE.Color();
            for (let i = 0; i < dev.perVertexMm.length; i++) {
                deviationColor(dev.perVertexMm[i]!, c);
                colors[i * 3] = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;
            }
            g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
            setColoredGeo((prev) => {
                prev?.dispose();
                return g;
            });
            setDeviationBusy(false);
            if (typeof console !== "undefined" && performance.now() - t0 > 250) {
                console.log("[scan-deviation] elapsedMs", performance.now() - t0);
            }
        }, 0);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [deviationOverlay, matrix, rawBase, geometry, setDeviationBusy]);

    const pickGeo = useMemo(() => {
        if (!scanNeedsPickProxy(geometry)) return null;
        return buildDecimatedPickGeometry(geometry);
    }, [geometry]);

    useEffect(() => () => pickGeo?.dispose(), [pickGeo]);

    const displayGeo = coloredGeo ?? geometry;
    const offsetY = sideOffsetX(side);
    const registered = !!matrix;
    const posX = registered ? -INSOLE_LENGTH_MM / 2 : 0;

    const landmarks =
        leftFrame && registered
            ? side === "right"
                ? mirrorBaseLandmarks(leftFrame.landmarks)
                : leftFrame.landmarks
            : null;

    const applyPoint = (p: THREE.Vector3) => (matrix ? p.clone().applyMatrix4(matrix) : p);

    return (
        <group position={[posX, offsetY, 0]}>
            <mesh
                geometry={displayGeo}
                matrixAutoUpdate={false}
                userData={{ scanId, isScanMesh: true }}
                castShadow
                receiveShadow
                ref={(mesh) => {
                    if (!mesh) return;
                    if (matrix) mesh.matrix.copy(matrix);
                    else mesh.matrix.identity();
                    mesh.matrixWorldNeedsUpdate = true;
                }}
            >
                <meshStandardMaterial
                    color="#c084fc"
                    metalness={0.1}
                    roughness={0.8}
                    transparent={transparent || !!coloredGeo}
                    opacity={transparent ? 0.45 : coloredGeo ? 0.9 : 1}
                    side={THREE.DoubleSide}
                    vertexColors={!!coloredGeo}
                />
            </mesh>

            {/* Invisible decimated pick proxy (K3) — same transform as full mesh. */}
            {pickGeo ? (
                <mesh
                    geometry={pickGeo}
                    matrixAutoUpdate={false}
                    visible={false}
                    userData={{ scanId, isScanPickMesh: true, fullGeometry: geometry }}
                    ref={(mesh) => {
                        if (!mesh) return;
                        if (matrix) mesh.matrix.copy(matrix);
                        else mesh.matrix.identity();
                        mesh.matrixWorldNeedsUpdate = true;
                    }}
                >
                    <meshBasicMaterial />
                </mesh>
            ) : null}

            {markers?.M1 ? (
                <MarkerSphere position={applyPoint(markers.M1)} color={CLINICIAN_MARKER_COLOR} />
            ) : null}
            {markers?.M2 ? (
                <MarkerSphere position={applyPoint(markers.M2)} color={CLINICIAN_MARKER_COLOR} />
            ) : null}
            {markers?.M3 ? (
                <MarkerSphere position={applyPoint(markers.M3)} color={CLINICIAN_MARKER_COLOR} />
            ) : null}

            {landmarks ? (
                <>
                    <MarkerSphere position={landmarks.B1} color={BASE_LANDMARK_COLOR} radius={1.8} />
                    <MarkerSphere position={landmarks.B2} color={BASE_LANDMARK_COLOR} radius={1.8} />
                    <MarkerSphere position={landmarks.B3} color={BASE_LANDMARK_COLOR} radius={1.8} />
                </>
            ) : null}
        </group>
    );
}

export function ScanMeshes({ transparent }: { transparent: boolean }) {
    const scans = useScanStore((s) => s.scans);
    const registrationByScanId = useScanStore((s) => s.registrationByScanId);

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            {scans
                .filter((s) => s.visible)
                .map((s) => (
                    <RegisteredScanMesh
                        key={s.id}
                        scanId={s.id}
                        geometry={s.geometry}
                        side={s.side}
                        transparent={transparent}
                        matrix={getScanRegistrationMatrix(registrationByScanId[s.id])}
                    />
                ))}
        </group>
    );
}

export function deviationLegendLabel(): string {
    return `Deviation vs raw L0 (±${DEVIATION_LEGEND_MM} mm)`;
}
