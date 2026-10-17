// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { transformOutline } from "@/lib/cnc/placement";
import type { MillingProfile, PlacedPart, Point } from "@/lib/cnc/types";
import type { Side } from "@/types";

function partFill(invalid: boolean, selected: boolean): string {
    if (invalid) return "#ef4444";
    if (selected) return "#4ade80";
    return "#d4d4d8";
}

function outlineShape(pts: Point[]): THREE.Shape | null {
    if (pts.length < 3) return null;
    const first = pts[0];
    if (!first) return null;
    const shape = new THREE.Shape();
    shape.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        if (!p) continue;
        shape.lineTo(p.x, p.y);
    }
    shape.closePath();
    return shape;
}

function ZUpCamera({ tx, ty, tz }: { tx: number; ty: number; tz: number }) {
    const { camera } = useThree();
    useLayoutEffect(() => {
        camera.up.set(0, 0, 1);
        camera.lookAt(tx, ty, tz);
        camera.updateProjectionMatrix();
    }, [camera, tx, ty, tz]);
    return null;
}

function TableBlock({
    width,
    length,
    height,
    pockets,
}: {
    width: number;
    length: number;
    height: number;
    pockets: MillingProfile["pockets"];
}) {
    const pocketLines = useMemo(
        () =>
            pockets.map((pk) => ({
                key: `pk-${pk.x}-${pk.y}-${pk.width}-${pk.length}`,
                points: [
                    new THREE.Vector3(pk.x, pk.y, height + 0.2),
                    new THREE.Vector3(pk.x + pk.width, pk.y, height + 0.2),
                    new THREE.Vector3(pk.x + pk.width, pk.y + pk.length, height + 0.2),
                    new THREE.Vector3(pk.x, pk.y + pk.length, height + 0.2),
                    new THREE.Vector3(pk.x, pk.y, height + 0.2),
                ],
            })),
        [pockets, height],
    );
    return (
        <group>
            <mesh position={[width / 2, length / 2, height / 2]} receiveShadow>
                <boxGeometry args={[width, length, height]} />
                <meshStandardMaterial color="#3f3f46" />
            </mesh>
            <mesh position={[width / 2, length / 2, height + 0.05]}>
                <boxGeometry args={[width, length, 0.1]} />
                <meshStandardMaterial color="#52525b" />
            </mesh>
            {pocketLines.map((pk) => (
                <Line key={pk.key} points={pk.points} color="#d4d4d8" lineWidth={1.5} />
            ))}
        </group>
    );
}

function InsoleMesh3D({
    part,
    height,
    selected,
    invalid,
    onSelect,
}: {
    part: PlacedPart;
    height: number;
    selected: boolean;
    invalid: boolean;
    onSelect: (side: Side) => void;
}) {
    const world = useMemo(() => transformOutline(part.outline, part), [part]);
    const geometry = useMemo(() => {
        const shape = outlineShape(world);
        if (!shape) return null;
        const thickness = Math.max(4, Math.min(height - 2, part.zMax));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 });
        geo.translate(0, 0, height - thickness);
        return geo;
    }, [world, height, part.zMax]);
    if (!geometry) return null;
    const color = partFill(invalid, selected);
    return (
        <mesh
            geometry={geometry}
            castShadow
            onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(part.side);
            }}
        >
            <meshStandardMaterial color={color} metalness={0.05} roughness={0.55} />
        </mesh>
    );
}

export function MillOrbitCanvas({
    profile,
    placed,
    issues,
    millSelected,
    onSelect,
}: {
    profile: MillingProfile;
    placed: PlacedPart[];
    issues: Record<string, { ok: boolean }>;
    millSelected: Side | null;
    onSelect: (side: Side | null) => void;
}) {
    const tw = profile.tableWidthMm;
    const tl = profile.tableLengthMm;
    const h = profile.materialHeightMm;
    const cx = tw / 2;
    const cy = tl / 2;
    const cz = h / 2;
    return (
        <Canvas
            className="h-full w-full touch-none"
            style={{ touchAction: "none" }}
            shadows
            dpr={[1, 1.5]}
            gl={{ antialias: true, alpha: false }}
            camera={{
                position: [cx + tw * 0.55, cy - tl * 1.05, h * 11],
                fov: 40,
                near: 0.5,
                far: 8000,
                up: [0, 0, 1],
            }}
            onCreated={({ camera, gl }) => {
                camera.up.set(0, 0, 1);
                camera.lookAt(cx, cy, 0);
                gl.domElement.style.touchAction = "none";
            }}
            onPointerMissed={() => onSelect(null)}
        >
            <color attach="background" args={["#0f1522"]} />
            <ZUpCamera tx={cx} ty={cy} tz={0} />
            <ambientLight intensity={0.7} />
            <directionalLight position={[tw, -tl, h * 8]} intensity={1.15} castShadow />
            <directionalLight position={[-tw, tl, h * 4]} intensity={0.35} />
            <TableBlock width={tw} length={tl} height={h} pockets={profile.pockets} />
            {placed.map((part) => (
                <InsoleMesh3D
                    key={part.side}
                    part={part}
                    height={h}
                    selected={millSelected === part.side}
                    invalid={issues[part.side]?.ok === false}
                    onSelect={onSelect}
                />
            ))}
            <OrbitControls
                makeDefault
                enableDamping
                dampingFactor={0.12}
                enablePan
                enableRotate
                enableZoom
                enabled
                target={[cx, cy, cz]}
                minDistance={40}
                maxDistance={2500}
                zoomToCursor
                mouseButtons={{
                    LEFT: THREE.MOUSE.ROTATE,
                    MIDDLE: THREE.MOUSE.DOLLY,
                    RIGHT: THREE.MOUSE.PAN,
                }}
                touches={{
                    ONE: THREE.TOUCH.ROTATE,
                    TWO: THREE.TOUCH.DOLLY_PAN,
                }}
            />
        </Canvas>
    );
}
