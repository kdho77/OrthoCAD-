// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeAll, describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { publishTextGuide, textFitErrorSnapshot } from "@/features/exports/text-guide-store";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { applyTextMarkingToPrintSolid } from "@/lib/geometry/text-marking/apply";
import { booleanTextSolid } from "@/lib/geometry/text-marking/boolean";
import {
    defaultTextMarking,
    TEXT_BOOLEAN_OUTSET_MM,
    TEXT_MAX_CHARS,
    TEXT_WALL_EDGE_CLEARANCE_MM,
} from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { TextMarkingError, textDoesNotFit } from "@/lib/geometry/text-marking/errors";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import {
    buildTextGuide,
    createOuterWallSampler,
    extractHostTextContext,
    measureWallFilletTopMm,
    placeWallText,
    stationsForSurface,
    type WallStation,
} from "@/lib/geometry/text-marking/place";
import { countSoupSelfIntersections } from "@/lib/geometry/text-marking/soup-intersect";
import type { FlattenedText, TextMarking } from "@/lib/geometry/text-marking/types";
import { buildWallUsableBand } from "@/lib/geometry/text-marking/wall-band";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

const JOHN = "JOHN SMITH";
/** Full patient-style name; engraving uses the same 24-character cap as the product UI. */
const MAXIMILIAN_LEGAL = "MAXIMILIAN WOLFGANG ABERNATHY-SMYTHE";
const MAXIMILIAN = MAXIMILIAN_LEGAL.slice(0, TEXT_MAX_CHARS);
const AL = "AL";
const OVERSIZED = "WWWWWWWWWWWWWWWWWWWWWWWW";

type WallCellOutcome = "place" | "textDoesNotFit";

interface WallCell {
    /** Engraving string passed to placement (≤ TEXT_MAX_CHARS). */
    text: string;
    /** Table label (may be longer than the engraved cap). */
    label: string;
    side: Side;
    size: number;
    outcome: WallCellOutcome;
    /** Nightly full matrix: carve + BVH + unmoved wall (13 cells total with booleans). */
    fullBoolean: boolean;
    /** PR-gated: carve + BVH over text bbox + 2 mm (three JOHN SMITH right-wall cells). */
    gatedBoolean: boolean;
}

/**
 * Expected outcome per name, side, and size. No padded or synthetic strings.
 * `fullBoolean` covers the 12 grid carve cases plus the gated oversized apply case (13 booleans).
 */
const WALL_CELLS: WallCell[] = [
    {
        label: JOHN,
        text: JOHN,
        side: "left",
        size: 1,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: false,
    },
    {
        label: JOHN,
        text: JOHN,
        side: "left",
        size: 8.5,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: false,
    },
    {
        label: JOHN,
        text: JOHN,
        side: "left",
        size: 16,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: false,
    },
    {
        label: JOHN,
        text: JOHN,
        side: "right",
        size: 1,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: true,
    },
    {
        label: JOHN,
        text: JOHN,
        side: "right",
        size: 8.5,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: true,
    },
    {
        label: JOHN,
        text: JOHN,
        side: "right",
        size: 16,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: true,
    },
    {
        label: MAXIMILIAN_LEGAL,
        text: MAXIMILIAN,
        side: "left",
        size: 1,
        outcome: "textDoesNotFit",
        fullBoolean: false,
        gatedBoolean: false,
    },
    {
        label: MAXIMILIAN_LEGAL,
        text: MAXIMILIAN,
        side: "left",
        size: 8.5,
        outcome: "textDoesNotFit",
        fullBoolean: false,
        gatedBoolean: false,
    },
    {
        label: MAXIMILIAN_LEGAL,
        text: MAXIMILIAN,
        side: "left",
        size: 16,
        outcome: "textDoesNotFit",
        fullBoolean: false,
        gatedBoolean: false,
    },
    {
        label: MAXIMILIAN_LEGAL,
        text: MAXIMILIAN,
        side: "right",
        size: 1,
        outcome: "textDoesNotFit",
        fullBoolean: false,
        gatedBoolean: false,
    },
    {
        label: MAXIMILIAN_LEGAL,
        text: MAXIMILIAN,
        side: "right",
        size: 8.5,
        outcome: "textDoesNotFit",
        fullBoolean: false,
        gatedBoolean: false,
    },
    {
        label: MAXIMILIAN_LEGAL,
        text: MAXIMILIAN,
        side: "right",
        size: 16,
        outcome: "textDoesNotFit",
        fullBoolean: false,
        gatedBoolean: false,
    },
    {
        label: AL,
        text: AL,
        side: "left",
        size: 1,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: false,
    },
    {
        label: AL,
        text: AL,
        side: "left",
        size: 8.5,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: false,
    },
    {
        label: AL,
        text: AL,
        side: "left",
        size: 16,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: false,
    },
    {
        label: AL,
        text: AL,
        side: "right",
        size: 1,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: false,
    },
    {
        label: AL,
        text: AL,
        side: "right",
        size: 8.5,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: false,
    },
    {
        label: AL,
        text: AL,
        side: "right",
        size: 16,
        outcome: "place",
        fullBoolean: true,
        gatedBoolean: false,
    },
];

