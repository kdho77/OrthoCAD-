// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Side, SideCorrections, WedgeCorrection } from "@/types";
import { getRearfootFactor, wedgeDeltaAt } from "@/lib/geometry/wedge";
import { effectiveOutlineHalfWidth, type TrimlineCurve } from "@/lib/geometry/trimline";

/** Local bump (duplicated to avoid circular import with height-field.ts). */
function bump(t: number, c: number, r: number): number {
    const d = Math.abs(t - c) / r;
    if (d >= 1) return 0;
    return 0.5 * (1 + Math.cos(Math.PI * d));
}

/**
 * Kirby heel skive (intrinsic rearfoot wedge via plane ∩ heel bowl).
 *
 * Clinical model (Kirby 1992): a flat blade removes plaster from the plantar
 * positive cast. OrthoCAD's top mesh is the foot-contact surface, so the same
 * modification is a RAISE (+Z) under the skived edge — never a subtractive cut.
 *
 * Geometry: z_new = max(z_orig, z_plane). Footprint is the emergent
 * plane∩bowl curve. Plane is global in the frontal plane (zero A-P normal).
 * Depth is the raise at the one-third heel-width line from the skived edge
 * (not the max gap). Skive is excluded from field-F / bottom-shell coupling.
 */

export const SKIVE_DEFAULT_ANGLE_DEG = 15;
export const SKIVE_ANGLE_MIN_DEG = 5;
export const SKIVE_ANGLE_MAX_DEG = 30;
export const SKIVE_DEPTH_MAX_MM = 8;
/** A-P station for W_heel and depth/angle solve (matches heel-cup centre). */
export const SKIVE_U_REF = 0.13;
/** Hard anterior clip for the heel mask (P0.4). */
export const SKIVE_U_HARD_MAX = 0.28;
/** Fallback heel longitudinal envelope centre / half-width when no base zones. */
export const SKIVE_HEEL_BUMP_CENTER = 0.1;
export const SKIVE_HEEL_BUMP_RADIUS = 0.18;

export type SkiveEdge = "medial" | "lateral";
export type SkiveDriven = "angle" | "location";

export interface SkivePlane {
    /** World-frame frontal tilt (rad). Positive ⇒ medial side higher. */
    worldTiltRad: number;
    /** dz/dy in mesh width coordinates. */
    dzdy: number;
    /** Anchor width-coordinate (mesh) of the one-third line. */
    yThird: number;
    /** Target absolute Z of the plane at yThird. */
    zThird: number;
    edge: SkiveEdge;
    depthMm: number;
    angleDeg: number;
    /** Zero-crossing location as % from medial (0) to lateral (100). */
    locationPct: number;
    heelWidthMm: number;
    yMedial: number;
    yLateral: number;
}

export interface SkiveSolveInput {
    side: Side;
    edge: SkiveEdge;
    depthMm: number;
    angleDeg?: number;
    locationPct?: number;
    driven?: SkiveDriven;
    /** Full heel width at u_ref (mm). */
    heelWidthMm: number;
    /** Mesh width-coord of medial / lateral edges at u_ref. */
    yMedial: number;
    yLateral: number;
    /** Seat Z at the one-third line (post-wedge bowl). */
    zSeatAtThird: number;
    /** Seat Z at medial and lateral edges (for local tilt). */
    zSeatMedial: number;
    zSeatLateral: number;
}

const DEG = Math.PI / 180;

export function clampSkiveAngleDeg(deg: number): number {
    return Math.max(SKIVE_ANGLE_MIN_DEG, Math.min(SKIVE_ANGLE_MAX_DEG, deg));
}

export function clampSkiveDepthMm(mm: number): number {
    return Math.max(0, Math.min(SKIVE_DEPTH_MAX_MM, mm));
}

/**
 * Heel anterior mask. Prefer base-bounds heelEnd when provided; else bump
 * envelope; always hard-clipped at SKIVE_U_HARD_MAX.
 */
