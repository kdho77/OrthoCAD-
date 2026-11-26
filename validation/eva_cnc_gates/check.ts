// FROZEN EVA CNC gates. Written from the grader brief and BASE behavior.
// Do not edit after the freeze commit. Grading reads this file; it does not retune it.

import { createHash } from "node:crypto";

export const BASE_SHA = "4e2e196561bada8f2a4faf4ad174a716306d8c94";
export const CANDIDATE_SHA = "3260b001686883fa74ea95b1833df42100bfc656";

export const BLOCK_WIDTH_MM = 368.3;
export const BLOCK_LENGTH_MM = 260.35;
export const EDGE_CLEARANCE_MM = 1;
export const TOOL_RADIUS_MM = 5;
export const OTHER_OUTLINE_CLEARANCE_MM = 1;
export const TOE_SLIDE_MAX_MM = 30;
/** Numerical slack for cutout-vs-own-outline vs the worst BASE passing size. */
export const OWN_ENTRY_SLACK_MM = 0.1;
/** Travel at the Idaho free-movement height is the park/transit, not a cut. */
export const SAFE_Z_MM = 49;
export const PATIENT_FIRST = "Fixture";
export const PATIENT_LAST = "Sample";

export const G1_FIXTURES = [
    { id: "sample-m9", menSize: 9, sampleTop: true },
    { id: "sample-m12", menSize: 12, sampleTop: true },
    { id: "sample-m13", menSize: 13, sampleTop: true },
    { id: "clinical-m9", menSize: 9, sampleTop: false },
] as const;

export const G2_SIZES = [13.5, 14, 15] as const;

/** Top-level create_saved_design keys on BASE. A new side/mill parameter fails G5. */
export const CREATE_SAVED_DESIGN_KEYS = [
    "external_order_id",
    "manufacturing_method",
    "client_id",
    "catalog",
    "patient_name",
    "given_name",
    "family_name",
] as const;

export const FROZEN_FEEDS = [3500, 36000, 2500, 24000] as const;
export const FROZEN_SPINDLE = 24000;

/** Idaho machining fields that define cutter, feeds, stepover, strategy, and Z. */
export const FROZEN_PROFILE = {
    id: "vertex-lab-idaho-one-side",
    strategy: "spiral",
    strategyContour: "spiral",
    tableWidthMm: 368.3,
    tableLengthMm: 260.35,
    materialHeightMm: 30,
    freeMovementHeightMm: 50,
    topOffsetMm: 2.5,
    zOffsetCorrectionMm: 0,
    extraMovementMm: -1,
    layeredMm: 15,
    stepoverBallMm: 1.4,
    stepoverFlatMm: 3,
    sampleMm: 0.25,
    chordTolMm: 0.01,
    toolDiameterMm: 10,
    toolType: "ball",
    toolRpm: 24000,
    contourDiameterMm: 10,
    contourType: "ball",
    contourRpm: 24000,
    topDip: 3500,
    topNormal: 36000,
    topSlow: 3500,
    topContour: 2500,
    bottomDip: 3500,
    bottomNormal: 24000,
    bottomSlow: 3500,
    bottomContour: 2500,
    heelDirection: "x0",
    contourEnabled: true,
} as const;

const ALLOWED_EXACT = new Set([
    "vertex/src/lib/cnc/placement.ts",
    "vertex/src/lib/cnc/envelope.ts",
    "vertex/src/lib/cnc/mill-job.ts",
    "vertex/src/lib/cnc/order-sides.ts",
    "vertex/src/lib/cnc/export.ts",
    "vertex/src/lib/cnc/compose.ts",
    "vertex/shared/export-filename.ts",
    "packages/mcp/src/shared/export-filename.ts",
    "packages/mcp/src/tools/schemas.ts",
    "packages/mcp/src/tools/handlers.ts",
    "vertex/server/src/orthocad-mcp.bundled.mjs",
    "vertex/src/lib/cnc/placement.test.ts",
    "vertex/shared/export-filename.test.ts",
    "packages/mcp/test/cnc-gcode.test.ts",
]);

const READ_ONLY = new Set([
    "tests/cnc/golden/sha.json",
    "tests/cnc/pair-layout-unchanged.test.ts",
    "vertex/src/lib/cnc/profile.ts",
    "vertex/src/lib/cnc/band.ts",
    "vertex/src/lib/cnc/contour.ts",
]);

const PASS_THROUGH_FILES = new Set(["vertex/src/lib/cnc/export.ts", "vertex/src/lib/cnc/compose.ts"]);

