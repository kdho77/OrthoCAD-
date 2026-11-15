// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    type AnatomicalSide,
    heightFieldYFromMeshY,
    meshYForAnatomicalSide,
    meshYSign,
} from "@/lib/geometry/handedness";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import {
    MORTONS_DEFAULT_MEDIAL,
    MORTONS_DEFAULT_U,
    MORTONS_HEIGHT_DEFAULT_MM,
    MORTONS_HEIGHT_MAX_MM,
    MORTONS_REFERENCE_RX_MM,
    MORTONS_REFERENCE_RY_MM,
    type MortonsOutlinePoint,
    mortonsAnchorMm,
    mortonsEdgeMm,
    mortonsFootprintT,
    mortonsHeightMm,
    mortonsLocalOutline,
    mortonsReferenceWidthMm,
} from "@/lib/geometry/mortons-extension";
import { insoleLayoutFromDesign, type ShoeSizingDesign } from "@/lib/geometry/shoe-size";
import type { ElementKind, PlacedElement, Side } from "@/types";

/**
 * Height-field contribution of additive/subtractive orthotic elements.
 *
 * Stock shapes are procedural clinical footprints (not imported meshes):
 * they stay parametric under scale/rotation and share one definition between
 * the interactive height field and the export boolean tool outline.
 *
 * Local frame (+x distal / toe, −x proximal / heel, +y = left-foot medial
 * when rotation = 0). Medial-biased shapes (reverse Morton's notch, Cluffy,
 * Morton's, kinetic wedge) flip across Y for the right foot.
 */

/** Elongated 1st-MPJ trough. Length is 45 mm at 300 mm. Width is 0.32 of local width. */
export const RKW_LENGTH_AT_300_MM = 45;
export const RKW_CENTER_U = 0.665;
export const RKW_CENTER_V = 0.15;
export const RKW_WIDTH_OF_LOCAL = 0.32;
export const RKW_DEEPEST_PROXIMAL_MM = 3;
export const RKW_MAX_OVERHANG_MM = 2;
export const RKW_TAPER_MM = 6;
/**
 * Distal and proximal ends only. A 32 mm quintic, the same feather Morton's
 * uses on its heel side. The long sides stay on {@link RKW_TAPER_MM}.
 */
export const RKW_END_FEATHER_MM = 32;
export const RKW_MEDIAL_RAMP_MM = 5;
export const RKW_BORDER_DEPTH_FRACTION = 0.5;
export const RKW_DEPTH_DEFAULT_MM = 2;
export const RKW_DEPTH_WARN_MM = 3;
export const RKW_DEPTH_MAX_MM = 4;
export const RKW_PLAN_SCALE_MIN = 0.65;
export const RKW_MIN_LENGTH_MM = 30;
export const RKW_MIN_WIDTH_MM = 20;
/** No lowering element or sink may leave less than this much material. */
export const REMAINING_MATERIAL_MM = 1.5;

export type ElementShape =
    | "teardrop" // met pad — proximal tip, distal bulb
    | "met_bar" // transverse bar with slight metatarsal bow
    | "hallux_wedge" // Cluffy — triangular under hallux
    | "first_ray_strip" // Morton's extension
    | "reverse_mortons" // 2–5 platform with 1st-ray notch
    | "kinetic_oval" // 1st MPJ relief cutout
    | "heel_cup" // circular heel sink
    | "navicular_oval" // oval navicular sink
    | "scaphoid_pad" // medial midfoot scaphoid / navicular pad
    | "heel_cushion" // accommodative heel cushion
    | "dancers_pad"; // lateral sulcus / 5th ray relief

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
     * Distance from the width center as a fraction of half-width.
     * The border it sits on is {@link anatomicalSide}. 0 = midline.
     */
    defaultMedial: number;
    /** Registered border. Both feet use {@link meshYForAnatomicalSide}. */
    anatomicalSide: AnatomicalSide;
}

