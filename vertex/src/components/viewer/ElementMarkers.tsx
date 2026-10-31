import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { BufferGeometry, DoubleSide, Shape, ShapeGeometry, Vector3 } from "three";
import type {
    OrbitControls as OrbitControlsImpl,
    TransformControls as TransformControlsImpl,
} from "three-stdlib";
import { getBaseCacheKey, getDesignBase } from "@/lib/geometry/base-asset";
import { gizmoElementScale } from "@/lib/geometry/element-scale";
import { sideOffsetX } from "@/lib/geometry/layout";
import { sinksForSide } from "@/lib/geometry/migrate-corrections";
import { SAMPLE_TOP_ASSET_ID } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import type { SinkOutlinePoint } from "@/lib/geometry/sink";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { DesignState, PlacedElement, Side } from "@/types";
import {
    elementFootprintPose,
    type FootprintPose,
    footprintStyle,
    footprintSurfaceZ,
    isLibrarySinkElement,
    sinkFootprintPose,
} from "./element-footprints";

/**
 * Elements-step viewer overlay.
 *
 * Each placed sink (MPJ, styloid, heel, navicular) is a semi-transparent
 * magenta planform on the insole top. The selected sink is brighter. Wedges
 * and pads are not drawn. Visible from the Top and Bottom cameras. The move
 * gizmo is still only the selected library element. Nothing here is exported.
 */
export function ElementMarkers() {
    const print = useClinicalWorkflowStore((s) => s.step === "print" || s.step === "export");
    const elements = useDesignStore((s) => s.design.elements);
    const selectedId = useDesignStore((s) => s.selectedElementId);
    const usMenSize = useDesignStore((s) => s.design.usMenSize);
    const sizeSystem = useDesignStore((s) => s.design.sizeSystem);
    const ukSize = useDesignStore((s) => s.design.ukSize);
    const footLengthMm = useDesignStore((s) => s.design.footLengthMm);
    const layout = insoleLayoutFromDesign({ sizeSystem, usMenSize, ukSize, footLengthMm });
    const centerX = layout.lengthMm / 2;

    const selected = useMemo(() => elements.find((e) => e.id === selectedId) ?? null, [elements, selectedId]);

    if (print) return null;

    return (
        <>
            <ElementFootprints />
            {selected ? (
                <SelectedElementGizmo element={selected} centerX={centerX} widthMm={layout.widthMm} />
            ) : null}
        </>
    );
}

function outlineGeometry(pts: { x: number; y: number }[]): ShapeGeometry {
    const shape = new Shape();
    const first = pts[0];
    if (!first) {
        shape.absellipse(0, 0, 8, 8, 0, Math.PI * 2, false, 0);
    } else {
        shape.moveTo(first.x, first.y);
        for (let i = 1; i < pts.length; i++) {
            const p = pts[i];
            if (p) shape.lineTo(p.x, p.y);
        }
        shape.closePath();
    }
    return new ShapeGeometry(shape);
}

function FootprintPatch({
    pose,
    z,
    selected,
    onSelect,
}: {
    pose: FootprintPose;
    z: number;
    selected: boolean;
    onSelect: () => void;
}) {
    const style = footprintStyle(selected);
    const outlineKey = pose.outline.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(";");
    // outlineKey serializes pose.outline so a new array with the same coordinates does not rebuild.
    // biome-ignore lint/correctness/useExhaustiveDependencies: outlineKey serializes pose.outline
    const { fill, ring } = useMemo(() => {
        const fillGeo = outlineGeometry(pose.outline);
        const ringGeo = new BufferGeometry().setFromPoints(
            pose.outline.map((p) => new Vector3(p.x, p.y, 0.2)),
        );
        return { fill: fillGeo, ring: ringGeo };
    }, [outlineKey]);
    useEffect(
        () => () => {
            fill.dispose();
            ring.dispose();
        },
        [fill, ring],
    );
    return (
        <group position={[pose.x, pose.y, z]} rotation={[0, 0, (pose.rotationDeg * Math.PI) / 180]}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: R3F mesh pick target */}
            <mesh
                geometry={fill}
                name={`element-footprint:${pose.kind}:${pose.id}:${style.color}:${pose.x.toFixed(1)}:${pose.halfLengthMm.toFixed(1)}`}
                renderOrder={selected ? 6 : 4}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                }}
            >
                <meshBasicMaterial
                    color={style.color}
                    transparent
                    opacity={style.opacity}
                    depthTest={false}
                    depthWrite={false}
                    side={DoubleSide}
                    toneMapped={false}
                />
            </mesh>
            <lineLoop geometry={ring} renderOrder={selected ? 7 : 5}>
                <lineBasicMaterial
                    color={style.edge}
                    transparent
                    opacity={1}
                    depthTest={false}
                    depthWrite={false}
                />
            </lineLoop>
        </group>
    );
}