const SI_PAD_MM = 2;
const GATED_TIMEOUT_MS = 15_000;
const FULL_MATRIX_TIMEOUT_MS = 600_000;
const FULL_TEXT_MATRIX = process.env.FULL_TEXT_MATRIX === "1";

const hosts = new Map<string, Promise<BufferGeometry>>();

function marking(text: string): TextMarking {
    return { ...defaultTextMarking("wall"), text, capHeightMm: 6, mode: "engrave" };
}

function cellTitle(cell: WallCell): string {
    return `${cell.label} on the ${cell.side} wall at M${cell.size}`;
}

function glyphBox(flat: FlattenedText): { xMin: number; xMax: number; yMin: number; yMax: number } {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const g of flat.groups) {
        for (const p of g.outer) {
            if (p.x < xMin) xMin = p.x;
            if (p.x > xMax) xMax = p.x;
            if (p.y < yMin) yMin = p.y;
            if (p.y > yMax) yMax = p.y;
        }
    }
    return { xMin, xMax, yMin, yMax };
}

function scaleAboutCenter(geo: BufferGeometry, scale: number): void {
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    const pos = geo.getAttribute("position");
    if (!box || !pos) return;
    const cx = (box.min.x + box.max.x) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    for (let i = 0; i < pos.count; i++) {
        pos.setX(i, cx + (pos.getX(i) - cx) * scale);
        pos.setY(i, cy + (pos.getY(i) - cy) * scale);
    }
    pos.needsUpdate = true;
    geo.computeBoundingBox();
}

function scaleFramesAbout(geo: BufferGeometry, cx: number, cy: number, scale: number): void {
    const ud = geo.userData as {
        outlineRing?: Array<{ x: number; y: number }>;
        bottomOutlineB?: Array<{ x: number; y: number }>;
        wallFrames?: Array<{ R: { x: number; y: number } }>;
        filletRing?: Array<{ x: number; y: number }>;
    };
    const seen = new Set<object>();
    const map = (p: { x: number; y: number }) => {
        if (seen.has(p)) return;
        seen.add(p);
        p.x = cx + (p.x - cx) * scale;
        p.y = cy + (p.y - cy) * scale;
    };
    for (const ring of [ud.outlineRing, ud.bottomOutlineB]) {
        if (!ring || seen.has(ring)) continue;
        seen.add(ring);
        for (const p of ring) map(p);
    }
    for (const frame of ud.wallFrames ?? []) map(frame.R);
    for (const p of ud.filletRing ?? []) map(p);
}

function hostFor(side: Side, size: number): Promise<BufferGeometry> {
    const key = `${side}|${size}`;
    let pending = hosts.get(key);
    if (!pending) {
        pending = (async () => {
            const raw = await loadSampleTopGlb();
            const sized = side === "left" ? mirrorGeometry(raw) : raw.clone();
            if (side === "left") raw.dispose();
            const scale = insoleLayoutForUsMenSize(size).scale;
            scaleAboutCenter(sized, scale);
            if (side === "right") raw.dispose();
            try {
                const preview = await reconstructProceduralPreview(sized, { wallStyle: "straight" });
                sized.dispose();
                return preview.geometry;
            } catch (err) {
                sized.dispose();
                if (side !== "left" || !(err instanceof Error) || !err.message.includes("CDT sliver"))
                    throw err;
                const again = await loadSampleTopGlb();
                const mirrored = mirrorGeometry(again);
                again.dispose();
                const preview = await reconstructProceduralPreview(mirrored, { wallStyle: "straight" });
                mirrored.dispose();
                const geo = preview.geometry;
                geo.computeBoundingBox();
                const box = geo.boundingBox;
                if (!box) throw err;
                const cx = (box.min.x + box.max.x) / 2;
                const cy = (box.min.y + box.max.y) / 2;
                scaleAboutCenter(geo, scale);
                scaleFramesAbout(geo, cx, cy, scale);
                return geo;
            }
        })();
        hosts.set(key, pending);
    }
    return pending;
}

