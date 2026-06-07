import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { deformBaseForDesign } from "@/lib/geometry/base-modifier";
import { INSOLE_LENGTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import { extractPrimaryGeometry, loadGlbFromBuffer, loadGlbFromUrl } from "@/lib/library/loaders";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
import { useDesignStore } from "@/stores/design-store";
import { mergeCorrections, mergeElementPreviews, usePerformanceStore } from "@/stores/performance-store";
import type { Side } from "@/types";

/** Base-mode highlight tints so users can see they are modifying a loaded base. */
const baseTint: Record<Side, string> = {
    left: "#a78bfa",
    right: "#c084fc",
};

/**
 * Renders a user custom prefab GLB as the active **base**, with clinical
 * corrections / elements / trimline applied as a real-time vertical deformation
 * (see base-modifier.ts). A distinct tint + outline marks base mode so the user
 * can tell they are modifying an existing base rather than a parametric shell.
 */
export function CustomPrefabMesh({ side, transparent }: { side: Side; transparent: boolean }) {
    const design = useDesignStore((s) => s.design);
    const { customPrefabId } = design;
    const customPrefabs = useCustomLibraryStore((s) => s.customPrefabs);
    const getLocalGlb = useCustomLibraryStore((s) => s.getLocalGlb);
    const interacting = usePerformanceStore((s) => s.interacting);
    const correctionPreview = usePerformanceStore((s) => s.correctionPreview);
    const elementPreviews = usePerformanceStore((s) => s.elementPreviews);
    const [baseGeometry, setBaseGeometry] = useState<THREE.BufferGeometry | null>(null);

    const prefab = customPrefabs.find((p) => p.id === customPrefabId);

    useEffect(() => {
        if (!customPrefabId || !prefab) {
            setBaseGeometry(null);
            return;
        }

        let cancelled = false;
        const disposeGroup = (g: THREE.Group) =>
            g.traverse((obj) => {
                if (obj instanceof THREE.Mesh) {
                    obj.geometry?.dispose();
                    (obj.material as { dispose?: () => void })?.dispose?.();
                }
            });

        const load = async () => {
            try {
                let group: THREE.Group | null = null;
                if (prefab.url) {
                    group = await loadGlbFromUrl(prefab.url);
                } else {
                    const local = getLocalGlb(customPrefabId);
                    if (local) {
                        const binary = Uint8Array.from(atob(local.glbBase64), (c) => c.charCodeAt(0));
                        group = await loadGlbFromBuffer(binary.buffer);
                    }
                }
                if (!group) {
                    if (!cancelled) setBaseGeometry(null);
                    return;
                }
                const geo = extractPrimaryGeometry(group);
                disposeGroup(group);
                if (cancelled) {
                    geo?.dispose();
                    return;
                }
                setBaseGeometry(geo);
            } catch {
                if (!cancelled) setBaseGeometry(null);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [customPrefabId, prefab, getLocalGlb]);

    // Re-deform the base whenever the modifiers change. Smoothing is skipped
    // during active drags so real-time editing stays responsive; an extra
    // relaxation pass runs when idle for a clinically smooth top surface.
    const corrections = mergeCorrections(side, design.corrections[side]);
    const elements = mergeElementPreviews(design.elements.filter((e) => e.side === side));
    const correctionsKey = JSON.stringify(corrections);
    const elementsKey = JSON.stringify(elements);
    // Live preview maps are read inside via merge*; correctionPreview /
    // elementPreviews are listed as triggers so a drag rebuilds the base.
    // biome-ignore lint/correctness/useExhaustiveDependencies: serialized keys + preview triggers cover all inputs
    const deformed = useMemo(() => {
        if (!baseGeometry) return null;
        return deformBaseForDesign(baseGeometry, design, side, corrections, elements, interacting ? 0 : 1);
    }, [
        baseGeometry,
        side,
        design.trimlines,
        correctionsKey,
        elementsKey,
        interacting,
        correctionPreview,
        elementPreviews,
    ]);

    useEffect(() => () => deformed?.dispose(), [deformed]);

    const material = useMemo(
        () =>
            new THREE.MeshStandardMaterial({
                color: baseTint[side],
                metalness: 0.15,
                roughness: 0.65,
                transparent,
                opacity: transparent ? 0.55 : 1,
                side: THREE.DoubleSide,
            }),
        [side, transparent],
    );
    useEffect(() => () => material.dispose(), [material]);

    if (!deformed) return null;

    const offsetX = sideOffsetX(side);
    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh
                geometry={deformed}
                material={material}
                position={[-INSOLE_LENGTH_MM / 2, offsetX, 0]}
                castShadow
                receiveShadow
            />
            {/* Base outline overlay — a clear visual cue that this is a loaded base. */}
            <lineSegments position={[-INSOLE_LENGTH_MM / 2, offsetX, 0]}>
                <edgesGeometry args={[deformed, 35]} />
                <lineBasicMaterial color={baseTint[side]} transparent opacity={0.35} />
            </lineSegments>
        </group>
    );
}
