// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import { blendedFlareDeg, FLARE_BOUNDS, type WallRegionDefaults } from "./defaults";
import {
    FILLET_MAX_HEIGHT_FRAC,
    FILLET_MAX_STEP_DEG,
    filletImpliedSeamDeg,
    MIN_FILLET_RINGS,
    TOP_ROUND_MAX_STEP_DEG,
    TOP_ROUND_MIN_ROWS,
} from "./hermite";
import { countColumnPlanReversals, type HermiteStation } from "./loft";
import { countPlanViewChordCrossings, smoothAndCapFlare } from "./stations";

export interface ColumnJunction {
    planeN: XYZ;
    slopeRad: number;
}

export const FRAME_SMOOTH_ITERS = 16;
export const FRAME_ANGLE_LIMIT_DEG = 5;
export const BEZIER_HANDLE_FRAC = 0.35;
export const HANDLE_CHORD_CAP = 0.5;
export const MERGE_ROW_MM = 0.3;
export const TOP_CLEARANCE_DEG = 10;
export const T0_PIN_DEG = -45;
export const FILLET_R_CAP_MM = 3;
export const R_SMOOTH_FRAC = 0.05;
export const SCALAR_SMOOTH_SIGMA_MM = 12;
export const STATION_GAP_MULT = 1.5;
export const G1_MAX_DEG = 3;
export const SEAM_B_FALLBACK_DEG = 9.5;
export const NEIGHBOUR_SPACING_RATIO = 1.5;
export const ASPECT_EVERYWHERE_MAX = 20;
export const ASPECT_ROUND_MAX = 30;
/** Last B-strip faces may go to 40; every other strip stays at 20. */
export const ASPECT_LAST_STRIP_MAX = 40;
/** Logged [S1-CHORD-FLOOR] stations may undershoot C_MIN, at most this fraction. */
export const LAST_CHORD_FLOOR_MAX_FRAC = 0.05;
/** Post-loft signed-dihedral cap. S1-stage p99 / E/F-turn stay 5 / 6.5. */
export const SIGNED_FOLD_MAX_DEG = 150;
export const WELD_MM = 1e-3;
export const MIN_EDGE_MM = 0.01;
export const ALONG_JOINT_MAX_DEG = 8;
export const ALONG_JOINT_BUDGET_FRAC = 1.15;
export const ACROSS_STATION_MAX_DEG = 10;
/** S1-stage across p99. Step 2 tightens back to 3°. */
export const ACROSS_STATION_P99_MAX_DEG = 5;
/** S1-stage E/F ring turning. Step 2 tightens back to 3°. */
export const RING_TURNING_MAX_DEG = 6.5;
export const HEADING_MAX_DEG = 3;
export const ROUND_MIN_STEP_MM = 0.15;
export const ROUND_MAX_ASPECT = 20;
export const SHORT_WALL_H_MM = 3.2;
export const SHORT_R1_MM = 0.5;
export const SHORT_R2_MM = 0.7;
export const SHORT_MIN_L_MM = 1;
export const FOREFOOT_INSET_MM = 1;
export const TOE_SPACING_EXTENT_FRAC = 0.5;
export const ROUND_JOINT_MAX_DEG = 8;
/** Abort only on a reversed/broken first chord. First-chord vs T0 is δ/2 sampling. */
export const ROUND_JOINT_ABORT_DEG = 30;
export const T_COL_SLACK_DEG = 15;
export const MIN_ROUND_R_MM = 0.08;
/** r1 never exceeds this fraction of wall height R.z − B.z. */
export const R1_HEIGHT_FRAC = 0.3;
export const MIN_LINE_MM = 0.5;
export const LINE_MAX_STEP_MM = 2;
export const N_TOP_PATCH_MM = 2;
export const N_TOP_MAX_DEG = 5;
export const R_CHANGE_MAX_PCT = 5;
export const R2_CHANGE_MAX_PCT = 10;
/** Downward limiter so ALA cannot reopen a jump above R2_CHANGE_MAX_PCT. */
export const R2_RATE_LIMIT_PCT = 7;
/** Optional absolute parameter gate: |Δr| ≤ 0.05 mm / station. */
export const R_ABS_RATE_MM = 0.05;
/** Smooth n_plantar(B) along i before fillets (periodic Gaussian). */
export const PLANTAR_N_SMOOTH_SIGMA_MM = 10;
export const FILLET_LAST_ROW_FRAC = 0.15;
export const ROUND_SWEEP_SPLIT_DEG = 80;
export const ALONG_JOINT_MIN_EDGE_MM = 1e-6;
/** Reserved last-fillet Δφ (deg). Chord rise off this step is ≤ 6°. */
export const DPHI_L_MAX_DEG = 12;
export const FILLET_STEP_MAX_DEG = 8;
export const CHORD_RISE_MAX_DEG = 6;
/** Retired 1.5° fillet-row floor. Kept for the unused maxR2_rows helper. */
export const FILLET_ROW_STEP_MIN_DEG = 1.5;
/** |dot(h, nB)| below this rotates h toward the B-edge normal before construction. */
export const COS_T_MIN = 0.3;
/** Warn when the column heading is this far from square to B. */
export const OBLIQUE_WARN_DEG = 60;
/** Last fillet vertex must sit this far outboard of B (along heading). */
export const LAST_FILLET_S_MIN_MM = 0.05;
export const LAST_FILLET_Z_MIN_MM = 0.05;
/** Shrink r1 toward 0 and start the line on the sheet once the top slope is this steep. */
export const STEEP_SHEET_DEG = 60;
export const FILLET_B_MIN_DEG = -60;
export const FILLET_B_MAX_DEG = 80;
export const FILLET_PSI_MIN_DEG = 10;
export const FILLET_PSI_MAX_DEG = 150;
export const T0_LEAD_DROP_MM = 1;
export const FILLET_ASSERT_EPS = 1e-6;
export const BAND_INSET_MIN_MM = 0.35;
export const SHORT_CHORD_MM = 0.5;
export const COLUMN_PLANARITY_LIMIT_MM = 0.01;
export const SIDEWAYS_LIMIT_MM = 2;
export const INWARD_SLACK_MM = 0.5;
export const SEAM_B_LIMIT_DEG = 6;
/** Comparison slack on the 6° seam-B cap (6.0+0.01). */
export const SEAM_B_SLACK_DEG = 0.01;
export const OUTLINE_STATION_SPACING_MM = 1.5;

export interface XYZ {
    x: number;
    y: number;
    z: number;
}

export interface ColumnFrame {
    R: PolyPoint;
    B: PolyPoint;
    F: PolyPoint;
    h: { x: number; y: number };
    T0: XYZ;
    U: XYZ;
    a: number;
    b: number;
    /** T0 tilt from horizontal (rad). Negative is down. */
    t0TiltRad: number;
    /** U tilt from vertical toward −h (rad). */
    uTiltRad: number;
    /** TopSheet in-plane slope along +h (rad). */
    sheetSlopeRad: number;
    /** Adjacent-face steepness used to start the round (rad, 0=flat, >π/2 past vertical). */
    roundSlopeRad: number;
    /** False when neither a ray hit nor an adjacent-face plane was usable. */
    sheetSlopeValid: boolean;
    /** Plantar slope from horizontal along −h (rad), after fields. */
    plantarSlopeRad: number;
    rFillet: number;
    rTop: number;
    tFillet: number;
    u: number;
    shortChord: boolean;
    /** Rim plan offset beyond the outline (mm). Positive = overhang. */
    overhangMm: number;
    heightMm: number;
    /** Structured band ring z from the F→B tangent continuation. */
    bandZ: number;
    /** Plan inset of the constrained band ring (mm). */
    bandInsetMm: number;
    /** Last fillet-sample z before B. */
    arcEndZ: number;
    /** Median station spacing used for r2_min / C_MIN (mm). */
    stationSpacingMm: number;
    /** Outside-round end = wall start (T1). */
    E: XYZ;
    nTop: XYZ;
    nTopSmoothed: XYZ;
    wOut: { x: number; y: number };
    nWall: XYZ;
    roundRows: number;
    /** External-tangent length (signed; negative if unordered). */
    lineLengthMm: number;
    /** Wall lean of d from vertical (rad). Positive = inward. */
    leanRad: number;
    /** Line direction tilt from horizontal (rad). Negative is down. */
    lineTiltRad: number;
    /** Designed outside-round sweep (rad). */
    roundSweepRad: number;
    /** Designed fillet sweep (rad). */
    filletSweepRad: number;
    /** |dot(h, nB)| after any pre-construction square-up. */
    cosT: number;
    /** Reserved last-fillet Δφ (rad), sized square-to-B. */
    lastDlRad: number;
    /** Global identical piece counts. */
    nRoundFix: number;
    nFilFix: number;
    nLineFix: number;
    /** angle(h, nB) in degrees. */
    headingObliqueDeg: number;
    /** B-loop normal used as the fillet-plane horizontal (square to B). */
    nB: { x: number; y: number };
    /** Rim tangent at R (for the top-round plane). */
    tRim: XYZ;
    /** Local B-neighbour spacing for C_MIN (mm). Mean of the two adjacent B segments. */
    localSpacingMm: number;
    /** Longer adjacent B segment (mm). r2_min uses this so aspect-B stays ≤ 20. */
    maxSpacingMm: number;
    /** G1 at E / F after the ruling projection (deg). */
    g1EDeg: number;
    g1FDeg: number;
    sweepConverged: boolean;
    /** Tagged when the sweep fails and the pairing is more than 60° off nB. */
    obliqueFallback: boolean;
    nRoundPlane: XYZ;
    nFilPlane: XYZ;
    /** Designed top-round end angle (rad). */
    phiRound1: number;
    /** Sticky lock after the periodic φ1 smooth. */
    phiRound1Lock?: number;
    /** Posted plantar normal at B (unit, +z). */
    nPlantar?: XYZ;
    /** Top-sheet face normal at R, used to start the round on the incident tangent. */
    sheetPlaneN?: XYZ;
    /** Closed-ring station index (for [S1-I] / weld keys). */
    stationIndex?: number;
    /** Min-wall could not drop F after r2-floor + lean; posting must clamp height. */
    postingHeightClamp?: boolean;
    /** Final last-step chord accepted below C_MIN after the r2 floor. */
    chordFloor?: boolean;
    /** Why the last chord was accepted short: row-cap vs residual chord miss. */
    chordFloorReason?: "rows" | "chord";
    /** Incident-face start tangent at R (column plane). */
    tInc?: XYZ | null;
    /** Last constructed sweep; columnPoints samples this so the round stays on-plane. */
    sweepRule?: SweepRule;
}

export interface ObliqueFallbackRow {
    i: number;
    u: number;
    obliqueDeg: number;
    seamDeg: number;
    g1EDeg: number;
    g1FDeg: number;
}

export interface MinWallClamp {
    station: number;
    u: number;
    droppedMm: number;
    postingHeightClamp?: boolean;
}

export interface ColumnQuality {
    maxAlongJointDeg: number;
    maxTcolDeg: number;
    tColBoundHits: number;
    reversals: number;
    alongOverBudget: number;
    maxAcrossDeg: number;
    maxAcrossP99Deg: number;
    maxTopRoundDeg: number;
    maxRoundWallDeg: number;
    minEdgeMm: number;
    maxStationGapMult: number;
    minLineMm: number;
    maxNTopChangeDeg: number;
    maxR1ChangePct: number;
    maxR2ChangePct: number;
    maxR1ChangeMm: number;
    maxR2ChangeMm: number;
    minLastChordOverLocal: number;
    lastChordFloorStations: number;
    lastChordFloorFrac: number;
    maxHeadingChangeDeg: number;
    maxToeSpacingRatio: number;
    minForefootInsetMm: number;
    maxAlaPackMm: number;
    maxSignedSeamDeg: number;
    flippedFaces: number;
    minLastRowSMm: number;
    minLastRowHeightMm: number;
    maxBFaceAspect: number;
    maxTopSheetEdgeDeg: number;
    nRows: number;
    minLastChordMm: number;
    maxChordRiseDeg: number;
    lastSzMonotone: boolean;
    stationSpacingMm: number;
    rowPieceIdentical: boolean;
    maxAlongRowDeg: number;
    maxObliqueDeg: number;
    nObliqueWarn: number;
    maxG1EDeg: number;
    maxG1FDeg: number;
    maxAspectEverywhere: number;
    maxAspectRound: number;
    maxNeighbourSpacingRatio: number;
    /** B-ring neighbour spacing ratio (pass/fail). R stays diagnostic. */
    maxNeighbourSpacingRatioB: number;
    maxNeighbourSpacingRatioR: number;
    columnCrossings: number;
    maxSignedSeamNonFallbackDeg: number;
    maxETurningDeg: number;
    maxFTurningDeg: number;
    maxSignedFoldDeg: number;
    nFoldsOver90: number;
    inwardWallFaces: number;
    nRoundSetter?: number;
    nRoundSetterU?: number;
    nRoundCollapsedSkipped?: number;
    obliqueFallback: ObliqueFallbackRow[];
    /** top|round at j=1 for stations in u 0.40–0.54. */
    topRoundBand: Array<{ i: number; u: number; deg: number }>;
    /** max |φ_round|/nRound* (deg). Gate: ≤8. */
    maxRoundStepDeg: number;
    /** max |first-chord − incident tangent| (deg). Gate: ≤2. */
    maxStartIncidentDeg: number;
    /** min fillet-row Euclidean / C_MIN. Gate: ≥1. */
    minFilletChordOverCMin: number;
}

export interface BezierColumns {
    xyz: PolyPoint[][];
    impliedSeamDeg: number[];
    planReversals: number;
    maxFrameAngleDeg: number;
    maxOffPlaneMm: number;
    maxSidewaysMm: number;
    frames: ColumnFrame[];
    flareDeg: number[];
    flareCapReport: ReturnType<typeof smoothAndCapFlare>["report"];
    minWallClamps: MinWallClamp[];
    quality: ColumnQuality;
    nRoundReport?: NRoundStarReport;
    smoothLog?: { before: StationParamRow[]; after: StationParamRow[] };
}

export interface NRoundStarReport {
    nRound: number;
    nFil: number;
    nLine: number;
    setter: number;
    setterU: number;
    sweepDeg: number;
    collapsedSkipped: number;
    aspectCapped: boolean;
    aspectStation: number;
}

export interface StationParamRow {
    u: number;
    flare: number;
    t0: number;
    a: number;
    b: number;
    rRound: number;
    rFillet: number;
    height: number;
    planEB: number;
}

function hypot3(a: XYZ): number {
    return Math.hypot(a.x, a.y, a.z);
}

function unit3(a: XYZ): XYZ {
    const l = hypot3(a) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
}

function add3(a: XYZ, b: XYZ, s = 1): XYZ {
    return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

function dot3(a: XYZ, b: XYZ): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a: XYZ, b: XYZ): XYZ {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dist3(a: XYZ, b: XYZ): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function pointInPolyXY(x: number, y: number, poly: PolyPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i]!.y;
        const yj = poly[j]!.y;
        const xi = poly[i]!.x;
        const xj = poly[j]!.x;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi) inside = !inside;
    }
    return inside;
}

function distToPolyXY(p: PolyPoint, loop: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
        best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t)));
    }
    return best;
}

/** Signed rim overhang: + if the rim sits outside BottomOutline. */
export function rimOverhangMm(rim: PolyPoint, outline: PolyPoint[]): number {
    const d = distToPolyXY(rim, outline);
    return pointInPolyXY(rim.x, rim.y, outline) ? -d : d;
}

export function evalCubicBezier(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, t: number): XYZ {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
        x: uuu * P0.x + 3 * uu * t * P1.x + 3 * u * tt * P2.x + ttt * P3.x,
        y: uuu * P0.y + 3 * uu * t * P1.y + 3 * u * tt * P2.y + ttt * P3.y,
        z: uuu * P0.z + 3 * uu * t * P1.z + 3 * u * tt * P2.z + ttt * P3.z,
    };
}

/** In-plane T0: +h in plan, tilt from horizontal (negative = down). */
function t0FromTilt(h: { x: number; y: number }, tiltRad: number): XYZ {
    const c = Math.cos(tiltRad);
    const s = Math.sin(tiltRad);
    return unit3({ x: h.x * c, y: h.y * c, z: s });
}

export interface PlantarFrame {
    w: XYZ;
    ew: XYZ;
    ez: XYZ;
}

/** w = unit horizontal B → plan(R) = −h. */
export function columnW(h: { x: number; y: number }): XYZ {
    return { x: -h.x, y: -h.y, z: 0 };
}

/**
 * Local (w, z) after the plantar slope along −w replaces world-horizontal.
 * e_z = n_plantar(B); e_w is the plantar-horizontal toward +w.
 */
export function plantarFrameAt(h: { x: number; y: number }, plantarSlopeRad: number): PlantarFrame {
    const w = columnW(h);
    const ca = Math.cos(plantarSlopeRad);
    const sa = Math.sin(plantarSlopeRad);
    return {
        w,
        ew: { x: ca * w.x, y: ca * w.y, z: -sa },
        ez: { x: sa * w.x, y: sa * w.y, z: ca },
    };
}

/**
 * Local plantar frame from n_plantar(B). e_z = n; e_w is the plantar tangent
 * along −h (column W), flipped to agree with +w.
 */
export function plantarFrameFromNormal(h: { x: number; y: number }, nIn: XYZ): PlantarFrame {
    const w = columnW(h);
    let ez = unit3(nIn.x || nIn.y || nIn.z ? nIn : { x: 0, y: 0, z: 1 });
    if (ez.z < 0) ez = { x: -ez.x, y: -ez.y, z: -ez.z };
    const d = w.x * ez.x + w.y * ez.y + w.z * ez.z;
    let ew = { x: w.x - ez.x * d, y: w.y - ez.y * d, z: w.z - ez.z * d };
    if (hypot3(ew) < 1e-9) ew = { x: w.x, y: w.y, z: 0 };
    ew = unit3(ew);
    if (ew.x * w.x + ew.y * w.y + ew.z * w.z < 0) ew = { x: -ew.x, y: -ew.y, z: -ew.z };
    return { w, ew, ez };
}

export function resolvePlantarFrame(
    h: { x: number; y: number },
    plantarSlopeRad: number,
    nPlantar?: XYZ,
): PlantarFrame {
    return nPlantar ? plantarFrameFromNormal(h, nPlantar) : plantarFrameAt(h, plantarSlopeRad);
}

export function clampFilletB(bRad: number): number {
    const lo = ((FILLET_B_MIN_DEG + 1e-3) * Math.PI) / 180;
    const hi = ((FILLET_B_MAX_DEG - 1e-3) * Math.PI) / 180;
    return Math.max(lo, Math.min(hi, bRad));
}

export function filletDir(b: number, frame: PlantarFrame): XYZ {
    const sb = Math.sin(b);
    const cb = Math.cos(b);
    return unit3({
        x: sb * frame.ew.x + cb * frame.ez.x,
        y: sb * frame.ew.y + cb * frame.ez.y,
        z: sb * frame.ew.z + cb * frame.ez.z,
    });
}

function applyTilts(fr: ColumnFrame): void {
    const w = fr.wOut ?? { x: -fr.h.x, y: -fr.h.y };
    fr.wOut = w;
    fr.T0 = t0FromTilt(fr.h, fr.t0TiltRad);
    fr.U = filletDir(fr.uTiltRad, resolvePlantarFrame(fr.h, fr.plantarSlopeRad, fr.nPlantar));
}

function projectToPlane(p: XYZ, R: XYZ, h: { x: number; y: number }): XYZ {
    const nx = -h.y;
    const ny = h.x;
    const d = (p.x - R.x) * nx + (p.y - R.y) * ny;
    return { x: p.x - d * nx, y: p.y - d * ny, z: p.z };
}

export function offPlaneMm(p: XYZ, R: XYZ, h: { x: number; y: number }): number {
    return Math.abs((p.x - R.x) * -h.y + (p.y - R.y) * h.x);
}

function belowPlane(p: XYZ, rim: XYZ, plane: XYZ, eps = 1e-3): boolean {
    return plane.x * (p.x - rim.x) + plane.y * (p.y - rim.y) + plane.z * (p.z - rim.z) < -eps;
}

function rowInsideTop(
    q: XYZ,
    rim: XYZ,
    plane: XYZ,
    rimLoop: PolyPoint[],
    topZ: (x: number, y: number) => number | null,
): boolean {
    const insidePlan = pointInPolyXY(q.x, q.y, rimLoop);
    const tz = topZ(q.x, q.y);
    const inSolid = insidePlan && tz != null && q.z >= tz - 0.35;
    const above = !belowPlane(q, rim, plane);
    return inSolid || above;
}

function mergeClose(pts: XYZ[]): XYZ[] {
    if (pts.length === 0) return [];
    const out = [{ ...pts[0]! }];
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i]!;
        const last = out[out.length - 1]!;
        const d = dist3(last, p);
        if (i === pts.length - 1) {
            if (d < MERGE_ROW_MM && out.length > 1) out[out.length - 1] = { ...p };
            else out.push({ ...p });
            continue;
        }
        if (d >= MERGE_ROW_MM) out.push({ ...p });
    }
    return out;
}

/** Even arc-length samples. Endpoints stay put. Close rows are merged first. */
export function sampleByArcLength(pts: XYZ[], n: number): XYZ[] {
    const cleaned = mergeClose(pts);
    if (n <= 1) return [{ ...cleaned[0]! }];
    if (cleaned.length === 1) return Array.from({ length: n }, () => ({ ...cleaned[0]! }));
    const cum = [0];
    for (let i = 1; i < cleaned.length; i++) {
        cum.push(cum[i - 1]! + dist3(cleaned[i - 1]!, cleaned[i]!));
    }
    const total = Math.max(cum[cum.length - 1]!, 1e-6);
    const out: XYZ[] = [{ ...cleaned[0]! }];
    for (let k = 1; k < n - 1; k++) {
        const s = (k / (n - 1)) * total;
        let j = 0;
        while (j < cum.length - 2 && cum[j + 1]! < s) j++;
        const a = cleaned[j]!;
        const b = cleaned[j + 1] ?? a;
        const span = Math.max(1e-9, cum[j + 1]! - cum[j]!);
        const f = (s - cum[j]!) / span;
        out.push({
            x: a.x + (b.x - a.x) * f,
            y: a.y + (b.y - a.y) * f,
            z: a.z + (b.z - a.z) * f,
        });
    }
    out.push({ ...cleaned[cleaned.length - 1]! });
    return out;
}

function unit2(s: number, z: number): { s: number; z: number } {
    const l = Math.hypot(s, z) || 1;
    return { s: s / l, z: z / l };
}

export interface ConstructedFillet {
    Pp: XYZ;
    K: XYZ;
    Pw: XYZ;
    C: XYZ;
    d: XYZ;
    b: number;
    psi: number;
    t: number;
    r: number;
    phi0: number;
    phi1: number;
    ew: XYZ;
    ez: XYZ;
}

export function leanFromVertical(U: XYZ, frame: PlantarFrame): number {
    return Math.atan2(
        U.x * frame.ew.x + U.y * frame.ew.y + U.z * frame.ew.z,
        U.x * frame.ez.x + U.y * frame.ez.y + U.z * frame.ez.z,
    );
}

export function filletRadiusMm(heightMm: number, wallLen: number, psi: number): number {
    const half = Math.max(Math.tan(psi / 2), 1e-6);
    return Math.max(
        0.05,
        Math.min(FILLET_MAX_HEIGHT_FRAC * Math.max(heightMm, 0.5), FILLET_R_CAP_MM, wallLen / (2 * half)),
    );
}

/**
 * Exact fillet: P_p = B, K = B + t e_w, P_w = K + t d, C = B + r n_plantar.
 * phi: −90 → −b about C, sweep +psi. F := P_w.
 */
export function constructFillet(
    B: XYZ,
    h: { x: number; y: number },
    r: number,
    U: XYZ,
    plantarSlopeRad: number,
    nPlantar?: XYZ,
): ConstructedFillet {
    const frame = resolvePlantarFrame(h, plantarSlopeRad, nPlantar);
    const b = clampFilletB(leanFromVertical(U, frame));
    const psi = Math.PI / 2 - b;
    const rr = Math.max(r, 1e-6);
    const t = rr * Math.tan(psi / 2);
    const d = filletDir(b, frame);
    const Pp = { x: B.x, y: B.y, z: B.z };
    const K = add3(Pp, frame.ew, t);
    const Pw = add3(K, d, t);
    const C = add3(Pp, frame.ez, rr);
    return {
        Pp,
        K,
        Pw,
        C,
        d,
        b,
        psi,
        t,
        r: rr,
        phi0: -Math.PI / 2,
        phi1: -b,
        ew: frame.ew,
        ez: frame.ez,
    };
}

export function filletPointAtPhi(fil: ConstructedFillet, phi: number): XYZ {
    return {
        x: fil.C.x + fil.r * (Math.cos(phi) * fil.ew.x + Math.sin(phi) * fil.ez.x),
        y: fil.C.y + fil.r * (Math.cos(phi) * fil.ew.y + Math.sin(phi) * fil.ez.y),
        z: fil.C.z + fil.r * (Math.cos(phi) * fil.ew.z + Math.sin(phi) * fil.ez.z),
    };
}