function filletFloor(geo: BufferGeometry, run: WallStation[]): (s: number) => number {
    const cache = new Map<number, number>();
    const filletOf = (st: WallStation): number => {
        const key = Math.round(st.s * 20);
        let v = cache.get(key);
        if (v == null) {
            v = measureWallFilletTopMm(geo, st);
            cache.set(key, v);
        }
        return v;
    };
    const samples: Array<{ s: number; floor: number }> = [];
    const stride = Math.max(1, Math.floor(run.length / 24));
    for (let i = 0; i < run.length; i += stride) {
        const st = run[i]!;
        samples.push({ s: st.s, floor: filletOf(st) + TEXT_WALL_EDGE_CLEARANCE_MM });
    }
    const tail = run[run.length - 1]!;
    if (samples[samples.length - 1]!.s !== tail.s) {
        samples.push({ s: tail.s, floor: filletOf(tail) + TEXT_WALL_EDGE_CLEARANCE_MM });
    }
    return (s: number): number => {
        if (s <= samples[0]!.s) return samples[0]!.floor;
        const last = samples[samples.length - 1]!;
        if (s >= last.s) return last.floor;
        for (let i = 1; i < samples.length; i++) {
            const b = samples[i]!;
            if (s <= b.s) {
                const a = samples[i - 1]!;
                const t = (s - a.s) / Math.max(1e-9, b.s - a.s);
                return a.floor + (b.floor - a.floor) * t;
            }
        }
        return last.floor;
    };
}

function surfaceT(mark: TextMarking): number {
    const offset0 = mark.mode === "engrave" ? -mark.depthMm : -TEXT_BOOLEAN_OUTSET_MM;
    const offset1 = mark.mode === "engrave" ? TEXT_BOOLEAN_OUTSET_MM : mark.heightMm;
    return -offset0 / (offset1 - offset0);
}

function locateOnWall(
    wall: ReturnType<typeof createOuterWallSampler>,
    run: WallStation[],
    target: { x: number; y: number; z: number },
): { s: number; h: number; d: number } {
    const s0 = run[0]!.s;
    const s1 = run[run.length - 1]!.s;
    let best = { s: s0, h: 0, d: Infinity };
    const score = (s: number, h: number) => {
        const clampedS = Math.max(s0, Math.min(s1, s));
        const st = run.reduce((a, b) => (Math.abs(b.s - clampedS) < Math.abs(a.s - clampedS) ? b : a));
        const clampedH = Math.max(0, Math.min(st.heightMm, h));
        const hit = wall.at(clampedS, clampedH);
        const d = Math.hypot(hit.p.x - target.x, hit.p.y - target.y, hit.p.z - target.z);
        if (d < best.d) best = { s: clampedS, h: clampedH, d };
    };
    for (const st of run) {
        const steps = Math.max(2, Math.ceil(st.heightMm));
        for (let k = 0; k <= steps; k++) score(st.s, (st.heightMm * k) / steps);
    }
    for (const span of [1.5, 0.3, 0.06]) {
        const sRef = best.s;
        const hRef = best.h;
        const sub = span / 6;
        for (let ds = -span; ds <= span + 1e-9; ds += sub) {
            for (let dh = -span; dh <= span + 1e-9; dh += sub) score(sRef + ds, hRef + dh);
        }
    }
    return best;
}

function vertexKeys(geo: BufferGeometry): Set<string> {
    const pos = geo.getAttribute("position");
    const keys = new Set<string>();
    for (let i = 0; i < pos.count; i++) keys.add(`${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`);
    return keys;
}

