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

/** Skip edge extract on very large scans during placement (perf). */
const SCAN_EDGE_MAX_TRIANGLES = 80_000;

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

/**
 * Z-height vertex colors for reading plantar relief / arch contour on a scan.
 * Cool = low (plantar), warm = high (dorsal / raised soft tissue).
 */
function applyScanDepthColors(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    const g = geometry.clone();
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const pos = g.getAttribute("position");
    if (!pos || pos.count === 0) return g;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    const span = Math.max(1e-6, maxZ - minZ);
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        const t = (pos.getZ(i) - minZ) / span;
        // Teal → amber → magenta: readable on dark viewport, emphasizes midfoot relief.
        color.setHSL(0.55 - 0.55 * t, 0.75, 0.42 + 0.12 * t);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
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
    heightmap,
    placingMarkers,
}: {
    scanId: string;
    geometry: THREE.BufferGeometry;
    side: "left" | "right";
    transparent: boolean;
    registration: THREE.Matrix4 | null;
    display: ScanDisplayInfo;
    manualOffset: ScanManualOffset | null;
    selected: boolean;
    heightmap: boolean;
    placingMarkers: boolean;
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
    /** Depth shading while placing markers, or when Heightmap is on (and not in deviation mode). */
    const wantDepthShading = placingMarkers || heightmap;

    const depthGeo = useMemo(() => {
        if (!wantDepthShading || deviationOverlay) return null;
        return applyScanDepthColors(geometry);
    }, [geometry, wantDepthShading, deviationOverlay]);

    useEffect(() => () => depthGeo?.dispose(), [depthGeo]);

    const edgeGeo = useMemo(() => {
        if (!placingMarkers) return null;
        const index = geometry.getIndex();
        const triCount = index ? index.count / 3 : geometry.getAttribute("position").count / 3;
        if (triCount > SCAN_EDGE_MAX_TRIANGLES) return null;
        return new THREE.EdgesGeometry(geometry, 25);
    }, [geometry, placingMarkers]);

    useEffect(() => () => edgeGeo?.dispose(), [edgeGeo]);

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

    const displayGeo = coloredGeo ?? depthGeo ?? geometry;
    const useVertexColors = !!coloredGeo || !!depthGeo;
    const usMenSize = useDesignStore((s) => s.design.usMenSize);
    const sizeSystem = useDesignStore((s) => s.design.sizeSystem);
    const ukSize = useDesignStore((s) => s.design.ukSize);
    const footLengthMm = useDesignStore((s) => s.design.footLengthMm);
    const layout = insoleLayoutFromDesign({ sizeSystem, usMenSize, ukSize, footLengthMm });
    const offsetY = sideOffsetX(side, layout.widthMm);
    const registered = !!registration;
    // Same footprint slot as the base — unregistered scans must be on-screen (M2/M4).
    const posX = -layout.lengthMm / 2;
    const meshMatrix = resolveScanMeshMatrix(display, registration, manualOffset);

    const registrationRms = useScanStore((s) => s.registrationByScanId[scanId]?.residualRmsMm);
    // Insole B1/B2/B3 targets (cyan). Hide while placing scan markers, and when RMS is
    // poor so they don't float far off the foot and get mistaken for scan markers.
    const showBaseLandmarks =
        !!leftFrame && registered && !placingMarkers && (registrationRms == null || registrationRms <= 15);
    const landmarks = showBaseLandmarks
        ? side === "right"
            ? mirrorBaseLandmarks(leftFrame!.landmarks)
            : leftFrame!.landmarks
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
                    color={
                        useVertexColors
                            ? "#ffffff"
                            : selected
                              ? "#e9d5ff"
                              : registered
                                ? "#c084fc"
                                : "#a78bfa"
                    }
                    emissive={selected && !useVertexColors ? "#a855f7" : "#000000"}
                    emissiveIntensity={selected && !useVertexColors ? 0.35 : 0}
                    metalness={0.05}
                    roughness={placingMarkers || depthGeo ? 0.55 : 0.8}
                    transparent={transparent || !!coloredGeo || (!registered && !depthGeo)}
                    opacity={transparent ? 0.45 : coloredGeo ? 0.9 : depthGeo ? 1 : registered ? 1 : 0.75}
                    side={THREE.DoubleSide}
                    vertexColors={useVertexColors}
                    flatShading={placingMarkers && !coloredGeo}
                />
            </mesh>
            {edgeGeo ? (
                <lineSegments
                    geometry={edgeGeo}
                    matrixAutoUpdate={false}
                    renderOrder={5}
                    ref={(lines) => {
                        if (!lines) return;
                        lines.matrix.copy(meshMatrix);
                        lines.matrixWorldNeedsUpdate = true;
                    }}
                >
                    <lineBasicMaterial color="#f8fafc" transparent opacity={0.35} depthTest />
                </lineSegments>
            ) : null}

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

export function ScanMeshes({
    transparent,
    heightmap = false,
}: {
    transparent: boolean;
    heightmap?: boolean;
}) {
    const scans = useScanStore((s) => s.scans);
    const registrationByScanId = useScanStore((s) => s.registrationByScanId);
    const manualOffsetByScanId = useScanStore((s) => s.manualOffsetByScanId);
    const selectedScanId = useScanStore((s) => s.selectedScanId);
    const placementScanId = useScanStore((s) => s.placementMode?.scanId ?? null);

    // Stabilize Matrix4 identity across parent re-renders — a fresh matrix each
    // render re-fires the deviation effect and can exceed React's update depth.
    const registrationMatrices = useMemo(() => {
        const map = new Map<string, THREE.Matrix4 | null>();
        for (const s of scans) {
            map.set(s.id, getScanRegistrationMatrix(registrationByScanId[s.id]));
        }
        return map;
    }, [scans, registrationByScanId]);

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
                        registration={registrationMatrices.get(s.id) ?? null}
                        display={s.display}
                        manualOffset={manualOffsetByScanId[s.id] ?? null}
                        selected={selectedScanId === s.id}
                        heightmap={heightmap}
                        placingMarkers={placementScanId === s.id}
                    />
                ))}
        </group>
    );
}

export function deviationLegendLabel(): string {
    return `Deviation vs raw L0 (±${DEVIATION_LEGEND_MM} mm)`;
}
