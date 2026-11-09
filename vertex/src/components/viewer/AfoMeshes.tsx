// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useMemo } from "react";
import { DoubleSide, Quaternion, Vector3 } from "three";
import { AFO_SCAN_GREY, afoUploadedScanMaterial } from "@/features/afo/afo-scan-ui";
import { geodesicPolyline } from "@/lib/geometry/afo/geodesic";
import { afoMeshToGeometry } from "@/lib/geometry/afo/mesh-ops";
import { afoTrimPreview, cursorCrossSegments, fallbackTrimPolyline } from "@/lib/geometry/afo/trim-preview";
import type { AfoVec3 } from "@/lib/geometry/afo/types";
import { getAfoState, useAfoStore } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

const TRIM_YELLOW = "#ffe14a";
const TRIM_HALO = "#111827";

export function AfoMeshes() {
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const viewerTransparent = useDesignStore((s) => s.viewer.transparent);
    const workflowStep = useClinicalWorkflowStore((s) => s.step);
    const placingScan = useAfoStore((s) => s.scanPlacement != null);
    const placingTrim = useAfoStore((s) => s.placingTrim);
    const trimHover = useAfoStore((s) => s.trimHover);
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
    const onMesh = useMemo(() => {
        const handles = afo.trimPoints.map((p) => p.point);
        if (!placingTrim && (afo.trimCurve?.length ?? 0) >= 2) return afo.trimCurve ?? null;
        if (!working || handles.length < 2) return null;
        const geo = geodesicPolyline(
            working,
            afo.trimPoints.map((p) => p.vertexIndex),
            afo.trimClosed,
        );
        return fallbackTrimPolyline(geo, handles);
    }, [working, afo.trimPoints, afo.trimClosed, afo.trimCurve, placingTrim]);
    const preview = afoTrimPreview({
        points: afo.trimPoints.map((p) => p.point),
        curve: afo.trimCurve ?? [],
        hover: trimHover,
        placing: placingTrim,
        closed: afo.trimClosed,
        onMesh,
    });

    useEffect(() => {
        return () => {
            castGeo?.dispose();
            correctedGeo?.dispose();
            shellGeo?.dispose();
            pickGeo?.dispose();
        };
    }, [castGeo, correctedGeo, shellGeo, pickGeo]);

    const bodyGeo = showCorrectedBody ? correctedGeo : showSource ? castGeo : null;
    const bodyData = showCorrectedBody
        ? { isAfoCorrected: true, isAfoCast: true, isScanMesh: true }
        : { isAfoCast: true, isScanMesh: true };

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            {pickGeo ? (
                <mesh geometry={pickGeo} visible={false} userData={{ isAfoAlignPick: true }}>
                    <meshBasicMaterial />
                </mesh>
            ) : null}
            {bodyGeo ? (
                <mesh geometry={bodyGeo} userData={bodyData}>
                    <meshStandardMaterial
                        color={AFO_SCAN_GREY}
                        roughness={0.85}
                        metalness={0}
                        side={DoubleSide}
                        transparent={scanMat.transparent}
                        opacity={scanMat.opacity}
                        depthWrite={!scanMat.transparent}
                    />
                </mesh>
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
                    userData={{ isAfoClinical: true }}
                >
                    <sphereGeometry args={[3, 12, 10]} />
                    <meshStandardMaterial color="#f472b6" />
                </mesh>
            ))}
            {afo.landmarks.map((lm) => (
                <mesh
                    key={lm.id}
                    position={[lm.point.x, lm.point.y, lm.point.z]}
                    userData={{ isAfoLandmark: true }}
                >
                    <sphereGeometry args={[3.2, 12, 10]} />
                    <meshStandardMaterial color="#fbbf24" />
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
    const [xArm, yArm, zArm] = cursor ? cursorCrossSegments(cursor) : [];
    const segments: { a: AfoVec3; b: AfoVec3 }[] = [];
    for (let i = 0; i < stroke.length - 1; i++) {
        const a = stroke[i];
        const b = stroke[i + 1];
        if (a && b) segments.push({ a, b });
    }
    return (
        <group>
            {xArm ? <TrimSegment key="cursor-x" a={xArm[0]} b={xArm[1]} radius={1.1} /> : null}
            {yArm ? <TrimSegment key="cursor-y" a={yArm[0]} b={yArm[1]} radius={1.1} /> : null}
            {zArm ? <TrimSegment key="cursor-z" a={zArm[0]} b={zArm[1]} radius={1.1} /> : null}
            {segments.map((seg) => (
                <TrimSegment key={`${pointKey(seg.a)}>${pointKey(seg.b)}`} a={seg.a} b={seg.b} radius={1.7} />
            ))}
            {marks.map((pt) => {
                const handle = marks.indexOf(pt);
                return (
                    <mesh
                        key={`${handle}:${pointKey(pt)}`}
                        position={[pt.x, pt.y, pt.z]}
                        renderOrder={46}
                        frustumCulled={false}
                        userData={{ isAfoTrimHandle: true, trimIndex: handle }}
                    >
                        <sphereGeometry args={[handle === 0 ? 5.2 : 4.2, 16, 12]} />
                        <meshBasicMaterial
                            color={handle === 0 ? "#4ade80" : TRIM_YELLOW}
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

function TrimSegment({ a, b, radius }: { a: AfoVec3; b: AfoVec3; radius: number }) {
    const start = new Vector3(a.x, a.y, a.z);
    const end = new Vector3(b.x, b.y, b.z);
    const length = start.distanceTo(end);
    if (length < 0.2) return null;
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const quat = new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        end.clone().sub(start).normalize(),
    );
    return (
        <group position={[mid.x, mid.y, mid.z]} quaternion={quat}>
            <mesh renderOrder={40} frustumCulled={false}>
                <cylinderGeometry args={[radius + 0.7, radius + 0.7, length, 6]} />
                <meshBasicMaterial
                    color={TRIM_HALO}
                    depthTest={false}
                    depthWrite={false}
                    toneMapped={false}
                />
            </mesh>
            <mesh renderOrder={41} frustumCulled={false}>
                <cylinderGeometry args={[radius, radius, length, 6]} />
                <meshBasicMaterial
                    color={TRIM_YELLOW}
                    depthTest={false}
                    depthWrite={false}
                    toneMapped={false}
                />
            </mesh>
        </group>
    );
}
