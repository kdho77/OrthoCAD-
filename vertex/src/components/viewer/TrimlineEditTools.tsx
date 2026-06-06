// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import {
    cloneTrimline,
    deformTrimlineSection,
    getDesignTrimline,
    pickTrimlineAnchorIndex,
    projectToFootprintPlane,
    sampleDefaultOutline,
    TRIMLINE_PICK_RADIUS_EDIT,
    TRIMLINE_PICK_RADIUS_IDLE,
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
    const design = useDesignStore((s) => s.design);
    const editMode = useMeshEditStore((s) => s.editMode);
    const trimlineEdit = useMeshEditStore((s) => s.trimlineEdit);
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
                    : getDesignTrimline(design, side) ?? getTrimlineForSide(side);

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

    const pickRadius = isEditing ? TRIMLINE_PICK_RADIUS_EDIT : TRIMLINE_PICK_RADIUS_IDLE;

    const displayPoints = useMemo(
        () => curve.points.map((p) => new THREE.Vector3(p.x + CENTER_X, p.y, p.z + 1.5)),
        [curve.points],
    );

    const outlineColor = isEditing ? (isDragging ? "#ef4444" : "#f97316") : "#64748b";
    const tubeRadius = isEditing ? 0.55 : 0.35;

    /** Resolve world matrix for footprint projection. */
    const getWorldMatrix = useCallback((): THREE.Matrix4 => {
        if (groupRef.current) {
            groupRef.current.updateWorldMatrix(true, false);
            return groupRef.current.matrixWorld.clone();
        }
        const m = new THREE.Matrix4();
        m.makeRotationX(-Math.PI / 2);
        m.multiply(new THREE.Matrix4().makeTranslation(-CENTER_X, offsetY, 0));
        return m;
    }, [offsetY]);

    const startDrag = useCallback(
        (e: ThreeEvent<PointerEvent>, anchorIndex: number) => {
            const local = projectToFootprintPlane(e.point, getWorldMatrix());
            dragLocalRef.current = local.clone();
            setTrimlineDragAnchor(anchorIndex, local);
            setTrimlineDragging(true);
            setInteracting(true, "trimline");
            gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
        },
        [getWorldMatrix, gl.domElement, setInteracting, setTrimlineDragAnchor, setTrimlineDragging],
    );

    const onPointerDownHandle = useCallback(
        (e: ThreeEvent<PointerEvent>, pointIndex: number) => {
            e.stopPropagation();
            if (!isEditing) {
                onOutlineClick();
                return;
            }
            startDrag(e, pointIndex);
        },
        [isEditing, onOutlineClick, startDrag],
    );

    const onPointerMove = useCallback(
        (e: ThreeEvent<PointerEvent>) => {
            if (!isEditing || !trimlineEdit?.isDragging || trimlineEdit.dragAnchorIndex === null) return;
            e.stopPropagation();

            const local = projectToFootprintPlane(e.point, getWorldMatrix());
            const start = dragLocalRef.current ?? trimlineEdit.dragStartLocal;
            if (!start) return;

            const delta = local.clone().sub(start);
            const deformed = deformTrimlineSection(curve.points, trimlineEdit.dragAnchorIndex, delta, 12);
            setTrimlineDraft(deformed);
        },
        [curve.points, getWorldMatrix, isEditing, setTrimlineDraft, trimlineEdit],
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

            const local = projectToFootprintPlane(e.point, getWorldMatrix());
            startDrag(e, pickTrimlineAnchorIndex(local, curve));
        },
        [curve, getWorldMatrix, isEditing, onOutlineClick, startDrag],
    );

    const catmull = useMemo(() => trimlineToCurve(displayPoints, true), [displayPoints]);

    const pickTubeGeo = useMemo(
        () => new THREE.TubeGeometry(catmull, Math.max(64, curve.points.length * 2), pickRadius, 10, true),
        [catmull, curve.points.length, pickRadius],
    );

    const widePickTubeGeo = useMemo(
        () =>
            new THREE.TubeGeometry(
                catmull,
                Math.max(64, curve.points.length * 2),
                pickRadius * 1.35,
                8,
                true,
            ),
        [catmull, curve.points.length, pickRadius],
    );

    useEffect(
        () => () => {
            pickTubeGeo.dispose();
            widePickTubeGeo.dispose();
        },
        [pickTubeGeo, widePickTubeGeo],
    );

    return (
        <group ref={groupRef} position={[-CENTER_X, offsetY, 0]}>
            {/* Primary pick tube — generous radius, always hittable above the insole mesh */}
            <mesh
                renderOrder={100}
                geometry={pickTubeGeo}
                onPointerDown={onPickPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            >
                <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
            </mesh>

            {/* Secondary wider shell for oblique views / near-miss clicks */}
            <mesh
                renderOrder={99}
                geometry={widePickTubeGeo}
                onPointerDown={onPickPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            >
                <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
            </mesh>

            <TrimlineVisual points={displayPoints} color={outlineColor} tubeRadius={tubeRadius} />

            {isEditing
                ? curve.points.map((p, i) => (
                      <mesh
                          key={i}
                          position={[p.x + CENTER_X, p.y, p.z + 2.5]}
                          renderOrder={101}
                          onPointerDown={(e) => onPointerDownHandle(e, i)}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                      >
                          <sphereGeometry args={[2.2, 10, 10]} />
                          <meshBasicMaterial
                              color={
                                  trimlineEdit?.dragAnchorIndex === i && trimlineEdit.isDragging
                                      ? "#ef4444"
                                      : "#fbbf24"
                              }
                              depthTest={false}
                          />
                      </mesh>
                  ))
                : null}

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

    const curve = useMemo(() => new THREE.CatmullRomCurve3(points.map((p) => p.clone()), true), [points]);

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

/** Read committed trimlines from design store (for export helpers). */
export function getCommittedTrimlinesFromDesign(): Partial<Record<Side, TrimlineCurve>> {
    const design = useDesignStore.getState().design;
    const out: Partial<Record<Side, TrimlineCurve>> = {};
    for (const side of ["left", "right"] as Side[]) {
        const curve = getDesignTrimline(design, side);
        if (curve) out[side] = cloneTrimline(curve);
    }
    return out;
}

export function defaultOutlineForSide(_side: Side): TrimlineCurve {
    return sampleDefaultOutline(INSOLE_LENGTH_MM, INSOLE_WIDTH_MM);
}
