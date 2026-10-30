// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { BufferAttribute, type BufferGeometry, Color } from "three";

export const DESIGN_ELEMENT_COLOR = "#a855f7";
export const ELEMENT_LIFT_ATTRIBUTE = "elementLiftMm";
export const ELEMENT_OWNER_ATTRIBUTE = "elementOwner";
export const ELEMENT_IDS_KEY = "placedElementIds";
// Numerical tolerance only: retain the GLB's thin feathered perimeter.
export const MIN_VISIBLE_RAISE_MM = 1e-4;
const BASE_COLOR = new Color("#ffffff");
const ELEMENT_COLOR = new Color(DESIGN_ELEMENT_COLOR);
const SELECTED_COLOR = new Color("#22c55e");

/**
 * Color the actual positive displacement recorded during mesh composition.
 * Never infer a GLB's footprint from the procedural fallback shape: its notch,
 * pose, scale, flow mode and clipping are already represented in these vertices.
 */
export function applyDesignElementColors(
    geometry: BufferGeometry,
    enabled = true,
    selectedElementId: string | null = null,
): void {
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const lift = geometry.getAttribute(ELEMENT_LIFT_ATTRIBUTE);
    const owners = geometry.getAttribute(ELEMENT_OWNER_ATTRIBUTE);
    const ids: string[] = geometry.userData[ELEMENT_IDS_KEY] ?? [];
    const selectedOwner = selectedElementId ? ids.indexOf(selectedElementId) + 1 : 0;
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
        const raised = enabled && lift && lift.getX(i) > MIN_VISIBLE_RAISE_MM;
        const selected = selectedOwner > 0 && owners?.getX(i) === selectedOwner;
        const color = raised ? (selected ? SELECTED_COLOR : ELEMENT_COLOR) : BASE_COLOR;
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
}
