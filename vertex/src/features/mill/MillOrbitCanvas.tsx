// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { ballBandGeometry } from "@/lib/cnc/band";
import { toolRadiusMm } from "@/lib/cnc/profile";
import type { MillingProfile, PlacedPart, Point } from "@/lib/cnc/types";
import type { Side } from "@/types";

function noRaycast() {
    return null;
}

function bandShape(outer: Point[], hole: Point[]): THREE.ShapeGeometry | null {
    if (outer.length < 3) return null;
    const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, p.y)));
    if (hole.length >= 3)
        shape.holes.push(
            new THREE.Path(
                hole
                    .slice()
                    .reverse()
                    .map((p) => new THREE.Vector2(p.x, p.y)),
            ),
        );
    return new THREE.ShapeGeometry(shape);
}

function BandFill({
    geometry,
    z,
    color,
    opacity,
}: {
    geometry: THREE.ShapeGeometry | null;
    z: number;
    color: string;
    opacity: number;
}) {
    if (!geometry) return null;
    return (
        <mesh geometry={geometry} position={[0, 0, z]} renderOrder={4} raycast={noRaycast}>
            <meshBasicMaterial
                color={color}
                transparent
                opacity={opacity}
                depthWrite={false}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
}

/** Slot band on the stock top plane. Same geometry the G-code contour follows. */
function StockTopBand({
    part,
    profile,
    height,
}: {
    part: PlacedPart;
    profile: MillingProfile;
    height: number;
}) {
    const band = useMemo(
        () =>
            ballBandGeometry(
                part.outline,
                toolRadiusMm(profile.contourCutter.diameterMm),
                profile.chordTolMm,
                profile.topOffsetMm,
            ),
        [part.outline, profile],
    );
    const dark = useMemo(() => bandShape(band.outerEdge, band.innerEdge), [band]);
    const light = useMemo(() => bandShape(band.overrunEdge, band.knifeLine), [band]);
    const zBand = height + 0.35;
    const zLine = height + 0.7;
    const centre = useMemo(
        () => band.centreline.map((p) => new THREE.Vector3(p.x, p.y, zLine)),
        [band, zLine],
    );
    const knife = useMemo(() => loopLine(band.knifeLine, zLine + 0.05), [band, zLine]);
    const heel = useMemo(() => {
        let p = band.knifeLine[0] ?? { x: 0, y: 0 };
        for (const q of band.knifeLine) if (q.x < p.x) p = q;
        return p;
    }, [band]);
    const rotationRad = (part.rotationDeg * Math.PI) / 180;
    return (
        <group position={[part.tx, part.ty, 0]}>
            <group position={[part.cx, part.cy, 0]} rotation={[0, 0, rotationRad]}>
                <group position={[-part.cx, -part.cy, 0]}>
                    <BandFill geometry={dark} z={zBand} color="#0f172a" opacity={0.82} />
                    <BandFill geometry={light} z={zBand + 0.12} color="#e7e5e4" opacity={0.78} />
                    {centre.length > 1 ? (
                        <Line
                            points={centre}
                            color="#38bdf8"
                            dashed
                            dashSize={1.6}
                            gapSize={1}
                            lineWidth={1}
                        />
                    ) : null}
                    {knife.length > 1 ? <Line points={knife} color="#f8fafc" lineWidth={1.5} /> : null}
                    {band.uncutCorners.map((corner) => (
                        <Line
                            key={`uncut-${part.side}-${corner.deviationMm.toFixed(3)}-${corner.points[0]?.x.toFixed(2)}`}
                            points={loopLine(corner.points, zLine + 0.1)}
                            color="#fbbf24"
                            lineWidth={2}
                        />
                    ))}
                    <Html
                        position={[heel.x, heel.y, zLine + 0.4]}
                        center
                        zIndexRange={[8, 0]}
                        style={{ pointerEvents: "none" }}
                    >
                        <div className="whitespace-nowrap rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">
                            knife line
                        </div>
                    </Html>
                    {band.uncutCorners[0] ? (
                        <Html
                            position={[
                                band.uncutCorners[0].points[0]?.x ?? heel.x,
                                band.uncutCorners[0].points[0]?.y ?? heel.y,
                                zLine + 0.5,
                            ]}
                            center
                            zIndexRange={[8, 0]}
                            style={{ pointerEvents: "none" }}
                        >
                            <div className="whitespace-nowrap rounded bg-amber-500/90 px-1 py-0.5 text-[10px] text-black">
                                uncut corner
                            </div>
                        </Html>
                    ) : null}
                </group>
            </group>
        </group>
    );
}

function loopLine(pts: Point[], z: number): THREE.Vector3[] {
    if (pts.length < 2) return [];
    const line = pts.map((p) => new THREE.Vector3(p.x, p.y, z));
    const first = pts[0];
    if (first) line.push(new THREE.Vector3(first.x, first.y, z));
    return line;
}

function partFill(invalid: boolean, selected: boolean): string {
    if (invalid) return "#ef4444";
    if (selected) return "#4ade80";
    return "#d4d4d8";
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
    const boxGeo = useMemo(() => new THREE.BoxGeometry(width, length, height), [width, length, height]);
    const edgesGeo = useMemo(() => new THREE.EdgesGeometry(boxGeo), [boxGeo]);
    useEffect(
        () => () => {
            boxGeo.dispose();
            edgesGeo.dispose();
        },
        [boxGeo, edgesGeo],
    );
    const pocketLines = useMemo(
        () =>
            pockets.map((pk) => ({
                key: `pk-${pk.x}-${pk.y}-${pk.width}-${pk.length}`,
                points: [
                    new THREE.Vector3(pk.x, pk.y, height + 0.15),
                    new THREE.Vector3(pk.x + pk.width, pk.y, height + 0.15),
                    new THREE.Vector3(pk.x + pk.width, pk.y + pk.length, height + 0.15),
                    new THREE.Vector3(pk.x, pk.y + pk.length, height + 0.15),
                    new THREE.Vector3(pk.x, pk.y, height + 0.15),
                ],
            })),
        [pockets, height],
    );
    return (
        <group>
            <mesh position={[width / 2, length / 2, height / 2]} geometry={boxGeo} renderOrder={0}>
                <meshStandardMaterial
                    color="#94a3b8"
                    transparent
                    opacity={0.22}
                    depthWrite={false}
                    metalness={0.04}
                    roughness={0.9}
                    side={THREE.FrontSide}
                />
            </mesh>
            <lineSegments position={[width / 2, length / 2, height / 2]} geometry={edgesGeo} renderOrder={2}>
                <lineBasicMaterial color="#e4e4e7" />
            </lineSegments>
            {pocketLines.map((pk) => (
                <Line key={pk.key} points={pk.points} color="#e4e4e7" lineWidth={1.5} />
            ))}
        </group>
    );
}

/**
 * Same placement as the 2D top view: T(tx,ty) · T(cx,cy) · Rz(rotationDeg) · T(-cx,-cy).
 * Mesh local XY is mill plan; Z is thickness so arch/heel sit inside the stock block.
 */
function InsoleMesh3D({
    part,
    selected,
    invalid,
    onSelect,
}: {
    part: PlacedPart;
    selected: boolean;
    invalid: boolean;
    onSelect: (side: Side) => void;
}) {
    const geometry = part.mesh;
    const rotationRad = (part.rotationDeg * Math.PI) / 180;
    const color = partFill(invalid, selected);
    if (!geometry) return null;
    return (
        <group position={[part.tx, part.ty, 0]}>
            <group position={[part.cx, part.cy, 0]} rotation={[0, 0, rotationRad]}>
                <group position={[-part.cx, -part.cy, 0]}>
                    <mesh
                        geometry={geometry}
                        castShadow
                        renderOrder={1}
                        onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelect(part.side);
                        }}
                    >
                        <meshStandardMaterial
                            color={color}
                            emissive={color}
                            emissiveIntensity={selected ? 0.28 : 0.12}
                            metalness={0.04}
                            roughness={0.55}
                            side={THREE.DoubleSide}
                            polygonOffset
                            polygonOffsetFactor={1}
                            polygonOffsetUnits={1}
                        />
                    </mesh>
                </group>
            </group>
        </group>
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
                position: [cx + tw * 0.55, cy - tl * 0.95, h * 8],
                fov: 40,
                near: 0.5,
                far: 8000,
                up: [0, 0, 1],
            }}
            onCreated={({ camera, gl }) => {
                camera.up.set(0, 0, 1);
                camera.lookAt(cx, cy, cz);
                gl.domElement.style.touchAction = "none";
            }}
            onPointerMissed={() => onSelect(null)}
        >
            <color attach="background" args={["#0f1522"]} />
            <ZUpCamera tx={cx} ty={cy} tz={cz} />
            <ambientLight intensity={0.7} />
            <hemisphereLight args={["#f8fafc", "#1e293b", 0.55]} />
            <directionalLight position={[tw * 0.9, cy, h * 1.4]} intensity={1.15} />
            <directionalLight position={[cx, -tl * 0.4, h * 6]} intensity={0.85} />
            <directionalLight position={[-tw * 0.3, tl, h * 3]} intensity={0.45} />
            <TableBlock width={tw} length={tl} height={h} pockets={profile.pockets} />
            {placed.map((part) => (
                <InsoleMesh3D
                    key={part.side}
                    part={part}
                    selected={millSelected === part.side}
                    invalid={issues[part.side]?.ok === false}
                    onSelect={onSelect}
                />
            ))}
            {placed.map((part) => (
                <StockTopBand key={`band-${part.side}`} part={part} profile={profile} height={h} />
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
                minPolarAngle={0.08}
                maxPolarAngle={Math.PI / 2 - 0.04}
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
