// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { keyNearWhiteBackground } from "@/lib/pressure-map/content-bounds";
import type { PressureMapE2EApi, PressureMapOutsideCount } from "@/lib/pressure-map/e2e-bootstrap";
import { meshLocalTopOutline } from "@/lib/pressure-map/outline-clip";
import {
    countPixelsOutsideMask,
    dilateMask,
    rasterizeMeshSilhouette,
} from "@/lib/pressure-map/overlay-pixels";
import {
    footprintPointToCanvasPx,
    footprintRectForDesign,
    footprintRectFromInsoleMesh,
    insolePlantarFloorZ,
    type PressureMapContainFit,
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

interface ClipPose {
    centerFootprint: THREE.Vector2;
    scale: THREE.Vector2;
    rotationRad: number;
}

function useClippedPressureTextures(
    dataUrl: string | undefined,
    visible: boolean,
    mirror: boolean,
    minU: number,
    minV: number,
    maxU: number,
    maxV: number,
    outline: { x: number; y: number }[] | null,
    pose: ClipPose | null,
): { color: THREE.CanvasTexture; alpha: THREE.CanvasTexture } | null {
    const [maps, setMaps] = useState<{ color: THREE.CanvasTexture; alpha: THREE.CanvasTexture } | null>(null);
    const centerX = pose?.centerFootprint.x ?? 0;
    const centerY = pose?.centerFootprint.y ?? 0;
    const scaleX = pose?.scale.x ?? 1;
    const scaleY = pose?.scale.y ?? 1;
    const rotationRad = pose?.rotationRad ?? 0;
    const poseReady = pose != null;

    useEffect(() => {
        if (!visible || !dataUrl || !poseReady || !outline || outline.length < 3) {
            setMaps(null);
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
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) return;
            if (mirror) {
                ctx.translate(sw, 0);
                ctx.scale(-1, 1);
            }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
            const image = ctx.getImageData(0, 0, sw, sh);
            keyNearWhiteBackground(image.data);
            ctx.putImageData(image, 0, 0);

            const alphaCanvas = document.createElement("canvas");
            alphaCanvas.width = sw;
            alphaCanvas.height = sh;
            const actx = alphaCanvas.getContext("2d");
            if (!actx) return;
            actx.fillStyle = "#000";
            actx.fillRect(0, 0, sw, sh);
            actx.fillStyle = "#fff";
            actx.beginPath();
            for (let i = 0; i < outline.length; i++) {
                const p = outline[i];
                if (!p) continue;
                const px = footprintPointToCanvasPx(
                    p.x,
                    p.y,
                    {
                        centerFootprint: new THREE.Vector2(centerX, centerY),
                        planeScale: new THREE.Vector2(scaleX, scaleY),
                        rotationRad,
                    },
                    sw,
                    sh,
                );
                if (i === 0) actx.moveTo(px.x, px.y);
                else actx.lineTo(px.x, px.y);
            }
            actx.closePath();
            actx.fill();

            const color = new THREE.CanvasTexture(canvas);
            color.colorSpace = THREE.SRGBColorSpace;
            color.flipY = true;
            color.wrapS = THREE.ClampToEdgeWrapping;
            color.wrapT = THREE.ClampToEdgeWrapping;
            color.needsUpdate = true;
            const alpha = new THREE.CanvasTexture(alphaCanvas);
            alpha.colorSpace = THREE.NoColorSpace;
            alpha.flipY = true;
            alpha.wrapS = THREE.ClampToEdgeWrapping;
            alpha.wrapT = THREE.ClampToEdgeWrapping;
            alpha.needsUpdate = true;
            setMaps({ color, alpha });
        };
        img.src = dataUrl;
        return () => {
            cancelled = true;
        };
    }, [
        dataUrl,
        visible,
        mirror,
        minU,
        minV,
        maxU,
        maxV,
        outline,
        poseReady,
        centerX,
        centerY,
        scaleX,
        scaleY,
        rotationRad,
    ]);

    useEffect(
        () => () => {
            maps?.color.dispose();
            maps?.alpha.dispose();
        },
        [maps],
    );
    return maps;
}

