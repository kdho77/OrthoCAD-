import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
    Activity,
    Box,
    Eye,
    EyeOff,
    Layers,
    Maximize2,
    Move,
    PencilLine,
    PenTool,
    Rotate3d,
    Scale3d,
    Scissors,
    X,
} from "lucide-react";
import { Suspense, useRef } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Button } from "@/components/ui/button";
import { hasActiveModifiers, resolveDesignMode } from "@/lib/geometry/base-modifier";
import { cn } from "@/lib/utils";
import { type CameraView, useDesignStore, type ViewerSettings } from "@/stores/design-store";
import { useKernelStore } from "@/stores/kernel-store";
import { type MeshEditTarget, useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { Side } from "@/types";
import { BaseInsoleMesh } from "./BaseInsoleMesh";
import { BottomPatternEditTools } from "./BottomPatternEditTools";
import { ElementMarkers } from "./ElementMarkers";
import { InsoleMesh } from "./InsoleMesh";
import { MeshEditTools } from "./MeshEditTools";
import { PerformanceMonitorOverlay } from "./PerformanceMonitor";
import { ScanMeshes } from "./ScanMeshes";
import { TrimlineEditTools } from "./TrimlineEditTools";

const VIEWS: { name: CameraView; label: string; pos: [number, number, number] }[] = [
    { name: "iso", label: "Orbit", pos: [220, 200, 260] },
    { name: "front", label: "Front", pos: [0, 40, 360] },
    { name: "back", label: "Back", pos: [0, 40, -360] },
    { name: "left", label: "Left", pos: [-360, 40, 0] },
    { name: "right", label: "Right", pos: [360, 40, 0] },
    { name: "top", label: "Top", pos: [0, 400, 0.001] },
    { name: "bottom", label: "Bottom", pos: [0, -400, 0.001] },
];

const VIEW_LABELS: Record<CameraView, string> = {
    iso: "Orbit",
    front: "Front",
    back: "Back",
    left: "Left",
    right: "Right",
    top: "Top",
    bottom: "Bottom",
};

/** Active insole side for mesh edits when both feet are visible in the single workspace. */
function resolveDefaultEditSide(viewer: ViewerSettings, target: MeshEditTarget | null): Side {
    if (target?.type === "insole") return target.side;
    if (viewer.showLeft && !viewer.showRight) return "left";
    if (viewer.showRight && !viewer.showLeft) return "right";
    return "left";
}

export function Viewer3D() {
    const controls = useRef<OrbitControlsImpl>(null);
    const kernelName = useKernelStore((s) => s.name);
    const { design, viewer, setViewer, selectedElementId, transformMode, setTransformMode, selectElement } =
        useDesignStore();
    const editMode = useMeshEditStore((s) => s.editMode);
    const setEditMode = useMeshEditStore((s) => s.setEditMode);
    const setTarget = useMeshEditStore((s) => s.setTarget);
    const beginTrimlineEdit = useMeshEditStore((s) => s.beginTrimlineEdit);
    const target = useMeshEditStore((s) => s.target);
    const trimlineEdit = useMeshEditStore((s) => s.trimlineEdit);
    const confirmTrimlineEdit = useMeshEditStore((s) => s.confirmTrimlineEdit);
    const cancelTrimlineEdit = useMeshEditStore((s) => s.cancelTrimlineEdit);
    const bottomPatternEdit = useMeshEditStore((s) => s.bottomPatternEdit);
    const beginBottomPatternEdit = useMeshEditStore((s) => s.beginBottomPatternEdit);
    const confirmBottomPatternEdit = useMeshEditStore((s) => s.confirmBottomPatternEdit);
    const cancelBottomPatternEdit = useMeshEditStore((s) => s.cancelBottomPatternEdit);
    const editSide = resolveDefaultEditSide(viewer, target);
    const designMode = resolveDesignMode(design);
    const showBase = designMode.mode === "base";
    const modifiersActive = hasActiveModifiers(design);
    const showPerf = usePerformanceStore((s) => s.showPerformanceMonitor);
    const setShowPerf = usePerformanceStore((s) => s.setShowPerformanceMonitor);
    const interacting = usePerformanceStore((s) => s.interacting);

    const setView = (name: CameraView, pos: [number, number, number]) => {
        const c = controls.current;
        if (c) {
            c.object.position.set(...pos);
            c.target.set(0, 0, 0);
            c.object.up.set(0, 1, 0);
            c.update();
        }
        setViewer({ view: name });
    };

    return (
        <div className="relative h-full w-full bg-[hsl(222_28%_7%)]">
            <Canvas
                shadows
                dpr={[1, 1.5]}
                camera={{
                    position: [220, 200, 260],
                    fov: 40,
                    near: 1,
                    far: 5000,
                }}
                onPointerMissed={() => {
                    selectElement(null);
                    setTarget({ type: "insole", side: editSide });
                }}
                onClick={() => setTarget({ type: "insole", side: editSide })}
            >
                <color attach="background" args={["#0c111b"]} />
                <ambientLight intensity={0.6} />
                <directionalLight position={[150, 300, 200]} intensity={1.1} castShadow />
                <directionalLight position={[-150, 100, -100]} intensity={0.4} />

                <Suspense fallback={null}>
                    {viewer.showLeft ? (
                        <>
                            {!showBase ? (
                                <InsoleMesh
                                    side="left"
                                    design={design}
                                    transparent={viewer.transparent}
                                    heightmap={viewer.heightmap}
                                />
                            ) : (
                                <BaseInsoleMesh side="left" transparent={viewer.transparent} />
                            )}
                        </>
                    ) : null}
                    {viewer.showRight ? (
                        <>
                            {!showBase ? (
                                <InsoleMesh
                                    side="right"
                                    design={design}
                                    transparent={viewer.transparent}
                                    heightmap={viewer.heightmap}
                                />
                            ) : (
                                <BaseInsoleMesh side="right" transparent={viewer.transparent} />
                            )}
                        </>
                    ) : null}
                    <ScanMeshes transparent={viewer.transparent} />
                    <ElementMarkers />
                    <MeshEditTools />
                    <TrimlineEditTools />
                    <BottomPatternEditTools />
                    <PerformanceMonitorOverlay />
                </Suspense>

                <Grid
                    args={[1000, 1000]}
                    cellSize={10}
                    cellThickness={0.5}
                    cellColor="#1e293b"
                    sectionSize={50}
                    sectionThickness={1}
                    sectionColor="#334155"
                    fadeDistance={900}
                    infiniteGrid
                    position={[0, -0.1, 0]}
                />
                <OrbitControls
                    ref={controls}
                    makeDefault
                    enableDamping
                    dampingFactor={0.1}
                    enabled={!trimlineEdit?.isDragging && !bottomPatternEdit?.isDragging}
                />
            </Canvas>

            {/* View buttons */}
            <div className="absolute left-3 top-3 flex max-w-[220px] flex-wrap gap-1">
                {VIEWS.map((v) => (
                    <Button
                        key={v.name}
                        size="sm"
                        variant={viewer.view === v.name ? "default" : "secondary"}
                        className="h-7"
                        onClick={() => setView(v.name, v.pos)}
                    >
                        {v.label}
                    </Button>
                ))}
            </div>

            {/* Active view + edit-mode indicator */}
            <div className="pointer-events-none absolute left-3 top-12 flex flex-col gap-1">
                <span className="w-fit rounded bg-panel/80 px-2 py-0.5 text-[11px] font-medium text-foreground shadow backdrop-blur">
                    {VIEW_LABELS[viewer.view]} view
                </span>
                {/* Base vs parametric mode — makes it clear the user is modifying a base. */}
                {designMode.mode === "base" ? (
                    <span className="flex w-fit items-center gap-1 rounded bg-violet-500/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                        <Layers className="h-3 w-3" />
                        Base: {designMode.baseName ?? "custom GLB"}
                        {modifiersActive ? " · modifiers applied" : ""}
                    </span>
                ) : (
                    <span className="flex w-fit items-center gap-1 rounded bg-sky-500/85 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                        <PenTool className="h-3 w-3" />
                        Parametric mode
                    </span>
                )}
                {editMode === "edit-trimline" && trimlineEdit ? (
                    <span className="w-fit rounded bg-orange-500/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                        Editing trimline · {trimlineEdit.side}
                        {viewer.view !== "iso" ? " · plane-locked" : ""}
                    </span>
                ) : null}
                {editMode === "edit-bottom-pattern" && bottomPatternEdit ? (
                    <span className="w-fit rounded bg-sky-600/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                        Editing bottom pattern · {bottomPatternEdit.side}
                        {bottomPatternEdit.gesture ? ` · ${bottomPatternEdit.gesture}` : ""}
                    </span>
                ) : null}
            </div>

            {/* Display toggles */}
            <div className="absolute right-3 top-3 flex flex-col gap-1">
                <ToggleButton
                    active={viewer.transparent}
                    onClick={() => setViewer({ transparent: !viewer.transparent })}
                    icon={<Maximize2 className="h-3.5 w-3.5" />}
                    label="Transparent"
                />
                <ToggleButton
                    active={viewer.heightmap}
                    onClick={() => setViewer({ heightmap: !viewer.heightmap })}
                    icon={<Layers className="h-3.5 w-3.5" />}
                    label="Heightmap"
                />
                <ToggleButton
                    active={viewer.showLeft}
                    onClick={() => setViewer({ showLeft: !viewer.showLeft })}
                    icon={
                        viewer.showLeft ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />
                    }
                    label="Left"
                />
                <ToggleButton
                    active={viewer.showRight}
                    onClick={() => setViewer({ showRight: !viewer.showRight })}
                    icon={
                        viewer.showRight ? (
                            <Eye className="h-3.5 w-3.5" />
                        ) : (
                            <EyeOff className="h-3.5 w-3.5" />
                        )
                    }
                    label="Right"
                />
                <ToggleButton
                    active={showPerf}
                    onClick={() => setShowPerf(!showPerf)}
                    icon={<Activity className="h-3.5 w-3.5" />}
                    label="FPS Monitor"
                />
            </div>

            {/* Element / mesh edit toolbar */}
            {selectedElementId ? (
                <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-panel/90 p-1 shadow-lg backdrop-blur">
                    <ModeButton
                        active={editMode === "transform" && transformMode === "translate"}
                        onClick={() => {
                            setEditMode("transform");
                            setTransformMode("translate");
                        }}
                        icon={<Move className="h-3.5 w-3.5" />}
                        label="Move"
                    />
                    <ModeButton
                        active={editMode === "transform" && transformMode === "rotate"}
                        onClick={() => {
                            setEditMode("transform");
                            setTransformMode("rotate");
                        }}
                        icon={<Rotate3d className="h-3.5 w-3.5" />}
                        label="Rotate"
                    />
                    <ModeButton
                        active={editMode === "transform" && transformMode === "scale"}
                        onClick={() => {
                            setEditMode("transform");
                            setTransformMode("scale");
                        }}
                        icon={<Scale3d className="h-3.5 w-3.5" />}
                        label="Scale"
                    />
                    <ModeButton
                        active={editMode === "trim"}
                        onClick={() => {
                            setEditMode("trim");
                            setTarget({ type: "element", id: selectedElementId });
                        }}
                        icon={<Scissors className="h-3.5 w-3.5" />}
                        label="Trim"
                    />
                    <ModeButton
                        active={editMode === "vertex"}
                        onClick={() => {
                            setEditMode("vertex");
                            setTarget({ type: "element", id: selectedElementId });
                        }}
                        icon={<PenTool className="h-3.5 w-3.5" />}
                        label="Vertex"
                    />
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => selectElement(null)}>
                        <X className="h-3.5 w-3.5" />
                    </Button>
                </div>
            ) : (
                <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-panel/90 p-1 shadow-lg backdrop-blur">
                    <ModeButton
                        active={editMode === "edit-trimline"}
                        onClick={() => beginTrimlineEdit(editSide)}
                        icon={<PencilLine className="h-3.5 w-3.5" />}
                        label="Edit trimline"
                    />
                    <ModeButton
                        active={editMode === "edit-bottom-pattern"}
                        onClick={() => beginBottomPatternEdit(editSide)}
                        icon={<Layers className="h-3.5 w-3.5" />}
                        label="Bottom pattern"
                    />
                    <ModeButton
                        active={editMode === "trim"}
                        onClick={() => {
                            setEditMode("trim");
                            setTarget({ type: "insole", side: editSide });
                        }}
                        icon={<Scissors className="h-3.5 w-3.5" />}
                        label="Trim"
                    />
                    <ModeButton
                        active={editMode === "vertex"}
                        onClick={() => {
                            setEditMode("vertex");
                            setTarget({ type: "insole", side: editSide });
                        }}
                        icon={<PenTool className="h-3.5 w-3.5" />}
                        label="Vertex"
                    />
                    {editMode === "edit-trimline" && trimlineEdit ? (
                        <>
                            <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-[11px]"
                                onClick={confirmTrimlineEdit}
                            >
                                Confirm
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[11px]"
                                onClick={cancelTrimlineEdit}
                            >
                                Cancel
                            </Button>
                        </>
                    ) : null}
                    {editMode === "edit-bottom-pattern" && bottomPatternEdit ? (
                        <>
                            <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-[11px]"
                                onClick={confirmBottomPatternEdit}
                            >
                                Confirm
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[11px]"
                                onClick={cancelBottomPatternEdit}
                            >
                                Cancel
                            </Button>
                        </>
                    ) : null}
                </div>
            )}

            <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Box className="h-3.5 w-3.5" />
                {interacting ? "Preview mesh · " : ""}
                {kernelName === "opencascade-wasm" ? "OpenCascade WASM" : "Procedural worker"} kernel · ⌘P Rx
                · ⌘E export · T transparent · Esc deselect
            </div>
        </div>
    );
}

function ModeButton({
    active,
    onClick,
    icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}) {
    return (
        <Button size="sm" variant={active ? "default" : "ghost"} className="h-7" onClick={onClick}>
            {icon}
            {label}
        </Button>
    );
}

function ToggleButton({
    active,
    onClick,
    icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}) {
    return (
        <Button
            size="sm"
            variant={active ? "default" : "secondary"}
            onClick={onClick}
            className={cn("h-7 w-32 justify-start", !active && "opacity-80")}
        >
            {icon}
            {label}
        </Button>
    );
}
