// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useMemo, useRef } from "react";
import * as THREE from "three";
import { INSOLE_LENGTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import {
    cloneTrimline,
    deformTrimlineSection,
    projectToFootprintPlane,
    trimlineToCurve,
    type TrimlineCurve,
} from "@/lib/geometry/trimline";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { Side } from "@/types";

const CENTER_X = INSOLE_LENGTH_MM / 2;

/** Interactive trimline picking, drag-to-reshape, and preview overlays. */
export function TrimlineEditTools() {
    const viewer = useDesignStore((s) => s.viewer);
    const editMode = useMeshEditStore((s) => s.editMode);
    const trimlineEdit = useMeshEditStore((s) => s.trimlineEdit);
    const trimlineBySide = useMeshEditStore((s) => s.trimlineBySide);
    const beginTrimlineEdit = useMeshEditStore((s) => s.beginTrimlineEdit);
    const getTrimlineForSide = useMeshEditStore((s) => s.getTrimlineForSide);

    const sides: Side[] = [];
    if (viewer.showLeft) sides.push("left");
    if (viewer.showRight) sides.push("right");

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            {sides.map((side) => {
                const isEditing = editMode === "edit-trimline" && trimlineEdit?.side === side;
                const curve = isEditing
                    ? trimlineEdit!.draft
                    : trimlineBySide[side] ?? getTrimlineForSide(side);

                return (
                    <TrimlineSideOverlay
                        key={side}
                        side={side}
                        curve={curve}
                        isEditing={isEditing}
                        isDragging={isEditing && trimlineEdit!.isDragging}
                        onOutlineClick={() => {
                            if (editMode !== "edit-trimline") beginTrimlineEdit(side);
                        }}
                    />
                );
            })}
        </group>
    );
}