export function heelSkiveMask(u: number, heelEndU?: number): number {
    const hard = u <= SKIVE_U_HARD_MAX ? 1 : 0;
    if (hard === 0) return 0;
    if (heelEndU != null && Number.isFinite(heelEndU)) {
        // Soft shoulder over the last 15% of the heel zone.
        const soft = heelEndU > 1e-6 ? 1 - smoothstep(heelEndU * 0.85, heelEndU, u) : 1;
        return soft;
    }
    return bump(u, SKIVE_HEEL_BUMP_CENTER, SKIVE_HEEL_BUMP_RADIUS);
}

function smoothstep(e0: number, e1: number, x: number): number {
    if (e0 === e1) return x < e0 ? 0 : 1;
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/**
 * Local frontal-plane seat tilt (rad) at u_ref from edge samples.
 * Positive ⇒ medial higher (varus / medial wedge).
 *
 * The rearfoot wedge is a *graded* linear height field (not a rigid body
 * rotation); at u_ref the rearfoot zone factor is ≈1 so the edge-to-edge
 * gradient equals the delivered frontal tilt.
 */
export function seatTiltRadFromEdges(
    zMedial: number,
    zLateral: number,
    heelWidthMm: number,
): number {
    if (!(heelWidthMm > 1e-6)) return 0;
    return Math.atan((zMedial - zLateral) / heelWidthMm);
}

/**
 * Analytic seat tilt from the wedge parameter alone (unit tests / parametric).
 * Prefer seatTiltRadFromEdges on a live mesh (Option C verification path).
 */
export function seatTiltRadFromWedgeField(
    side: Side,
    corrections: SideCorrections,
    params: { lengthMm: number; widthMm: number; trimline?: TrimlineCurve | null },
    uRef: number = SKIVE_U_REF,
): number {
    // Finite-difference the graded wedge (+ legacy posting) across the frontal line.
    const halfW =
        effectiveOutlineHalfWidth(uRef, params.lengthMm, params.widthMm, params.trimline ?? null) *
        (params.widthMm / 2);
    if (!(halfW > 1e-6)) return 0;
    const zM = sampleSeatDelta(uRef, /*medial*/ true, side, corrections, params);
    const zL = sampleSeatDelta(uRef, /*medial*/ false, side, corrections, params);
    return seatTiltRadFromEdges(zM, zL, 2 * halfW);
}

function sampleSeatDelta(
    u: number,
    medial: boolean,
    side: Side,
    corrections: SideCorrections,
    params: { lengthMm: number; widthMm: number; trimline?: TrimlineCurve | null },
): number {
    const medialSign = side === "left" ? -1 : 1;
    // m=+1 medial → vSigned = -m * medialSign
    const m = medial ? 1 : -1;
    const vSigned = -m * medialSign;
    const wedge = wedgeDeltaAt(u, vSigned, side, corrections, params);
    const post = vSigned * medialSign * (params.widthMm / 2);
    const heel = bump(u, 0.1, 0.18);
    const posting = Math.tan((corrections.rearfootPostingDeg || 0) * DEG) * post * heel;
    return wedge + posting;
}

/** Width-coordinate of the one-third line from the skived edge toward the opposite edge. */
export function oneThirdLineY(yMedial: number, yLateral: number, edge: SkiveEdge): number {
    if (edge === "medial") return yMedial + (1 / 3) * (yLateral - yMedial);
    return yLateral + (1 / 3) * (yMedial - yLateral);
}

/**
 * Resolve plane from depth + (angle|location). Depth is always a driver.
 * worldPlaneAngle = skiveAngle ± seatTilt (Option C) so the angle *delivered
 * relative to the seat* equals the prescribed skiveAngleDeg.
 */
export function resolveSkivePlane(input: SkiveSolveInput): SkivePlane | null {
    const depthMm = clampSkiveDepthMm(input.depthMm);
    if (depthMm <= 0) return null;
    const W = input.heelWidthMm;
    if (!(W > 1e-3)) return null;

    const yMedial = input.yMedial;
    const yLateral = input.yLateral;
    const seatTilt = seatTiltRadFromEdges(input.zSeatMedial, input.zSeatLateral, W);

    const driven: SkiveDriven = input.driven ?? "location";
    let angleDeg: number;
    let locationPct: number;
    const yThird = oneThirdLineY(yMedial, yLateral, input.edge);

    if (driven === "angle" && input.locationPct != null) {
        locationPct = Math.max(0, Math.min(100, input.locationPct));
        // Zero-crossing at locationPct; plane through (yThird, zSeat+depth) and (yZero, zSeatZero≈interp).
        // Flat-seat algebra relative to seat: location fraction from skived edge.
        const locFrac = locationPct / 100;
        const yZero = yMedial + locFrac * (yLateral - yMedial);
        const dist = Math.abs(yZero - yThird);
        if (dist < 1e-6) {
            angleDeg = SKIVE_DEFAULT_ANGLE_DEG;
        } else {
            angleDeg = clampSkiveAngleDeg((Math.atan(depthMm / dist) * 180) / Math.PI);
        }
    } else {
        angleDeg = clampSkiveAngleDeg(input.angleDeg ?? SKIVE_DEFAULT_ANGLE_DEG);
        // Flat-seat prediction of zero-crossing; live measurement may refine.
        const tanA = Math.tan(angleDeg * DEG);
        const run = tanA > 1e-9 ? depthMm / tanA : W;
        const fromMedial =
            input.edge === "medial" ? W / 3 + run : W - (W / 3 + run);
        locationPct = Math.max(0, Math.min(100, (fromMedial / W) * 100));
        if (input.locationPct == null) {
            // keep derived
        } else if (driven === "location") {
            locationPct = Math.max(0, Math.min(100, input.locationPct));
        }
    }

    const skiveTilt = angleDeg * DEG;
    // Positive world tilt = medial higher. Medial skive adds; lateral subtracts.
    const worldTiltRad =
        input.edge === "medial" ? seatTilt + skiveTilt : seatTilt - skiveTilt;

    const medDir = Math.sign(yMedial - yLateral) || 1;
    const dzdy = Math.tan(worldTiltRad) * medDir;
    const zThird = input.zSeatAtThird + depthMm;

    return {
        worldTiltRad,
        dzdy,
        yThird,
        zThird,
        edge: input.edge,
        depthMm,
        angleDeg,
        locationPct,
        heelWidthMm: W,
        yMedial,
        yLateral,
    };
}

/** Plane Z at a mesh width-coordinate. */
export function skivePlaneZAtY(plane: SkivePlane, y: number): number {
    return plane.zThird + plane.dzdy * (y - plane.yThird);
}

/**
 * Parametric heightAt helper. Returns the raise amount (mm) so
 * `h_new = h + raise` implements `max(h, z_plane)` inside the heel mask.
 *
 * `zBowl` must evaluate the pre-skive surface (absolute mm). The plane is
 * anchored at u_ref on that surface; Option C seat tilt comes from the graded
 * rearfoot wedge / posting field.
 */
export function kirbySkiveRaiseAt(
    u: number,
    vSigned: number,
    side: Side,
    corrections: SideCorrections,
    params: {
        lengthMm: number;
        widthMm: number;
        trimline?: TrimlineCurve | null;
        heelEndU?: number;
        zCurrent: number;
        zBowl: (u: number, vSigned: number) => number;
    },
): number {
    const mask = heelSkiveMask(u, params.heelEndU);
    if (mask <= 0) return 0;
    if (!(corrections.medialSkiveMm > 0 || corrections.lateralSkiveMm > 0)) return 0;

    const halfWRef =
        effectiveOutlineHalfWidth(
            SKIVE_U_REF,
            params.lengthMm,
            params.widthMm,
            params.trimline ?? null,
        ) * (params.widthMm / 2);
    if (!(halfWRef > 1e-6)) return 0;

    const halfW =
        effectiveOutlineHalfWidth(u, params.lengthMm, params.widthMm, params.trimline ?? null) *
        (params.widthMm / 2);
    const y = vSigned * halfW;
    const yMedial = side === "left" ? halfWRef : -halfWRef;
    const yLateral = -yMedial;
    const W = 2 * halfWRef;
    const vMedial = side === "left" ? 1 : -1;
    const vLateral = -vMedial;

    const zSeatMedial = params.zBowl(SKIVE_U_REF, vMedial);
    const zSeatLateral = params.zBowl(SKIVE_U_REF, vLateral);

    let zPlaneMax = -Infinity;
    for (const edge of ["medial", "lateral"] as const) {
        const depthMm = edge === "medial" ? corrections.medialSkiveMm : corrections.lateralSkiveMm;
        if (!(depthMm > 0)) continue;
        const yThird = oneThirdLineY(yMedial, yLateral, edge);
        const vThird = (yThird / halfWRef) ; // parametric y = v * halfWRef at u_ref
        const zSeatAtThird = params.zBowl(SKIVE_U_REF, Math.max(-1, Math.min(1, vThird)));
        const plane = resolveSkivePlane({
            side,
            edge,
            depthMm,
            angleDeg: corrections.skiveAngleDeg,
            locationPct: corrections.skiveLocationPct,
            driven: corrections.skiveDriven,
            heelWidthMm: W,
            yMedial,
            yLateral,
            zSeatAtThird,
            zSeatMedial,
            zSeatLateral,
        });
        if (!plane) continue;
        zPlaneMax = Math.max(zPlaneMax, skivePlaneZAtY(plane, y));
    }
    if (!(zPlaneMax > -Infinity)) return 0;
    return Math.max(0, zPlaneMax - params.zCurrent) * mask;
}

export interface ApplyHeelSkiveMeshParams {
    side: Side;
    corrections: SideCorrections;
    lengthAxis: number;
    widthAxis: number;
    thickAxis: number;
    lenMin: number;
    lenSize: number;
    /** Top vertex count; skive writes ONLY [0, topVertexCount). */
    topVertexCount: number;
    /** Optional heel zone end from computeBaseBounds. */
    heelEndU?: number;
    /**
     * Maps mesh width-normalised coordinate to heightAt vSigned
     * (includes arch-side widthSign). Required for medial/lateral identity.
     */
    widthSign: number;
}

export interface HeelSkiveApplyReport {
    applied: boolean;
    planes: SkivePlane[];
    /** Max raise applied (mm). */
    maxRaiseMm: number;
    /** Vertices raised. */
    raisedCount: number;
    heelWidthMm: number;
    seatTiltDeg: number;
    /** Measured location % of medial plane zero-crossing (if medial applied). */
    measuredLocationPct: number | null;
}

/**
 * Apply Kirby skive to the top mesh only (R11). Call AFTER field-F composition
 * and #119 bottom-shell sync / legacy rim path. Never writes bottom verts.
 */
export function applyHeelSkiveToTopMesh(
    positions: Float32Array,
    params: ApplyHeelSkiveMeshParams,
): HeelSkiveApplyReport {
    const { corrections, topVertexCount } = params;
    const empty: HeelSkiveApplyReport = {
        applied: false,
        planes: [],
        maxRaiseMm: 0,
        raisedCount: 0,
        heelWidthMm: 0,
        seatTiltDeg: 0,
        measuredLocationPct: null,
    };
    if (
        !(corrections.medialSkiveMm > 0 || corrections.lateralSkiveMm > 0) ||
        topVertexCount <= 0
    ) {
        return empty;
    }

    const band = collectHeelBand(positions, params);
    if (!band || band.heelWidthMm < 1) return empty;

    const seatTilt = seatTiltRadFromEdges(band.zMedial, band.zLateral, band.heelWidthMm);
    const planes: SkivePlane[] = [];

    for (const edge of ["medial", "lateral"] as const) {
        const depthMm = edge === "medial" ? corrections.medialSkiveMm : corrections.lateralSkiveMm;
        if (!(depthMm > 0)) continue;
        const yThird = oneThirdLineY(band.yMedial, band.yLateral, edge);
        const zSeatAtThird = sampleBandZ(band, yThird);
        const plane = resolveSkivePlane({
            side: params.side,
            edge,
            depthMm,
            angleDeg: corrections.skiveAngleDeg,
            locationPct: corrections.skiveLocationPct,
            driven: corrections.skiveDriven,
            heelWidthMm: band.heelWidthMm,
            yMedial: band.yMedial,
            yLateral: band.yLateral,
            zSeatAtThird,
            zSeatMedial: band.zMedial,
            zSeatLateral: band.zLateral,
        });
        if (plane) planes.push(plane);
    }
    if (planes.length === 0) return empty;

    let maxRaiseMm = 0;
    let raisedCount = 0;
    const { lengthAxis, widthAxis, thickAxis, lenMin, lenSize, heelEndU } = params;

    for (let i = 0; i < topVertexCount; i++) {
        const u = (positions[i * 3 + lengthAxis]! - lenMin) / (lenSize || 1);
        const mask = heelSkiveMask(u, heelEndU);
        if (mask <= 0) continue;
        const y = positions[i * 3 + widthAxis]!;
        const z = positions[i * 3 + thickAxis]!;
        let zTarget = z;
        for (const plane of planes) {
            const zPlane = skivePlaneZAtY(plane, y);
            // Soft-mask the raise so the anterior shoulder feathers; crease
            // itself stays sharp (max of continuous surfaces).
            const raised = z + (Math.max(z, zPlane) - z) * mask;
            if (raised > zTarget) zTarget = raised;
        }
        const raise = zTarget - z;
        if (raise > 1e-9) {
            positions[i * 3 + thickAxis] = zTarget;
            raisedCount++;
            if (raise > maxRaiseMm) maxRaiseMm = raise;
        }
    }

    const medialPlane = planes.find((p) => p.edge === "medial");
    let measuredLocationPct: number | null = null;
    if (medialPlane) {
        measuredLocationPct = measureZeroCrossingPct(positions, params, medialPlane, band);
    }

    return {
        applied: raisedCount > 0,
        planes,
        maxRaiseMm,
        raisedCount,
        heelWidthMm: band.heelWidthMm,
        seatTiltDeg: (seatTilt * 180) / Math.PI,
        measuredLocationPct,
    };
}

interface HeelBand {
    yMedial: number;
    yLateral: number;
    zMedial: number;
    zLateral: number;
    heelWidthMm: number;
    /** Sorted samples {y,z} near u_ref for interpolation. */
    samples: { y: number; z: number }[];
}

function collectHeelBand(
    positions: Float32Array,
    params: ApplyHeelSkiveMeshParams,
): HeelBand | null {
    const { lengthAxis, widthAxis, thickAxis, lenMin, lenSize, topVertexCount, side, widthSign } =
        params;
    const u0 = SKIVE_U_REF;
    const uTol = 0.025;
    const samples: { y: number; z: number; m: number }[] = [];

    for (let i = 0; i < topVertexCount; i++) {
        const u = (positions[i * 3 + lengthAxis]! - lenMin) / (lenSize || 1);
        if (Math.abs(u - u0) > uTol) continue;
        const y = positions[i * 3 + widthAxis]!;
        const z = positions[i * 3 + thickAxis]!;
        samples.push({ y, z, m: 0 });
    }
    if (samples.length < 8) return null;

    // Determine medial side in mesh Y via widthSign + side convention:
    // heightAt: m = -(vSigned * medialSign), vSigned = widthSign * vNormMesh
    // ⇒ medial edge has the more-negative (widthSign*medialSign) Y direction.
    const medialSign = side === "left" ? -1 : 1;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const s of samples) {
        if (s.y < yMin) yMin = s.y;
        if (s.y > yMax) yMax = s.y;
    }
    // vNormMesh = (y - center)/(half) ; vSigned = widthSign * vNorm
    // medial wants m=+1 ⇒ vSigned = -medialSign ⇒ y direction of medial:
    const medPrefersHighY = -medialSign * widthSign > 0;
    const yMedial = medPrefersHighY ? yMax : yMin;
    const yLateral = medPrefersHighY ? yMin : yMax;

    const zMedial = sampleNearestZ(samples, yMedial);
    const zLateral = sampleNearestZ(samples, yLateral);
    const sorted = samples.map((s) => ({ y: s.y, z: s.z })).sort((a, b) => a.y - b.y);

    return {
        yMedial,
        yLateral,
        zMedial,
        zLateral,
        heelWidthMm: Math.abs(yMedial - yLateral),
        samples: sorted,
    };
}