export function sha256(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

export function lrFilename(): string {
    return `${PATIENT_FIRST}_${PATIENT_LAST}_EVA_LR.gcode`;
}

export function singleSideFilename(millSide: "RR" | "LL"): string {
    return `${PATIENT_FIRST}_${PATIENT_LAST}_EVA_${millSide}.gcode`;
}

export interface Xy {
    x: number;
    y: number;
}

export interface Xyz extends Xy {
    z: number;
}

export interface Segment {
    a: Xyz;
    b: Xyz;
    kind: "surface" | "perimeter" | "other";
    slot: number;
}

export interface PerimeterLoop {
    slot: number;
    foot: string;
    points: Xyz[];
    minX: number;
    centroidY: number;
}

export interface ParsedProgram {
    footComment: string | null;
    toolComments: string[];
    feeds: number[];
    spindles: number[];
    segments: Segment[];
    perimeters: PerimeterLoop[];
}

export function parseProgram(gcode: string): ParsedProgram {
    let x = 0;
    let y = 0;
    let z = 0;
    let hasPos = false;
    let footComment: string | null = null;
    const toolComments: string[] = [];
    const feeds: number[] = [];
    const spindles: number[] = [];
    const segments: Segment[] = [];
    const perimeters: PerimeterLoop[] = [];
    let kind: Segment["kind"] = "other";
    let slot = -1;
    let surfaceSlot = -1;
    let perimeterSlot = -1;
    let foot = "";
    let loop: Xyz[] | null = null;

    const flushLoop = () => {
        if (!loop || loop.length === 0) {
            loop = null;
            return;
        }
        let minX = Infinity;
        let sy = 0;
        for (const p of loop) {
            if (p.x < minX) minX = p.x;
            sy += p.y;
        }
        perimeters.push({
            slot,
            foot,
            points: loop,
            minX,
            centroidY: sy / loop.length,
        });
        loop = null;
    };

    for (const raw of gcode.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith(";")) {
            const footMatch = /^;\s*foot:\s*(\S+)/.exec(line);
            if (footMatch) footComment = footMatch[1] ?? null;
            const toolMatch = /^;\s*(pass[12]-tool:.*)$/.exec(line);
            if (toolMatch?.[1]) toolComments.push(toolMatch[1]);
            const section = /^;\s*(surface|perimeter)\s+(left|right)\s*$/.exec(line);
            if (section) {
                if (kind === "perimeter") flushLoop();
                kind = section[1] === "surface" ? "surface" : "perimeter";
                foot = section[2] ?? "";
                if (kind === "surface") {
                    surfaceSlot += 1;
                    slot = surfaceSlot;
                } else {
                    perimeterSlot += 1;
                    slot = perimeterSlot;
                    loop = [];
                }
            }
            continue;
        }
        const spindle = /^M3\s+S(-?[\d.]+)/.exec(line);
        if (spindle) spindles.push(Number(spindle[1]));
        // G17/G94 must not match. Only linear moves (G0/G00/G1/G01).
        if (!/^G0+(?:\s|$)/.test(line) && !/^G0*1(?:\s|$)/.test(line)) continue;
        let nx = x;
        let ny = y;
        let nz = z;
        for (const word of line.matchAll(/([XYZF])(-?[\d.]+)/g)) {
            const value = Number(word[2]);
            if (word[1] === "X") nx = value;
            else if (word[1] === "Y") ny = value;
            else if (word[1] === "Z") nz = value;
            else if (word[1] === "F") feeds.push(value);
        }
        const a = { x, y, z };
        const b = { x: nx, y: ny, z: nz };
        x = nx;
        y = ny;
        z = nz;
        // The file's first move only establishes the machine position. There is no
        // prior cut from a synthetic (0,0,0).
        if (!hasPos) {
            hasPos = true;
            continue;
        }
        if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 1e-9) continue;
        segments.push({ a, b, kind, slot });
        if (kind === "perimeter" && loop && (line.startsWith("G1") || line.startsWith("G01"))) {
            loop.push(b);
        }
    }
    if (kind === "perimeter") flushLoop();
    return { footComment, toolComments, feeds, spindles, segments, perimeters };
}

