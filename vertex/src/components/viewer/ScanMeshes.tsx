// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { sideOffsetX } from "@/lib/geometry/layout";
import { getMarkerFrame, mirrorBaseLandmarks } from "@/lib/geometry/marker-frame";
import { extractKeptGeometry, type ScanComponentLabeling } from "@/lib/geometry/scan-components";
import {
    computeScanDeviationAgainstRaw,
    DEVIATION_LEGEND_MM,
    deviationColor,
} from "@/lib/geometry/scan-deviation";
import {
    resolveScanMeshMatrix,
    type ScanDisplayInfo,
    type ScanManualOffset,
} from "@/lib/geometry/scan-display";
import { buildDecimatedPickGeometry, scanNeedsPickProxy } from "@/lib/geometry/scan-pick-mesh";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { useDesignStore } from "@/stores/design-store";
import { getScanRegistrationMatrix, useScanStore } from "@/stores/scan-store";

const CLINICIAN_MARKER_COLOR = "#f59e0b";
const BASE_LANDMARK_COLOR = "#22d3ee";
const SUGGESTED_MARKER_COLOR = "#67e8f9";
const HOVER_COMPONENT_COLOR = "#fbbf24";

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
    registration,
    display,
    manualOffset,
    selected,
}: {
    scanId: string;
    geometry: THREE.BufferGeometry;
    side: "left" | "right";
    transparent: boolean;
    registration: THREE.Matrix4 | null;
    display: ScanDisplayInfo;
    manualOffset: ScanManualOffset | null;
    selected: boolean;
}) {
    const deviationOverlay = useScanStore((s) => s.deviationOverlay);
    const setDeviationBusy = useScanStore((s) => s.setDeviationBusy);
    const landmarkSourceAssetId = useScanStore((s) => s.landmarkSourceAssetId);
    const rawBase = useScanStore((s) =>
        landmarkSourceAssetId ? s.rawBaseBySourceId[landmarkSourceAssetId] : undefined,
    );
    const markers = useScanStore((s) => s.markersByScanId[scanId]);
    const scanRecord = useScanStore((s) => s.scans.find((x) => x.id === scanId));
    const hovered = useScanStore((s) => s.hoveredComponentId);
    const leftFrame = landmarkSourceAssetId ? getMarkerFrame(landmarkSourceAssetId) : null;

    const [coloredGeo, setColoredGeo] = useState<THREE.BufferGeometry | null>(null);
    const deviationGenRef = useRef(0);

    // K3/L3 — deviation exceeds ~250ms at clinical scale; busy + deferred compute.
    // Generation token drops stale results so toggles cannot stack overlapping work.
    // Deviation uses registration only — never the provisional display matrix (M2).
    useEffect(() => {
        if (!deviationOverlay || !registration || !rawBase) {
            deviationGenRef.current += 1;
            setColoredGeo((prev) => {
                prev?.dispose();
                return null;
            });
            setDeviationBusy(false);
            return;
        }
        const gen = ++deviationGenRef.current;
        setDeviationBusy(true);
        const handle = window.setTimeout(() => {
            if (gen !== deviationGenRef.current) return;
            const t0 = performance.now();
            const dev = computeScanDeviationAgainstRaw(geometry, registration, rawBase);
            if (gen !== deviationGenRef.current) return;
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
            window.clearTimeout(handle);
            // Invalidate this generation; a newer effect owns busy, or teardown cleared it.
            if (deviationGenRef.current === gen) {
                deviationGenRef.current += 1;
            }
        };
    }, [deviationOverlay, registration, rawBase, geometry, setDeviationBusy]);

    // Pick proxy from KEPT geometry only — hidden components are not in `geometry`.
    const pickGeo = useMemo(() => {
        if (!scanNeedsPickProxy(geometry)) return null;
        return buildDecimatedPickGeometry(geometry);
    }, [geometry]);

    useEffect(() => () => pickGeo?.dispose(), [pickGeo]);

    const hoverGeo = useMemo(() => {
        if (!scanRecord || !hovered || hovered.scanId !== scanId) return null;
        if (!scanRecord.triangleComponentOf || !scanRecord.labelingMeta) return null;
        const labeling: ScanComponentLabeling = {
            components: scanRecord.components,
            triangleComponentOf: scanRecord.triangleComponentOf,
            originalTriangleCount: scanRecord.labelingMeta.originalTriangleCount,
            degenerateTriangleCount: scanRecord.labelingMeta.degenerateTriangleCount,
            weldTolerance: scanRecord.labelingMeta.weldTolerance,
            longestBbox: scanRecord.display.rawLongest,
            elapsedMs: scanRecord.labelingMeta.elapsedMs,
        };
        return extractKeptGeometry(scanRecord.rawGeometry, labeling, [hovered.componentId]);
    }, [scanRecord, hovered, scanId]);

    useEffect(() => () => hoverGeo?.dispose(), [hoverGeo]);

    const displayGeo = coloredGeo ?? geometry;
    const usMenSize = useDesignStore((s) => s.design.usMenSize);
    const layout = insoleLayoutFromDesign({ usMenSize });
    const offsetY = sideOffsetX(side, layout.widthMm);
    const registered = !!registration;
    // Same footprint slot as the base — unregistered scans must be on-screen (M2/M4).
    const posX = -layout.lengthMm / 2;
    const meshMatrix = resolveScanMeshMatrix(display, registration, manualOffset);

    const landmarks =
        leftFrame && registered
            ? side === "right"
                ? mirrorBaseLandmarks(leftFrame.landmarks)
                : leftFrame.landmarks
            : null;

    const applyPoint = (p: THREE.Vector3) => p.clone().applyMatrix4(meshMatrix);
    const suggested = scanRecord?.suggestedLandmarks;

    return (
        <group position={[posX, offsetY, 0]}>
            <mesh
                geometry={displayGeo}
                matrixAutoUpdate={false}
                userData={{
                    scanId,
                    isScanMesh: true,
                    isProvisionalDisplay: !registered,
                }}
                castShadow
                receiveShadow
                ref={(mesh) => {
                    if (!mesh) return;
                    mesh.matrix.copy(meshMatrix);
                    mesh.matrixWorldNeedsUpdate = true;
                }}
            >
                <meshStandardMaterial
                    color={selected ? "#e9d5ff" : registered ? "#c084fc" : "#a78bfa"}
                    emissive={selected ? "#a855f7" : "#000000"}
                    emissiveIntensity={selected ? 0.35 : 0}
                    metalness={0.1}
                    roughness={0.8}
                    transparent={transparent || !!coloredGeo || !registered}
                    opacity={transparent ? 0.45 : coloredGeo ? 0.9 : registered ? 1 : 0.75}
                    side={THREE.DoubleSide}
                    vertexColors={!!coloredGeo}
                />
            </mesh>

            {/* Hover highlight — not a pick target (no isScanMesh / isScanPickMesh). */}
            {hoverGeo ? (
                <mesh
                    geometry={hoverGeo}
                    matrixAutoUpdate={false}
                    userData={{ scanId, isScanHoverHighlight: true }}
                    ref={(mesh) => {
                        if (!mesh) return;
                        mesh.matrix.copy(meshMatrix);
                        mesh.matrixWorldNeedsUpdate = true;
                    }}
                >
                    <meshBasicMaterial
                        color={HOVER_COMPONENT_COLOR}
                        transparent
                        opacity={0.45}
                        side={THREE.DoubleSide}
                        depthTest={false}
                    />
                </mesh>
            ) : null}

            {/* Invisible decimated pick proxy (K3) — same transform as full mesh (kept only). */}
            {pickGeo ? (
                <mesh
                    geometry={pickGeo}
                    matrixAutoUpdate={false}
                    visible={false}
                    userData={{
                        scanId,
                        isScanPickMesh: true,
                        fullGeometry: geometry,
                        isProvisionalDisplay: !registered,
                    }}
                    ref={(mesh) => {
                        if (!mesh) return;
                        mesh.matrix.copy(meshMatrix);
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

            {/* Suggested (provisional) markers — visually distinct; not confirmed. */}
            {suggested && !markers?.M1 ? (
                <MarkerSphere
                    position={applyPoint(suggested.M1)}
                    color={SUGGESTED_MARKER_COLOR}
                    radius={1.6}
                />
            ) : null}
            {suggested && !markers?.M2 ? (
                <MarkerSphere
                    position={applyPoint(suggested.M2)}
                    color={SUGGESTED_MARKER_COLOR}
                    radius={1.6}
                />
            ) : null}
            {suggested && !markers?.M3 ? (
                <MarkerSphere
                    position={applyPoint(suggested.M3)}
                    color={SUGGESTED_MARKER_COLOR}
                    radius={1.6}
                />
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
    const manualOffsetByScanId = useScanStore((s) => s.manualOffsetByScanId);
    const selectedScanId = useScanStore((s) => s.selectedScanId);

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
                        registration={getScanRegistrationMatrix(registrationByScanId[s.id])}
                        display={s.display}
                        manualOffset={manualOffsetByScanId[s.id] ?? null}
                        selected={selectedScanId === s.id}
                    />
                ))}
        </group>
    );
}

export function deviationLegendLabel(): string {
    return `Deviation vs raw L0 (±${DEVIATION_LEGEND_MM} mm)`;
}