function PressureMapPlane({ side }: PressureMapOverlayProps) {
    const foot = useDesignStore((s) => s.design.pressureMaps?.[side]);
    const design = useDesignStore((s) => s.design);
    const scene = useThree((s) => s.scene);
    const [host, setHost] = useState<LiveHost | null>(null);
    const [outline, setOutline] = useState<{ x: number; y: number }[] | null>(null);
    const outlineGeo = useRef("");

    useEffect(() => {
        let frame = 0;
        let stop = false;
        const tick = () => {
            if (stop) return;
            const mesh = scene.getObjectByName(`insole-${side}`);
            if (mesh instanceof THREE.Mesh) {
                const liveDesign = useDesignStore.getState().design;
                const rect = footprintRectFromInsoleMesh(mesh, liveDesign, side);
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
                if (mesh.geometry?.uuid && mesh.geometry.uuid !== outlineGeo.current) {
                    const local = meshLocalTopOutline(mesh.geometry);
                    if (local.length >= 8) {
                        const layout = insoleLayoutFromDesign(liveDesign);
                        const offsetX = sideOffsetX(side, layout.widthMm);
                        const points = local.map((p) => ({
                            x: mesh.position.x + p.x + layout.lengthMm / 2,
                            y: mesh.position.y + p.y - offsetX,
                        }));
                        outlineGeo.current = mesh.geometry.uuid;
                        setOutline(points);
                    }
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

    const maps = useClippedPressureTextures(
        foot?.imageDataUrl,
        Boolean(foot?.visible && host && outline),
        mirror,
        foot?.contentBounds.minU ?? 0,
        foot?.contentBounds.minV ?? 0,
        foot?.contentBounds.maxU ?? 1,
        foot?.contentBounds.maxV ?? 1,
        outline,
        pose
            ? { centerFootprint: pose.centerFootprint, scale: pose.scale, rotationRad: pose.rotationRad }
            : null,
    );

    if (!foot?.visible || !maps || !pose || !host) return null;

    return (
        <mesh
            name={`pressure-map-${side}`}
            position={pose.position}
            rotation={pose.rotation}
            scale={[pose.scale.x, pose.scale.y, 1]}
            renderOrder={1}
            raycast={() => {}}
            userData={{ containFit: pose.containFit }}
        >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
                map={maps.color}
                alphaMap={maps.alpha}
                alphaTest={0.5}
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

function darkestCorner(rgba: Uint8Array, width: number, height: number): { r: number; g: number; b: number } {
    const samples = [
        [2, 2],
        [width - 3, 2],
        [2, height - 3],
        [width - 3, height - 3],
    ];
    let best = { r: 0, g: 0, b: 0, lum: Number.POSITIVE_INFINITY };
    for (const pair of samples) {
        const x = pair[0] ?? 0;
        const y = pair[1] ?? 0;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = (y * width + x) * 4;
        const r = rgba[i] ?? 0;
        const g = rgba[i + 1] ?? 0;
        const b = rgba[i + 2] ?? 0;
        const lum = r + g + b;
        if (lum < best.lum) best = { r, g, b, lum };
    }
    return best;
}

function readOverlayPixelsOutside(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
): PressureMapOutsideCount {
    const width = renderer.domElement.width;
    const height = renderer.domElement.height;
    if (width < 4 || height < 4) {
        return { outside: -1, insideVarying: 0, fringe: 0, spill: { r: 0, g: 0, b: 0 }, width, height };
    }
    const gl = renderer.getContext();
    const rgba = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    const mask = new Uint8Array(width * height);
    for (const side of ["left", "right"] as const) {
        const mesh = scene.getObjectByName(`insole-${side}`);
        if (mesh instanceof THREE.Mesh) rasterizeMeshSilhouette(mesh, camera, width, height, mask);
    }
    const dilated = dilateMask(mask, width, height, 2);
    const counted = countPixelsOutsideMask(
        rgba,
        dilated,
        width,
        height,
        darkestCorner(rgba, width, height),
        22,
    );
    return { ...counted, width, height };
}

function usePressureMapE2EProbe() {
    const scene = useThree((s) => s.scene);
    const invalidate = useThree((s) => s.invalidate);
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
                    containFit: (map.userData.containFit as PressureMapContainFit | undefined) ?? null,
                };
            }
            return { feet };
        };
        api.countOverlayPixelsOutsideOutline = () =>
            new Promise((resolve) => {
                const prev = scene.onAfterRender;
                let settled = false;
                const finish = (value: PressureMapOutsideCount) => {
                    if (settled) return;
                    settled = true;
                    scene.onAfterRender = prev;
                    resolve(value);
                };
                scene.onAfterRender = function (
                    this: THREE.Object3D,
                    renderer,
                    renderedScene,
                    renderedCamera,
                ) {
                    prev.call(
                        this,
                        renderer,
                        renderedScene,
                        renderedCamera,
                        null as never,
                        null as never,
                        null as never,
                    );
                    try {
                        finish(
                            readOverlayPixelsOutside(
                                renderer as THREE.WebGLRenderer,
                                renderedScene as THREE.Scene,
                                renderedCamera as THREE.Camera,
                            ),
                        );
                    } catch {
                        finish({
                            outside: -1,
                            insideVarying: 0,
                            fringe: 0,
                            spill: { r: 0, g: 0, b: 0 },
                            width: 0,
                            height: 0,
                        });
                    }
                };
                invalidate();
            });
        return () => {
            if (api.meshesReady) api.meshesReady = () => false;
            if (api.measure) api.measure = () => null;
            api.countOverlayPixelsOutsideOutline = undefined;
        };
    }, [scene, invalidate]);
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