function sinkOutlineForSide(
    design: DesignState,
    side: Side,
    outlines: ReturnType<typeof useBaseOutlineStore.getState>["outlines"],
): SinkOutlinePoint[] | null {
    const wallModel = design.viewer?.wallModel ?? "procedural";
    const base = getDesignBase(design, side);
    const proceduralKey =
        wallModel === "procedural" && base
            ? `${SAMPLE_TOP_ASSET_ID}:${side}:${base.mirrored ? "m" : "p"}`
            : null;
    const baseKey = getBaseCacheKey(base) ?? base?.assetId ?? null;
    const curve = (proceduralKey ? outlines[proceduralKey] : null) ?? (baseKey ? outlines[baseKey] : null);
    if (!curve || curve.points.length < 6) return null;
    return curve.points.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Semi-transparent sink planforms. Drawn in the same Rx(−90°) frame as the
 * insole so Top and Bottom both see the patch. Wedges and pads are skipped.
 */
export function ElementFootprints() {
    const design = useDesignStore((s) => s.design);
    const selectedId = useDesignStore((s) => s.selectedElementId);
    const selectElement = useDesignStore((s) => s.selectElement);
    const showLeft = useDesignStore((s) => s.viewer.showLeft);
    const showRight = useDesignStore((s) => s.viewer.showRight);
    const previews = usePerformanceStore((s) => s.elementPreviews);
    const outlines = useBaseOutlineStore((s) => s.outlines);
    const [selectedSink, setSelectedSink] = useState<string | null>(null);
    const layout = insoleLayoutFromDesign(design);
    const centerX = layout.lengthMm / 2;

    useEffect(() => {
        if (selectedId) setSelectedSink(null);
    }, [selectedId]);

    const librarySinks = useMemo(
        () =>
            design.elements.flatMap((element) => {
                if (!isLibrarySinkElement(element)) return [];
                const preview = previews[element.id];
                if (!preview) return [element];
                return [
                    {
                        ...element,
                        ...(preview.position ? { position: preview.position } : {}),
                        ...(preview.rotationDeg !== undefined ? { rotationDeg: preview.rotationDeg } : {}),
                        ...(preview.scale ? { scale: preview.scale } : {}),
                        ...(preview.heightMm !== undefined ? { heightMm: preview.heightMm } : {}),
                    },
                ];
            }),
        [design.elements, previews],
    );

    const visible = (side: Side) => (side === "left" ? showLeft : showRight);
    const sides = (["left", "right"] as const).filter(visible);
    const anyPlacedSink = sides.some((side) => (sinksForSide(design, side)?.length ?? 0) > 0);
    const anyLibrarySink = librarySinks.some((element) => visible(element.side));
    if (sides.length === 0 || (!anyLibrarySink && !anyPlacedSink)) return null;

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            {sides.map((side) => {
                const poses: FootprintPose[] = [];
                for (const element of librarySinks) {
                    if (element.side !== side) continue;
                    poses.push(elementFootprintPose(element, layout.lengthMm));
                }
                const footOutline = sinkOutlineForSide(design, side, outlines);
                for (const sink of sinksForSide(design, side) ?? []) {
                    const pose = sinkFootprintPose(sink, side, layout.lengthMm, layout.widthMm, footOutline);
                    if (pose) poses.push(pose);
                }
                if (poses.length === 0) return null;
                return (
                    <group key={side} position={[-centerX, sideOffsetX(side, layout.widthMm), 0]}>
                        {poses.map((pose) => {
                            const sinkKey = `${side}:${pose.id}`;
                            const selected =
                                pose.kind === "element"
                                    ? selectedId === pose.id
                                    : selectedId == null && selectedSink === sinkKey;
                            return (
                                <FootprintPatch
                                    key={`${pose.kind}:${pose.id}`}
                                    pose={pose}
                                    z={footprintSurfaceZ(
                                        design,
                                        side,
                                        pose.x,
                                        pose.y,
                                        layout.lengthMm,
                                        layout.widthMm,
                                    )}
                                    selected={selected}
                                    onSelect={() => {
                                        if (pose.kind === "element") {
                                            setSelectedSink(null);
                                            selectElement(pose.id);
                                        } else {
                                            selectElement(null);
                                            setSelectedSink(sinkKey);
                                        }
                                    }}
                                />
                            );
                        })}
                    </group>
                );
            })}
        </group>
    );
}

