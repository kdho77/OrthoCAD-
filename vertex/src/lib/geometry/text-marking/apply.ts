// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { booleanTextSolid } from "./boolean";
import { type BottomOutlineWorld, engraveBottomPlanar } from "./bottom-engrave";
import {
    hasActiveTextMarking,
    isSideText,
    markingForSide,
    TEXT_BOOLEAN_EPS_MM,
    TEXT_BOOLEAN_OUTSET_MM,
    TEXT_CAP,
    TEXT_WALL_FEATURE_MIN_MM,
} from "./constants";
import { flattenText } from "./contours";
import { TextMarkingError, textDoesNotFit } from "./errors";
import { loadTextFont } from "./font";
import { assertTextPrintGates } from "./gates";
import {
    bandWallHeightMm,
    extractHostTextContext,
    type HostTextContext,
    placeBottomText,
    placeWallText,
} from "./place";
import type { SoupIntersectionReport } from "./soup-intersect";
import type { MapTextPoint, TextApplyContext, TextApplyMeta, TextGlyphGroup, TextMarking } from "./types";
import { assertTextMarkingInRange } from "./validate";

function shrinkThenFlatten(
    font: Awaited<ReturnType<typeof loadTextFont>>,
    marking: TextMarking,
    minCap: number,
    tryPlace: (flat: ReturnType<typeof flattenText>, cap: number) => void,
): ReturnType<typeof flattenText> {
    let cap = marking.capHeightMm;
    let lastErr: unknown;
    while (cap + 1e-6 >= minCap) {
        try {
            const flat = flattenText(font, marking.text, cap, marking.letterSpacingMm, marking.bold);
            tryPlace(flat, cap);
            return flat;
        } catch (e) {
            lastErr = e;
            if (e instanceof TextMarkingError && e.code === "too-thin") throw e;
            cap = Math.max(minCap, Number((cap - 0.1).toFixed(4)));
            if (cap <= minCap + 1e-6) break;
        }
    }
    try {
        const flat = flattenText(font, marking.text, minCap, marking.letterSpacingMm, marking.bold);
        tryPlace(flat, minCap);
        return flat;
    } catch (e) {
        throw lastErr instanceof Error ? lastErr : e;
    }
}

const WALL_SI_PAD_MM = 2;
const WALL_V_STEP_MM = 0.5;