function positionSnapshot(geo: BufferGeometry): Float32Array {
    const pos = geo.getAttribute("position");
    return new Float32Array(pos.array as ArrayLike<number>);
}

function samePositions(geo: BufferGeometry, snap: Float32Array): boolean {
    const pos = geo.getAttribute("position");
    if (pos.count * 3 !== snap.length) return false;
    const arr = pos.array as ArrayLike<number>;
    for (let i = 0; i < snap.length; i++) if (arr[i] !== snap[i]) return false;
    return true;
}

interface Box {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

function inBox(x: number, y: number, z: number, box: Box): boolean {
    return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && z >= box.minZ && z <= box.maxZ;
}

function projectWall(
    run: WallStation[],
    p: { x: number; y: number; z: number },
): { dist: number; h: number; height: number } | null {
    let bestD = 0.6;
    let bestH = 0;
    let bestHeight = 0;
    let found = false;
    for (const st of run) {
        const rx = st.R.x - st.B.x;
        const ry = st.R.y - st.B.y;
        const rz = st.R.z - st.B.z;
        const hLen2 = rx * rx + ry * ry + rz * rz || 1;
        let t = ((p.x - st.B.x) * rx + (p.y - st.B.y) * ry + (p.z - st.B.z) * rz) / hLen2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const qx = st.B.x + rx * t + st.nOut.x * st.outerMm;
        const qy = st.B.y + ry * t + st.nOut.y * st.outerMm;
        const qz = st.B.z + rz * t + st.nOut.z * st.outerMm;
        const d = Math.hypot(p.x - qx, p.y - qy, p.z - qz);
        if (d < bestD) {
            bestD = d;
            bestH = t * st.heightMm;
            bestHeight = st.heightMm;
            found = true;
        }
    }
    return found ? { dist: bestD, h: bestH, height: bestHeight } : null;
}

function assertWallAndBottomUnmoved(host: BufferGeometry, result: BufferGeometry, box: Box): void {
    const ctx = extractHostTextContext(host);
    const pos = host.getAttribute("position");
    const keys = vertexKeys(result);
    const wallIdx: number[] = [];
    const bottomIdx: number[] = [];
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) <= 1e-4) bottomIdx.push(i);
    for (const surface of ["wall", "medial"] as const) {
        const run = stationsForSurface(ctx, surface);
        for (let i = 0; i < pos.count; i++) {
            const z = pos.getZ(i);
            if (z <= 1e-4) continue;
            const x = pos.getX(i);
            const y = pos.getY(i);
            const hit = projectWall(run, { x, y, z });
            if (!hit) continue;
            if (hit.h <= 0.4 || hit.h >= hit.height - 0.4) continue;
            if (inBox(x, y, z, box)) continue;
            wallIdx.push(i);
        }
    }
    expect(bottomIdx.length).toBeGreaterThan(50);
    expect(wallIdx.length).toBeGreaterThan(50);
    const missing = (ids: number[]): number => {
        let n = 0;
        for (const i of ids) {
            const key = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
            if (!keys.has(key)) n++;
        }
        return n;
    };
    expect(missing(bottomIdx)).toBe(0);
    expect(missing(wallIdx)).toBe(0);
}

function mappedTextAabb(
    map: ReturnType<typeof placeWallText>["map"],
    groups: FlattenedText["groups"],
    padMm: number,
): Box {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const g of groups) {
        for (const loop of [g.outer, ...g.holes]) {
            for (const p of loop) {
                for (const t of [0, 1]) {
                    const q = map(p, t);
                    if (q.x < minX) minX = q.x;
                    if (q.y < minY) minY = q.y;
                    if (q.z < minZ) minZ = q.z;
                    if (q.x > maxX) maxX = q.x;
                    if (q.y > maxY) maxY = q.y;
                    if (q.z > maxZ) maxZ = q.z;
                }
            }
        }
    }
    return {
        minX: minX - padMm,
        minY: minY - padMm,
        minZ: minZ - padMm,
        maxX: maxX + padMm,
        maxY: maxY + padMm,
        maxZ: maxZ + padMm,
    };
}

