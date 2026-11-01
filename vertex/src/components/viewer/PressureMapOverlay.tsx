// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { PressureMapE2EApi } from "@/lib/pressure-map/e2e-bootstrap";
import {
    footprintRectForDesign,
    footprintRectFromInsoleMesh,
    insolePlantarFloorZ,
    pressureMapGeometryPoint,
    pressureMapMeshPose,
} from "@/lib/pressure-map/placement";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

interface PressureMapOverlayProps {
    side: Side;
}

interface LiveHost {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    floorZ: number;
}

function hostsClose(a: LiveHost | null, b: LiveHost): boolean {
    if (!a) return false;
    const eps = 0.35;
    return (
        Math.abs(a.minX - b.minX) < eps &&
        Math.abs(a.maxX - b.maxX) < eps &&
        Math.abs(a.minY - b.minY) < eps &&
        Math.abs(a.maxY - b.maxY) < eps &&
        Math.abs(a.floorZ - b.floorZ) < eps
    );
}

function useOrientedPressureTexture(
    dataUrl: string | undefined,
    visible: boolean,
    mirror: boolean,
    minU: number,
    minV: number,
    maxU: number,
    maxV: number,
): THREE.Texture | null {
    const [texture, setTexture] = useState<THREE.Texture | null>(null);

    useEffect(() => {
        if (!visible || !dataUrl) {
            setTexture(null);
            return;
        }
        let cancelled = false;
        const img = new Image();
        img.onload = () => {
            if (cancelled) return;
            const sx = Math.max(0, Math.floor(minU * img.naturalWidth));
            const sy = Math.max(0, Math.floor(minV * img.naturalHeight));
            const sw = Math.max(
                1,
                Math.min(img.naturalWidth - sx, Math.ceil((maxU - minU) * img.naturalWidth)),
            );
            const sh = Math.max(
                1,
                Math.min(img.naturalHeight - sy, Math.ceil((maxV - minV) * img.naturalHeight)),
            );
            const canvas = document.createElement("canvas");
            canvas.width = sw;
            canvas.height = sh;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            if (mirror) {
                ctx.translate(sw, 0);
                ctx.scale(-1, 1);
            }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
            const next = new THREE.CanvasTexture(canvas);
            next.colorSpace = THREE.SRGBColorSpace;
            next.flipY = true;
            next.wrapS = THREE.ClampToEdgeWrapping;
            next.wrapT = THREE.ClampToEdgeWrapping;
            next.needsUpdate = true;
            setTexture(next);
        };
        img.src = dataUrl;
        return () => {
            cancelled = true;
        };
    }, [dataUrl, visible, mirror, minU, minV, maxU, maxV]);

    useEffect(() => () => texture?.dispose(), [texture]);
    return texture;
}

