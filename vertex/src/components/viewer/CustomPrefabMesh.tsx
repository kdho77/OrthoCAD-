import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { loadGlbFromBuffer, loadGlbFromUrl } from "@/lib/library/loaders";
import { INSOLE_LENGTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

/** Renders a user custom prefab GLB when selected as the active pattern. */
export function CustomPrefabMesh({ side, transparent }: { side: Side; transparent: boolean }) {
    const customPrefabId = useDesignStore((s) => s.design.customPrefabId);
    const customPrefabs = useCustomLibraryStore((s) => s.customPrefabs);
    const getLocalGlb = useCustomLibraryStore((s) => s.getLocalGlb);
    const [group, setGroup] = useState<THREE.Group | null>(null);

    const prefab = customPrefabs.find((p) => p.id === customPrefabId);

    useEffect(() => {
        if (!customPrefabId || !prefab) {
            setGroup(null);
            return;
        }

        let cancelled = false;
        const load = async () => {
            try {
                if (prefab.url) {
                    const g = await loadGlbFromUrl(prefab.url);
                    if (!cancelled) setGroup(g);
                    return;
                }
                const local = getLocalGlb(customPrefabId);
                if (local) {
                    const binary = Uint8Array.from(atob(local.glbBase64), (c) => c.charCodeAt(0));
                    const g = await loadGlbFromBuffer(binary.buffer);
                    if (!cancelled) setGroup(g);
                }
            } catch {
                if (!cancelled) setGroup(null);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [customPrefabId, prefab, getLocalGlb]);

    const clone = useMemo(() => {
        if (!group) return null;
        const g = group.clone(true);
        g.traverse((obj) => {
            if (obj instanceof THREE.Mesh && obj.material instanceof THREE.Material) {
                obj.material = obj.material.clone();
                obj.material.transparent = transparent;
                obj.material.opacity = transparent ? 0.55 : 1;
            }
        });
        return g;
    }, [group, transparent]);

    if (!clone) return null;

    const offsetX = sideOffsetX(side);
    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <primitive object={clone} position={[-INSOLE_LENGTH_MM / 2, offsetX, 2]} scale={[1, 1, 1]} />
        </group>
    );
}