function glyphInsideBand(
    band: ReturnType<typeof buildWallUsableBand>,
    wall: ReturnType<typeof createOuterWallSampler>,
    run: WallStation[],
    placed: ReturnType<typeof placeWallText>,
    mark: TextMarking,
): boolean {
    const box = glyphBox(placed.flat);
    const anchor = placed.flat.centroids[0] ?? placed.flat.groups[0]?.outer[0];
    if (!anchor) return false;
    const world = placed.map(anchor, surfaceT(mark));
    const loc = locateOnWall(wall, run, world);
    if (loc.d > 0.2) return false;
    const sLeft = loc.s - (anchor.x - box.xMin);
    const hBase = loc.h - (anchor.y - box.yMin);
    return band.contains(sLeft, box.xMax - box.xMin, hBase, box.yMax - box.yMin);
}

function assertScaleAtLeast80(flat: FlattenedText, placed: ReturnType<typeof placeWallText>): void {
    const before = glyphBox(flat);
    const after = glyphBox(placed.flat);
    const scaleX = (after.xMax - after.xMin) / Math.max(1e-9, before.xMax - before.xMin);
    const scaleY = (after.yMax - after.yMin) / Math.max(1e-9, before.yMax - before.yMin);
    expect(scaleX).toBeGreaterThanOrEqual(0.8 - 1e-6);
    expect(scaleY).toBeGreaterThanOrEqual(0.8 - 1e-6);
}

async function loadPlacementInputs(cell: WallCell) {
    const host = await hostFor(cell.side, cell.size);
    const ctx = extractHostTextContext(host);
    const run = stationsForSurface(ctx, "wall");
    const font = await loadTextFont();
    const flat = flattenText(font, cell.text, 6, 0.6, true);
    const mark = marking(cell.text);
    const band = buildWallUsableBand(host, run, mark.depthMm, filletFloor(host, run));
    const wall = createOuterWallSampler(host, run);
    return { host, ctx, run, flat, mark, band, wall };
}

function expectTextDoesNotFitError(err: unknown): void {
    const ui = textDoesNotFit();
    expect(err).toBeInstanceOf(TextMarkingError);
    expect((err as TextMarkingError).code).toBe(ui.code);
    expect((err as Error).message).toBe(ui.message);
}

async function assertCleanTextDoesNotFit(cell: WallCell): Promise<void> {
    const { host, ctx, flat, mark } = await loadPlacementInputs(cell);
    let placementErr: unknown;
    try {
        placeWallText(host, ctx, mark, flat);
    } catch (e) {
        placementErr = e;
    }
    expectTextDoesNotFitError(placementErr);
}

async function assertPlacementAndBand(cell: WallCell): Promise<ReturnType<typeof placeWallText>> {
    const { host, ctx, run, flat, mark, band, wall } = await loadPlacementInputs(cell);
    const placed = placeWallText(host, ctx, mark, flat);
    assertScaleAtLeast80(flat, placed);
    expect(glyphInsideBand(band, wall, run, placed, mark)).toBe(true);
    return placed;
}

async function assertBooleanCarve(cell: WallCell, placed: ReturnType<typeof placeWallText>): Promise<void> {
    const { host, ctx, run, flat, mark, band, wall } = await loadPlacementInputs(cell);
    const work = host.clone();
    work.userData = { ...host.userData };
    let result: BufferGeometry | null = null;
    let finalPlaced = placed;
    let vDrop = 0;
    try {
        for (let attempt = 0; attempt < 48; attempt++) {
            finalPlaced = attempt === 0 ? placed : placeWallText(host, ctx, mark, flat, { vDropMm: vDrop });
            const carved = await booleanTextSolid(
                work,
                finalPlaced.flat.groups,
                finalPlaced.map,
                "subtract",
                finalPlaced.rebind,
                undefined,
                true,
            );
            const hits =
                (carved.userData as { textSoupHits?: ReturnType<typeof countSoupSelfIntersections> })
                    .textSoupHits ?? countSoupSelfIntersections(carved, 1e-4);
            const box = mappedTextAabb(finalPlaced.map, finalPlaced.flat.groups, SI_PAD_MM);
            const local = hits.pairs.filter((p) => inBox(p.centroid.x, p.centroid.y, p.centroid.z, box));
            if (!local.length) {
                expect(glyphInsideBand(band, wall, run, finalPlaced, mark)).toBe(true);
                assertWallAndBottomUnmoved(host, carved, box);
                result = carved;
                break;
            }
            if (carved !== work) carved.dispose();
            if (finalPlaced.vRoomDownMm + 1e-6 < 0.5) {
                throw new Error("self-intersection remains inside the text bbox + 2 mm");
            }
            vDrop += 0.5;
        }
        expect(result).toBeTruthy();
    } finally {
        if (result && result !== work) result.dispose();
        work.dispose();
    }
}