export function assertFilletStation(fil: ConstructedFillet, label = ""): void {
    const eps = FILLET_ASSERT_EPS;
    const dPp = dist3(fil.Pp, fil.C);
    const dPw = dist3(fil.Pw, fil.C);
    if (Math.abs(dPp - fil.r) > eps || Math.abs(dPw - fil.r) > eps) {
        throw new Error(`[S1-FILLET] |P-C|!=r${label} Pp=${dPp} Pw=${dPw} r=${fil.r}`);
    }
    const tPp = unit3({
        x: -Math.sin(fil.phi0) * fil.ew.x + Math.cos(fil.phi0) * fil.ez.x,
        y: -Math.sin(fil.phi0) * fil.ew.y + Math.cos(fil.phi0) * fil.ez.y,
        z: -Math.sin(fil.phi0) * fil.ew.z + Math.cos(fil.phi0) * fil.ez.z,
    });
    const dotZ = tPp.x * fil.ez.x + tPp.y * fil.ez.y + tPp.z * fil.ez.z;
    if (Math.abs(dotZ) > eps) {
        throw new Error(`[S1-FILLET] tangent at Pp not (1,0)${label} dotZ=${dotZ}`);
    }
    const tPw = unit3({
        x: -Math.sin(fil.phi1) * fil.ew.x + Math.cos(fil.phi1) * fil.ez.x,
        y: -Math.sin(fil.phi1) * fil.ew.y + Math.cos(fil.phi1) * fil.ez.y,
        z: -Math.sin(fil.phi1) * fil.ew.z + Math.cos(fil.phi1) * fil.ez.z,
    });
    const dotD = tPw.x * fil.d.x + tPw.y * fil.d.y + tPw.z * fil.d.z;
    if (dotD < 0.9999) {
        throw new Error(`[S1-FILLET] tangent at Pw·d=${dotD}${label}`);
    }
    if (!(fil.phi1 > fil.phi0 + 1e-9)) {
        throw new Error(`[S1-FILLET] phi not increasing${label} ${fil.phi0} → ${fil.phi1}`);
    }
    const nCheck = 8;
    for (let i = 0; i < nCheck; i++) {
        const phi = fil.phi0 + ((fil.phi1 - fil.phi0) * i) / (nCheck - 1);
        const p = filletPointAtPhi(fil, phi);
        const above = (p.x - fil.Pp.x) * fil.ez.x + (p.y - fil.Pp.y) * fil.ez.y + (p.z - fil.Pp.z) * fil.ez.z;
        if (above < -eps) {
            throw new Error(`[S1-FILLET] arc below plantar${label} above=${above}`);
        }
        if (Math.abs(fil.ez.x) + Math.abs(fil.ez.y) < 1e-3 && p.z < fil.Pp.z - eps) {
            throw new Error(`[S1-FILLET] arc z < z_B${label} z=${p.z} zB=${fil.Pp.z}`);
        }
    }
}

/** Path tangent leaving F (continuation of −U) and arriving at B (plantar-horizontal). */
export function filletPathTangents(
    h: { x: number; y: number },
    U: XYZ,
    plantarSlopeRad: number,
): { tf: { s: number; z: number }; tb: { s: number; z: number } } {
    const fil = constructFillet({ x: 0, y: 0, z: 0 }, h, 1, U, plantarSlopeRad);
    const us = fil.d.x * h.x + fil.d.y * h.y;
    const tf = unit2(-us, -fil.d.z);
    const ewS = fil.ew.x * h.x + fil.ew.y * h.y;
    const tb = unit2(-ewS, -fil.ew.z);
    return { tf, tb };
}

/** Side of B that lands inside BottomOutline. +h is R→B (usually inward). */
export function inwardOfOutline(
    B: XYZ,
    h: { x: number; y: number },
    outline: PolyPoint[],
): { x: number; y: number } {
    const plus = { x: B.x + h.x * 0.6, y: B.y + h.y * 0.6 };
    if (pointInPolyXY(plus.x, plus.y, outline)) return h;
    return { x: -h.x, y: -h.y };
}

export function estimateBandInsetMm(r: number, theta: number): number {
    const raw = Math.max(0, r) * Math.sin(Math.max(0, Math.min(Math.PI / 2, theta)));
    return Math.max(BAND_INSET_MIN_MM, raw);
}

/** Band z from the F→B arrival tangent so the first plantar face is G1 at B. */
export function tangentBandZ(fr: ColumnFrame, alongH: number): number {
    applyTilts(fr);
    const { tb } = filletPathTangents(fr.h, fr.U, fr.plantarSlopeRad);
    if (Math.abs(tb.s) < 1e-6) return fr.B.z;
    return fr.B.z + alongH * (tb.z / tb.s);
}

export function applyTangentBandZ(frames: ColumnFrame[]): void {
    const outline = frames.map((f) => f.B);
    for (const fr of frames) {
        applyTilts(fr);
        const { theta } = filletCenterAndF(fr.B, fr.h, fr.rFillet, fr.U, fr.plantarSlopeRad);
        const inset = estimateBandInsetMm(fr.rFillet, theta);
        const inn = inwardOfOutline(fr.B, fr.h, outline);
        const alongH = inset * Math.sign(inn.x * fr.h.x + inn.y * fr.h.y || 1);
        fr.bandInsetMm = inset;
        fr.bandZ = tangentBandZ(fr, alongH);
    }
}

/** Overwrite constrained-band verts from the final column tangent (actual XY). */
export function applyPlantarBandZ(frames: ColumnFrame[], bandPoints: PolyPoint[]): void {
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const band = bandPoints[i];
        if (!band) {
            fr.bandZ = fr.B.z;
            continue;
        }
        const alongH = (band.x - fr.B.x) * fr.h.x + (band.y - fr.B.y) * fr.h.y;
        fr.bandInsetMm = Math.hypot(band.x - fr.B.x, band.y - fr.B.y);
        fr.bandZ = tangentBandZ(fr, alongH);
        band.z = fr.bandZ;
    }
}

export function filletCenterAndF(
    B: XYZ,
    h: { x: number; y: number },
    r: number,
    U: XYZ,
    plantarSlopeRad: number,
): { C: { s: number; z: number }; F: XYZ; theta: number } {
    const fil = constructFillet(B, h, r, U, plantarSlopeRad);
    const s = (fil.C.x - B.x) * h.x + (fil.C.y - B.y) * h.y;
    return { C: { s, z: fil.C.z }, F: fil.Pw, theta: fil.psi };
}

export function sizedArcRows(
    sweepRad: number,
    radiusMm: number,
    stationSpacingMm: number,
    minRows: number,
    maxStepDeg: number,
    preferAngle = false,
): number {
    const deg = Math.abs((sweepRad * 180) / Math.PI);
    const arcLen = Math.max(Math.abs(radiusMm * sweepRad), 1e-6);
    const spacing = Math.max(stationSpacingMm, 1e-6);
    const minStep = Math.max(ROUND_MIN_STEP_MM, spacing / ROUND_MAX_ASPECT);
    const nByMin = Math.max(1, Math.floor(arcLen / minStep));
    const nByAngle = Math.max(minRows, Math.ceil(deg / Math.max(maxStepDeg, 1e-3)));
    const nBy1x = Math.max(minRows, Math.ceil(arcLen / spacing));
    const nByHalf = Math.max(minRows, Math.ceil(arcLen / Math.max(0.5 * spacing, minStep)));
    if (preferAngle) {
        // Extra rows wherever the round turns more than 80° so every row is ≤ 8°.
        if (deg > ROUND_SWEEP_SPLIT_DEG) return Math.max(minRows, nByAngle);
        return Math.max(minRows, nByAngle);
    }
    return Math.max(minRows, Math.min(Math.max(nBy1x, nByHalf, nByAngle), nByMin));
}

/** Line interiors; 0 when L is shorter than half the station spacing. */
export function lineRowCount(lengthMm: number, stationSpacingMm: number): number {
    const spacing = Math.max(stationSpacingMm, 1e-6);
    if (lengthMm < Math.max(MIN_LINE_MM, 0.5 * spacing) - 1e-9) return 0;
    const step = Math.min(LINE_MAX_STEP_MM, Math.max(0.5 * spacing, Math.min(spacing, LINE_MAX_STEP_MM)));
    return Math.max(1, Math.ceil(lengthMm / step));
}

export function filletRowCount(psiRad: number, radiusMm = 1, stationSpacingMm = 1.3): number {
    return sizedArcRows(psiRad, radiusMm, stationSpacingMm, MIN_FILLET_RINGS, FILLET_MAX_STEP_DEG);
}

export function topRoundRowCount(sweepRad: number, radiusMm = 0.5, stationSpacingMm = 1.3): number {
    return sizedArcRows(
        sweepRad,
        radiusMm,
        stationSpacingMm,
        TOP_ROUND_MIN_ROWS,
        TOP_ROUND_MAX_STEP_DEG,
        true,
    );
}

/** Equal-φ interiors from P_w toward P_p. Does not include P_w or B. */
function sampleFilletEqualPhi(fr: ColumnFrame, nInterior: number): XYZ[] {
    applyTilts(fr);
    const fil = constructFillet(fr.B, fr.h, fr.rFillet, fr.U, fr.plantarSlopeRad, fr.nPlantar);
    const count = Math.max(filletRowCount(fil.psi), nInterior);
    const rings: XYZ[] = [];
    for (let i = 1; i <= count; i++) {
        const phi = fil.phi1 + ((fil.phi0 - fil.phi1) * i) / (count + 1);
        rings.push(filletPointAtPhi(fil, phi));
    }
    return rings;
}

export interface OutsideRound {
    C: XYZ;
    E: XYZ;
    wOut: XYZ;
    nTop: XYZ;
    nWall: XYZ;
    tOut: XYZ;
    T0: XYZ;
    sweep: number;
    r: number;
}

/** Exterior top-edge round: C = R − r n_top, sweep the whole corner to wall T0. */
export function constructOutsideRound(
    R: XYZ,
    nTopIn: XYZ,
    hIn: { x: number; y: number },
    r: number,
    t0TiltRad: number,
): OutsideRound {
    const hl = Math.hypot(hIn.x, hIn.y) || 1;
    const h = { x: hIn.x / hl, y: hIn.y / hl };
    const wOut = { x: -h.x, y: -h.y, z: 0 };
    const raw = nTopIn.x || nTopIn.y || nTopIn.z ? nTopIn : { x: 0, y: 0, z: 1 };
    const ns = raw.x * h.x + raw.y * h.y;
    let nTop = unit3({ x: ns * h.x, y: ns * h.y, z: raw.z });
    if (nTop.z < 0) nTop = { x: -nTop.x, y: -nTop.y, z: -nTop.z };
    const nS = nTop.x * h.x + nTop.y * h.y;
    let tOut = unit3({ x: -nTop.z * h.x, y: -nTop.z * h.y, z: nS });
    if (tOut.x * wOut.x + tOut.y * wOut.y < 0) tOut = { x: -tOut.x, y: -tOut.y, z: -tOut.z };
    const rr = Math.max(r, 1e-6);
    const C = add3(R, nTop, -rr);
    const T0 = t0FromTilt(h, t0TiltRad);
    const th = t0TiltRad;
    const nWall = unit3({
        x: Math.sin(th) * h.x,
        y: Math.sin(th) * h.y,
        z: -Math.cos(th),
    });
    const E = add3(C, nWall, rr);
    const sweep = Math.acos(Math.max(-1, Math.min(1, dot3(nTop, nWall))));
    return { C, E, wOut, nTop, nWall, tOut, T0, sweep, r: rr };
}

export interface Sz {
    s: number;
    z: number;
}

export interface ArcLineArc {
    C1: XYZ;
    C2: XYZ;
    T1: XYZ;
    T2: XYZ;
    n: XYZ;
    nTop: XYZ;
    nPlant: XYZ;
    tStart: XYZ;
    d: XYZ;
    L: number;
    r1: number;
    r2: number;
    roundSweep: number;
    filletSweep: number;
    leanRad: number;
    lineTiltRad: number;
    phiRound0: number;
    phiRound1: number;
    phiFil0: number;
    phiFil1: number;
}

function projectNTop(nTopIn: XYZ, h: { x: number; y: number }, preserveOrientation = false): XYZ {
    const raw = nTopIn.x || nTopIn.y || nTopIn.z ? nTopIn : { x: 0, y: 0, z: 1 };
    const ns = raw.x * h.x + raw.y * h.y;
    let nTop = unit3({ x: ns * h.x, y: ns * h.y, z: raw.z });
    if (!preserveOrientation && nTop.z < 0) nTop = { x: -nTop.x, y: -nTop.y, z: -nTop.z };
    return nTop;
}

/**
 * Drop-along-+h steepness from an adjacent-face normal (rad).
 * 0 = horizontal, π/2 = vertical down, >π/2 = past vertical.
 */
export function sheetSlopeFromNormal(n: XYZ, h: { x: number; y: number }): number | null {
    const ns = n.x * h.x + n.y * h.y;
    const nz = n.z;
    if (Math.abs(ns) < 1e-12 && Math.abs(nz) < 1e-12) return null;
    return Math.atan2(ns, nz);
}

/** In-plane n_top for drop-along-+h steepness (allows past vertical). */
export function nTopFromSheetSlope(slopeRad: number, h: { x: number; y: number }): XYZ {
    const ns = Math.sin(slopeRad);
    const nz = Math.cos(slopeRad);
    return unit3({ x: ns * h.x, y: ns * h.y, z: nz });
}

export function r1ForSheetSlope(r1In: number, slopeRad: number): number {
    const deg = (Math.abs(slopeRad) * 180) / Math.PI;
    if (deg < STEEP_SHEET_DEG - 1e-9) return Math.max(MIN_ROUND_R_MM, r1In);
    const t = Math.max(0, Math.min(1, (deg - STEEP_SHEET_DEG) / 30));
    return Math.max(MIN_ROUND_R_MM, r1In * (1 - t));
}

/** C_MIN_i = localSpacing_i / 20. localSpacing_i is the mean of the two adjacent B segments. */
export function lastFilletCMinMm(stationSpacing: number): number {
    return Math.max(1e-6, stationSpacing / 20);
}

function localSpacingOf(fr: ColumnFrame): number {
    return fr.localSpacingMm || fr.stationSpacingMm || OUTLINE_STATION_SPACING_MM;
}

function localR2MinMm(fr: ColumnFrame): number {
    const dL = fr.lastDlRad || lastFilletDLRad(Math.PI / 2, fr.cosT || 1);
    return lastFilletR2MinMm(localSpacingOf(fr), dL);
}

function planCosT(d: XYZ, nBIn: { x: number; y: number }, h: { x: number; y: number }): number {
    const pl = Math.hypot(d.x, d.y);
    const hx = pl > 1e-9 ? d.x / pl : h.x;
    const hy = pl > 1e-9 ? d.y / pl : h.y;
    let n = { ...nBIn };
    if (hx * n.x + hy * n.y < 0) n = { x: -n.x, y: -n.y };
    return Math.max(0, Math.min(1, hx * n.x + hy * n.y));
}

/** Designed last-step 3D chord on the reserved Δφ: 2 r2 sin(dL/2). */
export function lastStepChordMm(r2: number, dLRad: number): number {
    return 2 * Math.max(r2, 0) * Math.sin(Math.max(dLRad, 1e-9) / 2);
}

/**
 * Grow r2 to the real last-step floor. Height comes from L (kept ≥ minL), then r1.
 * dL is never grown: min(12°, 2·riseMax, S/2).
 */
export function floorR2OnLastStep(
    height: number,
    r1In: number,
    r2In: number,
    minL: number,
    localSpacing: number,
    S: number,
    cosT: number,
    r1Floor = MIN_ROUND_R_MM,
): { r1: number; r2: number; dL: number; r2Min: number } {
    const dL = lastFilletDLRad(S, cosT);
    const r2Min = lastFilletR2MinMm(localSpacing, dL);
    const packed = packAlaRadii(height, r1In, Math.max(r2In, r2Min), minL, r2Min, r1Floor);
    return { r1: packed.r1, r2: packed.r2, dL, r2Min };
}

/** Clamp r1 to posted H and |Δr1| ≤ 0.05. Smooth r2 with the last-step local floor; do not abs-shrink r2. */
function enforceAbsRadiusRate(frames: ColumnFrame[]): void {
    if (frames.length < 2) return;
    for (let pass = 0; pass < 8; pass++) {
        const r2Floors = frames.map((fr) => localR2MinMm(fr));
        const lim1 = rateLimitClosedAbs(
            frames.map((fr) => {
                fr.heightMm = Math.max(fr.R.z - fr.B.z, 0.5);
                return clampR1ToBudget(fr.rTop, fr.heightMm, fr.rFillet, minLineOfHeight(fr.heightMm));
            }),
            R_ABS_RATE_MM,
            MIN_ROUND_R_MM,
        );
        const lim2 = rateLimitClosedAbs(
            frames.map((fr, i) => Math.max(fr.rFillet, r2Floors[i]!)),
            R_ABS_RATE_MM,
            r2Floors,
        );
        for (let i = 0; i < frames.length; i++) {
            frames[i]!.rTop = lim1[i]!;
            frames[i]!.rFillet = Math.max(r2Floors[i]!, lim2[i]!);
        }
        for (const fr of frames) applyAlaToFrame(fr);
        let maxR1 = 0;
        for (let i = 0; i < frames.length; i++) {
            maxR1 = Math.max(maxR1, Math.abs(frames[(i + 1) % frames.length]!.rTop - frames[i]!.rTop));
        }
        if (maxR1 <= R_ABS_RATE_MM + 1e-9) break;
    }
}

/**
 * Last-step Δφ sized by the rise measured square to B:
 * riseMax_plane = atan(tan(6°) · max(cosT, 0.3));
 * dL = min(DPHI_L_MAX, 2·riseMax_plane, S/2).
 */
export function lastFilletDLRad(S: number, cosT: number): number {
    const riseMax = Math.atan(
        Math.tan((CHORD_RISE_MAX_DEG * Math.PI) / 180) * Math.max(Math.abs(cosT), COS_T_MIN),
    );
    const dPhiLMax = (DPHI_L_MAX_DEG * Math.PI) / 180;
    return Math.min(dPhiLMax, 2 * riseMax, Math.max(S, 0) / 2);
}

/** r2 floor so the reserved Δφ still spans C_MIN. */
export function lastFilletR2MinMm(stationSpacing: number, dLRad?: number): number {
    const dL = dLRad ?? (DPHI_L_MAX_DEG * Math.PI) / 180;
    return lastFilletCMinMm(stationSpacing) / (2 * Math.sin(Math.max(dL / 2, 1e-9)));
}

/**
 * Largest r2 such that (S(r2) − dL(S, cosT)) / nFil* ≥ 1.5°.
 * Growing r2 typically shrinks S via the fillet ruling; this is a cap, not a grow.
 */
export function maxR2RowsForSweep(
    evalS: (r2: number) => number,
    cosT: number,
    nFil: number,
    r2Lo: number,
    r2Hi: number,
): number {
    const minStep = (FILLET_ROW_STEP_MIN_DEG * Math.PI) / 180;
    const n = Math.max(1, nFil);
    const lo0 = Math.max(1e-4, Math.min(r2Lo, r2Hi));
    const hi0 = Math.max(lo0, r2Hi);
    const ok = (r2: number): boolean => {
        const S = Math.max(0, evalS(r2));
        const dL = lastFilletDLRad(S, cosT);
        return (S - dL) / n >= minStep - 1e-12;
    };
    if (ok(hi0)) return hi0;
    // Whole range is over-packed: keep the high end. Returning lo would smash
    // r2 to the search floor (1e-4 on the modifier shrink path) and collapse
    // the first-fillet Euclidean chord.
    if (!ok(lo0)) return hi0;
    let lo = lo0;
    let hi = hi0;
    for (let k = 0; k < 24; k++) {
        const mid = 0.5 * (lo + hi);
        if (ok(mid)) lo = mid;
        else hi = mid;
    }
    return lo;
}

export type ChordFloorReason = "rows" | "chord";

/**
 * Fillet sweep S(r2) after two ruling updates. Growing r2 moves F, which
 * changes U and typically shrinks S. Holding U fixed makes S constant and
 * the row-cap then slams r2 to the bisect floor.
 */
export function filletSweepAtR2(
    B: XYZ,
    nB: { x: number; y: number },
    r2: number,
    Uin: XYZ,
    E: XYZ,
    plantarSlopeRad: number,
    nPlantar?: XYZ,
): number {
    const frame = resolvePlantarFrame(nB, plantarSlopeRad, nPlantar);
    let U = Uin;
    let S = 0;
    for (let it = 0; it < 2; it++) {
        const fil = constructFillet(B, nB, r2, U, plantarSlopeRad, nPlantar);
        S = Math.abs(fil.phi1 - fil.phi0);
        const next = { x: fil.Pw.x - E.x, y: fil.Pw.y - E.y, z: fil.Pw.z - E.z };
        if (hypot3(next) < 1e-9) break;
        const d = unit3(next);
        const dFil = projectOntoSpan(d, frame.ew, frame.ez);
        U = hypot3(dFil) > 1e-9 ? unit3({ x: -dFil.x, y: -dFil.y, z: -dFil.z }) : { x: 0, y: 0, z: 1 };
    }
    return S;
}

/** r2 = max(r2_design, r2_chordFloor). The 1.5° row-angle cap is retired;
 * short sweeps steal from the line and space nFil* by arc length.
 */
export function resolveLastR2(
    r2Design: number,
    r2ChordFloor: number,
    _evalS: (r2: number) => number,
    _cosT: number,
    _nFil: number,
): { r2: number; maxR2Rows: number; r2ChordFloor: number; reason?: ChordFloorReason } {
    const r2 = Math.max(r2Design, r2ChordFloor);
    if (r2ChordFloor > r2Design + 1e-9) {
        return { r2, maxR2Rows: r2, r2ChordFloor, reason: "chord" };
    }
    return { r2, maxR2Rows: r2, r2ChordFloor };
}

/**
 * Fillet-piece path length: max(r2·S, nFil*·C_MIN + last-step, 0.5 mm).
 * The reserved last-step (r2·dL, or the whole arc when S < 2·dL) sits on top
 * of the nFil* body chords so each body row can hold C_MIN.
 */
export function filletPieceLengthMm(r2: number, S: number, nFil: number, cMin: number, dL = 0): number {
    const arcLen = Math.max(0, r2) * Math.max(0, S);
    const n = Math.max(1, nFil);
    const reserveLast = S > 1e-12 && dL > 1e-12 && dL + 1e-12 < S / 2;
    const lastLen = reserveLast ? Math.max(0, r2) * dL : S > 1e-12 ? arcLen : 0;
    return Math.max(arcLen, n * Math.max(0, cMin) + lastLen, FILLET_PIECE_MIN_MM);
}

