// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { BufferAttribute, DoubleSide, FrontSide } from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { AfoLitSurfaceMaterial } from "@/components/viewer/AfoSurfaceMaterial";
import {
    afoCastBodyStyle,
    afoHeightColors,
    afoTriangleStats,
    afoUploadedScanMaterial,
} from "@/features/afo/afo-scan-ui";
import { AFO_TRIM_PIN_RADIUS_MM } from "@/lib/geometry/afo/defaults";
import { afoMeshToGeometry } from "@/lib/geometry/afo/mesh-ops";
import { afoTrimPreview, cursorCrossSegments } from "@/lib/geometry/afo/trim-preview";
import { fitSurfaceSpline } from "@/lib/geometry/afo/trim-spline";
import type { AfoVec3 } from "@/lib/geometry/afo/types";
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
    const draggingTrim = useAfoStore((s) => s.draggingTrimIndex != null);
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

    const showShell = Boolean(shell);
    const showCorrectedBody = Boolean(corrected) && show3d && !showShell && !placingLandmarks;
    const showSource = Boolean(source ?? working) && show3d && !showShell && !showCorrectedBody;

    const castGeo = useMemo(
        () => (source ? afoMeshToGeometry(source) : working ? afoMeshToGeometry(working) : null),
        [source, working],
    );
    const correctedGeo = useMemo(() => (corrected ? afoMeshToGeometry(corrected) : null), [corrected]);
    const shellGeo = useMemo(() => (shell ? afoMeshToGeometry(shell) : null), [shell]);
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
    const bodyGeo = showCorrectedBody ? correctedGeo : showSource ? castGeo : null;
    const bodyData = showCorrectedBody
        ? { isAfoCorrected: true, isAfoCast: true, isScanMesh: true }
        : { isAfoCast: true, isScanMesh: true };
    const bodyStyle = useMemo(() => {
        const stats = bodyMesh
            ? afoTriangleStats(bodyMesh.positions, bodyMesh.indices)
            : { triangles: 0, degenerateRatio: 1 };
        return afoCastBodyStyle({
            transparentOn: scanMat.transparent,
            heightmap,
            triangleCount: stats.triangles,
            degenerateRatio: stats.degenerateRatio,
        });
    }, [bodyMesh, scanMat.transparent, heightmap]);
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
                <points geometry={shadedGeo} renderOrder={1} userData={bodyData}>
                    <pointsMaterial
                        color={bodyStyle.color}
                        size={bodyStyle.pointSizeMm}
                        sizeAttenuation
                        vertexColors={bodyStyle.vertexColors}
                        toneMapped={false}
                    />
                </points>
            ) : null}
            {shellGeo ? (
                <mesh geometry={shellGeo} userData={{ isAfoShell: true, isScanMesh: true }}>
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
            />
            {afo.clinicalMarkers.map((lm) => (
                <mesh
                    key={`c-${lm.id}`}
                    position={[lm.point.x, lm.point.y, lm.point.z]}
                    renderOrder={bodyStyle.markerRenderOrder}
                    userData={{ isAfoClinical: true }}
                >
                    <sphereGeometry args={[3, 12, 10]} />
                    <meshBasicMaterial
                        color="#f472b6"
                        depthTest={bodyStyle.markerDepthTest}
                        depthWrite={false}
                        toneMapped={false}
                    />
                </mesh>
            ))}
            {afo.landmarks.map((lm) => (
                <mesh
                    key={lm.id}
                    position={[lm.point.x, lm.point.y, lm.point.z]}
                    renderOrder={bodyStyle.markerRenderOrder}
                    userData={{ isAfoLandmark: true }}
                >
                    <sphereGeometry args={[3.2, 12, 10]} />
                    <meshBasicMaterial
                        color="#fbbf24"
                        depthTest={bodyStyle.markerDepthTest}
                        depthWrite={false}
                        toneMapped={false}
                    />
                </mesh>
            ))}
        </group>
    );
}

function pointKey(pt: AfoVec3): string {
    return `${pt.x.toFixed(2)},${pt.y.toFixed(2)},${pt.z.toFixed(2)}`;
}

function AfoTrimOverlay({
    marks,
    stroke,
    cursor,
}: {
    marks: AfoVec3[];
    stroke: AfoVec3[];
    cursor: AfoVec3 | null;
}) {
    const arms = cursor ? cursorCrossSegments(cursor) : [];
    return (
        <group>
            {arms.map((arm) => (
                <FatTrimLine key={pointKey(arm[0])} points={arm} />
            ))}
            {stroke.length >= 2 ? <FatTrimLine points={stroke} /> : null}
            {marks.map((pt, handle) => (
                <mesh
                    key={pointKey(pt)}
                    position={[pt.x, pt.y, pt.z]}
                    renderOrder={60}
                    frustumCulled={false}
                    userData={{ isAfoTrimHandle: true, trimIndex: handle }}
                >
                    <sphereGeometry args={[AFO_TRIM_PIN_RADIUS_MM, 12, 10]} />
                    <meshBasicMaterial
                        color={handle === 0 ? TRIM_FIRST : TRIM_YELLOW_GREEN}
                        depthTest={false}
                        depthWrite={false}
                        toneMapped={false}
                    />
                </mesh>
            ))}
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
