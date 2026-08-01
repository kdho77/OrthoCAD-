// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ElementKind, PlacedElement, Side } from "@/types";

/**
 * Height-field contribution of additive/subtractive orthotic elements.
 *
 * Stock shapes are procedural clinical footprints (not imported meshes):
 * they stay parametric under scale/rotation and share one definition between
 * the interactive height field and the OCCT boolean tool outline.
 *
 * Local frame (+x distal / toe, −x proximal / heel, +y = left-foot medial
 * when rotation = 0). Medial-biased shapes (reverse Morton's notch, Cluffy,
 * Morton's, kinetic wedge) flip across Y for the right foot.
 */

export type ElementShape =
    | "teardrop" // met pad — proximal tip, distal bulb
    | "met_bar" // transverse bar with slight metatarsal bow
    | "hallux_wedge" // Cluffy — triangular under hallux
    | "first_ray_strip" // Morton's extension
    | "reverse_mortons" // 2–5 platform with 1st-ray notch
    | "kinetic_oval" // 1st MPJ relief cutout
    | "heel_cup" // circular heel sink
    | "navicular_oval"; // oval navicular sink

export interface ElementProfile {
    /** Base half-extents in mm along (length / AP, width / ML) before scale. */
    rxMm: number;
    ryMm: number;
    sign: 1 | -1;
    shape: ElementShape;
    /** Typical placed height (mm) when first added from the stock library. */
    defaultHeightMm: number;
    /**
     * Default placement as a fraction of insole length from the heel
     * (0 = heel, 1 = toe). Converted to center-relative x at add time.
     */
    defaultU: number;
    /**
     * Default ML offset as a fraction of half-width. Positive = medial
     * (flipped per side). 0 = midline.
     */
    defaultMedial: number;
}

export const ELEMENT_PROFILES: Record<ElementKind, ElementProfile> = {
    // Classic tear-drop metatarsal pad: tip just proximal to met heads 2–4,
    // bulb under the necks. ~30 × 24 mm.
    met_pad: {
        rxMm: 15,
        ryMm: 12,
        sign: 1,
        shape: "teardrop",
        defaultHeightMm: 3,
        defaultU: 0.68,
        defaultMedial: 0.05,
    },
    // Transverse metatarsal bar: short AP, long ML, gentle anterior bow
    // following the metatarsal parabola. ~20 × 64 mm.
    met_bar: {
        rxMm: 10,
        ryMm: 32,
        sign: 1,
        shape: "met_bar",
        defaultHeightMm: 3,
        defaultU: 0.66,
        defaultMedial: 0,
    },
    // Cluffy wedge under the hallux — raises the distal phalanx to promote
    // 1st MPJ dorsiflexion. Apex distal, base at IPJ. ~22 × 14 mm.
    cluffy_wedge: {
        rxMm: 11,
        ryMm: 7,
        sign: 1,
        shape: "hallux_wedge",
        defaultHeightMm: 2.5,
        defaultU: 0.9,
        defaultMedial: 0.55,
    },
    // Morton's extension: rigid strip under 1st ray from met neck through
    // hallux. Long AP, narrow ML. ~56 × 18 mm.
    mortons_extension: {
        rxMm: 28,
        ryMm: 9,
        sign: 1,
        shape: "first_ray_strip",
        defaultHeightMm: 2,
        defaultU: 0.78,
        defaultMedial: 0.5,
    },
    // Reverse Morton's: additive platform under mets 2–5 with a medial
    // notch so the 1st ray can plantarflex. ~28 × 48 mm outer.
    reverse_mortons: {
        rxMm: 14,
        ryMm: 24,
        sign: 1,
        shape: "reverse_mortons",
        defaultHeightMm: 2.5,
        defaultU: 0.7,
        defaultMedial: -0.1,
    },
    // Kinetic wedge (Dananberg): plantar cutout under 1st met head.
    kinetic_wedge: {
        rxMm: 12,
        ryMm: 10,
        sign: -1,
        shape: "kinetic_oval",
        defaultHeightMm: 2.5,
        defaultU: 0.72,
        defaultMedial: 0.48,
    },
    // Circular heel seat relief.
    heel_sink: {
        rxMm: 18,
        ryMm: 18,
        sign: -1,
        shape: "heel_cup",
        defaultHeightMm: 2,
        defaultU: 0.12,
        defaultMedial: 0,
    },
    // Oval relief under the navicular / medial midfoot prominence.
    navicular_sink: {
        rxMm: 14,
        ryMm: 11,
        sign: -1,
        shape: "navicular_oval",
        defaultHeightMm: 2,
        defaultU: 0.38,
        defaultMedial: 0.55,
    },
};

const DEG = Math.PI / 180;

/** Medial direction in element-local +Y for this foot side. */
function medialYSign(side: Side): number {
    // Left: +y is medial; right: −y is medial (matches height-field convention).
    return side === "left" ? 1 : -1;
}

function clamp01(t: number): number {
    return Math.max(0, Math.min(1, t));
}

