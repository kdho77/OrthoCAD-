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
import { applyCameraViewPreset, VIEW_CAMERA_POS } from "@/lib/geometry/viewport-side-layout";
import { cn } from "@/lib/utils";
import { type CameraView, useDesignStore, type ViewerSettings } from "@/stores/design-store";
import { useKernelStore } from "@/stores/kernel-store";
import { type MeshEditTarget, useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import { useScanStore } from "@/stores/scan-store";
import type { Side } from "@/types";
import { BaseInsoleMesh } from "./BaseInsoleMesh";
import { ElementMarkers } from "./ElementMarkers";
import { InsoleMesh } from "./InsoleMesh";
import { MeshEditTools } from "./MeshEditTools";
import { PerformanceMonitorOverlay } from "./PerformanceMonitor";
import { ScanMarkerPlacement } from "./ScanMarkerPlacement";
import { ScanMeshes } from "./ScanMeshes";
import { ScanPlaneSliceTool } from "./ScanPlaneSliceTool";
import { TrimlineEditTools } from "./TrimlineEditTools";

/** Cross-pad anatomical views (Left / Top / Bottom / Right). */
const CROSS_VIEWS = {
    left: { name: "left" as const, label: "Left" },
    top: { name: "top" as const, label: "Top" },
    bottom: { name: "bottom" as const, label: "Bottom" },
    right: { name: "right" as const, label: "Right" },
};

const VIEW_LABELS: Record<CameraView, string> = {
    iso: "Free",
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
    const editSide = resolveDefaultEditSide(viewer, target);
    const designMode = resolveDesignMode(design);
    const showBase = designMode.mode === "base";
    const modifiersActive = hasActiveModifiers(design);
    const showPerf = usePerformanceStore((s) => s.showPerformanceMonitor);
    const setShowPerf = usePerformanceStore((s) => s.setShowPerformanceMonitor);
    const interacting = usePerformanceStore((s) => s.interacting);
    // Hide stock/parametric insoles while placing scan alignment markers so the
    // foot scan is unobstructed for picking M1–M3. Viewer Left/Right prefs are preserved.
    const placingMarkers = useScanStore((s) => s.placementMode != null);
    const showLeftInsole = viewer.showLeft && !placingMarkers;
    const showRightInsole = viewer.showRight && !placingMarkers;
    const registrationStatus = useScanStore((s) => {
        const regs = Object.values(s.registrationByScanId);
        const failed = regs.find((r) => r.error);
        if (failed) return { kind: "error" as const, message: failed.error!.message };
        const ok = regs.find((r) => r.matrixElements && !r.incomplete && !r.error);
        if (ok) return { kind: "ok" as const, rms: ok.residualRmsMm };
        return null;
    });

    const setView = (name: CameraView) => {
        applyCameraViewPreset(controls.current, name);
        setViewer({ view: name });
    };

    return (
        <div className="relative h-full w-full bg-[hsl(222_28%_7%)]">
            <Canvas
                shadows
                dpr={[1, 1.5]}
                camera={{
                    position: VIEW_CAMERA_POS.iso,
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
                    {showLeftInsole ? (
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
                    {showRightInsole ? (
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
                    <ScanMarkerPlacement />
                    <ScanPlaneSliceTool />
                    {!placingMarkers ? <ElementMarkers /> : null}
                    <MeshEditTools />
                    <TrimlineEditTools />
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
                    enabled={!trimlineEdit?.isDragging}
                />
            </Canvas>

            {/* View buttons — cross pad: Left | Top/Bottom | Right */}
            <div
                className="absolute left-3 top-3 flex items-center gap-1"
                role="group"
                aria-label="Camera views"
            >
                <ViewButton
                    view={CROSS_VIEWS.left}
                    active={viewer.view === "left"}
                    onClick={setView}
                    className="w-[4.75rem]"
                />
                <div className="flex flex-col gap-1">
                    <ViewButton
                        view={CROSS_VIEWS.top}
                        active={viewer.view === "top"}
                        onClick={setView}
                        className="w-[3.75rem]"
                    />
                    <ViewButton
                        view={CROSS_VIEWS.bottom}
                        active={viewer.view === "bottom"}
                        onClick={setView}
                        className="w-[3.75rem]"
                    />
                </div>
                <ViewButton
                    view={CROSS_VIEWS.right}
                    active={viewer.view === "right"}
                    onClick={setView}
                    className="w-[4.75rem]"
                />
            </div>

            {/* Active view + edit-mode indicator (below the view pad) */}
            <div className="pointer-events-none absolute left-3 top-[5.5rem] flex flex-col gap-1">
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
                {placingMarkers ? (
                    <span className="w-fit rounded bg-amber-500/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                        Placing markers · insole hidden
                    </span>
                ) : null}
                {!placingMarkers && registrationStatus?.kind === "ok" ? (
                    <span className="w-fit rounded bg-emerald-500/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                        Scan aligned to insole
                        {registrationStatus.rms != null
                            ? ` · RMS ${registrationStatus.rms.toFixed(2)} mm`
                            : ""}
                    </span>
                ) : null}
                {!placingMarkers && registrationStatus?.kind === "error" ? (
                    <span className="w-fit max-w-[16rem] rounded bg-destructive/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                        Alignment failed: {registrationStatus.message}
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
                    active={showLeftInsole}
                    onClick={() => {
                        if (placingMarkers) return;
                        setViewer({ showLeft: !viewer.showLeft });
                    }}
                    icon={
                        showLeftInsole ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />
                    }
                    label="Left"
                />
                <ToggleButton
                    active={showRightInsole}
                    onClick={() => {
                        if (placingMarkers) return;
                        setViewer({ showRight: !viewer.showRight });
                    }}
                    icon={
                        showRightInsole ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />
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

function ViewButton({
    view,
    active,
    onClick,
    className,
}: {
    view: { name: Exclude<CameraView, "iso" | "front" | "back">; label: string };
    active: boolean;
    onClick: (name: CameraView) => void;
    className?: string;
}) {
    return (
        <Button
            size="sm"
            variant={active ? "default" : "secondary"}
            className={cn("h-7 px-2", className)}
            onClick={() => onClick(view.name)}
        >
            {view.label}
        </Button>
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
