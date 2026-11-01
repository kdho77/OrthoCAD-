// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { loadPressureMapFromFile } from "@/lib/pressure-map/import";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import type { CameraView } from "@/stores/design-store";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

export interface PressureMapAabb {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
}

export interface PressureMapFootMeasure {
    plane: PressureMapAabb;
    insole: PressureMapAabb;
    halluxWorld: { x: number; y: number; z: number };
    insoleCenter: { x: number; y: number; z: number };
    /** Footprint-Y sign of medial (`left` −1, `right` +1). */
    medialSign: 1 | -1;
}

export interface PressureMapE2EApi {
    prepareScene: () => void;
    importFixture: (side: Side, fileName: string) => Promise<void>;
    setCameraView: (view: CameraView) => void;
    setFootVisibility: (showLeft: boolean, showRight: boolean) => void;
    setTransparent: (on: boolean) => void;
    /** True once both insole meshes and both pressure planes are in the scene and the load splash is gone. */
    meshesReady?: () => boolean;
    /** World bounds of the rendered plane and insole, plus the hallux sample transformed by the live mesh matrix. */
    measure?: (
        hallux: Record<Side, { u: number; v: number }>,
    ) => { feet: Record<Side, PressureMapFootMeasure> } | null;
}

async function fetchFixtureFile(fileName: string): Promise<File> {
    const res = await fetch(`/tests/pressure-map/fixtures/${fileName}`);
    if (!res.ok) throw new Error(`Fixture fetch failed: ${fileName}`);
    const blob = await res.blob();
    return new File([blob], fileName, { type: blob.type || "image/png" });
}

export function installPressureMapE2E(): void {
    const api: PressureMapE2EApi = {
        prepareScene() {
            useClinicalWorkflowStore.getState().setStep("base");
            useClinicalWorkflowStore.getState().acknowledgePairAssignment();
            useDesignStore.getState().setViewer({
                transparent: true,
                showLeft: true,
                showRight: true,
                showScans: false,
                view: "top",
            });
        },
        async importFixture(side, fileName) {
            const file = await fetchFixtureFile(fileName);
            const foot = await loadPressureMapFromFile(file, side);
            useDesignStore.getState().setPressureMap(side, foot);
        },
        setCameraView(view) {
            const apply = (window as unknown as { __orthocadApplyCameraView?: (name: CameraView) => void })
                .__orthocadApplyCameraView;
            if (apply) apply(view);
            else useDesignStore.getState().setViewer({ view });
        },
        setFootVisibility(showLeft, showRight) {
            useDesignStore.getState().setViewer({ showLeft, showRight });
        },
        setTransparent(on) {
            useDesignStore.getState().setViewer({ transparent: on });
        },
    };
    (window as unknown as { __orthocadPressureMapE2E: PressureMapE2EApi }).__orthocadPressureMapE2E = api;
}
