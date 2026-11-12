// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, type BufferGeometry, DoubleSide, FrontSide, type Points, Vector3 } from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { AfoCueSphere } from "@/components/viewer/AfoScanMarkers";
import { AfoLitSurfaceMaterial, AfoPointCloudMaterial } from "@/components/viewer/AfoSurfaceMaterial";
import {
    AFO_POINT_DEPTH_WINDOW_MM,
    afoCastStyleDuringPlacement,
    afoHeightColors,
    afoTriangleStats,
    afoUploadedScanMaterial,
    setAfoPointCloudRange,
} from "@/features/afo/afo-scan-ui";
import { usePublishMeasureSolid } from "@/features/measure/publish-solid";
import { AFO_TRIM_PIN_RADIUS_MM } from "@/lib/geometry/afo/defaults";
import { afoMeshToGeometry, meshCentroid } from "@/lib/geometry/afo/mesh-ops";
import { useAfoShellCurrent } from "@/lib/geometry/afo/shell-fingerprint";
import { afoTrimPreview, cursorCrossSegments } from "@/lib/geometry/afo/trim-preview";
import { fitSurfaceSpline } from "@/lib/geometry/afo/trim-spline";
import type { AfoVec3 } from "@/lib/geometry/afo/types";
import { afoMeasureSolidId, afoMeasureTarget } from "@/lib/geometry/measure/afo-target";
import { triangleMeshFromGeometry } from "@/lib/geometry/measure/mesh-ops";
import { publishExportMeasureMesh } from "@/lib/geometry/measure/registry";
import { getAfoState, useAfoStore } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

const TRIM_YELLOW_GREEN = "#c6ef3a";
const TRIM_FIRST = "#7dff6a";