function mappedTextAabb(map: MapTextPoint, groups: TextGlyphGroup[], padMm: number) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const add = (x: number, y: number, z: number) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    };
    for (const g of groups) {
        const loops = [g.outer, ...g.holes];
        for (const loop of loops) {
            for (const p of loop) {
                const a = map(p, 0);
                const b = map(p, 1);
                add(a.x, a.y, a.z);
                add(b.x, b.y, b.z);
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

function centroidInAabb(
    p: { x: number; y: number; z: number },
    box: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number },
): boolean {
    return (
        p.x >= box.minX &&
        p.x <= box.maxX &&
        p.y >= box.minY &&
        p.y <= box.maxY &&
        p.z >= box.minZ &&
        p.z <= box.maxZ
    );
}

/**
 * Place on the usable band, boolean, then step 0.5 mm down v while the
 * exported soup self-intersects inside the text bbox + 2 mm.
 */
async function placeWallClearOfSelfIntersection(
    host: BufferGeometry,
    hostCtx: HostTextContext,
    marking: TextMarking,
    flat: ReturnType<typeof flattenText>,
): Promise<ReturnType<typeof placeWallText> & { result: BufferGeometry }> {
    let vDrop = 0;
    for (let attempt = 0; attempt < 48; attempt++) {
        const placed = placeWallText(host, hostCtx, marking, flat, { vDropMm: vDrop });
        const op = marking.mode === "emboss" ? "add" : "subtract";
        const result = await booleanTextSolid(
            host,
            placed.flat.groups,
            placed.map,
            op,
            placed.rebind,
            undefined,
            true,
        );
        const hits = (result.userData as { textSoupHits?: SoupIntersectionReport }).textSoupHits;
        const box = mappedTextAabb(placed.map, placed.flat.groups, WALL_SI_PAD_MM);
        const local = (hits?.pairs ?? []).filter((p) => centroidInAabb(p.centroid, box));
        if (!local.length) return { ...placed, result };
        if (result !== host) result.dispose();
        if (placed.vRoomDownMm + 1e-6 < WALL_V_STEP_MM) throw textDoesNotFit();
        vDrop += WALL_V_STEP_MM;
    }
    throw textDoesNotFit();
}

/**
 * After composePrintSolidTop + loft: build one closed text solid and run a
 * single manifold-3d boolean. Empty text is a no-op (same geometry object).
 */
export async function applyTextMarkingToPrintSolid(
    host: BufferGeometry,
    marking: TextMarking | null | undefined,
    ctx: TextApplyContext,
): Promise<BufferGeometry> {
    if (!hasActiveTextMarking(marking) || !marking) return host;
    const forSide = markingForSide(marking, ctx.side);
    if (!hasActiveTextMarking(forSide)) return host;
    const hostCtx = extractHostTextContext(host);
    const wallH = bandWallHeightMm(hostCtx, forSide.surface);
    const localThickness = isSideText(forSide.surface)
        ? 99
        : ((host.userData as { thicknessMm?: number }).thicknessMm ?? 8);
    const checked = assertTextMarkingInRange(forSide, {
        wallHeightMm: wallH || undefined,
        localThicknessMm: localThickness,
    });
    const font = await loadTextFont();
    const minCap = isSideText(checked.surface) ? TEXT_WALL_FEATURE_MIN_MM : TEXT_CAP.bottom.min;

    let placedFlat: ReturnType<typeof flattenText>;
    let map: ReturnType<typeof placeBottomText>["map"];
    let rebind: ((geo: typeof host) => typeof map) | undefined;
    let placeMeta: Pick<TextApplyMeta, "centroids" | "mappedWidthMm" | "wallUMin" | "wallUMax">;
    let wallResult: BufferGeometry | null = null;
    if (checked.surface === "bottom") {
        placedFlat = shrinkThenFlatten(font, checked, minCap, (flat) => {
            placeBottomText(host, hostCtx, { ...checked, capHeightMm: flat.capHeightMm }, flat, ctx.side);
        });
        const placed = placeBottomText(
            host,
            hostCtx,
            { ...checked, capHeightMm: placedFlat.capHeightMm },
            placedFlat,
            ctx.side,
        );
        placedFlat = placed.flat;
        map = placed.map;
        placeMeta = placed.meta;
    } else {
        placedFlat = shrinkThenFlatten(font, checked, minCap, (flat) => {
            placeWallText(host, hostCtx, { ...checked, capHeightMm: flat.capHeightMm }, flat);
        });
        const placed = await placeWallClearOfSelfIntersection(
            host,
            hostCtx,
            { ...checked, capHeightMm: placedFlat.capHeightMm },
            placedFlat,
        );
        placedFlat = placed.flat;
        map = placed.map;
        rebind = placed.rebind;
        placeMeta = placed.meta;
        wallResult = placed.result;
    }

    const op = checked.mode === "emboss" ? "add" : "subtract";
    const groups = placedFlat.groups;
    const result =
        wallResult ??
        (checked.surface === "bottom"
            ? await engraveBottomPlanar(host, groups, checked.depthMm)
            : await booleanTextSolid(host, groups, map, op, rebind));
    const poke = isSideText(checked.surface) ? TEXT_BOOLEAN_OUTSET_MM : TEXT_BOOLEAN_EPS_MM;
    const span = checked.mode === "engrave" ? checked.depthMm + poke : checked.heightMm + poke;
    const tSurface = isSideText(checked.surface)
        ? checked.mode === "engrave"
            ? checked.depthMm / Math.max(1e-9, span)
            : poke / Math.max(1e-9, span)
        : poke / Math.max(1e-9, span);
    const bottomOutline = (result.userData as { bottomOutlineWorld?: BottomOutlineWorld[] })
        .bottomOutlineWorld;
    const outlineWorld =
        bottomOutline ??
        groups.map((g) => ({
            outer: g.outer.map((p) => map(p, tSurface)),
            holes: g.holes.map((h) => h.map((p) => map(p, tSurface))),
        }));
    const meta: TextApplyMeta = {
        surface: checked.surface,
        mode: checked.mode,
        depthMm: checked.mode === "engrave" ? checked.depthMm : 0,
        heightMm: checked.mode === "emboss" ? checked.heightMm : 0,
        capHeightMm: placedFlat.capHeightMm,
        advanceMm: placedFlat.advanceMm,
        centroids: placeMeta.centroids,
        mappedWidthMm: placeMeta.mappedWidthMm,
        wallUMin: placeMeta.wallUMin,
        wallUMax: placeMeta.wallUMax,
        outlineWorld,
        hostRepair: (result.userData as { textHostRepair?: TextApplyMeta["hostRepair"] }).textHostRepair,
    };
    assertTextPrintGates(result, meta, hostCtx.outline);
    return result;
}