export function cuttingSegments(program: ParsedProgram): Segment[] {
    return program.segments.filter((seg) => seg.a.z < SAFE_Z_MM || seg.b.z < SAFE_Z_MM);
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSeg(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
    return (
        Math.min(ax, bx) - 1e-9 <= cx &&
        cx <= Math.max(ax, bx) + 1e-9 &&
        Math.min(ay, by) - 1e-9 <= cy &&
        cy <= Math.max(ay, by) + 1e-9
    );
}

function segmentsIntersect(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
): boolean {
    const o1 = orient(ax, ay, bx, by, cx, cy);
    const o2 = orient(ax, ay, bx, by, dx, dy);
    const o3 = orient(cx, cy, dx, dy, ax, ay);
    const o4 = orient(cx, cy, dx, dy, bx, by);
    if (o1 * o2 < 0 && o3 * o4 < 0) return true;
    if (Math.abs(o1) <= 1e-9 && onSeg(ax, ay, bx, by, cx, cy)) return true;
    if (Math.abs(o2) <= 1e-9 && onSeg(ax, ay, bx, by, dx, dy)) return true;
    if (Math.abs(o3) <= 1e-9 && onSeg(cx, cy, dx, dy, ax, ay)) return true;
    if (Math.abs(o4) <= 1e-9 && onSeg(cx, cy, dx, dy, bx, by)) return true;
    return false;
}

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    const t = len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
    return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function segSegDist(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
): number {
    if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
    return Math.min(
        pointSegDist(ax, ay, cx, cy, dx, dy),
        pointSegDist(bx, by, cx, cy, dx, dy),
        pointSegDist(cx, cy, ax, ay, bx, by),
        pointSegDist(dx, dy, ax, ay, bx, by),
    );
}

export function pointInPoly(x: number, y: number, poly: readonly Xy[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const pi = poly[i]!;
        const pj = poly[j]!;
        const cross = pi.y > y !== pj.y > y;
        if (cross) {
            const xHit = ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;
            if (x < xHit) inside = !inside;
        }
    }
    return inside;
}

/**
 * Signed gap from the 5 mm tool disk swept along the segment to the outline curve.
 * Positive is outside the outline. Zero is tangent. Negative means the disk enters the interior.
 */
export function sweepGapMm(a: Xy, b: Xy, poly: readonly Xy[], radius = TOOL_RADIUS_MM): number {
    if (poly.length < 3) return Number.POSITIVE_INFINITY;
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % poly.length]!;
        const d = segSegDist(a.x, a.y, b.x, b.y, p.x, p.y, q.x, q.y);
        if (d < best) best = d;
    }
    if (best <= 1e-6) return -radius;
    const inside = pointInPoly(a.x, a.y, poly);
    const signed = inside ? -best : best;
    return signed - radius;
}

export function toolEdgeClearanceMm(p: Xy): number {
    const centerInset = Math.min(p.x, BLOCK_WIDTH_MM - p.x, p.y, BLOCK_LENGTH_MM - p.y);
    return centerInset - TOOL_RADIUS_MM;
}

export function minEdgeClearanceMm(segments: readonly Segment[]): number {
    let min = Infinity;
    for (const seg of segments) {
        min = Math.min(min, toolEdgeClearanceMm(seg.a), toolEdgeClearanceMm(seg.b));
    }
    return min;
}

export function minGapToOtherOutlines(
    segments: readonly Segment[],
    outlines: readonly (readonly Xy[])[],
): Map<number, number> {
    const out = new Map<number, number>();
    for (const seg of segments) {
        if (seg.slot < 0) continue;
        let gap = out.get(seg.slot);
        if (gap === undefined) gap = Infinity;
        for (let i = 0; i < outlines.length; i++) {
            if (i === seg.slot) continue;
            gap = Math.min(gap, sweepGapMm(seg.a, seg.b, outlines[i]!));
        }
        out.set(seg.slot, gap);
    }
    return out;
}

export function maxOwnEntryMm(segments: readonly Segment[], outlines: readonly (readonly Xy[])[]): number {
    let worst = 0;
    for (const seg of segments) {
        if (seg.kind !== "perimeter" || seg.slot < 0) continue;
        const outline = outlines[seg.slot];
        if (!outline) continue;
        const gap = sweepGapMm(seg.a, seg.b, outline);
        worst = Math.max(worst, Math.max(0, -gap));
    }
    return worst;
}

export function feedsOk(feeds: readonly number[]): boolean {
    const allowed = new Set<number>(FROZEN_FEEDS);
    return feeds.every((f) => allowed.has(f));
}

export function toolsOk(toolComments: readonly string[]): boolean {
    return toolComments.length >= 2 && toolComments.every((line) => line.includes("10mm ball"));
}