function lerp3(a: XYZ, b: XYZ, t: number): XYZ {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export interface FilletPieceSample {
    Fpiece: XYZ;
    stealMm: number;
    lengthMm: number;
    pts: XYZ[];
}

/**
 * nFil* equal-arc-length samples on the fillet piece (line tail + arc).
 * Last step ends at B. If S ≥ 2·dL the reserved last-step sits on the arc;
 * if S < 2·dL the arc is one final step and the body is equally spaced.
 */
export function sampleFilletPiecePoints(
    E: XYZ,
    F: XYZ,
    r2: number,
    S: number,
    phi0: number,
    phi1: number,
    pointOnArc: (phi: number) => XYZ,
    nFil: number,
    dL: number,
    cMin: number,
): FilletPieceSample {
    const arcLen = Math.max(0, r2) * Math.max(0, S);
    const L = dist3(E, F);
    const n = Math.max(1, nFil);
    const steal = Math.min(
        Math.max(0, filletPieceLengthMm(r2, S, n, cMin, dL) - arcLen),
        Math.max(0, L - 1e-6),
    );
    const lF = steal + arcLen;
    const tF = L > 1e-12 ? (L - steal) / L : 1;
    const Fpiece = lerp3(E, F, tF);
    const sign = Math.sign(phi1 - phi0) || 1;
    const pointAt = (s: number): XYZ => {
        const ss = Math.max(0, Math.min(lF, s));
        if (ss <= steal + 1e-12) {
            const u = steal > 1e-12 ? ss / steal : 1;
            return lerp3(Fpiece, F, u);
        }
        const along = ss - steal;
        return pointOnArc(phi0 + sign * (along / Math.max(r2, 1e-9)));
    };
    const pts: XYZ[] = [];
    const reserveLast = S > 1e-12 && dL > 1e-12 && dL + 1e-12 < S / 2;
    const lastLen = reserveLast ? Math.max(0, r2) * dL : 0;
    const bodyLen = reserveLast ? Math.max(0, lF - lastLen) : steal > 1e-12 ? steal : lF;
    for (let k = 1; k <= n; k++) pts.push(pointAt((k * bodyLen) / n));
    return { Fpiece, stealMm: steal, lengthMm: lF, pts };
}

/**
 * Reserved-last-Δφ fillet samples: φ = φ0 + (S−dL)·k/n for k=1..n,
 * which includes φ1 − sign(S)·dL. Points go on the exact (C2, r2) arc.
 * `nFil` is the global identical count when provided.
 */
export function lastFilletPhis(phi0: number, phi1: number, dLRad?: number, nFil?: number): number[] {
    const S = Math.abs(phi1 - phi0);
    if (S < 1e-9) return [];
    const sign = Math.sign(phi1 - phi0) || 1;
    const dPhiLMax = (DPHI_L_MAX_DEG * Math.PI) / 180;
    const stepMax = (FILLET_STEP_MAX_DEG * Math.PI) / 180;
    const dL = Math.min(dLRad ?? dPhiLMax, S / 2);
    const n = Math.max(MIN_FILLET_RINGS, nFil ?? Math.ceil(Math.max(S - dL, 1e-12) / stepMax));
    const phis: number[] = [];
    for (let k = 1; k <= n; k++) phis.push(phi0 + (sign * (S - dL) * k) / n);
    return phis;
}

export interface ColumnPieceCounts {
    nRound: number;
    nFil: number;
    nLine: number;
    nWall: number;
}

/** Row → piece id. 0=R, 1=round, 2=line, 3=fillet, 4=B. */
export function rowPieceId(row: number, counts: ColumnPieceCounts): number {
    if (row <= 0) return 0;
    if (row <= counts.nRound) return 1;
    if (row <= counts.nRound + counts.nLine) return 2;
    if (row < counts.nWall - 1) return 3;
    return 4;
}

/**
 * Rotate h toward nB about the vertical when the column meets B obliquely
 * (cosT < 0.3). Target |dot(h, nB)| ≥ 0.3. Warn above 60°.
 */
export function squareHeadingToB(
    hIn: { x: number; y: number },
    nB: { x: number; y: number },
): { h: { x: number; y: number }; cosT: number; angleDeg: number; rotated: boolean } {
    const hl = Math.hypot(hIn.x, hIn.y) || 1;
    let h = { x: hIn.x / hl, y: hIn.y / hl };
    const nl = Math.hypot(nB.x, nB.y);
    if (nl < 1e-8) {
        return { h, cosT: 1, angleDeg: 0, rotated: false };
    }
    let n = { x: nB.x / nl, y: nB.y / nl };
    if (h.x * n.x + h.y * n.y < 0) n = { x: -n.x, y: -n.y };
    let cosT = Math.max(0, Math.min(1, h.x * n.x + h.y * n.y));
    let rotated = false;
    if (cosT < COS_T_MIN - 1e-12) {
        const ang = Math.acos(Math.max(-1, Math.min(1, cosT)));
        const target = Math.acos(COS_T_MIN);
        const cross = h.x * n.y - h.y * n.x;
        const dir = cross >= 0 ? 1 : -1;
        const dAng = ang - target;
        h = headingRotated(h, dir * dAng);
        cosT = Math.max(0, Math.min(1, h.x * n.x + h.y * n.y));
        rotated = true;
    }
    const angleDeg = (Math.acos(Math.max(-1, Math.min(1, cosT))) * 180) / Math.PI;
    return { h, cosT, angleDeg, rotated };
}

/**
 * Incident-face tangent in the column plane (n × binormal).
 * This is the true round start; 1 mm ray secants are not used.
 */
export function incidentFaceTangent(planeN: XYZ, h: { x: number; y: number }): XYZ | null {
    const T = cross3(planeN, { x: -h.y, y: h.x, z: 0 });
    if (hypot3(T) < 1e-12) return null;
    let t = unit3(T);
    if (t.x * h.x + t.y * h.y > 0) t = { x: -t.x, y: -t.y, z: -t.z };
    return t;
}

function szOf(p: XYZ, origin: XYZ, h: { x: number; y: number }): Sz {
    return { s: (p.x - origin.x) * h.x + (p.y - origin.y) * h.y, z: p.z };
}

function xyzOnPlane(sz: Sz, origin: XYZ, h: { x: number; y: number }): XYZ {
    return { x: origin.x + h.x * sz.s, y: origin.y + h.y * sz.s, z: sz.z };
}

function phiOf(n: Sz): number {
    return Math.atan2(n.s, n.z);
}

function unwindDown(from: number, to: number): number {
    let t = to;
    while (t > from + 1e-12) t -= Math.PI * 2;
    while (t < from - Math.PI * 2 - 1e-12) t += Math.PI * 2;
    return t;
}

function externalTangent2(
    C1: Sz,
    r1: number,
    C2: Sz,
    r2: number,
): { n: Sz; T1: Sz; T2: Sz; L: number } | null {
    const Ds = C2.s - C1.s;
    const Dz = C2.z - C1.z;
    const dist = Math.hypot(Ds, Dz);
    if (dist <= Math.abs(r1 - r2) + 1e-9) return null;
    const c = (r1 - r2) / dist;
    const Dhs = Ds / dist;
    const Dhz = Dz / dist;
    const sqrt = Math.sqrt(Math.max(0, 1 - c * c));
    const perps: Sz[] = [
        { s: Dhz, z: -Dhs },
        { s: -Dhz, z: Dhs },
    ];
    let best: { n: Sz; T1: Sz; T2: Sz; L: number } | null = null;
    let bestOut = -Infinity;
    for (const p of perps) {
        const n = { s: c * Dhs + sqrt * p.s, z: c * Dhz + sqrt * p.z };
        const T1 = { s: C1.s + r1 * n.s, z: C1.z + r1 * n.z };
        const T2 = { s: C2.s + r2 * n.s, z: C2.z + r2 * n.z };
        const Ls = T2.s - T1.s;
        const Lz = T2.z - T1.z;
        const ordered = Ls * Dhs + Lz * Dhz;
        const labs = Math.hypot(Ls, Lz);
        const L = ordered >= 0 ? labs : -labs;
        const out = C1.s - T1.s;
        if (out > bestOut) {
            bestOut = out;
            best = { n, T1, T2, L };
        }
    }
    return best;
}

function tryAlaRadii(
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
    nTop: XYZ,
    nPlant: XYZ,
    r1: number,
    r2: number,
    origin: XYZ,
): { C1: Sz; C2: Sz; hit: { n: Sz; T1: Sz; T2: Sz; L: number } } | null {
    const R2 = szOf(R, origin, h);
    const B2 = szOf(B, origin, h);
    const nTop2: Sz = { s: nTop.x * h.x + nTop.y * h.y, z: nTop.z };
    const nPlant2: Sz = { s: nPlant.x * h.x + nPlant.y * h.y, z: nPlant.z };
    const C1 = { s: R2.s - r1 * nTop2.s, z: R2.z - r1 * nTop2.z };
    const C2 = { s: B2.s + r2 * nPlant2.s, z: B2.z + r2 * nPlant2.z };
    const hit = externalTangent2(C1, r1, C2, r2);
    if (!hit) return null;
    return { C1, C2, hit };
}

/** Reserve L ≥ minL first; remaining height goes to the r2 floor, then r1. */
export function packAlaRadii(
    height: number,
    r1In: number,
    r2In: number,
    minL: number,
    r2Min: number,
    r1Floor: number,
): { r1: number; r2: number } {
    let r1 = Math.max(r1Floor, r1In);
    let r2 = Math.max(r2Min, r2In);
    // L is reserved first (L >= minL). Remaining height goes to r2 floor, then r1.
    const room = Math.max(0, height - minL);
    if (r1 + r2 > room + 1e-9) {
        r1 = Math.max(r1Floor, room - r2);
        if (r1 + r2 > room + 1e-9) {
            r2 = Math.max(r2Min, room - r1);
            r1 = Math.max(r1Floor, room - r2);
        }
        if (r1 + r2 > room + 1e-9) {
            r1 = r1Floor;
            r2 = r2Min;
        }
    }
    return { r1, r2 };
}

export function clampR1ToBudget(
    r1: number,
    height: number,
    r2: number,
    minL: number,
    r1Floor = MIN_ROUND_R_MM,
): number {
    const lAvail = Math.max(r1Floor, height - r2 - minL);
    return Math.max(r1Floor, Math.min(r1, R1_HEIGHT_FRAC * Math.max(height, 0), lAvail));
}

function minLineOfHeight(height: number): number {
    return height <= SHORT_WALL_H_MM + 1e-9 ? SHORT_MIN_L_MM : MIN_LINE_MM;
}

/**
 * ARC-LINE-ARC in the column plane (s inward, z up).
 * C1 = R − r1 n_top; C2 = B + r2 n_plantar; body is the exterior common tangent.
 * L never reaches 0. Short walls (H ~ 2.2) use r1 ~ 0.5, r2 ~ 0.7, L >= 1, r1+r2+L <= H.
 */
export function constructArcLineArc(
    R: XYZ,
    B: XYZ,
    nTopIn: XYZ,
    r1In: number,
    r2In: number,
    hIn: { x: number; y: number },
    plantarSlopeRad = 0,
    sheetSlopeRad?: number,
    stationSpacing = OUTLINE_STATION_SPACING_MM,
    cosT = 1,
): ArcLineArc {
    const hl = Math.hypot(hIn.x, hIn.y) || 1;
    const h = { x: hIn.x / hl, y: hIn.y / hl };
    const origin = R;
    const steep = sheetSlopeRad != null && (Math.abs(sheetSlopeRad) * 180) / Math.PI >= STEEP_SHEET_DEG;
    const nTop = sheetSlopeRad != null ? nTopFromSheetSlope(sheetSlopeRad, h) : projectNTop(nTopIn, h, steep);
    const frame = plantarFrameAt(h, plantarSlopeRad);
    const nPlant = unit3(frame.ez);
    const height = Math.max(R.z - B.z, 0.5);
    const short = height <= SHORT_WALL_H_MM + 1e-9;
    const minL = short ? SHORT_MIN_L_MM : MIN_LINE_MM;
    const dLGuess = lastFilletDLRad(Math.PI / 2, cosT);
    const r2Min = lastFilletR2MinMm(stationSpacing, dLGuess);
    const r1Floor = MIN_ROUND_R_MM;
    let r1 = Math.max(r1Floor, r1In);
    let r2 = Math.max(r2Min, r2In);
    if (sheetSlopeRad != null) r1 = r1ForSheetSlope(r1, sheetSlopeRad);
    if (short) {
        const t = Math.max(0, Math.min(1, (height - (SHORT_WALL_H_MM - 1.2)) / 1.2));
        r1 = Math.min(r1, SHORT_R1_MM + (r1 - SHORT_R1_MM) * t);
        r2 = Math.min(r2, Math.max(r2Min, SHORT_R2_MM + (r2 - SHORT_R2_MM) * t));
    }
    r2 = Math.max(r2Min, r2);
    const packedRadii = packAlaRadii(height, r1, r2, minL, r2Min, r1Floor);
    r1 = packedRadii.r1;
    r2 = packedRadii.r2;
    r1 = clampR1ToBudget(r1, height, r2, minL, r1Floor);
    const alaOk = (
        hit: { C1: Sz; C2: Sz; hit: { L: number } } | null,
    ): hit is { C1: Sz; C2: Sz; hit: { L: number } } =>
        Boolean(hit && hit.hit.L >= minL - 1e-9 && hit.C1.z + 1e-6 >= hit.C2.z);
    let packed = tryAlaRadii(R, B, h, nTop, nPlant, r1, r2, origin);
    if (!alaOk(packed)) {
        r1 = Math.min(r1, FILLET_R_CAP_MM);
        packed = tryAlaRadii(R, B, h, nTop, nPlant, r1, r2, origin);
    }
    for (let i = 0; i < 48 && !alaOk(packed); i++) {
        r1 = Math.max(r1Floor, r1 * 0.85);
        r2 = Math.max(r2Min, r2 * 0.85);
        packed = tryAlaRadii(R, B, h, nTop, nPlant, r1, r2, origin);
        if (r1 <= r1Floor + 1e-9 && r2 <= r2Min + 1e-9) break;
    }
    if (packed) {
        const nPlant2a: Sz = { s: nPlant.x * h.x + nPlant.y * h.y, z: nPlant.z };
        const phi0a = phiOf(packed.hit.n);
        const phi1a = unwindDown(phi0a, phiOf({ s: -nPlant2a.s, z: -nPlant2a.z }));
        const Sa = Math.abs(phi1a - phi0a);
        const floored = floorR2OnLastStep(height, r1, r2, minL, stationSpacing, Sa, cosT, r1Floor);
        if (r2 + 1e-9 < floored.r2Min || r1 > floored.r1 + 1e-9) {
            r1 = floored.r1;
            r2 = floored.r2;
            let grown = tryAlaRadii(R, B, h, nTop, nPlant, r1, r2, origin);
            if (!alaOk(grown) && r1 > r1Floor + 1e-9) {
                grown = tryAlaRadii(R, B, h, nTop, nPlant, r1Floor, r2, origin);
                if (alaOk(grown)) r1 = r1Floor;
            }
            if (alaOk(grown)) packed = grown;
        }
    }
    if (!packed) {
        const T1 = { x: R.x - h.x * 1e-3, y: R.y - h.y * 1e-3, z: R.z };
        const T2 = { x: B.x - h.x * 1e-3, y: B.y - h.y * 1e-3, z: B.z + 0.05 };
        const d = unit3({ x: T2.x - T1.x, y: T2.y - T1.y, z: T2.z - T1.z });
        const nTop2: Sz = { s: nTop.x * h.x + nTop.y * h.y, z: nTop.z };
        let tStart = unit3({ x: -nTop.z * h.x, y: -nTop.z * h.y, z: nTop2.s });
        if (tStart.x * h.x + tStart.y * h.y > 0) tStart = { x: -tStart.x, y: -tStart.y, z: -tStart.z };
        const ds = d.x * h.x + d.y * h.y;
        const leanRad = Math.atan2(ds, -d.z);
        return {
            C1: add3(R, nTop, -r1),
            C2: add3(B, nPlant, r2),
            T1,
            T2,
            n: { x: -h.x, y: -h.y, z: 0 },
            nTop,
            nPlant,
            tStart,
            d,
            L: Math.max(minL, dist3(T1, T2)),
            r1,
            r2,
            roundSweep: 1e-3,
            filletSweep: 1e-3,
            leanRad,
            lineTiltRad: Math.atan2(d.z, Math.hypot(d.x, d.y)),
            phiRound0: 0,
            phiRound1: 0,
            phiFil0: 0,
            phiFil1: 0,
        };
    }
    const { C1, C2, hit } = packed;
    const nTop2: Sz = { s: nTop.x * h.x + nTop.y * h.y, z: nTop.z };
    const nPlant2: Sz = { s: nPlant.x * h.x + nPlant.y * h.y, z: nPlant.z };
    const phiRound0 = phiOf(nTop2);
    const phiRound1 = unwindDown(phiRound0, phiOf(hit.n));
    const phiFil0 = phiOf(hit.n);
    const phiFil1 = unwindDown(phiFil0, phiOf({ s: -nPlant2.s, z: -nPlant2.z }));
    const T1 = xyzOnPlane(hit.T1, origin, h);
    const T2 = xyzOnPlane(hit.T2, origin, h);
    const d = unit3({ x: T2.x - T1.x, y: T2.y - T1.y, z: T2.z - T1.z });
    let tStart = unit3({ x: -nTop.z * h.x, y: -nTop.z * h.y, z: nTop2.s });
    if (tStart.x * h.x + tStart.y * h.y > 0) tStart = { x: -tStart.x, y: -tStart.y, z: -tStart.z };
    const n = unit3({ x: hit.n.s * h.x, y: hit.n.s * h.y, z: hit.n.z });
    const ds = d.x * h.x + d.y * h.y;
    const leanRad = Math.atan2(ds, Math.max(1e-9, -d.z));
    return {
        C1: xyzOnPlane(C1, origin, h),
        C2: xyzOnPlane(C2, origin, h),
        T1,
        T2,
        n,
        nTop,
        nPlant,
        tStart,
        d,
        L: Math.max(minL, hit.L),
        r1,
        r2,
        roundSweep: Math.abs(phiRound0 - phiRound1),
        filletSweep: Math.abs(phiFil0 - phiFil1),
        leanRad,
        lineTiltRad: Math.atan2(d.z, Math.hypot(d.x, d.y)),
        phiRound0,
        phiRound1,
        phiFil0,
        phiFil1,
    };
}

export function alaPoint(ala: ArcLineArc, h: { x: number; y: number }, C: XYZ, r: number, phi: number): XYZ {
    const ns = Math.sin(phi);
    const nz = Math.cos(phi);
    return { x: C.x + r * ns * h.x, y: C.y + r * ns * h.y, z: C.z + r * nz };
}

export function projectOntoSpan(v: XYZ, a: XYZ, b: XYZ): XYZ {
    const e1 = unit3(a);
    let e2 = add3(b, e1, -dot3(b, e1));
    if (hypot3(e2) < 1e-12) return scale3(e1, dot3(v, e1));
    e2 = unit3(e2);
    return add3(scale3(e1, dot3(v, e1)), e2, dot3(v, e2));
}

export function offPlaneNormalMm(p: XYZ, origin: XYZ, n: XYZ): number {
    return Math.abs((p.x - origin.x) * n.x + (p.y - origin.y) * n.y + (p.z - origin.z) * n.z);
}

/** In-surface outward at the rim: nTop × T_rim, flipped to agree with −h. */
export function rimInSurfaceOutward(nTop: XYZ, tRim: XYZ, h: { x: number; y: number }): XYZ {
    let w = cross3(nTop, tRim);
    if (hypot3(w) < 1e-12) w = { x: -h.x, y: -h.y, z: 0 };
    w = unit3(w);
    if (w.x * -h.x + w.y * -h.y < 0) w = { x: -w.x, y: -w.y, z: -w.z };
    return w;
}

function unwindSweep(from: number, to: number): number {
    let t = to;
    while (t <= from + 1e-12) t += Math.PI * 2;
    while (t > from + Math.PI * 2 + 1e-12) t -= Math.PI * 2;
    if (t - from > Math.PI + 1e-6) t -= Math.PI * 2;
    return t;
}

export function sweptRoundPoint(C: XYZ, r: number, eN: XYZ, eW: XYZ, phi: number): XYZ {
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    return {
        x: C.x + r * (c * eN.x + s * eW.x),
        y: C.y + r * (c * eN.y + s * eW.y),
        z: C.z + r * (c * eN.z + s * eW.z),
    };
}

export function sweptRoundTangent(eN: XYZ, eW: XYZ, phi: number): XYZ {
    return unit3({
        x: -Math.sin(phi) * eN.x + Math.cos(phi) * eW.x,
        y: -Math.sin(phi) * eN.y + Math.cos(phi) * eW.y,
        z: -Math.sin(phi) * eN.z + Math.cos(phi) * eW.z,
    });
}

export interface SweepRule {
    C1: XYZ;
    C2: XYZ;
    E: XYZ;
    F: XYZ;
    d: XYZ;
    r1: number;
    r2: number;
    nTop: XYZ;
    nPlant: XYZ;
    eW: XYZ;
    eN: XYZ;
    fil: ConstructedFillet;
    phiRound0: number;
    phiRound1: number;
    tStart: XYZ;
    L: number;
    roundSweep: number;
    filletSweep: number;
    leanRad: number;
    lineTiltRad: number;
    g1EDeg: number;
    g1FDeg: number;
    converged: boolean;
    nRoundPlane: XYZ;
    nFilPlane: XYZ;
}

/**
 * Sweep the arcs, rule the middle. Fillet in span(nB, z) (square to B);
 * top round in span(wOut_surf, nTop); body is the ruled E→F. Two fixed-point
 * iterations set each arc's end angle from the ruling projected into that plane.
 */
export function constructSweepRule(
    R: XYZ,
    B: XYZ,
    nTopIn: XYZ,
    r1In: number,
    r2In: number,
    hIn: { x: number; y: number },
    nBIn: { x: number; y: number },
    tRimIn: XYZ,
    plantarSlopeRad = 0,
    sheetSlopeRad?: number,
    localSpacing = OUTLINE_STATION_SPACING_MM,
    planeN?: XYZ,
    phiRound1Lock?: number,
    nPlantarIn?: XYZ,
    nFil?: number,
): SweepRule {
    const hl = Math.hypot(hIn.x, hIn.y) || 1;
    const h = { x: hIn.x / hl, y: hIn.y / hl };
    const nl = Math.hypot(nBIn.x, nBIn.y) || 1;
    let nB = { x: nBIn.x / nl, y: nBIn.y / nl };
    if (nB.x * h.x + nB.y * h.y < 0) nB = { x: -nB.x, y: -nB.y };
    const steep = sheetSlopeRad != null && (Math.abs(sheetSlopeRad) * 180) / Math.PI >= STEEP_SHEET_DEG;
    const nTop = sheetSlopeRad != null ? nTopFromSheetSlope(sheetSlopeRad, h) : projectNTop(nTopIn, h, steep);
    const eN = unit3(nTop);
    const tRim = hypot3(tRimIn) > 1e-12 ? unit3(tRimIn) : { x: -h.y, y: h.x, z: 0 };
    const eW = rimInSurfaceOutward(eN, tRim, h);
    const frame = resolvePlantarFrame(nB, plantarSlopeRad, nPlantarIn);
    const nPlant = unit3(frame.ez);
    const height = Math.max(R.z - B.z, 0.5);
    const short = height <= SHORT_WALL_H_MM + 1e-9;
    const minL = short ? SHORT_MIN_L_MM : MIN_LINE_MM;
    const seedCosT = Math.max(0, Math.min(1, h.x * nB.x + h.y * nB.y));
    const dLGuess = lastFilletDLRad(Math.PI / 2, seedCosT);
    const r2Min = lastFilletR2MinMm(localSpacing, dLGuess);
    const r1Floor = MIN_ROUND_R_MM;
    let r1 = Math.max(r1Floor, r1In);
    let r2 = Math.max(r2Min, r2In);
    if (sheetSlopeRad != null) r1 = r1ForSheetSlope(r1, sheetSlopeRad);
    if (short) {
        const t = Math.max(0, Math.min(1, (height - (SHORT_WALL_H_MM - 1.2)) / 1.2));
        r1 = Math.min(r1, SHORT_R1_MM + (r1 - SHORT_R1_MM) * t);
        r2 = Math.min(r2, Math.max(r2Min, SHORT_R2_MM + (r2 - SHORT_R2_MM) * t));
    }
    const packedRadii = packAlaRadii(height, r1, r2, minL, r2Min, r1Floor);
    r1 = packedRadii.r1;
    r2 = packedRadii.r2;
    r1 = clampR1ToBudget(r1, height, r2, minL, r1Floor);
    const tInc = (planeN ? incidentFaceTangent(planeN, h) : null) ?? eW;
    let tStart = unit3(eW);
    if (dot3(tStart, tInc) < 0) tStart = { x: -tStart.x, y: -tStart.y, z: -tStart.z };
    let d = unit3({ x: B.x - R.x, y: B.y - R.y, z: B.z - R.z });
    if (hypot3(d) < 1e-9) d = { x: nB.x, y: nB.y, z: -1 };

    let C1 = add3(R, eN, -r1);
    let fil = constructFillet(B, nB, r2, d, plantarSlopeRad, nPlant);
    let E = { ...R };
    let F = { ...fil.Pw };
    let phiRound0 = 0;
    let phiRound1 = Math.PI / 2;

    const step = (lockPhi?: number): void => {
        const dFil = projectOntoSpan(d, frame.ew, frame.ez);
        // constructFillet wants the wall direction at F (up the wall, F→E).
        const U = hypot3(dFil) > 1e-9 ? unit3({ x: -dFil.x, y: -dFil.y, z: -dFil.z }) : { x: 0, y: 0, z: 1 };
        fil = constructFillet(B, nB, r2, U, plantarSlopeRad, nPlant);
        const S = Math.abs(fil.phi1 - fil.phi0);
        const cosT = planCosT(d, nB, h);
        const r2Design = r2;
        const floored = floorR2OnLastStep(height, r1, r2, minL, localSpacing, S, cosT, r1Floor);
        const nFilUse = nFil && nFil > 0 ? nFil : MIN_FILLET_RINGS;
        const evalS = (r: number): number => filletSweepAtR2(B, nB, r, U, E, plantarSlopeRad, nPlant);
        const resolved = resolveLastR2(r2Design, floored.r2Min, evalS, cosT, nFilUse);
        if (r2 + 1e-9 < resolved.r2 || r2 > resolved.r2 + 1e-9 || r1 > floored.r1 + 1e-9) {
            r2 = resolved.r2;
            const packed = packAlaRadii(height, floored.r1, r2, minL, r2, r1Floor);
            r1 = packed.r1;
            r2 = packed.r2;
            C1 = add3(R, eN, -r1);
            fil = constructFillet(B, nB, r2, U, plantarSlopeRad, nPlant);
        }
        F = { ...fil.Pw };
        C1 = add3(R, eN, -r1);
        phiRound0 = 0;
        if (lockPhi != null && Number.isFinite(lockPhi)) {
            phiRound1 = lockPhi;
        } else {
            const dRnd = projectOntoSpan(d, eW, eN);
            const dRu = hypot3(dRnd) > 1e-9 ? unit3(dRnd) : { x: 0, y: 0, z: -1 };
            phiRound1 = unwindSweep(0, Math.atan2(-dot3(dRu, eN), dot3(dRu, eW)));
            if (Math.abs(phiRound1) < 1e-4) phiRound1 = Math.PI / 2;
        }
        E = sweptRoundPoint(C1, r1, eN, eW, phiRound1);
        const next = { x: F.x - E.x, y: F.y - E.y, z: F.z - E.z };
        if (hypot3(next) > 1e-9) d = unit3(next);
    };
    for (let iter = 0; iter < 2; iter++) step();
    const locked = phiRound1Lock != null && Number.isFinite(phiRound1Lock);
    if (locked) {
        const freePhi = phiRound1;
        let delta = (phiRound1Lock as number) - freePhi;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const apply = (shift: number): { g1E: number; g1F: number } => {
            const target = freePhi + shift;
            for (let iter = 0; iter < 3; iter++) step(target);
            const tEm = sweptRoundTangent(eN, eW, phiRound1);
            const tFm = unit3({ x: -fil.d.x, y: -fil.d.y, z: -fil.d.z });
            const dEm = projectOntoSpan(d, eW, eN);
            const dFm = projectOntoSpan(d, frame.ew, frame.ez);
            return {
                g1E: hypot3(dEm) > 1e-9 ? vecAngleDeg(unit3(dEm), tEm) : 0,
                g1F: hypot3(dFm) > 1e-9 ? vecAngleDeg(unit3(dFm), tFm) : 0,
            };
        };
        let g1 = apply(delta);
        if (g1.g1E > G1_MAX_DEG + 1e-6 || g1.g1F > G1_MAX_DEG + 1e-6) {
            let lo = 0;
            let hi = delta;
            for (let k = 0; k < 10; k++) {
                const mid = 0.5 * (lo + hi);
                const m = apply(mid);
                if (m.g1E <= G1_MAX_DEG + 1e-6 && m.g1F <= G1_MAX_DEG + 1e-6) {
                    lo = mid;
                    g1 = m;
                } else {
                    hi = mid;
                }
            }
            apply(lo);
        }
    }

    const tE = sweptRoundTangent(eN, eW, phiRound1);
    const tFPath = unit3({ x: -fil.d.x, y: -fil.d.y, z: -fil.d.z });
    const dE = projectOntoSpan(d, eW, eN);
    const dF = projectOntoSpan(d, frame.ew, frame.ez);
    const g1EDeg = hypot3(dE) > 1e-9 ? vecAngleDeg(unit3(dE), tE) : 0;
    const g1FDeg = hypot3(dF) > 1e-9 ? vecAngleDeg(unit3(dF), tFPath) : 0;
    const nRoundPlane = unit3(cross3(eW, eN));
    const nFilPlane = unit3(cross3(fil.ew, fil.ez));
    const L = Math.max(minL, dist3(E, F));
    const ds = d.x * nB.x + d.y * nB.y;
    return {
        C1,
        C2: fil.C,
        E,
        F,
        d,
        r1,
        r2,
        nTop: eN,
        nPlant,
        eW,
        eN,
        fil,
        phiRound0,
        phiRound1,
        tStart,
        L,
        roundSweep: Math.abs(phiRound1 - phiRound0),
        filletSweep: Math.abs(fil.phi1 - fil.phi0),
        leanRad: Math.atan2(ds, Math.max(1e-9, -d.z)),
        lineTiltRad: Math.atan2(d.z, Math.hypot(d.x, d.y)),
        g1EDeg,
        g1FDeg,
        converged: g1EDeg <= G1_MAX_DEG + 1e-6 && g1FDeg <= G1_MAX_DEG + 1e-6,
        nRoundPlane: hypot3(nRoundPlane) > 1e-12 ? nRoundPlane : { x: -h.y, y: h.x, z: 0 },
        nFilPlane: hypot3(nFilPlane) > 1e-12 ? nFilPlane : { x: -nB.y, y: nB.x, z: 0 },
    };
}

function sweepToAla(sw: SweepRule, h: { x: number; y: number }): ArcLineArc {
    return {
        C1: sw.C1,
        C2: sw.C2,
        T1: sw.E,
        T2: sw.F,
        n: unit3({ x: -h.x, y: -h.y, z: 0 }),
        nTop: sw.nTop,
        nPlant: sw.nPlant,
        tStart: sw.tStart,
        d: sw.d,
        L: sw.L,
        r1: sw.r1,
        r2: sw.r2,
        roundSweep: sw.roundSweep,
        filletSweep: sw.filletSweep,
        leanRad: sw.leanRad,
        lineTiltRad: sw.lineTiltRad,
        phiRound0: sw.phiRound0,
        phiRound1: sw.phiRound1,
        phiFil0: sw.fil.phi0,
        phiFil1: sw.fil.phi1,
    };
}

export function sampleArcLineArc(
    ala: ArcLineArc,
    h: { x: number; y: number },
    R: XYZ,
    B: XYZ,
    nWall: number,
    stationSpacing = 1.3,
    counts?: ColumnPieceCounts,
    dLRad?: number,
    station = -1,
): XYZ[] {
    const stepDeg = (FILLET_STEP_MAX_DEG * Math.PI) / 180;
    const nRound =
        counts?.nRound ??
        Math.max(TOP_ROUND_MIN_ROWS, Math.ceil(Math.abs(ala.roundSweep) / Math.max(stepDeg, 1e-9)));
    const S = Math.abs(ala.phiFil1 - ala.phiFil0);
    const dL = dLRad ?? lastFilletDLRad(S, 1);
    const nFil =
        counts?.nFil ??
        Math.max(MIN_FILLET_RINGS, Math.ceil(Math.max(S - dL, 1e-12) / Math.max(stepDeg, 1e-9)));
    let nLine = counts?.nLine ?? lineRowCount(ala.L, stationSpacing);
    const total = nRound + nLine + nFil + 2;
    if (!counts && total < nWall) nLine += nWall - total;
    const pts: XYZ[] = [{ ...R }];
    for (let k = 1; k <= nRound; k++) {
        const phi = ala.phiRound0 + ((ala.phiRound1 - ala.phiRound0) * k) / nRound;
        pts.push(k === nRound ? { ...ala.T1 } : alaPoint(ala, h, ala.C1, ala.r1, phi));
    }
    const fil = sampleFilletPiecePoints(
        ala.T1,
        ala.T2,
        ala.r2,
        S,
        ala.phiFil0,
        ala.phiFil1,
        (phi) => alaPoint(ala, h, ala.C2, ala.r2, phi),
        nFil,
        dL,
        lastFilletCMinMm(stationSpacing),
    );
    for (let k = 1; k <= nLine; k++) {
        const t = k / nLine;
        pts.push(lerp3(ala.T1, fil.Fpiece, t));
    }
    for (const p of fil.pts) pts.push(p);
    pts.push({ ...B });
    return assertPieceSpacing(pts, MIN_EDGE_MM, station);
}

/** Hard error on a collapsed interior row. Never silently push to MIN_EDGE.
 * The reserved last-to-B chord may undershoot C_MIN; that is logged as
 * [S1-CHORD-FLOOR] after the final floor pass, not thrown here.
 */
export function assertPieceSpacing(pts: XYZ[], minMm: number, station = -1): XYZ[] {
    if (pts.length < 3) return pts;
    const last = pts.length - 1;
    for (let i = 1; i < last; i++) {
        if (dist3(pts[i]!, pts[i - 1]!) + 1e-12 >= minMm) continue;
        const at = station >= 0 ? String(station) : "?";
        throw new Error(`[S1-I] collapsed fillet row at station ${at} pair ${i - 1}-${i}`);
    }
    return pts;
}

export function assertOutsideRound(R: XYZ, rnd: OutsideRound, pts: XYZ[]): void {
    const n = pts.length;
    const outboardCount = Math.max(1, Math.ceil(n * 0.65));
    for (let i = 0; i < outboardCount; i++) {
        const p = pts[i]!;
        const d = (p.x - R.x) * rnd.wOut.x + (p.y - R.y) * rnd.wOut.y;
        if (d < -1e-6) {
            throw new Error(`[S1-ROUND] point inboard of R d=${d.toFixed(6)}`);
        }
    }
    const steps = Math.max(2, n);
    let prevZ = rnd.nTop.z;
    const endZ = rnd.nWall.z;
    const rising = endZ > prevZ;
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const z = rnd.nTop.z * (1 - t) + rnd.nWall.z * t;
        if (rising ? z + 1e-6 < prevZ : z - 1e-6 > prevZ) {
            throw new Error(`[S1-ROUND] normal z not monotone ${prevZ} → ${z}`);
        }
        prevZ = z;
    }
}