export const ELEMENT_PROFILES: Record<ElementKind, ElementProfile> = {
    // Classic tear-drop metatarsal pad: tip just proximal to met heads 2–4,
    // bulb under the necks. ~30 × 24 mm.
    met_pad: {
        rxMm: 15,
        ryMm: 12,
        sign: 1,
        shape: "teardrop",
        defaultHeightMm: 5,
        defaultU: 0.5473,
        defaultMedial: 0.0722,
        anatomicalSide: "medial",
    },
    // Transverse metatarsal bar: short AP, long ML, gentle anterior bow
    // following the metatarsal parabola. ~20 × 64 mm.
    met_bar: {
        rxMm: 10,
        ryMm: 32,
        sign: 1,
        shape: "met_bar",
        defaultHeightMm: 3.47,
        defaultU: 0.5162,
        defaultMedial: -0.0387,
        anatomicalSide: "lateral",
    },
    toe_crest: {
        rxMm: 12,
        ryMm: 18,
        sign: 1,
        shape: "teardrop",
        defaultHeightMm: 2.47,
        defaultU: 0.7802,
        defaultMedial: -0.2859,
        anatomicalSide: "lateral",
    },
    cuboid_pad: {
        rxMm: 16,
        ryMm: 10,
        sign: 1,
        shape: "teardrop",
        defaultHeightMm: 6.37,
        defaultU: 0.3448,
        defaultMedial: -0.6865,
        anatomicalSide: "lateral",
    },
    // Cluffy wedge under the hallux — raises the distal phalanx to promote
    // 1st MPJ dorsiflexion. Apex distal, base at IPJ. Library GLB (29 × 26 mm).
    cluffy_wedge: {
        rxMm: 15,
        ryMm: 13,
        sign: 1,
        shape: "hallux_wedge",
        defaultHeightMm: 2.4,
        defaultU: 0.7744,
        defaultMedial: 0.6413,
        anatomicalSide: "medial",
    },
    // Morton's extension: 1st ray from the met head (u 0.62–0.63) to the toe
    // edge, flush to the medial border, lateral border at v 0.40 of local
    // width. Reference half-extents are the Men's 9 pad. Height stays 3 mm.
    mortons_extension: {
        rxMm: MORTONS_REFERENCE_RX_MM,
        ryMm: MORTONS_REFERENCE_RY_MM,
        sign: 1,
        shape: "first_ray_strip",
        defaultHeightMm: MORTONS_HEIGHT_DEFAULT_MM,
        defaultU: MORTONS_DEFAULT_U,
        defaultMedial: MORTONS_DEFAULT_MEDIAL,
        anatomicalSide: "medial",
    },
    // Reverse Morton's: the same 1st-ray footprint as Morton's. The only
    // difference is the sign — this one lowers the ray.
    reverse_mortons: {
        rxMm: MORTONS_REFERENCE_RX_MM,
        ryMm: MORTONS_REFERENCE_RY_MM,
        sign: -1,
        shape: "first_ray_strip",
        defaultHeightMm: MORTONS_HEIGHT_DEFAULT_MM,
        defaultU: MORTONS_DEFAULT_U,
        defaultMedial: MORTONS_DEFAULT_MEDIAL,
        anatomicalSide: "medial",
    },
    // Reverse kinetic wedge: medially offset elongated oval under the 1st MPJ.
    // 39 × 28 mm at the 260 mm reference. About one third sits off the medial edge.
    kinetic_wedge: {
        rxMm: RKW_LENGTH_AT_300_MM / 2,
        ryMm: 16,
        sign: -1,
        shape: "kinetic_oval",
        defaultHeightMm: RKW_DEPTH_DEFAULT_MM,
        defaultU: RKW_CENTER_U,
        defaultMedial: 0.5,
        anatomicalSide: "medial",
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
        anatomicalSide: "midline",
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
        anatomicalSide: "medial",
    },
    // Scaphoid / navicular accommodative pad — medial midfoot, 0–8 mm.
    scaphoid_pad: {
        rxMm: 16,
        ryMm: 12,
        sign: 1,
        shape: "scaphoid_pad",
        defaultHeightMm: 4,
        defaultU: 0.42,
        defaultMedial: 0.62,
        anatomicalSide: "medial",
    },
    // Heel cushion — full heel accommodative layer, 0–6 mm.
    heel_cushion: {
        rxMm: 22,
        ryMm: 20,
        sign: 1,
        shape: "heel_cushion",
        defaultHeightMm: 3,
        defaultU: 0.14,
        defaultMedial: 0,
        anatomicalSide: "midline",
    },
    // Dancer's pad — 1st MPJ relief (mitten + sesamoid notch), 0–6 mm.
    dancers_pad: {
        rxMm: 34,
        ryMm: 27,
        sign: 1,
        shape: "dancers_pad",
        defaultHeightMm: 2.5,
        defaultU: 0.6496,
        defaultMedial: -0.0196,
        anatomicalSide: "midline",
    },
};

