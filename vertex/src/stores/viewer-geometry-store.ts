// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { create } from "zustand";
import type { Side } from "@/types";

interface ViewerGeometryState {
    left: BufferGeometry | null;
    right: BufferGeometry | null;
    leftBuilding: boolean;
    rightBuilding: boolean;
    setViewerGeometry: (side: Side, geometry: BufferGeometry | null, building: boolean) => void;
}

export const useViewerGeometryStore = create<ViewerGeometryState>((set) => ({
    left: null,
    right: null,
    leftBuilding: false,
    rightBuilding: false,
    setViewerGeometry: (side, geometry, building) =>
        set(
            side === "left"
                ? { left: geometry, leftBuilding: building }
                : { right: geometry, rightBuilding: building },
        ),
}));

/** Live viewer mesh for a side — same BufferGeometry the clinician sees on screen. */
export function getLiveViewerGeometry(side: Side): BufferGeometry | null {
    const state = useViewerGeometryStore.getState();
    return side === "left" ? state.left : state.right;
}

export function isViewerGeometryBuilding(side: Side): boolean {
    const state = useViewerGeometryStore.getState();
    return side === "left" ? state.leftBuilding : state.rightBuilding;
}