/** Smooth cosine dome weight from normalised footprint distance t (0..1). */
function domeWeight(t: number): number {
    if (t >= 1) return 0;
    if (t <= 0) return 1;
    return 0.5 * (1 + Math.cos(Math.PI * t));
}

/**
 * Classic pedorthic teardrop: pointed proximal tip, broad rounded distal bulb.
 * `u` ∈ [−1, 1] tip→base along AP after normalisation by rx.
 */
function teardropHalfWidth(s: number): number {
    // s = 0 at proximal tip, 1 at distal base.
    const sPeak = 0.68;
    if (s <= 0) return 0;
    if (s >= 1) return 0.82;
    if (s <= sPeak) return (s / sPeak) ** 0.72;
    const t = (s - sPeak) / (1 - sPeak);
    return 1 - 0.18 * t * t;
}

function teardropT(lx: number, ly: number, rx: number, ry: number): number {
    const u = lx / rx;
    const v = ly / ry;
    const s = (u + 1) * 0.5;
    if (s < -0.04 || s > 1.06) return 2;

    const sClamped = clamp01(s);
    const w = teardropHalfWidth(sClamped);
    if (w < 1e-4) {
        return Math.abs(v) * 50 + Math.abs(s) * 8;
    }

    const tv = Math.abs(v) / w;
    if (s < 0) return Math.hypot(-s * 4, tv);
    if (s > 1) return Math.hypot((s - 1) * 4, tv);

    // Soft distal closure so the base is bulbous, not open-ended.
    const distalTerm = s > 0.86 ? (s - 0.86) / 0.14 : 0;
    return Math.hypot(tv, distalTerm);
}

/**
 * Transverse metatarsal bar: stadium (capsule) elongated ML, with a mild
 * anterior bow that follows the metatarsal break line.
 */
function metBarT(lx: number, ly: number, rx: number, ry: number): number {
    const bow = 0.32 * rx;
    const yn = Math.max(-1, Math.min(1, ly / Math.max(ry, 1e-6)));
    // Metatarsal-parabola bow: more distal at midfoot (2nd/3rd), more proximal
    // toward 1st/5th. Recentre so the placement origin sits on midspan.
    const xC = bow * (1 - yn * yn);
    const xAdj = lx - (xC - bow * 0.5);

    // Capsule along Y: straight segment with semicircular AP caps of radius rx.
    const halfRect = Math.max(0, ry - rx);
    const yClamped = Math.max(-halfRect, Math.min(halfRect, ly));
    const dy = ly - yClamped;
    return Math.hypot(xAdj, dy) / Math.max(rx, 1e-6);
}

/** Cluffy / hallux wedge: base proximal, apex distal (under distal phalanx). */
function halluxWedgeT(lx: number, ly: number, rx: number, ry: number): number {
    const u = lx / rx;
    const v = ly / ry;
    if (u < -1.05 || u > 1.05) return 2;

    // Half-width 1 at proximal base (u = −1), 0 at distal apex (u = +1).
    const halfW = (1 - Math.max(-1, Math.min(1, u))) / 2;
    if (halfW < 1e-4) {
        return Math.abs(v) * 40 + Math.max(0, u);
    }
    const tv = Math.abs(v) / halfW;
    const proximal = u < -1 ? (-1 - u) * 4 : u < -0.9 ? (-0.9 - u) / 0.1 : 0;
    const distal = u > 1 ? (u - 1) * 4 : u > 0.92 ? (u - 0.92) / 0.08 : 0;
    return Math.hypot(tv, proximal, distal);
}

/** Rounded rectangle via superellipse (n = 4) — Morton's / navicular / heel. */
function superEllipseT(lx: number, ly: number, rx: number, ry: number, n: number): number {
    const ax = Math.abs(lx / Math.max(rx, 1e-6));
    const ay = Math.abs(ly / Math.max(ry, 1e-6));
    return (ax ** n + ay ** n) ** (1 / n);
}

/**
 * Reverse Morton's: outer rounded forefoot platform minus a medial 1st-ray
 * notch. Returns normalised distance for the remaining material.
 */
function reverseMortonsT(lx: number, ly: number, rx: number, ry: number, medialSign: number): number {
    const outer = superEllipseT(lx, ly, rx, ry, 3.2);
    if (outer >= 1) return outer;

    // Notch centred on the medial edge, sized for the 1st ray corridor.
    const notchRx = rx * 0.95;
    const notchRy = ry * 0.42;
    const notchCy = medialSign * (ry - notchRy * 0.55);
    const nx = lx / notchRx;
    // Shift notch slightly distal so the cutout sits under the 1st met head.
    const ny = (ly - notchCy) / notchRy;
    const notch = (Math.abs(nx) ** 2.4 + Math.abs(ny) ** 2.4) ** (1 / 2.4);

    // Inside the notch → outside the element (no platform under 1st ray).
    if (notch < 1) {
        // Map notch interior to t > 1; deepest at notch centre.
        return 1 + (1 - notch);
    }

    // Between outer boundary and notch: keep outer distance, but tighten
    // near the notch rim so the cutout edge is crisp.
    const notchRim = Math.min(1, (notch - 1) / 0.35);
    return Math.max(outer, 1 - notchRim);
}

