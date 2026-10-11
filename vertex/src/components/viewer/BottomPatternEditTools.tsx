// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import {
    deformTrimlineSection,
    pickTrimlineAnchorIndex,
    projectToFootprintPlane,
    TRIMLINE_PICK_RADIUS_EDIT,
    TRIMLINE_PICK_RADIUS_IDLE,
    type TrimlineCurve,
    trimlineToCurve,
} from "@/lib/geometry/trimline";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import { useScanStore } from "@/stores/scan-store";
import type { Side } from "@/types";

const INFLUENCE_RADIUS = 12;

/** Fair bottom-pattern overlay — independent of the top trimline. */
export function BottomPatternEditTools() {
    const wallModel = useDesignStore((s) => s.viewer.wallModel ?? "legacy");
    const viewer = useDesignStore((s) => s.viewer);
    const placingMarkers = useScanStore((s) => s.placementMode != null);
    if (wallModel !== "procedural" || placingMarkers) return null;

    const sides: Side[] = [];
    if (viewer.showLeft) sides.push("left");
    if (viewer.showRight) sides.push("right");

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            {sides.map((side) => (
                <BottomPatternSideRow key={side} side={side} />
            ))}
        </group>
    );
}

function BottomPatternSideRow({ side }: { side: Side }) {
    const editMode = useMeshEditStore((s) => s.editMode);
    const session = useMeshEditStore((s) => s.bottomPatternEdit);
    const beginEdit = useMeshEditStore((s) => s.beginBottomPatternEdit);
    const stored = useBottomPatternStore((s) => s.patterns[side] ?? null);
    const isEditing = editMode === "edit-bottom-pattern" && session?.side === side;
    const curve = isEditing && session ? session.draft : stored;
    if (!curve || curve.points.length < 4) return null;

    return (
        <BottomPatternOverlay
            side={side}
            curve={curve}
            isEditing={isEditing}
            isDragging={isEditing && (session?.isDragging ?? false)}
            onOutlineClick={() => {
                if (editMode !== "edit-bottom-pattern") beginEdit(side);
            }}
        />
    );
}