/** Clinical height sliders per stock kind (mm). */
export const ELEMENT_HEIGHT_LIMITS: Partial<Record<ElementKind, { min: number; max: number }>> = {
    scaphoid_pad: { min: 0, max: 8 },
    heel_cushion: { min: 0, max: 6 },
    dancers_pad: { min: 0, max: 6 },
    mortons_extension: { min: 0, max: MORTONS_HEIGHT_MAX_MM },
    reverse_mortons: { min: 0, max: MORTONS_HEIGHT_MAX_MM },
    kinetic_wedge: { min: 0, max: RKW_DEPTH_MAX_MM },
};

export function rkwPlanScale(lengthMm: number): number {
    const raw = lengthMm / 300;
    if (!(raw > 0)) return RKW_PLAN_SCALE_MIN;
    return Math.max(RKW_PLAN_SCALE_MIN, raw);
}

export function rkwPlanMm(lengthMm: number, localWidthMm: number): { lengthMm: number; widthMm: number } {
    const scale = rkwPlanScale(lengthMm);
    return {
        lengthMm: Math.max(RKW_MIN_LENGTH_MM, RKW_LENGTH_AT_300_MM * scale),
        widthMm: Math.max(RKW_MIN_WIDTH_MM, RKW_WIDTH_OF_LOCAL * Math.max(localWidthMm, 0)),
    };
}

function smoothstep01(t: number): number {
    const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
    return x * x * (3 - 2 * x);
}

/** C2 quintic. Value, slope, and curvature are 0 at both 0 and 1. */
function quintic01(t: number): number {
    const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
    return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Ellipse weight. 1 inside the oval. Long sides keep the 6 mm smoothstep.
 * Distal and proximal ends feather with a 32 mm quintic so the trough meets
 * the top instead of dropping in like a pocket. A pure side sample
 * (`localX === 0`) is unchanged.
 */
export function rkwOvalWeight(localX: number, localY: number, halfLength: number, halfWidth: number): number {
    const hl = Math.max(halfLength, 1e-6);
    const hw = Math.max(halfWidth, 1e-6);
    const ax = Math.abs(localX) / hl;
    const ay = Math.abs(localY) / hw;
    const r = Math.hypot(ax, ay);
    if (r <= 1) return 1;
    const excess = (r - 1) * Math.max(hl, hw);
    const sideW = excess >= RKW_TAPER_MM ? 0 : 1 - smoothstep01(excess / RKW_TAPER_MM);
    const endW = excess >= RKW_END_FEATHER_MM ? 0 : 1 - quintic01(excess / RKW_END_FEATHER_MM);
    const mix = quintic01(ax / Math.max(ax + ay, 1e-12));
    return sideW * (1 - mix) + endW * mix;
}

export function kineticWedgeLocalOutline(
    lengthMm: number,
    localWidthMm: number,
    scaleX = 1,
    scaleY = 1,
): { x: number; y: number }[] {
    const plan = rkwPlanMm(lengthMm, localWidthMm);
    const rx = (plan.lengthMm / 2) * (scaleX > 1e-6 ? scaleX : 1);
    const ry = (plan.widthMm / 2) * (scaleY > 1e-6 ? scaleY : 1);
    const pts: { x: number; y: number }[] = [];
    const n = 40;
    for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(t) * rx, y: Math.sin(t) * ry });
    }
    return pts;
}

const DEG = Math.PI / 180;

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
    // Notch and other medial shape details use the footprint-frame medial sign.
    const medial = meshYSign(side, "medial");
    const profile = ELEMENT_PROFILES[kind];

    switch (profile.shape) {
        case "teardrop":
            return teardropT(lx, ly, rx, ry);
        case "met_bar":
            return metBarT(lx, ly, rx, ry);
        case "hallux_wedge":
            return halluxWedgeT(lx, ly, rx, ry);
        case "first_ray_strip":
            return mortonsFootprintT(lx, ly, rx, ry, side);
        case "reverse_mortons":
            return mortonsFootprintT(lx, ly, rx, ry, side);
        case "kinetic_oval":
            return Math.hypot(lx / Math.max(rx, 1e-6), ly / Math.max(ry, 1e-6));
        case "heel_cup":
            return superEllipseT(lx, ly, rx, ry, 2);
        case "navicular_oval":
            return superEllipseT(lx, ly, rx, ry, 2.4);
        case "scaphoid_pad":
            return superEllipseT(lx, ly, rx, ry, 2.6);
        case "heel_cushion":
            return superEllipseT(lx, ly, rx, ry, 2.2);
        case "dancers_pad":
            return superEllipseT(lx - rx * 0.15, ly, rx * 0.9, ry, 2.8);
        default:
            return Math.hypot(lx / rx, ly / ry);
    }
}