function sampleNearestZ(samples: { y: number; z: number }[], y: number): number {
    let best = samples[0]!.z;
    let bestD = Infinity;
    for (const s of samples) {
        const d = Math.abs(s.y - y);
        if (d < bestD) {
            bestD = d;
            best = s.z;
        }
    }
    return best;
}

function sampleBandZ(band: HeelBand, y: number): number {
    const s = band.samples;
    if (s.length === 0) return 0;
    if (y <= s[0]!.y) return s[0]!.z;
    if (y >= s[s.length - 1]!.y) return s[s.length - 1]!.z;
    for (let i = 1; i < s.length; i++) {
        if (y <= s[i]!.y) {
            const a = s[i - 1]!;
            const b = s[i]!;
            const t = (y - a.y) / (b.y - a.y || 1);
            return a.z + t * (b.z - a.z);
        }
    }
    return s[s.length - 1]!.z;
}

/**
 * Measure zero-crossing of (z_skived - z would equal plane-seat contact) as
 * location % from medial→lateral along u_ref by finding where raise ≈ 0 on the
 * lateral side of the skive.
 */
function measureZeroCrossingPct(
    positions: Float32Array,
    params: ApplyHeelSkiveMeshParams,
    plane: SkivePlane,
    band: HeelBand,
): number {
    // Sample raise along frontal line: raise = max(0, zPlane - zSeat)
    // Zero-crossing = first y from medial toward lateral where raise drops ~0.
    const steps = 64;
    let yCross = plane.yLateral;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const y = plane.yMedial + t * (plane.yLateral - plane.yMedial);
        const zSeat = sampleBandZ(band, y);
        const raise = skivePlaneZAtY(plane, y) - zSeat;
        if (raise <= 0.05 * plane.depthMm) {
            yCross = y;
            break;
        }
        yCross = y;
    }
    const pct =
        (Math.abs(yCross - plane.yMedial) / (band.heelWidthMm || 1)) * 100;
    return Math.max(0, Math.min(100, pct));
}