function BottomPatternOverlay({
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
    const design = useDesignStore((s) => s.design);
    const layout = insoleLayoutFromDesign(design);
    const centerX = layout.lengthMm / 2;
    const offsetY = sideOffsetX(side, layout.widthMm);
    const setDraft = useMeshEditStore((s) => s.setBottomPatternDraft);
    const setDragAnchor = useMeshEditStore((s) => s.setBottomPatternDragAnchor);
    const setDragging = useMeshEditStore((s) => s.setBottomPatternDragging);
    const setInteracting = usePerformanceStore((s) => s.setInteracting);

    const groupRef = useRef<THREE.Group>(null);
    const { gl, camera, raycaster } = useThree();
    const dragPlaneRef = useRef(new THREE.Plane());
    const anchorWorldRef = useRef(new THREE.Vector3());
    const worldToLocalRef = useRef(new THREE.Matrix4());
    const basePointsRef = useRef<THREE.Vector3[]>([]);
    const anchorIndexRef = useRef(0);
    const pendingDeltaRef = useRef<THREE.Vector3 | null>(null);
    const rafRef = useRef<number | null>(null);

    const pickRadius = isEditing ? TRIMLINE_PICK_RADIUS_EDIT : TRIMLINE_PICK_RADIUS_IDLE;
    const displayPoints = useMemo(
        () => curve.points.map((p) => new THREE.Vector3(p.x, p.y, p.z + 0.8)),
        [curve.points],
    );
    const outlineColor = isEditing ? (isDragging ? "#ef4444" : "#22d3ee") : "#14b8a6";

    const getWorldMatrix = useCallback((): THREE.Matrix4 => {
        if (groupRef.current) {
            groupRef.current.updateWorldMatrix(true, false);
            return groupRef.current.matrixWorld.clone();
        }
        const m = new THREE.Matrix4();
        m.makeRotationX(-Math.PI / 2);
        m.multiply(new THREE.Matrix4().makeTranslation(-centerX, offsetY, 0));
        return m;
    }, [centerX, offsetY]);

    const flushDraft = useCallback(() => {
        rafRef.current = null;
        const delta = pendingDeltaRef.current;
        if (!delta) return;
        setDraft(
            deformTrimlineSection(basePointsRef.current, anchorIndexRef.current, delta, INFLUENCE_RADIUS),
        );
    }, [setDraft]);

    const computeLocalDelta = useCallback(
        (clientX: number, clientY: number): THREE.Vector3 | null => {
            const rect = gl.domElement.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(ndc, camera);
            const worldHit = new THREE.Vector3();
            if (!raycaster.ray.intersectPlane(dragPlaneRef.current, worldHit)) return null;
            const wl = worldToLocalRef.current;
            const aLocal = anchorWorldRef.current.clone().applyMatrix4(wl);
            const pLocal = worldHit.applyMatrix4(wl);
            return pLocal.sub(aLocal);
        },
        [camera, gl.domElement, raycaster],
    );

    const handleWindowMove = useCallback(
        (ev: PointerEvent) => {
            const delta = computeLocalDelta(ev.clientX, ev.clientY);
            if (!delta) return;
            pendingDeltaRef.current = delta;
            if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushDraft);
        },
        [computeLocalDelta, flushDraft],
    );

    const endDrag = useCallback(
        (ev?: PointerEvent) => {
            window.removeEventListener("pointermove", handleWindowMove);
            window.removeEventListener("pointerup", endDrag);
            window.removeEventListener("pointercancel", endDrag);
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            flushDraft();
            pendingDeltaRef.current = null;
            setDragging(false);
            setDragAnchor(null, null);
            setInteracting(false);
            if (ev) {
                try {
                    gl.domElement.releasePointerCapture(ev.pointerId);
                } catch {
                    /* already released */
                }
            }
        },
        [flushDraft, gl.domElement, handleWindowMove, setDragAnchor, setDragging, setInteracting],
    );

    const startDrag = useCallback(
        (e: ThreeEvent<PointerEvent>, anchorIndex: number) => {
            const worldMatrix = getWorldMatrix();
            worldToLocalRef.current = worldMatrix.clone().invert();
            anchorWorldRef.current.copy(e.point);
            basePointsRef.current = curve.points.map((p) => p.clone());
            anchorIndexRef.current = anchorIndex;
            pendingDeltaRef.current = null;
            const normal = camera.getWorldDirection(new THREE.Vector3());
            dragPlaneRef.current.setFromNormalAndCoplanarPoint(normal, e.point);
            setDragAnchor(anchorIndex, projectToFootprintPlane(e.point, worldMatrix));
            setDragging(true);
            setInteracting(true, "trimline");
            try {
                gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
            } catch {
                /* window listeners still track */
            }
            window.addEventListener("pointermove", handleWindowMove);
            window.addEventListener("pointerup", endDrag);
            window.addEventListener("pointercancel", endDrag);
        },
        [
            camera,
            curve.points,
            endDrag,
            getWorldMatrix,
            gl.domElement,
            handleWindowMove,
            setDragAnchor,
            setDragging,
            setInteracting,
        ],
    );

    const endDragRef = useRef(endDrag);
    endDragRef.current = endDrag;
    useEffect(() => () => endDragRef.current(), []);

    const onPickPointerDown = useCallback(
        (e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            if (!isEditing) {
                onOutlineClick();
                return;
            }
            startDrag(e, pickTrimlineAnchorIndex(projectToFootprintPlane(e.point, getWorldMatrix()), curve));
        },
        [curve, getWorldMatrix, isEditing, onOutlineClick, startDrag],
    );

    const frozenPickPointsRef = useRef(displayPoints);
    if (!isDragging) frozenPickPointsRef.current = displayPoints;
    const pickPoints = isDragging ? frozenPickPointsRef.current : displayPoints;
    const pickCatmull = useMemo(() => trimlineToCurve(pickPoints, true), [pickPoints]);
    const pickTubeGeo = useMemo(
        () => new THREE.TubeGeometry(pickCatmull, Math.max(48, pickPoints.length), pickRadius, 8, true),
        [pickCatmull, pickPoints.length, pickRadius],
    );
    useEffect(() => () => pickTubeGeo.dispose(), [pickTubeGeo]);

    const ring = useMemo(
        () =>
            new THREE.CatmullRomCurve3(
                displayPoints.map((p) => p.clone()),
                true,
            ),
        [displayPoints],
    );
    if (displayPoints.length < 2) return null;

    return (
        <group ref={groupRef} position={[-centerX, offsetY, 0]}>
            <mesh renderOrder={100} geometry={pickTubeGeo} onPointerDown={onPickPointerDown}>
                <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
            </mesh>
            <mesh renderOrder={11}>
                <tubeGeometry
                    args={[ring, Math.max(48, displayPoints.length * 2), isEditing ? 0.5 : 0.32, 8, true]}
                />
                <meshBasicMaterial color={outlineColor} />
            </mesh>
            {isEditing
                ? curve.points.map((p, i) => (
                      <mesh
                          // biome-ignore lint/suspicious/noArrayIndexKey: ring order is identity
                          key={i}
                          position={[p.x, p.y, p.z + 1.6]}
                          renderOrder={102}
                          onPointerDown={(e) => {
                              e.stopPropagation();
                              startDrag(e, i);
                          }}
                      >
                          <sphereGeometry args={[2.0, 10, 10]} />
                          <meshBasicMaterial color="#22d3ee" depthTest={false} />
                      </mesh>
                  ))
                : null}
        </group>
    );
}
