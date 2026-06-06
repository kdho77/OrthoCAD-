import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Box, Eye, EyeOff, Layers, Maximize2, Move, PenTool, Rotate3d, Scale3d, Scissors, X } from "lucide-react";
import { Suspense, useRef } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Button } from "@/components/ui/button";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { useKernelStore } from "@/stores/kernel-store";
import { cn } from "@/lib/utils";
import { CustomPrefabMesh } from "./CustomPrefabMesh";
import { ElementMarkers } from "./ElementMarkers";
import { InsoleMesh } from "./InsoleMesh";
import { MeshEditTools } from "./MeshEditTools";
import { ScanMeshes } from "./ScanMeshes";

type ViewName = "front" | "back" | "left" | "right" | "top" | "iso";

const VIEWS: { name: ViewName; label: string; pos: [number, number, number] }[] = [
    { name: "iso", label: "Orbit", pos: [220, 200, 260] },
    { name: "front", label: "Front", pos: [0, 40, 360] },
    { name: "back", label: "Back", pos: [0, 40, -360] },
    { name: "left", label: "Left", pos: [-360, 40, 0] },
    { name: "right", label: "Right", pos: [360, 40, 0] },
    { name: "top", label: "Top", pos: [0, 380, 0.001] },
];

export function Viewer3D() {
    const controls = useRef<OrbitControlsImpl>(null);
    const kernelName = useKernelStore((s) => s.name);
    const { design, viewer, setViewer, selectedElementId, transformMode, setTransformMode, selectElement } =
        useDesignStore();
    const editMode = useMeshEditStore((s) => s.editMode);
    const setEditMode = useMeshEditStore((s) => s.setEditMode);
    const setTarget = useMeshEditStore((s) => s.setTarget);
    const showCustomPrefab = Boolean(design.customPrefabId);

    const setView = (pos: [number, number, number]) => {
        const c = controls.current;
        if (!c) return;
        c.object.position.set(...pos);
        c.target.set(0, 0, 0);
        c.update();
    };

    return (
        <div className="relative h-full w-full bg-[hsl(222_28%_7%)]">
            <Canvas
                shadows
                camera={{ position: [220, 200, 260], fov: 40, near: 1, far: 5000 }}
                onPointerMissed={() => selectElement(null)}
            >
                <color attach="background" args={["#0c111b"]} />
                <ambientLight intensity={0.6} />
                <directionalLight position={[150, 300, 200]} intensity={1.1} castShadow />
                <directionalLight position={[-150, 100, -100]} intensity={0.4} />

                <Suspense fallback={null}>
                    {viewer.showLeft ? (
                        <>
                            {!showCustomPrefab ? (
                                <InsoleMesh side="left" design={design} transparent={viewer.transparent} heightmap={viewer.heightmap} />
                            ) : (
                                <CustomPrefabMesh side="left" transparent={viewer.transparent} />
                            )}
                        </>
                    ) : null}
                    {viewer.showRight ? (
                        <>
                            {!showCustomPrefab ? (
                                <InsoleMesh side="right" design={design} transparent={viewer.transparent} heightmap={viewer.heightmap} />
                            ) : (
                                <CustomPrefabMesh side="right" transparent={viewer.transparent} />
                            )}
                        </>
                    ) : null}
                    <ScanMeshes transparent={viewer.transparent} />
                    <ElementMarkers />
                    <MeshEditTools />
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
                <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.1} />
            </Canvas>

            {/* View buttons */}
            <div className="absolute left-3 top-3 flex flex-wrap gap-1">
                {VIEWS.map((v) => (
                    <Button key={v.name} size="sm" variant="secondary" className="h-7" onClick={() => setView(v.pos)}>
                        {v.label}
                    </Button>
                ))}
            </div>

            {/* Display toggles */}
            <div className="absolute right-3 top-3 flex flex-col gap-1">
                <ToggleButton active={viewer.transparent} onClick={() => setViewer({ transparent: !viewer.transparent })} icon={<Maximize2 className="h-3.5 w-3.5" />} label="Transparent" />
                <ToggleButton active={viewer.heightmap} onClick={() => setViewer({ heightmap: !viewer.heightmap })} icon={<Layers className="h-3.5 w-3.5" />} label="Heightmap" />
                <ToggleButton active={viewer.showLeft} onClick={() => setViewer({ showLeft: !viewer.showLeft })} icon={viewer.showLeft ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} label="Left" />
                <ToggleButton active={viewer.showRight} onClick={() => setViewer({ showRight: !viewer.showRight })} icon={viewer.showRight ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} label="Right" />
            </div>

            {/* Element / mesh edit toolbar */}
            {selectedElementId ? (
                <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-panel/90 p-1 shadow-lg backdrop-blur">
                    <ModeButton active={editMode === "transform" && transformMode === "translate"} onClick={() => { setEditMode("transform"); setTransformMode("translate"); }} icon={<Move className="h-3.5 w-3.5" />} label="Move" />
                    <ModeButton active={editMode === "transform" && transformMode === "rotate"} onClick={() => { setEditMode("transform"); setTransformMode("rotate"); }} icon={<Rotate3d className="h-3.5 w-3.5" />} label="Rotate" />
                    <ModeButton active={editMode === "transform" && transformMode === "scale"} onClick={() => { setEditMode("transform"); setTransformMode("scale"); }} icon={<Scale3d className="h-3.5 w-3.5" />} label="Scale" />
                    <ModeButton active={editMode === "trim"} onClick={() => { setEditMode("trim"); setTarget({ type: "element", id: selectedElementId }); }} icon={<Scissors className="h-3.5 w-3.5" />} label="Trim" />
                    <ModeButton active={editMode === "vertex"} onClick={() => { setEditMode("vertex"); setTarget({ type: "element", id: selectedElementId }); }} icon={<PenTool className="h-3.5 w-3.5" />} label="Vertex" />
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => selectElement(null)}>
                        <X className="h-3.5 w-3.5" />
                    </Button>
                </div>
            ) : (
                <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-panel/90 p-1 shadow-lg backdrop-blur">
                    <ModeButton active={editMode === "trim"} onClick={() => { setEditMode("trim"); setTarget({ type: "insole", side: "left" }); }} icon={<Scissors className="h-3.5 w-3.5" />} label="Trim" />
                    <ModeButton active={editMode === "vertex"} onClick={() => { setEditMode("vertex"); setTarget({ type: "insole", side: "left" }); }} icon={<PenTool className="h-3.5 w-3.5" />} label="Vertex" />
                </div>
            )}

            <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Box className="h-3.5 w-3.5" />
                {kernelName === "opencascade-wasm" ? "OpenCascade WASM" : "Procedural"} kernel · Orbit: drag · Pan: shift+drag · Zoom: scroll
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