export function profileDiffs(actual: Record<string, unknown>): string[] {
    const diffs: string[] = [];
    for (const [key, expected] of Object.entries(FROZEN_PROFILE)) {
        if (actual[key] !== expected) diffs.push(`${key}: ${String(actual[key])} != ${String(expected)}`);
    }
    return diffs;
}

export function pathAllowed(file: string): boolean {
    if (READ_ONLY.has(file)) return false;
    if (ALLOWED_EXACT.has(file)) return true;
    if (file.startsWith("tests/cnc/")) return true;
    return false;
}

export function scopeViolations(files: readonly string[]): string[] {
    return files.filter((file) => !pathAllowed(file));
}

function changedBodies(patch: string): string[] {
    const bodies: string[] = [];
    for (const line of patch.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (!line.startsWith("+") && !line.startsWith("-")) continue;
        const body = line.slice(1).trim();
        if (body) bodies.push(body);
    }
    return bodies;
}

/** export.ts / compose.ts may only pass mill_side through. */
export function passThroughOk(patch: string): boolean {
    for (const body of changedBodies(patch)) {
        if (body.startsWith("//") || body.startsWith("*") || body.startsWith("/*")) continue;
        if (/^[{}(),;]+$/.test(body)) continue;
        if (body.startsWith("import ")) continue;
        if (!/mill|side|Side|requested/i.test(body)) return false;
        if (/(diameterMm|stepover|strategy|freeMovement|zOffset|topFeeds|bottomFeeds)\s*:/.test(body))
            return false;
    }
    return true;
}

/** schemas.ts and handlers.ts may only grow generate_cnc_gcode's mill_side. */
export function cncSchemaDiffOk(patch: string): boolean {
    for (const body of changedBodies(patch)) {
        if (/create_saved_design|createSavedDesign|persist_saved_design|persistSavedDesign/.test(body)) {
            return false;
        }
    }
    return true;
}

export function scopeFilesOk(
    files: readonly string[],
    patches: Readonly<Record<string, string>>,
): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    for (const file of scopeViolations(files)) reasons.push(`outside FILES: ${file}`);
    for (const file of files) {
        if (READ_ONLY.has(file)) reasons.push(`read-only changed: ${file}`);
    }
    for (const file of PASS_THROUGH_FILES) {
        const patch = patches[file];
        if (patch && !passThroughOk(patch)) reasons.push(`not mill_side pass-through: ${file}`);
    }
    for (const file of ["packages/mcp/src/tools/schemas.ts", "packages/mcp/src/tools/handlers.ts"]) {
        const patch = patches[file];
        if (patch && !cncSchemaDiffOk(patch))
            reasons.push(`schema/handler edit is not generate_cnc_gcode: ${file}`);
    }
    return { ok: reasons.length === 0, reasons };
}

export function createSavedDesignSideOk(keys: readonly string[]): { ok: boolean; added: string[] } {
    const frozen = new Set<string>(CREATE_SAVED_DESIGN_KEYS);
    const added = keys.filter((key) => !frozen.has(key));
    const sideish = added.filter((key) => /side|mill|foot/i.test(key));
    return { ok: sideish.length === 0, added: sideish };
}

export interface OutlineMatch {
    ok: boolean;
    meanMm: number;
    otherMm: number;
}

export function meanNearestMm(from: readonly Xy[], to: readonly Xy[]): number {
    if (from.length === 0 || to.length < 2) return Infinity;
    let sum = 0;
    for (const p of from) {
        let best = Infinity;
        for (let i = 0; i < to.length; i++) {
            const a = to[i]!;
            const b = to[(i + 1) % to.length]!;
            const d = pointSegDist(p.x, p.y, a.x, a.y, b.x, b.y);
            if (d < best) best = d;
        }
        sum += best;
    }
    return sum / from.length;
}

export function matchesOutline(
    candidate: readonly Xy[],
    expected: readonly Xy[],
    other: readonly Xy[],
): OutlineMatch {
    const meanMm = meanNearestMm(candidate, expected);
    const otherMm = meanNearestMm(candidate, other);
    return {
        ok: meanMm <= 0.25 && otherMm >= meanMm + 1,
        meanMm,
        otherMm,
    };
}

/**
 * Physical foot for a single-side job.
 * SAMPLE_Top internal left is physical right (export-filename.ts physicalSideLabel).
 */
export function expectedInternalSide(sampleTop: boolean, millSide: "RR" | "LL"): "left" | "right" {
    if (sampleTop) return millSide === "RR" ? "left" : "right";
    return millSide === "RR" ? "right" : "left";
}

