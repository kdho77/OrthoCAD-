// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
    applyTopOutlineLockZone,
    bottomPatternOutlineCurve,
    cloneBottomPattern,
    getDesignBottomPattern,
    lockedBottomOutlineIndices,
    resolveDesignBuildLength,
    setBottomPatternOutline,
    transformedBottomPatternPoints,
} from "@/lib/geometry/bottom-pattern";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import {
    deformTrimlineSectionMulti,
    getDesignTrimline,
    pickTrimlineAnchorIndex,
    projectToFootprintPlane,
    sampleDefaultOutline,
    TRIMLINE_PICK_RADIUS_EDIT,
    TRIMLINE_PICK_RADIUS_IDLE,
    type TrimlineCurve,
    trimlineToCurve,
} from "@/lib/geometry/trimline";
import { resolveSulcusOffsetMm, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { BottomPattern, Side } from "@/types";

const CENTER_X = INSOLE_LENGTH_MM / 2;
const INFLUENCE_RADIUS = 12;
const ROTATE_HANDLE_OFFSET_MM = 18;

/**
 * Bottom-pattern overlay: outline-point reshape (same interaction as top trimline)
 * plus a distinct translate/rotate transform handle. Uses reactive draft subscription
 * (Phase 1 pattern) — never getState() inside geometry rebuild effects.
 */
export function BottomPatternEditTools() {
    const viewer = useDesignStore((s) => s.viewer);
    const design = useDesignStore((s) => s.design);
    const editMode = useMeshEditStore((s) => s.editMode);
    const bottomPatternEdit = useMeshEditStore((s) => s.bottomPatternEdit);
    const beginBottomPatternEdit = useMeshEditStore((s) => s.beginBottomPatternEdit);

    const sides: Side[] = [];
    if (viewer.showLeft) sides.push("left");
    if (viewer.showRight) sides.push("right");

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            {sides.map((side) => {
                const isEditing = editMode === "edit-bottom-pattern" && bottomPatternEdit?.side === side;
                // Reactive draft preference — mirrors InsoleMesh / resolveActiveTrimlineForClip.
                const pattern: BottomPattern | null =
                    isEditing && bottomPatternEdit
                        ? bottomPatternEdit.draft
                        : getDesignBottomPattern(design, side);
                if (!pattern && !isEditing) return null;
                const display = pattern ?? bottomPatternEdit?.draft;
                if (!display) return null;
                return (
                    <BottomPatternSideOverlay
                        key={side}
                        side={side}
                        pattern={display}
                        topOutline={
                            getDesignTrimline(design, side) ??
                            sampleDefaultOutline(INSOLE_LENGTH_MM, INSOLE_WIDTH_MM)
                        }
                        buildLength={resolveDesignBuildLength(design)}
                        insoleLengthMm={INSOLE_LENGTH_MM}
                        sulcusOffsetMm={resolveSulcusOffsetMm(design)}
                        isEditing={isEditing}
                        isDragging={isEditing && (bottomPatternEdit?.isDragging ?? false)}
                        gesture={isEditing ? (bottomPatternEdit?.gesture ?? null) : null}
                        onOutlineClick={() => {
                            if (editMode !== "edit-bottom-pattern") beginBottomPatternEdit(side);
                        }}
                    />
                );
            })}
        </group>
    );
}

