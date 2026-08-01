// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useCallback } from "react";
import * as THREE from "three";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { sideOffsetX } from "@/lib/geometry/layout";
import { nearestVertexIndex } from "@/lib/geometry/mesh-edit";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { Side } from "@/types";

/** Interactive trim-line and vertex editing overlays in the 3D viewer. */
export function MeshEditTools() {
    const editMode = useMeshEditStore((s) => s.editMode);
    const target = useMeshEditStore((s) => s.target);
    const activeTrimPoints = useMeshEditStore((s) => s.activeTrimPoints);
    const trimLines = useMeshEditStore((s) => s.trimLines);
    const vertexOverrides = useMeshEditStore((s) => s.vertexOverrides);
    const selectedVertex = useMeshEditStore((s) => s.selectedVertex);
    const design = useDesignStore((s) => s.design);
    const layout = insoleLayoutFromDesign(design);
    const centerX = layout.lengthMm / 2;

    if (editMode === "transform" || editMode === "edit-trimline" || !target) return null;

    const side: Side =
        target.type === "insole"
            ? target.side
            : target.type === "element"
              ? (design.elements.find((e) => e.id === target.id)?.side ?? "left")
              : "left";

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <group position={[-centerX, sideOffsetX(side, layout.widthMm), 0]}>
                <InsoleEditSurface side={side} editMode={editMode} centerX={centerX} />
                {trimLines.map((line) => (
                    <TrimLineVisual key={line.id} points={line.points} color="#f59e0b" centerX={centerX} />
                ))}
                {activeTrimPoints.length > 0 ? (
                    <TrimLineVisual points={activeTrimPoints} color="#fde68a" dashed centerX={centerX} />
                ) : null}
                {editMode === "vertex"
                    ? [...vertexOverrides.entries()].map(([idx, pos]) => (
                          <mesh key={idx} position={[pos.x + centerX, pos.y, pos.z + 2]}>
                              <sphereGeometry args={[1.2, 8, 8]} />
                              <meshBasicMaterial color="#22c55e" />
                          </mesh>
                      ))
                    : null}
                {selectedVertex !== null ? (
                    <VertexHandle side={side} vertexIndex={selectedVertex} centerX={centerX} />
                ) : null}
            </group>
        </group>
    );
}

function InsoleEditSurface({
    side,
    editMode,
    centerX,
}: {
    side: Side;
    editMode: "trim" | "vertex";
    centerX: number;
}) {
    const design = useDesignStore((s) => s.design);
    const addTrimPoint = useMeshEditStore((s) => s.addTrimPoint);
    const finishTrimLine = useMeshEditStore((s) => s.finishTrimLine);
    const setSelectedVertex = useMeshEditStore((s) => s.setSelectedVertex);
    const layout = insoleLayoutFromDesign(design);

    const geometry = buildInsoleGeometry({
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm: design.thicknessMm,
        corrections: design.corrections[side],
        elements: design.elements.filter((e) => e.side === side),
    });

    const onPointerDown = useCallback(
        (e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            const point = e.point.clone();
            point.x += centerX;

            if (editMode === "trim") {
                addTrimPoint(point);
                if (e.detail === 2) finishTrimLine();
            } else if (editMode === "vertex") {
                const matrix = new THREE.Matrix4().makeTranslation(
                    -centerX,
                    sideOffsetX(side, layout.widthMm),
                    0,
                );
                const idx = nearestVertexIndex(geometry, point, matrix);
                setSelectedVertex(idx);
            }
        },
        [addTrimPoint, centerX, editMode, finishTrimLine, geometry, layout.widthMm, setSelectedVertex, side],
    );

    return (
        <mesh geometry={geometry} onPointerDown={onPointerDown} visible={false}>
            <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
        </mesh>
    );
}

function TrimLineVisual({
    points,
    color,
    dashed,
    centerX,
}: {
    points: THREE.Vector3[];
    color: string;
    dashed?: boolean;
    centerX: number;
}) {
    if (points.length < 2) {
        return points.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: trim points are ordered polyline vertices
            <mesh key={i} position={[p.x + centerX, p.y, p.z + 1]}>
                <sphereGeometry args={[0.8, 6, 6]} />
                <meshBasicMaterial color={color} />
            </mesh>
        ));
    }
    const curve = new THREE.CatmullRomCurve3(
        points.map((p) => new THREE.Vector3(p.x + centerX, p.y, p.z + 1)),
    );
    return (
        <>
            <mesh>
                <tubeGeometry args={[curve, 32, 0.4, 6, false]} />
                <meshBasicMaterial color={color} transparent opacity={dashed ? 0.6 : 1} />
            </mesh>
            {points.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: trim points are ordered polyline vertices
                <mesh key={i} position={[p.x + centerX, p.y, p.z + 1]}>
                    <sphereGeometry args={[0.8, 6, 6]} />
                    <meshBasicMaterial color={color} />
                </mesh>
            ))}
        </>
    );
}

function VertexHandle({ side, vertexIndex, centerX }: { side: Side; vertexIndex: number; centerX: number }) {
    const design = useDesignStore((s) => s.design);
    const layout = insoleLayoutFromDesign(design);

    const geometry = buildInsoleGeometry({
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm: design.thicknessMm,
        corrections: design.corrections[side],
        elements: design.elements.filter((e) => e.side === side),
    });

    const pos = geometry.getAttribute("position");
    const x = pos.getX(vertexIndex);
    const y = pos.getY(vertexIndex);
    const z = pos.getZ(vertexIndex);

    return (
        <Html position={[x + centerX, y, z + 3]} center>
            <div className="rounded bg-panel/90 px-1.5 py-0.5 text-[10px] text-foreground shadow">
                Drag with sliders in panel · v{vertexIndex}
            </div>
        </Html>
    );
}