export function applyAlaToFrame(fr: ColumnFrame): ArcLineArc {
    const nUse = fr.nTopSmoothed ?? fr.nTop;
    const nB = fr.nB ?? fr.h;
    const tRim = fr.tRim ?? { x: -fr.h.y, y: fr.h.x, z: 0 };
    const local = localSpacingOf(fr);
    let sw = constructSweepRule(
        fr.R,
        fr.B,
        nUse,
        fr.rTop,
        fr.rFillet,
        fr.h,
        nB,
        tRim,
        fr.plantarSlopeRad,
        fr.sheetSlopeValid ? fr.roundSlopeRad : undefined,
        local,
        fr.sheetPlaneN ?? nUse,
        fr.phiRound1Lock,
        fr.nPlantar,
        fr.nFilFix || MIN_FILLET_RINGS,
    );
    for (let pass = 0; pass < 2; pass++) {
        const Stry = Math.abs(sw.fil.phi1 - sw.fil.phi0);
        const cosTry = planCosT(sw.d, nB, fr.h);
        const height = Math.max(fr.R.z - fr.B.z, 0.5);
        const floored = floorR2OnLastStep(height, sw.r1, sw.r2, minLineOfHeight(height), local, Stry, cosTry);
        const evalS = (r: number): number => {
            const Uup = { x: -sw.d.x, y: -sw.d.y, z: -sw.d.z };
            return filletSweepAtR2(fr.B, nB, r, Uup, sw.E, fr.plantarSlopeRad, fr.nPlantar);
        };
        const resolved = resolveLastR2(sw.r2, floored.r2Min, evalS, cosTry, fr.nFilFix || MIN_FILLET_RINGS);
        if (sw.r2 + 1e-9 >= resolved.r2 && sw.r1 <= floored.r1 + 1e-9 && sw.r2 <= resolved.r2 + 1e-9) {
            break;
        }
        const packed = packAlaRadii(
            height,
            floored.r1,
            resolved.r2,
            minLineOfHeight(height),
            resolved.r2,
            MIN_ROUND_R_MM,
        );
        fr.rTop = packed.r1;
        fr.rFillet = packed.r2;
        if (resolved.reason) fr.chordFloorReason = resolved.reason;
        sw = constructSweepRule(
            fr.R,
            fr.B,
            nUse,
            fr.rTop,
            fr.rFillet,
            fr.h,
            nB,
            tRim,
            fr.plantarSlopeRad,
            fr.sheetSlopeValid ? fr.roundSlopeRad : undefined,
            local,
            fr.sheetPlaneN ?? nUse,
            fr.phiRound1Lock,
            fr.nPlantar,
            fr.nFilFix || MIN_FILLET_RINGS,
        );
    }
    const S = Math.abs(sw.fil.phi1 - sw.fil.phi0);
    fr.rTop = Math.max(MIN_ROUND_R_MM, sw.r1);
    fr.rFillet = sw.r2;
    fr.E = { ...sw.E };
    fr.F = { ...sw.F };
    fr.nTop = sw.nTop;
    fr.nTopSmoothed = nUse;
    fr.nWall = sw.nRoundPlane;
    fr.wOut = { x: sw.eW.x, y: sw.eW.y };
    fr.T0 = sw.tStart;
    fr.U = sw.d;
    fr.t0TiltRad = Math.atan2(sw.tStart.z, Math.hypot(sw.tStart.x, sw.tStart.y));
    fr.uTiltRad = sw.leanRad;
    fr.lineLengthMm = sw.L;
    fr.leanRad = sw.leanRad;
    fr.lineTiltRad = sw.lineTiltRad;
    fr.roundSweepRad = sw.roundSweep;
    fr.filletSweepRad = sw.filletSweep;
    fr.g1EDeg = sw.g1EDeg;
    fr.g1FDeg = sw.g1FDeg;
    fr.sweepConverged = sw.converged;
    fr.nRoundPlane = sw.nRoundPlane;
    fr.nFilPlane = sw.nFilPlane;
    fr.phiRound1 = sw.phiRound1;
    const planD = { x: sw.d.x, y: sw.d.y };
    const pl = Math.hypot(planD.x, planD.y);
    const hx = pl > 1e-9 ? planD.x / pl : fr.h.x;
    const hy = pl > 1e-9 ? planD.y / pl : fr.h.y;
    let n = { ...nB };
    if (hx * n.x + hy * n.y < 0) n = { x: -n.x, y: -n.y };
    const cosT = Math.max(0, Math.min(1, hx * n.x + hy * n.y));
    fr.headingObliqueDeg = (Math.acos(cosT) * 180) / Math.PI;
    fr.cosT = cosT;
    fr.lastDlRad = lastFilletDLRad(S, cosT);
    fr.obliqueFallback = !sw.converged && fr.headingObliqueDeg > OBLIQUE_WARN_DEG;
    fr.sweepRule = sw;
    return sweepToAla(sw, fr.h);
}

export function sampleTopRound(fr: ColumnFrame, nRows: number): { W: XYZ; pts: XYZ[] } {
    const ala = applyAlaToFrame(fr);
    if (fr.rTop < MIN_ROUND_R_MM) {
        fr.E = { ...fr.R };
        fr.roundRows = 0;
        return { W: { ...fr.R }, pts: [] };
    }
    const count = Math.max(TOP_ROUND_MIN_ROWS, nRows);
    const eN = fr.nTop;
    const eW = unit3({ x: fr.wOut.x, y: fr.wOut.y, z: 0 });
    const pts: XYZ[] = [];
    for (let i = 1; i <= count; i++) {
        const phi = ala.phiRound0 + ((ala.phiRound1 - ala.phiRound0) * i) / count;
        const p = i === count ? { ...ala.T1 } : sweptRoundPoint(ala.C1, ala.r1, eN, eW, phi);
        if (dist3(p, fr.R) < MIN_EDGE_MM) continue;
        if (pts.length && dist3(p, pts[pts.length - 1]!) < MIN_EDGE_MM) continue;
        pts.push(p);
    }
    if (pts.length) pts[pts.length - 1] = { ...ala.T1 };
    else pts.push({ ...ala.T1 });
    fr.roundRows = pts.length;
    const rnd = constructOutsideRound(fr.R, fr.nTop, fr.h, fr.rTop, fr.lineTiltRad);
    rnd.E = { ...ala.T1 };
    rnd.nWall = ala.n;
    rnd.T0 = ala.d;
    rnd.sweep = ala.roundSweep;
    assertOutsideRound(fr.R, rnd, pts);
    return { W: { ...ala.T1 }, pts };
}

export function sampleSweepRule(
    sw: SweepRule,
    R: XYZ,
    B: XYZ,
    nWall: number,
    counts?: ColumnPieceCounts,
    dLRad?: number,
    station = -1,
    localSpacing = OUTLINE_STATION_SPACING_MM,
): XYZ[] {
    const stepDeg = (FILLET_STEP_MAX_DEG * Math.PI) / 180;
    const nRound =
        counts?.nRound ??
        Math.max(TOP_ROUND_MIN_ROWS, Math.ceil(Math.abs(sw.roundSweep) / Math.max(stepDeg, 1e-9)));
    const S = Math.abs(sw.fil.phi1 - sw.fil.phi0);
    const dL = dLRad ?? lastFilletDLRad(S, 1);
    const nFil =
        counts?.nFil ??
        Math.max(MIN_FILLET_RINGS, Math.ceil(Math.max(S - dL, 1e-12) / Math.max(stepDeg, 1e-9)));
    let nLine = counts?.nLine ?? lineRowCount(sw.L, Math.max(sw.L, 1e-6));
    const total = nRound + nLine + nFil + 2;
    if (!counts && total < nWall) nLine += nWall - total;
    const pts: XYZ[] = [{ ...R }];
    for (let k = 1; k <= nRound; k++) {
        const phi = sw.phiRound0 + ((sw.phiRound1 - sw.phiRound0) * k) / nRound;
        pts.push(k === nRound ? { ...sw.E } : sweptRoundPoint(sw.C1, sw.r1, sw.eN, sw.eW, phi));
    }
    const fil = sampleFilletPiecePoints(
        sw.E,
        sw.F,
        sw.r2,
        S,
        sw.fil.phi0,
        sw.fil.phi1,
        (phi) => filletPointAtPhi(sw.fil, phi),
        nFil,
        dL,
        lastFilletCMinMm(localSpacing),
    );
    for (let k = 1; k <= nLine; k++) {
        const t = k / nLine;
        pts.push(lerp3(sw.E, fil.Fpiece, t));
    }
    for (const p of fil.pts) pts.push(p);
    pts.push({ ...B });
    return assertPieceSpacing(pts, MIN_EDGE_MM, station);
}

function scale3(a: XYZ, s: number): XYZ {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

/** True when p is at or beyond F along E→F (fillet-arc side of the stolen line tail). */
function pointPastF(p: XYZ, E: XYZ, F: XYZ): boolean {
    const ex = F.x - E.x;
    const ey = F.y - E.y;
    const ez = F.z - E.z;
    const L2 = ex * ex + ey * ey + ez * ez;
    if (L2 < 1e-16) return true;
    return (p.x - E.x) * ex + (p.y - E.y) * ey + (p.z - E.z) * ez >= L2 - 1e-9;
}

function medianStationSpacing(stations: HermiteStation[]): number {
    if (stations.length < 2) return 1.3;
    const ds = stations.map((s, i) => {
        const n = stations[(i + 1) % stations.length]!;
        return Math.hypot(n.rim.x - s.rim.x, n.rim.y - s.rim.y, n.rim.z - s.rim.z);
    });
    ds.sort((a, b) => a - b);
    return ds[Math.floor(ds.length / 2)] ?? 1.3;
}

function vecAngleDeg(a: XYZ, b: XYZ): number {
    const d = Math.max(-1, Math.min(1, dot3(unit3(a), unit3(b))));
    return (Math.acos(d) * 180) / Math.PI;
}

function assertRoundJoints(fr: ColumnFrame, col: XYZ[]): void {
    if (col.length < 3 || !fr.roundRows) return;
    const R0 = col[0]!;
    const tFirst = {
        x: col[1]!.x - R0.x,
        y: col[1]!.y - R0.y,
        z: col[1]!.z - R0.z,
    };
    const topJoint = dist3(col[1]!, R0) < MIN_EDGE_MM ? 0 : vecAngleDeg(tFirst, fr.T0);
    const eIdx = Math.max(1, Math.min(col.length - 2, fr.roundRows || 6));
    const tEnd = {
        x: col[eIdx + 1]!.x - col[eIdx]!.x,
        y: col[eIdx + 1]!.y - col[eIdx]!.y,
        z: col[eIdx + 1]!.z - col[eIdx]!.z,
    };
    const wallJoint = vecAngleDeg(tEnd, fr.U);
    if (topJoint > ROUND_JOINT_MAX_DEG + 1e-3) {
        console.log(
            `[S1-ROUND] first-chord top|round=${topJoint.toFixed(2)} round|wall=${wallJoint.toFixed(2)}`,
        );
    }
    if (eIdx < 1) {
        throw new Error(`[S1-ROUND] rows=${eIdx}`);
    }
}

export function t0LeadQ(fr: ColumnFrame): XYZ {
    const ala = applyAlaToFrame(fr);
    return { ...ala.T1 };
}

function planMonotone(pts: XYZ[], R: XYZ, B: XYZ): boolean {
    const dx = B.x - R.x;
    const dy = B.y - R.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-6) return true;
    for (let i = 1; i < pts.length; i++) {
        const sx = pts[i]!.x - pts[i - 1]!.x;
        const sy = pts[i]!.y - pts[i - 1]!.y;
        if (sx * dx + sy * dy < -1e-4 * chord) return false;
    }
    return true;
}

function planS(p: XYZ, R: XYZ, h: { x: number; y: number }): number {
    return (p.x - R.x) * h.x + (p.y - R.y) * h.y;
}

function clampPointToInward(p: XYZ, fr: ColumnFrame, origin: XYZ, maxS: number): XYZ {
    const s = planS(p, origin, fr.h);
    if (s <= maxS) return projectToPlane(p, fr.R, fr.h);
    return projectToPlane({ x: origin.x + fr.h.x * maxS, y: origin.y + fr.h.y * maxS, z: p.z }, fr.R, fr.h);
}

function bezTangent(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, t: number): XYZ {
    const u = 1 - t;
    return unit3({
        x: 3 * u * u * (P1.x - P0.x) + 6 * u * t * (P2.x - P1.x) + 3 * t * t * (P3.x - P2.x),
        y: 3 * u * u * (P1.y - P0.y) + 6 * u * t * (P2.y - P1.y) + 3 * t * t * (P3.y - P2.y),
        z: 3 * u * u * (P1.z - P0.z) + 6 * u * t * (P2.z - P1.z) + 3 * t * t * (P3.z - P2.z),
    });
}

function sampleBezierByTurning(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, n: number): XYZ[] {
    const count = Math.max(2, n);
    const denseN = 64;
    const dense: XYZ[] = [];
    const turns = [0];
    let prevT = bezTangent(P0, P1, P2, P3, 0);
    for (let k = 1; k <= denseN; k++) {
        const t = k / denseN;
        dense.push(evalCubicBezier(P0, P1, P2, P3, t));
        const T = bezTangent(P0, P1, P2, P3, t);
        turns.push(turns[k - 1]! + vecAngleDeg(prevT, T));
        prevT = T;
    }
    const total = turns[turns.length - 1]!;
    const out: XYZ[] = [];
    if (total < 1e-3) {
        for (let i = 1; i <= count; i++) out.push(evalCubicBezier(P0, P1, P2, P3, i / count));
        return out;
    }
    for (let i = 1; i <= count; i++) {
        const target = (total * i) / count;
        let k = 1;
        while (k < turns.length - 1 && turns[k]! < target) k++;
        const t0 = (k - 1) / denseN;
        const t1 = k / denseN;
        const span = turns[k]! - turns[k - 1]!;
        const a = span > 1e-9 ? (target - turns[k - 1]!) / span : 1;
        out.push(evalCubicBezier(P0, P1, P2, P3, t0 + (t1 - t0) * a));
    }
    out[out.length - 1] = { ...P3 };
    return out;
}

function dropShortEdges(pts: XYZ[], minMm: number, protectFromEnd = 0): XYZ[] {
    if (pts.length < 2) return pts;
    const reservedIdx = protectFromEnd > 0 ? pts.length - 1 - protectFromEnd : -1;
    const out = [{ ...pts[0]! }];
    for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i]!;
        if (i !== reservedIdx && dist3(p, out[out.length - 1]!) < minMm) continue;
        out.push({ ...p });
    }
    const last = pts[pts.length - 1]!;
    if (protectFromEnd <= 0) {
        while (out.length > 1 && dist3(out[out.length - 1]!, last) < minMm) out.pop();
    }
    out.push({ ...last });
    return out;
}

function fitColumnCount(pts: XYZ[], n: number, keepFrom: number): XYZ[] {
    const out = pts.map((p) => ({ ...p }));
    while (out.length < n) {
        let best = keepFrom;
        let bestD = -1;
        for (let i = keepFrom; i < out.length - 2; i++) {
            const d = dist3(out[i]!, out[i + 1]!);
            if (d > bestD) {
                bestD = d;
                best = i;
            }
        }
        if (bestD < 0) break;
        const a = out[best]!;
        const b = out[best + 1]!;
        out.splice(best + 1, 0, { x: 0.5 * (a.x + b.x), y: 0.5 * (a.y + b.y), z: 0.5 * (a.z + b.z) });
    }
    while (out.length > n && out.length > keepFrom + 3) {
        let best = keepFrom + 1;
        let bestD = Infinity;
        for (let i = keepFrom + 1; i < out.length - 2; i++) {
            const d = dist3(out[i - 1]!, out[i + 1]!);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        if (!Number.isFinite(bestD)) break;
        out.splice(best, 1);
    }
    return out;
}

function columnPoints(
    fr: ColumnFrame,
    nWall: number,
    _stationSpacing = 1.3,
    _nTopFix = 0,
    _nFilFix = 0,
): XYZ[] {
    applyAlaToFrame(fr);
    const local = localSpacingOf(fr);
    const sw = fr.sweepRule;
    if (!sw) {
        throw new Error("[S1-COL] missing sweep after applyAlaToFrame");
    }
    const nRound = _nTopFix || fr.nRoundFix || 0;
    const nFil = _nFilFix || fr.nFilFix || 0;
    const nLine = fr.nLineFix || 0;
    const counts =
        nRound > 0 && nFil > 0
            ? {
                  nRound,
                  nFil,
                  nLine: nLine > 0 ? nLine : Math.max(1, nWall - nRound - nFil - 2),
                  nWall,
              }
            : undefined;
    const assembled = sampleSweepRule(
        sw,
        fr.R,
        fr.B,
        nWall,
        counts,
        fr.lastDlRad,
        fr.stationIndex ?? -1,
        local,
    );
    fr.roundRows = counts?.nRound ?? nRound;
    assembled[0] = { ...fr.R };
    assembled[assembled.length - 1] = { ...fr.B };
    return assembled;
}

function pinJunctionHolds(col: XYZ[], fr: ColumnFrame, _origin: XYZ, _maxS: number, roundRows: number): void {
    const eIdx = roundRows > 0 ? roundRows : 0;
    let fIdx = -1;
    let best = Infinity;
    for (let i = Math.max(1, eIdx); i < col.length - 1; i++) {
        const d = dist3(col[i]!, fr.F);
        if (d < best) {
            best = d;
            fIdx = i;
        }
    }
    if (fIdx < 1 || fIdx >= col.length - 1) return;
    col[fIdx] = { ...fr.F };
    if (fIdx + 1 < col.length - 1) {
        col[fIdx + 1] = projectToPlane(add3(fr.F, fr.U, -0.12), fr.R, fr.h);
    }
}

function assertBezierFilletG1(fr: ColumnFrame, col: XYZ[], roundRows: number): void {
    if (col.length < 4) return;
    let fIdx = -1;
    let best = Infinity;
    for (let i = Math.max(1, roundRows); i < col.length - 1; i++) {
        const d = dist3(col[i]!, fr.F);
        if (d < best) {
            best = d;
            fIdx = i;
        }
    }
    if (fIdx < 1 || fIdx >= col.length - 1) return;
    const tBez = {
        x: col[fIdx]!.x - col[fIdx - 1]!.x,
        y: col[fIdx]!.y - col[fIdx - 1]!.y,
        z: col[fIdx]!.z - col[fIdx - 1]!.z,
    };
    const tFil = {
        x: col[fIdx + 1]!.x - col[fIdx]!.x,
        y: col[fIdx + 1]!.y - col[fIdx]!.y,
        z: col[fIdx + 1]!.z - col[fIdx]!.z,
    };
    const deg = vecAngleDeg(tBez, tFil);
    if (deg > ROUND_JOINT_MAX_DEG + 4) {
        console.log(`[S1-G1] bezier|fillet ${deg.toFixed(2)} at u=${fr.u.toFixed(3)}`);
    }
}

function resampleKeepingRound(pts: XYZ[], n: number, wallStart: number): XYZ[] {
    if (pts.length === n) return pts;
    const head = pts.slice(0, wallStart);
    const tail = pts.slice(wallStart);
    const need = Math.max(2, n - head.length);
    return [...head, ...sampleByArcLength(tail, need).slice(1)];
}

function snapPlanMonotone(pts: XYZ[], origin: XYZ, B: XYZ, from = 1): void {
    const dx = B.x - origin.x;
    const dy = B.y - origin.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-6) return;
    const hx = dx / chord;
    const hy = dy / chord;
    let prevS = 0;
    for (let i = from; i < pts.length - 1; i++) {
        const p = pts[i]!;
        const s = (p.x - origin.x) * hx + (p.y - origin.y) * hy;
        if (s < prevS) {
            p.x = origin.x + hx * prevS;
            p.y = origin.y + hy * prevS;
        } else {
            prevS = s;
        }
    }
}

