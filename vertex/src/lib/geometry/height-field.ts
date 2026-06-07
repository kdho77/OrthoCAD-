import type { PlacedElement, Side, SideCorrections } from "@/types";
import { elementHeightAt } from "@/lib/geometry/elements";
import { evaluateGraph, type OperatorGraph } from "@/lib/geometry/operator-graph";
import { effectiveOutlineHalfWidth, type TrimlineCurve } from "@/lib/geometry/trimline";
import { wedgeDeltaAt } from "@/lib/geometry/wedge";

// Shared parametric height field for insole surfaces. Used by both the procedural
// Three.js mesher and the OpenCascade solid builder so corrections stay aligned.

export interface HeightFieldParams {
    side: Side;
    lengthMm: number;
    widthMm: number;
    thicknessMm: number;
    corrections: SideCorrections;
    elements?: PlacedElement[];
    /** When false, skives are omitted (applied later as OCCT boolean cuts). */
    includeSkives?: boolean;
    /** When false, elements are omitted (applied later as OCCT booleans). */
    includeElements?: boolean;
    /** Optional user-edited insole perimeter override. */
    trimline?: TrimlineCurve | null;
    /** Phase 4 operator graph (additive clinical operators). When present its delta is added. */
    graph?: OperatorGraph | null;
}

const DEG = Math.PI / 180;

/** Smooth bump centered at `c` with radius `r`. Returns 0..1. */
export function bump(t: number, c: number, r: number): number {
    const d = Math.abs(t - c) / r;
    if (d >= 1) return 0;
    return 0.5 * (1 + Math.cos(Math.PI * d));
}

/**
 * Hermite smoothstep with C1 continuity at both ends. Returns 0 for `x <= e0`,
 * 1 for `x >= e1`, and a smooth S-curve in between. `e0` may be greater than
 * `e1` to invert the ramp. Used to remove creases that a hard boolean weight
 * (e.g. `medial ? a : 0`) would otherwise leave along the centerline.
 */
export function smoothstep(e0: number, e1: number, x: number): number {
    if (e0 === e1) return x < e0 ? 0 : 1;
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/**
 * Soft lower bound — blends toward `floor` instead of clamping hard, so the
 * deformed surface keeps a continuous tangent where corrections would push the
 * top below the minimum wall (avoids a visible crease at the floor).
 */
export function softFloor(value: number, floor: number, smoothing = 0.6): number {
    if (smoothing <= 0) return Math.max(value, floor);
    // Smooth max(value, floor): equals `value` well above the band, `floor` well
    // below it, with a small C1 blend near `value ≈ floor`. Always ≥ floor.
    const h = Math.max(smoothing - Math.abs(value - floor), 0) / smoothing;
    return Math.max(value, floor) + h * h * smoothing * 0.25;
}

/** Parametric outline half-width (0..1) at normalized length u (0 heel → 1 toe). */
export function outlineHalfWidth(u: number): number {
    const heel = 0.55 + 0.25 * bump(u, 0.08, 0.18);
    const waist = 0.78 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 1.05));
    const toe = u > 0.88 ? Math.max(0.45, 1 - (u - 0.88) / 0.12) : 1;
    return Math.min(1, heel * waist) * (0.4 + 0.6 * toe);
}

/** Outline half-width for mesh generation — uses trimline override when present. */
export function resolveOutlineHalfWidth(u: number, params: HeightFieldParams): number {
    return effectiveOutlineHalfWidth(u, params.lengthMm, params.widthMm, params.trimline);
}

/**
 * Surface height in mm at normalized footprint coordinates (u along length,
 * vSigned across width). Returns the *top* surface; the bottom is always the
 * flat z = 0 plane, so thickness = `heightAt(...)`.
 *
 * Clinical shaping notes (see docs/base-modifier-architecture.md):
 *  - Medial/lateral contributions are blended with `smoothstep` across the
 *    centerline rather than a hard `medial ? a : 0`, so the longitudinal arch
 *    dome and heel cup no longer leave a crease at v = 0.
 *  - The heel cup and the arch dome are cross-faded longitudinally so the
 *    rearfoot flows into the midfoot the way a vacuum-formed shell does.
 *  - Correction height is feathered toward the trimline edge for a natural,
 *    thinning flange instead of a square wall.
 *  - A soft floor keeps the minimum wall thickness without a hard clamp crease.
 */