async function runGatedCell(cell: WallCell): Promise<void> {
    if (cell.outcome === "textDoesNotFit") {
        await assertCleanTextDoesNotFit(cell);
        return;
    }
    const placed = await assertPlacementAndBand(cell);
    if (cell.gatedBoolean) await assertBooleanCarve(cell, placed);
}

async function runFullMatrixCell(cell: WallCell): Promise<void> {
    if (cell.outcome === "textDoesNotFit") {
        await assertCleanTextDoesNotFit(cell);
        return;
    }
    const placed = await assertPlacementAndBand(cell);
    if (cell.fullBoolean) await assertBooleanCarve(cell, placed);
}

describe("wall text cases (PR-gated)", () => {
    beforeAll(async () => {
        await Promise.all(
            (["left", "right"] as const).flatMap((side) => [1, 8.5, 16].map((size) => hostFor(side, size))),
        );
    }, 120_000);

    for (const cell of WALL_CELLS) {
        test(
            cellTitle(cell),
            async () => {
                await runGatedCell(cell);
            },
            GATED_TIMEOUT_MS,
        );
    }

    test(
        "oversized name at M1 throws textDoesNotFit and keeps the no-text mesh",
        async () => {
            const host = await hostFor("right", 1);
            const work = host.clone();
            work.userData = { ...host.userData };
            const snap = positionSnapshot(work);
            const mark = marking(OVERSIZED);
            const ui = textDoesNotFit();
            let textFitError: string | null = null;
            let returned: BufferGeometry | null = null;
            try {
                returned = await applyTextMarkingToPrintSolid(work, mark, { side: "right" });
            } catch (e) {
                expectTextDoesNotFitError(e);
                textFitError = (e as Error).message;
            }
            expect(textFitError).toBe(ui.message);
            expect(returned).toBeNull();
            expect(samePositions(work, snap)).toBe(true);
            const guide = buildTextGuide(work);
            work.userData = { ...work.userData, textGuide: guide, textFitError };
            publishTextGuide("right", guide, textFitError);
            expect(textFitErrorSnapshot().right).toBe("[TEXT] text does not fit the placement zone");
            work.dispose();
        },
        GATED_TIMEOUT_MS,
    );

    test("usable band rejects a fold over 30 degrees and a radius under 2x depth", () => {
        const sharp = kinkedWall(40, 1.5, 24, 48, 18);
        const sharpBand = buildWallUsableBand(sharp.geo, sharp.run, 0.4, () => 0);
        expect(sharp.angleDeg).toBeGreaterThan(30);
        expect(sharpBand.contains(4, 4, 6, 6)).toBe(true);
        expect(sharpBand.contains(sharp.hinge - 3, 6, 6, 6)).toBe(false);
        sharp.geo.dispose();

        const depth = 0.4;
        const tight = kinkedWall(28, 0.55, 11, 22, 12.1);
        const tightBand = buildWallUsableBand(tight.geo, tight.run, depth, () => 0);
        const theta = (tight.angleDeg * Math.PI) / 180;
        expect(tight.angleDeg).toBeLessThanOrEqual(30);
        expect(tight.angleDeg).toBeGreaterThan(20);
        expect(tight.stepMm).toBeGreaterThanOrEqual(0.35);
        expect(tight.stepMm / theta).toBeLessThan(2 * depth);
        expect(tightBand.contains(1, 2, 4, 4)).toBe(true);
        expect(tightBand.contains(tight.hinge - 1, 2, 4, 4)).toBe(false);
        tight.geo.dispose();
    });
});

const fullMatrixDescribe = FULL_TEXT_MATRIX ? describe : describe.skip;