/** Derive location or angle when the other lock is promoted (D6 UI helper). */
export function solveSkiveDerived(args: {
    depthMm: number;
    angleDeg: number;
    locationPct: number;
    driven: SkiveDriven;
    heelWidthMm: number;
}): { angleDeg: number; locationPct: number } {
    const W = args.heelWidthMm > 1e-3 ? args.heelWidthMm : 70;
    const depth = clampSkiveDepthMm(args.depthMm);
    if (args.driven === "location") {
        const angleDeg = clampSkiveAngleDeg(args.angleDeg || SKIVE_DEFAULT_ANGLE_DEG);
        const tanA = Math.tan(angleDeg * DEG);
        const run = tanA > 1e-9 ? depth / tanA : 0;
        const locationPct = Math.max(0, Math.min(100, ((W / 3 + run) / W) * 100));
        return { angleDeg, locationPct };
    }
    // driven === 'angle' → derive angle from location
    const locationPct = Math.max(0, Math.min(100, args.locationPct));
    const locDist = (locationPct / 100) * W;
    const dist = Math.abs(locDist - W / 3);
    const angleDeg =
        dist > 1e-6
            ? clampSkiveAngleDeg((Math.atan(depth / dist) * 180) / Math.PI)
            : SKIVE_DEFAULT_ANGLE_DEG;
    return { angleDeg, locationPct };
}

/** True when a rearfoot wedge would alter seat tilt at u_ref (for Option C). */
export function rearfootWedgeAffectsSeat(wedge: WedgeCorrection | undefined): boolean {
    return !!wedge && wedge.value > 0 && getRearfootFactor(SKIVE_U_REF) > 0;
}