/**
 * Sample the clinical outline in element-local mm (closed ring, CCW).
 * Used to extrude the export boolean tool so preview and export share topology.
 */
export function elementOutlineLocalMm(
    kind: ElementKind,
    scaleX: number,
    scaleY: number,
    side: Side = "left",
    segments = 48,
    frame?: { lengthMm: number; widthMm: number; outline?: MortonsOutlinePoint[] | null },
): { x: number; y: number }[] {
    if (kind === "mortons_extension" || kind === "reverse_mortons") {
        const lengthMm = frame?.lengthMm ?? INSOLE_LENGTH_MM;
        const widthMm = frame?.widthMm ?? INSOLE_WIDTH_MM;
        return mortonsLocalOutline(side, lengthMm, widthMm, scaleX, scaleY, frame?.outline);
    }
    if (kind === "kinetic_wedge") {
        const lengthMm = frame?.lengthMm ?? INSOLE_LENGTH_MM;
        const widthMm = frame?.widthMm ?? INSOLE_WIDTH_MM;
        const edge = mortonsEdgeMm(RKW_CENTER_U, widthMm, side, frame?.outline);
        const span = Math.abs(edge.lateral - edge.medial);
        return kineticWedgeLocalOutline(lengthMm, span, scaleX, scaleY);
    }
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

function kineticWedgeAnchor(
    side: Side,
    lengthMm: number,
    widthMm: number,
    outline?: MortonsOutlinePoint[] | null,
): { x: number; y: number } {
    const edge = mortonsEdgeMm(RKW_CENTER_U, widthMm, side, outline);
    const span = Math.abs(edge.lateral - edge.medial);
    const plan = rkwPlanMm(lengthMm, span);
    const inwardSign = meshYSign(side, "lateral");
    let inside = RKW_CENTER_V * span;
    const overhang = plan.widthMm / 2 - inside;
    if (overhang > RKW_MAX_OVERHANG_MM) inside = plan.widthMm / 2 - RKW_MAX_OVERHANG_MM;
    return {
        x: RKW_CENTER_U * lengthMm,
        y: edge.medial + inwardSign * inside,
    };
}

/** Oval center is u 0.665. The deepest point of the trough is 3 mm proximal of that. */
export function kineticWedgeCenterU(lengthMm: number): number {
    return RKW_CENTER_U - RKW_DEEPEST_PROXIMAL_MM / Math.max(lengthMm, 1);
}

/** Default pose when placing a stock element from the library. */
export function defaultElementPose(
    kind: ElementKind,
    side: Side,
    lengthMm = 260,
    widthMm = 95,
    outline?: MortonsOutlinePoint[] | null,
): Pick<PlacedElement, "position" | "rotationDeg" | "scale" | "heightMm" | "placementMode"> {
    const p = ELEMENT_PROFILES[kind];
    const mortons =
        kind === "mortons_extension" || kind === "reverse_mortons"
            ? mortonsAnchorMm(side, lengthMm, widthMm, outline)
            : null;
    const kinetic = kind === "kinetic_wedge" ? kineticWedgeAnchor(side, lengthMm, widthMm, outline) : null;
    return {
        position: mortons
            ? { x: mortons.x - lengthMm / 2, y: mortons.y }
            : kinetic
              ? { x: kinetic.x - lengthMm / 2, y: kinetic.y }
              : {
                    x: p.defaultU * lengthMm - lengthMm / 2,
                    y: meshYForAnatomicalSide(
                        side,
                        p.anatomicalSide,
                        Math.abs(p.defaultMedial) * (widthMm / 2),
                    ),
                },
        rotationDeg: 0,
        scale: { x: 1, y: 1 },
        heightMm: p.defaultHeightMm,
        placementMode:
            kind === "met_pad" ||
            kind === "met_bar" ||
            kind === "toe_crest" ||
            kind === "cuboid_pad" ||
            kind === "dancers_pad" ||
            kind === "cluffy_wedge"
                ? "flow"
                : undefined,
    };
}

/**
 * Poses written before the 1st-ray footprint. Y was either height-field
 * (+Y left medial) or the #285 mesh pose that still parked Reverse Morton's
 * on the lateral border. A reopened design keeps a moved pad; only these
 * untouched defaults are rewritten onto {@link defaultElementPose}.
 */
const LEGACY_FIRST_RAY_POSES: ReadonlyArray<{
    kind: "mortons_extension" | "reverse_mortons";
    u: number;
    /** Signed fraction of half-width, before the anatomical-side abs. */
    fraction: number;
    frame: "height-field" | "mesh-medial" | "mesh-lateral";
}> = [
    { kind: "mortons_extension", u: 0.78, fraction: 0.5, frame: "height-field" },
    { kind: "reverse_mortons", u: 0.7, fraction: -0.1, frame: "height-field" },
    { kind: "mortons_extension", u: 0.78, fraction: 0.5, frame: "mesh-medial" },
    { kind: "reverse_mortons", u: 0.7, fraction: 0.1, frame: "mesh-lateral" },
];

function legacyFirstRayY(
    side: Side,
    frame: (typeof LEGACY_FIRST_RAY_POSES)[number]["frame"],
    fraction: number,
    halfWidthMm: number,
): number {
    if (frame === "height-field") {
        const sign = side === "left" ? 1 : -1;
        return fraction * halfWidthMm * sign;
    }
    return meshYForAnatomicalSide(
        side,
        frame === "mesh-medial" ? "medial" : "lateral",
        Math.abs(fraction) * halfWidthMm,
    );
}

function isUntouchedLegacyFirstRay(el: PlacedElement, lengthMm: number, widthMm: number): boolean {
    if (el.kind !== "mortons_extension" && el.kind !== "reverse_mortons") return false;
    if (Math.abs(el.rotationDeg) > 0.05) return false;
    if (Math.abs(el.scale.x - 1) > 0.05 || Math.abs(el.scale.y - 1) > 0.05) return false;
    const half = widthMm / 2;
    return LEGACY_FIRST_RAY_POSES.some((legacy) => {
        if (legacy.kind !== el.kind) return false;
        const x = legacy.u * lengthMm - lengthMm / 2;
        const y = legacyFirstRayY(el.side, legacy.frame, legacy.fraction, half);
        return Math.abs(el.position.x - x) <= 0.05 && Math.abs(el.position.y - y) <= 0.05;
    });
}

/** Move an untouched pre-#300 Morton's or Reverse Morton's onto the 1st ray. */
export function repositionLegacyFirstRayDesign<T extends ShoeSizingDesign & { elements: PlacedElement[] }>(
    design: T,
): T {
    if (!design.elements.length) return design;
    const layout = insoleLayoutFromDesign(design);
    let changed = false;
    const elements = design.elements.map((el) => {
        if (!isUntouchedLegacyFirstRay(el, layout.lengthMm, layout.widthMm)) return el;
        changed = true;
        const pose = defaultElementPose(
            el.kind as "mortons_extension" | "reverse_mortons",
            el.side,
            layout.lengthMm,
            layout.widthMm,
        );
        return { ...el, position: { x: pose.position.x, y: pose.position.y } };
    });
    return changed ? { ...design, elements } : design;
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
    widthMm = mortonsReferenceWidthMm(lengthMm),
): number {
    if (elements.length === 0) return 0;
    const centerX = lengthMm / 2;
    let sum = 0;
    // Same-type and overlapping recesses use the deepest cut, never a sum.
    let lower = 0;

    for (const el of elements) {
        if (el.kind === "custom") continue;
        if (el.kind === "mortons_extension" || el.kind === "reverse_mortons") {
            const anchorX = centerX + el.position.x;
            const anchorY = el.position.y;
            // yMm is height-field Y. The pad is authored in mesh Y.
            const magnitude = mortonsHeightMm(
                el.side,
                lengthMm,
                widthMm,
                anchorX,
                anchorY,
                xMm,
                -yMm,
                el.rotationDeg,
                el.scale.x,
                el.scale.y,
                el.heightMm,
            );
            const signed = el.kind === "reverse_mortons" ? -magnitude : magnitude;
            if (signed < 0) lower = Math.min(lower, signed);
            else sum += signed;
            continue;
        }
        if (el.kind === "kinetic_wedge") {
            lower = Math.min(lower, kineticWedgeDelta(el, xMm, yMm, lengthMm, widthMm));
            continue;
        }
        const cx = centerX + el.position.x;
        // Stored Y is footprint-frame mesh Y. This sample is height-field Y.
        const cy = heightFieldYFromMeshY(el.position.y);
        const dx = xMm - cx;
        const dy = yMm - cy;

        // Y reflection reverses rotation, so a mesh +θ is a height-field −θ.
        const a = el.rotationDeg * DEG;
        const lx = dx * Math.cos(a) - dy * Math.sin(a);
        const ly = dx * Math.sin(a) + dy * Math.cos(a);

        const p = ELEMENT_PROFILES[el.kind];
        const rx = Math.max(2, p.rxMm * el.scale.x);
        const ry = Math.max(2, p.ryMm * el.scale.y);
        const t = elementFootprintT(el.kind, lx, ly, rx, ry, el.side);
        const w = domeWeight(t);
        if (w > 0) {
            const delta = p.sign * el.heightMm * w;
            if (delta < 0) lower = Math.min(lower, delta);
            else sum += delta;
        }
    }
    return sum + lower;
}

function kineticWedgeDelta(
    el: PlacedElement,
    xMm: number,
    yMm: number,
    lengthMm: number,
    widthMm: number,
): number {
    const edgeAt = mortonsEdgeMm(Math.max(0, Math.min(1, xMm / Math.max(lengthMm, 1e-6))), widthMm, el.side);
    const centerEdge = mortonsEdgeMm(RKW_CENTER_U, widthMm, el.side);
    const span = Math.abs(centerEdge.lateral - centerEdge.medial);
    const plan = rkwPlanMm(lengthMm, span);
    const halfLength = (plan.lengthMm / 2) * (el.scale.x > 1e-6 ? el.scale.x : 1);
    const halfWidth = (plan.widthMm / 2) * (el.scale.y > 1e-6 ? el.scale.y : 1);
    const anchorX = lengthMm / 2 + el.position.x;
    const meshY = -yMm;
    const dx = xMm - anchorX;
    const dy = meshY - el.position.y;
    const a = (-el.rotationDeg * Math.PI) / 180;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    const oval = rkwOvalWeight(lx, ly, halfLength, halfWidth);
    if (oval <= 0) return 0;
    const inward = meshYSign(el.side, "lateral");
    const centerInside = (el.position.y - centerEdge.medial) * inward;
    const overhang = halfWidth - centerInside;
    const distInside = (meshY - edgeAt.medial) * inward;
    let ramp = 1;
    if (overhang > 0.05 && distInside < RKW_MEDIAL_RAMP_MM) {
        const t = distInside / RKW_MEDIAL_RAMP_MM;
        ramp =
            t <= 0
                ? RKW_BORDER_DEPTH_FRACTION
                : RKW_BORDER_DEPTH_FRACTION + (1 - RKW_BORDER_DEPTH_FRACTION) * (t * t * (3 - 2 * t));
    }
    const depth = Math.min(RKW_DEPTH_MAX_MM, Math.max(0, el.heightMm));
    return -depth * oval * ramp;
}

export function isLoweringElement(kind: ElementKind | "custom"): boolean {
    if (kind === "custom") return false;
    if (kind === "reverse_mortons") return true;
    return ELEMENT_PROFILES[kind].sign < 0;
}

export function elementPlacementRefusal(
    kind: ElementKind,
    side: Side,
    elements: PlacedElement[],
    sinkKinds: readonly string[] = [],
    options?: { allowReverseMortonsWithRkw?: boolean },
): string | null {
    const sameSide = elements.filter((el) => el.side === side);
    const has = (name: ElementKind) => sameSide.some((el) => el.kind === name);
    const hasRkw = sinkKinds.includes("rkw") || has("kinetic_wedge");
    if (kind === "kinetic_wedge" && has("kinetic_wedge")) {
        return "A kinetic wedge is already on this foot. A second one is not added.";
    }
    if (
        (kind === "mortons_extension" && has("reverse_mortons")) ||
        (kind === "reverse_mortons" && has("mortons_extension"))
    ) {
        return "Morton's and Reverse Morton's cannot be on the same foot.";
    }
    if ((kind === "mortons_extension" && hasRkw) || (kind === "kinetic_wedge" && has("mortons_extension"))) {
        return "Morton's and the reverse kinetic wedge cannot be on the same foot.";
    }
    if (kind === "reverse_mortons" && hasRkw && !options?.allowReverseMortonsWithRkw) {
        return "Reverse Morton's with a reverse kinetic wedge needs an explicit override.";
    }
    return null;
}

export function loweringMaterialWarning(topMm: number, requestedCutMm: number): string | null {
    if (topMm - requestedCutMm >= REMAINING_MATERIAL_MM - 1e-6) return null;
    return `Depth clamped so at least ${REMAINING_MATERIAL_MM.toFixed(1)} mm of material remains.`;
}