function smoothScalars(vals: number[], passes: number): number[] {
    let cur = vals.slice();
    const n = cur.length;
    for (let p = 0; p < passes; p++) {
        cur = cur.map((v, i) => 0.5 * v + 0.25 * cur[(i + n - 1) % n]! + 0.25 * cur[(i + 1) % n]!);
    }
    return cur;
}

function smoothScalarsMasked(vals: number[], valid: boolean[], passes: number): number[] {
    let cur = vals.slice();
    const n = cur.length;
    for (let p = 0; p < passes; p++) {
        const next = cur.slice();
        for (let i = 0; i < n; i++) {
            if (!valid[i]) continue;
            const im = (i + n - 1) % n;
            const ip = (i + 1) % n;
            const vm = valid[im] ? cur[im]! : cur[i]!;
            const vp = valid[ip] ? cur[ip]! : cur[i]!;
            next[i] = 0.5 * cur[i]! + 0.25 * vm + 0.25 * vp;
        }
        cur = next;
    }
    return cur;
}

/** Wall-start tilt from horizontal: −90° + flare (inward-down). Short chords stay steep. */
export function wallStartTiltRad(flareRad: number, shortChord: boolean): number {
    const clear = (TOP_CLEARANCE_DEG * Math.PI) / 180;
    if (shortChord) return -Math.PI / 2 + clear;
    return -Math.PI / 2 + flareRad;
}

export function t0TargetRad(
    sheetSlopeRad: number,
    shortChord: boolean,
    valid: boolean,
    flareRad = 0,
): number {
    const wall = wallStartTiltRad(flareRad, shortChord);
    if (shortChord || !valid) return wall;
    return Math.min(wall, sheetSlopeRad - (TOP_CLEARANCE_DEG * Math.PI) / 180);
}

function pinT0(frames: ColumnFrame[]): void {
    for (const fr of frames) {
        const target = t0TargetRad(fr.sheetSlopeRad, fr.shortChord, fr.sheetSlopeValid, fr.uTiltRad);
        fr.t0TiltRad = Math.min(fr.t0TiltRad, target);
        applyTilts(fr);
    }
}

export const SLOPE_SAMPLE_MM = [0.5, 1, 2] as const;
export const SLOPE_FALLBACK_MM = [3, 4, 6] as const;
/** Secant fallback for the round start: plus[0] only, never plusFar[1]. */
export const SECANT_NEAR_MM = 0.25;
export const SECANT_FAR_MM = 0.5;
export const FILLET_PIECE_MIN_MM = 0.5;
export const ROUND_START_INCIDENT_MAX_DEG = 2;

function rayHitsAlong(
    R: XYZ,
    dir: { x: number; y: number },
    topZ: (x: number, y: number) => number | null,
    steps: readonly number[] = SLOPE_SAMPLE_MM,
): Array<{ s: number; z: number }> {
    const out: Array<{ s: number; z: number }> = [];
    for (const s of steps) {
        const z = topZ(R.x + dir.x * s, R.y + dir.y * s);
        if (z == null) continue;
        out.push({ s, z });
    }
    return out;
}

/**
 * Geometric sheet slope along +h (rad). Positive = surface rises along +h.
 * T0 clearance only. The round uses `sheetSlopeFromNormal` (normal tilt) end to end.
 */
export function slopeFromSheetPlane(planeN: XYZ, h: { x: number; y: number }): number | null {
    const face = sheetSlopeFromNormal(planeN, h);
    return face == null ? null : -face;
}

export interface InPlaneSlope {
    slopeRad: number;
    valid: boolean;
}

/**
 * TopSheet in-plane slope along +h. Secant fallback is plus[0] at 0.25–0.5 mm
 * (never plusFar index 1). Missed rays fall back to the incident face, then −h.
 * Never defaults to 0.
 */
export function sampleInPlaneSlope(
    R: XYZ,
    h: { x: number; y: number },
    topZ: (x: number, y: number) => number | null,
    planeN?: XYZ,
): InPlaneSlope {
    const zR = topZ(R.x, R.y) ?? R.z;
    const plus = rayHitsAlong(R, h, topZ, [SECANT_NEAR_MM, SECANT_FAR_MM]);
    if (plus.length > 0) {
        const p = plus[0]!;
        const s = Math.max(SECANT_NEAR_MM, Math.min(SECANT_FAR_MM, p.s));
        return { slopeRad: Math.atan((p.z - zR) / Math.max(s, 1e-6)), valid: true };
    }
    if (planeN) {
        const face = slopeFromSheetPlane(planeN, h);
        if (face != null) return { slopeRad: face, valid: true };
    }
    const minus = rayHitsAlong(R, { x: -h.x, y: -h.y }, topZ, [SECANT_NEAR_MM, SECANT_FAR_MM]);
    if (minus.length > 0) {
        const p = minus[0]!;
        const s = Math.max(SECANT_NEAR_MM, Math.min(SECANT_FAR_MM, p.s));
        return { slopeRad: Math.atan((zR - p.z) / Math.max(s, 1e-6)), valid: true };
    }
    return { slopeRad: Number.NaN, valid: false };
}

export interface LiveSheetAtR {
    nTop: XYZ;
    tInc: XYZ | null;
    sheetSlopeRad: number;
    roundSlopeRad: number;
    planeN: XYZ;
    valid: boolean;
}

/**
 * n_top and the start tangent at R. Primary is the incident top face
 * (face normal projected into the column plane). Secant fallback is plus[0]
 * at 0.25–0.5 mm — never plusFar index 1.
 */
export function liveSheetAtR(
    R: XYZ,
    h: { x: number; y: number },
    topZ: (x: number, y: number) => number | null,
    fallbackPlaneN?: XYZ,
): LiveSheetAtR {
    const faceTilt = fallbackPlaneN ? sheetSlopeFromNormal(fallbackPlaneN, h) : null;
    const sampled = sampleInPlaneSlope(R, h, topZ, faceTilt == null ? fallbackPlaneN : undefined);
    if (faceTilt != null && fallbackPlaneN) {
        const nTop = nTopFromSheetSlope(faceTilt, h);
        const sheet = sampled.valid
            ? sampled.slopeRad
            : (slopeFromSheetPlane(fallbackPlaneN, h) ?? -faceTilt);
        return {
            nTop,
            tInc: incidentFaceTangent(fallbackPlaneN, h) ?? incidentFaceTangent(nTop, h),
            sheetSlopeRad: sheet,
            roundSlopeRad: faceTilt,
            planeN: fallbackPlaneN,
            valid: true,
        };
    }
    if (sampled.valid) {
        const roundSlopeRad = -sampled.slopeRad;
        const nTop = nTopFromSheetSlope(roundSlopeRad, h);
        return {
            nTop,
            tInc: incidentFaceTangent(nTop, h),
            sheetSlopeRad: sampled.slopeRad,
            roundSlopeRad,
            planeN: nTop,
            valid: true,
        };
    }
    return {
        nTop: { x: 0, y: 0, z: 1 },
        tInc: null,
        sheetSlopeRad: Number.NaN,
        roundSlopeRad: 0,
        planeN: fallbackPlaneN ?? { x: 0, y: 0, z: 1 },
        valid: false,
    };
}

/**
 * Sheet-clearance helper: T0 must sit at least 10° steeper than the sheet.
 * Wall start itself is −90° + flare (`wallStartTiltRad`).
 */
export function t0FromSheetSlope(sheetSlopeRad: number, shortChord: boolean): number {
    const clear = (TOP_CLEARANCE_DEG * Math.PI) / 180;
    if (shortChord) return -Math.PI / 2 + clear;
    return sheetSlopeRad - clear;
}

export function assertT0ClearsSheet(frames: ColumnFrame[]): void {
    const clear = (TOP_CLEARANCE_DEG * Math.PI) / 180;
    const rows: Array<{ u: number; sheet_h: number; line: number; lean: number; limit: number }> = [];
    const bad: Array<{ u: number; sheet_h: number; line: number; lean: number; limit: number }> = [];
    for (const f of frames) {
        if (f.shortChord || !f.sheetSlopeValid) continue;
        if ((Math.abs(f.sheetSlopeRad) * 180) / Math.PI >= STEEP_SHEET_DEG) continue;
        const row = {
            u: Number(f.u.toFixed(4)),
            sheet_h: Number(((f.sheetSlopeRad * 180) / Math.PI).toFixed(3)),
            line: Number(((f.lineTiltRad * 180) / Math.PI).toFixed(3)),
            lean: Number(((f.leanRad * 180) / Math.PI).toFixed(3)),
            limit: Number((((f.sheetSlopeRad - clear) * 180) / Math.PI).toFixed(3)),
        };
        rows.push(row);
        if (f.lineTiltRad > f.sheetSlopeRad - clear + 1e-5) bad.push(row);
    }
    const medial = frames
        .filter((f) => f.u >= 0.38 && f.u <= 0.56)
        .map((f) => ({
            u: Number(f.u.toFixed(3)),
            sheet: Number(((f.sheetSlopeRad * 180) / Math.PI).toFixed(1)),
            round: Number(((f.roundSlopeRad * 180) / Math.PI).toFixed(1)),
            r1: Number(f.rTop.toFixed(3)),
        }));
    console.log("[S1-T0]", JSON.stringify({ n: rows.length, bad: bad.length, sample: rows.slice(0, 8) }));
    console.log("[S1-ROUND-SLOPE]", JSON.stringify(medial));
}

export function columnHeading(st: HermiteStation): {
    h: { x: number; y: number };
    shortChord: boolean;
    planLen: number;
} {
    const dx = st.outline.x - st.rim.x;
    const dy = st.outline.y - st.rim.y;
    const planLen = Math.hypot(dx, dy);
    if (planLen < 1e-4) {
        const nx = st.n.x;
        const ny = st.n.y;
        const nl = Math.hypot(nx, ny) || 1;
        return { h: { x: nx / nl, y: ny / nl }, shortChord: true, planLen };
    }
    return { h: { x: dx / planLen, y: dy / planLen }, shortChord: planLen < SHORT_CHORD_MM, planLen };
}

function headingAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));
}

export function headingAllowanceDeg(planLen: number): number {
    void planLen;
    return HEADING_MAX_DEG;
}

function clampHeadingTo(
    h: { x: number; y: number },
    ref: { x: number; y: number },
    maxDeg: number,
): { x: number; y: number } {
    const ang = headingAngle(ref, h);
    const maxRad = (maxDeg * Math.PI) / 180;
    if (ang <= maxRad + 1e-9) return { ...h };
    const t = maxRad / ang;
    const x = ref.x + (h.x - ref.x) * t;
    const y = ref.y + (h.y - ref.y) * t;
    const hl = Math.hypot(x, y) || 1;
    return { x: x / hl, y: y / hl };
}

/** Signed plan offset from B along heading. Positive = toward R (outboard / wall side). */
export function lastFilletSOutboard(p: XYZ, B: XYZ, h: { x: number; y: number }): number {
    return (B.x - p.x) * h.x + (B.y - p.y) * h.y;
}

/** CCW B-loop outward normal, flipped to agree with plan(B−R). */
export function bLoopOutwardNormal(stations: HermiteStation[], i: number): { x: number; y: number } {
    const n = stations.length;
    const prev = stations[(i + n - 1) % n]!.outline;
    const next = stations[(i + 1) % n]!.outline;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    let nx = ty / tl;
    let ny = -tx / tl;
    const chord = columnHeading(stations[i]!).h;
    if (nx * chord.x + ny * chord.y < 0) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}

/**
 * Rotate each column plane about the vertical through B, toward perpendicular
 * to the B-loop tangent, then Gaussian-smooth and re-clamp to 3° of plan(B−R).
 * B stays in the plane because the plane origin is B.
 */
export function smoothStationHeadings(stations: HermiteStation[]): Array<{ x: number; y: number }> {
    const n = stations.length;
    if (n === 0) return [];
    const chords = stations.map((st) => columnHeading(st));
    const raw = stations.map((_, i) => bLoopOutwardNormal(stations, i));
    const bLoop = stations.map((s) => s.outline);
    const sx = periodicGaussian(
        raw.map((h) => h.x),
        bLoop,
    );
    const sy = periodicGaussian(
        raw.map((h) => h.y),
        bLoop,
    );
    const out = sx.map((_, i) => {
        const hl = Math.hypot(sx[i]!, sy[i]!) || 1;
        return clampHeadingTo({ x: sx[i]! / hl, y: sy[i]! / hl }, chords[i]!.h, HEADING_MAX_DEG);
    });
    const maxRad = (HEADING_MAX_DEG * Math.PI) / 180;
    for (let pass = 0; pass < 8; pass++) {
        for (let i = 0; i < n; i++) {
            const prev = out[(i + n - 1) % n]!;
            const cur = out[i]!;
            const ang = headingAngle(prev, cur);
            if (ang <= maxRad + 1e-9) continue;
            const t = maxRad / ang;
            const x = prev.x + (cur.x - prev.x) * t;
            const y = prev.y + (cur.y - prev.y) * t;
            const hl = Math.hypot(x, y) || 1;
            out[i] = { x: x / hl, y: y / hl };
        }
    }
    for (let i = 0; i < n; i++) out[i] = clampHeadingTo(out[i]!, chords[i]!.h, HEADING_MAX_DEG);
    return out;
}

function signedHeadingDelta(from: { x: number; y: number }, to: { x: number; y: number }): number {
    return Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y);
}

function rotateXyAboutB(p: XYZ, B: XYZ, ang: number): XYZ {
    const dx = p.x - B.x;
    const dy = p.y - B.y;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return { x: B.x + c * dx - s * dy, y: B.y + s * dx + c * dy, z: p.z };
}

function headingRotated(h: { x: number; y: number }, ang: number): { x: number; y: number } {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const x = c * h.x - s * h.y;
    const y = s * h.x + c * h.y;
    const hl = Math.hypot(x, y) || 1;
    return { x: x / hl, y: y / hl };
}

/**
 * Rotate a chord-built column about the vertical through B toward `desired`.
 * B stays put. Rotation is reduced if the last fillet would go inward or
 * drop below the s/z clamp. Interiors stay in the rotated B-plane.
 */
export function rotateColumnAboutB(
    col: XYZ[],
    B: XYZ,
    R: XYZ,
    chord: { x: number; y: number },
    desired: { x: number; y: number },
): { x: number; y: number } {
    if (col.length < 3) return { ...chord };
    const original = col.map((p) => ({ ...p }));
    const maxRad = (HEADING_MAX_DEG * Math.PI) / 180;
    let ang = signedHeadingDelta(chord, desired);
    ang = Math.max(-maxRad, Math.min(maxRad, ang));
    const p0 = original[original.length - 2]!;
    const s0 = lastFilletSOutboard(p0, B, chord);
    const apply = (t: number): { x: number; y: number } => {
        const a = ang * t;
        const h = headingRotated(chord, a);
        for (let i = 1; i < col.length - 1; i++) col[i] = rotateXyAboutB(original[i]!, B, a);
        col[0] = { ...R };
        col[col.length - 1] = { ...B };
        return h;
    };
    const ok = (h: { x: number; y: number }): boolean => {
        const p = col[col.length - 2]!;
        const s = lastFilletSOutboard(p, B, h);
        return s + 1e-9 >= s0 && s >= LAST_FILLET_S_MIN_MM - 1e-9 && p.z >= LAST_FILLET_Z_MIN_MM - 1e-9;
    };
    const hDes = apply(1);
    if (ok(hDes)) return hDes;
    let lo = 0;
    let hi = 1;
    let best = apply(0);
    for (let k = 0; k < 10; k++) {
        const t = (lo + hi) * 0.5;
        const h = apply(t);
        if (ok(h)) {
            lo = t;
            best = h;
        } else {
            hi = t;
        }
    }
    apply(lo);
    return best;
}

export function clampLastFilletOutboard(col: XYZ[], B: XYZ, h: { x: number; y: number }): void {
    if (col.length < 3) return;
    const i = col.length - 2;
    const prev = col[i - 1]!;
    const vx = B.x - prev.x;
    const vy = B.y - prev.y;
    const vz = B.z - prev.z;
    const len = Math.hypot(vx, vy, vz);
    if (len < 1e-9) return;
    const zNeed = vz < -1e-12 ? (LAST_FILLET_Z_MIN_MM * len) / Math.abs(vz) : LAST_FILLET_Z_MIN_MM;
    const minDist = Math.max(LAST_FILLET_S_MIN_MM, LAST_FILLET_Z_MIN_MM, zNeed);
    if (minDist >= len - 1e-9) return;
    const t = 1 - minDist / len;
    const p = { x: prev.x + vx * t, y: prev.y + vy * t, z: prev.z + vz * t };
    if (
        vecAngleDeg(
            { x: p.x - prev.x, y: p.y - prev.y, z: p.z - prev.z },
            { x: B.x - p.x, y: B.y - p.y, z: B.z - p.z },
        ) >
        ROUND_JOINT_MAX_DEG + 1e-3
    ) {
        return;
    }
    col[i] = p;
}

/** Periodic Gaussian on n_plantar. No 5° step cap — posting tilt must survive. */
export function smoothPlantarNormalField(
    normals: XYZ[],
    rim: XYZ[],
    sigma = PLANTAR_N_SMOOTH_SIGMA_MM,
): XYZ[] {
    if (normals.length < 3) {
        return normals.map((n) => {
            const u = unit3(n);
            return u.z < 0 ? { x: -u.x, y: -u.y, z: -u.z } : u;
        });
    }
    const nx = periodicGaussian(
        normals.map((n) => n.x),
        rim,
        sigma,
    );
    const ny = periodicGaussian(
        normals.map((n) => n.y),
        rim,
        sigma,
    );
    const nz = periodicGaussian(
        normals.map((n) => n.z),
        rim,
        sigma,
    );
    return nx.map((_, i) => {
        let n = unit3({ x: nx[i]!, y: ny[i]!, z: nz[i]! });
        if (n.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
        return n;
    });
}

export function smoothNormalField(normals: XYZ[], rim: XYZ[], sigma = SCALAR_SMOOTH_SIGMA_MM): XYZ[] {
    if (normals.length < 3) return normals.map((n) => unit3(n));
    const nx = periodicGaussian(
        normals.map((n) => n.x),
        rim,
        sigma,
    );
    const ny = periodicGaussian(
        normals.map((n) => n.y),
        rim,
        sigma,
    );
    const nz = periodicGaussian(
        normals.map((n) => n.z),
        rim,
        sigma,
    );
    const raw = nx.map((_, i) => {
        let n = unit3({ x: nx[i]!, y: ny[i]!, z: nz[i]! });
        if (n.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
        return n;
    });
    return limitNormalSteps(raw, N_TOP_MAX_DEG, true);
}

/** Cap adjacent n_top steps. Past-vertical sheets keep nz < 0 when flipDown is false. */
export function limitNormalSteps(normals: XYZ[], maxDeg: number, flipDown = false): XYZ[] {
    const maxRad = (maxDeg * Math.PI) / 180;
    const out = normals.map((n) => unit3(n));
    for (let pass = 0; pass < 8; pass++) {
        for (let i = 0; i < out.length; i++) {
            const prev = out[(i + out.length - 1) % out.length]!;
            const cur = out[i]!;
            const ang = Math.acos(Math.max(-1, Math.min(1, dot3(prev, cur))));
            if (ang <= maxRad + 1e-9) continue;
            const t = maxRad / ang;
            let n = unit3({
                x: prev.x + (cur.x - prev.x) * t,
                y: prev.y + (cur.y - prev.y) * t,
                z: prev.z + (cur.z - prev.z) * t,
            });
            if (flipDown && n.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
            out[i] = n;
        }
    }
    return out;
}

export function periodicGaussian(vals: number[], rim: XYZ[], sigma = SCALAR_SMOOTH_SIGMA_MM): number[] {
    const n = vals.length;
    if (n === 0) return [];
    if (n < 3) return vals.slice();
    const ds = rim.map((p, i) => dist3(p, rim[(i + 1) % n]!));
    const period = ds.reduce((s, d) => s + d, 0);
    const cum = [0];
    for (const d of ds) cum.push(cum[cum.length - 1]! + d);
    const sig = Math.max(8, Math.min(15, sigma));
    return vals.map((_, i) => {
        let s = 0;
        let w = 0;
        for (let j = 0; j < n; j++) {
            let d = Math.abs(cum[j]! - cum[i]!);
            d = Math.min(d, period - d);
            const wt = Math.exp((-0.5 * d * d) / (sig * sig));
            s += wt * vals[j]!;
            w += wt;
        }
        return w > 0 ? s / w : vals[i]!;
    });
}

/** Pull adjacent scalars until |Δ| ≤ maxAbs, honoring per-station floors. */
export function rateLimitClosedAbs(vals: number[], maxAbs: number, floor: number | number[] = 0): number[] {
    const n = vals.length;
    const floorAt = (i: number): number => (Array.isArray(floor) ? (floor[i] ?? 0) : floor);
    const out = vals.map((v, i) => Math.max(floorAt(i), v));
    if (n < 2) return out;
    const cap = Math.max(0, maxAbs);
    const pull = (i: number, j: number): void => {
        const a = out[i]!;
        const b = out[j]!;
        if (b > a + cap) {
            const lowered = Math.max(floorAt(j), a + cap);
            if (lowered <= a + cap + 1e-12) out[j] = lowered;
            else out[i] = Math.max(floorAt(i), b - cap);
        } else if (a > b + cap) {
            const lowered = Math.max(floorAt(i), b + cap);
            if (lowered <= b + cap + 1e-12) out[i] = lowered;
            else out[j] = Math.max(floorAt(j), a - cap);
        }
    };
    for (let pass = 0; pass < 16; pass++) {
        for (let i = 0; i < n; i++) pull(i, (i + 1) % n);
        for (let i = n - 1; i >= 0; i--) pull(i, (i + 1) % n);
    }
    return out;
}

/** Raise the smaller neighbor only so |Δ| ≤ maxAbs. Never shrink a floor. */
export function rateLimitClosedAbsRaise(
    vals: number[],
    maxAbs: number,
    floor: number | number[] = 0,
): number[] {
    const n = vals.length;
    const floorAt = (i: number): number => (Array.isArray(floor) ? (floor[i] ?? 0) : floor);
    const out = vals.map((v, i) => Math.max(floorAt(i), v));
    if (n < 2) return out;
    const cap = Math.max(0, maxAbs);
    for (let pass = 0; pass < 16; pass++) {
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const a = out[i]!;
            const b = out[j]!;
            if (b > a + cap) out[i] = Math.max(floorAt(i), b - cap);
            else if (a > b + cap) out[j] = Math.max(floorAt(j), a - cap);
        }
    }
    return out;
}

/** Pull adjacent scalars until |Δ| / max(from, 1e-6) ≤ maxPct / 100. */
export function rateLimitClosed(vals: number[], maxPct: number, floor = 0): number[] {
    const n = vals.length;
    const out = vals.map((v) => Math.max(floor, v));
    if (n < 2) return out;
    const f = Math.max(0, maxPct) / 100;
    const pull = (from: number, to: number): number => {
        const den = Math.max(from, 1e-6);
        const lo = den * (1 - f);
        const hi = den * (1 + f);
        return Math.max(floor, Math.min(hi, Math.max(lo, to)));
    };
    for (let pass = 0; pass < 6; pass++) {
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            out[j] = pull(out[i]!, out[j]!);
        }
        for (let i = n - 1; i >= 0; i--) {
            const j = (i + 1) % n;
            out[i] = pull(out[j]!, out[i]!);
        }
    }
    return out;
}

/** Periodic angle limiter (radians) so adjacent stations stay within maxDeg. */
export function rateLimitAngleClosed(vals: number[], maxDeg: number): number[] {
    const n = vals.length;
    const out = vals.slice();
    if (n < 2) return out;
    const maxRad = (Math.max(0, maxDeg) * Math.PI) / 180;
    for (let pass = 0; pass < 8; pass++) {
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const d = out[j]! - out[i]!;
            if (Math.abs(d) <= maxRad + 1e-12) continue;
            out[j] = out[i]! + Math.sign(d) * maxRad;
        }
    }
    return out;
}

/** Shrink only the larger neighbor so ALA cannot reopen a >maxPct jump. */
export function rateLimitClosedDown(vals: number[], maxPct: number, floor = 0): number[] {
    const n = vals.length;
    const out = vals.map((v) => Math.max(floor, v));
    if (n < 2) return out;
    const f = Math.max(0, maxPct) / 100;
    for (let pass = 0; pass < 8; pass++) {
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const a = out[i]!;
            const b = out[j]!;
            const capFromA = Math.max(a, 1e-6) * (1 + f);
            const capFromB = Math.max(b, 1e-6) * (1 + f);
            if (b > capFromA) out[j] = Math.max(floor, capFromA);
            if (a > capFromB) out[i] = Math.max(floor, capFromB);
        }
    }
    return out;
}