fullMatrixDescribe("wall text cases (full boolean matrix)", () => {
    for (const cell of WALL_CELLS.filter((c) => c.fullBoolean)) {
        test(
            `${cellTitle(cell)} [full carve]`,
            async () => {
                await runFullMatrixCell(cell);
            },
            FULL_MATRIX_TIMEOUT_MS,
        );
    }

    test(
        "oversized name at M1 throws textDoesNotFit and keeps the no-text mesh [full apply]",
        async () => {
            const host = await hostFor("right", 1);
            const work = host.clone();
            work.userData = { ...host.userData };
            const snap = positionSnapshot(work);
            const mark = marking(OVERSIZED);
            const ui = textDoesNotFit();
            let textFitError: string | null = null;
            let returned: BufferGeometry | null = null;
            try {
                returned = await applyTextMarkingToPrintSolid(work, mark, { side: "right" });
            } catch (e) {
                expectTextDoesNotFitError(e);
                textFitError = (e as Error).message;
            }
            expect(textFitError).toBe(ui.message);
            expect(returned).toBeNull();
            expect(samePositions(work, snap)).toBe(true);
            work.dispose();
        },
        FULL_MATRIX_TIMEOUT_MS,
    );
});

function kinkedWall(
    angleDeg: number,
    step: number,
    hinge: number,
    length: number,
    height: number,
): { geo: BufferGeometry; run: WallStation[]; hinge: number; angleDeg: number; stepMm: number } {
    const ang = (angleDeg * Math.PI) / 180;
    const nx = Math.round(length / step);
    const nz = Math.round(height / step);
    const positions: number[] = [];
    const indices: number[] = [];
    const vid = (i: number, j: number) => i * (nz + 1) + j;
    for (let i = 0; i <= nx; i++) {
        const x0 = i * step;
        const x = x0 <= hinge ? x0 : hinge + (x0 - hinge) * Math.cos(ang);
        const y = x0 <= hinge ? 0 : (x0 - hinge) * Math.sin(ang);
        for (let j = 0; j <= nz; j++) positions.push(x, y, j * step);
    }
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
            const a = vid(i, j);
            const b = vid(i + 1, j);
            const c = vid(i, j + 1);
            const d = vid(i + 1, j + 1);
            indices.push(a, c, b, b, c, d);
        }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    const run: WallStation[] = [];
    for (let i = 0; i <= nx; i++) {
        const s = i * step;
        run.push({
            u: 0.2 + (0.6 * s) / length,
            s,
            R: { x: s, y: 0, z: height },
            B: { x: s, y: 0, z: 0 },
            heightMm: height,
            sideSign: -1,
            nOut: { x: 0, y: 1, z: 0 },
            thickMm: 4,
            outerMm: 0,
        });
    }
    const hingeI = Math.round(hinge / step);
    const j = Math.max(1, Math.floor(nz / 2));
    const nOf = (i: number) => {
        const a = vid(i, j);
        const b = vid(i + 1, j);
        const c = vid(i, j + 1);
        const ax = positions[a * 3]!;
        const ay = positions[a * 3 + 1]!;
        const az = positions[a * 3 + 2]!;
        const bx = positions[b * 3]!;
        const by = positions[b * 3 + 1]!;
        const bz = positions[b * 3 + 2]!;
        const cx = positions[c * 3]!;
        const cy = positions[c * 3 + 1]!;
        const cz = positions[c * 3 + 2]!;
        const ex = cx - ax;
        const ey = cy - ay;
        const ez = cz - az;
        const fx = bx - ax;
        const fy = by - ay;
        const fz = bz - az;
        let nxn = ey * fz - ez * fy;
        let nyn = ez * fx - ex * fz;
        let nzn = ex * fy - ey * fx;
        const nl = Math.hypot(nxn, nyn, nzn) || 1;
        nxn /= nl;
        nyn /= nl;
        nzn /= nl;
        return { x: nxn, y: nyn, z: nzn, span: Math.hypot(fx, fy, fz) };
    };
    const left = nOf(hingeI - 1);
    const right = nOf(hingeI);
    const dot = Math.max(-1, Math.min(1, left.x * right.x + left.y * right.y + left.z * right.z));
    const measured = (Math.acos(dot) * 180) / Math.PI;
    const stepMm = left.span / 3 + right.span / 3;
    return { geo, run, hinge, angleDeg: measured, stepMm };
}