/** Kinetic wedge: soft oval / short teardrop under 1st MPJ (tip proximal). */
function kineticOvalT(lx: number, ly: number, rx: number, ry: number): number {
    // Mild proximal tip bias without a full met-pad teardrop.
    const u = lx / rx;
    const v = ly / ry;
    const s = (u + 1) * 0.5;
    const w = 0.55 + 0.45 * Math.sin(Math.PI * clamp01(s));
    const tv = Math.abs(v) / Math.max(w, 1e-6);
    const tu = superEllipseT(lx, 0, rx, ry, 2);
    return Math.hypot(tu * 0.85, tv * 0.55);
}

/**
 * Normalised footprint distance for a stock element in local mm.
 * 0 at the load centre, 1 at the clinical outline, >1 outside.
 */
export function elementFootprintT(
    kind: ElementKind,
    lx: number,
    ly: number,
    rx: number,
    ry: number,
    side: Side = "left",
): number {
    const medial = medialYSign(side);
    const profile = ELEMENT_PROFILES[kind];

    switch (profile.shape) {
        case "teardrop":
            return teardropT(lx, ly, rx, ry);
        case "met_bar":
            return metBarT(lx, ly, rx, ry);
        case "hallux_wedge":
            return halluxWedgeT(lx, ly, rx, ry);
        case "first_ray_strip":
            return superEllipseT(lx, ly, rx, ry, 4);
        case "reverse_mortons":
            return reverseMortonsT(lx, ly, rx, ry, medial);
        case "kinetic_oval":
            return kineticOvalT(lx, ly, rx, ry);
        case "heel_cup":
            return superEllipseT(lx, ly, rx, ry, 2);
        case "navicular_oval":
            return superEllipseT(lx, ly, rx, ry, 2.4);
        default:
            return Math.hypot(lx / rx, ly / ry);
    }
}

/**
 * Sample the clinical outline in element-local mm (closed ring, CCW).
 * Used to extrude the OCCT boolean tool so preview and export share topology.
 */
export function elementOutlineLocalMm(
    kind: ElementKind,
    scaleX: number,
    scaleY: number,
    side: Side = "left",
    segments = 48,
): { x: number; y: number }[] {
    const profile = ELEMENT_PROFILES[kind];
    const rx = Math.max(2, profile.rxMm * scaleX);
    const ry = Math.max(2, profile.ryMm * scaleY);
    const pts: { x: number; y: number }[] = [];

    for (let i = 0; i < segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const c = Math.cos(theta);
        const s = Math.sin(theta);

        // Binary search radius along this ray until footprintT ≈ 1.
        let lo = 0;
        let hi = Math.max(rx, ry) * 2.5;
        for (let iter = 0; iter < 18; iter++) {
            const mid = (lo + hi) * 0.5;
            const t = elementFootprintT(kind, mid * c, mid * s, rx, ry, side);
            if (t < 1) lo = mid;
            else hi = mid;
        }
        const r = (lo + hi) * 0.5;
        // Skip collapsed rays inside a notch (reverse Morton's medial void).
        if (r < 0.4) continue;
        pts.push({ x: r * c, y: r * s });
    }

    // Ensure a usable polygon even if notch culling removed points.
    if (pts.length < 6) {
        for (let i = 0; i < segments; i++) {
            const theta = (i / segments) * Math.PI * 2;
            pts.push({ x: Math.cos(theta) * rx, y: Math.sin(theta) * ry });
        }
    }
    return pts;
}

/** Default pose when placing a stock element from the library. */
export function defaultElementPose(
    kind: ElementKind,
    side: Side,
    lengthMm = 260,
    widthMm = 95,
): Pick<PlacedElement, "position" | "rotationDeg" | "scale" | "heightMm"> {
    const p = ELEMENT_PROFILES[kind];
    const medial = medialYSign(side);
    return {
        position: {
            x: p.defaultU * lengthMm - lengthMm / 2,
            y: p.defaultMedial * (widthMm / 2) * medial,
        },
        rotationDeg: 0,
        scale: { x: 1, y: 1 },
        heightMm: p.defaultHeightMm,
    };
}

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
        if (el.kind === "custom") continue;
        const cx = centerX + el.position.x;
        const cy = el.position.y;
        const dx = xMm - cx;
        const dy = yMm - cy;

        // Rotate into the element's local frame.
        const a = -el.rotationDeg * DEG;
        const lx = dx * Math.cos(a) - dy * Math.sin(a);
        const ly = dx * Math.sin(a) + dy * Math.cos(a);

        const p = ELEMENT_PROFILES[el.kind];
        const rx = Math.max(2, p.rxMm * el.scale.x);
        const ry = Math.max(2, p.ryMm * el.scale.y);
        const t = elementFootprintT(el.kind, lx, ly, rx, ry, el.side);
        const w = domeWeight(t);
        if (w > 0) {
            sum += p.sign * el.heightMm * w;
        }
    }
    return sum;
}