function SelectedElementGizmo({
    element,
    centerX,
    widthMm,
}: {
    element: PlacedElement;
    centerX: number;
    widthMm: number;
}) {
    const [node, setNode] = useState<THREE_NS.Group | null>(null);
    const controlsRef = useRef<TransformControlsImpl>(null);
    const mode = useDesignStore((s) => s.transformMode);
    const editMode = useMeshEditStore((s) => s.editMode);
    const updateElement = useDesignStore((s) => s.updateElement);
    const setInteracting = usePerformanceStore((s) => s.setInteracting);
    const setElementPreview = usePerformanceStore((s) => s.setElementPreview);
    const clearElementPreview = usePerformanceStore((s) => s.clearElementPreview);
    const orbitControls = useThree((s) => s.controls);

    const zTop = element.heightMm + 4;

    const previewFrame = useRef<number | null>(null);
    const cancelPreview = useCallback(() => {
        if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
        previewFrame.current = null;
    }, []);
    useEffect(
        () => () => {
            cancelPreview();
            clearElementPreview(element.id);
        },
        [cancelPreview, clearElementPreview, element.id],
    );

    const readTransform = useCallback(() => {
        if (!node) return null;
        const scale =
            mode === "scale"
                ? gizmoElementScale(element.scale, node.scale, element.scaleLocked !== false)
                : element.scale;
        // Keep the handles and rendered preview on the same constrained XY scale.
        node.scale.set(scale.x, scale.y, 1);
        return {
            id: element.id,
            position: { x: node.position.x - centerX, y: node.position.y },
            rotationDeg: (node.rotation.z * 180) / Math.PI,
            scale,
        };
    }, [node, mode, element.scale, element.scaleLocked, element.id, centerX]);

    const commitTransform = useCallback(() => {
        cancelPreview();
        const patch = readTransform();
        if (patch) updateElement(element.id, patch);
        clearElementPreview(element.id);
    }, [cancelPreview, readTransform, element.id, updateElement, clearElementPreview]);

    const previewTransform = useCallback(() => {
        // Constrain immediately, then throttle only the expensive geometry preview.
        const patch = readTransform();
        if (!patch) return;
        cancelPreview();
        previewFrame.current = requestAnimationFrame(() => {
            previewFrame.current = null;
            setElementPreview(element.id, patch);
        });
    }, [readTransform, cancelPreview, setElementPreview, element.id]);

    const onDraggingChanged = useCallback(
        (dragging: boolean) => {
            if (orbitControls) {
                (orbitControls as OrbitControlsImpl).enabled = !dragging;
            }
            setInteracting(dragging, "gizmo");
            if (!dragging) commitTransform();
        },
        [orbitControls, setInteracting, commitTransform],
    );

    useEffect(() => {
        if (!node || editMode !== "transform") return;
        const tc = controlsRef.current;
        if (!tc) return;
        const handler = (event: { value?: boolean }) => {
            onDraggingChanged(Boolean(event.value));
        };
        const emitter = tc as unknown as {
            addEventListener(type: string, listener: (event: { value?: boolean }) => void): void;
            removeEventListener(type: string, listener: (event: { value?: boolean }) => void): void;
        };
        emitter.addEventListener("dragging-changed", handler);
        return () => emitter.removeEventListener("dragging-changed", handler);
    }, [onDraggingChanged, node, editMode]);

    return (
        <>
            <group rotation={[-Math.PI / 2, 0, 0]}>
                <group position={[-centerX, sideOffsetX(element.side, widthMm), 0]}>
                    <group
                        ref={setNode}
                        position={[centerX + element.position.x, element.position.y, zTop]}
                        rotation={[0, 0, (element.rotationDeg * Math.PI) / 180]}
                        scale={[element.scale.x, element.scale.y, 1]}
                    />
                </group>
            </group>
            {node && editMode === "transform" ? (
                <TransformControls
                    ref={controlsRef}
                    object={node}
                    mode={mode}
                    space="local"
                    size={0.6}
                    showZ={mode === "rotate"}
                    onObjectChange={previewTransform}
                />
            ) : null}
        </>
    );
}