function PressureMapPlane({ side }: PressureMapOverlayProps) {
    const foot = useDesignStore((s) => s.design.pressureMaps?.[side]);
    const design = useDesignStore((s) => s.design);
    const scene = useThree((s) => s.scene);
    const [host, setHost] = useState<LiveHost | null>(null);

    useEffect(() => {
        let frame = 0;
        let stop = false;
        const tick = () => {
            if (stop) return;
            const mesh = scene.getObjectByName(`insole-${side}`);
            if (mesh instanceof THREE.Mesh) {
                const rect = footprintRectFromInsoleMesh(mesh, useDesignStore.getState().design, side);
                if (rect) {
                    const next: LiveHost = {
                        minX: rect.minX,
                        maxX: rect.maxX,
                        minY: rect.minY,
                        maxY: rect.maxY,
                        floorZ: insolePlantarFloorZ(mesh),
                    };
                    setHost((prev) => (hostsClose(prev, next) ? prev : next));
                }
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => {
            stop = true;
            cancelAnimationFrame(frame);
        };
    }, [scene, side]);

    const mirror = Boolean(foot?.orientation?.oppositeFootMirror);
    const texture = useOrientedPressureTexture(
        foot?.imageDataUrl,
        Boolean(foot?.visible),
        mirror,
        foot?.contentBounds.minU ?? 0,
        foot?.contentBounds.minV ?? 0,
        foot?.contentBounds.maxU ?? 1,
        foot?.contentBounds.maxV ?? 1,
    );

    const pose = useMemo(() => {
        if (!foot) return null;
        const footprint = host
            ? {
                  minX: host.minX,
                  maxX: host.maxX,
                  minY: host.minY,
                  maxY: host.maxY,
                  centerX: (host.minX + host.maxX) / 2,
                  centerY: (host.minY + host.maxY) / 2,
                  lengthMm: host.maxX - host.minX,
                  widthMm: host.maxY - host.minY,
              }
            : footprintRectForDesign(design, side);
        return pressureMapMeshPose(design, side, foot, footprint, host?.floorZ);
    }, [design, foot, side, host]);

    if (!foot?.visible || !texture || !pose) return null;

    return (
        <mesh
            name={`pressure-map-${side}`}
            position={pose.position}
            rotation={pose.rotation}
            scale={[pose.scale.x, pose.scale.y, 1]}
            renderOrder={1}
            raycast={() => {}}
        >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
                map={texture}
                side={THREE.DoubleSide}
                depthTest
                depthWrite
                polygonOffset
                polygonOffsetFactor={-1}
                polygonOffsetUnits={-1}
                toneMapped={false}
            />
        </mesh>
    );
}

/** Flat plantar pressure image beneath the insole (visualization only). */
export function PressureMapOverlay({ side }: PressureMapOverlayProps) {
    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <PressureMapPlane side={side} />
        </group>
    );
}

function aabbOf(obj: THREE.Object3D): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
} {
    const box = new THREE.Box3().setFromObject(obj);
    return {
        minX: box.min.x,
        maxX: box.max.x,
        minY: box.min.y,
        maxY: box.max.y,
        minZ: box.min.z,
        maxZ: box.max.z,
    };
}

function usePressureMapE2EProbe() {
    const scene = useThree((s) => s.scene);
    useEffect(() => {
        const api = (window as unknown as { __orthocadPressureMapE2E?: PressureMapE2EApi })
            .__orthocadPressureMapE2E;
        if (!api) return;
        api.meshesReady = () => {
            if (document.querySelector('[data-testid="initial-load-splash"]')) return false;
            for (const side of ["left", "right"] as const) {
                const insole = scene.getObjectByName(`insole-${side}`);
                const map = scene.getObjectByName(`pressure-map-${side}`);
                if (!(insole instanceof THREE.Mesh) || !(map instanceof THREE.Mesh)) return false;
                const count = insole.geometry?.getAttribute("position")?.count ?? 0;
                if (count < 1000) return false;
            }
            return true;
        };
        api.measure = (hallux) => {
            const design = useDesignStore.getState().design;
            const feet = {} as NonNullable<ReturnType<PressureMapE2EApi["measure"]>>["feet"];
            for (const side of ["left", "right"] as const) {
                const insole = scene.getObjectByName(`insole-${side}`);
                const map = scene.getObjectByName(`pressure-map-${side}`);
                const foot = design.pressureMaps?.[side];
                if (!(insole instanceof THREE.Mesh) || !(map instanceof THREE.Mesh) || !foot) return null;
                insole.updateWorldMatrix(true, true);
                map.updateWorldMatrix(true, true);
                const uv = hallux[side];
                const local = pressureMapGeometryPoint(uv.u, uv.v, foot);
                const world = map.localToWorld(local);
                const insoleBox = aabbOf(insole);
                feet[side] = {
                    plane: aabbOf(map),
                    insole: insoleBox,
                    halluxWorld: { x: world.x, y: world.y, z: world.z },
                    insoleCenter: {
                        x: (insoleBox.minX + insoleBox.maxX) / 2,
                        y: (insoleBox.minY + insoleBox.maxY) / 2,
                        z: (insoleBox.minZ + insoleBox.maxZ) / 2,
                    },
                    medialSign: side === "left" ? -1 : 1,
                };
            }
            return { feet };
        };
        return () => {
            if (api.meshesReady) api.meshesReady = () => false;
            if (api.measure) api.measure = () => null;
        };
    }, [scene]);
}

export function PressureMapOverlayPair({ showLeft, showRight }: { showLeft: boolean; showRight: boolean }) {
    usePressureMapE2EProbe();
    return (
        <>
            {showLeft ? <PressureMapOverlay side="left" /> : null}
            {showRight ? <PressureMapOverlay side="right" /> : null}
        </>
    );
}
