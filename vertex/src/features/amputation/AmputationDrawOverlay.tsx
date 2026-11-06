// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";
import {
    AMPUTATION_CUT_COLOR,
    AMPUTATION_CUT_HALO,
    amputationPointFromMesh,
    type FootBounds,
    layoutFootBounds,
    strokeLocals,
} from "./amputation-draw";
import { type DrawPoint, useAmputationDrawStore } from "./amputation-draw-store";

/**
 * Cut the user is placing, on the top sheet.
 * No default line. Trimline and bottom-pattern overlays stay unmounted while this is up.
 */
export function AmputationDrawOverlay() {
    const side = useAmputationDrawStore((s) => s.side);
    const points = useAmputationDrawStore((s) => s.points);
    if (!side) return null;
    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <AmputationDrawSide side={side} points={points} />
        </group>
    );
}

function AmputationDrawSide({ side, points }: { side: Side; points: DrawPoint[] }) {
    const design = useDesignStore((s) => s.design);
    const layout = insoleLayoutFromDesign(design);
    const place = useAmputationDrawStore((s) => s.place);
    const { scene } = useThree();
    const groupRef = useRef<THREE.Group>(null);
    const downRef = useRef<{ x: number; y: number } | null>(null);
    const [live, setLive] = useState<{ geo: THREE.BufferGeometry; bounds: FootBounds } | null>(null);
    const geoSeen = useRef<THREE.BufferGeometry | null>(null);

    useFrame(() => {
        const mesh = scene.getObjectByName(`insole-${side}`);
        if (!mesh || !(mesh as THREE.Mesh).isMesh) return;
        const geo = (mesh as THREE.Mesh).geometry;
        if (!geo || geo === geoSeen.current) return;
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (!bb) return;
        geoSeen.current = geo;
        setLive({
            geo,
            bounds: {
                minX: bb.min.x,
                maxX: bb.max.x,
                minY: bb.min.y,
                maxY: bb.max.y,
                minZ: bb.min.z,
                maxZ: bb.max.z,
            },
        });
    });

    const bounds = live?.bounds ?? layoutFootBounds(layout.lengthMm, layout.widthMm);
    const boundsRef = useRef(bounds);
    boundsRef.current = bounds;

    const display = useMemo(() => {
        const z = bounds.maxZ + 1.8;
        return strokeLocals(points, side, layout.lengthMm, layout.widthMm, bounds).map(
            (p) => new THREE.Vector3(p.x, p.y, z),
        );
    }, [points, side, layout.lengthMm, layout.widthMm, bounds]);

    const placeHit = (event: ThreeEvent<PointerEvent>) => {
        const group = groupRef.current;
        if (!group) return;
        group.updateWorldMatrix(true, false);
        const local = group.worldToLocal(event.point.clone());
        const hit = amputationPointFromMesh(
            local.x,
            local.y,
            side,
            layout.lengthMm,
            layout.widthMm,
            boundsRef.current,
        );
        place({ x: hit.x, y: hit.y, localX: local.x, localY: local.y });
    };

    const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        downRef.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
    };

    const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        const start = downRef.current;
        downRef.current = null;
        if (!start) return;
        const dx = event.nativeEvent.clientX - start.x;
        const dy = event.nativeEvent.clientY - start.y;
        if (dx * dx + dy * dy > 16) return;
        placeHit(event);
    };

    const centerX = layout.lengthMm / 2;
    const offsetY = sideOffsetX(side, layout.widthMm);
    const pickZ = bounds.maxZ + 0.8;

    return (
        <group ref={groupRef} position={[-centerX, offsetY, 0]}>
            {live?.geo ? (
                <mesh
                    geometry={live.geo}
                    position={[0, 0, 0.8]}
                    renderOrder={180}
                    onPointerDown={onPointerDown}
                    onPointerUp={onPointerUp}
                >
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            ) : (
                <mesh
                    position={[(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, pickZ]}
                    renderOrder={180}
                    onPointerDown={onPointerDown}
                    onPointerUp={onPointerUp}
                >
                    <planeGeometry
                        args={[
                            Math.max(1, bounds.maxX - bounds.minX),
                            Math.max(1, bounds.maxY - bounds.minY),
                        ]}
                    />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            )}
            {display.length > 1 ? (
                <>
                    <StrokeTubes pts={display} radius={3.1} color={AMPUTATION_CUT_HALO} order={210} />
                    <StrokeTubes pts={display} radius={1.7} color={AMPUTATION_CUT_COLOR} order={211} />
                </>
            ) : null}
            {display.map((p, i) => (
                <mesh key={points[i]?.id ?? `cut-${i}`} position={p} renderOrder={212} frustumCulled={false}>
                    <sphereGeometry args={[3.2, 12, 12]} />
                    <meshBasicMaterial
                        color={AMPUTATION_CUT_COLOR}
                        depthTest={false}
                        depthWrite={false}
                        toneMapped={false}
                    />
                </mesh>
            ))}
        </group>
    );
}

function StrokeTubes({
    pts,
    radius,
    color,
    order,
}: {
    pts: THREE.Vector3[];
    radius: number;
    color: string;
    order: number;
}) {
    const geo = useMemo(() => {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            if (!a || !b || a.distanceTo(b) < 0.15) continue;
            parts.push(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, radius, 8, false));
        }
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0] ?? null;
        const merged = mergeTubes(parts);
        for (const part of parts) part.dispose();
        return merged;
    }, [pts, radius]);
    useEffect(() => () => geo?.dispose(), [geo]);
    if (!geo) return null;
    return (
        <mesh geometry={geo} renderOrder={order} frustumCulled={false}>
            <meshBasicMaterial color={color} depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
    );
}

function mergeTubes(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    let posCount = 0;
    let idxCount = 0;
    for (const part of parts) {
        posCount += part.getAttribute("position").count;
        const index = part.getIndex();
        idxCount += index ? index.count : part.getAttribute("position").count;
    }
    const position = new Float32Array(posCount * 3);
    const index = new Uint32Array(idxCount);
    let posCursor = 0;
    let idxCursor = 0;
    let vertexBase = 0;
    for (const part of parts) {
        const src = part.getAttribute("position");
        for (let i = 0; i < src.count; i++) {
            position[posCursor++] = src.getX(i);
            position[posCursor++] = src.getY(i);
            position[posCursor++] = src.getZ(i);
        }
        const srcIndex = part.getIndex();
        if (srcIndex) {
            for (let i = 0; i < srcIndex.count; i++) index[idxCursor++] = srcIndex.getX(i) + vertexBase;
        } else {
            for (let i = 0; i < src.count; i++) index[idxCursor++] = vertexBase + i;
        }
        vertexBase += src.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    return geo;
}
