// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide, LineBasicMaterial, Line as ThreeLine } from "three";
import { AFO_SCAN_GREY } from "@/features/afo/afo-scan-ui";
import { geodesicPolyline } from "@/lib/geometry/afo/geodesic";
import { afoMeshToGeometry } from "@/lib/geometry/afo/mesh-ops";
import { getAfoState, useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";

export function AfoMeshes() {
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const viewerTransparent = useDesignStore((s) => s.viewer.transparent);
    const placingScan = useAfoStore((s) => s.scanPlacement != null);
    const transparent = placingScan ? false : viewerTransparent || afo.cast.transparent;
    const shell = useAfoStore((s) => s.shellMesh);
    const corrected = useAfoStore((s) => s.correctedMesh);
    const cast = useAfoStore((s) => s.castMesh);
    const source = useAfoStore((s) => s.sourceMesh);
    const show3d = afo.cast.show3dModel;
    const showCorrected = afo.cast.showCorrected;

    const working = showCorrected ? (corrected ?? cast) : cast;
    const showCast = Boolean(working) && show3d && !shell;

    const castGeo = useMemo(() => (working ? afoMeshToGeometry(working) : null), [working]);
    const shellGeo = useMemo(() => (shell ? afoMeshToGeometry(shell) : null), [shell]);
    const pickGeo = useMemo(
        () => (placingScan && source ? afoMeshToGeometry(source) : null),
        [placingScan, source],
    );
    const trimLine = useMemo(() => {
        if (!working || afo.trimPoints.length < 2) return null;
        const pts = geodesicPolyline(
            working,
            afo.trimPoints.map((p) => p.vertexIndex),
            afo.trimClosed,
        );
        if (pts.length < 2) return null;
        const arr = new Float32Array(pts.length * 3);
        for (let i = 0; i < pts.length; i++) {
            const pt = pts[i];
            if (!pt) continue;
            arr[i * 3] = pt.x;
            arr[i * 3 + 1] = pt.y;
            arr[i * 3 + 2] = pt.z;
        }
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(arr, 3));
        const mat = new LineBasicMaterial({ color: 0x38bdf8 });
        return new ThreeLine(g, mat);
    }, [working, afo.trimPoints, afo.trimClosed]);

    useEffect(() => {
        return () => {
            castGeo?.dispose();
            shellGeo?.dispose();
            pickGeo?.dispose();
            trimLine?.geometry.dispose();
            (trimLine?.material as LineBasicMaterial | undefined)?.dispose();
        };
    }, [castGeo, shellGeo, pickGeo, trimLine]);

    const scanMatProps = placingScan
        ? { color: AFO_SCAN_GREY, roughness: 0.85, metalness: 0, transparent, opacity: transparent ? 0.45 : 1 }
        : {
              color: "#c4b5a0",
              roughness: 0.55,
              metalness: 0.05,
              transparent,
              opacity: transparent ? 0.45 : 1,
          };

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            {pickGeo ? (
                <mesh geometry={pickGeo} visible={false} userData={{ isAfoAlignPick: true }}>
                    <meshBasicMaterial />
                </mesh>
            ) : null}
            {showCast && castGeo ? (
                <mesh geometry={castGeo} userData={{ isAfoCast: true, isScanMesh: true }}>
                    <meshStandardMaterial side={DoubleSide} {...scanMatProps} />
                </mesh>
            ) : null}
            {shellGeo ? (
                <mesh geometry={shellGeo} userData={{ isAfoShell: true }}>
                    <meshStandardMaterial
                        color="#6ee7b7"
                        roughness={0.45}
                        metalness={0.05}
                        side={DoubleSide}
                    />
                </mesh>
            ) : null}
            {trimLine ? <primitive object={trimLine} /> : null}
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
            {afo.trimPoints.map((p, i) => (
                <mesh
                    key={`trim-${p.vertexIndex}-${p.point.x.toFixed(2)}-${p.point.y.toFixed(2)}-${p.point.z.toFixed(2)}`}
                    position={[p.point.x, p.point.y, p.point.z]}
                    userData={{ isAfoTrimHandle: true, trimIndex: i }}
                >
                    <sphereGeometry args={[2.8, 12, 10]} />
                    <meshStandardMaterial color={i === 0 ? "#22c55e" : "#38bdf8"} />
                </mesh>
            ))}
        </group>
    );
}