function TrimlineSideOverlay({
    side,
    curve,
    isEditing,
    isDragging,
    onOutlineClick,
}: {
    side: Side;
    curve: TrimlineCurve;
    isEditing: boolean;
    isDragging: boolean;
    onOutlineClick: () => void;
}) {
    const offsetY = sideOffsetX(side);
    const setTrimlineDraft = useMeshEditStore((s) => s.setTrimlineDraft);
    const setTrimlineDragAnchor = useMeshEditStore((s) => s.setTrimlineDragAnchor);
    const setTrimlineDragging = useMeshEditStore((s) => s.setTrimlineDragging);
    const trimlineEdit = useMeshEditStore((s) => s.trimlineEdit);
    const setInteracting = usePerformanceStore((s) => s.setInteracting);

    const groupRef = useRef<THREE.Group>(null);
    const dragLocalRef = useRef<THREE.Vector3 | null>(null);
    const { gl } = useThree();

    const localMatrix = useMemo(() => {
        const m = new THREE.Matrix4();
        m.makeRotationX(-Math.PI / 2);
        const inner = new THREE.Matrix4().makeTranslation(-CENTER_X, offsetY, 0);
        return m.multiply(inner);
    }, [offsetY]);

    const displayPoints = useMemo(
        () => curve.points.map((p) => new THREE.Vector3(p.x + CENTER_X, p.y, p.z + 1.5)),
        [curve.points],
    );

    const outlineColor = isEditing ? (isDragging ? "#ef4444" : "#f97316") : "#64748b";
    const tubeRadius = isEditing ? 0.55 : 0.35;

    const onPointerDownHandle = useCallback(
        (e: ThreeEvent<PointerEvent>, pointIndex: number) => {
            e.stopPropagation();
            if (!isEditing) {
                onOutlineClick();
                return;
            }

            const local = projectToFootprintPlane(e.point, localMatrix);
            dragLocalRef.current = local.clone();
            setTrimlineDragAnchor(pointIndex, local);
            setTrimlineDragging(true);
            setInteracting(true, "trimline");
            gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
        },
        [
            gl.domElement,
            isEditing,
            localMatrix,
            onOutlineClick,
            setInteracting,
            setTrimlineDragAnchor,
            setTrimlineDragging,
        ],
    );

    const onPointerMove = useCallback(
        (e: ThreeEvent<PointerEvent>) => {
            if (!isEditing || !trimlineEdit?.isDragging || trimlineEdit.dragAnchorIndex === null) return;
            e.stopPropagation();

            const local = projectToFootprintPlane(e.point, localMatrix);
            const start = dragLocalRef.current ?? trimlineEdit.dragStartLocal;
            if (!start) return;

            const delta = local.clone().sub(start);
            const deformed = deformTrimlineSection(
                curve.points,
                trimlineEdit.dragAnchorIndex,
                delta,
                12,
            );
            setTrimlineDraft(deformed);
        },
        [curve.points, isEditing, localMatrix, setTrimlineDraft, trimlineEdit],
    );

    const onPointerUp = useCallback(
        (e: ThreeEvent<PointerEvent>) => {
            if (!isEditing || !trimlineEdit?.isDragging) return;
            e.stopPropagation();
            setTrimlineDragging(false);
            setTrimlineDragAnchor(null, null);
            dragLocalRef.current = null;
            setInteracting(false);
            try {
                gl.domElement.releasePointerCapture(e.nativeEvent.pointerId);
            } catch {
                // pointer may already be released
            }
        },
        [gl.domElement, isEditing, setInteracting, setTrimlineDragAnchor, setTrimlineDragging, trimlineEdit?.isDragging],
    );

    const onPickPointerDown = useCallback(
        (e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            if (!isEditing) {
                onOutlineClick();
                return;
            }

            // Raycast to find nearest control point on the trimline
            const local = projectToFootprintPlane(e.point, localMatrix);
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i < curve.points.length; i++) {
                const p = curve.points[i]!;
                const dx = p.x - local.x;
                const dy = p.y - local.y;
                const d = dx * dx + dy * dy;
                if (d < bestDist) {
                    bestDist = d;
                    best = i;
                }
            }

            dragLocalRef.current = local.clone();
            setTrimlineDragAnchor(best, local);
            setTrimlineDragging(true);
            setInteracting(true, "trimline");
            gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
        },
        [
            curve.points,
            gl.domElement,
            isEditing,
            localMatrix,
            onOutlineClick,
            setInteracting,
            setTrimlineDragAnchor,
            setTrimlineDragging,
        ],
    );

    const catmull = useMemo(() => trimlineToCurve(displayPoints, true), [displayPoints]);

    return (
        <group ref={groupRef} position={[-CENTER_X, offsetY, 0]}>
            {/* Pickable tube along the trimline — raycast target */}
            <mesh
                onPointerDown={onPickPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            >
                <tubeGeometry args={[catmull, Math.max(48, curve.points.length * 2), isEditing ? 2.2 : 1.8, 8, true]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>

            {/* Visible trimline curve */}
            <TrimlineVisual points={displayPoints} color={outlineColor} tubeRadius={tubeRadius} />

            {/* Control point handles while editing */}
            {isEditing
                ? curve.points.map((p, i) => (
                      <mesh
                          key={i}
                          position={[p.x + CENTER_X, p.y, p.z + 2.5]}
                          onPointerDown={(e) => onPointerDownHandle(e, i)}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                      >
                          <sphereGeometry args={[1.4, 10, 10]} />
                          <meshBasicMaterial
                              color={
                                  trimlineEdit?.dragAnchorIndex === i && trimlineEdit.isDragging
                                      ? "#ef4444"
                                      : "#fbbf24"
                              }
                          />
                      </mesh>
                  ))
                : null}

            {/* Red preview overlay while dragging */}
            {isEditing && isDragging ? (
                <TrimlineVisual points={displayPoints} color="#ef4444" tubeRadius={0.7} dashed />
            ) : null}
        </group>
    );
}

function TrimlineVisual({
    points,
    color,
    tubeRadius = 0.5,
    dashed,
}: {
    points: THREE.Vector3[];
    color: string;
    tubeRadius?: number;
    dashed?: boolean;
}) {
    if (points.length < 2) return null;

    const curve = useMemo(() => {
        const c = new THREE.CatmullRomCurve3(points.map((p) => p.clone()), true);
        return c;
    }, [points]);

    return (
        <mesh renderOrder={10}>
            <tubeGeometry args={[curve, Math.max(48, points.length * 2), tubeRadius, 8, true]} />
            <meshBasicMaterial
                color={color}
                transparent={Boolean(dashed)}
                opacity={dashed ? 0.85 : 1}
                depthTest={!dashed}
            />
        </mesh>
    );
}

/** Utility for tests / export — clone committed + draft trimlines. */
export function exportTrimlineState(): Partial<Record<Side, TrimlineCurve>> {
    const { trimlineBySide, trimlineEdit } = useMeshEditStore.getState();
    const out: Partial<Record<Side, TrimlineCurve>> = {};
    for (const side of ["left", "right"] as Side[]) {
        if (trimlineEdit?.side === side) out[side] = cloneTrimline(trimlineEdit.draft);
        else if (trimlineBySide[side]) out[side] = cloneTrimline(trimlineBySide[side]!);
    }
    return out;
}