function snapshotStationParams(frames: ColumnFrame[]): StationParamRow[] {
    return frames
        .filter((f) => f.u <= 0.1 + 1e-9 || (f.u >= 0.25 - 1e-9 && f.u <= 0.45 + 1e-9))
        .map((f) => ({
            u: Number(f.u.toFixed(4)),
            flare: Number(((f.leanRad * 180) / Math.PI).toFixed(3)),
            t0: Number(((f.t0TiltRad * 180) / Math.PI).toFixed(3)),
            a: Number(f.a.toFixed(3)),
            b: Number(f.b.toFixed(3)),
            rRound: Number(f.rTop.toFixed(3)),
            rFillet: Number(f.rFillet.toFixed(3)),
            height: Number(f.heightMm.toFixed(3)),
            planEB: Number(Math.hypot(f.B.x - (f.E?.x ?? f.R.x), f.B.y - (f.E?.y ?? f.R.y)).toFixed(3)),
        }));
}

export function smoothFilletRadii(frames: ColumnFrame[], _frac = R_SMOOTH_FRAC): void {
    if (frames.length < 3) return;
    const rim = frames.map((f) => f.R);
    const next = periodicGaussian(
        frames.map((f) => f.rFillet),
        rim,
    );
    for (let i = 0; i < frames.length; i++) frames[i]!.rFillet = Math.max(0.05, next[i]!);
    enforceLastChordFloor(frames);
}

export function placeFilletF(fr: ColumnFrame): void {
    applyTilts(fr);
    fr.uTiltRad = clampFilletB(fr.uTiltRad);
    applyTilts(fr);
    const planLen = Math.hypot(fr.R.x - fr.B.x, fr.R.y - fr.B.y);
    const psi = Math.PI / 2 - fr.uTiltRad;
    fr.rFillet = Math.min(fr.rFillet, filletRadiusMm(fr.heightMm, planLen, psi));
    const fil = constructFillet(fr.B, fr.h, fr.rFillet, fr.U, fr.plantarSlopeRad, fr.nPlantar);
    fr.uTiltRad = fil.b;
    fr.U = fil.d;
    fr.tFillet = fil.t;
    fr.F = projectToPlane(fil.Pw, fr.R, fr.h);
    enforceLastChordFloor([fr]);
}

function clampHandlesToChord(fr: ColumnFrame): void {
    applyTilts(fr);
    const W = t0LeadQ(fr);
    const planEB = Math.hypot(fr.B.x - W.x, fr.B.y - W.y);
    const chord = Math.max(dist3(W, fr.F), 1e-6);
    fr.a = Math.min(fr.a, HANDLE_CHORD_CAP * chord);
    fr.b = Math.min(fr.b, HANDLE_CHORD_CAP * chord);
    const t0h = fr.T0.x * fr.h.x + fr.T0.y * fr.h.y;
    const sW = planS(W, W, fr.h);
    if (t0h > 1e-9) fr.a = Math.min(fr.a, Math.max(0, (planEB - sW) / t0h));
    const uh = fr.U.x * fr.h.x + fr.U.y * fr.h.y;
    const sF = planS(fr.F, W, fr.h);
    if (uh > 1e-9) fr.b = Math.min(fr.b, Math.max(0, (planEB - sF) / uh));
    if (uh < -1e-9) fr.b = Math.min(fr.b, Math.max(0, (0 - sF) / uh));
    fr.a = Math.max(0, fr.a);
    fr.b = Math.max(0, fr.b);
}

function setHandlesFromQF(fr: ColumnFrame): void {
    applyTilts(fr);
    const origin = fr.E ?? t0LeadQ(fr);
    const rf = Math.max(1e-3, dist3(origin, fr.F));
    const handle = Math.max(0.12, Math.min(BEZIER_HANDLE_FRAC * rf, HANDLE_CHORD_CAP * rf));
    fr.a = handle;
    fr.b = handle;
    clampHandlesToChord(fr);
}

function sheetFrameAtR(
    R: XYZ,
    h: { x: number; y: number },
    topZ: (x: number, y: number) => number | null,
    junction?: ColumnJunction,
    liveSheet = false,
): LiveSheetAtR {
    if (liveSheet) return liveSheetAtR(R, h, topZ, junction?.planeN);
    const sampled = sampleInPlaneSlope(R, h, topZ, junction?.planeN);
    const faceN = junction?.planeN;
    const faceTilt = faceN ? sheetSlopeFromNormal(faceN, h) : null;
    const roundSlopeRad = faceTilt != null ? faceTilt : sampled.valid ? -sampled.slopeRad : 0;
    const valid = faceTilt != null || sampled.valid;
    const nTop = valid ? nTopFromSheetSlope(roundSlopeRad, h) : { x: 0, y: 0, z: 1 };
    return {
        nTop,
        tInc: valid ? incidentFaceTangent(faceN ?? nTop, h) : null,
        sheetSlopeRad: sampled.valid ? sampled.slopeRad : faceN ? (slopeFromSheetPlane(faceN, h) ?? 0) : 0,
        roundSlopeRad,
        planeN: faceN ?? nTop,
        valid,
    };
}

export function initColumnFrames(
    stations: HermiteStation[],
    _junctions: ColumnJunction[],
    _defaults: WallRegionDefaults,
    flareDeg: number[],
    topZ: (x: number, y: number) => number | null = () => null,
    plantarSlopeRad: number[] = [],
    nPlantars: XYZ[] = [],
    liveSheet = false,
): ColumnFrame[] {
    const outline = stations.map((s) => s.outline);
    const nTops = smoothNormalField(
        stations.map((st, i) => unit3(_junctions[i]?.planeN ?? { x: 0, y: 0, z: 1 })),
        stations.map((st) => st.rim),
    );
    const spacing = medianStationSpacing(stations);
    const frames = stations.map((st, i) => {
        const R = { ...st.rim };
        const B = { ...st.outline };
        const chord = columnHeading(st);
        const nB = stations.length > 1 ? bLoopOutwardNormal(stations, i) : chord.h;
        const prevR = stations[(i + stations.length - 1) % stations.length]!.rim;
        const nextR = stations[(i + 1) % stations.length]!.rim;
        let tRim = unit3({ x: nextR.x - prevR.x, y: nextR.y - prevR.y, z: nextR.z - prevR.z });
        if (hypot3(tRim) < 1e-12) tRim = { x: -chord.h.y, y: chord.h.x, z: 0 };
        const prevB = stations[(i + stations.length - 1) % stations.length]!.outline;
        const nextB = stations[(i + 1) % stations.length]!.outline;
        const localSpacing =
            stations.length > 1
                ? 0.5 * (Math.hypot(B.x - prevB.x, B.y - prevB.y) + Math.hypot(nextB.x - B.x, nextB.y - B.y))
                : spacing;
        const squared = squareHeadingToB(chord.h, nB);
        const h = chord.h;
        const rawCosT = squared.cosT;
        const rawAngle = squared.angleDeg;
        if (rawAngle > OBLIQUE_WARN_DEG) {
            console.warn(
                `[S1-OBLIQUE] station ${i} u=${st.u.toFixed(3)} angle(h,nB)=${rawAngle.toFixed(1)} cosT=${rawCosT.toFixed(3)}`,
            );
        }
        const shortChord = chord.shortChord;
        const planLen = chord.planLen;
        const height = Math.max(R.z - B.z, 0.5);
        const live = sheetFrameAtR(R, h, topZ, _junctions[i], liveSheet);
        const sheetSlopeRad = live.valid ? live.sheetSlopeRad : 0;
        const roundSlopeRad = live.valid ? live.roundSlopeRad : 0;
        const nTop = live.valid ? live.nTop : nTops[i]!;
        const plantar = plantarSlopeRad[i] ?? 0;
        const nPlantar = nPlantars[i] ?? plantarFrameAt(h, plantar).ez;
        const r = Math.min(
            FILLET_R_CAP_MM,
            Math.max(0.05, _defaults.wallFilletBottomMm || filletRadiusMm(height, planLen, Math.PI / 2)),
        );
        const rTop = Math.min(FILLET_R_CAP_MM, Math.max(MIN_ROUND_R_MM, _defaults.wallFilletTopMm || 0.5));
        const fr: ColumnFrame = {
            R,
            B,
            F: { x: B.x, y: B.y, z: B.z + r },
            h,
            T0: { x: -h.x, y: -h.y, z: 0 },
            U: { x: 0, y: 0, z: -1 },
            a: 0,
            b: 0,
            t0TiltRad: 0,
            uTiltRad: 0,
            sheetSlopeRad,
            roundSlopeRad,
            sheetSlopeValid: live.valid,
            stationSpacingMm: spacing,
            plantarSlopeRad: plantar,
            nPlantar,
            sheetPlaneN: live.valid ? live.planeN : _junctions[i]?.planeN,
            tInc: live.tInc,
            rFillet: r,
            rTop,
            tFillet: 0,
            u: st.u,
            shortChord,
            overhangMm: rimOverhangMm(R, outline),
            heightMm: height,
            bandZ: B.z,
            bandInsetMm: estimateBandInsetMm(r, Math.PI / 2),
            arcEndZ: B.z,
            E: { ...R },
            nTop,
            nTopSmoothed: nTop,
            wOut: { x: -h.x, y: -h.y },
            nWall: { x: 0, y: 0, z: 1 },
            roundRows: TOP_ROUND_MIN_ROWS,
            lineLengthMm: 0,
            leanRad: 0,
            lineTiltRad: -Math.PI / 2,
            roundSweepRad: 0,
            filletSweepRad: 0,
            cosT: rawCosT,
            lastDlRad: lastFilletDLRad(Math.PI / 2, 1),
            nRoundFix: 0,
            nFilFix: 0,
            nLineFix: 0,
            headingObliqueDeg: rawAngle,
            nB,
            tRim,
            localSpacingMm: Math.max(1e-3, localSpacing),
            maxSpacingMm: Math.max(
                1e-3,
                stations.length > 1
                    ? Math.max(
                          Math.hypot(B.x - prevB.x, B.y - prevB.y),
                          Math.hypot(nextB.x - B.x, nextB.y - B.y),
                      )
                    : localSpacing,
            ),
            g1EDeg: 0,
            g1FDeg: 0,
            sweepConverged: true,
            obliqueFallback: false,
            stationIndex: i,
            nRoundPlane: { x: -h.y, y: h.x, z: 0 },
            nFilPlane: { x: -nB.y, y: nB.x, z: 0 },
            phiRound1: Math.PI / 2,
        };
        return fr;
    });
    const smoothed = smoothPlantarNormalField(
        frames.map((f) => f.nPlantar ?? { x: 0, y: 0, z: 1 }),
        frames.map((f) => f.B),
        PLANTAR_N_SMOOTH_SIGMA_MM,
    );
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const n = smoothed[i]!;
        fr.nPlantar = n;
        fr.plantarSlopeRad = Math.atan2(n.x * fr.h.x + n.y * fr.h.y, n.z);
        fr.heightMm = Math.max(fr.R.z - fr.B.z, 0.5);
        applyAlaToFrame(fr);
    }
    return frames;
}

function clampHandleInboard(fr: ColumnFrame): void {
    const dx = fr.B.x - fr.R.x;
    const dy = fr.B.y - fr.R.y;
    const den = fr.U.x * dx + fr.U.y * dy;
    if (den >= -1e-9) return;
    const num = (fr.F.x - fr.R.x) * dx + (fr.F.y - fr.R.y) * dy;
    fr.b = Math.min(fr.b, Math.max(0, -num / den));
}

function applySmooth(
    frames: ColumnFrame[],
    _passes: number,
): { before: StationParamRow[]; after: StationParamRow[] } {
    const before = snapshotStationParams(frames);
    for (const fr of frames) applyAlaToFrame(fr);
    const rim = frames.map((f) => f.R);
    const r1 = periodicGaussian(
        frames.map((f) => f.rTop),
        rim,
    );
    const r2 = periodicGaussian(
        frames.map((f) => f.rFillet),
        rim,
    );
    for (let i = 0; i < frames.length; i++) {
        frames[i]!.rTop = r1[i]!;
        frames[i]!.rFillet = r2[i]!;
    }
    enforceAbsRadiusRate(frames);
    return { before, after: snapshotStationParams(frames) };
}

function guardFrames(
    frames: ColumnFrame[],
    junctions: ColumnJunction[],
    rimLoop: PolyPoint[],
    topZ: (x: number, y: number) => number | null,
    nWall: number,
    stationSpacing: number,
    nRoundG = 0,
    nFilG = 0,
): void {
    for (let round = 0; round < 8; round++) {
        let dirty = false;
        for (let i = 0; i < frames.length; i++) {
            const fr = frames[i]!;
            const pts = columnPoints(fr, nWall, stationSpacing, nRoundG, nFilG);
            const junct = junctions[i]!;
            const wallFrom = Math.max(1, fr.roundRows || 1);
            let inside = false;
            for (let j = wallFrom; j < pts.length - 1; j++) {
                if (rowInsideTop(pts[j]!, fr.R, junct.planeN, rimLoop, topZ)) {
                    inside = true;
                    break;
                }
            }
            if (inside) {
                fr.rTop = Math.max(MIN_ROUND_R_MM, fr.rTop * 0.85);
                fr.rFillet = Math.max(lastFilletR2MinMm(localSpacingOf(fr), fr.lastDlRad), fr.rFillet * 0.85);
                applyAlaToFrame(fr);
                dirty = true;
            }
        }
        if (!dirty) break;
    }
    enforceLastChordFloor(frames);
}

/** A station too short to vote on nRound* / nFil* / nLine*. */
export function isCollapsedColumn(fr: ColumnFrame): boolean {
    const plan = Math.hypot(fr.B.x - fr.R.x, fr.B.y - fr.R.y);
    return (
        Boolean(fr.shortChord) || plan < SHORT_CHORD_MM || fr.heightMm < 1 || fr.rTop < MIN_ROUND_R_MM - 1e-9
    );
}

function maxValidatedRingMm(frames: ColumnFrame[], fallback: number): number {
    let maxRing = fallback;
    for (let i = 0; i < frames.length; i++) {
        const a = frames[i]!;
        const b = frames[(i + 1) % frames.length]!;
        if (isCollapsedColumn(a) || isCollapsedColumn(b)) continue;
        maxRing = Math.max(maxRing, dist3(a.R, b.R), Math.hypot(a.B.x - b.B.x, a.B.y - b.B.y));
    }
    return maxRing;
}

function choosePieceCounts(frames: ColumnFrame[], spacing: number): NRoundStarReport {
    const stepRad = (TOP_ROUND_MAX_STEP_DEG * Math.PI) / 180;
    const filStepRad = (FILLET_STEP_MAX_DEG * Math.PI) / 180;
    const lineMinStep = (maxValidatedRingMm(frames, spacing) * 1.05) / ASPECT_EVERYWHERE_MAX;
    let nRound = TOP_ROUND_MIN_ROWS;
    let nFil = MIN_FILLET_RINGS;
    let nLineNeed = 1;
    let maxNeedR = 0;
    let setter = -1;
    let setterU = 0;
    let sweepDeg = 0;
    let collapsedSkipped = 0;
    let minLineLen = Infinity;
    const aspectStation = -1;
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        if (isCollapsedColumn(fr)) {
            collapsedSkipped++;
            continue;
        }
        const needR = Math.ceil(Math.abs(fr.roundSweepRad) / Math.max(stepRad, 1e-9));
        if (needR > maxNeedR) {
            maxNeedR = needR;
            setter = i;
            setterU = fr.u;
            sweepDeg = (Math.abs(fr.roundSweepRad) * 180) / Math.PI;
        }
        const S = Math.abs(fr.filletSweepRad);
        const dL = fr.lastDlRad || lastFilletDLRad(S, 1);
        nFil = Math.max(nFil, Math.ceil(Math.max(S - dL, 1e-12) / Math.max(filStepRad, 1e-9)));
        nLineNeed = Math.max(nLineNeed, lineRowCount(fr.lineLengthMm, spacing));
        if (fr.lineLengthMm >= lineMinStep) minLineLen = Math.min(minLineLen, fr.lineLengthMm);
    }
    nRound = Math.max(TOP_ROUND_MIN_ROWS, maxNeedR);
    nFil = Math.max(MIN_FILLET_RINGS, nFil);
    if (Number.isFinite(minLineLen) && collapsedSkipped < frames.length) {
        nLineNeed = Math.min(nLineNeed, Math.max(1, Math.floor(minLineLen / Math.max(lineMinStep, 1e-6))));
    }
    return {
        nRound,
        nFil,
        nLine: Math.max(1, nLineNeed),
        setter,
        setterU,
        sweepDeg,
        collapsedSkipped,
        aspectCapped: false,
        aspectStation,
    };
}

/** If minStep would force fewer round rows, raise r1 so the arc can hold nRound*. */
function raiseR1ForRoundRows(frames: ColumnFrame[], nRound: number, minStep: number): void {
    const n = Math.max(1, nRound);
    for (const fr of frames) {
        const sweep = Math.abs(fr.roundSweepRad);
        if (sweep < 1e-9) continue;
        const step = sweep / n;
        const localStep = Math.max(
            MIN_EDGE_MM,
            Math.min(localSpacingOf(fr), OUTLINE_STATION_SPACING_MM) / ASPECT_EVERYWHERE_MAX,
        );
        const useStep = Math.min(minStep, localStep);
        const r1Arc = (n * useStep) / sweep;
        const r1Edge = MIN_EDGE_MM / (2 * Math.sin(Math.max(step, 1e-9) / 2));
        const need = Math.max(r1Arc, r1Edge, MIN_ROUND_R_MM);
        if (fr.rTop + 1e-9 >= need) continue;
        const budget = Math.min(FILLET_R_CAP_MM, Math.max(MIN_ROUND_R_MM, R1_HEIGHT_FRAC * fr.heightMm));
        fr.rTop = Math.min(need, budget);
        applyAlaToFrame(fr);
    }
}

function applyPieceCounts(frames: ColumnFrame[], report: NRoundStarReport): number {
    for (const fr of frames) {
        fr.nRoundFix = report.nRound;
        fr.nFilFix = report.nFil;
        fr.nLineFix = report.nLine;
        fr.roundRows = report.nRound;
    }
    return report.nRound + report.nLine + report.nFil + 2;
}

/**
 * Sweep+rule columns: top round in span(wOut, nTop), fillet in span(nB, z),
 * ruled E→F by station index. R and B never move.
 */
function resampleIncidentNTop(
    frames: ColumnFrame[],
    junctions: ColumnJunction[],
    topZ: (x: number, y: number) => number | null,
    liveSheet = false,
): void {
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const live = sheetFrameAtR(fr.R, fr.h, topZ, junctions[i], liveSheet);
        if (live.valid) {
            fr.sheetSlopeRad = live.sheetSlopeRad;
            fr.roundSlopeRad = live.roundSlopeRad;
            fr.nTop = live.nTop;
            fr.nTopSmoothed = live.nTop;
            fr.sheetSlopeValid = true;
            fr.sheetPlaneN = live.planeN;
            fr.tInc = live.tInc;
        }
        applyAlaToFrame(fr);
    }
}

export function buildBezierColumns(
    stations: HermiteStation[],
    junctions: ColumnJunction[],
    defaults: WallRegionDefaults,
    rimLoop: PolyPoint[],
    topZ: (x: number, y: number) => number | null,
    nWall: number,
    plantarSlopeRad: number[] = [],
    minWallMm = 0.8,
    nPlantars: XYZ[] = [],
    liveSheet = false,
): BezierColumns {
    const regionDefault = stations.map((st) =>
        blendedFlareDeg(st.u, st.outline.y, defaults.flareDeg, defaults.medialYSign ?? 1),
    );
    const { flare, report } = smoothAndCapFlare(
        stations.map((s) => s.outline),
        regionDefault,
    );
    const frames = initColumnFrames(
        stations,
        junctions,
        defaults,
        flare,
        topZ,
        plantarSlopeRad,
        nPlantars,
        liveSheet,
    );
    const spacing = medianStationSpacing(stations);
    const minWallClamps = clampFramesMinWall(frames, topZ, minWallMm);
    enforceLastChordFloor(frames);
    const smoothLog = applySmooth(frames, FRAME_SMOOTH_ITERS);
    enforceLastChordFloor(frames);
    console.log("[S1-SMOOTH] before", JSON.stringify(smoothLog.before));
    console.log("[S1-SMOOTH] after", JSON.stringify(smoothLog.after));
    resampleIncidentNTop(frames, junctions, topZ, liveSheet);
    let piece = choosePieceCounts(frames, spacing);
    let nRoundStar = piece.nRound;
    let nFilStar = piece.nFil;
    let nLineStar = piece.nLine;
    nWall = applyPieceCounts(frames, piece);
    raiseR1ForRoundRows(frames, piece.nRound, spacing / ASPECT_EVERYWHERE_MAX);
    console.log(
        "[S1-NROUND]",
        JSON.stringify({
            nRound: piece.nRound,
            setter: piece.setter,
            u: Number(piece.setterU.toFixed(4)),
            sweepDeg: Number(piece.sweepDeg.toFixed(2)),
            collapsedSkipped: piece.collapsedSkipped,
            aspectCapped: piece.aspectCapped,
            aspectStation: piece.aspectStation,
        }),
    );
    console.log(
        "[S1-PIECES]",
        JSON.stringify({ nRound: nRoundStar, nFil: nFilStar, nLine: nLineStar, nWall, nS: frames.length }),
    );
    guardFrames(frames, junctions, rimLoop, topZ, nWall, spacing, nRoundStar, nFilStar);
    enforceAbsRadiusRate(frames);
    resampleIncidentNTop(frames, junctions, topZ, liveSheet);
    smoothRoundEndAngles(frames);
    piece = choosePieceCounts(frames, spacing);
    nRoundStar = piece.nRound;
    nFilStar = piece.nFil;
    nLineStar = piece.nLine;
    nWall = applyPieceCounts(frames, piece);
    raiseR1ForRoundRows(frames, piece.nRound, spacing / ASPECT_EVERYWHERE_MAX);
    console.log(
        "[S1-NROUND]",
        JSON.stringify({
            nRound: piece.nRound,
            setter: piece.setter,
            u: Number(piece.setterU.toFixed(4)),
            sweepDeg: Number(piece.sweepDeg.toFixed(2)),
            collapsedSkipped: piece.collapsedSkipped,
            aspectCapped: piece.aspectCapped,
            aspectStation: piece.aspectStation,
            pass: "final",
        }),
    );
    console.log(
        "[S1-PIECES-FINAL]",
        JSON.stringify({
            nRound: nRoundStar,
            nFil: nFilStar,
            nLine: nLineStar,
            nWall,
            nS: frames.length,
            setter: piece.setter,
            collapsedSkipped: piece.collapsedSkipped,
        }),
    );
    enforceLastChordFloor(frames, true);
    const xyz: PolyPoint[][] = [];
    const implied: number[] = [];
    let maxOff = 0;
    let maxSide = 0;
    let maxTiltStep = 0;
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const col = columnPoints(fr, nWall, spacing, fr.nRoundFix, fr.nFilFix);
        col[0] = { ...fr.R };
        col[col.length - 1] = { ...fr.B };
        assertRoundJoints(fr, col);
        fr.arcEndZ = col[col.length - 2]?.z ?? fr.B.z;
        const nRnd = fr.nRoundFix || fr.roundRows || 0;
        const nLn = fr.nLineFix || 0;
        for (let k = 1; k <= nRnd && k < col.length - 1; k++) {
            maxOff = Math.max(maxOff, offPlaneNormalMm(col[k]!, fr.R, fr.nRoundPlane));
        }
        const fIdx = nRnd + nLn;
        for (let k = fIdx + 1; k < col.length - 1; k++) {
            if (!pointPastF(col[k]!, fr.E, fr.F)) continue;
            maxOff = Math.max(maxOff, offPlaneNormalMm(col[k]!, fr.B, fr.nFilPlane));
        }
        maxSide = Math.max(maxSide, offPlaneMm(col[col.length - 1]!, fr.B, fr.h));
        xyz.push(col);
        const first = col[1] ?? fr.F;
        implied.push(
            filletImpliedSeamDeg(
                { n: Math.hypot(fr.T0.x, fr.T0.y), z: fr.T0.z },
                { n: Math.hypot(first.x - fr.R.x, first.y - fr.R.y), z: first.z - fr.R.z },
            ),
        );
        const nxt = frames[(i + 1) % frames.length]!;
        maxTiltStep = Math.max(maxTiltStep, (Math.abs(nxt.leanRad - fr.leanRad) * 180) / Math.PI);
    }
    for (let i = 0; i < frames.length; i++) {
        const col = xyz[i]!;
        const fr = frames[i]!;
        fr.arcEndZ = col[col.length - 2]?.z ?? fr.B.z;
    }
    assertT0ClearsSheet(frames);
    reportLeanVsBio(frames, defaults, flare);
    const bad: Array<{ i: number; u: number; off: number; side: number }> = [];
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const col = xyz[i]!;
        const nRnd = fr.nRoundFix || fr.roundRows || 0;
        const nLn = fr.nLineFix || 0;
        let off = 0;
        for (let k = 1; k <= nRnd && k < col.length - 1; k++) {
            off = Math.max(off, offPlaneNormalMm(col[k]!, fr.R, fr.nRoundPlane));
        }
        const fIdx = nRnd + nLn;
        for (let k = fIdx + 1; k < col.length - 1; k++) {
            if (!pointPastF(col[k]!, fr.E, fr.F)) continue;
            off = Math.max(off, offPlaneNormalMm(col[k]!, fr.B, fr.nFilPlane));
        }
        const side = offPlaneMm(col[col.length - 1]!, fr.B, fr.h);
        if (off > COLUMN_PLANARITY_LIMIT_MM) {
            bad.push({ i, u: Number(fr.u.toFixed(4)), off, side });
        }
    }
    if (bad.length) {
        throw new Error(`[S1-COL] off-plane\n${JSON.stringify({ n: bad.length, sample: bad.slice(0, 8) })}`);
    }
    const quality = columnProfileQuality(xyz, frames);
    quality.nRoundSetter = piece.setter;
    quality.nRoundSetterU = piece.setterU;
    quality.nRoundCollapsedSkipped = piece.collapsedSkipped;
    console.log(
        "[S1-COL-Q]",
        JSON.stringify({
            maxAlong: Number(quality.maxAlongJointDeg.toFixed(2)),
            maxTcol: Number(quality.maxTcolDeg.toFixed(1)),
            reversals: quality.reversals,
            tColHits: quality.tColBoundHits,
            alongOver: quality.alongOverBudget,
            maxAcross: Number(quality.maxAcrossDeg.toFixed(2)),
            topRound: Number(quality.maxTopRoundDeg.toFixed(2)),
            roundWall: Number(quality.maxRoundWallDeg.toFixed(2)),
            minEdge: Number(quality.minEdgeMm.toFixed(4)),
            gapMult: Number(quality.maxStationGapMult.toFixed(2)),
            minL: Number(quality.minLineMm.toFixed(3)),
            nTopDeg: Number(quality.maxNTopChangeDeg.toFixed(2)),
            r1Pct: Number(quality.maxR1ChangePct.toFixed(2)),
            r2Pct: Number(quality.maxR2ChangePct.toFixed(2)),
            r1Mm: Number(quality.maxR1ChangeMm.toFixed(4)),
            r2Mm: Number(quality.maxR2ChangeMm.toFixed(4)),
            alaPack: Number(quality.maxAlaPackMm.toFixed(3)),
            chordLocal: Number(quality.minLastChordOverLocal.toFixed(3)),
            roundStep: Number(quality.maxRoundStepDeg.toFixed(2)),
            startInc: Number(quality.maxStartIncidentDeg.toFixed(2)),
            filChord: Number(quality.minFilletChordOverCMin.toFixed(3)),
        }),
    );
    return {
        xyz,
        impliedSeamDeg: implied,
        planReversals: countColumnPlanReversals(xyz),
        maxFrameAngleDeg: maxTiltStep,
        maxOffPlaneMm: maxOff,
        maxSidewaysMm: maxSide,
        frames,
        flareDeg: frames.map((f) => (f.leanRad * 180) / Math.PI),
        flareCapReport: report,
        minWallClamps,
        quality,
        nRoundReport: piece,
        smoothLog,
    };
}

