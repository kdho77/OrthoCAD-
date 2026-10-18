import { BufferAttribute, type BufferGeometry, Color } from "three";
import { elementHeightAt, ELEMENT_PROFILES } from "@/lib/geometry/elements";
import type { PlacedElement } from "@/types";

export const DESIGN_ELEMENT_COLOR = "#a855f7";
const BASE_COLOR = new Color("#ffffff");
const ELEMENT_COLOR = new Color(DESIGN_ELEMENT_COLOR);
const MIN_VISIBLE_RAISE_MM = 0.08;

/**
 * Color only the top-surface vertices lifted by additive elements. This keeps
 * the design view focused on material that actually rises above the shell.
 */
export function applyDesignElementColors(
    geometry: BufferGeometry,
    elements: PlacedElement[],
    side: PlacedElement["side"],
    lengthMm: number,
): void {
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const normals = geometry.getAttribute("normal");

    const additions = elements.filter((element) => {
        if (element.side !== side || element.kind === "custom") return false;
        return ELEMENT_PROFILES[element.kind].sign > 0;
    });
    const colors = new Float32Array(positions.count * 3);

    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        const topFacing = !normals || Math.abs(normals.getZ(i)) > 0.25;
        const raised =
            topFacing &&
            z > MIN_VISIBLE_RAISE_MM &&
            additions.some((element) => elementHeightAt([element], x, y, lengthMm) > MIN_VISIBLE_RAISE_MM);
        const color = raised ? ELEMENT_COLOR : BASE_COLOR;
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute("color", new BufferAttribute(colors, 3));
}
