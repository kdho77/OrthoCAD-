import type { ElementKind, PlacedElement } from "@/types";

// Height-field contribution of additive/subtractive elements (met pads, bars,
// wedges, extensions, sinks). Each element is an oriented elliptical bump welded
// into the insole surface — the procedural-kernel equivalent of a boolean union
// (positive) or cut (negative). Keeps the resulting solid watertight.

interface ElementProfile {
    /** Base radii in mm along (length, width) before per-element scale. */
    rxMm: number;
    ryMm: number;
    sign: 1 | -1;
}

const PROFILES: Record<ElementKind, ElementProfile> = {
    met_pad: { rxMm: 16, ryMm: 13, sign: 1 },
    met_bar: { rxMm: 11, ryMm: 34, sign: 1 },
    cluffy_wedge: { rxMm: 14, ryMm: 12, sign: 1 },
    mortons_extension: { rxMm: 15, ryMm: 38, sign: 1 },
    reverse_mortons: { rxMm: 16, ryMm: 30, sign: -1 },
    kinetic_wedge: { rxMm: 14, ryMm: 16, sign: -1 },
    heel_sink: { rxMm: 20, ryMm: 20, sign: -1 },
    navicular_sink: { rxMm: 16, ryMm: 22, sign: -1 },
};

const DEG = Math.PI / 180;

/**
 * Summed element height contribution at insole-surface point (xMm along length
 * from heel, yMm across width from centerline) for one foot.
 */
export function elementHeightAt(
    elements: PlacedElement[],
    xMm: number,
    yMm: number,
    lengthMm: number,
): number {
    if (elements.length === 0) return 0;
    const centerX = lengthMm / 2;
    let sum = 0;

    for (const el of elements) {
        const cx = centerX + el.position.x;
        const cy = el.position.y;
        const dx = xMm - cx;
        const dy = yMm - cy;

        // Rotate into the element's local frame.
        const a = -el.rotationDeg * DEG;
        const lx = dx * Math.cos(a) - dy * Math.sin(a);
        const ly = dx * Math.sin(a) + dy * Math.cos(a);

        const p = PROFILES[el.kind];
        const rx = Math.max(2, p.rxMm * el.scale.x);
        const ry = Math.max(2, p.ryMm * el.scale.y);
        const t = Math.hypot(lx / rx, ly / ry);
        if (t < 1) {
            sum += p.sign * el.heightMm * 0.5 * (1 + Math.cos(Math.PI * t));
        }
    }
    return sum;
}