export function AfoMeshes() {
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const viewerTransparent = useDesignStore((s) => s.viewer.transparent);
    const heightmap = useDesignStore((s) => s.viewer.heightmap);
    const workflowStep = useClinicalWorkflowStore((s) => s.step);
    const placingScan = useAfoStore((s) => s.scanPlacement != null);
    const placingTrim = useAfoStore((s) => s.placingTrim);
    const trimHover = useAfoStore((s) => s.trimHover);
    const draggingTrimIndex = useAfoStore((s) => s.draggingTrimIndex);
    const hoveredTrimIndex = useAfoStore((s) => s.hoveredTrimIndex);
    const draggingTrim = draggingTrimIndex != null;
    const placingDesign = useAfoStore((s) => s.placingDesignLandmarks);
    const placingLandmarks = workflowStep === "scan" && placingScan;
    const scanMat = afoUploadedScanMaterial({
        transparentOn: viewerTransparent || afo.cast.transparent,
        placingLandmarks,
    });
    const shell = useAfoStore((s) => s.shellMesh);
    const corrected = useAfoStore((s) => s.correctedMesh);
    const cast = useAfoStore((s) => s.castMesh);
    const source = useAfoStore((s) => s.sourceMesh);
    const show3d = afo.cast.show3dModel;
    const working = corrected ?? cast;

    const shellCurrent = useAfoShellCurrent();
    const liveShell = shellCurrent ? shell : null;
    const showShell = Boolean(liveShell);
    const showCorrectedBody = Boolean(corrected) && show3d && !showShell && !placingLandmarks;
    const showSource = Boolean(source ?? working) && show3d && !showShell && !showCorrectedBody;

    const castGeo = useMemo(
        () => (source ? afoMeshToGeometry(source) : working ? afoMeshToGeometry(working) : null),
        [source, working],
    );
    const correctedGeo = useMemo(() => (corrected ? afoMeshToGeometry(corrected) : null), [corrected]);
    const shellGeo = useMemo(() => (liveShell ? afoMeshToGeometry(liveShell) : null), [liveShell]);
    const pickGeo = useMemo(
        () => (placingScan && source ? afoMeshToGeometry(source) : null),
        [placingScan, source],
    );
    const trimPickGeo = useMemo(() => (working ? afoMeshToGeometry(working) : null), [working]);
    const trimStroke = useMemo(() => {
        if (!working) return afo.trimCurve ?? [];
        const base = afo.trimPoints.map((p) => p.point);
        const extend = placingTrim && trimHover && !afo.trimClosed && !draggingTrim;
        const live = extend && trimHover ? [...base, trimHover] : base;
        if (live.length < 2) return afo.trimCurve ?? [];
        const closed = afo.trimClosed && !extend;
        if (!closed && live.length < 3) {
            const open = fitSurfaceSpline(working, live, { closed: false, spacingMm: 0.5, quick: true });
            return open.display.length >= 2 ? open.display : open.curve;
        }
        if (live.length < 3) return [];
        const fit = fitSurfaceSpline(working, live, {
            closed,
            spacingMm: 0.5,
            quick: placingTrim,
        });
        return fit.display.length >= 2 ? fit.display : fit.curve;
    }, [working, afo.trimPoints, afo.trimClosed, afo.trimCurve, placingTrim, trimHover, draggingTrim]);
    const preview = afoTrimPreview({
        points: afo.trimPoints.map((p) => p.point),
        curve: trimStroke,
        hover: trimHover,
        placing: placingTrim,
        closed: afo.trimClosed,
    });

    useEffect(() => {
        return () => {
            castGeo?.dispose();
            correctedGeo?.dispose();
            shellGeo?.dispose();
            pickGeo?.dispose();
            trimPickGeo?.dispose();
        };
    }, [castGeo, correctedGeo, shellGeo, pickGeo, trimPickGeo]);

    const bodyMesh = showCorrectedBody ? corrected : showSource ? (source ?? working) : null;
    const markerCenter = useMemo(
        () => (bodyMesh ? meshCentroid(bodyMesh) : { x: 0, y: 0, z: 0 }),
        [bodyMesh],
    );
    const bodyGeo = showCorrectedBody ? correctedGeo : showSource ? castGeo : null;
    const bodyData = showCorrectedBody
        ? { isAfoCorrected: true, isAfoCast: true, isScanMesh: true }
        : { isAfoCast: true, isScanMesh: true };
    const bodyStyle = useMemo(() => {
        const stats = bodyMesh
            ? afoTriangleStats(bodyMesh.positions, bodyMesh.indices)
            : { triangles: 0, degenerateRatio: 1 };
        return afoCastStyleDuringPlacement({
            placingTrim: placingTrim || draggingTrim,
            placingMarkers: placingLandmarks || placingDesign,
            transparentOn: scanMat.transparent,
            heightmap,
            triangleCount: stats.triangles,
            degenerateRatio: stats.degenerateRatio,
        });
    }, [
        bodyMesh,
        scanMat.transparent,
        heightmap,
        placingTrim,
        draggingTrim,
        placingLandmarks,
        placingDesign,
    ]);
    const markerDrawMode = bodyMesh ? bodyStyle.drawMode : "surface";
    const shadedGeo = useMemo(() => {
        if (!bodyGeo || !bodyStyle.vertexColors || !bodyMesh) return bodyGeo;
        const g = bodyGeo.clone();
        g.setAttribute("color", new BufferAttribute(afoHeightColors(bodyMesh.positions), 3));
        return g;
    }, [bodyGeo, bodyMesh, bodyStyle.vertexColors]);

    useEffect(() => {
        return () => {
            if (shadedGeo && shadedGeo !== bodyGeo) shadedGeo.dispose();
        };
    }, [shadedGeo, bodyGeo]);

    const measureMesh = afoMeasureTarget({ shell: liveShell, corrected, cast });
    const measureId = afoMeasureSolidId({ shell: liveShell, corrected, cast });
    const measureGeo = useMemo(() => (measureMesh ? afoMeshToGeometry(measureMesh) : null), [measureMesh]);
    useEffect(() => () => measureGeo?.dispose(), [measureGeo]);
    useEffect(() => {
        if (!measureGeo) return;
        publishExportMeasureMesh("afo", triangleMeshFromGeometry(measureGeo));
    }, [measureGeo]);
    usePublishMeasureSolid(
        measureId ?? "afo-cast",
        measureGeo,
        "afo",
        "afo",
        `${liveShell ? "shell" : corrected ? "corrected" : cast ? "cast" : "none"}:${measureGeo?.uuid ?? "none"}`,
    );

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <ambientLight intensity={0.72} />
            <directionalLight position={[90, 160, 70]} intensity={1.25} />
            <directionalLight position={[-110, 50, -80]} intensity={0.55} />
            {pickGeo ? (
                <mesh geometry={pickGeo} visible={false} userData={{ isAfoAlignPick: true }}>
                    <meshBasicMaterial />
                </mesh>
            ) : null}
            {trimPickGeo ? (
                <mesh
                    geometry={trimPickGeo}
                    visible={false}
                    userData={{ isAfoTrimPick: true, isAfoCast: true }}
                >
                    <meshBasicMaterial side={DoubleSide} />
                </mesh>
            ) : null}
            {measureGeo && measureId ? (
                <mesh
                    geometry={measureGeo}
                    visible={false}
                    userData={{ measureSolid: true, measureId, measureSide: "afo" }}
                >
                    <meshBasicMaterial side={FrontSide} />
                </mesh>
            ) : null}
            {shadedGeo && bodyStyle.drawMode === "surface" ? (
                <mesh geometry={shadedGeo} renderOrder={1} userData={bodyData} castShadow receiveShadow>
                    <AfoLitSurfaceMaterial
                        color={bodyStyle.color}
                        opacity={bodyStyle.opacity}
                        transparent={bodyStyle.transparent}
                        roughness={bodyStyle.roughness}
                        metalness={bodyStyle.metalness}
                        vertexColors={bodyStyle.vertexColors}
                        depthWrite={bodyStyle.depthWrite}
                    />
                </mesh>
            ) : null}
            {shadedGeo && bodyStyle.drawMode === "points" ? (
                <AfoDepthPoints
                    geometry={shadedGeo}
                    color={bodyStyle.color}
                    size={bodyStyle.pointSizeMm}
                    vertexColors={bodyStyle.vertexColors}
                    splatScale={bodyStyle.pointDepthSplatScale}
                    userData={bodyData}
                />
            ) : null}
            {shellGeo ? (
                <mesh
                    geometry={shellGeo}
                    userData={{
                        isAfoShell: true,
                        isScanMesh: true,
                        measureSolid: true,
                        measureId: measureId ?? "afo-shell",
                        measureSide: "afo",
                    }}
                >
                    <meshStandardMaterial
                        color="#6ee7b7"
                        roughness={0.45}
                        metalness={0.05}
                        side={DoubleSide}
                        transparent={scanMat.transparent}
                        opacity={scanMat.transparent ? scanMat.opacity : 1}
                    />
                </mesh>
            ) : null}
            <AfoTrimOverlay
                marks={preview.marks}
                stroke={preview.stroke}
                cursor={preview.marks.length === 0 ? preview.cursor : null}
                hoveredIndex={hoveredTrimIndex}
                dragIndex={draggingTrimIndex}
            />
            {afo.clinicalMarkers.map((lm) => (
                <AfoCueSphere
                    key={`c-${lm.id}`}
                    position={[lm.point.x, lm.point.y, lm.point.z]}
                    color="#f472b6"
                    radius={3}
                    renderOrder={bodyStyle.markerRenderOrder}
                    userData={{ isAfoClinical: true }}
                    centerLocal={markerCenter}
                    drawMode={markerDrawMode}
                />
            ))}
            {afo.landmarks.map((lm) => (
                <AfoCueSphere
                    key={lm.id}
                    position={[lm.point.x, lm.point.y, lm.point.z]}
                    color="#fbbf24"
                    radius={3.2}
                    renderOrder={bodyStyle.markerRenderOrder}
                    userData={{ isAfoLandmark: true }}
                    centerLocal={markerCenter}
                    drawMode={markerDrawMode}
                />
            ))}
        </group>
    );
}

