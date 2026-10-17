// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";
import { defaultAfoDesignState } from "@/lib/geometry/afo/defaults";
import { cloneMesh } from "@/lib/geometry/afo/mesh-ops";
import type { AfoTriMesh } from "@/lib/geometry/afo/types";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

interface AfoSessionStore {
    /** Oriented scan (cast ops always re-run from this). */
    sourceMesh: AfoTriMesh | null;
    /** Working positive after orient / cast. */
    castMesh: AfoTriMesh | null;
    correctedMesh: AfoTriMesh | null;
    shellMesh: AfoTriMesh | null;
    placingLandmarkIndex: number;
    placingTrim: boolean;
    draggingTrimIndex: number | null;
    workerProgress: { pct: number; stage: string } | null;
    lastError: string | null;
    setSourceMesh: (mesh: AfoTriMesh | null) => void;
    setCastMesh: (mesh: AfoTriMesh | null) => void;
    setCorrectedMesh: (mesh: AfoTriMesh | null) => void;
    setShellMesh: (mesh: AfoTriMesh | null) => void;
    setPlacingLandmarkIndex: (index: number) => void;
    setPlacingTrim: (on: boolean) => void;
    setDraggingTrimIndex: (index: number | null) => void;
    setWorkerProgress: (p: { pct: number; stage: string } | null) => void;
    setLastError: (msg: string | null) => void;
    resetSession: () => void;
}

export function isAfoProduct(): boolean {
    return (useDesignStore.getState().design.productType ?? "insole") === "afo";
}

export function getAfoState() {
    const design = useDesignStore.getState().design;
    return design.afo ?? defaultAfoDesignState(design.afo?.side ?? "left");
}

export function patchAfoState(
    patch: Partial<ReturnType<typeof defaultAfoDesignState>>,
    checkpointLabel = "afo",
): void {
    const ds = useDesignStore.getState();
    ds.checkpoint(checkpointLabel);
    const current = ds.design.afo ?? defaultAfoDesignState();
    useDesignStore.setState({
        design: {
            ...ds.design,
            productType: "afo",
            afo: { ...current, ...patch },
        },
    });
}

export function setProductType(productType: "insole" | "afo", side: Side = "left"): void {
    const ds = useDesignStore.getState();
    ds.checkpoint(`product-${productType}`);
    if (productType === "afo") {
        useDesignStore.setState({
            design: {
                ...ds.design,
                productType: "afo",
                method: "printing_shell",
                afo: ds.design.afo ?? defaultAfoDesignState(side),
            },
        });
        useAfoStore.getState().resetSession();
        return;
    }
    useDesignStore.setState({
        design: { ...ds.design, productType: "insole" },
    });
}

export const useAfoStore = create<AfoSessionStore>((set) => ({
    sourceMesh: null,
    castMesh: null,
    correctedMesh: null,
    shellMesh: null,
    placingLandmarkIndex: 0,
    placingTrim: false,
    draggingTrimIndex: null,
    workerProgress: null,
    lastError: null,
    setSourceMesh: (mesh) =>
        set({
            sourceMesh: mesh ? cloneMesh(mesh) : null,
            castMesh: mesh ? cloneMesh(mesh) : null,
        }),
    setCastMesh: (mesh) => set({ castMesh: mesh ? cloneMesh(mesh) : null }),
    setCorrectedMesh: (mesh) => set({ correctedMesh: mesh ? cloneMesh(mesh) : null }),
    setShellMesh: (mesh) => set({ shellMesh: mesh ? cloneMesh(mesh) : null }),
    setPlacingLandmarkIndex: (index) => set({ placingLandmarkIndex: index }),
    setPlacingTrim: (on) => set({ placingTrim: on }),
    setDraggingTrimIndex: (index) => set({ draggingTrimIndex: index }),
    setWorkerProgress: (p) => set({ workerProgress: p }),
    setLastError: (msg) => set({ lastError: msg }),
    resetSession: () =>
        set({
            sourceMesh: null,
            castMesh: null,
            correctedMesh: null,
            shellMesh: null,
            placingLandmarkIndex: 0,
            placingTrim: false,
            draggingTrimIndex: null,
            workerProgress: null,
            lastError: null,
        }),
}));
