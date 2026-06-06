import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Box, Eye, EyeOff, Layers, Maximize2 } from "lucide-react";
import { Suspense, useRef } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Button } from "@/components/ui/button";
import { useDesignStore } from "@/stores/design-store";
import { cn } from "@/lib/utils";
import { InsoleMesh } from "./InsoleMesh";
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
    const { design, viewer, setViewer } = useDesignStore();

    const setView = (pos: [number, number, number]) => {
        const c = controls.current;
        if (!c) return;
        c.object.position.set(...pos);
        c.target.set(0, 0, 0);
        c.update();
    };

    return (
        <div className="relative h-full w-full bg-[hsl(222_28%_7%)]">
            <Canvas shadows camera={{ position: [220, 200, 260], fov: 40, near: 1, far: 5000 }}>
                <color attach="background" args={["#0c111b"]} />
                <ambientLight intensity={0.6} />
                <directionalLight position={[150, 300, 200]} intensity={1.1} castShadow />
                <directionalLight position={[-150, 100, -100]} intensity={0.4} />

                <Suspense fallback={null}>
                    {viewer.showLeft ? (
                        <InsoleMesh side="left" design={design} transparent={viewer.transparent} heightmap={viewer.heightmap} />
                    ) : null}
                    {viewer.showRight ? (
                        <InsoleMesh side="right" design={design} transparent={viewer.transparent} heightmap={viewer.heightmap} />
                    ) : null}
                    <ScanMeshes transparent={viewer.transparent} />
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

            <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Box className="h-3.5 w-3.5" />
                Procedural kernel · Orbit: drag · Pan: shift+drag · Zoom: scroll
            </div>
        </div>
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