export function secondSlotToeSlideMm(slot1HeelX: number, slot2HeelX: number): number {
    return slot2HeelX - slot1HeelX;
}

export interface ProofRow {
    gate: string;
    noopPass: boolean;
    badDetected: boolean;
    detail: string;
}

/** In-memory no-op and deliberately broken copies of each checker. */
export function syntheticProofs(): ProofRow[] {
    const outline: Xy[] = [
        { x: 40, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 40, y: 140 },
    ];
    const other: Xy[] = outline.map((p) => ({ x: p.x, y: p.y + 70 }));
    const safe: Segment = {
        a: { x: 30, y: 100, z: 5 },
        b: { x: 32, y: 100, z: 5 },
        kind: "perimeter",
        slot: 0,
    };
    const safeGap = sweepGapMm(safe.a, safe.b, outline);
    const edge = minEdgeClearanceMm([safe]);
    const badEdgeSeg: Segment = {
        a: { x: 2, y: 100, z: 5 },
        b: { x: 4, y: 100, z: 5 },
        kind: "perimeter",
        slot: 0,
    };
    const insideOther: Segment = {
        a: { x: 80, y: 180, z: 5 },
        b: { x: 82, y: 180, z: 5 },
        kind: "surface",
        slot: 0,
    };
    const deepOwn: Segment = {
        a: { x: 80, y: 110, z: 5 },
        b: { x: 82, y: 110, z: 5 },
        kind: "perimeter",
        slot: 0,
    };
    const goodHash = sha256("G1 X10 Y10\n");
    const badHash = sha256("G1 X10 Y11\n");
    const slideOk = secondSlotToeSlideMm(12, 20);
    const slideBad = secondSlotToeSlideMm(12, 50);
    const scopeGood = scopeFilesOk([], {});
    const scopeBad = scopeFilesOk(["vertex/src/lib/cnc/profile.ts"], {});
    const keysGood = createSavedDesignSideOk([...CREATE_SAVED_DESIGN_KEYS]);
    const keysBad = createSavedDesignSideOk([...CREATE_SAVED_DESIGN_KEYS, "side"]);
    const sameOutline = matchesOutline(outline, outline, other);
    const mirroredFail = matchesOutline(other, outline, other);

    return [
        {
            gate: "G1",
            noopPass: goodHash === sha256("G1 X10 Y10\n") && lrFilename() === "Fixture_Sample_EVA_LR.gcode",
            badDetected: goodHash !== badHash,
            detail: "byte copy vs one-byte-changed copy",
        },
        {
            gate: "G2",
            noopPass: edge >= EDGE_CLEARANCE_MM && safe.a.x >= 6,
            badDetected: minEdgeClearanceMm([badEdgeSeg]) < EDGE_CLEARANCE_MM,
            detail: `safe edge ${edge.toFixed(3)} mm; broken centerline x=2`,
        },
        {
            gate: "G3",
            noopPass: safeGap >= OTHER_OUTLINE_CLEARANCE_MM,
            badDetected: sweepGapMm(insideOther.a, insideOther.b, other) < OTHER_OUTLINE_CLEARANCE_MM,
            detail: `safe gap ${safeGap.toFixed(3)} mm; broken path inside the other outline`,
        },
        {
            gate: "G3-own",
            noopPass: maxOwnEntryMm([safe], [outline]) <= 0.05,
            badDetected: maxOwnEntryMm([deepOwn], [outline]) > 1,
            detail: "cutout tangent vs cutout through its own outline",
        },
        {
            gate: "G4",
            noopPass: slideOk <= TOE_SLIDE_MAX_MM && slideOk > 0,
            badDetected: slideBad > TOE_SLIDE_MAX_MM,
            detail: `slide ${slideOk.toFixed(2)} mm vs broken ${slideBad.toFixed(2)} mm`,
        },
        {
            gate: "G5",
            noopPass:
                keysGood.ok &&
                sameOutline.ok &&
                singleSideFilename("RR") === "Fixture_Sample_EVA_RR.gcode" &&
                expectedInternalSide(true, "RR") === "left" &&
                expectedInternalSide(false, "RR") === "right",
            badDetected: !keysBad.ok && !mirroredFail.ok,
            detail: "RR filename and physical map; broken create_saved_design side key; mirrored outline rejected",
        },
        {
            gate: "G6",
            noopPass: scopeGood.ok && profileDiffs({ ...FROZEN_PROFILE }).length === 0,
            badDetected: !scopeBad.ok,
            detail: "empty diff vs a profile.ts edit",
        },
    ];
}