export function heightAt(u: number, vSigned: number, params: HeightFieldParams): number {
    const { side, lengthMm, widthMm, thicknessMm, corrections: c, elements = [] } = params;
    const halfW = widthMm / 2;
    const medialSign = side === "left" ? -1 : 1;
    const av = Math.abs(vSigned);
    // Signed medial coordinate: +1 = full medial edge, -1 = full lateral edge.
    const m = -(vSigned * medialSign);
    // Smooth 0..1 medial emphasis (no centerline crease). Lateral side ~0.
    const medialBlend = smoothstep(-0.2, 0.45, m);
    const lateralBlend = smoothstep(-0.2, 0.45, -m);

    // --- Baseline anatomical shell (present with zero corrections) -------------
    // Without this every insole is a uniform `thicknessMm` slab — a flat block.
    // This is the inherent foot-bed contour of a full-contact orthotic: a cupped
    // heel, a medial longitudinal arch, a lower lateral column and a toe spring,
    // formed as a dished centre with raised perimeter walls. It depends only on
    // footprint geometry (not corrections), so it cancels out of the Base +
    // Modifier delta and leaves loaded bases untouched, while clinical
    // corrections below still add on top of it. Added after the correction edge
    // feather so the cup/arch rim walls survive at the trimline edge.
    const heelEnv = smoothstep(0.26, 0.04, u); // 1 at heel → 0 by midfoot
    const archEnv = bump(u, 0.4, 0.32); // medial longitudinal arch span
    const toeEnv = smoothstep(0.7, 1.0, u); // forefoot curl toward the toe
    const dish = smoothstep(0.12, 1.0, av); // raised edges, dished centre
    const medialRim = 12 * heelEnv + 16 * archEnv;
    const lateralRim = 12 * heelEnv + 5 * archEnv;
    const baseline =
        dish * (medialRim * medialBlend + lateralRim * lateralBlend) + 4 * toeEnv;

    // Shaping that should feather toward the trimline edge (dome/cup/flange/
    // elements) accumulates in `shaped`; the planar posting tilt — which must
    // remain full-strength at the edge — accumulates separately in `posting`.
    let shaped = 0;

    // --- Longitudinal arch dome ------------------------------------------------
    // Wider, gentler bell so the arch eases into the forefoot and rearfoot.
    const apexCenter = 0.42 + c.apexMoveMm / lengthMm;
    const arch = bump(u, apexCenter, 0.36);
    // Dome peaks just inboard of the medial edge and fades smoothly to centerline.
    const archAcross = medialBlend * (0.45 + 0.55 * smoothstep(0.05, 0.9, av));
    shaped += (c.archHeightMm + c.archFillMm) * arch * archAcross;

    const heel = bump(u, 0.1, 0.18); // longitudinal heel region (used by cup + skives)

    // --- Heel cup (U-shaped 3D cup) -------------------------------------------
    // Redesigned to produce a true U-shaped raised rim around the heel:
    // medial wall + posterior (back) wall + lateral wall.
    // This creates an enclosed depression so the heel sits cradled in a deeper cup
    // rather than just a medial-lateral channel.
    //
    // - heelCupDepthMm controls the rim raise (additive height on the U walls).
    //   Per requirements, this value represents (controls) the height from the
    //   print surface / bottom (z=0) to the top of the cup rim in the final contour.
    //   The actual final thickness at rim is thickness + baseline + shaped_rim + ...
    //   The param provides the clinical "cup depth" raise on top of base.
    // - The cup floor (center/back seat) is relieved (lowered z) relative to the rim
    //   for "deeper" enclosure.
    // - Smooth blending (bump + smoothstep) with no hard edges or ridges.
    // - Blends forward into the arch (heel factor fades).
    // - Works for both parametric height field and Base+Modifier (the delta from
    //   heightAt is applied only to high topFactor vertices on imported bases,
    //   preserving the base's bottom sheet).
    // - Bottom surface remains flat (z=0) by design of the height field model.
    // - Interacts with rearfoot posting (planar tilt applied after, on top of cup)
    //   and new rearfoot wedges (additional side raise on top of cup walls).
    // - Robust to trimline (av and resolve are always w.r.t. current outline edges).

    // Legacy side rim raise using heelCupHeightMm (kept for backward compat / extra control).
    const rim = smoothstep(0.18, 0.95, av);
    shaped += c.heelCupHeightMm * heel * rim;

    // Medial + lateral walls (the legs of the U) — raised on the current edges
    // within the heel region (main U contribution from depth).
    const sideWall = smoothstep(0.55, 0.92, av); // 0 near center line → 1 at edges
    shaped += c.heelCupDepthMm * heel * sideWall * 0.65;

    // Posterior wall (the bottom of the U / back lip) — raised at the very heel end
    // (low u), wrapping across the width to connect the side walls and enclose the back.
    // High across most of the heel width at the posterior, fading at extreme edges
    // (sides already covered by sideWall).
    const posteriorWall = smoothstep(0.07, 0.0, u) * (1 - smoothstep(0.7, 0.95, av));
    shaped += c.heelCupDepthMm * posteriorWall * 0.85;

    // Cup floor relief — lowers the central seat area (slightly forward of the
    // posterior wall, around u=0.12, v~0) to create the actual depression/"deeper"
    // cup. The floor sits lower than the rim by a fraction of the depth param.
    // This, combined with the raised U, produces the enclosed 3D cup.
    const floorSeat = bump(u, 0.13, 0.12); // location of the heel seat
    const floorCenter = 1 - smoothstep(0.35, 0.75, av); // high near v=0 (center line)
    shaped -= c.heelCupDepthMm * 0.35 * floorSeat * floorCenter;

    // --- Skives (medial/lateral heel) -----------------------------------------
    const includeSkives = params.includeSkives ?? true;
    if (includeSkives) {
        shaped -= c.medialSkiveMm * heel * medialBlend * smoothstep(0.1, 0.85, av);
        shaped -= c.lateralSkiveMm * heel * lateralBlend * smoothstep(0.1, 0.85, av);
    }

    // --- Flanges (raised medial/lateral walls through the midfoot) ------------
    const edge = smoothstep(0.55, 1.0, av);
    const flangeRegion = bump(u, 0.45, 0.42);
    shaped += (c.medialFlangeMm * medialBlend + c.lateralFlangeMm * lateralBlend) * flangeRegion * edge;

    // --- Placed elements (met pads, bars, sinks, …) ---------------------------
    const includeElements = params.includeElements ?? true;
    if (includeElements) {
        const hw = resolveOutlineHalfWidth(u, params) * halfW;
        shaped += elementHeightAt(elements, u * lengthMm, vSigned * hw, lengthMm);
    }

    // --- Natural edge feathering ----------------------------------------------
    // Feather the additive shaping toward the trimline so the perimeter thins to
    // a clinical edge while the base wall and posting wedge are preserved.
    const edgeFeather = smoothstep(1.0, 0.86, av); // 1 interior → 0 at outer edge
    shaped *= 0.35 + 0.65 * edgeFeather;

    // --- Posting (rearfoot / forefoot wedges) — full strength at the edge -----
    const post = vSigned * medialSign * halfW;
    let posting = Math.tan(c.rearfootPostingDeg * DEG) * post * heel;
    const fore = bump(u, 0.82, 0.24);
    posting += Math.tan(c.forefootPostingDeg * DEG) * post * fore;

    // --- Medial / Lateral surface wedges (new system) -------------------------
    // Applied after posting/flanges (so they are surface features on the already
    // tilted/posted shell) but before discrete elements. Uses the current
    // trimline-aware outline for both the cross position and (for degrees) the
    // local width used to convert angle → physical raise.
    const wedge = wedgeDeltaAt(u, vSigned, side, c, {
        lengthMm,
        widthMm,
        trimline: params.trimline,
    });

    let h = softFloor(thicknessMm + baseline + shaped + posting + wedge, 0.8);

    // Phase 4: operator graph contribution (additive, regional, STA-aware, etc.).
    // The graph is the new clinical source of truth when present; the flat
    // corrections above remain for backward compatibility and as a summary.
    if (params.graph) {
        const graphDelta = evaluateGraph(params.graph, u, vSigned);
        h += graphDelta;
    }

    return h;
}

export interface GridPoint {
    x: number;
    y: number;
    z: number;
}

export interface InsoleGrid {
    nx: number;
    ny: number;
    top: GridPoint[][];
    bottom: GridPoint[][];
}

/** Samples the correction surface on the footprint grid (no skives/elements when building OCCT base). */
export function sampleInsoleGrid(params: HeightFieldParams, nx = 48, ny = 24): InsoleGrid {
    const { lengthMm, widthMm } = params;
    const halfW = widthMm / 2;
    const top: GridPoint[][] = [];
    const bottom: GridPoint[][] = [];

    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const hw = resolveOutlineHalfWidth(u, params) * halfW;
        const topRow: GridPoint[] = [];
        const bottomRow: GridPoint[] = [];
        for (let j = 0; j <= ny; j++) {
            const vSigned = (j / ny) * 2 - 1;
            const x = u * lengthMm;
            const y = vSigned * hw;
            topRow.push({ x, y, z: heightAt(u, vSigned, params) });
            bottomRow.push({ x, y, z: 0 });
        }
        top.push(topRow);
        bottom.push(bottomRow);
    }

    return { nx, ny, top, bottom };
}