function BottomPatternSideOverlay({
    side,
    pattern,
    topOutline,
    buildLength,
    insoleLengthMm,
    sulcusOffsetMm,
    isEditing,
    isDragging,
    gesture,
    onOutlineClick,
}: {
    side: Side;
    pattern: BottomPattern;
    topOutline: TrimlineCurve;
    buildLength: ReturnType<typeof resolveDesignBuildLength>;
    insoleLengthMm: number;
    sulcusOffsetMm: number;
    isEditing: boolean;
    isDragging: boolean;
    gesture: "outline" | "translate" | "rotate" | null;
    onOutlineClick: () => void;
}) {
    const offsetY = sideOffsetX(side);
    const setBottomPatternDraft = useMeshEditStore((s) => s.setBottomPatternDraft);
    const setBottomPatternGesture = useMeshEditStore((s) => s.setBottomPatternGesture);
    const setBottomPatternDragging = useMeshEditStore((s) => s.setBottomPatternDragging);
    const setInteracting = usePerformanceStore((s) => s.setInteracting);

    const groupRef = useRef<THREE.Group>(null);
    const { gl, camera, raycaster } = useThree();

    const dragPlaneRef = useRef(new THREE.Plane());
    const anchorWorldRef = useRef(new THREE.Vector3());
    const worldToLocalRef = useRef(new THREE.Matrix4());
    const baseOutlineRef = useRef<THREE.Vector3[]>([]);
    const anchorIndicesRef = useRef<number[]>([]);
    const startTransformRef = useRef(pattern.transform);
    const startCentroidLocalRef = useRef(new THREE.Vector3());
    const pendingRef = useRef<{
        kind: "outline" | "translate" | "rotate";
        delta?: THREE.Vector3;
        translation?: { x: number; y: number };
        rotationDeg?: number;
    } | null>(null);
    const rafRef = useRef<number | null>(null);
    const patternRef = useRef(pattern);
    patternRef.current = pattern;

    // Multi-select (shift-click toggle). Locked points are never in this set.
    const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

    const localOutlinePoints = useMemo(() => bottomPatternOutlineCurve(pattern).points, [pattern]);
    const lockedIndices = useMemo(
        () =>
            lockedBottomOutlineIndices(
                localOutlinePoints,
                topOutline,
                buildLength,
                insoleLengthMm,
                sulcusOffsetMm,
            ),
        [localOutlinePoints, topOutline, buildLength, insoleLengthMm, sulcusOffsetMm],
    );
    const lockedRef = useRef(lockedIndices);
    lockedRef.current = lockedIndices;

    // Keep distal lock zone snapped to top outline while editing.
    useEffect(() => {
        if (!isEditing || lockedIndices.size === 0) return;
        const current = patternRef.current;
        const local = bottomPatternOutlineCurve(current).points;
        const snapped = applyTopOutlineLockZone(local, topOutline, lockedIndices);
        let changed = false;
        for (const i of lockedIndices) {
            const a = local[i]!;
            const b = snapped[i]!;
            if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-4) {
                changed = true;
                break;
            }
        }
        if (changed) {
            setBottomPatternDraft(setBottomPatternOutline(current, { points: snapped }));
        }
        setSelectedIndices((prev) => prev.filter((i) => !lockedIndices.has(i)));
    }, [isEditing, lockedIndices, topOutline, setBottomPatternDraft]);

    const worldPoints = useMemo(() => transformedBottomPatternPoints(pattern), [pattern]);
    const displayPoints = useMemo(
        () => worldPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z + 1.2)),
        [worldPoints],
    );

    const centroid = useMemo(() => {
        let cx = 0;
        let cy = 0;
        for (const p of worldPoints) {
            cx += p.x;
            cy += p.y;
        }
        const n = Math.max(1, worldPoints.length);
        return new THREE.Vector3(cx / n, cy / n, 1.8);
    }, [worldPoints]);

    const rotateHandlePos = useMemo(() => {
        const rad = (pattern.transform.rotationDeg * Math.PI) / 180;
        return new THREE.Vector3(
            centroid.x + Math.cos(rad) * ROTATE_HANDLE_OFFSET_MM,
            centroid.y + Math.sin(rad) * ROTATE_HANDLE_OFFSET_MM,
            2.2,
        );
    }, [centroid, pattern.transform.rotationDeg]);

    const outlineColor = isEditing
        ? gesture === "outline" && isDragging
            ? "#06b6d4"
            : "#0ea5e9"
        : "#475569";
    const tubeRadius = isEditing ? 0.5 : 0.3;
    const pickRadius = isEditing ? TRIMLINE_PICK_RADIUS_EDIT : TRIMLINE_PICK_RADIUS_IDLE;

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

    const flushDraft = useCallback(() => {
        rafRef.current = null;
        const pending = pendingRef.current;
        if (!pending) return;
        const current = patternRef.current;
        if (pending.kind === "outline" && pending.delta) {
            const deformed = deformTrimlineSectionMulti(
                baseOutlineRef.current,
                anchorIndicesRef.current,
                pending.delta,
                INFLUENCE_RADIUS,
                { skipIndices: lockedRef.current },
            );
            const snapped = applyTopOutlineLockZone(deformed, topOutline, lockedRef.current);
            setBottomPatternDraft(setBottomPatternOutline(current, { points: snapped }));
            return;
        }
        if (pending.kind === "translate" && pending.translation) {
            setBottomPatternDraft({
                ...cloneBottomPattern(current),
                transform: {
                    ...startTransformRef.current,
                    x: startTransformRef.current.x + pending.translation.x,
                    y: startTransformRef.current.y + pending.translation.y,
                },
            });
            return;
        }
        if (pending.kind === "rotate" && pending.rotationDeg !== undefined) {
            setBottomPatternDraft({
                ...cloneBottomPattern(current),
                transform: {
                    ...startTransformRef.current,
                    rotationDeg: startTransformRef.current.rotationDeg + pending.rotationDeg,
                },
            });
        }
    }, [setBottomPatternDraft, topOutline]);

    const hitLocal = useCallback(
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
            return worldHit.applyMatrix4(worldToLocalRef.current);
        },
        [camera, gl.domElement, raycaster],
    );

    const handleWindowMove = useCallback(
        (ev: PointerEvent) => {
            const local = hitLocal(ev.clientX, ev.clientY);
            if (!local) return;
            const g = pendingRef.current?.kind;
            if (g === "outline") {
                const aLocal = anchorWorldRef.current.clone().applyMatrix4(worldToLocalRef.current);
                pendingRef.current = { kind: "outline", delta: local.clone().sub(aLocal) };
            } else if (g === "translate") {
                const aLocal = anchorWorldRef.current.clone().applyMatrix4(worldToLocalRef.current);
                pendingRef.current = {
                    kind: "translate",
                    translation: { x: local.x - aLocal.x, y: local.y - aLocal.y },
                };
            } else if (g === "rotate") {
                const c = startCentroidLocalRef.current;
                const aLocal = anchorWorldRef.current.clone().applyMatrix4(worldToLocalRef.current);
                const startAng = Math.atan2(aLocal.y - c.y, aLocal.x - c.x);
                const nowAng = Math.atan2(local.y - c.y, local.x - c.x);
                const deltaDeg = ((nowAng - startAng) * 180) / Math.PI;
                // Keep delta continuous-ish for a single gesture (no unwrapping needed for UX).
                pendingRef.current = { kind: "rotate", rotationDeg: deltaDeg };
            }
            if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushDraft);
        },
        [flushDraft, hitLocal],
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
            pendingRef.current = null;
            setBottomPatternDragging(false);
            setBottomPatternGesture(null);
            setInteracting(false);
            if (ev) {
                try {
                    gl.domElement.releasePointerCapture(ev.pointerId);
                } catch {
                    // already released
                }
            }
        },
        [
            flushDraft,
            gl.domElement,
            handleWindowMove,
            setBottomPatternDragging,
            setBottomPatternGesture,
            setInteracting,
        ],
    );

    const beginGesture = useCallback(
        (
            e: ThreeEvent<PointerEvent>,
            kind: "outline" | "translate" | "rotate",
            anchorIndex: number | null,
        ) => {
            const worldMatrix = getWorldMatrix();
            worldToLocalRef.current = worldMatrix.clone().invert();
            anchorWorldRef.current.copy(e.point);
            startTransformRef.current = { ...pattern.transform };
            startCentroidLocalRef.current.set(centroid.x, centroid.y, 0);
            pendingRef.current = { kind };
            if (kind === "outline") {
                // Deform local (pre-transform) outline; convert world delta → local via inverse rotation.
                baseOutlineRef.current = bottomPatternOutlineCurve(pattern).points.map((p) => p.clone());
                anchorIndexRef.current = anchorIndex ?? 0;
            }
            const normal = camera.getWorldDirection(new THREE.Vector3());
            dragPlaneRef.current.setFromNormalAndCoplanarPoint(normal, e.point);
            const startLocal = projectToFootprintPlane(e.point, worldMatrix);
            setBottomPatternGesture(kind, {
                anchorIndex,
                startLocal,
                startTransform: pattern.transform,
            });
            setBottomPatternDragging(true);
            setInteracting(true, "trimline");
            try {
                gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
            } catch {
                // best-effort
            }
            window.addEventListener("pointermove", handleWindowMove);
            window.addEventListener("pointerup", endDrag);
            window.addEventListener("pointercancel", endDrag);
        },
        [
            camera,
            centroid.x,
            centroid.y,
            endDrag,
            getWorldMatrix,
            gl.domElement,
            handleWindowMove,
            pattern,
            setBottomPatternDragging,
            setBottomPatternGesture,
            setInteracting,
        ],
    );

    // Outline reshape: world delta must be rotated into local outline space.
    const handleOutlineMove = useCallback(
        (ev: PointerEvent) => {
            const local = hitLocal(ev.clientX, ev.clientY);
            if (!local || pendingRef.current?.kind !== "outline") return;
            const aLocal = anchorWorldRef.current.clone().applyMatrix4(worldToLocalRef.current);
            const worldDelta = local.clone().sub(aLocal);
            const rad = (-startTransformRef.current.rotationDeg * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const localDelta = new THREE.Vector3(
                worldDelta.x * cos - worldDelta.y * sin,
                worldDelta.x * sin + worldDelta.y * cos,
                0,
            );
            pendingRef.current = { kind: "outline", delta: localDelta };
            if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushDraft);
        },
        [flushDraft, hitLocal],
    );

    // Swap window move listener for outline so rotation is inverted correctly.
    const beginOutlineGesture = useCallback(
        (e: ThreeEvent<PointerEvent>, anchorIndex: number, shiftKey: boolean) => {
            if (lockedRef.current.has(anchorIndex)) return;

            if (shiftKey) {
                // Multi-select toggle only — no drag start.
                setSelectedIndices((prev) =>
                    prev.includes(anchorIndex)
                        ? prev.filter((i) => i !== anchorIndex)
                        : [...prev, anchorIndex],
                );
                return;
            }

            const anchors = (
                selectedIndices.includes(anchorIndex) && selectedIndices.length > 0
                    ? selectedIndices
                    : [anchorIndex]
            ).filter((i) => !lockedRef.current.has(i));
            anchorIndicesRef.current = anchors.length > 0 ? anchors : [anchorIndex];
            setSelectedIndices(anchorIndicesRef.current);

            const worldMatrix = getWorldMatrix();
            worldToLocalRef.current = worldMatrix.clone().invert();
            anchorWorldRef.current.copy(e.point);
            startTransformRef.current = { ...pattern.transform };
            baseOutlineRef.current = bottomPatternOutlineCurve(pattern).points.map((p) => p.clone());
            pendingRef.current = { kind: "outline" };
            const normal = camera.getWorldDirection(new THREE.Vector3());
            dragPlaneRef.current.setFromNormalAndCoplanarPoint(normal, e.point);
            const startLocal = projectToFootprintPlane(e.point, worldMatrix);
            setBottomPatternGesture("outline", {
                anchorIndex,
                startLocal,
                startTransform: pattern.transform,
            });
            setBottomPatternDragging(true);
            setInteracting(true, "trimline");
            try {
                gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
            } catch {
                // best-effort
            }
            const endOutline = (ev?: PointerEvent) => {
                window.removeEventListener("pointermove", handleOutlineMove);
                window.removeEventListener("pointerup", endOutline);
                window.removeEventListener("pointercancel", endOutline);
                if (rafRef.current !== null) {
                    cancelAnimationFrame(rafRef.current);
                    rafRef.current = null;
                }
                flushDraft();
                pendingRef.current = null;
                setBottomPatternDragging(false);
                setBottomPatternGesture(null);
                setInteracting(false);
                if (ev) {
                    try {
                        gl.domElement.releasePointerCapture(ev.pointerId);
                    } catch {
                        // already released
                    }
                }
            };
            window.addEventListener("pointermove", handleOutlineMove);
            window.addEventListener("pointerup", endOutline);
            window.addEventListener("pointercancel", endOutline);
        },
        [
            camera,
            flushDraft,
            getWorldMatrix,
            gl.domElement,
            handleOutlineMove,
            pattern,
            selectedIndices,
            setBottomPatternDragging,
            setBottomPatternGesture,
            setInteracting,
        ],
    );

    const endDragRef = useRef(endDrag);
    endDragRef.current = endDrag;
    useEffect(() => () => endDragRef.current(), []);

    const frozenPickPointsRef = useRef(displayPoints);
    if (!isDragging) frozenPickPointsRef.current = displayPoints;
    const pickPoints = isDragging ? frozenPickPointsRef.current : displayPoints;
    const pickCatmull = useMemo(() => trimlineToCurve(pickPoints, true), [pickPoints]);
    const pickTubeGeo = useMemo(
        () => new THREE.TubeGeometry(pickCatmull, Math.max(48, pickPoints.length), pickRadius, 8, true),
        [pickCatmull, pickPoints.length, pickRadius],
    );
    useEffect(() => () => pickTubeGeo.dispose(), [pickTubeGeo]);

    const onPickPointerDown = useCallback(
        (e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            if (!isEditing) {
                onOutlineClick();
                return;
            }
            const local = projectToFootprintPlane(e.point, getWorldMatrix());
            const worldCurve = { points: worldPoints };
            const idx = pickTrimlineAnchorIndex(local, worldCurve);
            if (lockedIndices.has(idx)) return;
            beginOutlineGesture(e, idx, e.nativeEvent.shiftKey);
        },
        [beginOutlineGesture, getWorldMatrix, isEditing, lockedIndices, onOutlineClick, worldPoints],
    );

    return (
        <group ref={groupRef} position={[-CENTER_X, offsetY, 0]}>
            <mesh renderOrder={100} geometry={pickTubeGeo} onPointerDown={onPickPointerDown}>
                <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
            </mesh>

            <BottomPatternVisual points={displayPoints} color={outlineColor} tubeRadius={tubeRadius} />

            {isEditing
                ? worldPoints.map((p, i) => {
                      const locked = lockedIndices.has(i);
                      const selected = selectedIndices.includes(i);
                      return (
                          <mesh
                              // biome-ignore lint/suspicious/noArrayIndexKey: control points are a fixed-order ring
                              key={i}
                              position={[p.x, p.y, p.z + 2.2]}
                              renderOrder={101}
                              onPointerDown={(e) => {
                                  e.stopPropagation();
                                  if (locked) return;
                                  beginOutlineGesture(e, i, e.nativeEvent.shiftKey);
                              }}
                          >
                              <sphereGeometry args={[locked ? 1.4 : 1.8, 10, 10]} />
                              <meshBasicMaterial
                                  color={
                                      locked
                                          ? "#94a3b8"
                                          : selected
                                            ? "#f472b6"
                                            : gesture === "outline" && isDragging
                                              ? "#22d3ee"
                                              : "#38bdf8"
                                  }
                                  depthTest={false}
                                  transparent={locked}
                                  opacity={locked ? 0.55 : 1}
                              />
                          </mesh>
                      );
                  })
                : null}

            {/* Translate handle — box at centroid; distinct from outline spheres */}
            {isEditing ? (
                <mesh
                    position={[centroid.x, centroid.y, centroid.z]}
                    renderOrder={102}
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        beginGesture(e, "translate", null);
                    }}
                >
                    <boxGeometry args={[5, 5, 5]} />
                    <meshBasicMaterial
                        color={gesture === "translate" && isDragging ? "#a855f7" : "#c084fc"}
                        depthTest={false}
                    />
                </mesh>
            ) : null}

            {/* Rotate handle — torus offset from centroid */}
            {isEditing ? (
                <mesh
                    position={[rotateHandlePos.x, rotateHandlePos.y, rotateHandlePos.z]}
                    renderOrder={102}
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        beginGesture(e, "rotate", null);
                    }}
                >
                    <torusGeometry args={[2.4, 0.7, 8, 16]} />
                    <meshBasicMaterial
                        color={gesture === "rotate" && isDragging ? "#f59e0b" : "#fbbf24"}
                        depthTest={false}
                    />
                </mesh>
            ) : null}

            {isEditing && isDragging && gesture === "outline" ? (
                <BottomPatternVisual points={displayPoints} color="#22d3ee" tubeRadius={0.65} dashed />
            ) : null}
        </group>
    );
}

function BottomPatternVisual({
    points,
    color,
    tubeRadius = 0.45,
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
