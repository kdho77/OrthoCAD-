// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getDesignBase } from "@/lib/geometry/base-asset";
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
    type TrimlineCurve,
    trimlineToCurve,
} from "@/lib/geometry/trimline";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { Side } from "@/types";

const CENTER_X = INSOLE_LENGTH_MM / 2;
const INFLUENCE_RADIUS = 12;

/** Interactive trimline picking, drag-to-reshape, and preview overlays. */
export function TrimlineEditTools() {
    const viewer = useDesignStore((s) => s.viewer);
    const design = useDesignStore((s) => s.design);
    const editMode = useMeshEditStore((s) => s.editMode);
    const trimlineEdit = useMeshEditStore((s) => s.trimlineEdit);
    const beginTrimlineEdit = useMeshEditStore((s) => s.beginTrimlineEdit);
    const getTrimlineForSide = useMeshEditStore((s) => s.getTrimlineForSide);

    // Subscribe to the loaded base's outline so the overlay re-renders (and picks
    // up the mesh-derived default) as soon as the base GLB finishes loading.
    const baseAssetId = getDesignBase(design, side)?.assetId ?? null;
    const baseOutline = useBaseOutlineStore((s) => (baseAssetId ? (s.outlines[baseAssetId] ?? null) : null));

    const sides: Side[] = [];
    if (viewer.showLeft) sides.push("left");
    if (viewer.showRight) sides.push("right");

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            {sides.map((side) => {
                const isEditing = editMode === "edit-trimline" && trimlineEdit?.side === side;
                const curve = isEditing
                    ? trimlineEdit!.draft
                    : (getDesignTrimline(design, side) ?? baseOutline ?? getTrimlineForSide(side));

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
    const setInteracting = usePerformanceStore((s) => s.setInteracting);

    const groupRef = useRef<THREE.Group>(null);
    const { gl, camera, raycaster } = useThree();

    // Drag session refs — kept off React state so the rAF loop never re-renders mid-drag.
    const dragPlaneRef = useRef(new THREE.Plane());
    const anchorWorldRef = useRef(new THREE.Vector3());
    const worldToLocalRef = useRef(new THREE.Matrix4());
    const basePointsRef = useRef<THREE.Vector3[]>([]);
    const anchorIndexRef = useRef<number>(0);
    const pendingDeltaRef = useRef<THREE.Vector3 | null>(null);
    const rafRef = useRef<number | null>(null);

    const pickRadius = isEditing ? TRIMLINE_PICK_RADIUS_EDIT : TRIMLINE_PICK_RADIUS_IDLE;

    // Points are stored in the geometry's own footprint frame (x along length,
    // y across width) — the same frame `InsoleMesh` / `BaseInsoleMesh` render
    // their geometry in. The overlay group below applies the identical
    // `-CENTER_X` / side offset as those meshes, so points map straight through
    // (no extra centering shift) and the trimline stays glued to the surface.
    const displayPoints = useMemo(
        () => curve.points.map((p) => new THREE.Vector3(p.x, p.y, p.z + 1.5)),
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

    /** Apply the latest pending delta to the draft (one update per animation frame). */
    const flushDraft = useCallback(() => {
        rafRef.current = null;
        const delta = pendingDeltaRef.current;
        if (!delta) return;
        const deformed = deformTrimlineSection(
            basePointsRef.current,
            anchorIndexRef.current,
            delta,
            INFLUENCE_RADIUS,
        );
        setTrimlineDraft(deformed);
    }, [setTrimlineDraft]);

    /** Compute the constrained footprint delta for a screen pointer position. */
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

            // Convert both anchor and hit into local footprint space, then diff.
            // The translation cancels, leaving a pure in-plane displacement (no twist).
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
            // Commit the final pointer position before tearing the session down.
            flushDraft();
            pendingDeltaRef.current = null;
            setTrimlineDragging(false);
            setTrimlineDragAnchor(null, null);
            setInteracting(false);
            if (ev) {
                try {
                    gl.domElement.releasePointerCapture(ev.pointerId);
                } catch {
                    // pointer may already be released
                }
            }
        },
        [
            flushDraft,
            gl.domElement,
            handleWindowMove,
            setInteracting,
            setTrimlineDragAnchor,
            setTrimlineDragging,
        ],
    );

    const startDrag = useCallback(
        (e: ThreeEvent<PointerEvent>, anchorIndex: number) => {
            const worldMatrix = getWorldMatrix();
            worldToLocalRef.current = worldMatrix.clone().invert();
            anchorWorldRef.current.copy(e.point);
            basePointsRef.current = curve.points.map((p) => p.clone());
            anchorIndexRef.current = anchorIndex;
            pendingDeltaRef.current = null;

            // Constraint plane faces the camera and passes through the anchor.
            // The camera-forward axis (depth) is locked → drag stays in the view plane.
            const normal = camera.getWorldDirection(new THREE.Vector3());
            dragPlaneRef.current.setFromNormalAndCoplanarPoint(normal, e.point);

            const startLocal = projectToFootprintPlane(e.point, worldMatrix);
            setTrimlineDragAnchor(anchorIndex, startLocal);
            setTrimlineDragging(true);
            setInteracting(true, "trimline");

            try {
                gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
            } catch {
                // capture is best-effort; window listeners still track the drag
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
            setInteracting,
            setTrimlineDragAnchor,
            setTrimlineDragging,
        ],
    );

    // Tear down listeners if the component unmounts mid-drag.
    useEffect(() => endDrag, [endDrag]);

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

    // Pick-tube geometry is only needed to start a drag, so freeze it while dragging
    // to avoid rebuilding a TubeGeometry on every preview frame.
    const frozenPickPointsRef = useRef(displayPoints);
    if (!isDragging) frozenPickPointsRef.current = displayPoints;
    const pickPoints = isDragging ? frozenPickPointsRef.current : displayPoints;

    const pickCatmull = useMemo(() => trimlineToCurve(pickPoints, true), [pickPoints]);

    const pickTubeGeo = useMemo(
        () => new THREE.TubeGeometry(pickCatmull, Math.max(48, pickPoints.length), pickRadius, 8, true),
        [pickCatmull, pickPoints.length, pickRadius],
    );

    useEffect(() => () => pickTubeGeo.dispose(), [pickTubeGeo]);

    return (
        <group ref={groupRef} position={[-CENTER_X, offsetY, 0]}>
            {/* Pick tube — generous radius, always hittable above the insole mesh */}
            <mesh renderOrder={100} geometry={pickTubeGeo} onPointerDown={onPickPointerDown}>
                <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
            </mesh>

            <TrimlineVisual points={displayPoints} color={outlineColor} tubeRadius={tubeRadius} />

            {isEditing
                ? curve.points.map((p, i) => (
                      <mesh
                          // biome-ignore lint/suspicious/noArrayIndexKey: control points are a fixed-order ring; index is their stable identity
                          key={i}
                          position={[p.x, p.y, p.z + 2.5]}
                          renderOrder={101}
                          onPointerDown={(e) => onPointerDownHandle(e, i)}
                      >
                          <sphereGeometry args={[2.2, 10, 10]} />
                          <meshBasicMaterial
                              color={anchorIndexRef.current === i && isDragging ? "#ef4444" : "#fbbf24"}
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
    const curve = useMemo(
        () =>
            new THREE.CatmullRomCurve3(
                points.map((p) => p.clone()),
                true,
            ),
        [points],
    );

    if (points.length < 2) return null;

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