/** Wrap φ1 to [0, 2π). Same point as φ+2πk; does not mirror across eN. */
export function canonicalRoundPhi(phi: number): number {
    let t = phi;
    const twopi = Math.PI * 2;
    while (t < 0) t += twopi;
    while (t >= twopi) t -= twopi;
    return t;
}

function unwrapClosedRad(phis: number[]): number[] {
    if (phis.length === 0) return [];
    const out = [phis[0]!];
    for (let i = 1; i < phis.length; i++) {
        let t = phis[i]!;
        const prev = out[i - 1]!;
        while (t - prev > Math.PI) t -= Math.PI * 2;
        while (t - prev < -Math.PI) t += Math.PI * 2;
        out.push(t);
    }
    return out;
}

/** Smooth φ1 along the R ring (σ 12 mm), then re-solve each ruling with φ1 locked. */
export function smoothRoundEndAngles(frames: ColumnFrame[], sigma = SCALAR_SMOOTH_SIGMA_MM): void {
    if (frames.length < 3) return;
    for (const fr of frames) {
        fr.phiRound1Lock = undefined;
        applyAlaToFrame(fr);
    }
    const raw = unwrapClosedRad(frames.map((f) => f.phiRound1));
    const sm = periodicGaussian(
        raw,
        frames.map((f) => f.R),
        sigma,
    );
    let rawMin = Infinity;
    let rawMax = -Infinity;
    let smMin = Infinity;
    let smMax = -Infinity;
    let maxDeltaDeg = 0;
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        let delta = sm[i]! - raw[i]!;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const lock = raw[i]! + delta;
        fr.phiRound1Lock = lock;
        fr.phiRound1 = lock;
        rawMin = Math.min(rawMin, raw[i]!);
        rawMax = Math.max(rawMax, raw[i]!);
        smMin = Math.min(smMin, lock);
        smMax = Math.max(smMax, lock);
        maxDeltaDeg = Math.max(maxDeltaDeg, (Math.abs(delta) * 180) / Math.PI);
        applyAlaToFrame(fr);
        fr.phiRound1Lock = fr.phiRound1;
    }
    console.log(
        "[S1-PHI1]",
        JSON.stringify({
            n: frames.length,
            rawDeg: [
                Number(((rawMin * 180) / Math.PI).toFixed(2)),
                Number(((rawMax * 180) / Math.PI).toFixed(2)),
            ],
            lockDeg: [
                Number(((smMin * 180) / Math.PI).toFixed(2)),
                Number(((smMax * 180) / Math.PI).toFixed(2)),
            ],
            maxDeltaDeg: Number(maxDeltaDeg.toFixed(2)),
        }),
    );
}

function ringTurningDeg(pts: XYZ[]): number {
    const n = pts.length;
    if (n < 3) return 0;
    let max = 0;
    for (let i = 0; i < n; i++) {
        const a = pts[(i + n - 1) % n]!;
        const b = pts[i]!;
        const c = pts[(i + 1) % n]!;
        const t0 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
        const t1 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
        if (hypot3(t0) < 1e-9 || hypot3(t1) < 1e-9) continue;
        max = Math.max(max, vecAngleDeg(t0, t1));
    }
    return max;
}

function signedFaceFoldDeg(nL: XYZ, nR: XYZ, edge: XYZ): number {
    const cr = cross3(nL, nR);
    const signed = Math.sign(dot3(cr, edge) || 1) * vecAngleDeg(nL, nR);
    return signed;
}

function signedJointDeg(a: XYZ, b: XYZ, binormal: XYZ): number {
    const ua = unit3(a);
    const ub = unit3(b);
    const cr = cross3(ua, ub);
    const s = Math.atan2(dot3(cr, binormal), dot3(ua, ub));
    return (s * 180) / Math.PI;
}

function reportLeanVsBio(frames: ColumnFrame[], defaults: WallRegionDefaults, _bioFlare: number[]): void {
    const sign = defaults.medialYSign ?? 1;
    const buckets: Record<string, { sum: number; n: number; rec: number; min: number; max: number }> = {
        heel: { sum: 0, n: 0, rec: FLARE_BOUNDS.heelPosterior.recommended, min: 10, max: 35 },
        heelMedial: { sum: 0, n: 0, rec: FLARE_BOUNDS.heelMedial.recommended, min: 10, max: 35 },
        heelLateral: { sum: 0, n: 0, rec: FLARE_BOUNDS.heelLateral.recommended, min: 10, max: 35 },
        medialArch: { sum: 0, n: 0, rec: FLARE_BOUNDS.medialArch.recommended, min: 10, max: 35 },
        lateralMidfoot: { sum: 0, n: 0, rec: FLARE_BOUNDS.lateralMidfoot.recommended, min: 15, max: 50 },
    };
    for (const f of frames) {
        const lean = (f.leanRad * 180) / Math.PI;
        const medial = f.B.y * sign >= 0;
        if (f.u < 0.22) {
            buckets.heel!.sum += lean;
            buckets.heel!.n++;
            if (medial) {
                buckets.heelMedial!.sum += lean;
                buckets.heelMedial!.n++;
            } else {
                buckets.heelLateral!.sum += lean;
                buckets.heelLateral!.n++;
            }
        } else if (f.u < 0.6) {
            if (medial) {
                buckets.medialArch!.sum += lean;
                buckets.medialArch!.n++;
            } else {
                buckets.lateralMidfoot!.sum += lean;
                buckets.lateralMidfoot!.n++;
            }
        }
    }
    const rows = Object.entries(buckets).map(([region, b]) => {
        const mean = b.n ? b.sum / b.n : 0;
        return {
            region,
            n: b.n,
            lean: Number(mean.toFixed(1)),
            bio: b.rec,
            delta: Number((mean - b.rec).toFixed(1)),
            inBound: mean >= b.min && mean <= b.max,
        };
    });
    console.log("[S1-LEAN]", JSON.stringify(rows));
}

function lastRowAcrossDeg(xyz: XYZ[][], i: number): number {
    const nS = xyz.length;
    const col = xyz[i]!;
    const nxt = xyz[(i + 1) % nS]!;
    const prv = xyz[(i + nS - 1) % nS]!;
    const j = Math.min(col.length, nxt.length, prv.length) - 2;
    if (j < 0) return 0;
    const nL = faceN3(prv[j]!, col[j]!, col[j + 1]!);
    const nR = faceN3(col[j]!, nxt[j]!, col[j + 1]!);
    if (!nL || !nR) return 0;
    return vecAngleDeg(nL, nR);
}

export function slideLastFilletOnColumn(
    col: XYZ[],
    B: XYZ,
    R: XYZ,
    h: { x: number; y: number },
    stationSpacing: number,
    project: boolean,
): boolean {
    const minLast = FILLET_LAST_ROW_FRAC * stationSpacing;
    if (col.length < 4) return false;
    const prev2 = col[col.length - 3]!;
    const last = col[col.length - 2]!;
    if (dist3(last, B) >= minLast) return false;
    const Bref = project ? projectToPlane(B, R, h) : B;
    const span = dist3(prev2, Bref);
    if (span < minLast + 1e-9) return false;
    const vx = prev2.x - Bref.x;
    const vy = prev2.y - Bref.y;
    const vz = prev2.z - Bref.z;
    const L = Math.hypot(vx, vy, vz) || 1;
    let slid: XYZ = {
        x: Bref.x + (vx / L) * minLast,
        y: Bref.y + (vy / L) * minLast,
        z: Bref.z + (vz / L) * minLast,
    };
    if (project) slid = projectToPlane(slid, R, h);
    if (dist3(prev2, slid) < MIN_EDGE_MM) return false;
    col[col.length - 2] = slid;
    return true;
}

function lastAlongDeg(col: XYZ[], fr: ColumnFrame, j: number): number {
    if (j < 1 || j >= col.length - 1) return 0;
    const bin = unit3({ x: -fr.h.y, y: fr.h.x, z: 0 });
    const t0 = {
        x: col[j]!.x - col[j - 1]!.x,
        y: col[j]!.y - col[j - 1]!.y,
        z: col[j]!.z - col[j - 1]!.z,
    };
    const t1 = {
        x: col[j + 1]!.x - col[j]!.x,
        y: col[j + 1]!.y - col[j]!.y,
        z: col[j + 1]!.z - col[j]!.z,
    };
    if (hypot3(t0) < ALONG_JOINT_MIN_EDGE_MM || hypot3(t1) < ALONG_JOINT_MIN_EDGE_MM) return 0;
    return Math.abs(signedJointDeg(t0, t1, bin));
}

/** Keep nJ; slide the last interior away from B so the last row is ≥ 0.15× spacing. */
export function ensureLastFilletRowHeight(xyz: XYZ[][], frames: ColumnFrame[], stationSpacing: number): void {
    const nS = xyz.length;
    const saved = xyz.map((col) => (col.length >= 2 ? { ...col[col.length - 2]! } : null));
    const slidAt = new Array<boolean>(nS).fill(false);
    for (let i = 0; i < nS; i++) {
        const col = xyz[i]!;
        const fr = frames[i]!;
        if (col.length < 4) continue;
        if (fr.shortChord || fr.heightMm < SHORT_WALL_H_MM) continue;
        slidAt[i] = slideLastFilletOnColumn(col, col[col.length - 1]!, fr.R, fr.h, stationSpacing, true);
    }
    for (let i = 0; i < nS; i++) {
        if (!slidAt[i] || !saved[i]) continue;
        const col = xyz[i]!;
        const fr = frames[i]!;
        const across = Math.max(lastRowAcrossDeg(xyz, i), lastRowAcrossDeg(xyz, (i + nS - 1) % nS));
        const along = Math.max(lastAlongDeg(col, fr, col.length - 2), lastAlongDeg(col, fr, col.length - 3));
        if (across > ACROSS_STATION_MAX_DEG || along > ALONG_JOINT_MAX_DEG) {
            col[col.length - 2] = saved[i]!;
        }
    }
}

function densifyColumnsByAlong(xyz: XYZ[][], frames: ColumnFrame[], maxDeg: number): void {
    const nS = xyz.length;
    if (nS === 0 || !xyz[0] || xyz[0].length < 4) return;
    for (let pass = 0; pass < 8; pass++) {
        let worstI = 0;
        let worstJ = -1;
        let worst = 0;
        for (let i = 0; i < nS; i++) {
            const col = xyz[i]!;
            const fr = frames[i]!;
            const bin = unit3({ x: -fr.h.y, y: fr.h.x, z: 0 });
            for (let j = 1; j < col.length - 1; j++) {
                const t0 = {
                    x: col[j]!.x - col[j - 1]!.x,
                    y: col[j]!.y - col[j - 1]!.y,
                    z: col[j]!.z - col[j - 1]!.z,
                };
                const t1 = {
                    x: col[j + 1]!.x - col[j]!.x,
                    y: col[j + 1]!.y - col[j]!.y,
                    z: col[j + 1]!.z - col[j]!.z,
                };
                if (hypot3(t0) < ALONG_JOINT_MIN_EDGE_MM || hypot3(t1) < ALONG_JOINT_MIN_EDGE_MM) continue;
                const deg = Math.abs(signedJointDeg(t0, t1, bin));
                if (deg > worst) {
                    worst = deg;
                    worstI = i;
                    worstJ = j;
                }
            }
        }
        if (worst <= maxDeg + 1e-3 || worstJ < 1) return;
        const col0 = xyz[worstI]!;
        const d0 = dist3(col0[worstJ - 1]!, col0[worstJ]!);
        const d1 = dist3(col0[worstJ]!, col0[worstJ + 1]!);
        const splitAfter = d1 >= d0;
        for (let i = 0; i < xyz.length; i++) {
            const col = xyz[i]!;
            const fr = frames[i]!;
            const a = splitAfter ? col[worstJ]! : col[worstJ - 1]!;
            const b = splitAfter ? col[worstJ + 1]! : col[worstJ]!;
            const mid = projectToPlane(
                { x: 0.5 * (a.x + b.x), y: 0.5 * (a.y + b.y), z: 0.5 * (a.z + b.z) },
                fr.R,
                fr.h,
            );
            col.splice(splitAfter ? worstJ + 1 : worstJ, 0, mid);
        }
    }
}

/** Angle between the arc tangent at `last` and the chord last→B (dL/2 on a circle). */
function lastChordRiseDeg(prev: XYZ, last: XYZ, B: XYZ, planeN: XYZ, chord: XYZ): number | null {
    const C = circumcenter3(prev, last, B);
    const bin = hypot3(planeN) > 1e-12 ? unit3(planeN) : { x: 0, y: 0, z: 1 };
    let tan: XYZ;
    if (C) {
        const radial = { x: last.x - C.x, y: last.y - C.y, z: last.z - C.z };
        tan = cross3(radial, bin);
        if (hypot3(tan) < 1e-12) tan = cross3(bin, radial);
    } else {
        tan = { x: last.x - prev.x, y: last.y - prev.y, z: last.z - prev.z };
    }
    if (hypot3(tan) < 1e-12 || hypot3(chord) < 1e-12) return null;
    if (dot3(tan, chord) < 0) tan = { x: -tan.x, y: -tan.y, z: -tan.z };
    return vecAngleDeg(tan, chord);
}

function circumcenter3(a: XYZ, b: XYZ, c: XYZ): XYZ | null {
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const n = cross3(ab, ac);
    const n2 = dot3(n, n);
    if (n2 < 1e-16) return null;
    const ab2 = dot3(ab, ab);
    const ac2 = dot3(ac, ac);
    const t1 = scale3(cross3(n, ab), ac2);
    const t2 = scale3(cross3(ac, n), ab2);
    const inv = 1 / (2 * n2);
    return {
        x: a.x + (t1.x + t2.x) * inv,
        y: a.y + (t1.y + t2.y) * inv,
        z: a.z + (t1.z + t2.z) * inv,
    };
}