const depthCorner = new Vector3();

function AfoDepthPoints({
    geometry,
    color,
    size,
    vertexColors,
    splatScale,
    userData,
}: {
    geometry: BufferGeometry;
    color: string;
    size: number;
    vertexColors: boolean;
    splatScale: number;
    userData: Record<string, unknown>;
}) {
    const points = useRef<Points>(null);
    useFrame(({ camera }) => {
        const obj = points.current;
        const material = obj?.material;
        if (!obj || !material || Array.isArray(material)) return;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        if (!box) return;
        obj.updateWorldMatrix(true, false);
        camera.updateMatrixWorld();
        let nearest = Infinity;
        for (const x of [box.min.x, box.max.x]) {
            for (const y of [box.min.y, box.max.y]) {
                for (const z of [box.min.z, box.max.z]) {
                    depthCorner.set(x, y, z).applyMatrix4(obj.matrixWorld);
                    depthCorner.applyMatrix4(camera.matrixWorldInverse);
                    const depth = -depthCorner.z;
                    if (depth < nearest) nearest = depth;
                }
            }
        }
        setAfoPointCloudRange(material, nearest, nearest + AFO_POINT_DEPTH_WINDOW_MM);
    });
    return (
        <group>
            <points geometry={geometry} renderOrder={0} frustumCulled={false}>
                <pointsMaterial
                    size={size * splatScale}
                    sizeAttenuation
                    depthWrite
                    depthTest
                    colorWrite={false}
                    toneMapped={false}
                />
            </points>
            <points
                ref={points}
                geometry={geometry}
                renderOrder={1}
                frustumCulled={false}
                userData={userData}
            >
                <AfoPointCloudMaterial color={color} size={size} vertexColors={vertexColors} />
            </points>
        </group>
    );
}

