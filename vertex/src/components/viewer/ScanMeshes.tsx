import { useMemo } from "react";
import * as THREE from "three";
import { useScanStore } from "@/stores/scan-store";

const GAP_MM = 30;
const INSOLE_WIDTH_MM = 95;

// Renders imported STL/OBJ scans next to the parametric insoles, positioned by
// assigned side so they can be visually compared / aligned (Phase 1).
export function ScanMeshes({ transparent }: { transparent: boolean }) {
    const scans = useScanStore((s) => s.scans);

    const material = useMemo(
        () =>
            new THREE.MeshStandardMaterial({
                color: "#c084fc",
                metalness: 0.1,
                roughness: 0.8,
                transparent,
                opacity: transparent ? 0.45 : 1,
                side: THREE.DoubleSide,
            }),
        [transparent],
    );

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            {scans
                .filter((s) => s.visible)
                .map((s) => {
                    const offsetX = s.side === "left" ? -(INSOLE_WIDTH_MM + GAP_MM) / 2 : (INSOLE_WIDTH_MM + GAP_MM) / 2;
                    return (
                        <mesh key={s.id} geometry={s.geometry} material={material} position={[0, offsetX, 0]} castShadow receiveShadow />
                    );
                })}
        </group>
    );
}