export function columnProfileQuality(xyz: XYZ[][], frames: ColumnFrame[]): ColumnQuality {
    let maxAlong = 0;
    let worstAlong = { i: -1, j: -1, u: -1, deg: 0 };
    let maxTcol = 0;
    let tColHits = 0;
    let reversals = 0;
    let alongOver = 0;
    let maxAcross = 0;
    const acrossAll: number[] = [];
    let maxTopRound = 0;
    const topRoundBand: Array<{ i: number; u: number; deg: number }> = [];
    let maxRoundWall = 0;
    let minEdge = Infinity;
    let minLine = Infinity;
    let maxNTop = 0;
    let maxR1 = 0;
    let maxR2 = 0;
    let maxR1Mm = 0;
    let maxR2Mm = 0;
    let maxHeading = 0;
    let maxToeRatio = 0;
    let minFore = Infinity;
    let maxPack = -Infinity;
    let maxSignedSeam = 0;
    let flippedFaces = 0;
    let minLastS = Infinity;
    let minLastH = Infinity;
    let maxBAspect = 0;
    let maxTopSheet = 0;
    let minLastChord = Infinity;
    let minLastChordOverLocal = Infinity;
    let lastChordFloorStations = 0;
    let maxChordRise = 0;
    let lastSzMono = true;
    let rowPieceIdentical = true;
    let maxAlongRow = 0;
    let worstAlongRow = { i: -1, j: -1, deg: 0 };
    let worstAspect = { i: -1, j: -1, short: 0, long: 0, ratio: 0 };
    let worstRatio = { i: -1, lo: 0, hi: 0, ratio: 0, ring: "" };
    let maxNeighbourRatioR = 0;
    let maxNeighbourRatioB = 0;
    let maxOblique = 0;
    let nObliqueWarn = 0;
    let maxG1E = 0;
    let maxG1F = 0;
    let maxAspectAll = 0;
    let maxAspectRound = 0;
    let maxSignedFold = 0;
    let nFoldsOver90 = 0;
    let inwardWallFaces = 0;
    let maxNeighbourRatio = 0;
    let maxSeamNonFb = 0;
    let maxRoundStepDeg = 0;
    let maxStartIncidentDeg = 0;
    let minFilletChordOverCMin = Infinity;
    const fallback: ObliqueFallbackRow[] = [];
    const stationSeam: number[] = [];
    let worstAcross = { i: -1, j: -1, u: -1, wrap: false, deg: 0 };
    const nS = xyz.length;
    const ds: number[] = [];
    for (let i = 0; i < nS; i++) {
        const a = frames[i]!.R;
        const b = frames[(i + 1) % nS]!.R;
        ds.push(dist3(a, b));
    }
    const sorted = ds.slice().sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 1.3;
    const maxGapMult = median > 1e-6 ? Math.max(0, ...ds) / median : 0;
    for (let i = 0; i < nS; i++) {
        const a = ds[i]!;
        const b = ds[(i + nS - 1) % nS]!;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (lo >= 2 * 0.3 - 1e-9) {
            const ratio = hi / lo;
            if (ratio > maxNeighbourRatioR) maxNeighbourRatioR = ratio;
            if (ratio > maxNeighbourRatio) {
                maxNeighbourRatio = ratio;
                worstRatio = { i, lo, hi, ratio, ring: "R" };
            }
        }
    }
    const dsB: number[] = [];
    for (let i = 0; i < nS; i++) {
        const a = frames[i]!.B;
        const b = frames[(i + 1) % nS]!.B;
        dsB.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    for (let i = 0; i < nS; i++) {
        const a = dsB[i]!;
        const b = dsB[(i + nS - 1) % nS]!;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (lo >= 2 * 0.3 - 1e-9) {
            const ratio = hi / lo;
            if (ratio > maxNeighbourRatioB) maxNeighbourRatioB = ratio;
            if (ratio > maxNeighbourRatio) {
                maxNeighbourRatio = ratio;
                worstRatio = { i, lo, hi, ratio, ring: "B" };
            }
        }
    }
    const columnCrossings = countPlanViewChordCrossings(
        frames.map((f) => f.F),
        frames.map((f) => f.E),
    );
    let bCx = 0;
    let bCy = 0;
    for (const fr of frames) {
        bCx += fr.B.x;
        bCy += fr.B.y;
    }
    bCx /= Math.max(1, nS);
    bCy /= Math.max(1, nS);
    for (let i = 0; i < nS; i++) {
        const col = xyz[i]!;
        const fr = frames[i]!;
        maxOblique = Math.max(maxOblique, fr.headingObliqueDeg ?? 0);
        if ((fr.headingObliqueDeg ?? 0) > OBLIQUE_WARN_DEG) nObliqueWarn++;
        maxG1E = Math.max(maxG1E, fr.g1EDeg ?? 0);
        maxG1F = Math.max(maxG1F, fr.g1FDeg ?? 0);
        const counts0: ColumnPieceCounts = {
            nRound: frames[0]!.nRoundFix || frames[0]!.roundRows || 0,
            nFil: frames[0]!.nFilFix || 0,
            nLine: frames[0]!.nLineFix || 0,
            nWall: xyz[0]?.length ?? 0,
        };
        if (
            col.length !== (xyz[0]?.length ?? col.length) ||
            (fr.nRoundFix || 0) !== counts0.nRound ||
            (fr.nFilFix || 0) !== counts0.nFil ||
            (fr.nLineFix || 0) !== counts0.nLine
        ) {
            rowPieceIdentical = false;
        }
        const nRnd = fr.nRoundFix || fr.roundRows || 0;
        const nLn = fr.nLineFix || 0;
        if (nRnd > 0) {
            maxRoundStepDeg = Math.max(maxRoundStepDeg, (Math.abs(fr.roundSweepRad) * 180) / Math.PI / nRnd);
        }
        const inc = fr.tInc ?? (fr.sheetPlaneN ? incidentFaceTangent(fr.sheetPlaneN, fr.h) : null);
        if (inc && col.length > 1 && dist3(col[1]!, col[0]!) >= MIN_EDGE_MM) {
            maxStartIncidentDeg = Math.max(
                maxStartIncidentDeg,
                vecAngleDeg(
                    { x: col[1]!.x - col[0]!.x, y: col[1]!.y - col[0]!.y, z: col[1]!.z - col[0]!.z },
                    inc,
                ),
            );
        }
        const cMinFil = lastFilletCMinMm(localSpacingOf(fr));
        const fil0 = nRnd + nLn;
        for (let j = fil0 + 1; j < col.length; j++) {
            const chord = dist3(col[j]!, col[j - 1]!);
            if (j === col.length - 1 && chord + 1e-9 < cMinFil) continue;
            if (cMinFil > 1e-12) minFilletChordOverCMin = Math.min(minFilletChordOverCMin, chord / cMinFil);
        }
        const pieceBin = (j: number): XYZ => {
            if (j <= nRnd) return fr.nRoundPlane;
            if (j <= nRnd + nLn) return unit3(cross3(fr.U, { x: -fr.h.y, y: fr.h.x, z: 0 }));
            return fr.nFilPlane;
        };
        const joints: number[] = [];
        for (let j = 1; j < col.length - 1; j++) {
            const t0 = {
                x: col[j]!.x - col[j - 1]!.x,
                y: col[j]!.y - col[j - 1]!.y,
                z: col[j]!.z - col[j - 1]!.z,
            };
            const t1 = {
                x: col[j + 1]!.x - col[j]!.x,
                y: col[j + 1]!.y - col[j]!.y,
                z: col[j + 1]!.z - col[j]!.z,
            };
            if (hypot3(t0) < ALONG_JOINT_MIN_EDGE_MM || hypot3(t1) < ALONG_JOINT_MIN_EDGE_MM) continue;
            const bin = pieceBin(j);
            const deg = hypot3(bin) > 1e-9 ? signedJointDeg(t0, t1, unit3(bin)) : vecAngleDeg(t0, t1);
            joints.push(deg);
            const lastFilletJoint = j >= col.length - 9;
            const absDeg = Math.abs(deg);
            if (!lastFilletJoint && absDeg > maxAlong) {
                maxAlong = absDeg;
                worstAlong = { i, j, u: Number(fr.u.toFixed(4)), deg: Number(absDeg.toFixed(2)) };
            }
            if (j === 1) {
                const first = unit3(t0);
                const topEdge = vecAngleDeg(fr.T0, first);
                maxTopRound = Math.max(maxTopRound, topEdge);
                maxTopSheet = Math.max(maxTopSheet, topEdge);
                maxAlong = Math.max(maxAlong, topEdge);
                if (topEdge > ALONG_JOINT_MAX_DEG + 1e-6) alongOver++;
                if (fr.u >= 0.4 && fr.u <= 0.54) {
                    topRoundBand.push({
                        i,
                        u: Number(fr.u.toFixed(4)),
                        deg: Number(topEdge.toFixed(2)),
                    });
                }
            }
            if (nRnd && j === nRnd) {
                maxRoundWall = Math.max(maxRoundWall, fr.g1EDeg ?? absDeg);
            }
        }
        for (let j = 1; j < col.length; j++) {
            minEdge = Math.min(minEdge, dist3(col[j]!, col[j - 1]!));
        }
        let sign = 0;
        for (const d of joints) {
            if (Math.abs(d) < 8) continue;
            const s = d > 0 ? 1 : -1;
            if (sign === 0) sign = s;
            else if (s !== sign) reversals++;
        }
        const tCol = joints.reduce((s, d) => s + Math.abs(d), 0);
        maxTcol = Math.max(maxTcol, tCol);
        const sheetDeg = fr.sheetSlopeValid ? Math.abs((fr.sheetSlopeRad * 180) / Math.PI) : 0;
        const designedSweep = (Math.abs(fr.roundSweepRad) + Math.abs(fr.filletSweepRad)) * (180 / Math.PI);
        const bound = designedSweep * ALONG_JOINT_BUDGET_FRAC + sheetDeg + T_COL_SLACK_DEG;
        if (tCol > bound + 1e-6) tColHits++;
        const budget = Math.max(
            ALONG_JOINT_MAX_DEG,
            (ALONG_JOINT_BUDGET_FRAC * tCol) / Math.max(1, joints.length),
        );
        const skipLast = col.length >= 9 ? 8 : 0;
        for (let k = 0; k < joints.length - skipLast; k++) {
            if (Math.abs(joints[k]!) > budget + 1e-6) alongOver++;
        }
        minLine = Math.min(minLine, fr.lineLengthMm);
        const nxtFr = frames[(i + 1) % nS]!;
        maxNTop = Math.max(
            maxNTop,
            vecAngleDeg(fr.nTopSmoothed ?? fr.nTop, nxtFr.nTopSmoothed ?? nxtFr.nTop),
        );
        const r1den = Math.max(fr.rTop, 1e-6);
        const r2den = Math.max(fr.rFillet, 1e-6);
        maxR1 = Math.max(maxR1, (Math.abs(nxtFr.rTop - fr.rTop) / r1den) * 100);
        maxR2 = Math.max(maxR2, (Math.abs(nxtFr.rFillet - fr.rFillet) / r2den) * 100);
        maxR1Mm = Math.max(maxR1Mm, Math.abs(nxtFr.rTop - fr.rTop));
        maxR2Mm = Math.max(maxR2Mm, Math.abs(nxtFr.rFillet - fr.rFillet));
        const hd = Math.acos(Math.max(-1, Math.min(1, fr.h.x * nxtFr.h.x + fr.h.y * nxtFr.h.y)));
        maxHeading = Math.max(maxHeading, (hd * 180) / Math.PI);
        const minL = fr.heightMm <= SHORT_WALL_H_MM + 1e-9 ? SHORT_MIN_L_MM : MIN_LINE_MM;
        const pack = fr.rTop + fr.rFillet + minL - fr.heightMm;
        maxPack = Math.max(maxPack, pack);
        if (fr.u >= 0.76) {
            minFore = Math.min(minFore, Math.hypot(fr.B.x - fr.R.x, fr.B.y - fr.R.y));
            const ext = Math.max(1e-3, Math.hypot(fr.B.x - fr.R.x, fr.B.y - fr.R.y));
            const gap = Math.hypot(nxtFr.B.x - fr.B.x, nxtFr.B.y - fr.B.y);
            maxToeRatio = Math.max(maxToeRatio, gap / ext);
        }
        if (nS < 2 || !xyz[(i + 1) % nS] || col.length < 2) continue;
        const nxt = xyz[(i + 1) % nS]!;
        const prv = xyz[(i + nS - 1) % nS]!;
        const rows = Math.min(col.length, nxt.length, prv.length);
        for (let j = 0; j < rows - 1; j++) {
            const nL = faceN3(prv[j]!, col[j]!, col[j + 1]!);
            const nR = faceN3(col[j]!, nxt[j]!, col[j + 1]!);
            if (!nL || !nR) continue;
            const e0 = dist3(col[j]!, nxt[j]!);
            const e1 = dist3(nxt[j]!, nxt[j + 1]!);
            const e2 = dist3(nxt[j + 1]!, col[j + 1]!);
            const e3 = dist3(col[j + 1]!, col[j]!);
            const shortAcross = Math.min(e0, e1, e2, e3);
            const cMinAcross = lastFilletCMinMm(fr.localSpacingMm || fr.stationSpacingMm || median);
            if (shortAcross < cMinAcross) continue;
            const edgeAcross = {
                x: nxt[j]!.x - col[j]!.x,
                y: nxt[j]!.y - col[j]!.y,
                z: nxt[j]!.z - col[j]!.z,
            };
            const foldAcross = signedFaceFoldDeg(nL, nR, edgeAcross);
            maxSignedFold = Math.max(maxSignedFold, foldAcross);
            if (foldAcross > SIGNED_FOLD_MAX_DEG + 1e-6) nFoldsOver90++;
            const raw = vecAngleDeg(nL, nR);
            acrossAll.push(raw);
            if (raw > maxAcross) {
                maxAcross = raw;
                worstAcross = {
                    i,
                    j,
                    u: Number(fr.u.toFixed(4)),
                    wrap: i === nS - 1,
                    deg: Number(raw.toFixed(2)),
                };
            }
            if (dot3(nL, nR) < 0) flippedFaces++;
            {
                const midX = 0.5 * (col[j]!.x + nxt[j]!.x);
                const midY = 0.5 * (col[j]!.y + nxt[j]!.y);
                const outX = midX - bCx;
                const outY = midY - bCy;
                const outL = Math.hypot(outX, outY) || 1;
                const wallish = (n: XYZ): boolean => Math.abs(n.z) < 0.85 && Math.hypot(n.x, n.y) > 0.25;
                if (wallish(nL) && (nL.x * outX + nL.y * outY) / outL > 0) inwardWallFaces++;
                if (wallish(nR) && (nR.x * outX + nR.y * outY) / outL > 0) inwardWallFaces++;
            }
            const shortE = shortAcross;
            const longE = Math.max(e0, e1, e2, e3);
            const cMinI = cMinAcross;
            if (shortE >= cMinI) {
                const aspect = longE / shortE;
                if (j < nRnd) {
                    if (aspect > maxAspectRound) {
                        maxAspectRound = aspect;
                        if (aspect > maxAspectAll) {
                            worstAspect = { i, j, short: shortE, long: longE, ratio: aspect };
                        }
                    }
                } else if (j > nRnd && j < nRnd + nLn) {
                    // Line interior only. Round|line and reserved fillet rings have a
                    // δ/2 first/last chord that is a sampling artifact, not a wall face.
                    if (aspect > maxAspectAll) {
                        maxAspectAll = aspect;
                        worstAspect = { i, j, short: shortE, long: longE, ratio: aspect };
                    }
                }
            }
        }
        const lineLo = nRnd + 1;
        const lineHi = nRnd + nLn - 1;
        const kinkRows = new Set([nRnd, nRnd + nLn, nRnd + nLn + 1, nRnd + nLn + 2]);
        for (let j = 1; j < rows; j++) {
            const isLine = j >= lineLo && j <= lineHi;
            const isKinkRow = kinkRows.has(j);
            if (!isLine && !isKinkRow) continue;
            const a = col[j]!;
            const b = nxt[j]!;
            const below = j + 1 < rows ? faceN3(a, b, col[j + 1]!) : null;
            const above = faceN3(b, a, col[j - 1]!);
            if (!below || !above) continue;
            const fold = vecAngleDeg(below, above);
            const raw = Math.min(fold, 180 - fold);
            const edgeAlong = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
            const signedAlong = signedFaceFoldDeg(below, above, edgeAlong);
            if (isLine) {
                maxSignedFold = Math.max(maxSignedFold, signedAlong);
                if (signedAlong > SIGNED_FOLD_MAX_DEG + 1e-6) nFoldsOver90++;
                if (raw > maxAlongRow) {
                    maxAlongRow = raw;
                    worstAlongRow = { i, j, deg: raw };
                }
            }
            if (isKinkRow && raw > ALONG_JOINT_MAX_DEG + 1e-6) {
                const prvFr = frames[(i + nS - 1) % nS]!;
                console.log(
                    "[S1-LINE-KINK]",
                    JSON.stringify({
                        i,
                        j,
                        u: Number(fr.u.toFixed(4)),
                        deg: Number(raw.toFixed(2)),
                        U: {
                            x: Number(fr.U.x.toFixed(4)),
                            y: Number(fr.U.y.toFixed(4)),
                            z: Number(fr.U.z.toFixed(4)),
                        },
                        dUPrev: Number(vecAngleDeg(fr.U, prvFr.U).toFixed(2)),
                        dUNext: Number(vecAngleDeg(fr.U, nxtFr.U).toFixed(2)),
                    }),
                );
            }
        }
        if (col.length >= 2) {
            const last = col[col.length - 2]!;
            const B = col[col.length - 1]!;
            minLastS = Math.min(minLastS, lastFilletSOutboard(last, B, fr.nB ?? fr.h));
            minLastH = Math.min(minLastH, last.z - B.z, dist3(last, B));
            const lastChord = dist3(last, B);
            const cMinB = lastFilletCMinMm(localSpacingOf(fr));
            const reservedLast = lastChord + 1e-9 < cMinB;
            minLastChord = Math.min(minLastChord, lastChord);
            minLastChordOverLocal = Math.min(minLastChordOverLocal, lastChord / Math.max(cMinB, 1e-9));
            if (fr.chordFloor || reservedLast) lastChordFloorStations++;
            if (col.length >= 3) {
                const prev = col[col.length - 3]!;
                const chord = { x: B.x - last.x, y: B.y - last.y, z: B.z - last.z };
                const rise = lastChordRiseDeg(prev, last, B, fr.nFilPlane, chord);
                if (rise != null) maxChordRise = Math.max(maxChordRise, rise);
                const nSdir = fr.nB ?? fr.h;
                const sOf = (p: XYZ): number => (p.x - fr.B.x) * nSdir.x + (p.y - fr.B.y) * nSdir.y;
                const s0 = sOf(prev);
                const s1 = sOf(last);
                const s2 = sOf(B);
                const z0 = prev.z;
                const z1 = last.z;
                const z2 = B.z;
                const sMono = (s0 < s1 && s1 < s2) || (s0 > s1 && s1 > s2);
                const zMono = (z0 < z1 && z1 < z2) || (z0 > z1 && z1 > z2);
                if (!reservedLast && (!sMono || !zMono)) lastSzMono = false;
            }
            const nxtB = nxt[nxt.length - 1]!;
            const a1 = dist3(last, B);
            const a2 = dist3(B, nxtB);
            const a3 = dist3(last, nxt[nxt.length - 2] ?? last);
            const short = Math.min(a1, a2, a3);
            const long = Math.max(a1, a2, a3);
            if (short >= cMinB) maxBAspect = Math.max(maxBAspect, long / short);
            // Plantar vs wall across B–nxtB against the posted plantar face.
            const nWallSeam = faceN3(last, B, nxtB);
            const inn = fr.nB ?? fr.h;
            const posted = fr.nPlantar;
            const step = { x: inn.x, y: inn.y, z: 0 };
            const inward = posted
                ? add3(B, {
                      x: step.x - posted.x * (step.x * posted.x + step.y * posted.y),
                      y: step.y - posted.y * (step.x * posted.x + step.y * posted.y),
                      z: -posted.z * (step.x * posted.x + step.y * posted.y),
                  })
                : { x: B.x + inn.x, y: B.y + inn.y, z: B.z };
            const nPlantFace = faceN3(nxtB, B, inward);
            if (nWallSeam && nPlantFace) {
                const cr = cross3(nPlantFace, nWallSeam);
                const edge = { x: nxtB.x - B.x, y: nxtB.y - B.y, z: nxtB.z - B.z };
                const signed = Math.sign(dot3(cr, edge) || 1) * vecAngleDeg(nPlantFace, nWallSeam);
                const absSeam = Math.abs(signed);
                maxSignedSeam = Math.max(maxSignedSeam, absSeam);
                stationSeam[i] = Math.max(stationSeam[i] ?? 0, absSeam);
                if (fr.obliqueFallback) {
                    fallback.push({
                        i,
                        u: Number(fr.u.toFixed(4)),
                        obliqueDeg: Number((fr.headingObliqueDeg ?? 0).toFixed(2)),
                        seamDeg: Number(absSeam.toFixed(2)),
                        g1EDeg: Number((fr.g1EDeg ?? 0).toFixed(2)),
                        g1FDeg: Number((fr.g1FDeg ?? 0).toFixed(2)),
                    });
                } else {
                    maxSeamNonFb = Math.max(maxSeamNonFb, absSeam);
                }
            }
        }
    }
    const maxETurning = ringTurningDeg(frames.map((f) => f.E));
    const maxFTurning = ringTurningDeg(frames.map((f) => f.F));
    acrossAll.sort((a, b) => a - b);
    const p99Idx = acrossAll.length
        ? Math.max(0, Math.min(acrossAll.length - 1, Math.ceil(0.99 * acrossAll.length) - 1))
        : 0;
    const maxAcrossP99 = acrossAll[p99Idx] ?? 0;
    console.log("[S1-ALONG]", JSON.stringify(worstAlong));
    console.log("[S1-ALONG-ROW]", JSON.stringify(worstAlongRow));
    const bandMax = topRoundBand.reduce((m, r) => Math.max(m, r.deg), 0);
    console.log(
        "[S1-TOP-ROUND]",
        JSON.stringify({
            n: topRoundBand.length,
            max: Number(bandMax.toFixed(2)),
            band: topRoundBand,
        }),
    );
    console.log("[S1-ASPECT]", JSON.stringify(worstAspect));
    console.log("[S1-RATIO]", JSON.stringify(worstRatio));
    console.log("[S1-ACROSS]", JSON.stringify({ ...worstAcross, p99: Number(maxAcrossP99.toFixed(2)) }));
    console.log(
        "[S1-BSEAM]",
        JSON.stringify({
            signed: Number(maxSignedSeam.toFixed(2)),
            flipped: flippedFaces,
            minS: Number((Number.isFinite(minLastS) ? minLastS : 0).toFixed(3)),
            minH: Number((Number.isFinite(minLastH) ? minLastH : 0).toFixed(3)),
            aspectB: Number(maxBAspect.toFixed(2)),
            topSheet: Number(maxTopSheet.toFixed(2)),
            nRows: xyz[0]?.length ?? 0,
            lastChord: Number((Number.isFinite(minLastChord) ? minLastChord : 0).toFixed(3)),
            chordFloor: lastChordFloorStations,
            chordRise: Number(maxChordRise.toFixed(2)),
            szMono: lastSzMono,
            rowPiece: rowPieceIdentical,
            alongRow: Number(maxAlongRow.toFixed(2)),
            oblique: Number(maxOblique.toFixed(1)),
            obliqueWarn: nObliqueWarn,
            g1E: Number(maxG1E.toFixed(2)),
            g1F: Number(maxG1F.toFixed(2)),
            aspectAll: Number(maxAspectAll.toFixed(2)),
            aspectRound: Number(maxAspectRound.toFixed(2)),
            neighbourRatio: Number(maxNeighbourRatio.toFixed(2)),
            neighbourRatioB: Number(maxNeighbourRatioB.toFixed(2)),
            neighbourRatioR: Number(maxNeighbourRatioR.toFixed(2)),
            colCross: columnCrossings,
            eTurn: Number(maxETurning.toFixed(2)),
            fTurn: Number(maxFTurning.toFixed(2)),
            fold: Number(maxSignedFold.toFixed(2)),
            folds90: nFoldsOver90,
            inward: inwardWallFaces,
            seamNonFb: Number(maxSeamNonFb.toFixed(2)),
            fallback: fallback.length,
            roundStep: Number(maxRoundStepDeg.toFixed(2)),
            startInc: Number(maxStartIncidentDeg.toFixed(2)),
            filChord: Number(
                (Number.isFinite(minFilletChordOverCMin) ? minFilletChordOverCMin : 0).toFixed(3),
            ),
        }),
    );
    if (fallback.length) {
        console.log("[S1-FALLBACK]", JSON.stringify(fallback.slice(0, 24)));
    }
    return {
        maxAlongJointDeg: maxAlong,
        maxTcolDeg: maxTcol,
        tColBoundHits: tColHits,
        reversals,
        alongOverBudget: alongOver,
        maxAcrossDeg: maxAcross,
        maxAcrossP99Deg: maxAcrossP99,
        maxTopRoundDeg: maxTopRound,
        maxRoundWallDeg: maxRoundWall,
        minEdgeMm: Number.isFinite(minEdge) ? minEdge : 0,
        maxStationGapMult: maxGapMult,
        minLineMm: Number.isFinite(minLine) ? minLine : 0,
        maxNTopChangeDeg: maxNTop,
        maxR1ChangePct: maxR1,
        maxR2ChangePct: maxR2,
        maxR1ChangeMm: maxR1Mm,
        maxR2ChangeMm: maxR2Mm,
        minLastChordOverLocal: Number.isFinite(minLastChordOverLocal) ? minLastChordOverLocal : 1,
        lastChordFloorStations,
        lastChordFloorFrac: nS > 0 ? lastChordFloorStations / nS : 0,
        maxHeadingChangeDeg: maxHeading,
        maxToeSpacingRatio: maxToeRatio,
        minForefootInsetMm: Number.isFinite(minFore) ? minFore : 0,
        maxAlaPackMm: Number.isFinite(maxPack) ? maxPack : 0,
        maxSignedSeamDeg: maxSignedSeam,
        flippedFaces,
        minLastRowSMm: Number.isFinite(minLastS) ? minLastS : 0,
        minLastRowHeightMm: Number.isFinite(minLastH) ? minLastH : 0,
        maxBFaceAspect: maxBAspect,
        maxTopSheetEdgeDeg: maxTopSheet,
        nRows: xyz[0]?.length ?? 0,
        minLastChordMm: Number.isFinite(minLastChord) ? minLastChord : 0,
        maxChordRiseDeg: maxChordRise,
        lastSzMonotone: lastSzMono,
        stationSpacingMm: median,
        rowPieceIdentical,
        maxAlongRowDeg: maxAlongRow,
        maxObliqueDeg: maxOblique,
        nObliqueWarn,
        maxG1EDeg: maxG1E,
        maxG1FDeg: maxG1F,
        maxAspectEverywhere: maxAspectAll,
        maxAspectRound,
        maxNeighbourSpacingRatio: maxNeighbourRatio,
        maxNeighbourSpacingRatioB: maxNeighbourRatioB,
        maxNeighbourSpacingRatioR: maxNeighbourRatioR,
        columnCrossings,
        maxSignedSeamNonFallbackDeg: maxSeamNonFb,
        maxETurningDeg: maxETurning,
        maxFTurningDeg: maxFTurning,
        maxSignedFoldDeg: maxSignedFold,
        nFoldsOver90,
        inwardWallFaces,
        obliqueFallback: fallback,
        topRoundBand,
        maxRoundStepDeg,
        maxStartIncidentDeg,
        minFilletChordOverCMin: Number.isFinite(minFilletChordOverCMin) ? minFilletChordOverCMin : 1,
    };
}

function faceN3(a: XYZ, b: XYZ, c: XYZ): XYZ | null {
    const n = cross3(
        { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
        { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z },
    );
    const l = hypot3(n);
    if (l < 1e-12) return null;
    return { x: n.x / l, y: n.y / l, z: n.z / l };
}

/**
 * Floor r2 on the real last-step Δφ after every shrink/clamp. Short sweeps
 * steal from the line (arc-length fillet piece); the 1.5° row-angle cap is
 * retired. Stations that still miss C_MIN are accepted and, on the final
 * pass, logged as [S1-CHORD-FLOOR] station i, reason=chord.
 */
export function enforceLastChordFloor(frames: ColumnFrame[], logFloor = false): void {
    const floors: number[] = [];
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const Bz0 = fr.B.z;
        applyAlaToFrame(fr);
        fr.B.z = Bz0;
        fr.heightMm = Math.max(fr.R.z - fr.B.z, 0.5);
        const local = localSpacingOf(fr);
        const cMin = lastFilletCMinMm(local);
        const S = fr.filletSweepRad;
        const dL = lastFilletDLRad(S, fr.cosT);
        fr.lastDlRad = dL;
        const need = lastFilletR2MinMm(local, dL);
        const nB = fr.nB ?? fr.h;
        const nFilUse = fr.nFilFix || MIN_FILLET_RINGS;
        const evalS = (r: number): number => {
            const Uup = { x: -fr.U.x, y: -fr.U.y, z: -fr.U.z };
            return filletSweepAtR2(fr.B, nB, r, Uup, fr.E, fr.plantarSlopeRad, fr.nPlantar);
        };
        const resolved = resolveLastR2(fr.rFillet, need, evalS, fr.cosT, nFilUse);
        if (fr.rFillet + 1e-9 < resolved.r2 || fr.rFillet > resolved.r2 + 1e-9) {
            const packed = packAlaRadii(
                fr.heightMm,
                fr.rTop,
                resolved.r2,
                minLineOfHeight(fr.heightMm),
                resolved.r2,
                MIN_ROUND_R_MM,
            );
            fr.rTop = packed.r1;
            fr.rFillet = packed.r2;
            fr.lastDlRad = dL;
            if (resolved.reason) fr.chordFloorReason = resolved.reason;
            applyAlaToFrame(fr);
            fr.B.z = Bz0;
            fr.heightMm = Math.max(fr.R.z - fr.B.z, 0.5);
        } else if (resolved.reason) {
            fr.chordFloorReason = resolved.reason;
        }
        const chord = lastStepChordMm(fr.rFillet, fr.lastDlRad);
        if (chord + 1e-9 < cMin) {
            const at = fr.stationIndex ?? i;
            fr.chordFloor = true;
            fr.chordFloorReason = resolved.reason ?? fr.chordFloorReason ?? "chord";
            if (logFloor) {
                floors.push(at);
                console.log(`[S1-CHORD-FLOOR] station ${at}, reason=${fr.chordFloorReason}`);
            }
        } else {
            fr.chordFloor = false;
            if (resolved.reason !== "rows") fr.chordFloorReason = undefined;
        }
    }
    if (logFloor && floors.length) {
        console.log(
            "[S1-CHORD-FLOOR]",
            JSON.stringify({
                n: floors.length,
                stations: floors.slice(0, 24),
                frac: Number((floors.length / Math.max(frames.length, 1)).toFixed(4)),
            }),
        );
    }
}

export function clampFramesMinWall(
    frames: ColumnFrame[],
    topZ: (x: number, y: number) => number | null,
    minWallMm: number,
): MinWallClamp[] {
    const clamps: MinWallClamp[] = [];
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const Bz0 = fr.B.z;
        const top = topZ(fr.R.x, fr.R.y) ?? fr.R.z;
        const maxF = top - minWallMm;
        applyAlaToFrame(fr);
        fr.B.z = Bz0;
        fr.heightMm = Math.max(fr.R.z - fr.B.z, 0.5);
        if (fr.F.z <= maxF + 1e-9) continue;
        const drop = fr.F.z - maxF;
        const local = localSpacingOf(fr);
        const S = fr.filletSweepRad;
        const dL = lastFilletDLRad(S, fr.cosT);
        const r2Floor = lastFilletR2MinMm(local, dL);
        const nB = fr.nB ?? fr.h;
        const evalS = (r: number): number => {
            const Uup = { x: -fr.U.x, y: -fr.U.y, z: -fr.U.z };
            return filletSweepAtR2(fr.B, nB, r, Uup, fr.E, fr.plantarSlopeRad, fr.nPlantar);
        };
        const resolved = resolveLastR2(fr.rFillet, r2Floor, evalS, fr.cosT, fr.nFilFix || MIN_FILLET_RINGS);
        const packed = packAlaRadii(
            fr.heightMm,
            fr.rTop,
            resolved.r2,
            minLineOfHeight(fr.heightMm),
            resolved.r2,
            MIN_ROUND_R_MM,
        );
        fr.rTop = packed.r1;
        fr.rFillet = packed.r2;
        fr.lastDlRad = dL;
        if (resolved.reason) fr.chordFloorReason = resolved.reason;
        applyAlaToFrame(fr);
        fr.B.z = Bz0;
        fr.heightMm = Math.max(fr.R.z - fr.B.z, 0.5);
        const stillShort = fr.F.z > maxF + 1e-9;
        if (stillShort) fr.postingHeightClamp = true;
        clamps.push({
            station: i,
            u: fr.u,
            droppedMm: stillShort ? fr.F.z - maxF : drop,
            postingHeightClamp: stillShort,
        });
    }
    enforceLastChordFloor(frames);
    if (clamps.length) {
        console.log("[S1-MIN-WALL]", JSON.stringify({ n: clamps.length, sample: clamps.slice(0, 8) }));
    }
    return clamps;
}

export const U_BANDS = [
    { id: "heel", min: 0, max: 0.22 },
    { id: "arch", min: 0.22, max: 0.55 },
    { id: "midfoot", min: 0.55, max: 0.78 },
    { id: "forefoot", min: 0.78, max: 1.01 },
] as const;

export interface WallBandRow {
    band: string;
    hits: number;
    meanOverhangMm: number;
    maxOverhangMm: number;
    meanHeightMm: number;
    meanOverhangOverHeight: number;
}

export function summarizeWallBands(
    hitUs: number[],
    frames: Array<{ u: number; overhangMm: number; heightMm: number }>,
): WallBandRow[] {
    return U_BANDS.map((band) => {
        const hits = hitUs.filter((u) => u >= band.min && u < band.max).length;
        const sts = frames.filter((f) => f.u >= band.min && f.u < band.max);
        const n = Math.max(1, sts.length);
        const meanOverhangMm = sts.reduce((s, f) => s + f.overhangMm, 0) / n;
        const maxOverhangMm = sts.reduce((s, f) => Math.max(s, f.overhangMm), -Infinity);
        const meanHeightMm = sts.reduce((s, f) => s + f.heightMm, 0) / n;
        return {
            band: band.id,
            hits,
            meanOverhangMm,
            maxOverhangMm: Number.isFinite(maxOverhangMm) ? maxOverhangMm : 0,
            meanHeightMm,
            meanOverhangOverHeight: meanHeightMm > 1e-6 ? meanOverhangMm / meanHeightMm : 0,
        };
    });
}