function pointKey(pt: AfoVec3): string {
    return `${pt.x.toFixed(2)},${pt.y.toFixed(2)},${pt.z.toFixed(2)}`;
}

const TRIM_HOVER = "#fff4a3";
const TRIM_DRAG = "#ffffff";

function AfoTrimOverlay({
    marks,
    stroke,
    cursor,
    hoveredIndex,
    dragIndex,
}: {
    marks: AfoVec3[];
    stroke: AfoVec3[];
    cursor: AfoVec3 | null;
    hoveredIndex: number | null;
    dragIndex: number | null;
}) {
    const arms = cursor ? cursorCrossSegments(cursor) : [];
    return (
        <group>
            {arms.map((arm) => (
                <FatTrimLine key={pointKey(arm[0])} points={arm} />
            ))}
            {stroke.length >= 2 ? <FatTrimLine points={stroke} /> : null}
            {marks.map((pt, handle) => {
                const dragging = dragIndex === handle;
                const hovered = hoveredIndex === handle;
                const color = dragging
                    ? TRIM_DRAG
                    : hovered
                      ? TRIM_HOVER
                      : handle === 0
                        ? TRIM_FIRST
                        : TRIM_YELLOW_GREEN;
                const radius = dragging || hovered ? AFO_TRIM_PIN_RADIUS_MM + 0.7 : AFO_TRIM_PIN_RADIUS_MM;
                return (
                    <mesh
                        key={pointKey(pt)}
                        position={[pt.x, pt.y, pt.z]}
                        renderOrder={60}
                        frustumCulled={false}
                        userData={{ isAfoTrimHandle: true, trimIndex: handle, trimHot: dragging || hovered }}
                    >
                        <sphereGeometry args={[radius, 12, 10]} />
                        <meshBasicMaterial
                            color={color}
                            depthTest={false}
                            depthWrite={false}
                            toneMapped={false}
                        />
                    </mesh>
                );
            })}
        </group>
    );
}

function FatTrimLine({ points }: { points: AfoVec3[] }) {
    const { size } = useThree();
    const line = useMemo(() => {
        const geometry = new LineGeometry();
        const material = new LineMaterial({
            color: TRIM_YELLOW_GREEN,
            linewidth: 2.5,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            toneMapped: false,
        });
        const obj = new Line2(geometry, material);
        obj.renderOrder = 55;
        obj.frustumCulled = false;
        return obj;
    }, []);
    useEffect(() => {
        if (points.length < 2) return;
        const positions: number[] = [];
        for (const p of points) positions.push(p.x, p.y, p.z);
        (line.geometry as LineGeometry).setPositions(positions);
        line.computeLineDistances();
    }, [line, points]);
    useEffect(() => {
        (line.material as LineMaterial).resolution.set(size.width, size.height);
    }, [line, size.height, size.width]);
    useEffect(
        () => () => {
            line.geometry.dispose();
            (line.material as LineMaterial).dispose();
        },
        [line],
    );
    if (points.length < 2) return null;
    return <primitive object={line} />;
}
